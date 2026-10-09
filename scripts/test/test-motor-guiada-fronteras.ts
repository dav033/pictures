/**
 * Las fronteras del motor 3D de la vista guiada (REQ-007, fase 1). Sin coste, solo lee código.
 * - nada de `src/` fuera de `src/lib/globos3d/motor/` importa algo del motor que no sea `motor/v1` (la única entrada del
 *   producto guiado), y nada fuera de `motor/` (ni los scripts) importa `espec-a-escena`;
 * - el motor no importa, ni de rebote, `biblioteca.ts` ni `ideas-sempertex/*` (enormes y perezosas);
 * - ningún archivo del motor pasa de 500 líneas;
 * - `v1.ts` es solo de servidor (`server-only`); el único que lo importa en el motor es él mismo.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "..", "..");
const SRC = path.join(RAIZ, "src");
const MOTOR = path.join(SRC, "lib", "globos3d", "motor");

function archivos(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (nombre === "node_modules" || nombre === ".next") continue;
    const ruta = path.join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivos(ruta, salida);
    else if (/\.(ts|tsx)$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

const IMPORTA = /(?:import|export)\s[^'"`;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g;
const especificadores = (archivo: string): string[] => [...readFileSync(archivo, "utf8").matchAll(IMPORTA)].map((m) => m[1] ?? m[2] ?? m[3]!);

function resolver(desde: string, especificador: string): string | null {
  const base = especificador.startsWith("@/") ? path.join(SRC, especificador.slice(2)) : especificador.startsWith(".") ? path.resolve(path.dirname(desde), especificador) : null;
  if (!base) return null;
  return [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find(existsSync) ?? null;
}

// 1. Quién importa el motor.
const dentro = (ruta: string) => ruta.startsWith(MOTOR + path.sep);
let importadores = 0;
for (const archivo of [...archivos(SRC), ...archivos(path.join(RAIZ, "scripts"))]) {
  if (dentro(archivo)) continue;
  for (const especificador of especificadores(archivo)) {
    const destino = resolver(archivo, especificador);
    if (!destino || !dentro(destino)) continue;
    importadores += 1;
    const nombre = path.basename(destino, ".ts");
    assert.notEqual(nombre, "espec-a-escena", `${path.relative(RAIZ, archivo)} importa espec-a-escena, que es privado del motor`);
    if (archivo.startsWith(SRC)) assert.equal(nombre, "v1", `${path.relative(RAIZ, archivo)} importa motor/${nombre}: el producto guiado solo entra por motor/v1`);
  }
}

// 2. El motor no arrastra la biblioteca del Taller, ni de rebote.
const PROHIBIDOS = [path.join(SRC, "lib", "globos3d", "biblioteca.ts"), path.join(SRC, "lib", "globos3d", "ideas-sempertex") + path.sep];
const visto = new Map<string, string | null>();
const cola: string[] = archivos(MOTOR);
cola.forEach((f) => visto.set(f, null));
while (cola.length) {
  const actual = cola.shift()!;
  for (const especificador of especificadores(actual)) {
    const destino = resolver(actual, especificador);
    if (!destino || visto.has(destino)) continue;
    visto.set(destino, actual);
    cola.push(destino);
  }
}
for (const prohibido of PROHIBIDOS) {
  const colado = [...visto.keys()].find((f) => f === prohibido || f.startsWith(prohibido));
  if (colado) {
    const cadena: string[] = [];
    for (let c: string | null | undefined = colado; c; c = visto.get(c)) cadena.push(path.relative(SRC, c));
    assert.fail(`el motor arrastra ${path.relative(SRC, prohibido)}: ${cadena.reverse().join(" -> ")}`);
  }
}

// 3. Tamaño de los archivos y el guardia de servidor.
for (const archivo of archivos(MOTOR)) {
  const lineas = readFileSync(archivo, "utf8").split("\n").length;
  assert.ok(lineas <= 500, `${path.relative(RAIZ, archivo)} tiene ${lineas} líneas: pasa de 500`);
}
assert.match(readFileSync(path.join(MOTOR, "v1.ts"), "utf8"), /^import "server-only";/m, "v1.ts debe ser solo de servidor");
for (const archivo of archivos(MOTOR)) if (!archivo.endsWith(`${path.sep}v1.ts`)) assert.ok(!/import "server-only"/.test(readFileSync(archivo, "utf8")), `${path.basename(archivo)}: solo v1.ts lleva server-only (los esquemas los lee el script de contratos)`);

console.log(`test-motor-guiada-fronteras: ok (${visto.size} archivos en la cerradura del motor, ${importadores} importaciones desde fuera)`);
