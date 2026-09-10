import type { Pool } from "pg";
import type { CuotaPlan } from "../presupuesto/plan";
import type { RolPresupuesto } from "../presupuesto/franjas";
import { buscarHibrido } from "./search";
import type { RerankStatus } from "./search";
import type { CatalogAllowlist, EventSearchIntent, EstadoSku, ResultadoRetrieval } from "./types";

export type CandidatoRol = ResultadoRetrieval & { rol: RolPresupuesto };

export type ResultadoPorRol = {
  rol: RolPresupuesto;
  candidatos: CandidatoRol[];
  skuStatus?: EstadoSku;
  /** Cada relajación aplicada, en el orden en que se probó — nunca se
   * relaja en silencio (§3, "Escalera de relajación"). Vacío si el intento
   * base ya tuvo resultados. */
  relajaciones: string[];
  rerankStatus?: RerankStatus;
};

export type FiltrosBaseRol = {
  colores?: string[];
  ocasiones?: string[];
  acabados?: string[];
  formas?: string[];
  diametrosPulgadas?: number[];
  disponible?: boolean;
  /** Open event ranking context; never converted into a hard SQL predicate. */
  eventIntent?: EventSearchIntent;
  focusedQueries?: readonly string[];
  allowlist?: CatalogAllowlist;
  rerankRequestId?: string;
  rerankCorrelationId?: string;
  rerankSignal?: AbortSignal;
  rerankDeadlineAt?: number;
  embeddingFallido?: boolean;
};

// Frase que orienta el retrieval semántico hacia lo que ese rol necesita
// (§3, Etapa 2) — los filtros duros de categoría son los que de verdad
// acotan el resultado; esto sólo ordena mejor dentro de esa categoría.
const PISTA_POR_ROL: Record<RolPresupuesto, string> = {
  focal: "elemento protagonista de la decoración: arco, guirnalda o kit armado",
  soporte: "fondo, telón o estructura de soporte para el montaje",
  relleno: "globos de relleno y volumen de color",
  acento: "detalle o acento decorativo pequeño",
  servicio: "vajilla, desechables o empaque para la mesa",
};

function combinarRerankStatus(
  current: RerankStatus | undefined,
  next: RerankStatus | undefined,
): RerankStatus | undefined {
  if (!current) return next;
  if (!next) return current;
  if (current === "ERROR" || next === "ERROR") return "ERROR";
  if (current === "READY" || next === "READY") return "READY";
  return "SKIPPED_OPTIONAL";
}

/**
 * Retrieval de un rol de la canasta (§3, Etapa 2): filtro duro de categorías
 * del rol + banda de precio a nivel de VARIANTE (nunca `price_min`, ver F2)
 * + escalera de relajación documentada cuando el pool queda vacío.
 *
 * Un solo embedding para todo el turno se pasa en `embeddingBase` — cada
 * llamada por rol reutiliza el mismo vector; sólo cambia el texto de
 * full-text y los filtros duros.
 */
export async function buscarPorRol(
  pool: Pool,
  mensajeBase: string,
  embeddingBase: number[] | undefined,
  cuota: CuotaPlan,
  filtrosBase: FiltrosBaseRol,
): Promise<ResultadoPorRol> {
  if (cuota.max <= 0 || cuota.categorias.length === 0) {
    return { rol: cuota.rol, candidatos: [], relajaciones: [] };
  }

  const semanticQuery = `${mensajeBase} — ${PISTA_POR_ROL[cuota.rol]}`;
  const topeAmpliado = Math.round(cuota.topeCop * 1.15);

  type Intento = {
    categorias: readonly string[];
    colores?: string[];
    ocasiones?: string[];
    acabados?: string[];
    formas?: string[];
    diametrosPulgadas?: number[];
    topeCop: number;
    etiqueta: string;
  };
  const intentos: Intento[] = [
    {
      categorias: cuota.categorias,
      colores: filtrosBase.colores,
        ocasiones: filtrosBase.ocasiones,
        acabados: filtrosBase.acabados,
      formas: filtrosBase.formas,
      diametrosPulgadas: filtrosBase.diametrosPulgadas,
      topeCop: cuota.topeCop,
      etiqueta: "",
    },
    {
      categorias: cuota.categorias,
      colores: filtrosBase.colores,
        ocasiones: filtrosBase.ocasiones,
        acabados: filtrosBase.acabados,
      formas: filtrosBase.formas,
      diametrosPulgadas: filtrosBase.diametrosPulgadas,
      topeCop: topeAmpliado,
      etiqueta: `tope ampliado 15% (hasta $${topeAmpliado.toLocaleString("es-CO")})`,
    },
  ];
  if (filtrosBase.colores?.length) {
    intentos.push({
      categorias: cuota.categorias,
      colores: undefined,
        ocasiones: filtrosBase.ocasiones,
        acabados: filtrosBase.acabados,
      formas: filtrosBase.formas,
      diametrosPulgadas: filtrosBase.diametrosPulgadas,
      topeCop: topeAmpliado,
      etiqueta: "color pasó de filtro duro a señal de ranking",
    });
  }
  if (filtrosBase.ocasiones?.length) {
    intentos.push({
      categorias: cuota.categorias,
      colores: undefined,
        ocasiones: undefined,
        acabados: filtrosBase.acabados,
      formas: filtrosBase.formas,
      diametrosPulgadas: filtrosBase.diametrosPulgadas,
      topeCop: topeAmpliado,
      etiqueta: "ocasión pasó de filtro duro a señal de ranking",
    });
  }
  if (cuota.categoriasRelajacion.length) {
    intentos.push({
      categorias: [...cuota.categorias, ...cuota.categoriasRelajacion],
      colores: undefined,
        ocasiones: undefined,
        acabados: filtrosBase.acabados,
      formas: filtrosBase.formas,
      diametrosPulgadas: filtrosBase.diametrosPulgadas,
      topeCop: topeAmpliado,
      etiqueta: `categorías ampliadas (+${cuota.categoriasRelajacion.join(", ")})`,
    });
  }

  // PLAN_RENDIMIENTO_RAG.md Fase 6: se probó lanzar todos los `intentos` en
  // paralelo (Promise.all) en vez de secuencial. Medido con
  // scripts/eval-presupuesto.ts contra el catálogo real (8/12 casos SÍ
  // activan la escalera, hasta 5 relajaciones por caso — no es un escenario
  // raro): la latencia NO mejoró (p50 1674ms secuencial vs 1752-1887ms en
  // paralelo, dos corridas). Se descartó contención del pool de Postgres
  // como causa — con `max: 50` en vez del default (10) tampoco mejoró
  // (p50 1977ms). La causa real no se investigó más a fondo: el plan mismo
  // clasificó esta fase como "impacto medio, 8% del problema", y ya se
  // gastó más esfuerzo de diagnóstico del que ese impacto justifica. Se
  // revirtió a secuencial — pagar más queries (hasta 5x por rol) sin
  // ganancia medida es peor, no mejor.
  const relajaciones: string[] = [];
  let rerankStatus: RerankStatus | undefined;
  for (const intento of intentos) {
    const respuesta = await buscarHibrido(pool, {
      semanticQuery,
      embeddingPrecalculado: embeddingBase,
      embeddingFallido: filtrosBase.embeddingFallido,
      eventIntent: filtrosBase.eventIntent,
      eventTerms: filtrosBase.eventIntent?.event_terms,
      focusedQueries: filtrosBase.focusedQueries?.length
        ? [...filtrosBase.focusedQueries, semanticQuery]
        : undefined,
        allowlist: filtrosBase.allowlist,
        rerankRequestId: filtrosBase.rerankRequestId,
        rerankCorrelationId: filtrosBase.rerankCorrelationId,
        rerankSignal: filtrosBase.rerankSignal,
        rerankDeadlineAt: filtrosBase.rerankDeadlineAt,
        filtros: {
        disponible: filtrosBase.disponible ?? true,
        precioMax: intento.topeCop,
        categorias: [...intento.categorias],
        ocasiones: intento.ocasiones,
            colores: intento.colores,
            acabados: intento.acabados,
        formas: intento.formas,
        diametrosPulgadas: intento.diametrosPulgadas,
      },
      });
    const attemptRerankStatus = respuesta.branchStatus?.rerank;
    rerankStatus = combinarRerankStatus(
      rerankStatus,
      attemptRerankStatus === "READY" || attemptRerankStatus === "SKIPPED_OPTIONAL" || attemptRerankStatus === "ERROR"
        ? attemptRerankStatus
        : undefined,
    );
    if (respuesta.skuStatus === "ambiguous") {
      return { rol: cuota.rol, candidatos: [], skuStatus: "ambiguous", relajaciones: [], rerankStatus };
    }
    if (respuesta.results.length > 0) {
      if (intento.etiqueta) relajaciones.push(`${cuota.rol}: ${intento.etiqueta}`);
      return {
        rol: cuota.rol,
        candidatos: respuesta.results.map((r) => ({ ...r, rol: cuota.rol })),
        skuStatus: respuesta.skuStatus,
        relajaciones,
        rerankStatus,
      };
    }
  }

  relajaciones.push(`${cuota.rol}: rol_sin_inventario — ningún candidato ni relajando color, ocasión y categorías`);
  return { rol: cuota.rol, candidatos: [], relajaciones, rerankStatus };
}
