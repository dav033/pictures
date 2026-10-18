/**
 * La matriz de escenarios del motor 3D (`scripts/escenarios/`), en versión rápida y determinista:
 * - el generador es determinista, y el esquema rechaza 7 colores (y solo eso: cualquier otro rechazo falla);
 * - regresiones de los errores del motor que la matriz encontró (cada una falla sin su arreglo);
 * - rejilla de bandas: cada celda (estructura y densidad) se comprueba al menos `MIN_POR_CELDA` veces;
 * - lote de 200 escenarios con semilla fija: la tasa de acierto no baja del suelo;
 * - cada clase de fallo permitida tiene que aparecer (si no aparece, la lista miente), y su extremo medido no puede empeorar:
 *   un «bajo» que cae más abajo de lo medido, o un «sobre» más arriba, falla la prueba.
 * El tiempo no se mide aquí (depende de la carga de la máquina): el CLI lo informa.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-escenarios-matriz.ts
 */
import assert from "node:assert/strict";
import { armarDesdeEspec } from "../../src/lib/globos3d/motor/v1";
import type { EspecClienteV1, PiezaEspec } from "../../src/lib/globos3d/motor/espec-cliente-v1";
import { CLASES_PERMITIDAS } from "../escenarios/clases-permitidas";
import { escenarioDe, generarLote } from "../escenarios/generador";
import { correr, clasesDe } from "../escenarios/matriz";
import { observar } from "../escenarios/ejecutar";
import { evaluar, piezasConBanda } from "../escenarios/invariantes";

/** Lote rápido: semilla y tamaño fijos. */
const SEMILLA = 7;
const N = 200;
/** Suelo de la tasa de acierto (escenarios que pasan todos los invariantes). */
const SUELO_TASA = 0.97;
/** Veces mínimas que cada celda de banda de la rejilla debe comprobarse. */
const MIN_POR_CELDA = 3;
/** Margen (globos por metro) con que un extremo puede quedar por dentro del medido sin fallar. */
const MARGEN_EXTREMO = 0.5;
const TOLERANCIA_ALTO_CM = 2;


/** Lo que se observó de cada clase permitida a lo largo de las pruebas: veces que apareció y su extremo (globos por metro). */
const observado = new Map<string, { veces: number; extremo: number }>();

function registrar(clase: string, globosPorMetro: number): void {
  const previo = observado.get(clase) ?? { veces: 0, extremo: clase.endsWith(":bajo") ? Infinity : -Infinity };
  const extremo = clase.endsWith(":bajo") ? Math.min(previo.extremo, globosPorMetro) : Math.max(previo.extremo, globosPorMetro);
  observado.set(clase, { veces: previo.veces + 1, extremo });
}

/** Cada pieza con banda que cae fuera de ella, como clase de fallo y su globos por metro. */
function registrarBandas(obs: ReturnType<typeof observar>): void {
  for (const p of piezasConBanda(obs)) {
    const porMetro = p.globos / p.banda.ejeM;
    if (p.globos < p.banda.minGlobos) registrar(`banda_conteo:${p.celda}:bajo`, porMetro);
    else if (p.globos > p.banda.maxGlobos) registrar(`banda_conteo:${p.celda}:sobre`, porMetro);
  }
}

const CELDAS_DE_REJILLA: ReadonlyArray<readonly [PiezaEspec["oficial"], PiezaEspec["tamanos"], PiezaEspec["medidas"][]]> = [
  ["arco", "clasica", [{ anchoM: 1.5, altoM: 2 }, { anchoM: 2.4, altoM: 2.2 }, { anchoM: 3, altoM: 2.9 }]],
  ["guirnalda", "clasica", [{ largoM: 1.5 }, { largoM: 2.5 }, { largoM: 4 }]],
  ["columna", "clasica", [{ altoM: 1.2 }, { altoM: 1.8 }, { altoM: 2.5 }]],
];
const ORGANICAS_DE_REJILLA: PiezaEspec["oficial"][] = ["semiarco", "semiarco_asimetrico", "guirnalda", "columna", "columna_asimetrica", "aro_circular"];

/** Medidas orgánicas de la rejilla. En una columna el ancho es su grosor (0,55 m el de referencia y 0,72 m el grueso); en una
 * guirnalda, su largo; en las demás, su tamaño. */
const medidasOrganicas = (oficial: PiezaEspec["oficial"]): PiezaEspec["medidas"][] => {
  if (oficial.startsWith("columna")) return [{ anchoM: 0.55, altoM: 1.2 }, { anchoM: 0.55, altoM: 1.8 }, { anchoM: 0.55, altoM: 2.4 }, { anchoM: 0.72, altoM: 0.86 }, { anchoM: 0.48, altoM: 1.9 }];
  if (oficial === "guirnalda") return [{ largoM: 1.27 }, { largoM: 2.4 }, { largoM: 4 }];
  return [{ anchoM: 1.2, altoM: 2 }, { anchoM: 1.8, altoM: 2.4 }, { anchoM: 2.4, altoM: 2.9 }];
};

/** P-089 regression set: 056 exercises compensated fill; 570 retains the short-column R-9 cases that still miss PARIDAD. */
const COLUMNAS_REPRO_P089: ReadonlyArray<readonly [codigo: string, medidas: PiezaEspec["medidas"][]]> = [
  ["570", [{ altoM: 1 }, { altoM: 1.24 }, { anchoM: 1.05, altoM: 1 }, { anchoM: 0.7, altoM: 4 }, { anchoM: 1.2, altoM: 1.2 }]],
  ["056", [{ anchoM: 0.35, altoM: 2.4 }, { anchoM: 0.7, altoM: 1.8 }, { anchoM: 0.7, altoM: 4 }, { anchoM: 0.9, altoM: 2.4 }, { anchoM: 1.05, altoM: 1 }, { anchoM: 1.1, altoM: 3 }]],
];

function pieza(oficial: PiezaEspec["oficial"], medidas: PiezaEspec["medidas"], tamanos: PiezaEspec["tamanos"], densidad?: PiezaEspec["densidad"]): PiezaEspec {
  return {
    id: "EST_01_" + oficial.toUpperCase(), oficial, nombre: `Pieza 1 ${oficial}`, lugar: "centro", medidas,
    colores: [{ codigo: "570", nombre: "Dorado", peso: 1 }], tamanos, ...(densidad ? { densidad } : {}),
  };
}

function envolver(p: PiezaEspec): EspecClienteV1 {
  return { version: "espec-cliente.v1", origen: { tipo: "propuesta" }, piezas: [p] };
}

function pruebaDeterminismoYRechazo(): void {
  const dos = JSON.stringify(escenarioDe(SEMILLA, 42));
  assert.equal(JSON.stringify(escenarioDe(SEMILLA, 42)), dos, "el mismo escenario sale igual");
  assert.notEqual(JSON.stringify(escenarioDe(SEMILLA, 43)), dos, "otro índice, otro escenario");

  const seis = [1, 2, 3, 4, 5, 6].map((k) => ({ codigo: `${String(500 + k)}`, nombre: `C${k}`, peso: 1 / 6 }));
  const siete = [1, 2, 3, 4, 5, 6, 7].map((k) => ({ codigo: `${String(500 + k)}`, nombre: `C${k}`, peso: 1 / 7 }));
  const con = (colores: typeof seis): EspecClienteV1 => ({
    version: "espec-cliente.v1", origen: { tipo: "propuesta" },
    piezas: [{ ...pieza("guirnalda", { largoM: 2 }, "organica_fina"), colores }],
  });
  assert.equal(observar(con(seis)).rechazoEsquema, null, "seis colores se aceptan");
  const rechazo = observar(con(siete)).rechazoEsquema;
  assert.ok(rechazo !== null && rechazo.includes("piezas.0.colores"), `siete colores se rechazan por la lista de colores: ${rechazo}`);
  console.log("  generador determinista y 7 colores rechazados: ok");
}

/** Regresión: la sala tenía 320 cm de alto fijos y una columna de 2,9 m con remate R-24 o un arco de 2,92 m se salían de ella. */
function pruebaSalaAltaSeAdapta(): void {
  const casos: Array<[string, PiezaEspec]> = [
    ["columna de 2,9 m con remate R-24", { ...pieza("columna", { altoM: 2.9 }, "organica_fina"), remate: { formatoId: "R-24", codigo: "570" } }],
    ["arco clásico de 2,92 m", pieza("arco", { anchoM: 1.93, altoM: 2.92 }, "clasica")],
  ];
  for (const [nombre, p] of casos) {
    const { sala, piezas } = armarDesdeEspec(envolver(p)).armada;
    const tope = Math.max(...piezas.map((q) => q.caja[4]));
    assert.ok(tope <= sala.altoCm + TOLERANCIA_ALTO_CM, `${nombre}: el tope (${tope} cm) cabe en la sala (${sala.altoCm} cm)`);
  }
  console.log("  sala alta se adapta: ok");
}

/** Regresión: las flores de globo colgaban bajo el piso. Con el radio de la propia flor, ni el pared de 9 flores ni el aro de
 * globos grandes con 15 flores (P-044) se hunden. */
function pruebaFloresSobreElPiso(): void {
  const casos: EspecClienteV1[] = [
    { version: "espec-cliente.v1", origen: { tipo: "idea" }, piezas: [{ id: "EST_01_PARED_DENSA", oficial: "pared_densa", nombre: "Pared con flores", lugar: "izquierda", medidas: {}, colores: [{ codigo: "450", nombre: "Lila", peso: 1 }], tamanos: "clasica", flores: { cantidad: 9, petalos: 5, codigo: "909" } }] },
    { version: "espec-cliente.v1", origen: { tipo: "idea" }, piezas: [{ id: "EST_02_ARO_CIRCULAR", oficial: "aro_circular", nombre: "Pieza 2 aro_circular", lugar: "centro", medidas: { anchoM: 2.34, altoM: 2.34 }, colores: [{ codigo: "809", nombre: "Rosa Primaveral", peso: 1 }], tamanos: "solo_grandes", densidad: "sencilla", flores: { cantidad: 15, petalos: 5, codigo: "390", centro: "940" } }] },
  ];
  for (const espec of casos) {
    const { piezas } = armarDesdeEspec(espec).armada;
    const minimo = Math.min(...piezas.map((p) => p.caja[1]));
    assert.ok(minimo >= -TOLERANCIA_ALTO_CM, `ninguna flor queda bajo el piso (la caja llega a ${minimo} cm)`);
  }
  console.log("  flores sobre el piso: ok");
}

/** La rejilla: cada celda de banda se comprueba `MIN_POR_CELDA` veces, y sus fallos son solo los permitidos. */
function pruebaRejillaDeBandas(): void {
  const contadas = new Map<string, number>();
  const especs: EspecClienteV1[] = [];
  for (const [oficial, tamanos, medidas] of CELDAS_DE_REJILLA) for (const m of medidas) especs.push(envolver(pieza(oficial, m, tamanos)));
  for (const oficial of ORGANICAS_DE_REJILLA) {
    for (const densidad of ["sencilla", "media", "lujosa"] as const) {
      for (const m of medidasOrganicas(oficial)) especs.push(envolver(pieza(oficial, m, "organica_fina", densidad)));
    }
  }
  for (const oficial of ["columna", "columna_asimetrica"] as const) {
    for (const densidad of ["sencilla", "media", "lujosa"] as const) {
      for (const [codigo, medidas] of COLUMNAS_REPRO_P089) for (const m of medidas) especs.push(envolver({ ...pieza(oficial, m, "organica_fina", densidad), colores: [{ codigo, nombre: "Color", peso: 1 }] }));
    }
  }
  const noPermitidas: string[] = [];
  for (const espec of especs) {
    const obs = observar(espec);
    const clases = evaluar(obs, { conTiempo: false }).flatMap((c) => c.clases);
    for (const p of piezasConBanda(obs)) contadas.set(p.celda, (contadas.get(p.celda) ?? 0) + 1);
    registrarBandas(obs);
    const esColumnaSinR9 = espec.piezas.some((p) => (p.oficial === "columna" || p.oficial === "columna_asimetrica") && p.colores.some((c) => c.codigo === "056"));
    if (esColumnaSinR9) assert.deepEqual(clases.filter((c) => c.startsWith("banda_conteo:")), [], "P-089: las columnas 056 llegan a su banda con el relleno compensado");
    for (const clase of clases) if (!CLASES_PERMITIDAS.has(clase)) noPermitidas.push(clase);
  }
  const celdas = [...new Set([...CELDAS_DE_REJILLA.map(([o]) => `${o}:clasica`), ...ORGANICAS_DE_REJILLA.flatMap((o) => ["sencilla", "media", "lujosa"].map((d) => `${o}:${d}`))])];
  for (const celda of celdas) {
    const veces = contadas.get(celda) ?? 0;
    assert.ok(veces >= MIN_POR_CELDA, `la celda ${celda} se comprobó ${veces} veces (mínimo ${MIN_POR_CELDA})`);
  }
  assert.deepEqual(noPermitidas, [], "fallos de la rejilla fuera de CLASES_PERMITIDAS");
  console.log(`  rejilla de bandas: ${celdas.length} celdas, ${[...contadas.values()].reduce((s, v) => s + v, 0)} comprobaciones, mínimo ${MIN_POR_CELDA} por celda: ok`);
}

function pruebaDeMatriz(): void {
  let pasan = 0, rechazados = 0;
  const noPermitidas = new Set<string>();
  for (const escenario of generarLote(SEMILLA, N)) {
    const r = correr(escenario, { conTiempo: false });
    if (r.rechazoEsquema) rechazados++;
    if (r.chequeos.every((c) => c.clases.length === 0)) pasan++;
    for (const clase of clasesDe(r)) {
      if (!CLASES_PERMITIDAS.has(clase)) noPermitidas.add(`${clase} (${escenario.id})`);
    }
    registrarBandas(observar(escenario.espec));
  }
  const tasa = pasan / N;
  console.log(`  matriz rápida: ${pasan}/${N} pasan (${(100 * tasa).toFixed(1)}%), suelo ${(100 * SUELO_TASA).toFixed(0)}%; rechazados por el esquema: ${rechazados}`);
  assert.equal(rechazados, 0, "ningún escenario generado lo rechaza el esquema");
  assert.deepEqual([...noPermitidas], [], "clases de fallo fuera de CLASES_PERMITIDAS");
  assert.ok(tasa >= SUELO_TASA, `la tasa de acierto ${tasa.toFixed(3)} baja del suelo ${SUELO_TASA}`);
}

/** Cada entrada de la lista se tiene que dar en las pruebas (si no, la lista miente), y su extremo medido no puede empeorar. */
function pruebaListaDeClases(): void {
  for (const [clase, { extremo, razon }] of CLASES_PERMITIDAS) {
    const visto = observado.get(clase);
    assert.ok(visto && visto.veces > 0, `la clase permitida ${clase} no aparece en las pruebas: quítala de la lista (${razon})`);
    if (clase.endsWith(":bajo")) assert.ok(visto.extremo >= extremo - MARGEN_EXTREMO, `${clase} baja a ${visto.extremo.toFixed(1)} globos/m, por debajo del medido ${extremo}`);
    else assert.ok(visto.extremo <= extremo + MARGEN_EXTREMO, `${clase} sube a ${visto.extremo.toFixed(1)} globos/m, por encima del medido ${extremo}`);
  }
  console.log(`  lista de clases: ${CLASES_PERMITIDAS.size} entradas, todas dadas; extremos dentro de lo medido`);
}

pruebaDeterminismoYRechazo();
pruebaSalaAltaSeAdapta();
pruebaFloresSobreElPiso();
pruebaRejillaDeBandas();
pruebaDeMatriz();
if (process.env.MEDIR_CLASES) for (const [clase, v] of [...observado.entries()].sort()) console.log(`MEDIDO ${clase} veces=${v.veces} extremo=${v.extremo.toFixed(2)}`);
pruebaListaDeClases();
console.log("test-escenarios-matriz: ok");
