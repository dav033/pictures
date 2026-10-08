/**
 * Lo que cuesta ABRIR /3d (y la biblioteca del taller): que importar no arme escenas ni piezas. Sin coste: no llama a
 * ninguna IA ni a la red.
 *
 * Empaqueta con esbuild (node_modules/esbuild) cada punto de entrada como ESM partido en trozos (lo que va por
 * `import()` queda en su propio trozo y no se carga, como en el navegador) y mide, en un proceso de node aparte, cuánto
 * tarda en ejecutarse (cargar el módulo y todo lo que importa al nivel superior). Falla si alguno pasa de `TOPE_MS`:
 * - `Taller3D.tsx`: lo que la página /3d evalúa al cargar (lo que va por `import()`/`next/dynamic` queda perezoso: no cuenta);
 * - `biblioteca.ts`: la biblioteca de fábrica (todas las ideas de Sempertex) sin armar nada;
 * - `herramientas-escena-biblioteca.ts`: lo que importa la IA de la escena (/api/escena-ia).
 *
 * Así una idea o un lote nuevo que arme su escena al importarse (en vez de perezosa, ver `ideas-sempertex/tipos.ts`)
 * rompe esta prueba y no vuelve a congelar el navegador. `--detalle` imprime los tiempos de cada corrida.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const TOPE_MS = 500;
const CORRIDAS = 3;
const RAIZ = path.resolve(__dirname, "../..");
const DETALLE = process.argv.includes("--detalle");

const ENTRADAS: ReadonlyArray<{ nombre: string; archivo: string }> = [
  { nombre: "Taller3D (página /3d)", archivo: "src/components/tres-d/Taller3D.tsx" },
  { nombre: "biblioteca.ts", archivo: "src/lib/globos3d/biblioteca.ts" },
  { nombre: "herramientas-escena-biblioteca.ts", archivo: "src/lib/globos3d/herramientas-escena-biblioteca.ts" },
];

/** Empaqueta la entrada (con sus dependencias, también las de node_modules) en ESM partido para node; da el archivo de entrada. */
async function empaquetar(archivo: string, carpeta: string): Promise<string> {
  const r = await build({
    entryPoints: [path.join(RAIZ, archivo)],
    outdir: carpeta,
    bundle: true,
    splitting: true,
    platform: "node",
    format: "esm",
    outExtension: { ".js": ".mjs" },
    // Los paquetes CommonJS que piden módulos de node necesitan `require` dentro del ESM.
    banner: { js: 'import { createRequire as __crearRequire } from "node:module"; const require = __crearRequire(import.meta.url);' },
    metafile: true,
    // Como el empaquetador de Next en el navegador: la versión ESM de cada paquete (lucide-react en CommonJS define sus
    // ~1500 íconos al cargar y se comería el tope sin que sea culpa de la página).
    mainFields: ["module", "main"],
    conditions: ["module", "import", "browser"],
    target: "node20",
    jsx: "automatic",
    tsconfig: path.join(RAIZ, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".css": "empty", ".svg": "empty", ".png": "empty", ".jpg": "empty", ".webp": "empty" },
    logLevel: "error",
  });
  const entrada = Object.entries(r.metafile.outputs).find(([, o]) => o.entryPoint)?.[0];
  if (!entrada) throw new Error(`esbuild no dio la entrada de ${archivo}`);
  return path.resolve(entrada);
}

/** Ejecuta el paquete en un node nuevo y devuelve los milisegundos que tardó el `import` (ejecución pura). */
function medir(paquete: string): number {
  const url = pathToFileURL(paquete).href;
  const codigo = `const t = performance.now(); import(${JSON.stringify(url)}).then(() => process.stdout.write(String(performance.now() - t)));`;
  const salida = execFileSync(process.execPath, ["-e", codigo], { encoding: "utf8", maxBuffer: 1 << 20 });
  return Number(salida.trim().split(/\s+/).pop());
}

async function main() {
  const carpeta = mkdtempSync(path.join(tmpdir(), "carga-3d-"));
  const fallas: string[] = [];
  try {
    for (const [k, entrada] of ENTRADAS.entries()) {
      const paquete = await empaquetar(entrada.archivo, path.join(carpeta, `entrada-${k}`));
      // Lo mejor de varias corridas: el ruido del equipo (otro proceso) no debe hacer fallar la prueba.
      const tiempos: number[] = [];
      for (let i = 0; i < CORRIDAS; i++) {
        const ms = medir(paquete);
        tiempos.push(ms);
        if (ms > TOPE_MS * 4) break; // ya es claro que no llega: no repetir corridas de segundos
      }
      const mejor = Math.min(...tiempos);
      console.log(`${mejor <= TOPE_MS ? "ok   " : "FALLA"} ${entrada.nombre}: ${mejor.toFixed(0)} ms${DETALLE ? ` (${tiempos.map((t) => t.toFixed(0)).join(", ")})` : ""}`);
      if (mejor > TOPE_MS) fallas.push(`${entrada.nombre} tarda ${mejor.toFixed(0)} ms en cargar (tope ${TOPE_MS} ms): ¿algo arma escenas o piezas al importarse?`);
    }
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
  assert.deepEqual(fallas, [], fallas.join("\n"));
  console.log(`test-carga-3d: todo carga en menos de ${TOPE_MS} ms`);
}

main().catch((causa: unknown) => {
  console.error(causa);
  process.exitCode = 1;
});
