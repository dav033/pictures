import type { PrediccionEstructurasV1 } from "./prediccion";
import type { PaseResultado, ResultadoCorrida } from "./runner";

/**
 * `run.json` summary of a recognition run (Plan A §A0.4a, Fundamentos §8.1).
 * Only stability, latency, format and cost: there is no human truth yet, so no
 * accuracy metric is computed or implied. Pure function over recorded data.
 */

/** Nearest-rank percentile; null for an empty list. */
export function percentil(valores: readonly number[], p: number): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const rango = Math.ceil((p / 100) * ordenados.length);
  return ordenados[Math.min(ordenados.length, Math.max(1, rango)) - 1]!;
}

const latencias = (valores: readonly number[]) => ({ n: valores.length, p50: percentil(valores, 50), p95: percentil(valores, 95) });

/** Order-free signature of the families an analysis found (ambiguous instances count as their candidate set). */
export function firmaFamilias(linea: PrediccionEstructurasV1): string {
  return linea.instancias
    .map((instancia) => instancia.familia ?? `ambigua(${[...instancia.candidatos].sort().join("|")})`)
    .sort()
    .join(",");
}

/**
 * Class flip rate per image: share of its ok runs whose family signature differs
 * from the most frequent one (ties broken by signature order, deterministic).
 * The run-level value is the mean over images with at least two ok runs.
 */
export function flipRate(lineas: readonly PrediccionEstructurasV1[]): { imagenes_evaluadas: number; media: number | null; por_imagen: Record<string, number> } {
  const porImagen = new Map<string, string[]>();
  for (const linea of lineas) {
    if (linea.resultado !== "ok") continue;
    porImagen.set(linea.image_sha256, [...(porImagen.get(linea.image_sha256) ?? []), firmaFamilias(linea)]);
  }
  const tasas: Record<string, number> = {};
  for (const [imagen, firmas] of porImagen) {
    if (firmas.length < 2) continue;
    const conteo = new Map<string, number>();
    for (const firma of firmas) conteo.set(firma, (conteo.get(firma) ?? 0) + 1);
    const [, moda] = [...conteo.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]!;
    tasas[imagen] = (firmas.length - moda) / firmas.length;
  }
  const valores = Object.values(tasas);
  return { imagenes_evaluadas: valores.length, media: valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null, por_imagen: tasas };
}

export type RunJson = ReturnType<typeof resumirCorrida>;

export function resumirCorrida(input: {
  corrida: ResultadoCorrida;
  generadoEn: Date;
  suite: { id: string; manifiesto_sha256: string };
  /** Includes lines written by earlier, resumed invocations. */
  todasLasLineas: readonly PrediccionEstructurasV1[];
  pasesPrevios?: readonly PaseResultado[];
}) {
  const { corrida } = input;
  const lineas = input.todasLasLineas;
  const pases = [...(input.pasesPrevios ?? []), ...corrida.pases];
  const sistemas = new Set(lineas.map((linea) => JSON.stringify(linea.sistema)));
  if (sistemas.size > 1) throw new Error("run.json: las líneas mezclan versiones del sistema; no son una sola corrida");
  const porResultado = lineas.reduce<Record<string, number>>((acumulado, linea) => ({ ...acumulado, [linea.resultado]: (acumulado[linea.resultado] ?? 0) + 1 }), {});
  const deCapacidad = (capacidad: PaseResultado["capacidad"]) => pases.filter((pase) => pase.capacidad === capacidad);
  const finish = pases.reduce<Record<string, number>>((acumulado, pase) => {
    const clave = pase.finishReason ?? "SIN_REPORTE";
    return { ...acumulado, [clave]: (acumulado[clave] ?? 0) + 1 };
  }, {});
  const malformados = pases.filter((pase) => pase.malformado).length;
  const ok = lineas.filter((linea) => linea.resultado === "ok");
  return {
    schema: "run-reconocimiento-estructuras.v1" as const,
    run_id: corrida.plan.run_id,
    generado_en: input.generadoEn.toISOString(),
    sistema: lineas[0]?.sistema ?? null,
    suite: input.suite,
    metricas_de_exactitud: "no_calculadas_sin_verdad_humana" as const,
    conteos: {
      imagenes: corrida.plan.imagenes,
      corridas_por_imagen: corrida.plan.corridas_por_imagen,
      analisis_totales: corrida.plan.analisis_totales,
      lineas: lineas.length,
      por_resultado: porResultado,
      instancias_ok: ok.reduce((suma, linea) => suma + linea.instancias.length, 0),
    },
    latencia_ms: {
      punta_a_punta: latencias(ok.map((linea) => linea.latencia_ms.total)),
      inventario: latencias(deCapacidad("analisis_referencia_inventario").map((pase) => pase.ms)),
      auditoria: latencias(deCapacidad("analisis_referencia_auditoria").map((pase) => pase.ms)),
    },
    formato: {
      intentos: pases.length,
      intentos_malformados: malformados,
      tasa_malformada: pases.length ? malformados / pases.length : null,
      finish_reasons: finish,
    },
    estabilidad: { flip_rate_familias: flipRate(lineas) },
    costo: {
      moneda: "USD" as const,
      estimado_previo: corrida.plan.estimacion,
      reportado_usd: corrida.costo_reportado_usd,
      reportado_es_estimado_desde_tokens_reportados: true as const,
      omitidas_por_presupuesto: corrida.omitidas_por_presupuesto,
      /** G0: reported within ±30 % of the p50 estimate; null when nothing ran. */
      desviacion_vs_esperado: corrida.plan.estimacion.esperado_usd > 0 && corrida.costo_reportado_usd > 0
        ? corrida.costo_reportado_usd / corrida.plan.estimacion.esperado_usd - 1
        : null,
    },
  };
}
