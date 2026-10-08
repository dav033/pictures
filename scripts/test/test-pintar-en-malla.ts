/**
 * pintar_en_malla (2026-10-08): una letra, un número o una figura pintado DENTRO de una pared de globos, sin modelo y
 * sin coste:
 *   npx tsx scripts/test/test-pintar-en-malla.ts
 * - en la pared de trenzas, la malla de Link-O-Loon y el mural: solo cambian de color los globos del dibujo, el total
 *   y los demás colores no se tocan, y las uniones R-5 de la malla se quedan como estaban;
 * - el dibujo sale donde se pide (centro por porcentaje) y con la forma (la W no es un rectángulo);
 * - quitar borra el dibujo; se pueden poner dos; errores claros (no es una pared, falta color, dibujo diminuto);
 * - la IA lo conoce: herramienta declarada y regla en el prompt.
 */
import assert from "node:assert/strict";
import { DECLARACIONES_ESCENA, aplicarHerramienta, type ResultadoHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { SALA_INICIAL, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { REGLAS_AGENTE } from "../../src/lib/globos3d/escena-ia-agente";
import { armarPieza } from "../../src/lib/globos3d/piezas";
import { centroDe } from "../../src/lib/globos3d/letras";
import { inventarioDe } from "../../src/lib/globos3d/partes-globos";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { coloresDelFormato } from "../../src/lib/globos3d/formatos";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const ok = (r: ResultadoHerramienta): Extract<ResultadoHerramienta, { ok: true }> => { if (!r.ok) assert.fail(`se esperaba éxito: ${r.error}`); return r; };
const error = (r: ResultadoHerramienta, re: RegExp) => { if (r.ok) assert.fail(`se esperaba error: ${r.resumen}`); assert.match(r.error, re); };
const nodo = (e: Escena, id: string): NodoEscena => e.nodos.find((n) => n.id === id) ?? assert.fail(`falta ${id}`);
const vacia: Escena = { sala: structuredClone(SALA_INICIAL), nodos: [] };
const conPared = (tipo: string, extra: Record<string, unknown> = {}) => ok(aplicarHerramienta(vacia, "agregar_pieza", { tipo, ancho_cm: 450, alto_cm: 260, ...extra })).escena;

const cuenta = (e: Escena, id: string, codigo: string) => armarPieza(nodo(e, id).pieza).globos.filter((g) => g.codigo === codigo).length;
const globos = (e: Escena, id: string) => armarPieza(nodo(e, id).pieza).globos;

console.log("Pared de trenzas");
const trenzas = conPared("pared_trenzas", { colores: ["amarillo", "azul", "rojo"] });
const idT = "pared-trenzas";
const conW = ok(aplicarHerramienta(trenzas, "pintar_en_malla", { id: idT, texto: "W", color: "negro" }));
prueba("pinta la W: cambian solo los globos del dibujo y el total no cambia", () => {
  const antes = globos(trenzas, idT), despues = globos(conW.escena, idT);
  assert.equal(despues.length, antes.length);
  const negros = cuenta(conW.escena, idT, "080");
  assert.ok(negros >= 20 && negros < antes.length * 0.4, `${negros} negros de ${antes.length}`);
  const cambiados = despues.filter((g, i) => g.codigo !== antes[i]!.codigo);
  assert.equal(cambiados.length, negros, "todo lo que cambió es negro");
  assert.ok(despues.some((g) => g.codigo === "020" || g.codigo === "040" || g.codigo === "015"), "el resto de la pared sigue con sus colores");
  assert.match(conW.resumen, /Pinté «W».*de \d+ globos.*Fashion Negro/);
});
prueba("la W tiene la forma de una W: lo pintado de arriba está en los extremos y el medio de arriba tiene hueco", () => {
  const negros = globos(conW.escena, idT).filter((g) => g.codigo === "080").map(centroDe);
  const xs = negros.map((c) => c.x), ys = negros.map((c) => c.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const medioX = (x0 + x1) / 2, arriba = y1 - (y1 - y0) * 0.15;
  const arribaNegros = negros.filter((c) => c.y >= arriba);
  assert.ok(arribaNegros.some((c) => c.x < x0 + (x1 - x0) * 0.25) && arribaNegros.some((c) => c.x > x1 - (x1 - x0) * 0.25), "las dos puntas de arriba");
  assert.ok(!arribaNegros.some((c) => Math.abs(c.x - medioX) < (x1 - x0) * 0.1), "no hay trazo en el medio de arriba");
});
prueba("el centro se pide por porcentaje: arriba a la derecha queda arriba a la derecha", () => {
  const e = ok(aplicarHerramienta(trenzas, "pintar_en_malla", { id: idT, texto: "5", color: "negro", alto_cm: 90, x_pct: 80, y_pct: 80 })).escena;
  const todos = globos(e, idT).map(centroDe), negros = globos(e, idT).filter((g) => g.codigo === "080").map(centroDe);
  const minX = Math.min(...todos.map((c) => c.x)), maxX = Math.max(...todos.map((c) => c.x)), minY = Math.min(...todos.map((c) => c.y)), maxY = Math.max(...todos.map((c) => c.y));
  const cx = negros.reduce((s, c) => s + c.x, 0) / negros.length, cy = negros.reduce((s, c) => s + c.y, 0) / negros.length;
  assert.ok((cx - minX) / (maxX - minX) > 0.65, `x ${(cx - minX) / (maxX - minX)}`);
  assert.ok((cy - minY) / (maxY - minY) > 0.65, `y ${(cy - minY) / (maxY - minY)}`);
});
prueba("quitar borra el dibujo y deja la pared como estaba; dos dibujos conviven", () => {
  const sin = ok(aplicarHerramienta(conW.escena, "pintar_en_malla", { id: idT, quitar: true })).escena;
  assert.deepEqual(armarPieza(nodo(sin, idT).pieza).globos.map((g) => g.codigo), armarPieza(nodo(trenzas, idT).pieza).globos.map((g) => g.codigo));
  assert.equal(nodo(sin, idT).pieza.repintes, undefined);
  const dos = ok(aplicarHerramienta(conW.escena, "pintar_en_malla", { id: idT, figura: "corazon", color: "rosado", alto_cm: 80, x_pct: 85, y_pct: 20 })).escena;
  assert.equal(nodo(dos, idT).pieza.repintes?.length, 2);
  assert.ok(cuenta(dos, idT, "080") >= 20, "la W sigue");
  assert.match(ok(aplicarHerramienta(trenzas, "pintar_en_malla", { id: idT, quitar: true })).resumen, /no tenía ningún dibujo/);
});

console.log("Malla de Link-O-Loon");
const malla = conPared("pared_malla");
const idM = "pared-malla";
prueba("las uniones R-5 no se pintan: solo los eslabones de la malla", () => {
  const antes = inventarioDe(armarPieza(nodo(malla, idM).pieza)).filter((l) => l.parte === "union");
  const e = ok(aplicarHerramienta(malla, "pintar_en_malla", { id: idM, figura: "corazon", color: "rojo", alto_cm: 200 })).escena;
  const despues = inventarioDe(armarPieza(nodo(e, idM).pieza));
  assert.deepEqual(despues.filter((l) => l.parte === "union"), antes, "las uniones quedan igual");
  const rojos = despues.filter((l) => l.parte === "malla" && l.codigo === "015").reduce((s, l) => s + l.cantidad, 0);
  assert.ok(rojos >= 12, `${rojos} eslabones rojos`);
  assert.equal(armarPieza(nodo(e, idM).pieza).globos.length, armarPieza(nodo(malla, idM).pieza).globos.length);
});
prueba("un color que no viene en ese formato: el más parecido y la nota (no el blanco)", () => {
  const r = ok(aplicarHerramienta(malla, "pintar_en_malla", { id: idM, texto: "A", color: "dorado reflex", alto_cm: 220 }));
  const nuevos = globos(r.escena, idM).filter((g, i) => g.codigo !== globos(malla, idM)[i]!.codigo);
  assert.ok(nuevos.length >= 8, `${nuevos.length} globos pintados`);
  assert.ok(nuevos.every((g) => coloresDelFormato(g.formatoId).some((c) => c.codigo === g.codigo)), "el color se fabrica en ese formato");
  assert.ok(nuevos.every((g) => g.codigo !== "005"), "no es el blanco de rescate");
  assert.match(r.resumen, /Pinté «A»/);
});

console.log("Mural");
prueba("también en un mural (la imagen de sus celdas)", () => {
  const e = conPared("mural");
  const id = e.nodos[0]!.id;
  const r = ok(aplicarHerramienta(e, "pintar_en_malla", { id, texto: "O", color: "negro" }));
  assert.ok(globos(r.escena, id).some((g) => g.codigo === "080"));
  assert.equal(globos(r.escena, id).length, globos(e, id).length);
});

console.log("Errores y la IA");
prueba("errores claros", () => {
  error(aplicarHerramienta(trenzas, "pintar_en_malla", { id: "no-existe", texto: "W", color: "negro" }), /No hay ninguna pieza/);
  error(aplicarHerramienta(trenzas, "pintar_en_malla", { id: idT, color: "negro" }), /texto .* o figura/);
  error(aplicarHerramienta(trenzas, "pintar_en_malla", { id: idT, texto: "W", figura: "corazon", color: "negro" }), /texto .* o figura/);
  error(aplicarHerramienta(trenzas, "pintar_en_malla", { id: idT, texto: "W" }), /Falta color/);
  error(aplicarHerramienta(trenzas, "pintar_en_malla", { id: idT, texto: "W", color: "colorinexistente" }), /No encontré el color/);
  error(aplicarHerramienta(trenzas, "pintar_en_malla", { id: idT, texto: "W", color: "negro", alto_cm: 20 }), /muy chico/);
  const base = escenaPredefinida("arco_organico_columnas_guirnalda");
  error(aplicarHerramienta(base, "pintar_en_malla", { id: "arco", texto: "W", color: "negro" }), /pintar_en_malla es para paredes de globos/);
});
prueba("ninguna llamada muta la escena que recibe", () => {
  const antes = JSON.stringify(trenzas);
  ok(aplicarHerramienta(trenzas, "pintar_en_malla", { id: idT, texto: "W", color: "negro" }));
  assert.equal(JSON.stringify(trenzas), antes);
});
prueba("pintar_en_malla declarada y la regla en el prompt", () => {
  assert.ok(DECLARACIONES_ESCENA.some((d) => d.name === "pintar_en_malla"));
  assert.match(REGLAS_AGENTE, /pintar_en_malla/);
  assert.match(REGLAS_AGENTE, /AVISO DE COLOR/);
});

console.log(`\n${pruebas} pruebas OK`);
