import "server-only";
import type { RegistroHerramientas } from "@sempertex/agente-core";
import type { Pool } from "pg";
import { cotizar, cotizarPlan, type Cotizacion, type ItemCotizacion } from "@/lib/cotizacion/motor";
import { buscarDecoraciones } from "@/lib/decoraciones";
import { calcularMedidas, type Figura, type ResultadoMedidas } from "@/lib/medidas/geometria";
import { productosPorId } from "@/lib/products";
import { getRagPool } from "@/lib/rag/db";
import { buscarCatalogoRag, type ProductoCandidato } from "@/lib/rag/chat/buscar";
import { buscarCatalogoRagConPresupuesto, type PoolItemPresupuesto, type ResultadoBusquedaPresupuesto } from "@/lib/rag/chat/buscar-presupuesto";
import type { RolPresupuesto } from "@/lib/rag/presupuesto/franjas";
import { extraerFiltrosDurosBusqueda } from "@/lib/rag/query-parser/hard-filters";
import { parseEventSearchIntent } from "@/lib/rag/query-parser/event-search";
import { aProductoValidado, validarSeleccion, type ItemRechazado, type ItemValidado, type SeleccionSolicitada } from "@/lib/rag/chat/validar";
import { RAG_ENABLED, RAG_FRANJAS_ENABLED } from "@/lib/rag/flags";
import { actualizarResultadoBusqueda, registrarBusqueda, registrarPlanAudit, registrarSeleccion } from "@/lib/rag/observability/log";
import { resolverFranja } from "@/lib/rag/presupuesto/resolver";
import { resolverVariantesPorDespieceBatch, type GrupoDespiece } from "@/lib/rag/tamanos/resolver";
import { resolverPlan } from "@/lib/plan/resolver";
import { PlanDecoracionSchema } from "@/lib/plan/tipos";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { extraerRestriccionesUsuario, validarCardinalidadEventoAbierto, validarCoberturaReferencia, validarRestriccionesPlan } from "@/lib/plan/restricciones";
import { parseEventIntent } from "@/lib/rag/query-parser/parse-event";
import type { CatalogAllowlist, EventMatchEvidence, EventMatchLevel } from "@/lib/rag/retrieval/types";
import { crearTokenAprobacion } from "@/lib/plan/aprobacion";
import { PLAN_DECORACION_ENABLED } from "@/lib/plan/flags";
import { featureEnabled } from "@/lib/ia/feature-flags";
import { sceneShadowPipeline } from "@/lib/scene/orchestrator";
import { blockingPhysicalWarnings, estimateFromPlan, validateMaterialEstimate } from "@/lib/materiales/estimacion";
import {
  aProducto,
  buscarCatalogoShopify,
  categoriasDeCatalogo,
  variantesPorIds,
  type Faceta,
  type FiltrosCatalogo,
} from "@/lib/shopify/consultas";
import type { Brief, DecoracionConProductos, Producto } from "@/lib/types";
import { HERRAMIENTAS, HERRAMIENTAS_PLAN, HERRAMIENTAS_RAG } from "./herramientas";
import type { ReferenceBlueprintV2 } from "./reference-blueprint";
import type { Herramienta } from "./tipos";

// Superadas por buscar_catalogo_rag/confirmar_seleccion_rag (Fases 3B-6 ya
// validadas contra datos reales). Si se dejan las dos rutas activas a la vez,
// el modelo puede elegir la vieja y saltarse por completo la whitelist, el
// tope de inventario y los datos de imagen/handle que alimentan la UI de
// verificación — pasó en pruebas reales, no es un riesgo teórico.
const HERRAMIENTAS_SUPERADAS_POR_RAG = new Set(["buscar_catalogo", "confirmar_seleccion_ia", "consultar_disponibilidad"]);
const HERRAMIENTAS_SUPERADAS_POR_PLAN = new Set(["confirmar_seleccion_rag", "calcular_medidas"]);

export function herramientasActivas(): Herramienta[] {
  const herramientas = !RAG_ENABLED
    ? HERRAMIENTAS
    : [...HERRAMIENTAS.filter((h) => !HERRAMIENTAS_SUPERADAS_POR_RAG.has(h.nombre)), ...HERRAMIENTAS_RAG];
  if (PLAN_DECORACION_ENABLED && RAG_ENABLED) {
    return [...herramientas.filter((h) => !HERRAMIENTAS_SUPERADAS_POR_PLAN.has(h.nombre)), ...HERRAMIENTAS_PLAN].filter((h) => h.nombre !== "cotizar");
  }
  // La cotización no pertenece al razonamiento de selección en ningún modo.
  // La app la calcula después de terminar la imagen, usando exactamente los
  // productos que entraron en la propuesta visual.
  return herramientas.filter((h) => h.nombre !== "cotizar");
}

// El catálogo real tiene mucho más margen de ambigüedad que el mock de 14
// productos: el modelo a veces reintenta buscar_catalogo buscando una
// coincidencia más exacta antes de responder. Con una imagen de referencia
// de estilo (varios colores/atributos a la vez) se vieron casos reales de
// hasta 6 llamadas a buscar_catalogo antes de decidir — 6 se quedaba corto
// justo para el turno en que el modelo por fin llama confirmar_seleccion_ia,
// dejando la conversación en el mensaje de "me enredé" aunque la selección
// ya se hubiera guardado. 10 da margen real sin dejar una conversación
// colgada indefinidamente.
export const VUELTAS_MAX = 10;

// Si buscar_catalogo trae más piezas que esto y el cliente no pidió un tipo
// puntual, no tiene sentido tirárselas todas de una — se le ofrece elegir el
// tipo de producto primero (§ tipo "buscar_catalogo" más abajo).
const UMBRAL_AGRUPAR_POR_TIPO = 8;

export type EstadoConversacion = {
  brief: Brief;
  solicitudOriginal: string;
  restriccionesUsuario: ReturnType<typeof extraerRestriccionesUsuario>;
  recomendaciones: Producto[];
  decoraciones: DecoracionConProductos[];
  categoriasSugeridas: Faceta[];
  // Filtros que produjeron `categoriasSugeridas` (ocasión, colores, texto…),
  // sin la categoría en sí. El cliente los reusa para navegar directo a un
  // tipo puntual sin pasarle otro turno al modelo (§ page.tsx navegarCategoria).
  filtrosCategorias?: FiltrosCatalogo;
  medidas?: ResultadoMedidas;
  cotizacion?: Cotizacion;
  // Piezas que la IA decidió proponer por su cuenta — solo se llenan si
  // `confirmar_seleccion_ia` resolvió al menos un id real; el frontend usa
  // esto para disparar /api/generate sin que el cliente haga clic.
  seleccionFinalIA?: Producto[];
  instruccionIA?: string;
  // Whitelist de productos realmente recuperados en ESTE request/turno (plan
  // §4.8). `ejecutar.ts` crea este estado por ejecución; sólo se acumulan
  // varias llamadas de herramienta del mismo turno, nunca historial viejo.
  ragIdsRecuperados: Set<string>;
  /** Product -> exact variant whitelist exposed by retrieval in this request. */
  ragVariantIdsRecuperados: Map<string, Set<string>>;
  ragCandidatos?: ProductoCandidato[];
  /** Event evidence is kept separately so budget retrieval (pool_por_rol) and
   * regular retrieval share the same plan/UI traceability contract. */
  ragEventEvidence?: Map<string, EventMatchEvidence>;
  ragEventRelaxations?: string[];
  /** Any fallback that loosened a customer hard color in this turn. */
  ragColorRelaxed?: string[];
  ragValidados?: ItemValidado[];
  ragRechazados?: ItemRechazado[];
  ragTotal?: number;
  /** Une búsqueda con selección en rag_query_log — un id por conversación, no por turno. */
  ragRequestId: string;
  /** Franja de presupuesto resuelta en la última búsqueda de este turno (si
   * RAG_FRANJAS_ENABLED) — confirmar_seleccion_rag la usa para avisar si la
   * selección final se pasó del techo, sin bloquearla (§3, Etapa 5). */
  ragFranja?: { slug: string; nombre: string; techoCop: number };
  planResuelto?: PlanResuelto;
  /** Blueprint de la(s) imagen(es) de referencia adjuntas a ESTE turno, ya
   * analizado por /api/references/analyze — plan de integración de
   * referencias visuales, R2/R4. Ausente si el cliente no adjuntó nada. */
  referenceBlueprint?: ReferenceBlueprintV2;
};

const EVENT_MATCH_PRIORITY: Record<EventMatchLevel, number> = {
  adaptable: 0,
  thematic: 1,
  exact_event: 2,
};

/** Fase 3.2: proyección compacta de `pool_por_rol` para el modelo. Quita
 * `imagen` (una URL que un modelo de texto no puede usar) sin tocar ningún
 * campo del que dependa la honestidad al sustituir (sku, precio, tamaño,
 * disponibilidad, `eventEvidence`). La UI obtiene sus fotos por una vía
 * completamente separada (`estado.ragValidados`, poblado en
 * `confirmar_seleccion_rag`), así que esto no le quita nada. */
function proyectarPoolParaModelo(
  poolPorRol: ResultadoBusquedaPresupuesto["poolPorRol"],
): Partial<Record<RolPresupuesto, Omit<PoolItemPresupuesto, "imagen">[]>> {
  const proyectado: Partial<Record<RolPresupuesto, Omit<PoolItemPresupuesto, "imagen">[]>> = {};
  for (const [rol, items] of Object.entries(poolPorRol) as [RolPresupuesto, PoolItemPresupuesto[]][]) {
    proyectado[rol] = items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      titulo: item.titulo,
      precio: item.precio,
      disponible: item.disponible,
      acabados: item.acabados,
      eventEvidence: item.eventEvidence,
    }));
  }
  return proyectado;
}

function mergeEventEvidence(
  current: EventMatchEvidence | undefined,
  next: EventMatchEvidence,
): EventMatchEvidence {
  const match_level = !current || EVENT_MATCH_PRIORITY[next.match_level] > EVENT_MATCH_PRIORITY[current.match_level]
    ? next.match_level
    : current.match_level;
  return {
    match_level,
    matched_signals: [...new Set([...(current?.matched_signals ?? []), ...next.matched_signals])],
    relaxations: [...new Set([...(current?.relaxations ?? []), ...next.relaxations])],
  };
}

/** Attach the event contract after the real resolver has produced the plan.
 * Keeping this as a pure boundary makes it testable without an LLM and avoids
 * losing metadata when the planner is entered through a budget search. */
export function enriquecerPlanResueltoEvento(
  resuelto: PlanResuelto,
  eventIntent: ReturnType<typeof parseEventIntent>,
  evidenceByProduct: ReadonlyMap<string, EventMatchEvidence>,
  retrievalRelaxations: readonly string[] = [],
): PlanResuelto {
  const selectedProductIds = resuelto.plan.estructuras.flatMap((estructura) => estructura.materiales.map((material) => material.product_id));
  const selectedEvidence = selectedProductIds
    .map((productId) => evidenceByProduct.get(productId))
    .filter((evidence): evidence is EventMatchEvidence => Boolean(evidence));
  resuelto.event_label = eventIntent.event_label;
  resuelto.original_request = eventIntent.original_request;
  resuelto.event_match_levels = [...new Set(selectedEvidence.map((evidence) => evidence.match_level))];
  resuelto.event_relaxations = [...new Set([
    ...retrievalRelaxations,
    ...selectedEvidence.flatMap((evidence) => evidence.relaxations),
  ])];
  return resuelto;
}

export function crearEstadoConversacion(brief: Brief, solicitudOriginal = "", referenceBlueprint?: ReferenceBlueprintV2): EstadoConversacion {
  // The wrapper in ejecutar.ts calls this once per request/turn, so these
  // sets cannot carry a prior conversation's retrieval whitelist.
  return {
    brief: { ...brief },
    solicitudOriginal,
    restriccionesUsuario: extraerRestriccionesUsuario(solicitudOriginal, brief),
    recomendaciones: [],
    decoraciones: [],
    categoriasSugeridas: [],
    ragIdsRecuperados: new Set(),
    ragVariantIdsRecuperados: new Map(),
    ragEventEvidence: new Map(),
    ragEventRelaxations: [],
    ragRequestId: crypto.randomUUID(),
    referenceBlueprint,
  };
}

/**
 * Al agotar VUELTAS_MAX no siempre "se enredó" de verdad: si el modelo
 * llamó confirmar_seleccion_ia justo en la última vuelta permitida, la
 * selección ya quedó guardada y la imagen ya se está generando — decirle al
 * cliente "me enredé" ahí sería mentirle sobre algo que en realidad sí
 * funcionó, solo que no alcanzó a mandar el texto de cierre.
 */
export function textoAlAgotarVueltas(estado: EstadoConversacion): string {
  if (estado.seleccionFinalIA?.length) {
    return "¡Ya elegí las piezas y se está generando tu visualización! Dame un momento.";
  }
  return "Perdón, me enredé un poco. ¿Me lo repites de otra forma?";
}

/** Arma el registro de herramientas (nombre → handler) que el motor genérico
 * de @sempertex/agente-core despacha — cada cuerpo es el mismo que tenía el
 * if-chain de ejecutar.ts antes de esta extracción, sin cambios de lógica. */
export function crearRegistroHerramientas(estado: EstadoConversacion, options: { pool?: Pool; catalogAllowlist?: CatalogAllowlist } = {}): RegistroHerramientas {
  const ragPool = options.pool ?? getRagPool();
  return {
    guardar_brief: async (args) => {
      Object.assign(estado.brief, args);
      return { ok: true, brief: estado.brief };
    },

    buscar_catalogo: async (args) => {
      const filtros = args as FiltrosCatalogo;
      const { resultados, total, filtroRelajado } = buscarCatalogoShopify(filtros);

      const debeAgruparPorTipo = !filtros.categorias?.length && total > UMBRAL_AGRUPAR_POR_TIPO;
      if (debeAgruparPorTipo) {
        const categorias = categoriasDeCatalogo(filtros);
        estado.categoriasSugeridas = categorias;
        estado.filtrosCategorias = filtros;
        return {
          total,
          demasiados_resultados: true,
          tipos_disponibles: categorias.map((c) => ({ categoria: c.valor, etiqueta: c.etiqueta, cantidad: c.total })),
          filtro_relajado: filtroRelajado,
        };
      }

      estado.recomendaciones = resultados.map(aProducto);
      return {
        total,
        productos: resultados.map((r) => ({
          id: r.varianteId,
          nombre: r.nombre,
          categoria: r.categoriaNombre,
          colores: r.colores,
          ocasiones: r.ocasiones,
          tags: r.tags,
          precio: r.precio,
          unidades_paquete: r.unidadesPaquete,
          disponible: r.disponible,
        })),
        filtro_relajado: filtroRelajado,
      };
    },

    consultar_disponibilidad: async (args) => {
      const ids = Array.isArray(args.ids) ? (args.ids as string[]) : [];
      const resultados = variantesPorIds(ids);
      return {
        disponibilidad: resultados.map((r) => ({
          id: r.varianteId,
          nombre: r.nombre,
          disponible: r.disponible,
        })),
      };
    },

    calcular_medidas: async (args) => {
      const a = args as {
        figura: Figura;
        ancho_m?: number;
        alto_m?: number;
        largo_m?: number;
        densidad?: "sencilla" | "media" | "lujosa";
        colores?: string[];
        mezcla?: "clasica" | "organica_fina" | "organica_gruesa" | "solo_grandes";
      };
      const resultado = calcularMedidas({
        figura: a.figura,
        anchoM: a.ancho_m,
        altoM: a.alto_m,
        largoM: a.largo_m,
        densidad: a.densidad,
        colores: a.colores,
        mezcla: a.mezcla,
      });
      estado.medidas = resultado;
      return {
        figura: resultado.figura,
        eje_m: resultado.ejeM,
        despiece: resultado.despiece,
        total_globos: resultado.totalGlobos,
        supuestos: resultado.supuestos,
        confianza: resultado.confianza,
        aviso: resultado.aviso,
      };
    },

    cotizar: async (args) => {
      const items = Array.isArray(args.items) ? (args.items as ItemCotizacion[]) : [];
      const resultado = cotizar(items);
      estado.cotizacion = resultado;
      return {
        lineas: resultado.lineas,
        total: resultado.total,
        merma_porcentaje: resultado.mermaPorcentaje,
        incluye_iva: resultado.incluyeIva,
      };
    },

    confirmar_seleccion_ia: async (args) => {
      const ids = Array.isArray(args.ids) ? (args.ids as string[]) : [];
      const productos = variantesPorIds(ids).map(aProducto);
      if (productos.length === 0) {
        return { ok: false, resueltos: 0 };
      }
      estado.seleccionFinalIA = productos;
      estado.instruccionIA = typeof args.instruccion === "string" ? args.instruccion : undefined;
      return {
        ok: true,
        resueltos: productos.length,
        // Desglose real para que el modelo pueda describirle al cliente qué
        // compone la propuesta, aunque las tarjetas ya lo muestren en pantalla —
        // precio siempre por paquete, igual que en buscar_catalogo.
        piezas: productos.map((p) => ({
          nombre: p.nombre,
          categoria: p.categoria,
          // Lista TODOS los colores presentes, no cuál es el dominante — antes
          // de describir esto como "dorado" (o el color que pidió el cliente),
          // confirma que sea el color base y no solo un acento menor.
          colores: p.colores,
          unidades_paquete: p.unidadesPaquete,
        })),
        fase: "propuesta_visual; la cotizacion llega despues de generar la imagen",
      };
    },

    buscar_catalogo_rag: async (args) => {
      // Component text drives lexical/semantic retrieval. Customer constraints
      // stay locked from original request + brief, so model enrichment cannot
      // turn a style term such as "glamour" into a hard catalog filter.
      const mensaje = typeof args.mensaje === "string" ? args.mensaje : "";
      const solicitudParaFiltros = estado.solicitudOriginal.trim() || mensaje;
      const filtrosDuros = extraerFiltrosDurosBusqueda(solicitudParaFiltros, estado.brief);
      const eventIntent = parseEventSearchIntent(solicitudParaFiltros);
      const pool = ragPool;
      const t0 = Date.now();

      // La franja NUNCA la nombra el LLM (§3, Etapa 0): se resuelve aquí, en
      // código, a partir de lo que el cliente ya dijo en el brief. Sin franja
      // resuelta (brief.presupuesto vacío o RAG_FRANJAS_ENABLED apagada) el
      // pipeline de hoy corre exactamente igual, sin canasta.
      const franjaResuelta = RAG_FRANJAS_ENABLED ? resolverFranja(estado.brief.presupuesto) : null;

      if (franjaResuelta) {
        const respuesta = await buscarCatalogoRagConPresupuesto(
          pool,
          mensaje,
          franjaResuelta.franja,
          franjaResuelta.cifraCliente,
          { filtrosDuros, eventIntent, focusedQueries: [mensaje], allowlist: options.catalogAllowlist },
        );
        estado.ragFranja = { slug: franjaResuelta.franja.slug, nombre: franjaResuelta.franja.nombre, techoCop: respuesta.canasta?.techoCop ?? franjaResuelta.franja.minCop };
        if (respuesta.relajaciones.some((relajacion) => /color/i.test(relajacion))) {
          estado.ragColorRelaxed = [...new Set([...(estado.ragColorRelaxed ?? []), "colores"])]
        }

        const idsPool = Object.values(respuesta.poolPorRol)
          .flat()
          .map((item) => item.productId);
        const idsCanasta = respuesta.canasta?.piezas.map((p) => p.productId) ?? [];
        for (const id of [...idsPool, ...idsCanasta, ...respuesta.variantIdsRecuperados.map((item) => item.productId)]) estado.ragIdsRecuperados.add(id);
        for (const item of respuesta.variantIdsRecuperados) {
          const variantes = estado.ragVariantIdsRecuperados.get(item.productId) ?? new Set<string>();
          variantes.add(item.variantId);
          estado.ragVariantIdsRecuperados.set(item.productId, variantes);
        }
        for (const item of Object.values(respuesta.poolPorRol).flat()) {
          if (item.eventEvidence) {
            estado.ragEventEvidence?.set(item.productId, mergeEventEvidence(estado.ragEventEvidence.get(item.productId), item.eventEvidence));
          }
          const variantes = estado.ragVariantIdsRecuperados.get(item.productId) ?? new Set<string>();
          variantes.add(item.variantId);
          estado.ragVariantIdsRecuperados.set(item.productId, variantes);
        }
        estado.ragEventRelaxations = [...new Set([...(estado.ragEventRelaxations ?? []), ...respuesta.relajaciones, ...respuesta.conflictos])];
        for (const item of respuesta.canasta?.piezas ?? []) {
          const variantes = estado.ragVariantIdsRecuperados.get(item.productId) ?? new Set<string>();
          variantes.add(item.variantId);
          estado.ragVariantIdsRecuperados.set(item.productId, variantes);
        }

        await registrarBusqueda(pool, {
          requestId: estado.ragRequestId,
          mensaje,
          intent: respuesta.intent,
          retrievedProductIds: [...new Set([...idsPool, ...idsCanasta, ...respuesta.variantIdsRecuperados.map((item) => item.productId)])],
          retrievalScores: null,
          status: respuesta.status,
          latencyParseMs: respuesta.latencyParseMs,
          latencyRetrievalMs: respuesta.latencyRetrievalMs,
          latencyTotalMs: Date.now() - t0,
          franja: respuesta.franja?.slug,
          canasta: respuesta.canasta,
          utilizacion: respuesta.canasta?.utilizacion,
          relajaciones: [...respuesta.relajaciones, ...respuesta.conflictos],
          observabilidad: respuesta.observabilidad,
        });

        return {
          status: respuesta.status,
          sku_status: respuesta.skuStatus,
          franja: respuesta.franja,
          canasta: respuesta.canasta
            ? {
                piezas: respuesta.canasta.piezas.map((p) => ({
                  product_id: p.productId,
                  variant_id: p.variantId,
                  rol: p.rol,
                  titulo: p.titulo,
                  precio: p.precio,
                  cantidad: p.cantidad,
                  subtotal: p.subtotal,
                  porque: p.porque,
                })),
                total: respuesta.canasta.total,
                techo: respuesta.canasta.techoCop,
                utilizacion: Math.round(respuesta.canasta.utilizacion * 100) / 100,
                cumple_presupuesto: respuesta.canasta.cumplePresupuesto,
                holgura: respuesta.canasta.holgura,
              }
            : null,
          // Fase 3.2: `imagen` no se poda del tipo interno `PoolItemPresupuesto`
          // (lo usa `estado.ragValidados`/la UI por otra vía, vía
          // `confirmar_seleccion_rag`), pero un modelo de texto no puede leer
          // una URL de foto — proyectarla afuera de lo que ve el modelo ahorra
          // tokens de entrada sin perder ningún campo de honestidad (sku,
          // precio, tamaño, disponibilidad, match_level, eventEvidence siguen
          // intactos).
          pool_por_rol: proyectarPoolParaModelo(respuesta.poolPorRol),
          relajaciones: respuesta.relajaciones,
          conflictos: respuesta.conflictos,
          evento: {
            event_label: eventIntent.event_label,
            original_request: eventIntent.semantic_query,
            match_levels: [...new Set(Object.values(respuesta.poolPorRol).flat().map((item) => item.eventEvidence?.match_level).filter((level): level is "exact_event" | "thematic" | "adaptable" => Boolean(level)))],
            relaxations: respuesta.relajaciones,
          },
        };
      }

      const respuesta = await buscarCatalogoRag(pool, mensaje, { filtrosDuros, eventIntent, focusedQueries: [mensaje], allowlist: options.catalogAllowlist });
      estado.ragCandidatos = [...new Map(
        [...(estado.ragCandidatos ?? []), ...respuesta.candidatos].map((candidate) => [candidate.productId, candidate]),
      ).values()];
      for (const candidate of respuesta.candidatos) {
        if (candidate.eventEvidence) {
          estado.ragEventEvidence?.set(candidate.productId, mergeEventEvidence(estado.ragEventEvidence.get(candidate.productId), candidate.eventEvidence));
        }
      }
      estado.ragEventRelaxations = [...new Set([...(estado.ragEventRelaxations ?? []), ...respuesta.observabilidad.relaxations])];
      if (respuesta.filtroRelajado === "colores") {
        estado.ragColorRelaxed = [...new Set([...(estado.ragColorRelaxed ?? []), "colores"])]
      }
      for (const c of respuesta.candidatos) estado.ragIdsRecuperados.add(c.productId);
      for (const c of respuesta.candidatos) {
        const variantes = estado.ragVariantIdsRecuperados.get(c.productId) ?? new Set<string>();
        for (const variante of c.variantes) variantes.add(variante.variantId);
        estado.ragVariantIdsRecuperados.set(c.productId, variantes);
      }

      // Se espera (no fire-and-forget): en un runtime serverless la función
      // puede cortarse en cuanto termina esta llamada, y una escritura de log
      // sin awaitear se perdería justo ahí. registrarBusqueda ya atrapa sus
      // propios errores — esperarla no puede tumbar la conversación.
      await registrarBusqueda(pool, {
        requestId: estado.ragRequestId,
        mensaje,
        intent: respuesta.intent,
        retrievedProductIds: respuesta.candidatos.map((c) => c.productId),
        retrievalScores: respuesta.scores,
        status: respuesta.status,
        latencyParseMs: respuesta.latencyParseMs,
          latencyRetrievalMs: respuesta.latencyRetrievalMs,
          latencyTotalMs: Date.now() - t0,
          observabilidad: respuesta.observabilidad,
        });

      return {
        status: respuesta.status,
        sku_status: respuesta.skuStatus,
        filtro_relajado: respuesta.filtroRelajado,
        evento: {
          event_label: eventIntent.event_label,
          original_request: eventIntent.semantic_query,
          match_levels: [...new Set(respuesta.candidatos.map((c) => c.eventEvidence?.match_level).filter((level): level is "exact_event" | "thematic" | "adaptable" => Boolean(level)))],
          relaxations: respuesta.observabilidad.relaxations,
        },
        candidatos: respuesta.candidatos.map((c) => ({
          product_id: c.productId,
          titulo: c.titulo,
          categoria: c.categoria,
          colores: c.colores,
          ocasiones: c.ocasiones,
          disponible: c.disponible,
          match_level: c.eventEvidence?.match_level,
          matched_signals: c.eventEvidence?.matched_signals ?? [],
          relaxations: c.eventEvidence?.relaxations ?? [],
          variantes: c.variantes.map((v) => ({
            variant_id: v.variantId,
            sku: v.sku,
            titulo: v.titulo,
            precio: v.precio,
            disponible: v.disponible,
            // Tamaño real (plan de tamaños F2/F3) — sin esto el modelo elegía
            // entre variantes indistinguibles salvo un código interno y caía
            // en la más común del catálogo (R-12) por defecto estadístico.
            tamano: v.codigoTamano,
            diametro_pulgadas: v.diamPulg,
            forma: v.forma,
            colores: v.colores,
          })),
        })),
      };
    },

    confirmar_seleccion_rag: async (args) => {
      const seleccionCruda = Array.isArray(args.seleccion) ? args.seleccion : [];
      const pool = ragPool;

      // Ítems normales (tamaño explícito) pasan tal cual. Ítems
      // "usar_despiece" (plan de tamaños F3, "mezcla de diseñador") se
      // expanden ANTES de validar: el LLM decidió producto+color, el
      // resolver determinístico decide cuánto de cada tamaño según el
      // despiece geométrico de calcular_medidas — nunca al revés, o vuelve
      // a caer en que el LLM elija una sola variante a ojo.
      const sustituciones: { product_id: string; pedido: string; entregado: string; motivo: string }[] = [];
      const sinCobertura: { product_id: string; tamano: string }[] = [];
      const rechazosExpansion: ItemRechazado[] = [];

      // Fase 3.5: los ítems `usar_despiece` de este turno se recolectan
      // primero (sin tocar la DB) y se resuelven todos en UNA sola consulta
      // batch en vez de una por ítem — antes cada `usar_despiece` de la
      // selección disparaba su propio round-trip a Postgres dentro de este
      // `for`. `porIndice` conserva el orden exacto de `seleccionCruda`: un
      // ítem normal produce una entrada, un `usar_despiece` produce N (una
      // por tamaño resuelto), pero la posición relativa entre ítems no
      // relacionados con el despiece no debe cambiar frente al código previo.
      const porIndice: SeleccionSolicitada[][] = [];
      const indicesDespiece: number[] = [];
      const gruposDespiece: GrupoDespiece[] = [];
      const productIdPorIndiceDespiece: string[] = [];
      const razonPorIndiceDespiece: (string | undefined)[] = [];

      for (const cruda of seleccionCruda as Record<string, unknown>[]) {
        const productId = String(cruda.product_id ?? "");
        if (cruda.usar_despiece !== true) {
          porIndice.push([{
            productId,
            variantId: String(cruda.variant_id ?? ""),
            cantidad: Number(cruda.cantidad ?? 0),
            razon: typeof cruda.razon === "string" ? cruda.razon : undefined,
          }]);
          continue;
        }

        if (!estado.medidas) {
          rechazosExpansion.push({ productId, variantId: "", motivo: "usar_despiece sin haber llamado calcular_medidas en este turno" });
          porIndice.push([]);
          continue;
        }
        const colorArg = typeof cruda.color === "string" ? cruda.color : undefined;
        const despieceTieneColores = estado.medidas.despiece.some((l) => l.color);
        if (despieceTieneColores && !colorArg) {
          rechazosExpansion.push({ productId, variantId: "", motivo: "calculaste medidas con varios colores; usar_despiece necesita 'color' para saber qué parte del despiece cubre este producto" });
          porIndice.push([]);
          continue;
        }
        const lineasDelColor = estado.medidas.despiece.filter((l) => (colorArg ? l.color === colorArg : true));
        if (lineasDelColor.length === 0) {
          rechazosExpansion.push({ productId, variantId: "", motivo: `ningún tamaño del despiece corresponde al color '${colorArg}'` });
          porIndice.push([]);
          continue;
        }

        const whitelist = estado.ragVariantIdsRecuperados.get(productId) ?? new Set<string>();
        porIndice.push([]); // se rellena abajo tras resolver el batch
        indicesDespiece.push(porIndice.length - 1);
        gruposDespiece.push({ productId, despiece: lineasDelColor, whitelistVariantIds: whitelist });
        productIdPorIndiceDespiece.push(productId);
        razonPorIndiceDespiece.push(typeof cruda.razon === "string" ? cruda.razon : undefined);
      }

      if (gruposDespiece.length > 0) {
        const resueltos = await resolverVariantesPorDespieceBatch(pool, gruposDespiece);
        for (let i = 0; i < indicesDespiece.length; i++) {
          const productId = productIdPorIndiceDespiece[i]!;
          const razon = razonPorIndiceDespiece[i];
          const resuelto = resueltos[i]!;
          porIndice[indicesDespiece[i]!] = resuelto.lineas.map((linea) => ({
            productId: linea.productId,
            variantId: linea.variantId,
            cantidad: linea.cantidad,
            razon,
          }));
          for (const linea of resuelto.lineas) {
            if (linea.sustitucion) sustituciones.push({ product_id: productId, ...linea.sustitucion });
          }
          for (const faltante of resuelto.sinCobertura) sinCobertura.push({ product_id: productId, tamano: faltante.tamano });
        }
      }

      const seleccion: SeleccionSolicitada[] = porIndice.flat();

      const t0 = Date.now();
      const resultado = await validarSeleccion(pool, seleccion, estado.ragVariantIdsRecuperados);
      resultado.rechazados = [...resultado.rechazados, ...rechazosExpansion];
      estado.ragValidados = resultado.validados;
      estado.ragRechazados = resultado.rechazados;
      estado.ragTotal = resultado.total;

      const statusSeleccion = resultado.validados.length > 0 ? "OK" : "NO_MATCH";

      // El frontend dispara /api/generate cuando `seleccionFinalIA` llega
      // poblado. La proyección sale de los mismos rows PG que acabamos de
      // validar: no se vuelve a consultar SQLite para evitar mezclar snapshots,
      // precios o metadata de otra fuente.
      if (resultado.validados.length > 0) {
        const productos = resultado.validados.map((validado) => aProductoValidado(validado, validado.cantidad));
        if (productos.length > 0) estado.seleccionFinalIA = productos;
      }

      await registrarSeleccion(pool, {
        requestId: estado.ragRequestId,
        selectedProductIds: resultado.validados.map((v) => v.productId),
        rejected: resultado.rechazados,
        status: statusSeleccion,
        latencyTotalMs: Date.now() - t0,
      });
      await actualizarResultadoBusqueda(
        pool,
        estado.ragRequestId,
        statusSeleccion === "NO_MATCH" ? "NO_MATCH" : "plan_confirmado",
        undefined,
        resultado.validados.map((validado) => {
          const candidato = estado.ragCandidatos?.find((item) => item.productId === validado.productId);
          return {
            productId: validado.productId,
            variantId: validado.variantId,
            matchLevel: candidato?.eventEvidence?.match_level ?? "adaptable",
          };
        }),
      );

      // Chequeo de presupuesto (§3, Etapa 5): la franja no bloquea la
      // confirmación — el LLM puede tener una razón real para excederse (ej.
      // el cliente pidió explícitamente una pieza fuera de la receta) — pero
      // el backend SIEMPRE reporta el delta real en vez de dejarlo pasar en
      // silencio, igual que con inventario (validarSeleccion arriba).
      const excedePresupuesto = estado.ragFranja != null && resultado.total > estado.ragFranja.techoCop;

      return {
        status: statusSeleccion,
        validados: resultado.validados.map((v) => ({
          product_id: v.productId,
          variant_id: v.variantId,
          sku: v.sku,
          titulo: v.titulo,
          cantidad: v.cantidad,
        })),
        rechazados: resultado.rechazados,
        // Plan de tamaños F3: nunca sustituir en silencio. Si vienen no
        // vacíos, el LLM está instruido (herramientas.ts) a decírselos al
        // cliente tal cual, igual que cualquier otra sustitución honesta.
        sustituciones,
        sin_cobertura: sinCobertura,
        fase: "propuesta_visual; la cotizacion llega despues de generar la imagen",
        ...(estado.ragFranja
          ? {
              franja: estado.ragFranja.slug,
              techo_presupuesto: estado.ragFranja.techoCop,
              excede_presupuesto: excedePresupuesto,
              delta_cop: excedePresupuesto ? resultado.total - estado.ragFranja.techoCop : 0,
            }
          : {}),
      };
    },

    confirmar_plan_decoracion: async (args) => {
      // C4: occasion is the customer's open label, not a closed taxonomy
      // value invented by the model. Keep model wording only when no label
      // was recoverable from the original request.
      const eventLabel = parseEventSearchIntent(estado.solicitudOriginal).event_label;
      const eventIntent = parseEventIntent(estado.solicitudOriginal);
      const parseado = PlanDecoracionSchema.safeParse({
        ...(args as Record<string, unknown>),
        ...(eventLabel
          ? { concepto: { ...((args as { concepto?: Record<string, unknown> }).concepto ?? {}), ocasion: eventLabel } }
          : {}),
        plan_version: "1.0",
        plan_id: crypto.randomUUID(),
        supuestos: [],
        restricciones: estado.restriccionesUsuario,
      });
      if (!parseado.success) {
        await actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion");
        return { ok: false, errores: parseado.error.issues.map((issue) => `${issue.path.join(".") || "plan"}: ${issue.message}`) };
      }
      const erroresDeIntencion = validarRestriccionesPlan(parseado.data, estado.restriccionesUsuario);
      const erroresDeCardinalidad = validarCardinalidadEventoAbierto(
        parseado.data,
        eventIntent.event_type,
        estado.solicitudOriginal,
        estado.ragIdsRecuperados.size > 0,
      );
      const erroresDeContrato = [...erroresDeIntencion, ...erroresDeCardinalidad];
      if (erroresDeContrato.length > 0) {
        estado.planResuelto = undefined;
        estado.seleccionFinalIA = [];
        await registrarPlanAudit(ragPool, {
          requestId: estado.ragRequestId,
          solicitudOriginal: estado.solicitudOriginal,
          restricciones: estado.restriccionesUsuario,
          candidateProductIds: [...estado.ragIdsRecuperados],
          status: "RESTRICCIONES_INCONSISTENTES",
          error: erroresDeContrato.join(" | "),
        });
        await actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion");
        return {
          ok: false,
          status: "RESTRICCIONES_INCONSISTENTES",
          errores: erroresDeContrato,
          accion_requerida: "Corrige la cardinalidad o los colores del plan antes de confirmar; no anuncies ni generes una imagen.",
        };
      }
      // Cobertura referencia→plan (plan de integración de referencias
      // visuales, R4): con una imagen de referencia analizada en este turno,
      // cada elemento aprobado debe quedar cubierto por una estructura
      // (referencia_element_id) o declarado omitido (referencia_omitida) —
      // omitir uno en silencio es tan deshonesto como omitir un producto sin
      // decirlo (ver HONESTIDAD AL SUSTITUIR en el prompt del sistema).
      const elementosSinCubrir = validarCoberturaReferencia(parseado.data, estado.referenceBlueprint);
      if (elementosSinCubrir.length > 0) {
        estado.planResuelto = undefined;
        estado.seleccionFinalIA = [];
        await registrarPlanAudit(ragPool, {
          requestId: estado.ragRequestId,
          solicitudOriginal: estado.solicitudOriginal,
          restricciones: estado.restriccionesUsuario,
          candidateProductIds: [...estado.ragIdsRecuperados],
          status: "COBERTURA_REFERENCIA_INCOMPLETA",
          error: elementosSinCubrir.join(" | "),
        });
        await actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion");
        return {
          ok: false,
          status: "COBERTURA_REFERENCIA_INCOMPLETA",
          elementos_sin_cubrir: elementosSinCubrir,
          accion_requerida: "Para cada elemento sin cubrir: asígnale una estructura con referencia_element_id, o decláralo en referencia_omitida con un motivo real. No anuncies ni generes esta imagen hasta cubrir todos.",
        };
      }
      if (featureEnabled("SCENE_PLAN_V2_SHADOW") && estado.solicitudOriginal.trim()) {
        let shadow: Awaited<ReturnType<typeof sceneShadowPipeline>>;
        try {
          shadow = await sceneShadowPipeline(estado.solicitudOriginal, ragPool, parseado.data.estructuras.length);
        } catch (error) {
          shadow = {
            v1_exists: parseado.data.estructuras.length > 0,
            v2_ran: false,
            v2_slots_covered: 0,
            v2_total_slots: 0,
            v2_gaps: 0,
            v2_approved: false,
            latency_v2_ms: 0,
            error: error instanceof Error ? error.message : String(error),
          };
        }
        await registrarPlanAudit(ragPool, {
          requestId: estado.ragRequestId,
          solicitudOriginal: estado.solicitudOriginal,
          geometry: shadow,
          status: "SCENE_V2_SHADOW",
          error: shadow.error,
          flagSnapshot: { scenePlanV2Shadow: true },
        });
      }
      const planningStart = Date.now();
      const resuelto = await resolverPlan(ragPool, parseado.data, estado.ragVariantIdsRecuperados, options.catalogAllowlist);
      const materialEstimate = estimateFromPlan(resuelto);
      const estimateValidation = validateMaterialEstimate(materialEstimate);
      const physicalWarnings = blockingPhysicalWarnings(materialEstimate);
      const auditarResuelto = async (status: string, error?: string) => registrarPlanAudit(ragPool, {
        requestId: estado.ragRequestId,
        planHash: resuelto.plan_hash,
        solicitudOriginal: estado.solicitudOriginal,
        restricciones: estado.restriccionesUsuario,
        candidateProductIds: [...estado.ragIdsRecuperados],
        selectedProductIds: parseado.data.estructuras.flatMap((estructura) => estructura.materiales.map((material) => material.product_id)),
        geometry: resuelto.estructuras.map((estructura) => ({ id: estructura.estructura_id, tipo: estructura.tipo, repeticiones: estructura.repeticiones, unidades: estructura.total_unidades })),
        costMinCop: Math.min(resuelto.totales.total_cop, ...resuelto.alternativas.map((alternativa) => alternativa.total_cop)),
        costChosenCop: resuelto.totales.total_cop,
        ceilingCop: resuelto.comercial.techo_cop,
        deltaCop: resuelto.comercial.delta_cop,
         packages: { ahorro_paquetes_cop: resuelto.totales.ahorro_paquetes_cop, lineas: resuelto.compras.map((compra) => ({ variant_id: compra.variant_id, paquetes: compra.paquetes, unidades: compra.unidades_necesarias, subtotal: compra.subtotal })) },
        instances: parseado.data.estructuras.map((estructura) => ({ id: estructura.estructura_id, repeticiones: estructura.repeticiones })),
        status,
        error,
      });
      if (!estimateValidation.ok || physicalWarnings.length > 0) {
        estado.planResuelto = undefined;
        estado.seleccionFinalIA = [];
        const error = [...estimateValidation.errors, ...physicalWarnings].join(" | ");
        await auditarResuelto("ESTIMACION_INCONSISTENTE", error);
        await actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion", Date.now() - planningStart);
        return {
          ok: false,
          status: "ESTIMACION_INCONSISTENTE",
          advertencias: [...new Set([...estimateValidation.warnings, ...physicalWarnings])],
          accion_requerida: "Revisa las medidas, densidad, mezcla o número de estructuras; la cantidad física estimada no es compatible con la escala solicitada. No cotices ni generes la imagen hasta corregirlo.",
        };
      }
      if (resuelto.sin_cobertura.length > 0 || resuelto.compras.length === 0) {
        estado.planResuelto = undefined;
        estado.seleccionFinalIA = [];
        await auditarResuelto("SIN_COBERTURA", resuelto.sin_cobertura.map((item) => `${item.estructura_id}:${item.tamano}`).join(" | "));
        await actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion", Date.now() - planningStart);
        return {
          ok: false,
          status: "SIN_COBERTURA",
          sin_cobertura: resuelto.sin_cobertura,
          sustituciones_admisibles: resuelto.sustituciones,
          accion_requerida: "Busca productos con los tamaños faltantes o cambia la mezcla a una que tenga cobertura real; no anuncies ni generes este plan.",
        };
      }
      if (resuelto.comercial.estado === "PRESUPUESTO_EXCEDIDO") {
        estado.planResuelto = undefined;
        estado.seleccionFinalIA = [];
        await auditarResuelto("PRESUPUESTO_EXCEDIDO");
        await actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion", Date.now() - planningStart);
        return {
          ok: false,
          status: "PRESUPUESTO_EXCEDIDO",
          total_cop: resuelto.totales.total_cop,
          techo_cop: resuelto.comercial.techo_cop,
          delta_cop: resuelto.comercial.delta_cop,
          alternativas: resuelto.alternativas,
          accion_requerida: "Reduce la complejidad o elige una alternativa compatible; no confirmes ni generes este plan por encima del techo.",
        };
      }
      resuelto.request_id = estado.ragRequestId;
      enriquecerPlanResueltoEvento(resuelto, eventIntent, estado.ragEventEvidence ?? new Map(), estado.ragEventRelaxations ?? []);
      resuelto.approval_token = crearTokenAprobacion(resuelto.plan_hash, estado.ragRequestId);
      estado.planResuelto = resuelto;
      estado.cotizacion = cotizarPlan(resuelto);
      // La cotización se muestra, pero generar queda bloqueado hasta la
      // aprobación explícita del cliente en la tarjeta del plan.
      estado.seleccionFinalIA = [];
      const estadoAuditoria = resuelto.comercial.estado === "APROBACION_REQUERIDA" ? "APROBACION_REQUERIDA" : "VERIFICADO";
      await auditarResuelto(estadoAuditoria);
      await actualizarResultadoBusqueda(ragPool, estado.ragRequestId, resuelto.estructuras.length ? "plan_confirmado" : "NO_MATCH", Date.now() - planningStart);
      return {
        ok: true,
        status: resuelto.estructuras.length ? estadoAuditoria : "NO_MATCH",
        evento: {
          event_label: resuelto.event_label,
          original_request: resuelto.original_request,
          match_levels: resuelto.event_match_levels ?? [],
          relaxations: resuelto.event_relaxations ?? [],
        },
        // Fase 3.2: plan_id/plan_hash no van al modelo — no los necesita
        // (nunca los pasa de vuelta en una llamada; el cliente los lee de
        // `estado.planResuelto`, surfaceado aparte en `ResultadoConversacion`,
        // y `/api/generate` los valida contra el plan guardado en servidor).
        estructuras: resuelto.estructuras.map((estructura) => ({
          estructura_id: estructura.estructura_id,
          nombre: estructura.nombre,
          tipo: estructura.tipo,
          total_unidades: estructura.total_unidades,
          tamanos: estructura.mezcla_real.map((linea) => `R-${linea.diam_pulg}×${linea.unidades}`),
        })),
        total_cop: resuelto.totales.total_cop,
        sustituciones: resuelto.sustituciones,
        sin_cobertura: resuelto.sin_cobertura,
        advertencias: resuelto.advertencias,
        comercial: resuelto.comercial,
        alternativas: resuelto.alternativas,
        fase: "desglose_previo; la imagen se genera despues de mostrarlo",
        cotizacion: estado.cotizacion,
      };
    },

    buscar_decoraciones: async (args) => {
      const encontradas = await buscarDecoraciones(args as { estilos?: string[] });
      const decoracionesConProductos = await Promise.all(
        encontradas.map(async (d) => ({ ...d, productos: await productosPorId(d.elementos) })),
      );
      estado.decoraciones = decoracionesConProductos;
      return {
        total: encontradas.length,
        decoraciones: decoracionesConProductos.map((d) => ({
          id: d.id,
          nombre: d.nombre,
          descripcion: d.descripcion,
          elementos: d.productos.map((p) => p.nombre),
        })),
      };
    },
  };
}
