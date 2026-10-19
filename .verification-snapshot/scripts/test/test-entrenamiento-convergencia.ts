/**
 * Convergencia del refino (`lib-convergencia.ts`). Puras, sin red.
 *   npx tsx --conditions=react-server scripts/test/test-entrenamiento-convergencia.ts
 */
import assert from "node:assert/strict";
import type { Escena } from "../../src/lib/globos3d/escena";
import { evaluarTurno, MEJORA_MINIMA } from "../entrenamiento/lib-convergencia";
import { refinarEscena, type RespuestaTurno } from "../entrenamiento/lib-refino";
import type { PuntuacionEscena } from "../entrenamiento/lib-puntuacion";

let pruebas = 0;
const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

async function main(): Promise<void> {
console.log("Convergencia");
await prueba("un turno que solo mira (ver_escena) no converge ni para la pasada", () => {
  assert.deepEqual(evaluarTurno([{ soloConsulta: true, proporciones: 0.4 }], 0.4), { seguir: true });
});
await prueba("dos turnos seguidos que solo miran paran sin convergencia", () => {
  const v = evaluarTurno([{ soloConsulta: true, proporciones: 0.4 }, { soloConsulta: true, proporciones: 0.4 }], 0.4);
  assert.deepEqual(v, { seguir: false, convergio: false, motivo: "solo_consulta" });
});
await prueba("un turno con ediciones que mejora sigue; si no mejora llega a la meseta y converge", () => {
  assert.deepEqual(evaluarTurno([{ soloConsulta: false, proporciones: 0.5 }], 0.4), { seguir: true });
  const meseta = evaluarTurno([{ soloConsulta: false, proporciones: 0.5 }, { soloConsulta: false, proporciones: 0.5 + MEJORA_MINIMA / 2 }], 0.4);
  assert.deepEqual(meseta, { seguir: false, convergio: true, motivo: "sin_mejora" });
  assert.equal(evaluarTurno([{ soloConsulta: false, proporciones: 0.3 }], 0.4).seguir, false, "empeorar para (regresión)");
});
await prueba("un turno de consulta entre dos de edición no reinicia la comparación; sin puntaje no se para", () => {
  assert.deepEqual(evaluarTurno([{ soloConsulta: false, proporciones: 0.5 }, { soloConsulta: true, proporciones: 0.5 }], 0.4), { seguir: true });
  assert.deepEqual(evaluarTurno([{ soloConsulta: false, proporciones: null }], null), { seguir: true });
});

await prueba("un asistente sin acciones converge ya en el primer turno; una regresión no converge", () => {
  assert.deepEqual(evaluarTurno([{ soloConsulta: true, sinAcciones: true, proporciones: 0.4 }], 0.4), { seguir: false, convergio: true, motivo: "sin_acciones" });
  assert.deepEqual(evaluarTurno([{ soloConsulta: false, proporciones: 0.3 }], 0.4), { seguir: false, convergio: false, motivo: "regresion" });
});

console.log("Refino con un asistente falso (turnos >= 2)");
const escena = (n: number) => ({ marca: n }) as unknown as Escena;
const marca = (e: Escena) => (e as unknown as { marca: number }).marca;
const puntuacion = (proporciones: number): PuntuacionEscena => {
  const puntajes = { proporciones, colores: null, zonas: null, iou: null };
  return { puntajes, puntajesTodos: puntajes, piezas: { globosFoto: 1, globosArmados: 1, globosArmadosVisibles: 1 }, escenaVacia: false };
};
/** Un asistente que en cada vuelta devuelve la escena `n` y las acciones dadas; la puntuación de la escena `n` sale de `notas[n]`. */
const refino = (turnos: number, vueltas: Array<{ acciones: Array<{ consulta: boolean }> }>, notas: Record<number, number>) => {
  let llamadas = 0;
  const atender = async (): Promise<RespuestaTurno> => { const v = vueltas[llamadas]!; llamadas += 1; return { escena: escena(llamadas), respuesta: "ok", acciones: v.acciones }; };
  return refinarEscena({ escena: escena(0), turnos, mensaje: "m", historialInicial: [], margen: () => true, atender, puntuar: (e) => puntuacion(notas[marca(e)]!) }).then((r) => ({ r, llamadas }));
};
const edita = { acciones: [{ consulta: false }] }, mira = { acciones: [{ consulta: true }] }, nada = { acciones: [] };

await prueba("sin acciones en el turno 1 con 3 turnos de tope: una sola vuelta pagada y convergió", async () => {
  const { r, llamadas } = await refino(3, [nada, edita, edita], { 0: 0.5, 1: 0.5 });
  assert.equal(llamadas, 1);
  assert.deepEqual([r.turnosHechos, r.convergio, r.motivoParada], [1, true, "sin_acciones"]);
});
await prueba("solo mirar no converge: sigue; dos vueltas seguidas mirando paran sin convergencia", async () => {
  const { r, llamadas } = await refino(4, [mira, mira, edita, edita], { 0: 0.5, 1: 0.5, 2: 0.5 });
  assert.equal(llamadas, 2);
  assert.deepEqual([r.convergio, r.motivoParada], [false, "solo_consulta"]);
  const una = await refino(1, [mira], { 0: 0.5, 1: 0.5 });
  assert.deepEqual([una.r.convergio, una.r.motivoParada], [false, null], "con el tope en 1, mirar tampoco es convergencia");
});
await prueba("una regresión conserva la escena de la mejor vuelta y no cuenta como convergencia", async () => {
  const { r } = await refino(4, [edita, edita, edita], { 0: 0.4, 1: 0.6, 2: 0.45 });
  assert.equal(marca(r.escena), 1, "se queda con la vuelta 1");
  assert.deepEqual([r.turnoConservado, r.turnosHechos, r.convergio, r.motivoParada], [1, 2, false, "regresion"]);
  assert.deepEqual(r.puntajePorTurno.map((p) => p.turno), [0, 1, 2], "los puntajes de todas las vueltas quedan");
});
await prueba("si ninguna vuelta mejora la escena de la lectura, se conserva esa", async () => {
  const { r } = await refino(3, [edita, edita], { 0: 0.5, 1: 0.3 });
  assert.equal(marca(r.escena), 0);
  assert.equal(r.turnoConservado, 0);
});
await prueba("mejorar sigue hasta el tope; una meseta con ediciones converge", async () => {
  const sube = await refino(2, [edita, edita], { 0: 0.4, 1: 0.5, 2: 0.6 });
  assert.deepEqual([sube.r.turnosHechos, sube.r.convergio, sube.r.motivoParada, marca(sube.r.escena)], [2, false, null, 2]);
  const meseta = await refino(3, [edita, edita, edita], { 0: 0.4, 1: 0.5, 2: 0.502 });
  assert.deepEqual([meseta.r.turnosHechos, meseta.r.convergio, meseta.r.motivoParada], [2, true, "sin_mejora"]);
});

await prueba("un error del asistente en el turno 2 conserva la mejor escena y deja el motivo", async () => {
  let llamadas = 0;
  const r = await refinarEscena({
    escena: escena(0), turnos: 3, mensaje: "m", historialInicial: [], margen: () => true, puntuar: (e) => puntuacion({ 0: 0.4, 1: 0.6 }[marca(e)]!),
    atender: async () => { llamadas += 1; if (llamadas === 2) throw new Error("HTTP 500"); return { escena: escena(1), respuesta: "ok", acciones: [{ consulta: false }] }; },
  });
  assert.deepEqual([marca(r.escena), r.turnoConservado, r.turnosHechos, r.erroresAgente, r.error, r.convergio], [1, 1, 1, 1, "HTTP 500", false]);
});
await prueba("sin margen no llama al asistente y queda la escena de la lectura", async () => {
  let llamadas = 0;
  const r = await refinarEscena({ escena: escena(0), turnos: 3, mensaje: "m", historialInicial: [], margen: () => false, puntuar: () => puntuacion(0.4), atender: async () => { llamadas += 1; return { escena: escena(1), respuesta: "", acciones: [] }; } });
  assert.deepEqual([llamadas, r.turnosHechos, marca(r.escena), r.convergio], [0, 0, 0, false]);
});
await prueba("si no se puede puntuar, manda la última escena, no hay puntajes ni parada por puntaje", async () => {
  let llamadas = 0;
  const r = await refinarEscena({
    escena: escena(0), turnos: 2, mensaje: "m", historialInicial: [], margen: () => true, puntuar: () => null,
    atender: async () => { llamadas += 1; return { escena: escena(llamadas), respuesta: "ok", acciones: [{ consulta: false }] }; },
  });
  assert.deepEqual([r.turnosHechos, marca(r.escena), r.puntajePorTurno.length, r.motivoParada, r.convergio], [2, 2, 0, null, false]);
});

console.log(`test-entrenamiento-convergencia: ${pruebas} pruebas ok`);
}

main().catch((e) => { console.error(e); process.exit(1); });
