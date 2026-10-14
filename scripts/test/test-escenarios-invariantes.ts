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
import { TOPE_MARGEN_SIN_R9 } from "../escenarios/bandas-columna";
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

/** P-087: la guirnalda orgánica de un color sin R-9 (056, 909, 912, 915, 932) llega a la banda de siempre, con el margen fijo de 3 globos. */
function pruebaGuirnaldaSinR9LlegaALaBanda(): void {
  const organica = (largoM: number, densidad: PiezaEspec["densidad"], codigo: string): PiezaEspec =>
    pieza("EST_01_GUIRNALDA", "guirnalda", { medidas: { largoM }, tamanos: "organica_fina", densidad, colores: [{ codigo, nombre: "Color", peso: 1 }] });
  const banda = bandaDePieza(organica(3.66, "sencilla", "932"));
  assert.equal(banda.tipo === "banda" && Math.floor(13 * banda.ejeM) - banda.minGlobos, 3, "el margen por abajo es el fijo de 3 para todos los colores");
  for (const codigo of ["056", "909", "912", "915", "932"]) {
    for (const [largoM, densidad] of [[1.27, "sencilla"], [3.66, "sencilla"], [3.66, "media"], [6, "sencilla"], [6, "media"]] as const) {
      const o = observar(espec(organica(largoM, densidad, codigo)));
      // La media queda 1-3 globos por debajo del mínimo (65 contra 66 a 3,66 m): la clase permitida de P-087; la sencilla llega a la banda.
      const permitidas = densidad === "media" ? ["banda_conteo:guirnalda:media:bajo"] : [];
      assert.ok(clasesDe(o, "banda_conteo").every((c) => permitidas.includes(c)), `${codigo} a ${largoM} m ${densidad}: ${o.geometria!.globos.get("EST_01_GUIRNALDA")} globos dentro de la banda`);
    }
  }
  // Lo que queda de P-087: la guirnalda media de 1,27 m cae por debajo de la banda con o sin R-9 (la clase permitida de `clases-permitidas.ts`).
  for (const codigo of ["570", "932"]) assert.deepEqual(clasesDe(observar(espec(organica(1.27, "media", codigo))), "banda_conteo"), ["banda_conteo:guirnalda:media:bajo"], `${codigo}: la guirnalda media de 1,27 m es la clase permitida`);
  const sinR9 = observar(espec(organica(3.66, "sencilla", "932"))).geometria!.globos.get("EST_01_GUIRNALDA")!;
  const conR9 = observar(espec(organica(3.66, "sencilla", "570"))).geometria!.globos.get("EST_01_GUIRNALDA")!;
  assert.ok(sinR9 >= 0.85 * conR9, `sin R-9 (${sinR9} globos) queda a menos de un 15 % del conteo con R-9 (era un 32 % menos antes del relleno compensado: 38 contra 56) (${conR9})`);
  const escasa = conGeometria(observar(espec(organica(3.66, "sencilla", "932"))), { globos: new Map([["EST_01_GUIRNALDA", Math.floor(0.75 * 13 * 3.66)]]) });
  assert.deepEqual(clasesDe(escasa, "banda_conteo"), ["banda_conteo:guirnalda:sencilla:bajo"], "el 75 % del mínimo sigue fallando");
  const aro = bandaDePieza(pieza("EST_01_ARO", "aro_circular", { medidas: { anchoM: 1.5, altoM: 1.5 }, tamanos: "organica_fina", densidad: "media" }));
  assert.equal(aro.tipo === "banda" && Math.floor(14 * aro.ejeM) - aro.minGlobos, 3, "el aro sigue con el margen fijo de 3 (banda media de 1,4 a 1,8 m: 14/m)");
  console.log("  guirnalda sin R-9: llega a la banda con el margen fijo: ok");
}

/** T61: la columna orgánica se compara con una banda que depende del grosor: cada grosor medido cae dentro de la suya y una columna claramente rala falla. */
function pruebaColumnaOrganicaPorGrosor(): void {
  const columna = (oficial: "columna" | "columna_asimetrica", grosorM: number, densidad: PiezaEspec["densidad"], codigo = "570"): PiezaEspec =>
    pieza("EST_01_COLUMNA", oficial, { medidas: { altoM: 1.8, anchoM: grosorM }, tamanos: "organica_fina", densidad, colores: [{ codigo, nombre: "Color", peso: 1 }] });
  for (const oficial of ["columna", "columna_asimetrica"] as const) {
    for (const densidad of ["sencilla", "media", "lujosa"] as const) {
      // Los bordes de cada tramo, el grosor por defecto (banda de PARIDAD) y el punto medio de cada tramo, donde el conteo por metro más se aparta de los bordes.
      for (const grosorM of [0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.2] as const) {
        const p = columna(oficial, grosorM, densidad);
        const o = observar(espec(p));
        assert.deepEqual(clasesDe(o, "banda_conteo"), [], `${oficial} ${densidad} de ${grosorM} m: ${o.geometria!.globos.get("EST_01_COLUMNA")} globos dentro de su banda`);
        const banda = bandaDePieza(p);
        assert.equal(banda.tipo, "banda");
        if (banda.tipo !== "banda") continue;
        const rala = conGeometria(o, { globos: new Map([["EST_01_COLUMNA", Math.floor(0.4 * banda.minGlobos)]]) });
        assert.deepEqual(clasesDe(rala, "banda_conteo"), [`banda_conteo:${oficial}:${densidad}:bajo`], `${oficial} ${densidad} de ${grosorM} m: una columna rala falla`);
        const densa = conGeometria(o, { globos: new Map([["EST_01_COLUMNA", banda.maxGlobos + 1]]) });
        assert.deepEqual(clasesDe(densa, "banda_conteo"), [`banda_conteo:${oficial}:${densidad}:sobre`], `${oficial} ${densidad} de ${grosorM} m: una columna de más falla`);
      }
    }
  }
  const fina = bandaDePieza(columna("columna", 0.4, "media")), gruesa = bandaDePieza(columna("columna", 1, "media"));
  assert.ok(fina.tipo === "banda" && gruesa.tipo === "banda" && gruesa.minGlobos > fina.minGlobos, "una columna de 1 m exige más globos que una de 0,4 m");
  const sinR9 = observar(espec(columna("columna", 0.7, "media", "056")));
  assert.deepEqual(clasesDe(sinR9, "banda_conteo"), [], "un color sin R-9 llega a la banda con la fracción perdonada");
  const defecto = bandaDePieza(pieza("EST_01_COLUMNA", "columna", { medidas: { altoM: 1.8 }, tamanos: "organica_fina", densidad: "media" }));
  const siete = bandaDePieza(columna("columna", 0.7, "media"));
  assert.ok(defecto.tipo === "banda" && siete.tipo === "banda" && defecto.minGlobos === siete.minGlobos, "sin grosor pedido rige el de por defecto (0,7 m)");
  const conCapas = bandaDePieza({ ...columna("columna", 0.7, "media"), capas: 18 });
  const sinCapas = bandaDePieza(columna("columna", 0.7, "media"));
  assert.ok(conCapas.tipo === "banda" && sinCapas.tipo === "banda" && conCapas.ejeM === sinCapas.ejeM, "las capas no cambian el eje de una columna orgánica (solo la clásica las lee)");
  const porDefecto = bandaDePieza(columna("columna", 0.7, "media"));
  assert.ok(porDefecto.tipo === "banda" && porDefecto.fuente.includes("PARIDAD"), "el grosor por defecto (0,7 m) conserva su banda de PARIDAD, no la medida");
  const medida = bandaDePieza(columna("columna", 0.75, "media"));
  assert.ok(medida.tipo === "banda" && medida.fuente.includes("Medido"), "los demás grosores usan la banda medida");
  for (const f of BANDAS.filter((fila) => fila.margenBajoSinR9 !== undefined)) assert.ok(f.margenBajoSinR9! <= TOPE_MARGEN_SIN_R9, `${f.fuente}: el margen para colores sin R-9 pasa del ${TOPE_MARGEN_SIN_R9 * 100} %`);
  console.log("  columna orgánica: banda por grosor (14 grosores, bordes, medios y por defecto; 3 densidades, 2 estructuras), la rala y la densa fallan: ok");
}

/** T60: el aro orgánico se compara con una banda que depende del diámetro: cada diámetro (bordes y medios de tramo) cae dentro de la suya y un aro ralo falla. */
function pruebaAroPorDiametro(): void {
  const aro = (d: number, densidad: PiezaEspec["densidad"], codigo = "570"): PiezaEspec =>
    pieza("EST_01_ARO", "aro_circular", { medidas: { anchoM: d, altoM: d }, tamanos: "organica_fina", densidad, colores: [{ codigo, nombre: "Color", peso: 1 }] });
  for (const densidad of ["sencilla", "media", "lujosa"] as const) {
    for (const d of [1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 3] as const) {
      const p = aro(d, densidad);
      const o = observar(espec(p));
      assert.deepEqual(clasesDe(o, "banda_conteo"), [], `aro ${densidad} de ${d} m: ${o.geometria!.globos.get("EST_01_ARO")} globos dentro de su banda`);
      const banda = bandaDePieza(p);
      assert.ok(banda.tipo === "banda");
      if (banda.tipo !== "banda") continue;
      const ralo = conGeometria(o, { globos: new Map([["EST_01_ARO", Math.floor(0.4 * banda.minGlobos)]]) });
      assert.deepEqual(clasesDe(ralo, "banda_conteo"), [`banda_conteo:aro_circular:${densidad}:bajo`], `aro ${densidad} de ${d} m: un aro ralo falla`);
    }
  }
  const chico = bandaDePieza(aro(1, "media")), grande = bandaDePieza(aro(3, "media"));
  assert.ok(chico.tipo === "banda" && grande.tipo === "banda" && grande.minGlobos / grande.ejeM > chico.minGlobos / chico.ejeM, "un aro grande exige más globos por metro que uno chico");
  const sencilla = bandaDePieza(aro(2, "sencilla"));
  assert.ok(sencilla.tipo === "banda" && sencilla.fuente.includes("PARIDAD evidence"), "el aro dice que solo la sencilla de 2 m tiene evidencia de PARIDAD");
  assert.ok(BANDAS.filter((f) => f.estructuras.includes("aro_circular")).every((f) => f.origen === "medido" && f.fuente.includes("only sencilla d=2 has PARIDAD evidence")), "las filas del aro son medidas y declaran su evidencia");
  console.log("  aro orgánico: banda por diámetro (9 diámetros, 3 densidades), la rala falla: ok");
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
pruebaGuirnaldaSinR9LlegaALaBanda();
pruebaColumnaOrganicaPorGrosor();
pruebaAroPorDiametro();
pruebaTodaEstructuraTieneBanda();
console.log("test-escenarios-invariantes: ok");
