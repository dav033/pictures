/**
 * La frontera de la vista 3D del plan guiado (REQ-007, fase 3): la primera carga de /asistente no cambia. Sin `next build`:
 * recorre el grafo de imports de `src/app/asistente/page.tsx` y comprueba que
 * - ninguna ruta ESTÁTICA llega a three.js ni al visor del Taller (`escena-globos`, `armada-visor`, `camara-estandar`) ni a nada
 *   de la vista 3D salvo sus dos puertas (`CargaVistaPlan3D.tsx` y `firma-plan.ts`, pocos bytes);
 * - esas puertas solo entran por `import()` (React.lazy), y detrás sí están el visor y three.js (la prueba no es vacía);
 * - el navegador nunca importa el motor (`lib/globos3d/motor/*`): solo tipos, que se borran al compilar.
 *
 * Los imports `import type` / `export type` no cuentan: no existen en el JavaScript que sale.
 *
 * Run: npx tsx scripts/test/test-motor3d-frontera.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "..", "..");
const SRC = path.join(RAIZ, "src");
const ENTRADA = path.join(SRC, "app", "asistente", "page.tsx");
const MOTOR3D = path.join(SRC, "components", "guiado", "motor3d") + path.sep;
const MOTOR = path.join(SRC, "lib", "globos3d", "motor") + path.sep;
const TRES_D = path.join(SRC, "components", "tres-d") + path.sep;

type Arista = { destino: string | null; especificador: string; dinamica: boolean };

function sinComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/** Imports que no son código (datos y estilos): no llevan imports propios, no se siguen. */
const EXTENSIONES_DE_DATOS = [".json", ".css", ".woff2", ".svg", ".png"];

function resolver(desde: string, especificador: string): string | null {
  const base = especificador.startsWith("@/") ? path.join(SRC, especificador.slice(2)) : especificador.startsWith(".") ? path.resolve(path.dirname(desde), especificador) : null;
  if (!base) return null;
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")].find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

/** ¿Todo lo que se importa es un tipo? (`import type {…}` o `import { type A, type B }`: no deja rastro en el paquete.) */
function soloTipos(clausula: string): boolean {
  if (/^(import|export)\s+type\s/.test(clausula)) return true;
  const nombres = /\{([^}]*)\}/.exec(clausula)?.[1];
  if (nombres === undefined) return false;
  // Además de las llaves puede haber un import por defecto o `* as x`: ese sí deja rastro.
  if (clausula.replace(/\{[^}]*\}/, "").replace(/^(import|export)/, "").replace(/,/g, "").trim()) return false;
  const lista = nombres.split(",").map((n) => n.trim()).filter(Boolean);
  return lista.length > 0 && lista.every((n) => /^type\s/.test(n));
}

function aristasDe(archivo: string): Arista[] {
  const texto = sinComentarios(readFileSync(archivo, "utf8"));
  const salida: Arista[] = [];
  for (const m of texto.matchAll(/\b(import|export)\s+([^'"`;]*?)\s*from\s*["']([^"']+)["']/g)) {
    if (soloTipos(`${m[1]} ${m[2]}`)) continue;
    salida.push({ destino: resolver(archivo, m[3]!), especificador: m[3]!, dinamica: false });
  }
  for (const m of texto.matchAll(/(?<![\w.])import\s*["']([^"']+)["']/g)) salida.push({ destino: resolver(archivo, m[1]!), especificador: m[1]!, dinamica: false });
  for (const m of texto.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) salida.push({ destino: resolver(archivo, m[1]!), especificador: m[1]!, dinamica: true });
  return salida;
}

type Grafo = { archivos: Set<string>; externos: Map<string, string>; via: Map<string, string>; sinResolver: Map<string, string> };
function recorrer(entradas: readonly string[], conDinamicos: boolean): Grafo {
  const archivos = new Set<string>(), externos = new Map<string, string>(), via = new Map<string, string>(), sinResolver = new Map<string, string>();
  const cola = [...entradas];
  entradas.forEach((e) => archivos.add(e));
  while (cola.length) {
    const actual = cola.shift()!;
    for (const arista of aristasDe(actual)) {
      if (arista.dinamica && !conDinamicos) continue;
      if (!arista.destino) {
        // Un import propio (`@/…` o relativo) que no se resuelve dejaría un hueco en el grafo: three.js podría esconderse detrás.
        const propio = arista.especificador.startsWith("@/") || arista.especificador.startsWith(".");
        if (propio && !EXTENSIONES_DE_DATOS.some((ext) => arista.especificador.endsWith(ext))) sinResolver.set(arista.especificador, actual);
        else if (!propio && !externos.has(arista.especificador)) externos.set(arista.especificador, actual);
        continue;
      }
      if (archivos.has(arista.destino)) continue;
      archivos.add(arista.destino);
      via.set(arista.destino, actual);
      cola.push(arista.destino);
    }
  }
  return { archivos, externos, via, sinResolver };
}

const rel = (ruta: string) => path.relative(SRC, ruta).split(path.sep).join("/");
function cadena(grafo: Grafo, destino: string): string {
  const pasos: string[] = [];
  for (let c: string | undefined = destino; c; c = grafo.via.get(c)) pasos.push(rel(c));
  return pasos.reverse().join(" -> ");
}

const estatico = recorrer([ENTRADA], false);
const completo = recorrer([ENTRADA], true);

// El grafo no tiene huecos: todo import propio se resolvió (si no, la prueba podría pasar con three.js escondido tras uno).
for (const [especificador, quien] of completo.sinResolver) assert.fail(`el recorrido no resuelve «${especificador}» (importado por ${rel(quien)})`);

// Que el recorrido ve lo que debe ver: si no, las pruebas de «no llega» pasarían en vacío.
assert.ok(estatico.archivos.has(path.join(SRC, "components", "guiado", "TarjetaPlan.tsx")), "el recorrido llega a TarjetaPlan");
assert.ok(estatico.archivos.size > 150, `el recorrido estático ve ${estatico.archivos.size} archivos`);

// 1. Nada estático llega a three.js, al visor del Taller ni a la vista 3D (salvo sus dos puertas).
for (const [externo, quien] of estatico.externos) assert.ok(!/^(three($|\/)|@react-three)/.test(externo), `la primera carga importa «${externo}»: ${cadena(estatico, quien)}`);
const PROHIBIDOS = ["escena-globos.ts", "armada-visor.ts", "camara-estandar.ts", "captura-items.ts", "Taller3D.tsx"].map((n) => TRES_D + n);
for (const prohibido of PROHIBIDOS) assert.ok(!estatico.archivos.has(prohibido), `la primera carga trae ${rel(prohibido)}: ${cadena(estatico, prohibido)}`);
const deLaVista = [...estatico.archivos].filter((f) => f.startsWith(MOTOR3D)).map((f) => path.basename(f)).sort();
assert.deepEqual(deLaVista, ["CargaVistaPlan3D.tsx", "firma-plan.ts"], `lo de motor3d/ que entra en la primera carga: ${deLaVista.join(", ")}`);
assert.ok(!estatico.archivos.has(path.join(MOTOR3D, "gestor-vista.ts")), "el gestor, el visor compartido y la hoja solo entran con el trozo perezoso");

// 2. Las puertas pesan poco: es lo único que suma a la primera carga.
const bytesPuertas = ["CargaVistaPlan3D.tsx", "firma-plan.ts"].reduce((suma, n) => suma + statSync(path.join(MOTOR3D, n)).size, 0);
assert.ok(bytesPuertas < 6000, `las puertas de la vista 3D pesan ${bytesPuertas} bytes de fuente`);

// 3. Detrás de los import() sí está todo (la prueba no es vacía): la vista, el visor del Taller y three.js.
for (const nombre of ["VistaPlan3D.tsx", "MiniaturaPieza3D.tsx", "HojaOrbita.tsx", "gestor-vista.ts", "visor-compartido.ts", "desde-armada-compacta.ts"]) {
  assert.ok(completo.archivos.has(path.join(MOTOR3D, nombre)), `${nombre} es alcanzable por import()`);
}
assert.ok(completo.archivos.has(TRES_D + "escena-globos.ts"), "el visor del Taller es alcanzable por import()");
assert.ok([...completo.externos.keys()].some((e) => e === "three" || e.startsWith("three/")), "three.js es alcanzable por import()");
for (const lazy of ["VistaPlan3D.tsx", "MiniaturaPieza3D.tsx"]) {
  const llegada = [...aristasDe(path.join(MOTOR3D, "CargaVistaPlan3D.tsx"))].find((a) => a.destino === path.join(MOTOR3D, lazy));
  assert.equal(llegada?.dinamica, true, `CargaVistaPlan3D entra a ${lazy} por import()`);
}
for (const nombre of ["visor-compartido.ts", "HojaOrbita.tsx"]) {
  const aristas = aristasDe(path.join(MOTOR3D, nombre)).filter((a) => a.destino === TRES_D + "escena-globos.ts");
  assert.ok(aristas.length > 0 && aristas.every((a) => a.dinamica), `${nombre} entra al visor del Taller solo por import()`);
}

// 4. El navegador no importa el motor: solo tipos (que no salen en el JavaScript).
const delMotor = [...completo.archivos].filter((f) => f.startsWith(MOTOR));
assert.deepEqual(delMotor.map(rel), [], `el navegador importa el motor: ${delMotor.map((f) => cadena(completo, f)).join("; ")}`);

// 5. El navegador no importa la ruta ni la lógica del servidor de la vista.
for (const f of completo.archivos) assert.ok(!f.includes(`${path.sep}app${path.sep}api${path.sep}`), `el navegador importa una ruta: ${rel(f)}`);
assert.ok(!completo.archivos.has(path.join(SRC, "lib", "guiada-motor", "armada-motor.ts")), "el navegador no importa la lógica de la ruta de la armada");
assert.ok(completo.archivos.has(path.join(SRC, "lib", "guiada-motor", "armada-contrato.ts")), "pero sí su contrato compartido (sin server-only)");

console.log(`Frontera de la vista 3D: OK (${estatico.archivos.size} archivos en la primera carga, ${completo.archivos.size} con los import(); puertas: ${bytesPuertas} bytes)`);
