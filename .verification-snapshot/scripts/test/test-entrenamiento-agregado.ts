/**
 * Arnés de entrenamiento (W4): agregado del leaderboard y clasificación de fallos. Puro, sin red ni coste:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-entrenamiento-agregado.ts
 */
import assert from "node:assert/strict";
import { agregarPorFoto, claseDominante, claveComparable, contarOmitidas, puntuacionMedia, type RegistroPasada } from "../entrenamiento/lib-agregado";
import { clasificarFallos, HECHOS_SIN_FALLOS } from "../entrenamiento/lib-fallos";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const base = (over: Partial<RegistroPasada>): RegistroPasada => ({
  foto: "images (25).jpg", modo: "seco", transporte: "seco", modelo: "claude-haiku-5-5", esfuerzo: "medium", pensamiento: true, commit: "abc1234", iniciadaEn: "2026-10-10T10:00:00.000Z", turnos: 0, turnosMax: 2, llamadas: 0, deteccionCacheada: false, convergio: false,
  puntajes: { proporciones: null, colores: null, zonas: null, iou: null },
  piezas: { leidas: 0, armadas: 0, omitidas: 0, globosFoto: 0, globosArmados: 0 },
  fallos: [], captura: "pendiente", costeUsd: 0, abortada: null, error: null, ...over,
});

prueba("la media ignora los puntajes que no se midieron (null no cuenta como cero)", () => {
  assert.equal(puntuacionMedia([0.8, null, 0.6]), 0.7);
  assert.equal(puntuacionMedia([null, null]), null);
  assert.equal(puntuacionMedia([]), null);
});

prueba("la clase dominante es la más repetida; en empate gana la primera del orden fijo", () => {
  assert.equal(claseDominante([]), "ninguno");
  assert.equal(claseDominante(["medida", "lectura", "medida"]), "medida");
  assert.equal(claseDominante(["visor", "lectura"]), "lectura");
});

prueba("una foto con varias corridas comparables da medias, la clase dominante y la última corrida", () => {
  const filas = agregarPorFoto([
    base({ iniciadaEn: "2026-10-10T10:00:00.000Z", puntajes: { proporciones: 0.5, colores: 1, zonas: null, iou: 0.4 }, fallos: ["medida"], costeUsd: 0.1 }),
    base({ iniciadaEn: "2026-10-11T10:00:00.000Z", turnos: 1, puntajes: { proporciones: 0.9, colores: null, zonas: 0.2, iou: 0.6 }, fallos: ["compilacion"], costeUsd: 0.25 }),
    base({ iniciadaEn: "2026-10-10T12:00:00.000Z", foto: "images (2).jpg", fallos: [] }),
  ]);
  assert.deepEqual(filas.map((f) => f.foto), ["images (2).jpg", "images (25).jpg"]);
  const f25 = filas[1]!;
  assert.equal(f25.corridas, 2);
  assert.equal(f25.puntajes.proporciones, 0.7);
  assert.equal(f25.puntajes.colores, 1);
  assert.equal(f25.puntajes.zonas, 0.2);
  assert.equal(f25.puntajes.iou, 0.5);
  assert.equal(f25.fallo, "medida");
  assert.deepEqual(f25.ultimaCorrida, { iniciadaEn: "2026-10-11T10:00:00.000Z", modo: "seco", transporte: "seco", modelo: "claude-haiku-5-5", esfuerzo: "medium", pensamiento: true, commit: "abc1234", turnos: 1, turnosMax: 2 });
  assert.equal(f25.costeUsd, 0.35);
  assert.equal(filas[0]!.fallo, "ninguno");
});

prueba("solo se promedian corridas comparables: otro modelo, transporte, esfuerzo, razonamiento, tope de vueltas o commit no se mezcla", () => {
  const conPuntaje = (proporciones: number, over: Partial<RegistroPasada> = {}) => base({ puntajes: { proporciones, colores: null, zonas: null, iou: null }, ...over });
  const filas = agregarPorFoto([
    conPuntaje(0.1, { iniciadaEn: "2026-10-10T09:00:00.000Z", modelo: "otro-modelo" }),
    conPuntaje(0.2, { iniciadaEn: "2026-10-10T09:10:00.000Z", transporte: "cli" }),
    conPuntaje(0.3, { iniciadaEn: "2026-10-10T09:20:00.000Z", turnosMax: 4 }),
    conPuntaje(0.4, { iniciadaEn: "2026-10-10T09:30:00.000Z", commit: "zzz9999" }),
    conPuntaje(0.45, { iniciadaEn: "2026-10-10T09:40:00.000Z", esfuerzo: "high" }),
    conPuntaje(0.5, { iniciadaEn: "2026-10-10T09:50:00.000Z", pensamiento: false }),
    conPuntaje(0.8, { iniciadaEn: "2026-10-10T10:00:00.000Z" }),
    conPuntaje(0.6, { iniciadaEn: "2026-10-10T11:00:00.000Z" }),
  ]);
  assert.equal(filas.length, 1);
  assert.equal(filas[0]!.corridas, 2, "solo las dos últimas miden lo mismo");
  assert.ok(Math.abs((filas[0]!.puntajes.proporciones ?? 0) - 0.7) < 1e-9);
  assert.equal(filas[0]!.ultimaCorrida.iniciadaEn, "2026-10-10T11:00:00.000Z");
  assert.notEqual(claveComparable(base({ modo: "real" })), claveComparable(base({ modo: "seco" })));
});

prueba("un commit con el árbol sucio no se agrupa con otras corridas del mismo hash", () => {
  const sucia = (iniciadaEn: string, proporciones: number) => base({ iniciadaEn, commit: "abc1234+dirty", puntajes: { proporciones, colores: null, zonas: null, iou: null } });
  const filas = agregarPorFoto([sucia("2026-10-10T10:00:00.000Z", 0.1), sucia("2026-10-10T11:00:00.000Z", 0.9)]);
  assert.equal(filas[0]!.corridas, 1);
  assert.equal(filas[0]!.puntajes.proporciones, 0.9);
});

prueba("las corridas abortadas y los errores del arnés sin clasificar no entran; un fallo clasificado del pipeline sí", () => {
  const registros = [
    base({ iniciadaEn: "2026-10-10T10:00:00.000Z", puntajes: { proporciones: 0.5, colores: null, zonas: null, iou: null } }),
    base({ iniciadaEn: "2026-10-10T11:00:00.000Z", abortada: "Tope de gasto de la pasada superado", puntajes: { proporciones: 0.9, colores: null, zonas: null, iou: null } }),
    base({ iniciadaEn: "2026-10-10T12:00:00.000Z", error: "TypeError inesperado", fallos: [] }),
    base({ iniciadaEn: "2026-10-10T13:00:00.000Z", foto: "images (30).jpg", abortada: "máximo de llamadas" }),
    base({ iniciadaEn: "2026-10-10T14:00:00.000Z", foto: "images (31).jpg", error: "La IA no pudo leer la foto", fallos: ["lectura"] }),
    base({ iniciadaEn: "2026-10-10T15:00:00.000Z", foto: "images (32).jpg", error: "El asistente respondió HTTP 500 en la vuelta 1.", fallos: ["agente"], puntajes: { proporciones: 0.3, colores: null, zonas: null, iou: null } }),
  ];
  const filas = agregarPorFoto(registros);
  assert.deepEqual(filas.map((f) => f.foto), ["images (25).jpg", "images (31).jpg", "images (32).jpg"], "una foto solo con corridas abortadas no tiene fila");
  assert.equal(filas[0]!.corridas, 1);
  assert.equal(filas[0]!.puntajes.proporciones, 0.5);
  assert.equal(filas[0]!.ultimaCorrida.iniciadaEn, "2026-10-10T10:00:00.000Z", "la última corrida válida, no la abortada");
  assert.equal(filas[1]!.fallo, "lectura", "la foto que no se pudo leer sale con su clase de fallo y sin puntajes");
  assert.equal(filas[1]!.puntajes.proporciones, null);
  assert.equal(filas[2]!.fallo, "agente");
  assert.equal(contarOmitidas(registros), 3);
});

prueba("la clasificación nombra cada etapa rota una sola vez y en orden", () => {
  assert.deepEqual(clasificarFallos(HECHOS_SIN_FALLOS), []);
  assert.deepEqual(clasificarFallos({ ...HECHOS_SIN_FALLOS, errorLectura: true, piezasDescartadas: 2 }), ["lectura"]);
  assert.deepEqual(clasificarFallos({ ...HECHOS_SIN_FALLOS, sinDeteccion: true, errorMedida: true }), ["medida"]);
  assert.deepEqual(clasificarFallos({ ...HECHOS_SIN_FALLOS, erroresAgente: 1 }), ["agente"]);
  assert.deepEqual(clasificarFallos({ ...HECHOS_SIN_FALLOS, omitidasCompilacion: 3 }), ["compilacion"]);
  assert.deepEqual(clasificarFallos({ ...HECHOS_SIN_FALLOS, escenaVacia: true }), ["escena_vacia"]);
  assert.deepEqual(clasificarFallos({ ...HECHOS_SIN_FALLOS, piezasOtro: 1 }), ["capacidad_faltante"]);
  assert.deepEqual(clasificarFallos({ ...HECHOS_SIN_FALLOS, capturaFallida: true, sinDeteccion: true, piezasOtro: 2, errorLectura: true, erroresAgente: 1 }), ["lectura", "medida", "capacidad_faltante", "visor", "agente"]);
});

prueba("la medida con todos los globos y la de solo los visibles no se promedian entre sí", () => {
  assert.notEqual(claveComparable(base({ metrica: "visibles" })), claveComparable(base({ metrica: "todos" })));
  assert.equal(claveComparable(base({})), claveComparable(base({ metrica: "todos" })), "un registro sin etiqueta es de la medida de antes");
  const filas = agregarPorFoto([
    base({ iniciadaEn: "2026-10-10T10:00:00.000Z", puntajes: { proporciones: 0.4, colores: null, zonas: null, iou: null } }),
    base({ iniciadaEn: "2026-10-11T10:00:00.000Z", metrica: "visibles", puntajes: { proporciones: 0.8, colores: null, zonas: null, iou: null } }),
  ]);
  assert.equal(filas[0]!.corridas, 1);
  assert.equal(filas[0]!.puntajes.proporciones, 0.8, "la fila es solo de las corridas de la medida de la última");
});

console.log(`\n${pruebas} pruebas del agregado del arnés: OK`);
