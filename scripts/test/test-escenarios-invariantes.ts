/**
 * Los invariantes de la matriz (`scripts/escenarios/invariantes.ts`, REQ-014 T15). Cada uno tiene que:
 *   - dejar pasar una observación buena (construida de verdad por la fachada), y
 *   - detectar su fixture malo (la misma observación con UN defecto plantado), con la clase de fallo esperada.
 * Invariantes: no_lanza, banda_conteo, sin_solapes, dentro_sala, determinismo, tiempo, avisos_honestos.
 *
 *   npx tsx --conditions=react-server scripts/test/test-escenarios-invariantes.ts
 */
import assert from "node:assert/strict";
import type { EspecClienteV1, PiezaEspec } from "../../src/lib/globos3d/motor/espec-cliente-v1";
import { observar, type Geometria, type Observacion } from "../escenarios/ejecutar";
import { evaluar, INVARIANTES, PRESUPUESTO_MS, piezasConBanda, type Invariante } from "../escenarios/invariantes";

const pieza = (id: string, oficial: PiezaEspec["oficial"], extra: Partial<PiezaEspec> = {}): PiezaEspec => ({
  id, oficial, nombre: `Pieza ${id}`, lugar: "centro", medidas: {}, colores: [{ codigo: "570", nombre: "Dorado", peso: 1 }], tamanos: "clasica", ...extra,
});
const espec = (...piezas: PiezaEspec[]): EspecClienteV1 => ({ version: "espec-cliente.v1", origen: { tipo: "propuesta" }, piezas });

const clasesDe = (o: Observacion, invariante: Invariante): string[] =>
  evaluar(o, { conTiempo: true }).find((c) => c.invariante === invariante)!.clases;

/** Observación buena: dos piezas del piso con banda de conteo, sin solapes ni avisos pendientes. */
const BUENA = observar(espec(pieza("EST_01_ARCO", "arco", { medidas: { anchoM: 2.4, altoM: 2.2 } }), pieza("EST_02_COLUMNA", "columna", { lugar: "derecha", medidas: { altoM: 1.8 } })));
const geometria = (o: Observacion): Geometria => o.geometria!;
const conGeometria = (o: Observacion, cambio: Partial<Geometria>): Observacion => ({ ...o, geometria: { ...geometria(o), ...cambio } });

type Caso = { invariante: Invariante; malo: Observacion; clase: RegExp };
const idArco = "EST_01_ARCO";
const casos = (): Caso[] => {
  const cajas = new Map(geometria(BUENA).cajas);
  const arco = cajas.get(idArco)!;
  const banda = piezasConBanda(BUENA).find((p) => p.oficial === "arco")!;
  const conAproximada = observar(espec(pieza("EST_01_DECLARADA", "arco", { declarada: { materiales: [{ formatoId: "R-12", codigo: "570", cantidad: 10 }], motivo: "Lo cuenta la lista." } })));
  const sala = geometria(BUENA).sala;
  return [
    { invariante: "no_lanza", malo: { ...BUENA, resultado: null, geometria: null, errorFachada: "TypeError: boom" }, clase: /^no_lanza:fachada:TypeError/ },
    { invariante: "no_lanza", malo: { ...BUENA, resultado: null, geometria: null, rechazoEsquema: "piezas.0.colores: Too big" }, clase: /^no_lanza:esquema_rechaza:/ },
    { invariante: "banda_conteo", malo: conGeometria(BUENA, { globos: new Map([...geometria(BUENA).globos, [idArco, banda.banda.maxGlobos + 50]]) }), clase: /^banda_conteo:arco:clasica:sobre$/ },
    { invariante: "banda_conteo", malo: conGeometria(BUENA, { globos: new Map([...geometria(BUENA).globos, [idArco, 0]]) }), clase: /^banda_conteo:arco:clasica:bajo$/ },
    { invariante: "sin_solapes", malo: conGeometria(BUENA, { cajas: new Map([...cajas, ["EST_02_COLUMNA", arco]]) }), clase: /^sin_solapes:arco\+columna$/ },
    { invariante: "dentro_sala", malo: conGeometria(BUENA, { cajas: new Map([...cajas, [idArco, [arco[0], arco[1], arco[2], sala.anchoCm, arco[4], arco[5]] as typeof arco]]) }), clase: /^dentro_sala:x:arco$/ },
    { invariante: "dentro_sala", malo: conGeometria(BUENA, { cajas: new Map([...cajas, [idArco, [arco[0], arco[1], arco[2], arco[3], sala.altoCm + 50, arco[5]] as typeof arco]]) }), clase: /^dentro_sala:y:arco$/ },
    { invariante: "determinismo", malo: { ...BUENA, huellas: ["aaaaaaaa", "bbbbbbbb"] }, clase: /^determinismo:distinta_serializacion$/ },
    { invariante: "tiempo", malo: { ...BUENA, tiempoMs: PRESUPUESTO_MS + 1 }, clase: /^tiempo:excede_/ },
    { invariante: "avisos_honestos", malo: { ...conAproximada, avisos: [] }, clase: /^avisos:declarada_sin_aviso:arco$/ },
    { invariante: "avisos_honestos", malo: { ...BUENA, geometria: { ...geometria(BUENA), cajas: new Map([...cajas].filter(([id]) => id !== "EST_02_COLUMNA")) } }, clase: /^avisos:pieza_perdida:columna$/ },
  ];
};

function pruebaBuenaPasa(): void {
  for (const c of evaluar(BUENA, { conTiempo: true })) assert.deepEqual(c.clases, [], `la observación buena falla ${c.invariante}`);
  assert.equal(BUENA.errorFachada, null);
  assert.ok(piezasConBanda(BUENA).length === 2, "la observación buena tiene dos piezas con banda");
  console.log("  observación buena: pasa los 7 invariantes");
}

function pruebaCadaInvarianteAtrapaSuFixture(): void {
  const cubiertos = new Set<Invariante>();
  for (const { invariante, malo, clase } of casos()) {
    const clases = clasesDe(malo, invariante);
    assert.ok(clases.some((c) => clase.test(c)), `${invariante}: se esperaba ${clase}, salió [${clases.join(", ")}]`);
    cubiertos.add(invariante);
  }
  assert.deepEqual(INVARIANTES.filter((i) => !cubiertos.has(i)), [], "invariantes sin fixture malo");
  console.log(`  ${INVARIANTES.length} invariantes, cada uno atrapa su fixture malo: ok`);
}

function pruebaFixtureDeSolapeToleradoPasa(): void {
  const colgada = observar(espec(pieza("EST_01_GUIRNALDA", "guirnalda", { medidas: { largoM: 2 } }), pieza("EST_02_COLUMNA", "columna", { medidas: { altoM: 1.8 } })));
  const cajas = new Map(geometria(colgada).cajas);
  const caja = cajas.get("EST_01_GUIRNALDA")!;
  const forzada = conGeometria(colgada, { cajas: new Map([...cajas, ["EST_02_COLUMNA", caja]]) });
  assert.deepEqual(clasesDe(forzada, "sin_solapes"), [], "una guirnalda colgada sobre una columna es un solape tolerado");
  console.log("  solape tolerado (colgada sobre piso) no es choque: ok");
}

function pruebaTiempoSoloConFlag(): void {
  const lento = { ...BUENA, tiempoMs: PRESUPUESTO_MS + 1 };
  assert.deepEqual(evaluar(lento, { conTiempo: false }).find((c) => c.invariante === "tiempo")!.clases, [], "sin conTiempo, el tiempo no se juzga");
  console.log("  el tiempo solo se juzga en el CLI: ok");
}

pruebaBuenaPasa();
pruebaCadaInvarianteAtrapaSuFixture();
pruebaFixtureDeSolapeToleradoPasa();
pruebaTiempoSoloConFlag();
console.log("test-escenarios-invariantes: ok");
