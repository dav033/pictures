import assert from "node:assert/strict";
import test from "node:test";
import type { NodoArmado } from "./escena";
import type { TuboDecoracion } from "./decoraciones";
import type { GloboDePieza } from "./piezas";
import { agruparPiezas, etiquetaDeGrupo, filasPorPieza, textoPorPieza } from "./piezas-agrupadas";

const globo = (codigo = "640", formatoId = "R-12"): GloboDePieza => ({ tipo: "globo", formatoId, infladoCm: 30, codigo, nudo: { x: 0, y: 0, z: 0 }, direccion: { x: 0, y: 1, z: 0 }, cuelloExtraCm: 0 }) as unknown as GloboDePieza;
const tubo = (papel: string, largoCm = 100): TuboDecoracion => ({ formatoId: "T-1", grosorCm: 1, codigo: "640", cerrado: false, papel: { hex: papel }, puntos: [{ x: 0, y: 0, z: 0 }, { x: largoCm, y: 0, z: 0 }] }) as unknown as TuboDecoracion;
const pieza = (id: string, nombre: string, globos: GloboDePieza[], copias = 1, tubos: TuboDecoracion[] = []): NodoArmado =>
  ({ id, nombre, copias, globos, tubos, flores: [], solidos: [], anclas: [], materiales: [], avisos: [] }) as unknown as NodoArmado;

test("catorce piezas iguales con número en el nombre se cuentan como una: «Ojo con venas × 14»", () => {
  const piezas = Array.from({ length: 14 }, (_, i) => pieza(`n${i}`, `Ojo con venas ${i + 1}`, [globo()]));
  const grupos = agruparPiezas(piezas);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0]?.nombre, "Ojo con venas");
  assert.equal(grupos[0]?.piezas.length, 14);
  assert.equal(grupos[0]?.globos, 14);
  assert.equal(grupos[0]?.piezas[0]?.nombre, "Ojo con venas 1");
});

test("piezas con el mismo nombre genérico pero distinto contenido no se agrupan", () => {
  const grupos = agruparPiezas([pieza("a", "Ojo 1", [globo("640")]), pieza("b", "Ojo 2", [globo("005")]), pieza("c", "Ojo 3", [globo("640")])]);
  assert.deepEqual(grupos.map((g) => [g.nombre, g.piezas.length]), [["Ojo", 2], ["Ojo", 1]]);
});

test("una pieza sola conserva su nombre y las copias se suman por grupo", () => {
  const grupos = agruparPiezas([pieza("a", "Arco de la entrada", [globo()], 2), pieza("b", "Mesa 1", [globo()], 1), pieza("c", "Mesa 2", [globo()], 1)]);
  assert.equal(grupos[0]?.nombre, "Arco de la entrada");
  assert.equal(grupos[0]?.piezas.length, 1);
  assert.equal(grupos[1]?.nombre, "Mesa");
  assert.equal(grupos[1]?.copias, 2);
  assert.equal(grupos[1]?.piezas.length, 2);
});

test("el orden de los grupos sigue al de la primera pieza de cada uno", () => {
  const grupos = agruparPiezas([pieza("a", "Globo 1", [globo("640")]), pieza("b", "Estrella", [globo("005")]), pieza("c", "Globo 2", [globo("640")])]);
  assert.deepEqual(grupos.map((g) => g.nombre), ["Globo", "Estrella"]);
});

test("una burbuja de papel rojo y otra de papel dorado no se agrupan aunque se llamen igual", () => {
  const grupos = agruparPiezas([pieza("a", "Burbuja 1", [globo()], 1, [tubo("#ff0000")]), pieza("b", "Burbuja 2", [globo()], 1, [tubo("#d4af37")])]);
  assert.equal(grupos.length, 2);
  const mismas = agruparPiezas([pieza("a", "Burbuja 1", [globo()], 1, [tubo("#ff0000")]), pieza("b", "Burbuja 2", [globo()], 1, [tubo("#ff0000")])]);
  assert.equal(mismas.length, 1);
});

test("tubos de distinto largo no se agrupan", () => {
  const grupos = agruparPiezas([pieza("a", "Serpentina 1", [globo()], 1, [tubo("#fff", 100)]), pieza("b", "Serpentina 2", [globo()], 1, [tubo("#fff", 200)])]);
  assert.equal(grupos.length, 2);
});

test("un racimo de 1 copia con 6 globos y otro de 2 copias con 3 cada una no se agrupan", () => {
  const uno = pieza("a", "Racimo 1", Array.from({ length: 6 }, () => globo()), 1);
  const dos = pieza("b", "Racimo 2", Array.from({ length: 6 }, () => globo()), 2);
  assert.equal(agruparPiezas([uno, dos]).length, 2);
  const otroDos = pieza("c", "Racimo 3", Array.from({ length: 6 }, () => globo()), 2);
  assert.equal(agruparPiezas([dos, otroDos]).length, 1);
});

test("piezas no puestas (sin copias o sin globos) nunca se agrupan", () => {
  assert.equal(agruparPiezas([pieza("a", "Ojo 1", [globo()], 0), pieza("b", "Ojo 2", [globo()], 0)]).length, 2);
  assert.equal(agruparPiezas([pieza("a", "Ojo 1", [], 1), pieza("b", "Ojo 2", [], 1)]).length, 2);
});

test("si dos grupos comparten el nombre, la etiqueta dice color y tamaño", () => {
  const grupos = agruparPiezas([pieza("a", "Ojo 1", [globo("640", "R-12")]), pieza("b", "Ojo 2", [globo("005", "R-5")])]);
  const etiquetas = grupos.map(etiquetaDeGrupo);
  assert.ok(etiquetas[0]!.includes("R-12") && etiquetas[1]!.includes("R-5"), etiquetas.join(" | "));
  assert.notEqual(etiquetas[0], etiquetas[1]);
});

test("la lista de pantalla y el texto copiado salen de las mismas filas: cada pieza aparece por su nombre", () => {
  const piezas = [...Array.from({ length: 3 }, (_, i) => pieza(`n${i}`, `Ojo con venas ${i + 1}`, [globo()])), pieza("x", "Mesa", [globo("005")])];
  const filas = filasPorPieza(agruparPiezas(piezas));
  const texto = textoPorPieza(filas);
  assert.equal(filas[0]?.expandible, true);
  assert.equal(filas[0]?.etiqueta, "Ojo con venas × 3");
  assert.ok(texto.includes("Ojo con venas × 3 · 3 globos"));
  for (const p of piezas) assert.ok(texto.some((l) => l.includes(p.nombre)), `falta ${p.nombre} en el texto copiado`);
  for (const fila of filas) for (const p of fila.piezas) assert.ok(texto.some((l) => l.trim() === `${p.nombre} · ${p.cuenta}`), p.nombre);
});
