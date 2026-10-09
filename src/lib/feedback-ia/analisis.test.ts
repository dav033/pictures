import assert from "node:assert/strict";
import test from "node:test";
import { agregarFeedback, frasesFrecuentes, type FilaParaAnalisis } from "./analisis";

function fila(id: number, parcial: Partial<FilaParaAnalisis>): FilaParaAnalisis {
  return { id, turnoId: `t${id}`, producto: "taller", calificacion: null, motivos: [], comentario: null, pedido: null, herramientas: [], deshecho: false, ...parcial };
}

test("sin filas no inventa promedio ni métricas", () => {
  const vacio = agregarFeedback([]);
  assert.equal(vacio.totalTurnos, 0);
  assert.equal(vacio.promedio, null);
  assert.deepEqual(vacio.metricas, { porMotivo: [], porProducto: [], porHerramienta: [], deshechos: 0, frases: [], peores: [] });
});

test("cuenta motivos, producto y promedio solo con los turnos calificados", () => {
  const resultado = agregarFeedback([
    fila(1, { calificacion: 2, motivos: ["colores", "mal_colocado"], producto: "taller" }),
    fila(2, { calificacion: 4, motivos: ["colores"], producto: "cliente" }),
    fila(3, { calificacion: 9, producto: "taller" }),
    fila(4, { calificacion: null, motivos: ["lento"] }),
  ]);
  assert.equal(resultado.totalTurnos, 4);
  assert.equal(resultado.totalCalificados, 3);
  assert.equal(resultado.promedio, 5);
  assert.deepEqual(resultado.metricas.porMotivo, [
    { clave: "colores", total: 2, promedio: 3 },
    { clave: "mal_colocado", total: 1, promedio: 2 },
  ]);
  assert.deepEqual(resultado.metricas.porProducto, [
    { clave: "taller", total: 2, promedio: 5.5 },
    { clave: "cliente", total: 1, promedio: 4 },
  ]);
});

test("las herramientas se ordenan de la peor calificada a la mejor y cada turno cuenta una vez por herramienta", () => {
  const { metricas } = agregarFeedback([
    fila(1, { calificacion: 3, herramientas: ["colocar", "colocar", "pintar"] }),
    fila(2, { calificacion: 9, herramientas: ["pintar"] }),
  ]);
  assert.deepEqual(metricas.porHerramienta, [
    { clave: "colocar", total: 1, promedio: 3 },
    { clave: "pintar", total: 2, promedio: 6 },
  ]);
});

test("los peores ejemplos van de menor nota a mayor y prefieren los que traen comentario", () => {
  const { metricas } = agregarFeedback([
    fila(1, { calificacion: 1 }),
    fila(2, { calificacion: 1, comentario: "puso el arco al revés" }),
    fila(3, { calificacion: 6 }),
    fila(4, { calificacion: null }),
  ]);
  assert.deepEqual(metricas.peores.map((p) => p.id), [2, 1, 3]);
  assert.equal(metricas.deshechos, 0);
});

test("las frases frecuentes salen de comentarios repetidos y descartan palabras vacías y casos únicos", () => {
  const frases = frasesFrecuentes([
    "Los colores del arco salieron mal",
    "colores del arco incorrectos, además muy lento",
    "las columnas quedaron torcidas",
  ]);
  assert.deepEqual(frases.map((f) => f.frase), ["colores arco"]);
  assert.equal(frases[0].veces, 2);
});

test("los comentarios de turnos bien calificados no entran en las frases", () => {
  const { metricas } = agregarFeedback([
    fila(1, { calificacion: 9, comentario: "excelente trabajo globos" }),
    fila(2, { calificacion: 10, comentario: "excelente trabajo globos" }),
    fila(3, { calificacion: 2, comentario: "globos desalineados" }),
    fila(4, { calificacion: 3, comentario: "globos desalineados siempre" }),
  ]);
  assert.deepEqual(metricas.frases.map((f) => f.frase), ["globos desalineados"]);
  assert.equal(metricas.deshechos, 0);
});

test("cuenta los turnos deshechos", () => {
  assert.equal(agregarFeedback([fila(1, { deshecho: true }), fila(2, {}), fila(3, { deshecho: true })]).metricas.deshechos, 2);
});
