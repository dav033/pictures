/**
 * Qué cambió entre dos escenas (D-021), sin red ni modelo:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-diff-escenas.ts
 * - sumadas, quitadas y cambiadas por id; campo a campo (medida, color, sitio, formato) con antes → después;
 * - totales de globos; las líneas de la tarjeta; lo que se resalta en el visor; escenas iguales → diff vacío.
 */
import assert from "node:assert/strict";
import { coloresTexto, deltaGlobos, diffEscenas, diffVacio, idsParaResaltar, lineasDeDiff, medidaTexto, sonIguales, textoGlobos } from "../../src/lib/globos3d/diff-escenas";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import type { Escena, NodoEscena } from "../../src/lib/globos3d/escena";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const base = escenaPredefinida("arco_organico_columnas_guirnalda");
const conNodo = (e: Escena, id: string, cambio: (n: NodoEscena) => NodoEscena): Escena => ({ ...e, nodos: e.nodos.map((n) => (n.id === id ? cambio(n) : n)) });

console.log("Diff por id");
prueba("la misma escena (aunque sea otra copia) no cambia nada", () => {
  const d = diffEscenas(base, structuredClone(base));
  assert.ok(diffVacio(d));
  assert.equal(d.globosAntes, d.globosDespues);
  assert.equal(lineasDeDiff(d).length, 0);
});

prueba("columna más alta y de otro color: dos campos con antes → después, y +globos", () => {
  const despues = conNodo(base, "columna-izq", (n) => n.pieza.tipo === "columna" ? { ...n, pieza: { ...n.pieza, alturaCm: 220, colores: ["570"] } } : n);
  const d = diffEscenas(base, despues);
  assert.equal(d.nodos.length, 1);
  const c = d.nodos[0]!;
  assert.equal(c.tipo, "cambiada");
  assert.equal(c.id, "columna-izq");
  const alto = c.campos.find((x) => x.etiqueta === "alto");
  assert.deepEqual(alto && [alto.clase, alto.antes, alto.despues], ["medida", "1,8 m", "2,2 m"]);
  const color = c.campos.find((x) => x.etiqueta === "colores");
  assert.deepEqual(color && [color.clase, color.antes, color.despues], ["color", "609, 005, 570, 010", "570"]);
  assert.ok(c.globosDespues > c.globosAntes);
  assert.equal(deltaGlobos(d), c.globosDespues - c.globosAntes);
  assert.equal(c.antes?.id, "columna-izq");
  assert.equal(c.despues?.id, "columna-izq");
});

prueba("pieza nueva y pieza quitada: con sus globos, el índice de antes y sus piezas completas", () => {
  const sin = { ...base, nodos: base.nodos.filter((n) => n.id !== "guirnalda") };
  const quitar = diffEscenas(base, sin);
  assert.equal(quitar.nodos.length, 1);
  assert.equal(quitar.nodos[0]!.tipo, "quitada");
  assert.equal(quitar.nodos[0]!.indice, base.nodos.findIndex((n) => n.id === "guirnalda"));
  assert.ok(quitar.nodos[0]!.globosAntes > 0 && quitar.nodos[0]!.globosDespues === 0);
  assert.ok(quitar.globosDespues < quitar.globosAntes);
  const sumar = diffEscenas(sin, base);
  assert.equal(sumar.nodos[0]!.tipo, "nueva");
  assert.equal(sumar.nodos[0]!.antes, null);
  assert.equal(sumar.nodos.length, 1);
  assert.equal(textoGlobos(deltaGlobos(sumar)).startsWith("+"), true);
});

prueba("el sitio: moverla es «sitio», cambiar de pared a piso es «lugar»", () => {
  const movida = conNodo(base, "columna-der", (n) => n.colocacion.en === "piso" ? { ...n, colocacion: { ...n.colocacion, xCm: 200 } } : n);
  const c = diffEscenas(base, movida).nodos[0]!;
  assert.deepEqual(c.campos.map((x) => [x.clase, x.etiqueta, x.antes, x.despues]), [["sitio", "x", "2,25 m", "2 m"]]);
  const alPiso = conNodo(base, "guirnalda", (n) => ({ ...n, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }));
  assert.deepEqual(diffEscenas(base, alPiso).nodos[0]!.campos.map((x) => [x.etiqueta, x.antes, x.despues]), [["lugar", "pared", "piso"]]);
});

prueba("herramientas reales: ajustar_tamanos del arco cambia sus globos (en los totales, no en una línea por formato)", () => {
  const r = aplicarHerramienta(base, "ajustar_tamanos", { id: "arco", cambios: [{ formato: "R-24", accion: "mas" }] });
  if (!r.ok) assert.fail(r.error);
  const d = diffEscenas(base, r.escena);
  const c = d.nodos.find((x) => x.id === "arco");
  assert.ok(c, "el arco cambió");
  assert.ok(c.globosDespues !== c.globosAntes && deltaGlobos(d) === c.globosDespues - c.globosAntes);
  assert.ok(!lineasDeDiff(d).some((l) => /R-\d+: \d+ → \d+/.test(l.detalle)), "los conteos por formato no se repiten en la línea");
});

prueba("la sala también cuenta, y el nombre", () => {
  const sala = { ...base, sala: { ...base.sala, anchoCm: 700 } };
  const d = diffEscenas(base, sala);
  assert.equal(d.nodos.length, 0);
  assert.deepEqual(d.sala?.campos.map((x) => [x.etiqueta, x.antes, x.despues]), [["ancho", "6 m", "7 m"]]);
  const nombre = conNodo(base, "arco", (n) => ({ ...n, nombre: "Arco grande" }));
  assert.deepEqual(diffEscenas(base, nombre).nodos[0]!.campos.map((x) => [x.etiqueta, x.antes, x.despues]), [["nombre", "Arco orgánico", "Arco grande"]]);
});

console.log("Líneas y resalte");
prueba("las líneas de la tarjeta: +, − y ~ con su detalle; lo cambiado largo se resume", () => {
  const sin = { ...base, nodos: base.nodos.filter((n) => n.id !== "guirnalda") };
  const alto = conNodo(sin, "columna-izq", (n) => n.pieza.tipo === "columna" ? { ...n, pieza: { ...n.pieza, alturaCm: 220 } } : n);
  const lineas = lineasDeDiff(diffEscenas(base, alto));
  assert.equal(lineas.find((l) => l.id === "guirnalda")?.signo, "−");
  const col = lineas.filter((l) => l.id === "columna-izq");
  assert.ok(col.every((l) => l.signo === "~" && l.titulo === "Columna izquierda"));
  assert.equal(col.length, 1, "una sola línea por pieza");
  assert.equal(col[0]!.detalle, "alto 1,8 m → 2,2 m");
});

prueba("una línea por pieza, en palabras de decorador: medida, colores con su nombre y «movida»", () => {
  const cambiada = conNodo(base, "columna-izq", (n) => n.pieza.tipo === "columna" && n.colocacion.en === "piso"
    ? { ...n, pieza: { ...n.pieza, alturaCm: 220, colores: ["570"] }, colocacion: { ...n.colocacion, xCm: -200 } } : n);
  const lineas = lineasDeDiff(diffEscenas(base, cambiada));
  assert.equal(lineas.length, 1);
  assert.equal(lineas[0]!.titulo, "Columna izquierda");
  const partes = lineas[0]!.detalle.split(" · ");
  assert.equal(partes.length, 3);
  assert.equal(partes[0], "alto 1,8 m → 2,2 m");
  assert.equal(partes[1], "Rosado/Blanco/Dorado +1 → Dorado 570", "colores con nombre y, si es uno, su código");
  assert.equal(partes[2], "movida");
  assert.equal(coloresTexto("609, 609"), "Rosado 609");
  assert.equal(coloresTexto("999"), "999");
});

prueba("el visor resalta lo nuevo y lo cambiado, no lo quitado", () => {
  const sin = { ...base, nodos: base.nodos.filter((n) => n.id !== "guirnalda") };
  const cambio = conNodo(sin, "arco", (n) => ({ ...n, nombre: "X" }));
  assert.deepEqual(idsParaResaltar(diffEscenas(base, cambio)), [{ id: "arco", nueva: false }]);
  assert.deepEqual(idsParaResaltar(diffEscenas(sin, base)), [{ id: "guirnalda", nueva: true }]);
});

console.log("Utilidades");
prueba("medidas, globos y comparación estable", () => {
  assert.equal(medidaTexto(35), "35 cm");
  assert.equal(medidaTexto(180), "1,8 m");
  assert.equal(textoGlobos(0), "mismos globos");
  assert.equal(textoGlobos(-1), "−1 globo");
  assert.ok(sonIguales({ a: 1, b: { c: 2, d: undefined } }, { b: { c: 2 }, a: 1 }));
  assert.ok(!sonIguales({ a: 1 }, { a: 2 }));
});

console.log(`\n${pruebas} pruebas OK`);
