/**
 * Lista de compra: segundos de bomba y cm inflados (PRO-03). Sin coste; el almacén del taller es falso.
 * Cifras a mano: R-12 de referencia 25 cm = 2,0 s; a 50 cm, 2,0 × (50/25)³ = 16,0 s; R-9 a 18 cm = 1,5 s.
 * - el tiempo escala con el cubo del tamaño (no es lineal);
 * - el campo del taller acepta coma o punto, rechaza lo demás y conserva lo anterior (lo decide `parsearSegundos`);
 * - las filas se agrupan por formato y cm entero: la escena de 641 globos da pocas filas, no una por décima de cm;
 * - los helios no pasan por la bomba; el tiempo total es la suma globo a globo;
 * - los tubitos sí: cada uno entero (los que cuenta la lista), no sus tramos (el ramo de flores en Reflex: 67 tubitos, no 148 tramos).
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-bomba-segundos.ts
 */
import assert from "node:assert/strict";
import { BIBLIOTECA_FABRICA, escenaDeItem } from "../../src/lib/globos3d/biblioteca";
import { CLAVE_CALIBRACION_BOMBA, SEGUNDOS_BOMBA_DEFECTO, almacenDelNavegador, filasBomba, guardarCalibracionBomba, inflablesDeEscena, leerCalibracionBomba, lineasBomba, normalizarCalibracion, parsearSegundos, redondearSegundos, segundosParaTamano, textoFilaBomba, textoTiempo, tiempoTotalBomba } from "../../src/lib/globos3d/bomba-segundos";
import { FORMATOS_GLOBO } from "../../src/lib/globos3d/formatos";
import { armarEscena } from "../../src/lib/globos3d/escena";
import { esGloboDeHelio } from "../../src/lib/globos3d/helio-cinta";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const almacen = (crudo: string | null, lanza = false): Pick<Storage, "getItem"> => ({ getItem: () => { if (lanza) throw new Error("bloqueado"); return crudo; } });

console.log("Tiempo por tamaño");
prueba("cada formato del catálogo tiene un segundo de referencia", () => {
  for (const f of FORMATOS_GLOBO) assert.ok(SEGUNDOS_BOMBA_DEFECTO[f.id] !== undefined, f.id);
});
prueba("R-12 a su tamaño de decoración (25 cm) = 2,0 s", () => {
  assert.equal(segundosParaTamano("R-12", 25), 2);
});
prueba("R-12 a 50 cm = 2,0 × 2³ = 16,0 s (escala con el cubo, no lineal)", () => {
  assert.equal(segundosParaTamano("R-12", 50), 16);
});
prueba("R-9 a 18 cm (su referencia) = 1,5 s; a 9 cm = 1,5 / 8 = 0,1875 s", () => {
  assert.equal(segundosParaTamano("R-9", 18), 1.5);
  assert.ok(Math.abs(segundosParaTamano("R-9", 9)! - 0.1875) < 1e-9);
});
prueba("la calibración del taller cambia el tiempo de referencia: R-12 con 3,4 s a 25 cm = 3,4 s y a 50 cm = 27,2 s", () => {
  const cal = { "R-12": 3.4 };
  assert.equal(segundosParaTamano("R-12", 25, cal), 3.4);
  assert.ok(Math.abs(segundosParaTamano("R-12", 50, cal)! - 27.2) < 1e-9);
});
prueba("el redondeo es a 0,1 s", () => {
  assert.equal(redondearSegundos(2.04), 2);
  assert.equal(redondearSegundos(2.05), 2.1);
  assert.equal(redondearSegundos(3.46), 3.5);
});

console.log("Campo de calibración");
prueba("acepta coma o punto decimal y redondea a 0,1", () => {
  assert.equal(parsearSegundos("2,5"), 2.5);
  assert.equal(parsearSegundos("2.5"), 2.5);
  assert.equal(parsearSegundos(" 3 "), 3);
  assert.equal(parsearSegundos("2,36"), 2.4);
});
prueba("rechaza texto, vacío, negativos, notación científica y fuera de 0,1–60: undefined (el campo conserva lo anterior)", () => {
  for (const malo of ["", "abc", "2,5 s", "-1", "0", "0,05", "61", "1e3", "2,5,1", "NaN"]) assert.equal(parsearSegundos(malo), undefined, malo);
});
prueba("sin almacén, con clave vacía o con texto roto: vale la tabla por defecto y nunca lanza", () => {
  assert.deepEqual(leerCalibracionBomba(undefined), {});
  assert.deepEqual(leerCalibracionBomba(almacen(null)), {});
  assert.deepEqual(leerCalibracionBomba(almacen("{no es json")), {});
  assert.deepEqual(leerCalibracionBomba(almacen(null, true)), {});
});
prueba("la clave del taller es la versión 1 y se lee tal cual", () => {
  assert.equal(CLAVE_CALIBRACION_BOMBA, "taller3d.bomba.segundos.v1");
  assert.deepEqual(leerCalibracionBomba(almacen(JSON.stringify({ "R-12": 2.8 }))), { "R-12": 2.8 });
});
prueba("solo entran formatos conocidos con segundos entre 0,1 y 60, redondeados", () => {
  assert.deepEqual(normalizarCalibracion({ "R-12": 2.36, "R-99": 3, "R-5": 0, "R-9": -1, "R-18": "4", "R-24": 61, "R-36": 60, "C-6": Number.NaN }), { "R-12": 2.4, "R-36": 60 });
  assert.deepEqual(normalizarCalibracion(["R-12"]), {});
  assert.deepEqual(normalizarCalibracion(null), {});
});

console.log("Filas");
prueba("3 globos R-9 de 18 cm: 1,5 s por globo y 4,5 s en total; la fila lleva el cm entero", () => {
  const filas = filasBomba([{ formatoId: "R-9", infladoCm: 18 }, { formatoId: "R-9", infladoCm: 18 }, { formatoId: "R-9", infladoCm: 18 }]);
  assert.equal(filas.length, 1);
  assert.equal(filas[0]!.cantidad, 3);
  assert.equal(filas[0]!.segundosPorGlobo, 1.5);
  assert.equal(filas[0]!.segundosTotal, 4.5);
});
prueba("los helios no pasan por la bomba", () => {
  assert.deepEqual(filasBomba([{ formatoId: "R-12", infladoCm: 25, parte: "helio" }]), []);
  assert.deepEqual(filasBomba([{ formatoId: "R-12", infladoCm: 25, parte: "globo", helio: true }]), []);
  assert.equal(filasBomba([{ formatoId: "R-12", infladoCm: 25, parte: "globo" }]).length, 1);
  assert.deepEqual(lineasBomba([]), []);
});
prueba("un tamaño de 25,4 y otro de 25,2 caen en la misma fila de 25 cm (no una fila por décima)", () => {
  const filas = filasBomba([{ formatoId: "R-12", infladoCm: 25.4 }, { formatoId: "R-12", infladoCm: 25.2 }]);
  assert.equal(filas.length, 1);
  assert.equal(filas[0]!.cantidad, 2);
});
prueba("una fila por formato: los globos R-5 de 8 a 12 cm suman una fila con su rango, el total y el promedio por globo", () => {
  const filas = filasBomba([{ formatoId: "R-5", infladoCm: 8 }, { formatoId: "R-5", infladoCm: 12 }]);
  assert.equal(filas.length, 1);
  assert.deepEqual([filas[0]!.cantidad, filas[0]!.cmMin, filas[0]!.cmMax], [2, 8, 12]);
  assert.equal(filas[0]!.segundosTotal, 1.3);
  assert.equal(filas[0]!.segundosPorGlobo, 0.6);
});
prueba("el texto de cada fila: rango de cm, promedio por globo y total; un solo tamaño sin rango; el tubito sin cm", () => {
  const [rango] = filasBomba([{ formatoId: "R-5", infladoCm: 8 }, { formatoId: "R-5", infladoCm: 12 }]);
  assert.equal(textoFilaBomba(rango!), "2 × R-5 · 8–12 cm · ~0,6 s c/u · 1,3 s");
  const [unico] = filasBomba([{ formatoId: "R-12", infladoCm: 25 }, { formatoId: "R-12", infladoCm: 25 }]);
  assert.equal(textoFilaBomba(unico!), "2 × R-12 · 25 cm · ~2 s c/u · 4 s");
  const [tubito] = filasBomba([{ formatoId: "T-160", infladoCm: 2.5, parte: "globo" }, { formatoId: "T-160", infladoCm: 2.5, parte: "globo" }]);
  assert.equal(textoFilaBomba(tubito!), "2 × T-160 · ~0,5 s c/u · 1 s");
});
prueba("la escena de 641 globos tiene una fila por formato presente, no por tamaño", () => {
  const item = BIBLIOTECA_FABRICA.find((i) => i.id === "idea:ocasiones-especiales-paleta-neutral")!;
  const globos = armarEscena(escenaDeItem(item) as never).globos.filter((g) => !esGloboDeHelio(g));
  const formatos = new Set(globos.map((g) => g.formatoId));
  assert.equal(filasBomba(globos).length, formatos.size);
});
prueba("la escena de 641 globos (ocasiones-especiales-paleta-neutral) da pocas filas y cuenta cada globo de bomba una vez", () => {
  const item = BIBLIOTECA_FABRICA.find((i) => i.id === "idea:ocasiones-especiales-paleta-neutral");
  assert.ok(item);
  const globos = armarEscena(escenaDeItem(item) as never).globos;
  assert.equal(globos.length, 641);
  const filas = filasBomba(globos);
  const decimales = new Set(globos.filter((g) => !esGloboDeHelio(g)).map((g) => `${g.formatoId}|${redondearSegundos(g.infladoCm * 10) / 10}`));
  assert.ok(filas.length <= 40, `filas: ${filas.length}`);
  assert.ok(filas.length < decimales.size, "se agrupa por cm entero, no por décima");
  assert.equal(filas.reduce((s, f) => s + f.cantidad, 0), globos.filter((g) => !esGloboDeHelio(g)).length);
  assert.ok(tiempoTotalBomba(filas) > 0);
});
prueba("los tubitos pasan por la bomba: el ramo de flores en Reflex (148 tramos, 0 globos) da sus 67 tubitos enteros, no sus tramos", () => {
  const armada = armarEscena(escenaDeItem(BIBLIOTECA_FABRICA.find((x) => x.id === "idea:ramo-de-flores-en-reflex")!));
  assert.equal(armada.globos.length, 0);
  assert.equal(armada.tubos.length, 148);
  const filas = filasBomba(inflablesDeEscena(armada));
  assert.equal(filas.length, 1);
  assert.deepEqual([filas[0]!.formatoId, filas[0]!.unidad, filas[0]!.cantidad, filas[0]!.cmMin, filas[0]!.cmMax], ["T-260", "tubito", 67, 5, 5]);
  assert.equal(filas[0]!.segundosPorGlobo, 0.7);
  assert.equal(filas[0]!.segundosTotal, 46.9);
  assert.equal(tiempoTotalBomba(filas), 46.9);
  assert.ok(lineasBomba(filas).some((l) => l === "67 × T-260 · ~0,7 s c/u · 46,9 s"));
});
prueba("la columna rellena (10 globos y 168 tramos de tubito) suma 8 tubitos a sus globos; los globos siguen igual", () => {
  const armada = armarEscena(escenaDeItem(BIBLIOTECA_FABRICA.find((x) => x.id === "idea:columna-rellena")!));
  assert.equal(armada.globos.length, 10);
  assert.equal(armada.tubos.length, 168);
  const soloGlobos = filasBomba(armada.globos);
  const todas = filasBomba(inflablesDeEscena(armada));
  const tubitos = todas.filter((f) => f.unidad === "tubito");
  assert.deepEqual(tubitos.map((f) => [f.formatoId, f.cantidad, f.segundosTotal]), [["T-260", 8, 5.6]]);
  assert.equal(tiempoTotalBomba(todas), redondearSegundos(tiempoTotalBomba(soloGlobos) + 5.6));
  assert.deepEqual(todas.filter((f) => f.unidad === "globo"), soloGlobos);
});
prueba("el tubito entero se calibra como cualquier formato y los helios no se llevan los tubitos", () => {
  const tubitos = inflablesDeEscena({ globos: [{ formatoId: "R-12", infladoCm: 25, helio: true }], materiales: [{ formatoId: "T-360", cantidad: 3 }, { formatoId: "R-12", cantidad: 1 }] });
  assert.equal(tubitos.length, 4);
  const filas = filasBomba(tubitos, { "T-360": 2 });
  assert.deepEqual(filas.map((f) => [f.formatoId, f.cantidad, f.segundosTotal]), [["T-360", 3, 6]]);
});
prueba("el tiempo total es la suma de los globos, no de las filas redondeadas (3 globos de 9 cm = 0,5625 s cada uno)", () => {
  const filas = filasBomba([{ formatoId: "R-9", infladoCm: 9 }, { formatoId: "R-9", infladoCm: 9 }, { formatoId: "R-9", infladoCm: 9 }]);
  assert.equal(filas[0]!.segundosTotal, 0.6);
  assert.equal(tiempoTotalBomba(filas), 0.6);
});
prueba("el total de bomba se suma sin redondear las filas: R-12 a 12,5 cm y LOL-12 a 12,5 cm dan 0,25 s cada uno (filas de 0,3) y el total es 0,5", () => {
  const filas = filasBomba([{ formatoId: "R-12", infladoCm: 12.5 }, { formatoId: "LOL-12", infladoCm: 12.5 }]);
  assert.deepEqual(filas.map((f) => f.segundosTotal), [0.3, 0.3]);
  assert.equal(tiempoTotalBomba(filas), 0.5);
  assert.equal(tiempoTotalBomba(filasBomba([{ formatoId: "R-12", infladoCm: 12.5 }])), 0.3);
});
prueba("el texto da el tiempo total en minutos y segundos, y el aviso de estimación", () => {
  assert.equal(textoTiempo(45.3), "45,3 s");
  assert.equal(textoTiempo(125.3), "2 min 5,3 s");
  assert.equal(textoTiempo(252), "4 min 12 s");
  assert.equal(textoTiempo(60), "1 min 0 s");
  assert.equal(textoTiempo(3662), "1 h 1 min 2 s");
  assert.equal(textoTiempo(3600), "1 h 0 min 0 s");
  const lineas = lineasBomba(filasBomba([{ formatoId: "R-12", infladoCm: 25 }, { formatoId: "R-12", infladoCm: 25 }]));
  assert.equal(lineas[1], "BOMBA (estimación; el taller puede calibrarla)");
  assert.equal(lineas[2], "2 × R-12 · 25 cm · ~2 s c/u · 4 s");
  assert.equal(lineas.at(-1), "Tiempo total de bomba: 4 s");
});

console.log("Guardado del taller");
prueba("sin navegador (Node) no hay almacén: undefined, sin lanzar", () => {
  assert.equal(almacenDelNavegador(), undefined);
});
prueba("guarda la calibración en su clave y la quita cuando está vacía", () => {
  const guardado = new Map<string, string>();
  const falso = { setItem: (k: string, v: string) => { guardado.set(k, v); }, removeItem: (k: string) => { guardado.delete(k); } };
  guardarCalibracionBomba(falso, { "R-12": 2.8 });
  assert.equal(guardado.get(CLAVE_CALIBRACION_BOMBA), JSON.stringify({ "R-12": 2.8 }));
  guardarCalibracionBomba(falso, {});
  assert.equal(guardado.has(CLAVE_CALIBRACION_BOMBA), false);
});
prueba("un almacén que bloquea la escritura no hace lanzar al taller", () => {
  const bloqueado = { setItem: () => { throw new Error("cuota"); }, removeItem: () => { throw new Error("bloqueado"); } };
  assert.doesNotThrow(() => guardarCalibracionBomba(bloqueado, { "R-12": 2.8 }));
  assert.doesNotThrow(() => guardarCalibracionBomba(bloqueado, {}));
});

console.log(`${pruebas} pruebas en verde`);
