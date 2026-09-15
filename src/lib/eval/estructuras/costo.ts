import { calcularCosteEstimado } from "@sempertex/agente-core";
import { z } from "zod";

/**
 * Cost estimate for a recognition run (Fundamentos §8.6, Plan A §A0.3).
 * Prices come only from the dated table in `eval/estructuras/precios/`;
 * token usage per pass comes from a measured assumption file, never from
 * constants in code. The arithmetic is agente-core's `calcularCosteEstimado`.
 * Everything here is labelled estimated, never billed.
 */

const PrecioSchema = z.object({
  proveedor: z.enum(["gemini"]),
  modelo: z.string().min(1).max(200),
  tipo_unidad: z.literal("millon_tokens"),
  vigente_desde: z.iso.datetime(),
  vigente_hasta: z.iso.datetime().nullable(),
  precio_entrada: z.number().nonnegative(),
  precio_salida: z.number().nonnegative(),
  precio_cacheado: z.number().nonnegative(),
  moneda: z.literal("USD"),
  fuente: z.string().min(1).max(1000),
}).strict().refine((precio) => precio.vigente_hasta === null || Date.parse(precio.vigente_hasta) > Date.parse(precio.vigente_desde), "vigencia vacía");

export const TablaPreciosSchema = z.object({
  version: z.string().regex(/^precios-\d{4}-\d{2}-\d{2}$/),
  consultado_en: z.iso.date(),
  nota: z.string().max(2000),
  precios: z.array(PrecioSchema).min(1),
}).strict();

export type TablaPrecios = z.infer<typeof TablaPreciosSchema>;
export type PrecioTabla = TablaPrecios["precios"][number];

/** Price in force for a model at an instant; throws when none or more than one applies. */
export function precioVigente(tabla: TablaPrecios, modelo: string, instante: Date): PrecioTabla {
  const t = instante.getTime();
  const vigentes = tabla.precios.filter((precio) => precio.modelo === modelo
    && Date.parse(precio.vigente_desde) <= t
    && (precio.vigente_hasta === null || t < Date.parse(precio.vigente_hasta)));
  if (vigentes.length !== 1) {
    throw new Error(`${tabla.version}: ${vigentes.length === 0 ? "sin precio" : "precios solapados"} para ${modelo} en ${instante.toISOString()}`);
  }
  return vigentes[0]!;
}

const TokensPaseSchema = z.object({
  entrada: z.number().nonnegative(),
  salida: z.number().nonnegative(),
  pensamiento: z.number().nonnegative(),
  cacheados: z.number().nonnegative(),
}).strict();

/** Measured tokens per image for one pass: typical (p50) and high (p95). */
const PaseSupuestoSchema = z.object({ p50: TokensPaseSchema, p95: TokensPaseSchema }).strict();

export const SupuestoTokensSchema = z.object({
  version: z.string().min(1).max(80),
  modelo: z.string().min(1).max(200),
  /** How the numbers were obtained (read-only query and its window), for the run record. */
  origen: z.string().min(1).max(1000),
  n_llamadas: z.number().int().positive(),
  inventario: PaseSupuestoSchema,
  auditoria: PaseSupuestoSchema,
  /** Calls that were a malformed-output retry, per pass (informative). */
  reintentos: z.record(z.string(), z.number().int().nonnegative()).optional(),
  /** First and last day of the measured window. */
  ventana: z.object({ desde: z.iso.date(), hasta: z.iso.date() }).strict().optional(),
}).strict();

export type SupuestoTokens = z.infer<typeof SupuestoTokensSchema>;

export type EstimacionCosto = {
  moneda: "USD";
  es_estimado: true;
  precio_version: string;
  supuesto_version: string;
  llamadas_analisis: number;
  /** Every analysis at p50 tokens, one attempt per pass. */
  esperado_usd: number;
  /** Every analysis at p95 tokens with every pass retried up to the attempt limit. */
  cota_superior_usd: number;
};

function costoPase(tokens: z.infer<typeof TokensPaseSchema>, precio: PrecioTabla): number {
  return calcularCosteEstimado(
    { tokensEntrada: tokens.entrada, tokensSalida: tokens.salida, tokensPensamiento: tokens.pensamiento, tokensCacheados: tokens.cacheados },
    { tipoUnidad: "millon_tokens", precioEntrada: precio.precio_entrada, precioSalida: precio.precio_salida, precioCacheado: precio.precio_cacheado, moneda: precio.moneda },
  );
}

export function estimarCostoCorrida(input: {
  tabla: TablaPrecios;
  supuesto: SupuestoTokens;
  modelo: string;
  instante: Date;
  imagenes: number;
  corridasPorImagen: number;
  /** Provider attempts allowed per pass (malformed-output retry). */
  intentosMaximosPorPase: number;
}): EstimacionCosto {
  if (input.supuesto.modelo !== input.modelo) throw new Error(`el supuesto de tokens es de ${input.supuesto.modelo}, no de ${input.modelo}`);
  for (const [nombre, valor] of [["imagenes", input.imagenes], ["corridasPorImagen", input.corridasPorImagen], ["intentosMaximosPorPase", input.intentosMaximosPorPase]] as const) {
    if (!Number.isInteger(valor) || valor < (nombre === "imagenes" ? 0 : 1)) throw new Error(`${nombre} inválido: ${valor}`);
  }
  const precio = precioVigente(input.tabla, input.modelo, input.instante);
  const analisis = input.imagenes * input.corridasPorImagen;
  const esperadoPorAnalisis = costoPase(input.supuesto.inventario.p50, precio) + costoPase(input.supuesto.auditoria.p50, precio);
  const altoPorAnalisis = (costoPase(input.supuesto.inventario.p95, precio) + costoPase(input.supuesto.auditoria.p95, precio)) * input.intentosMaximosPorPase;
  return {
    moneda: "USD",
    es_estimado: true,
    precio_version: input.tabla.version,
    supuesto_version: input.supuesto.version,
    llamadas_analisis: analisis,
    esperado_usd: analisis * esperadoPorAnalisis,
    cota_superior_usd: analisis * altoPorAnalisis,
  };
}

/** Budget gate: a run is allowed only when its upper bound fits the remaining budget. */
export function cabeEnPresupuesto(estimacion: EstimacionCosto, presupuestoRestanteUsd: number): boolean {
  return Number.isFinite(presupuestoRestanteUsd) && estimacion.cota_superior_usd <= presupuestoRestanteUsd;
}
