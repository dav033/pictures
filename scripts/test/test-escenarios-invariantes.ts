/**
 * Los invariantes de la matriz (`scripts/escenarios/invariantes.ts`, REQ-014 T15). Cada uno tiene que:
 *   - dejar pasar una observación buena (construida de verdad por la fachada), y
 *   - detectar su fixture malo (la misma observación con UN defecto plantado), con la clase de fallo esperada.
 * Invariantes: no_lanza, banda_conteo, sin_solapes, dentro_sala, determinismo, tiempo, avisos_honestos.
 *
 *   npx tsx --conditions=react-server scripts/test/test-escenarios-invariantes.ts
 */
import assert from "node:assert/strict";
import { ESTRUCTURAS_OFICIALES_IDS } from "@/lib/plan/estructuras-oficiales";
import { TAMANOS_ESPEC, type EspecClienteV1, type PiezaEspec } from "../../src/lib/globos3d/motor/espec-cliente-v1";
import { BANDAS, bandaDePieza, ESTRUCTURAS_SIN_BANDA } from "../escenarios/bandas";
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

/** T62: el margen por abajo de la guirnalda orgánica crece con el largo (E-01844 de la semilla 1; E-00734 de la 259600: colores sin R-9). */
function pruebaGuirnaldaCortaToleraElRedondeo(): void {
  const organica = (largoM: number, densidad: PiezaEspec["densidad"], codigo = "570"): PiezaEspec =>
    pieza("EST_01_GUIRNALDA", "guirnalda", { medidas: { largoM }, tamanos: "organica_fina", densidad, colores: [{ codigo, nombre: "Color", peso: 1 }] });
  const minimo = (largoM: number): number => { const b = bandaDePieza(organica(largoM, "sencilla", "932")); assert.equal(b.tipo, "banda"); return b.tipo === "banda" ? b.minGlobos : -1; };
  const holgura = (largoM: number): number => Math.floor(13 * largoM) - minimo(largoM);
  assert.ok(holgura(6) > holgura(1.27) && holgura(1.27) > 3, "sin R-9, el margen por abajo crece con el largo y supera los 3 globos fijos");
  const corta = observar(espec(organica(1.27, "media", "932")));
  assert.equal(corta.geometria!.globos.get("EST_01_GUIRNALDA"), 15, "E-01844: 15 globos en 1,27 m con un color sin R-9");
  assert.deepEqual(clasesDe(corta, "banda_conteo"), [], "E-01844: 15 globos en 1,27 m media sin R-9 está dentro de la banda");
  const sinR9 = observar(espec(organica(3.66, "sencilla", "932")));
  assert.equal(sinR9.geometria!.globos.get("EST_01_GUIRNALDA"), 38, "E-00734: 38 globos en 3,66 m con un color sin R-9");
  assert.deepEqual(clasesDe(sinR9, "banda_conteo"), [], "E-00734: dentro de la banda");
  const conR9 = bandaDePieza(organica(3.66, "sencilla", "570"));
  const sinR9Banda = bandaDePieza(organica(3.66, "sencilla", "932"));
  assert.ok(conR9.tipo === "banda" && sinR9Banda.tipo === "banda" && sinR9Banda.minGlobos < conR9.minGlobos, "el margen relativo solo aplica a colores sin R-9");
  assert.equal(conR9.tipo === "banda" && Math.floor(13 * conR9.ejeM) - conR9.minGlobos, 3, "con un color R-9 rige el margen fijo de 3");
  const escasa = conGeometria(observar(espec(organica(3.66, "sencilla", "570"))), { globos: new Map([["EST_01_GUIRNALDA", Math.floor(0.75 * 13 * 3.66)]]) });
  assert.deepEqual(clasesDe(escasa, "banda_conteo"), ["banda_conteo:guirnalda:sencilla:bajo"], "con color R-9, el 75 % del mínimo sigue fallando");
  const vacia = conGeometria(corta, { globos: new Map([["EST_01_GUIRNALDA", 2]]) });
  assert.deepEqual(clasesDe(vacia, "banda_conteo"), ["banda_conteo:guirnalda:media:bajo"], "una guirnalda casi vacía sigue fallando");
  const aro = bandaDePieza(pieza("EST_01_ARO", "aro_circular", { medidas: { anchoM: 1.5, altoM: 1.5 }, tamanos: "organica_fina", densidad: "media" }));
  assert.equal(aro.tipo === "banda" && Math.floor(19 * aro.ejeM) - aro.minGlobos, 3, "el margen escalado es solo de la guirnalda: el aro sigue con 3");
  console.log("  guirnalda corta: el margen por abajo escala con el largo: ok");
}

/** T63: toda estructura oficial tiene banda o una exención documentada, y las cuatro de T63 se comparan con la fachada real (racimo_pared y bouquet son solo pines de regresión del valor por defecto). */
function pruebaTodaEstructuraTieneBanda(): void {
  const conBanda = new Set(BANDAS.flatMap((f) => f.estructuras));
  const sinNada = ESTRUCTURAS_OFICIALES_IDS.filter((id) => !conBanda.has(id) && !ESTRUCTURAS_SIN_BANDA[id]);
  assert.deepEqual(sinNada, [], "estructuras sin banda ni exención documentada: añade su fila a BANDAS (medida con la fachada) o su motivo a ESTRUCTURAS_SIN_BANDA");
  const dobles = ESTRUCTURAS_OFICIALES_IDS.filter((id) => conBanda.has(id) && ESTRUCTURAS_SIN_BANDA[id]);
  assert.deepEqual(dobles, [], "una estructura con banda no puede seguir en ESTRUCTURAS_SIN_BANDA");
  for (const id of ["techo_globos", "pared_densa", "racimo_pared", "bouquet"] as const) {
    assert.ok(conBanda.has(id), `${id} tiene que tener banda`);
    for (const tamanos of TAMANOS_ESPEC) {
      const b = bandaDePieza(pieza(`EST_01_${id.toUpperCase()}`, id, { tamanos, lugar: id === "techo_globos" ? "techo" : "centro" }));
      assert.equal(b.tipo, "banda", `${id}:${tamanos} sin banda`);
    }
    const o = observar(espec(pieza(`EST_01_${id.toUpperCase()}`, id, { lugar: id === "techo_globos" ? "techo" : id === "bouquet" ? "mesa" : "centro" })));
    const [p] = piezasConBanda(o);
    assert.ok(p, `${id}: la pieza por defecto se compara con su banda`);
    assert.deepEqual(clasesDe(o, "banda_conteo"), [], `${id}: la fachada cae dentro de su banda (${p.globos} globos, [${p.banda.minGlobos}, ${p.banda.maxGlobos}])`);
    const sobre = conGeometria(o, { globos: new Map([[`EST_01_${id.toUpperCase()}`, p.banda.maxGlobos + 1]]) });
    assert.match(clasesDe(sobre, "banda_conteo")[0] ?? "", new RegExp(`^banda_conteo:${id}:.*:sobre$`), `${id}: un conteo por encima de la banda falla`);
  }
  console.log("  toda estructura tiene banda o exención documentada; las cuatro de T63 se comparan: ok");
}

pruebaBuenaPasa();
pruebaCadaInvarianteAtrapaSuFixture();
pruebaFixtureDeSolapeToleradoPasa();
pruebaTiempoSoloConFlag();
pruebaGuirnaldaCortaToleraElRedondeo();
pruebaTodaEstructuraTieneBanda();
console.log("test-escenarios-invariantes: ok");
