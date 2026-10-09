/**
 * Variedad de la decoración (REQ-008, pedido del dueño: «siempre que le pido una decoración va a la misma: un arco, dos columnas y la
 * misma guirnalda»). Por el camino de las herramientas, sin IA ni red:
 * - un banco de 8 pedidos (safari, Frozen, XV, graduación, Halloween, boda boho, bautizo, corporativo) da 8 composiciones distintas, ninguna
 *   es la plantilla de partida, todo queda dentro de la sala y el mismo pedido da siempre lo mismo;
 * - la plantilla de partida sin tocar se reemplaza (y se dice); una escena que el usuario ya trabajó se conserva;
 * - editar («agrega», «recolorea») sigue siendo CRUD: no rehace nada;
 * - el taller nuevo abre vacío y el prompt distingue editar de diseñar.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-decoracion-variedad.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armarEscena, SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { esPlantillaSinTocar, escenaPredefinida, ESCENAS_PREDEFINIDAS } from "../../src/lib/globos3d/escenas-presets";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { composicionDe } from "../../src/lib/globos3d/salon-composicion";
import { vivas } from "../../src/lib/globos3d/salon-registro";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const vacia = (): Escena => ({ sala: { ...SALA_INICIAL }, nodos: [] });
const herramienta = (escena: Escena, nombre: string, args: Record<string, unknown>) => {
  const r = aplicarHerramienta(escena, nombre, args);
  if (!r.ok) assert.fail(`${nombre} ${JSON.stringify(args)}: ${r.error}`);
  return r;
};

type Pedido = { etiqueta: string; args: Record<string, unknown> };
const BANCO: readonly Pedido[] = [
  { etiqueta: "baby shower safari", args: { tipo_evento: "baby_shower", tematica: "safari" } },
  { etiqueta: "cumpleaños Frozen", args: { tipo_evento: "cumpleanos", tematica: "Frozen", colores: ["azul", "plateado"] } },
  { etiqueta: "XV años rosa y dorado", args: { tipo_evento: "quince", colores: ["rosa", "dorado"] } },
  { etiqueta: "graduación azul", args: { tipo_evento: "graduacion", colores: ["azul"], texto: "2026" } },
  { etiqueta: "Halloween", args: { tipo_evento: "halloween" } },
  { etiqueta: "boda boho", args: { tipo_evento: "boda", tematica: "boho" } },
  { etiqueta: "bautizo", args: { tipo_evento: "bautizo", colores: ["blanco"] } },
  { etiqueta: "corporativo", args: { tipo_evento: "corporativo", colores: ["azul", "blanco"] } },
];

const decoracion = (args: Record<string, unknown>, base: Escena = vacia()) => herramienta(base, "planificar_evento", { alcance: "solo_decoracion", ...args });
/** Qué estructuras lleva: los nombres de sus piezas anotadas en el salón, sin el lado ni el número («Columna alta del fondo (izquierda)» = «Columna alta del fondo»). */
const firma = (e: Escena): string => [...new Set(vivas(e).filter((v) => v.info.rol === "adorno").map((v) => v.nodo.nombre.replace(/\s*\(.*\)$/, "").replace(/\s+(izquierdo|derecho)?\s*\d*$/, "")))].sort().join(" + ");

const resultados = BANCO.map((p) => ({ ...p, ...decoracion(p.args) }));

prueba("8 pedidos distintos dan 8 composiciones distintas (ni dos con el mismo conjunto de estructuras)", () => {
  for (const r of resultados) console.log(`    ${r.etiqueta}: ${firma(r.escena)}`);
  const firmas = resultados.map((r) => firma(r.escena));
  assert.equal(new Set(firmas).size, BANCO.length, `se repiten: ${firmas.join(" | ")}`);
});

prueba("ninguna reusa la plantilla de partida (ni sus piezas ni sus ids), y todo queda dentro de la sala", () => {
  const plantillas = ESCENAS_PREDEFINIDAS.flatMap((p) => p.escena.nodos);
  const piezas = new Set(plantillas.map((n) => JSON.stringify(n.pieza)));
  const ids = new Set(plantillas.map((n) => n.id));
  for (const r of resultados) {
    for (const n of r.escena.nodos) {
      assert.ok(!piezas.has(JSON.stringify(n.pieza)), `${r.etiqueta}: ${n.id} es una pieza de la plantilla`);
      assert.ok(!ids.has(n.id), `${r.etiqueta}: ${n.id} es un id de la plantilla`);
    }
    const sala = r.escena.sala;
    for (const n of armarEscena(r.escena).porNodo.filter((x) => x.copias > 0)) {
      assert.ok(n.caja.min.x >= -sala.anchoCm / 2 - 5 && n.caja.max.x <= sala.anchoCm / 2 + 5, `${r.etiqueta}: ${n.id} sale de la sala a lo ancho`);
      assert.ok(n.caja.min.z >= -sala.fondoCm / 2 - 5 && n.caja.max.z <= sala.fondoCm / 2 + 5, `${r.etiqueta}: ${n.id} sale de la sala a lo largo`);
      assert.ok(n.caja.max.y <= sala.altoCm + 1, `${r.etiqueta}: ${n.id} pasa el techo`);
    }
  }
});

prueba("el mismo pedido da siempre lo mismo, y cambiar el tema o los colores cambia el resultado", () => {
  for (const p of BANCO.slice(0, 3)) assert.deepEqual(decoracion(p.args).escena, decoracion(p.args).escena, p.etiqueta);
  const base = decoracion({ tipo_evento: "cumpleanos", tematica: "safari" }).escena;
  assert.notDeepEqual(base, decoracion({ tipo_evento: "cumpleanos", tematica: "princesas" }).escena);
  assert.notDeepEqual(base, decoracion({ tipo_evento: "cumpleanos", tematica: "safari", colores: ["rojo", "negro"] }).escena);
});

prueba("la temática manda sobre la ocasión: safari = palmeras, princesas = castillo, boho = guirnalda a lo ancho", () => {
  assert.match(firma(resultados[0]!.escena), /Palmera|Árbol/);
  assert.match(firma(decoracion({ tipo_evento: "cumpleanos", tematica: "princesas" }).escena), /Castillo/);
  assert.match(firma(resultados[5]!.escena), /Guirnalda orgánica a lo ancho/);
  assert.match(firma(resultados[4]!.escena), /Columna alta/);
  assert.ok(resultados[4]!.escena.nodos.some((n) => n.nombre === "Techo del fondo de fotos"), "Halloween lleva globos en el techo");
});

prueba("el mismo pedido sin tema: una boda sigue siendo el arco clásico; las demás ocasiones varían con el pedido", () => {
  assert.equal(composicionDe({ tipo: "boda" }).fondo, "arco_columnas");
  const fondos = new Set(["rojo", "azul", "rosa", "verde", "morado", "naranja", "amarillo", "negro"].map((c) => composicionDe({ tipo: "cumpleanos", colores: [c] }).fondo));
  assert.ok(fondos.size >= 3, `solo ${[...fondos].join(", ")}`);
});

prueba("la biblioteca aporta ideas reales a los pedidos con tema, como piezas editables", () => {
  const conIdeas = resultados.filter((r) => /Idea de la biblioteca/.test(r.resumen));
  console.log(`    con ideas de la biblioteca: ${conIdeas.map((r) => r.etiqueta).join(", ") || "ninguna"}`);
  assert.ok(conIdeas.length >= 2, "al menos dos pedidos traen ideas de la biblioteca");
  for (const r of conIdeas) {
    const ideas = vivas(r.escena).filter((v) => v.info.rol === "adorno" && !v.nodo.id.startsWith("salon-"));
    assert.ok(ideas.length >= 1 && ideas.length <= 12, `${r.etiqueta}: ${ideas.length} piezas de ideas`);
  }
});

prueba("la plantilla de partida sin tocar se reemplaza (y se dice); si el usuario la tocó, se conserva", () => {
  const plantilla = escenaPredefinida("arco_organico_columnas_guirnalda");
  assert.ok(esPlantillaSinTocar(plantilla));
  assert.ok(!esPlantillaSinTocar(vacia()));
  const r = decoracion({ tipo_evento: "cumpleanos", tematica: "safari" }, plantilla);
  for (const n of plantilla.nodos) assert.ok(!r.escena.nodos.some((x) => x.id === n.id), `sigue ${n.id} de la plantilla`);
  assert.match(r.resumen, /plantilla de partida sin tocar/);
  assert.ok(r.escena.nodos.length > 0);

  const tocada: Escena = { ...plantilla, nodos: plantilla.nodos.map((n, i) => (i === 0 && n.colocacion.en === "piso" ? { ...n, colocacion: { ...n.colocacion, xCm: n.colocacion.xCm + 30 } } : n)) };
  assert.ok(!esPlantillaSinTocar(tocada));
  const conservada = decoracion({ tipo_evento: "cumpleanos", tematica: "safari" }, tocada);
  for (const n of tocada.nodos) assert.deepEqual(conservada.escena.nodos.find((x) => x.id === n.id)?.pieza, n.pieza, `${n.id} se perdió`);
  assert.doesNotMatch(conservada.resumen, /plantilla de partida sin tocar/);
});

prueba("editar sigue siendo CRUD: agregar y recolorear no rehacen ni quitan nada de lo que había", () => {
  const plantilla = escenaPredefinida("arco_organico_columnas_guirnalda");
  const agregada = herramienta(plantilla, "agregar_pieza", { tipo: "columna_organica", colores: ["verde"], donde: { en: "piso", x_cm: 200, z_cm: 0 } }).escena;
  assert.equal(agregada.nodos.length, plantilla.nodos.length + 1);
  for (const n of plantilla.nodos) assert.deepEqual(agregada.nodos.find((x) => x.id === n.id)?.colocacion, n.colocacion);
  const coloreada = herramienta(plantilla, "recolorear_escena", { colores: ["rojo", "negro"] }).escena;
  assert.deepEqual(coloreada.nodos.map((n) => n.id), plantilla.nodos.map((n) => n.id));
});

prueba("el taller nuevo abre con la sala vacía (las plantillas siguen en «Empezar de una plantilla») y el prompt distingue editar de diseñar", () => {
  const taller = readFileSync(new URL("../../src/components/tres-d/Taller3D.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(taller, /useHistorialEscena\(\(\) => guardadaAlAbrir\?\.escena \?\? escenaPredefinida/);
  assert.match(taller, /guardadaAlAbrir\?\.escena \?\? \{ sala: structuredClone\(SALA_INICIAL\), nodos: \[\] \}/);
  assert.match(taller, /Empezar de una plantilla/);
  const ruta = readFileSync(new URL("../../src/app/api/escena-ia/route.ts", import.meta.url), "utf8");
  assert.match(ruta, /EDITAR/);
  assert.match(ruta, /DISEÑAR/);
  assert.match(ruta, /plantilla de partida sin tocar/);
  assert.match(ruta, /Nunca contestes «hazme una decoración» solo recoloreando/);
});

console.log(`\n${pruebas} pruebas pasaron`);
