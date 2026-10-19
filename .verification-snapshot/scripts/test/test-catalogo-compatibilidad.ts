/**
 * Lo guardado sigue cargando, armándose y resolviéndose con los repositorios de catálogo (REQ-013, AC-6). Sin coste: ninguna IA
 * ni red. El corpus:
 * - las escenas de la biblioteca de fábrica y los presets (las de la prueba dorada) y las lecturas de `referencias-dueno`
 *   compiladas;
 * - `fixtures/escenas-guardadas/`: una muestra de la biblioteca propia (`taller3d:biblioteca-propia:v1`: estructura, conjunto,
 *   decoración, utilería y una escena con mesa paramétrica, sillas y fondos), la escena del taller guardada en el navegador
 *   (`taller3d:escena:v1`, versión 2) y, si las hay, escenas del Taller de `ai_feedback` (`feedback-taller-*.json`);
 * y para cada escena:
 * - se lee como la lee el taller (`validarItem`, `leerGuardada`) y se arma igual que la foto `armado.json` (cajas y cantidades);
 * - cada `mueble.id` se resuelve en el registro a la misma entrada en su forma corta y en la calificada, y una escena que llega
 *   al servidor con los ids calificados (`EscenaSchema`) queda guardada igual que con los cortos (SPEC §5.2: se guarda el corto),
 *   y los ids cortos pasan por `EscenaSchema` sin cambiar;
 * - cada pieza es de Sempertex o de un repositorio que Sempertex declara en `depende`; lo propio es del de su contenido.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-catalogo-compatibilidad.ts
 *      ... --escribir   reescribe `armado.json` (solo si el cambio de forma de lo guardado es lo que se quería)
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { calificar, repositorioDeItem, repositorioDePieza } from "../../src/lib/catalogo/indice";
import { MANIFIESTOS } from "../../src/lib/catalogo/manifiestos";
import { resolverEntrada } from "../../src/lib/catalogo/registro";
import { leerGuardada } from "../../src/components/tres-d/guardado-escena";
import { BIBLIOTECA_FABRICA, escenaDeItem, validarItem } from "../../src/lib/globos3d/biblioteca";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { armarEscena, type Escena } from "../../src/lib/globos3d/escena";
import { ESCENAS_PREDEFINIDAS } from "../../src/lib/globos3d/escenas-presets";
import { EscenaSchema } from "../../src/lib/globos3d/esquema-escena";
import { REFERENCIAS_DUENO } from "../../src/lib/globos3d/referencias-dueno";

const CARPETA = new URL("./fixtures/escenas-guardadas/", import.meta.url);
const RUTA_FOTO = new URL("armado.json", CARPETA);
const leer = (archivo: string): string => readFileSync(new URL(archivo, CARPETA), "utf8");

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

/** Lo que el taller lee de su localStorage, con un `window` de mentira que devuelve el texto guardado. */
function conLocalStorage<T>(valores: Record<string, string>, fn: () => T): T {
  const global = globalThis as { window?: unknown };
  const antes = global.window;
  global.window = { localStorage: { getItem: (clave: string) => valores[clave] ?? null } };
  try { return fn(); } finally { global.window = antes; }
}

const propios = (JSON.parse(leer("items-propios.json")) as unknown[]).map(validarItem);
const guardada = conLocalStorage({ "taller3d:escena:v1": leer("escena-guardada.json") }, leerGuardada);
const feedback = readdirSync(CARPETA).filter((f) => /^feedback-taller-\d+\.json$/.test(f)).sort();

/** Las escenas guardadas del corpus que tienen foto propia en `armado.json` (las de fábrica las vigila la prueba dorada). */
function escenasGuardadas(): Array<[string, Escena]> {
  const salida: Array<[string, Escena]> = [];
  for (const item of propios) if (item?.contenido.tipo === "escena") salida.push([item.id, item.contenido.escena]);
  if (guardada) salida.push(["taller3d:escena:v1", guardada.escena]);
  for (const archivo of feedback) salida.push([archivo, JSON.parse(leer(archivo)) as Escena]);
  return salida;
}

prueba("lo guardado en el navegador se lee como lo lee el taller", () => {
  assert.ok(propios.every((i) => i !== null), "un item propio ya no pasa validarItem");
  assert.deepEqual(propios.map((i) => i!.tipo).sort(), ["conjunto", "decoracion", "escena", "estructura", "utileria"]);
  assert.ok(guardada, "la escena guardada ya no pasa leerGuardada");
});

type Foto = readonly number[];
const r1 = (n: number) => Math.round(n * 10) / 10 + 0;
function fotografiar(): Record<string, Record<string, Foto>> {
  return Object.fromEntries(escenasGuardadas().map(([id, escena]) => [id, Object.fromEntries(armarEscena(escena).porNodo.map((n) =>
    [n.id, [r1(n.caja.min.x), r1(n.caja.min.y), r1(n.caja.min.z), r1(n.caja.max.x), r1(n.caja.max.y), r1(n.caja.max.z), n.globos.length, n.tubos.length, n.solidos.length, n.copias]]))]));
}

prueba("lo guardado se arma igual que en la foto", () => {
  const actual = fotografiar();
  if (process.argv.includes("--escribir")) { writeFileSync(RUTA_FOTO, `${JSON.stringify(actual, null, 1)}\n`); console.log("    foto escrita"); return; }
  assert.deepEqual(actual, JSON.parse(readFileSync(RUTA_FOTO, "utf8")));
});

function corpus(): Array<[string, Escena]> {
  const escenas: Array<[string, Escena]> = BIBLIOTECA_FABRICA.filter((i) => i.contenido.tipo === "escena" || i.contenido.tipo === "conjunto").map((i) => [i.id, escenaDeItem(i)]);
  for (const p of ESCENAS_PREDEFINIDAS) escenas.push([`preset:${p.id}`, p.escena]);
  for (const r of REFERENCIAS_DUENO) escenas.push([`lectura:${r.id}`, compilarLectura(r.lectura).escena]);
  return [...escenas, ...escenasGuardadas()];
}

const idsDeMuebles = (escena: Escena): string[] => escena.nodos.flatMap((n) => (n.pieza.tipo === "escenografia" && n.pieza.mueble ? [n.pieza.mueble.id] : []));

/** La escena con cada `mueble.id` en su forma calificada. */
const conIdsCalificados = (escena: Escena): Escena => ({
  ...escena,
  nodos: escena.nodos.map((n) => (n.pieza.tipo === "escenografia" && n.pieza.mueble ? { ...n, pieza: { ...n.pieza, mueble: { ...n.pieza.mueble, id: calificar(n.pieza.mueble.id)! } } } : n)),
});

prueba("cada mueble.id se resuelve igual en sus dos formas y la escena que llega calificada se guarda con los cortos", () => {
  const ids = new Set<string>();
  let piezas = 0, validadas = 0;
  for (const [escenaId, escena] of corpus()) {
    for (const nodo of escena.nodos) {
      const p = nodo.pieza;
      if (p.tipo !== "escenografia" || !p.mueble) continue;
      piezas += 1;
      ids.add(p.mueble.id);
      const calificado = calificar(p.mueble.id);
      assert.ok(calificado, `${escenaId}/${nodo.id}: «${p.mueble.id}» no lo reclama ningún repositorio`);
      const entrada = resolverEntrada(p.mueble.id);
      assert.ok(entrada && entrada === resolverEntrada(calificado), `${escenaId}/${nodo.id}: ${p.mueble.id}`);
    }
    const corta = EscenaSchema.safeParse(escena);
    if (!corta.success) continue;
    validadas += 1;
    assert.deepEqual(idsDeMuebles(corta.data), idsDeMuebles(escena), `${escenaId}: EscenaSchema cambió un mueble.id corto`);
    assert.deepEqual(EscenaSchema.parse(conIdsCalificados(escena)), corta.data, `${escenaId}: la escena calificada no se guarda como la corta`);
  }
  console.log(`    ${piezas} piezas del catálogo, ${ids.size} ids distintos; ${validadas} escenas pasan EscenaSchema`);
  assert.ok(ids.has("mesa_param") && ids.has("sillas_param") && ids.has("silla_tiffany") && ids.has("panel_redondo"), "el corpus no es vacío");
  assert.ok(validadas >= escenasGuardadas().length, "las escenas guardadas pasan EscenaSchema");
});

prueba("cada pieza es de Sempertex o de lo que Sempertex declara en depende; lo propio, del de su contenido", () => {
  const permitidos = new Set(["sempertex", ...MANIFIESTOS.sempertex.depende]);
  for (const [escenaId, escena] of corpus()) for (const nodo of escena.nodos) {
    const r = repositorioDePieza(nodo.pieza);
    assert.ok(r && permitidos.has(r), `${escenaId}/${nodo.id}: ${r}`);
  }
  for (const item of propios) assert.equal(repositorioDeItem(item!), "sempertex", item!.id);
  assert.equal(resolverEntrada(propios[0]!.id), undefined, "lo propio no es una entrada del catálogo");
});

console.log(`test-catalogo-compatibilidad: ${pruebas} pruebas ok (${escenasGuardadas().length} escenas guardadas, ${feedback.length} de ai_feedback)`);
