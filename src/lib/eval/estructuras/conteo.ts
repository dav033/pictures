import { calcularCosteEstimado } from "@sempertex/agente-core";
import { z } from "zod";
import { LecturaConteoSchema, type LecturaConteo } from "@/lib/plan/conteo-referencia";
import { precioVigente, type PrecioTabla, type TablaPrecios } from "./costo";
import { FAMILIAS_V2, type FamiliaV2 } from "./familia-v1-v2";
import { percentil } from "./resumen-corrida";
import { claveCorrida, LIMITES_RUNNER, type ItemSuite } from "./runner";

/**
 * Evaluación del conteo de globos de la foto (ADR-0031, E2). Mismo esqueleto que
 * el runner de reconocimiento (`runner.ts`): el análisis es una función
 * inyectada, así que la vista previa, el tope de gasto, la concurrencia, el
 * plazo y la reanudación se prueban con puertos simulados. Cada análisis son
 * dos llamadas: el reconocedor (Amaterasu) y la lectura de conteo de Python.
 *
 * La verdad humana vive fuera del repositorio (`sha256,globos,exacto[,familia]`,
 * una fila por foto): el total de globos de las estructuras de globos de la foto.
 * Métricas: error relativo mediano por familia y, en fotos de hasta 15 globos
 * contadas una a una, la parte que queda a ±1. Toda otra foto (más de 15 globos,
 * aunque se contaran una a una) cuenta en la meta del error relativo. Todo costo
 * es estimado salvo el uso que reporta el proveedor.
 */

export const PREDICCION_CONTEO_SCHEMA_ID = "prediccion-conteo.v1";
/** Metas de la primera versión (SEGUIMIENTO-guirnaldas.md §2.1). */
export const METAS_CONTEO = { errorMedianoDensas: 0.25, toleranciaExactas: 1, exactasHasta: 15 } as const;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

// --- Verdad humana ----------------------------------------------------------------

export type VerdadConteo = { image_sha256: string; globos: number; exacto: boolean; familia: FamiliaV2 | null };

const SI = new Set(["1", "true", "si", "sí", "exacto"]);
const NO = new Set(["0", "false", "no", "aproximado"]);

/** `sha256,globos,exacto[,familia]`; admite una cabecera y líneas en blanco. Lanza con la línea del primer error. */
export function leerVerdadConteo(texto: string): Map<string, VerdadConteo> {
  const verdad = new Map<string, VerdadConteo>();
  texto.split(/\r?\n/).forEach((cruda, indice) => {
    const linea = cruda.trim();
    if (!linea || (indice === 0 && /^sha256\b/i.test(linea))) return;
    const [hash, globosTexto, exactoTexto, familiaTexto] = linea.split(",").map((campo) => campo.trim());
    // Solo dígitos: `Number("")` es 0, y un blanco, "1e1" o "0x10" pasaban por una cuenta.
    const globos = /^\d+$/.test(globosTexto ?? "") ? Number(globosTexto) : Number.NaN;
    const exacto = (exactoTexto ?? "").toLowerCase();
    const familia = familiaTexto ? familiaTexto.toLowerCase() : null;
    if (!sha256.safeParse(hash).success) throw new Error(`verdad: línea ${indice + 1}: sha256 inválido`);
    if (!Number.isInteger(globos) || globos < 0) throw new Error(`verdad: línea ${indice + 1}: globos debe ser un entero ≥ 0`);
    if (!SI.has(exacto) && !NO.has(exacto)) throw new Error(`verdad: línea ${indice + 1}: exacto debe ser sí/no`);
    if (familia !== null && !(FAMILIAS_V2 as readonly string[]).includes(familia)) throw new Error(`verdad: línea ${indice + 1}: familia desconocida ${familia}`);
    if (verdad.has(hash!)) throw new Error(`verdad: línea ${indice + 1}: foto repetida`);
    verdad.set(hash!, { image_sha256: hash!, globos, exacto: SI.has(exacto), familia: familia as FamiliaV2 | null });
  });
  return verdad;
}

// --- Predicciones ---------------------------------------------------------------------

const PiezaContadaSchema = z.object({
  element_id: z.string().min(1).max(80),
  tipo: z.string().min(1).max(40),
  estructura_oficial: z.string().min(1).max(40).nullable(),
  /** Piezas iguales que representa el elemento; la lectura cuenta una. */
  piezas: z.number().int().min(1).max(999),
  lectura: LecturaConteoSchema,
}).strict();
export type PiezaContada = z.infer<typeof PiezaContadaSchema>;

export const PrediccionConteoV1Schema = z.object({
  schema: z.literal(PREDICCION_CONTEO_SCHEMA_ID),
  run_id: z.string().regex(/^[A-Za-z0-9._-]{1,120}$/),
  corrida: z.number().int().min(1).max(99),
  image_sha256: sha256,
  sistema: z.object({
    modelo: z.string().min(1).max(200),
    prompt_version: z.string().min(1).max(200),
    commit: z.string().min(1).max(64),
  }).strict(),
  resultado: z.enum(["ok", "error", "timeout", "cancelado", "omitida_por_presupuesto"]),
  piezas: z.array(PiezaContadaSchema).max(12),
  uso_reportado: z.object({
    tokens_entrada: z.number().int().nonnegative(),
    tokens_salida: z.number().int().nonnegative(),
    /** Pensamiento de las dos llamadas (se cobra como salida). Ausente en líneas anteriores al 2026-09-28: 0. */
    tokens_pensamiento: z.number().int().nonnegative().optional(),
    /** Falso si alguna de las dos llamadas no reportó uso: el costo real puede ser mayor. */
    completo: z.boolean(),
  }).strict(),
  latencia_ms: z.number().int().nonnegative(),
  raw_output_sha256: sha256.nullable(),
}).strict();
export type PrediccionConteoV1 = z.infer<typeof PrediccionConteoV1Schema>;

export function lineaConteoJsonl(prediccion: unknown): string {
  return `${JSON.stringify(PrediccionConteoV1Schema.parse(prediccion))}\n`;
}

export function leerPrediccionesConteo(texto: string): PrediccionConteoV1[] {
  return texto.split(/\r?\n/).flatMap((linea, indice) => {
    if (!linea.trim()) return [];
    const resultado = PrediccionConteoV1Schema.safeParse((() => {
      try {
        return JSON.parse(linea) as unknown;
      } catch {
        throw new Error(`${PREDICCION_CONTEO_SCHEMA_ID}: línea ${indice + 1} no es JSON`);
      }
    })());
    if (!resultado.success) throw new Error(`${PREDICCION_CONTEO_SCHEMA_ID}: línea ${indice + 1} inválida`);
    return [resultado.data];
  });
}

/**
 * La cuenta de una lectura, para medirla: la exacta, el estimado, racimos ×
 * globos por racimo o, a falta de todo, lo visible. Es el mismo orden que usa
 * el plan (`services/ai-api/app/conteo_foto.py`, `cuenta_usable`) sin su barra
 * de confianza: aquí se mide toda lectura y la confianza se reporta aparte.
 * No decide ninguna compra.
 */
export function cuentaDeLectura(lectura: LecturaConteo): number {
  if (lectura.exacto) return lectura.globos_visibles;
  if (lectura.estimado_total !== null) return lectura.estimado_total;
  if (lectura.racimos !== null && lectura.globos_por_racimo !== null) return lectura.racimos * lectura.globos_por_racimo;
  return lectura.globos_visibles;
}

const FAMILIA_DE_OFICIAL: Readonly<Record<string, FamiliaV2>> = { aro_circular: "aro", techo_globos: "techo", bouquet: "bouquet", figura: "figura" };

/** Familia de una pieza contada: la de su estructura oficial o su tipo; `null` si no hay una (un kit sin nombre). */
export function familiaDePieza(pieza: Pick<PiezaContada, "tipo" | "estructura_oficial">): FamiliaV2 | null {
  const oficial = pieza.estructura_oficial ? FAMILIA_DE_OFICIAL[pieza.estructura_oficial] : undefined;
  if (oficial) return oficial;
  return (FAMILIAS_V2 as readonly string[]).includes(pieza.tipo) ? (pieza.tipo as FamiliaV2) : null;
}

/** Globos de la foto según la predicción (cada pieza por sus repeticiones) y la familia de la pieza con más globos. */
export function totalDePrediccion(linea: PrediccionConteoV1): { globos: number; familia: FamiliaV2 | null } {
  let globos = 0;
  let mayor: { globos: number; familia: FamiliaV2 | null } = { globos: -1, familia: null };
  for (const pieza of linea.piezas) {
    const propios = cuentaDeLectura(pieza.lectura) * pieza.piezas;
    globos += propios;
    if (propios > mayor.globos) mayor = { globos: propios, familia: familiaDePieza(pieza) };
  }
  return { globos, familia: mayor.familia };
}

// --- Métricas ----------------------------------------------------------------------------

/**
 * La meta ±1 es de las fotos de hasta 15 globos contadas una a una. Toda otra
 * foto con verdad (más de 15 globos, aunque se hayan contado una a una, o sin
 * cuenta exacta) entra en la meta del error relativo mediano (`densas`): cada
 * foto cuenta en exactamente una meta (SEGUIMIENTO-guirnaldas.md §2.1).
 */
function enMetaExacta(verdad: VerdadConteo): boolean {
  return verdad.exacto && verdad.globos <= METAS_CONTEO.exactasHasta;
}

type Estrato = { n: number; error_relativo_mediano: number | null; dentro_15: number | null; exactas: { n: number; dentro_1: number | null } };

function estrato(pares: ReadonlyArray<{ predichos: number; verdad: VerdadConteo }>): Estrato {
  const errores = pares.filter((par) => par.verdad.globos > 0).map((par) => Math.abs(par.predichos - par.verdad.globos) / par.verdad.globos);
  const exactas = pares.filter((par) => enMetaExacta(par.verdad));
  const proporcion = (parte: number, total: number) => (total > 0 ? parte / total : null);
  return {
    n: pares.length,
    error_relativo_mediano: mediana(errores),
    dentro_15: proporcion(errores.filter((error) => error <= 0.15).length, errores.length),
    exactas: {
      n: exactas.length,
      dentro_1: proporcion(exactas.filter((par) => Math.abs(par.predichos - par.verdad.globos) <= METAS_CONTEO.toleranciaExactas).length, exactas.length),
    },
  };
}

function mediana(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio]! : (orden[medio - 1]! + orden[medio]!) / 2;
}

/**
 * Métricas de una corrida contra la verdad humana: por familia (la de la verdad
 * si la trae; si no, la de la pieza predicha con más globos) y en total. Cada
 * corrida `ok` de una foto con verdad cuenta como un par.
 */
export function metricasConteo(lineas: readonly PrediccionConteoV1[], verdad: ReadonlyMap<string, VerdadConteo>) {
  const pares: Array<{ predichos: number; verdad: VerdadConteo; familia: string }> = [];
  let sinVerdad = 0;
  let confianzaBaja = 0;
  let piezas = 0;
  for (const linea of lineas) {
    if (linea.resultado !== "ok") continue;
    const real = verdad.get(linea.image_sha256);
    if (!real) {
      sinVerdad += 1;
      continue;
    }
    piezas += linea.piezas.length;
    confianzaBaja += linea.piezas.filter((pieza) => pieza.lectura.confianza < 0.5).length;
    const prediccion = totalDePrediccion(linea);
    pares.push({ predichos: prediccion.globos, verdad: real, familia: real.familia ?? prediccion.familia ?? "sin_familia" });
  }
  const familias = [...new Set(pares.map((par) => par.familia))].sort();
  const densas = pares.filter((par) => !enMetaExacta(par.verdad));
  const exactas = estrato(pares).exactas;
  return {
    metas: METAS_CONTEO,
    total: estrato(pares),
    densas: estrato(densas),
    por_familia: Object.fromEntries(familias.map((familia) => [familia, estrato(pares.filter((par) => par.familia === familia))])),
    fotos_sin_verdad: sinVerdad,
    fotos_con_verdad_sin_prediccion: [...verdad.keys()].filter((hash) => !lineas.some((linea) => linea.image_sha256 === hash && linea.resultado === "ok")).length,
    piezas_con_confianza_baja: { n: confianzaBaja, de: piezas },
    // Veredictos, no proporciones: la meta ±1 no fija una parte admisible, así que
    // se lee estricta (todas a ±1). La proporción queda en `total.exactas.dentro_1`.
    cumple: {
      densas: densas.length === 0 ? null : (estrato(densas).error_relativo_mediano ?? 1) <= METAS_CONTEO.errorMedianoDensas,
      exactas: exactas.n === 0 ? null : exactas.dentro_1 === 1,
    },
  };
}

// --- Costo estimado -------------------------------------------------------------------------

const TokensSchema = z.object({ entrada: z.number().nonnegative(), salida: z.number().nonnegative() }).strict();
type Tokens = z.infer<typeof TokensSchema> & { pensamiento?: number };
const PercentilesSchema = z.object({ p50: TokensSchema, p95: TokensSchema }).strict();

/** Tokens por foto de las dos llamadas. `medido: false` = supuesto sin medir, dicho así en el registro de la corrida. */
export const SupuestoConteoSchema = z.object({
  version: z.string().min(1).max(80),
  modelo: z.string().min(1).max(200),
  medido: z.boolean(),
  origen: z.string().min(1).max(1000),
  analisis: PercentilesSchema,
  conteo: PercentilesSchema,
  /** Intentos máximos del análisis (salida malformada); la lectura de conteo no reintenta. */
  intentos_analisis: z.number().int().min(1).max(3),
}).strict();
export type SupuestoConteo = z.infer<typeof SupuestoConteoSchema>;

export type EstimacionConteo = {
  moneda: "USD";
  es_estimado: true;
  precio_version: string;
  supuesto_version: string;
  supuesto_medido: boolean;
  analisis: number;
  esperado_usd: number;
  cota_superior_usd: number;
};

function costo(tokens: Tokens, precio: PrecioTabla): number {
  return calcularCosteEstimado(
    { tokensEntrada: tokens.entrada, tokensSalida: tokens.salida, tokensPensamiento: tokens.pensamiento ?? 0, tokensCacheados: 0 },
    { tipoUnidad: "millon_tokens", precioEntrada: precio.precio_entrada, precioSalida: precio.precio_salida, precioCacheado: precio.precio_cacheado, moneda: precio.moneda },
  );
}

export function estimarConteo(input: { tabla: TablaPrecios; supuesto: SupuestoConteo; modelo: string; instante: Date; analisis: number }): EstimacionConteo {
  if (input.supuesto.modelo !== input.modelo) throw new Error(`el supuesto de tokens es de ${input.supuesto.modelo}, no de ${input.modelo}`);
  if (!Number.isInteger(input.analisis) || input.analisis < 0) throw new Error(`analisis inválido: ${input.analisis}`);
  const precio = precioVigente(input.tabla, input.modelo, input.instante);
  const { analisis, conteo } = input.supuesto;
  const esperado = costo(analisis.p50, precio) + costo(conteo.p50, precio);
  const alto = costo(analisis.p95, precio) * input.supuesto.intentos_analisis + costo(conteo.p95, precio);
  return {
    moneda: "USD",
    es_estimado: true,
    precio_version: input.tabla.version,
    supuesto_version: input.supuesto.version,
    supuesto_medido: input.supuesto.medido,
    analisis: input.analisis,
    esperado_usd: esperado * input.analisis,
    cota_superior_usd: alto * input.analisis,
  };
}

// --- Runner ---------------------------------------------------------------------------------

/** Tokens reportados por las dos llamadas; `pensamiento` se cobra como salida. */
type UsoConteo = { entrada: number; salida: number; pensamiento?: number; completo: boolean };

export type ResultadoConteo =
  | { resultado: "ok"; piezas: PiezaContada[]; uso: UsoConteo; rawOutputSha256: string; msTotal: number }
  | { resultado: "error" | "timeout" | "cancelado"; uso: UsoConteo; msTotal: number };

export type AnalizadorConteo = (item: ItemSuite, signal: AbortSignal) => Promise<ResultadoConteo>;

export type ConfiguracionConteo = {
  runId: string;
  sistema: PrediccionConteoV1["sistema"];
  corridasPorImagen: number;
  maxUsd: number;
  concurrencia: number;
  plazoPorAnalisisMs: number;
  tabla: TablaPrecios;
  supuesto: SupuestoConteo;
  instante: Date;
};

export type PlanConteo = {
  run_id: string;
  imagenes: number;
  corridas_por_imagen: number;
  analisis_totales: number;
  analisis_pendientes: number;
  estimacion: EstimacionConteo;
  cabe_en_presupuesto: boolean;
};

function validarConfiguracion(config: ConfiguracionConteo, items: readonly ItemSuite[]): void {
  if (!Number.isInteger(config.corridasPorImagen) || config.corridasPorImagen < 1 || config.corridasPorImagen > LIMITES_RUNNER.corridasMaximas) throw new Error("corridasPorImagen fuera de rango");
  if (!Number.isInteger(config.concurrencia) || config.concurrencia < 1 || config.concurrencia > LIMITES_RUNNER.concurrenciaMaxima) throw new Error(`concurrencia debe ser 1-${LIMITES_RUNNER.concurrenciaMaxima}`);
  if (!Number.isFinite(config.plazoPorAnalisisMs) || config.plazoPorAnalisisMs < 1_000 || config.plazoPorAnalisisMs > LIMITES_RUNNER.plazoMaximoMs) throw new Error("plazoPorAnalisisMs fuera de rango");
  if (Number.isNaN(config.maxUsd) || config.maxUsd < 0) throw new Error("maxUsd inválido");
  if (items.length - new Set(items.map((item) => item.image_sha256)).size > 0) throw new Error("la suite repite imágenes");
  const sinPermiso = items.filter((item) => !item.evaluacion_con_proveedor_externo || !item.envio_proveedores_ia_permitido);
  if (sinPermiso.length > 0) throw new Error(`${sinPermiso.length} ítem(s) sin permiso de evaluación con proveedor externo: la suite completa se rechaza`);
}

/** Vista previa: valida y estima sin tocar el analizador (sin red). */
export function planificarConteo(config: ConfiguracionConteo, items: readonly ItemSuite[], yaHechas: ReadonlySet<string> = new Set()): PlanConteo {
  validarConfiguracion(config, items);
  const totales = items.length * config.corridasPorImagen;
  const pendientes = items.reduce((suma, item) => suma + Array.from({ length: config.corridasPorImagen }, (_, i) => claveCorrida(item.image_sha256, i + 1)).filter((clave) => !yaHechas.has(clave)).length, 0);
  const estimacion = estimarConteo({ tabla: config.tabla, supuesto: config.supuesto, modelo: config.sistema.modelo, instante: config.instante, analisis: pendientes });
  return { run_id: config.runId, imagenes: items.length, corridas_por_imagen: config.corridasPorImagen, analisis_totales: totales, analisis_pendientes: pendientes, estimacion, cabe_en_presupuesto: Number.isFinite(config.maxUsd) && estimacion.cota_superior_usd <= config.maxUsd };
}

export type ResultadoCorridaConteo = { plan: PlanConteo; lineas: PrediccionConteoV1[]; costo_reportado_usd: number; omitidas_por_presupuesto: number };

/**
 * Corre los análisis pendientes. Fotos distintas en paralelo (≤ concurrencia);
 * antes de cada análisis el presupuesto restante tiene que cubrir su cota
 * superior (se reserva y se libera lo no usado solo si el uso reportado está
 * completo: un timeout o un uso sin reportar no prueban que no se cobró).
 * `alEscribir` recibe cada línea en cuanto existe: una corrida cortada se reanuda.
 */
export async function ejecutarConteo(input: {
  config: ConfiguracionConteo;
  items: readonly ItemSuite[];
  analizar: AnalizadorConteo;
  yaHechas?: ReadonlySet<string>;
  alEscribir: (linea: PrediccionConteoV1) => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<ResultadoCorridaConteo> {
  const { config, items, analizar } = input;
  const plan = planificarConteo(config, items, input.yaHechas);
  const unitaria = estimarConteo({ tabla: config.tabla, supuesto: config.supuesto, modelo: config.sistema.modelo, instante: config.instante, analisis: 1 });
  const precio = precioVigente(config.tabla, config.sistema.modelo, config.instante);
  const lineas: PrediccionConteoV1[] = [];
  let reservado = 0;
  let costoReal = 0;
  let omitidas = 0;

  const linea = (item: ItemSuite, corrida: number, analisis: ResultadoConteo | { resultado: "omitida_por_presupuesto" }): PrediccionConteoV1 => PrediccionConteoV1Schema.parse({
    schema: PREDICCION_CONTEO_SCHEMA_ID,
    run_id: config.runId,
    corrida,
    image_sha256: item.image_sha256,
    sistema: config.sistema,
    resultado: analisis.resultado,
    piezas: analisis.resultado === "ok" ? analisis.piezas : [],
    uso_reportado: "uso" in analisis
      ? { tokens_entrada: analisis.uso.entrada, tokens_salida: analisis.uso.salida, tokens_pensamiento: analisis.uso.pensamiento ?? 0, completo: analisis.uso.completo }
      : { tokens_entrada: 0, tokens_salida: 0, tokens_pensamiento: 0, completo: true },
    latencia_ms: "msTotal" in analisis ? Math.round(analisis.msTotal) : 0,
    raw_output_sha256: analisis.resultado === "ok" ? analisis.rawOutputSha256 : null,
  });

  const porImagen = async (item: ItemSuite) => {
    for (let corrida = 1; corrida <= config.corridasPorImagen; corrida += 1) {
      if (input.yaHechas?.has(claveCorrida(item.image_sha256, corrida))) continue;
      if (input.signal?.aborted) return;
      let nueva: PrediccionConteoV1;
      if (unitaria.cota_superior_usd > config.maxUsd - reservado) {
        omitidas += 1;
        nueva = linea(item, corrida, { resultado: "omitida_por_presupuesto" });
      } else {
        reservado += unitaria.cota_superior_usd;
        const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(config.plazoPorAnalisisMs)]) : AbortSignal.timeout(config.plazoPorAnalisisMs);
        const inicio = Date.now();
        let analisis: ResultadoConteo;
        try {
          analisis = await analizar(item, signal);
        } catch (error) {
          const nombre = error instanceof Error ? error.name : "";
          analisis = { resultado: nombre === "TimeoutError" ? "timeout" : nombre === "AbortError" ? "cancelado" : "error", uso: { entrada: 0, salida: 0, completo: false }, msTotal: Date.now() - inicio };
        }
        const gastado = costo(analisis.uso, precio);
        costoReal += gastado;
        if (analisis.uso.completo && analisis.resultado !== "timeout") reservado -= Math.max(0, unitaria.cota_superior_usd - gastado);
        nueva = linea(item, corrida, analisis);
      }
      lineas.push(nueva);
      await input.alEscribir(nueva);
    }
  };

  const cola = [...items];
  await Promise.all(Array.from({ length: Math.min(config.concurrencia, cola.length) }, async () => {
    for (let item = cola.shift(); item; item = cola.shift()) await porImagen(item);
  }));
  return { plan, lineas, costo_reportado_usd: costoReal, omitidas_por_presupuesto: omitidas };
}

/** `run.json` de una corrida de conteo: plan, costo y, con verdad humana, las métricas. */
export function resumirConteo(input: {
  corrida: ResultadoCorridaConteo;
  todasLasLineas: readonly PrediccionConteoV1[];
  verdad: ReadonlyMap<string, VerdadConteo> | null;
  generadoEn: Date;
  suite: { id: string; manifiesto_sha256: string };
}) {
  const latencias = input.todasLasLineas.filter((linea) => linea.resultado === "ok").map((linea) => linea.latencia_ms);
  return {
    schema: "run-conteo.v1",
    run_id: input.corrida.plan.run_id,
    generado_en: input.generadoEn.toISOString(),
    suite: input.suite,
    plan: input.corrida.plan,
    costo: {
      estimado: input.corrida.plan.estimacion,
      reportado_usd: input.corrida.costo_reportado_usd,
      uso_incompleto: input.todasLasLineas.filter((linea) => !linea.uso_reportado.completo).length,
      omitidas_por_presupuesto: input.corrida.omitidas_por_presupuesto,
    },
    resultados: Object.fromEntries(["ok", "error", "timeout", "cancelado", "omitida_por_presupuesto"].map((resultado) => [resultado, input.todasLasLineas.filter((linea) => linea.resultado === resultado).length])),
    latencia_ms: { n: latencias.length, p50: percentil(latencias, 50), p95: percentil(latencias, 95) },
    metricas: input.verdad ? metricasConteo(input.todasLasLineas, input.verdad) : null,
  };
}
