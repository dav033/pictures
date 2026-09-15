import { calcularCosteEstimado } from "@sempertex/agente-core";
import { z } from "zod";
import { cabeEnPresupuesto, estimarCostoCorrida, precioVigente, type EstimacionCosto, type SupuestoTokens, type TablaPrecios } from "./costo";
import { instanciasDesdeDetecciones, PrediccionEstructurasV1Schema, type DeteccionV1, type PrediccionEstructurasV1 } from "./prediccion";

/**
 * Recognition runner core (Plan A §A0.3). Provider-agnostic: the analysis is
 * an injected function, so preview, budget, concurrency, deadlines and resume
 * are tested with simulated ports. The CLI and the analizarReferenciasV2
 * adapter live elsewhere.
 */

/** One image of an evaluation suite. The image stays in private storage; only its hash is recorded. */
export const ItemSuiteSchema = z.object({
  image_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  ruta_privada: z.string().min(1).max(1000),
  /** Fundamentos §8.1: provider runs only accept items explicitly cleared for it. */
  evaluacion_con_proveedor_externo: z.boolean(),
  envio_proveedores_ia_permitido: z.boolean(),
}).strict();
export type ItemSuite = z.infer<typeof ItemSuiteSchema>;

export type PaseResultado = {
  capacidad: "analisis_referencia_inventario" | "analisis_referencia_auditoria";
  intento: number;
  ms: number;
  uso: { entrada: number; salida: number; pensamiento?: number; cacheados?: number };
  finishReason?: string;
  malformado: boolean;
};

export type ResultadoAnalisis =
  | { resultado: "ok"; detecciones: DeteccionV1[]; pases: PaseResultado[]; rawOutputSha256: string; msTotal: number }
  | { resultado: "error" | "timeout" | "cancelado"; pases: PaseResultado[]; msTotal: number };

export type Analizador = (item: ItemSuite, signal: AbortSignal) => Promise<ResultadoAnalisis>;

export type ConfiguracionRunner = {
  runId: string;
  sistema: PrediccionEstructurasV1["sistema"];
  corridasPorImagen: number;
  maxUsd: number;
  concurrencia: number;
  plazoPorAnalisisMs: number;
  intentosMaximosPorPase: number;
  tabla: TablaPrecios;
  supuesto: SupuestoTokens;
  instante: Date;
};

export const LIMITES_RUNNER = { concurrenciaMaxima: 4, corridasMaximas: 20, plazoMaximoMs: 180_000 } as const;

function validarConfiguracion(config: ConfiguracionRunner, items: readonly ItemSuite[]): void {
  if (!Number.isInteger(config.corridasPorImagen) || config.corridasPorImagen < 1 || config.corridasPorImagen > LIMITES_RUNNER.corridasMaximas) throw new Error("corridasPorImagen fuera de rango");
  if (!Number.isInteger(config.concurrencia) || config.concurrencia < 1 || config.concurrencia > LIMITES_RUNNER.concurrenciaMaxima) throw new Error(`concurrencia debe ser 1-${LIMITES_RUNNER.concurrenciaMaxima}`);
  if (!Number.isFinite(config.plazoPorAnalisisMs) || config.plazoPorAnalisisMs < 1_000 || config.plazoPorAnalisisMs > LIMITES_RUNNER.plazoMaximoMs) throw new Error("plazoPorAnalisisMs fuera de rango");
  if (!Number.isFinite(config.maxUsd) || config.maxUsd < 0) throw new Error("maxUsd inválido");
  const duplicados = items.length - new Set(items.map((item) => item.image_sha256)).size;
  if (duplicados > 0) throw new Error(`la suite repite ${duplicados} imagen(es)`);
  const sinPermiso = items.filter((item) => !item.evaluacion_con_proveedor_externo || !item.envio_proveedores_ia_permitido);
  if (sinPermiso.length > 0) throw new Error(`${sinPermiso.length} ítem(s) sin permiso de evaluación con proveedor externo: la suite completa se rechaza`);
}

export type PlanCorrida = {
  run_id: string;
  imagenes: number;
  corridas_por_imagen: number;
  analisis_totales: number;
  analisis_pendientes: number;
  estimacion: EstimacionCosto;
  cabe_en_presupuesto: boolean;
};

/** `--preview`: validates and estimates without touching the analyzer (no network). */
export function planificarCorrida(config: ConfiguracionRunner, items: readonly ItemSuite[], yaHechas: ReadonlySet<string> = new Set()): PlanCorrida {
  validarConfiguracion(config, items);
  const totales = items.length * config.corridasPorImagen;
  const pendientes = items.reduce((suma, item) => suma + Array.from({ length: config.corridasPorImagen }, (_, i) => claveCorrida(item.image_sha256, i + 1)).filter((clave) => !yaHechas.has(clave)).length, 0);
  const unitaria = estimarCostoCorrida({ tabla: config.tabla, supuesto: config.supuesto, modelo: config.sistema.modelo, instante: config.instante, imagenes: 1, corridasPorImagen: 1, intentosMaximosPorPase: config.intentosMaximosPorPase });
  const estimacion: EstimacionCosto = { ...unitaria, llamadas_analisis: pendientes, esperado_usd: unitaria.esperado_usd * pendientes, cota_superior_usd: unitaria.cota_superior_usd * pendientes };
  return { run_id: config.runId, imagenes: items.length, corridas_por_imagen: config.corridasPorImagen, analisis_totales: totales, analisis_pendientes: pendientes, estimacion, cabe_en_presupuesto: cabeEnPresupuesto(estimacion, config.maxUsd) };
}

export function claveCorrida(imageSha256: string, corrida: number): string {
  return `${imageSha256}#${corrida}`;
}

function costoReportado(pases: readonly PaseResultado[], config: ConfiguracionRunner): number {
  const precio = precioVigente(config.tabla, config.sistema.modelo, config.instante);
  return pases.reduce((suma, pase) => suma + calcularCosteEstimado(
    { tokensEntrada: pase.uso.entrada, tokensSalida: pase.uso.salida, tokensPensamiento: pase.uso.pensamiento ?? 0, tokensCacheados: pase.uso.cacheados ?? 0 },
    { tipoUnidad: "millon_tokens", precioEntrada: precio.precio_entrada, precioSalida: precio.precio_salida, precioCacheado: precio.precio_cacheado, moneda: precio.moneda },
  ), 0);
}

function lineaDesde(config: ConfiguracionRunner, item: ItemSuite, corrida: number, analisis: ResultadoAnalisis | { resultado: "omitida_por_presupuesto" }): PrediccionEstructurasV1 {
  const pases = "pases" in analisis ? analisis.pases : [];
  const ms = (capacidad: PaseResultado["capacidad"]) => {
    const propios = pases.filter((pase) => pase.capacidad === capacidad);
    return propios.length ? propios.reduce((suma, pase) => suma + pase.ms, 0) : null;
  };
  return PrediccionEstructurasV1Schema.parse({
    schema: "prediccion-estructuras.v1",
    run_id: config.runId,
    corrida,
    image_sha256: item.image_sha256,
    sistema: config.sistema,
    resultado: analisis.resultado,
    instancias: analisis.resultado === "ok" ? instanciasDesdeDetecciones(analisis.detecciones) : [],
    raw_output_sha256: analisis.resultado === "ok" ? analisis.rawOutputSha256 : null,
    uso_reportado: {
      tokens_entrada: pases.reduce((suma, pase) => suma + pase.uso.entrada, 0),
      tokens_salida: pases.reduce((suma, pase) => suma + pase.uso.salida, 0),
      tokens_pensamiento: pases.reduce((suma, pase) => suma + (pase.uso.pensamiento ?? 0), 0),
      tokens_cacheados: pases.reduce((suma, pase) => suma + (pase.uso.cacheados ?? 0), 0),
      llamadas: pases.length,
      finish_reasons: pases.flatMap((pase) => (pase.finishReason ? [pase.finishReason] : [])),
    },
    latencia_ms: { total: "msTotal" in analisis ? Math.round(analisis.msTotal) : 0, inventario: ms("analisis_referencia_inventario"), auditoria: ms("analisis_referencia_auditoria") },
  });
}

export type ResultadoCorrida = {
  plan: PlanCorrida;
  lineas: PrediccionEstructurasV1[];
  pases: PaseResultado[];
  costo_reportado_usd: number;
  omitidas_por_presupuesto: number;
};

/**
 * Runs the pending analyses. Different images run concurrently (≤ concurrencia);
 * repetitions of one image run in sequence, because analizarReferenciasV2 shares
 * an in-flight call for identical photos. Before each analysis the remaining
 * budget must cover its upper bound; otherwise the rest is recorded as skipped.
 * `alEscribir` receives each line as soon as it exists, so an interrupted run
 * resumes from what was written.
 */
export async function ejecutarCorrida(input: {
  config: ConfiguracionRunner;
  items: readonly ItemSuite[];
  analizar: Analizador;
  yaHechas?: ReadonlySet<string>;
  alEscribir: (linea: PrediccionEstructurasV1) => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<ResultadoCorrida> {
  const { config, items, analizar } = input;
  const plan = planificarCorrida(config, items, input.yaHechas);
  const unitaria = estimarCostoCorrida({ tabla: config.tabla, supuesto: config.supuesto, modelo: config.sistema.modelo, instante: config.instante, imagenes: 1, corridasPorImagen: 1, intentosMaximosPorPase: config.intentosMaximosPorPase });
  const lineas: PrediccionEstructurasV1[] = [];
  const pases: PaseResultado[] = [];
  let reservadoUsd = 0;
  let costoReal = 0;
  let omitidas = 0;

  const porImagen = async (item: ItemSuite) => {
    for (let corrida = 1; corrida <= config.corridasPorImagen; corrida += 1) {
      if (input.yaHechas?.has(claveCorrida(item.image_sha256, corrida))) continue;
      if (input.signal?.aborted) return;
      let linea: PrediccionEstructurasV1;
      // Reserve the upper bound before calling; release the unused part after.
      if (!cabeEnPresupuesto(unitaria, config.maxUsd - reservadoUsd)) {
        omitidas += 1;
        linea = lineaDesde(config, item, corrida, { resultado: "omitida_por_presupuesto" });
      } else {
        reservadoUsd += unitaria.cota_superior_usd;
        const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(config.plazoPorAnalisisMs)]) : AbortSignal.timeout(config.plazoPorAnalisisMs);
        const inicio = Date.now();
        let analisis: ResultadoAnalisis;
        try {
          analisis = await analizar(item, signal);
        } catch (error) {
          const nombre = error instanceof Error ? error.name : "";
          analisis = { resultado: nombre === "TimeoutError" ? "timeout" : nombre === "AbortError" ? "cancelado" : "error", pases: [], msTotal: Date.now() - inicio };
        }
        const costo = costoReportado(analisis.pases, config);
        costoReal += costo;
        // A timeout does not prove the provider did not bill: keep the full reservation then.
        reservadoUsd -= analisis.resultado === "timeout" ? 0 : Math.max(0, unitaria.cota_superior_usd - costo);
        pases.push(...analisis.pases);
        linea = lineaDesde(config, item, corrida, analisis);
      }
      lineas.push(linea);
      await input.alEscribir(linea);
    }
  };

  const cola = [...items];
  await Promise.all(Array.from({ length: Math.min(config.concurrencia, cola.length) }, async () => {
    for (let item = cola.shift(); item; item = cola.shift()) await porImagen(item);
  }));
  return { plan, lineas, pases, costo_reportado_usd: costoReal, omitidas_por_presupuesto: omitidas };
}
