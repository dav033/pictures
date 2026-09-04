import type { Pool } from "pg";
import { embeberTexto } from "../embeddings";
import { interpretarConsulta } from "../query-parser/parse";
import { parseEventSearchIntent } from "../query-parser/event-search";
import { IntentQuerySchema, type IntentQuery } from "../query-parser/schema";
import { buscarPorRol } from "../retrieval/por-rol";
import type { EventSearchIntent } from "../query-parser/event-search";
import { puntuarYOrdenar, type CandidatoDetallado, type CandidatoPuntuado } from "../retrieval/rerank";
import { ensamblarCanasta, type Canasta } from "../presupuesto/ensamblar";
import { ROLES_PRESUPUESTO, type Franja, type RolPresupuesto } from "../presupuesto/franjas";
import { planificarCanasta } from "../presupuesto/plan";
import type { EstadoSku } from "../retrieval/types";
import type { EventMatchEvidence } from "../retrieval/types";
import type { CatalogAllowlist } from "../retrieval/types";
import type { ObservabilidadBusqueda, ResultadoBusquedaObservabilidad } from "../observability/types";

export type PoolItemPresupuesto = {
  productId: string;
  variantId: string;
  titulo: string;
  precio: number;
  imagen: string | null;
  disponible: boolean;
  acabados: string[];
  eventEvidence?: EventMatchEvidence;
};

export type ResultadoBusquedaPresupuesto = {
  status: "OK" | "NO_MATCH" | "AMBIGUOUS_SKU";
  skuStatus?: EstadoSku;
  franja: { slug: string; nombre: string; rangoMinCop: number; rangoMaxCop: number | null } | null;
  canasta: Canasta | null;
  /** Alternativas reales por rol para que el LLM pueda intercambiar una
   * pieza sin volver a buscar (§3, Etapa 5, `pool_por_rol`). */
  poolPorRol: Partial<Record<RolPresupuesto, PoolItemPresupuesto[]>>;
  relajaciones: string[];
  conflictos: string[];
  /** Full retrieval whitelist, kept separate from the visible eight-item pool. */
  variantIdsRecuperados: Array<{ productId: string; variantId: string }>;
  intent: IntentQuery | null;
  latencyParseMs: number;
  latencyRetrievalMs: number;
  latencyPlanningMs: number;
  observabilidad: ObservabilidadBusqueda;
};

export type OpcionesBusquedaPresupuesto = {
  /** Customer-verified filters; component wording cannot alter them. */
  filtrosDuros?: IntentQuery["filtros_duros"];
  /** Open event context for ranking; hard filters remain `filtrosDuros`. */
  eventIntent?: EventSearchIntent;
  focusedQueries?: readonly string[];
  allowlist?: CatalogAllowlist;
};

type FilaCandidatoDetalle = {
  product_id: string;
  title: string;
  derived: { category: string | null; colors: string[]; finishes?: string[]; occasions: string[] };
  available: boolean;
  imagen_principal: string | null;
  variant_id: string;
  sku: string | null;
  price: string;
  variante_disponible: boolean;
  inventario: number | null;
  variant_colors: string[];
};

function observabilidadPresupuesto(
  mensaje: string,
  eventIntent: EventSearchIntent,
  candidates: Array<{ productId: string; variantId?: string; rol?: string; eventEvidence?: EventMatchEvidence }>,
  selected: Array<{ productId: string; variantId: string; rol: string; eventEvidence?: EventMatchEvidence }>,
  relaxations: string[],
  status: ResultadoBusquedaPresupuesto["status"],
  planningLatencyMs: number,
  focusedQueries?: readonly string[],
): ObservabilidadBusqueda {
  const candidateCountsByTier: ObservabilidadBusqueda["candidateCountsByTier"] = { exact_event: 0, thematic: 0, adaptable: 0 };
  const countedCandidates = new Set<string>();
  for (const candidate of candidates) {
    const level = candidate.eventEvidence?.match_level ?? "adaptable";
    const key = `${candidate.productId}:${level}`;
    if (countedCandidates.has(key)) continue;
    countedCandidates.add(key);
    candidateCountsByTier[level]++;
  }
  const outcome: ResultadoBusquedaObservabilidad = status === "NO_MATCH"
    ? "NO_MATCH"
    : status === "AMBIGUOUS_SKU"
      ? "aclaracion"
      : "candidatos";
  const roles = [...new Set(candidates.map((candidate) => candidate.rol).filter((rol): rol is string => Boolean(rol)))];
  return {
    eventLabel: eventIntent.event_label,
    closedOccasionRecognized: eventIntent.occasion_filter.length > 0,
    componentQueries: [...new Set([...(focusedQueries ?? []), ...roles.map((rol) => `${mensaje} — ${rol}`)].map((query) => query.trim()).filter(Boolean))],
    candidateCountsByTier,
    selectedPieces: selected.map((piece) => ({ productId: piece.productId, variantId: piece.variantId, rol: piece.rol, matchLevel: piece.eventEvidence?.match_level ?? "adaptable" })),
    relaxations: [...new Set(relaxations)],
    outcome,
    planningLatencyMs,
  };
}

/** Embedding is optional; lexical retrieval remains the safe fallback. */
export async function embeddingOpcional(query: string): Promise<number[] | undefined> {
  const vectorEnabled = process.env.RAG_USE_VECTOR === "true" && Boolean(process.env.GEMINI_API_KEY?.trim());
  if (!vectorEnabled || !query.trim()) return undefined;
  try {
    return await embeberTexto(query, "RETRIEVAL_QUERY");
  } catch {
    return undefined;
  }
}

/**
 * Orquesta el pipeline de franjas de presupuesto completo (§3): plan de
 * canasta → retrieval por rol → rerank + diversidad → ensamblaje con
 * presupuesto. Sustituye a `buscarCatalogoRag` cuando el turno tiene una
 * franja resuelta (ver `resolverFranja` — nunca la decide el LLM).
 */
export async function buscarCatalogoRagConPresupuesto(
  pool: Pool,
  mensaje: string,
  franja: Franja,
  cifraCliente: number | undefined,
  opciones: OpcionesBusquedaPresupuesto = {},
): Promise<ResultadoBusquedaPresupuesto> {
  const t0 = Date.now();
  const parseado = await interpretarConsulta(mensaje);
  // Semantic retrieval uses component text. Hard SQL filters come only from
  // the original customer context when the caller supplies them.
  const intento: IntentQuery = opciones.filtrosDuros
    ? IntentQuerySchema.parse({ ...parseado, filtros_duros: opciones.filtrosDuros })
    : parseado;
  const eventIntent = opciones.eventIntent ?? parseEventSearchIntent(mensaje);
  const latencyParseMs = Date.now() - t0;

  if (intento.intent !== "product_search") {
    return {
      status: "NO_MATCH",
      franja: null,
      canasta: null,
      poolPorRol: {},
      relajaciones: [],
      conflictos: [],
      variantIdsRecuperados: [],
      intent: intento,
      latencyParseMs,
      latencyRetrievalMs: 0,
      latencyPlanningMs: 0,
      observabilidad: observabilidadPresupuesto(mensaje, eventIntent, [], [], [], "NO_MATCH", 0, opciones.focusedQueries),
    };
  }

  const planningStart = Date.now();
  const plan = planificarCanasta(franja, { categoriasPedidas: intento.filtros_duros.categorias }, cifraCliente);
  const franjaInfo = { slug: franja.slug, nombre: franja.nombre, rangoMinCop: franja.minCop, rangoMaxCop: franja.maxCop };

  const t1 = Date.now();
  // Un solo embedding para todo el turno (§3, Etapa 2) — cada rol lo reusa.
  // Vector is opt-in; FTS/trigram remain the no-key production fallback.
  const embeddingBase = await embeddingOpcional(intento.semantic_query);

  const resultadosPorRol = await Promise.all(
    plan.roles.map((cuota) =>
      buscarPorRol(pool, intento.semantic_query, embeddingBase, cuota, {
        colores: intento.filtros_duros.colores.length ? intento.filtros_duros.colores : undefined,
        ocasiones: intento.filtros_duros.ocasiones.length ? intento.filtros_duros.ocasiones : undefined,
        formas: intento.filtros_duros.formas.length ? intento.filtros_duros.formas : undefined,
        acabados: intento.filtros_duros.acabados.length ? intento.filtros_duros.acabados : undefined,
        diametrosPulgadas: intento.filtros_duros.diametros_pulgadas.length ? intento.filtros_duros.diametros_pulgadas : undefined,
        disponible: intento.filtros_duros.solo_disponibles,
        eventIntent,
        focusedQueries: opciones.focusedQueries,
        allowlist: opciones.allowlist,
      }),
    ),
  );
  const latencyRetrievalMs = Date.now() - t1;

  const relajaciones = resultadosPorRol.flatMap((r) => r.relajaciones);
  const pares = resultadosPorRol.flatMap((r) =>
    r.candidatos.flatMap((c) => c.variantIds.map((variantId) => ({
      productId: c.productId,
      variantId,
      rankRrf: c.finalScore,
      rol: r.rol,
      eventEvidence: c.eventEvidence,
    }))),
  );
  const variantIdsRecuperados = [...new Map(
    pares.map((pair) => [`${pair.productId}:${pair.variantId}`, { productId: pair.productId, variantId: pair.variantId }]),
  ).values()];

  if (resultadosPorRol.some((r) => r.skuStatus === "ambiguous")) {
    return {
      status: "AMBIGUOUS_SKU",
      skuStatus: "ambiguous",
      franja: franjaInfo,
      canasta: null,
      poolPorRol: {},
      // Ambiguous identity is a clarification response, never a selection
      // whitelist even if the retrieval branch saw the duplicate rows.
      variantIdsRecuperados: [],
      relajaciones: [],
      conflictos: plan.conflictos,
      intent: intento,
      latencyParseMs,
      latencyRetrievalMs,
      latencyPlanningMs: Date.now() - planningStart,
      observabilidad: observabilidadPresupuesto(mensaje, eventIntent, pares, [], [], "AMBIGUOUS_SKU", Date.now() - planningStart, opciones.focusedQueries),
    };
  }

  if (pares.length === 0) {
    return {
      status: "NO_MATCH",
      franja: franjaInfo,
      canasta: null,
      poolPorRol: {},
      variantIdsRecuperados,
      relajaciones,
      conflictos: plan.conflictos,
      intent: intento,
      latencyParseMs,
      latencyRetrievalMs,
      latencyPlanningMs: Date.now() - planningStart,
      observabilidad: observabilidadPresupuesto(mensaje, eventIntent, pares, [], relajaciones, "NO_MATCH", Date.now() - planningStart, opciones.focusedQueries),
    };
  }

  // Una sola consulta de detalle para la unión de (producto, variante) de
  // todos los roles, en vez de una por rol.
  const productIds = [...new Set(pares.map((p) => p.productId))];
  const { rows } = await pool.query<FilaCandidatoDetalle>(
    `SELECT p.product_id, p.title, p.derived, p.available, p.image_urls[1] AS imagen_principal,
            v.variant_id, v.sku, v.price, v.available AS variante_disponible,
            v.inventory_quantity AS inventario, v.derived_colors AS variant_colors
     FROM catalog_products p
     JOIN catalog_variants v ON v.product_id = p.product_id
     WHERE p.product_id = ANY($1::text[])`,
    [productIds],
  );
  const filaPorPar = new Map<string, FilaCandidatoDetalle>(rows.map((r) => [`${r.product_id}:${r.variant_id}`, r]));

  const detalladosPorRol = {} as Record<RolPresupuesto, CandidatoDetallado[]>;
  for (const rol of ROLES_PRESUPUESTO) detalladosPorRol[rol] = [];
  for (const par of pares) {
    const fila = filaPorPar.get(`${par.productId}:${par.variantId}`);
    if (!fila) continue;
    detalladosPorRol[par.rol].push({
      rol: par.rol,
      productId: fila.product_id,
      variantId: fila.variant_id,
      titulo: fila.title,
      categoria: fila.derived.category,
      colores: fila.variant_colors.length
        ? fila.variant_colors
        : fila.derived.colors.length === 1
          ? fila.derived.colors
          : [],
       ocasiones: fila.derived.occasions,
       acabados: fila.derived.finishes ?? [],
      disponible: fila.available && fila.variante_disponible,
      imagen: fila.imagen_principal,
      precio: Number(fila.price),
      inventario: fila.inventario,
      sku: fila.sku,
      rankRrf: par.rankRrf,
      eventEvidence: par.eventEvidence,
    });
  }

  const poolsPuntuados = {} as Record<RolPresupuesto, CandidatoPuntuado[]>;
  for (const cuota of plan.roles) {
    poolsPuntuados[cuota.rol] = puntuarYOrdenar(detalladosPorRol[cuota.rol], {
      topeCop: cuota.topeCop,
      coloresPedidos: intento.filtros_duros.colores,
      ocasionesPedidas: intento.filtros_duros.ocasiones,
      acabadosPedidos: intento.filtros_duros.acabados,
    });
  }

  const canasta = ensamblarCanasta(plan, poolsPuntuados);
  const latencyPlanningMs = Date.now() - planningStart;

  const poolPorRol: ResultadoBusquedaPresupuesto["poolPorRol"] = {};
  for (const cuota of plan.roles) {
    if (poolsPuntuados[cuota.rol].length === 0) continue;
   poolPorRol[cuota.rol] = poolsPuntuados[cuota.rol].slice(0, 8).map((c) => ({
      productId: c.productId,
      variantId: c.variantId,
      titulo: c.titulo,
      precio: c.precio,
      imagen: c.imagen,
      disponible: c.disponible,
      acabados: c.acabados,
      eventEvidence: c.eventEvidence,
    }));
  }

  const relajacionesRolesIncompletos = canasta.rolesIncompletos.map(
    (rol) => `${rol}: la cuota mínima de este rol no se cubrió con el inventario disponible`,
  );

  return {
    status: canasta.piezas.length > 0 ? "OK" : "NO_MATCH",
    skuStatus: "not_sku",
    franja: franjaInfo,
    canasta,
    poolPorRol,
    variantIdsRecuperados,
    relajaciones: [...relajaciones, ...relajacionesRolesIncompletos],
    conflictos: plan.conflictos,
    intent: intento,
    latencyParseMs,
    latencyRetrievalMs,
    latencyPlanningMs,
    observabilidad: observabilidadPresupuesto(
      mensaje,
      eventIntent,
      pares,
      canasta.piezas.map((piece) => ({ productId: piece.productId, variantId: piece.variantId, rol: piece.rol, eventEvidence: piece.eventEvidence })),
      [...relajaciones, ...relajacionesRolesIncompletos],
      canasta.piezas.length > 0 ? "OK" : "NO_MATCH",
      latencyPlanningMs,
      opciones.focusedQueries,
    ),
  };
}
