import "server-only";
import type { RegistroHerramientas } from "@sempertex/agente-core";
import type { Pool } from "pg";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import { calcularMedidas, type Figura, type ResultadoMedidas } from "@/lib/medidas/geometria";
import { getRagPool } from "@/lib/rag/db";
import { buscarCatalogoRag, type ProductoCandidato } from "@/lib/rag/chat/buscar";
import { buscarCatalogoRagConPresupuesto, type PoolItemPresupuesto, type ResultadoBusquedaPresupuesto } from "@/lib/rag/chat/buscar-presupuesto";
import type { RolPresupuesto } from "@/lib/rag/presupuesto/franjas";
import { extraerFiltrosDurosBusqueda } from "@/lib/rag/query-parser/hard-filters";
import { parseEventSearchIntent } from "@/lib/rag/query-parser/event-search";
import { aProductoValidado, validarSeleccion, type ItemRechazado, type ItemValidado, type SeleccionSolicitada } from "@/lib/rag/chat/validar";
import { actualizarResultadoBusqueda, encolarEscrituraObservabilidad, registrarBusqueda, registrarPlanAudit, registrarSeleccion } from "@/lib/rag/observability/log";
import { resolverFranja } from "@/lib/rag/presupuesto/resolver";
import { resolverVariantesPorDespieceBatch, type GrupoDespiece } from "@/lib/rag/tamanos/resolver";
import { PlanDecoracionSchema } from "@/lib/plan/tipos";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { extraerRestriccionesUsuario, validarCardinalidadEventoAbierto, validarCoberturaReferencia, validarEstructurasDeGlobosConGlobos, validarEstructurasFueraDeReferencia, validarPresenciaGlobos, validarRestriccionesPlan } from "@/lib/plan/restricciones";
import { perfilCreatividad, type NivelCreatividad } from "@/lib/ia/creatividad";
import { parseEventIntent } from "@/lib/rag/query-parser/parse-event";
import type { CatalogAllowlist, EventMatchEvidence, EventMatchLevel } from "@/lib/rag/retrieval/types";
import { allowlistDesdeMapa, crearTokenPlan } from "@/lib/plan/aprobacion";
import { respuestaCatalogoLoraNoDisponible } from "@/lib/lora/catalogo-no-disponible";
import {
  MENSAJE_CLIENTE_ESTIMACION,
  MENSAJE_CLIENTE_PIEZAS,
  MENSAJE_CLIENTE_PLAN_EN_AJUSTE,
  MENSAJE_CLIENTE_REFERENCIA,
  MENSAJE_CLIENTE_SIN_BUSQUEDA,
  MENSAJE_CLIENTE_SIN_GLOBOS,
  MENSAJE_CLIENTE_VERIFICACION_FALLIDA,
  mensajeClientePresupuesto,
  mensajeClienteRestricciones,
  mensajeClienteSinCobertura,
} from "@/lib/ia/mensajes-cliente";
import { PythonPlanMappingError } from "@/lib/plan/python-mapper";
import { resolverPlanConBackend, type ResolucionPlan } from "@/lib/plan/resolver-backend";
import { mezclasCompatiblesConDiametros } from "@/lib/plan/resolver";
import { canonizarColoresPlan } from "@/lib/plan/colores-catalogo";
import { PLAN_DECORACION_ENABLED, RAG_ENABLED, RAG_FRANJAS_ENABLED, featureEnabled } from "@/lib/ia/feature-flags";
import { isPythonAdapterError, seleccionarBackendPython } from "@/lib/ia/python-adapter";
import { AllowlistProductoVarianteError } from "@/lib/plan/allowlist-producto-variante";
import { sceneShadowPipeline } from "@/lib/scene/orchestrator";
import { blockingPhysicalWarnings, validateMaterialEstimate } from "@/lib/materiales/estimacion";
import type { Faceta, FiltrosCatalogo } from "@/lib/shopify/consultas";
import type { Brief, DecoracionConProductos, Producto } from "@/lib/types";
import { HERRAMIENTAS_PLAN, HERRAMIENTAS_RAG } from "./herramientas";
import type { ReferenceBlueprintV2 } from "./reference-blueprint";
import type { Herramienta } from "./tipos";
import { z } from "zod";

/**
 * Fase 3.9: herramientas sin efectos comerciales — nunca deciden catálogo,
 * precio, stock ni aprobación (invariante del capítulo 6), y lo único que
 * escriben en `EstadoConversacion` son campos de resultado de búsqueda que
 * de todas formas se sobrescriben por completo en cada llamada nueva. Se
 * excluye deliberadamente cualquier herramienta que toque
 * `seleccionFinalIA`/`planResuelto`/`cotizacion` o que dependa del orden de
 * ejecución (`guardar_brief`, `calcular_medidas`,
 * `confirmar_seleccion_rag`,
 * `confirmar_plan_decoracion`). `ejecutarConversacion`/`ejecutarConversacionStream`
 * solo paralelizan una vuelta si CADA llamada de esa vuelta está en este
 * set Y ningún nombre se repite (ver `puedeParalelizarse` en agente-core) —
 * dos llamadas al mismo handler en la misma vuelta seguirían corriendo en
 * secuencia porque compiten por el mismo campo de estado.
 */
export const HERRAMIENTAS_SOLO_LECTURA = new Set([
  "buscar_catalogo_rag",
]);

export function herramientasActivas(): Herramienta[] {
  if (!RAG_ENABLED) return [];
  if (PLAN_DECORACION_ENABLED && RAG_ENABLED) {
    return [...HERRAMIENTAS_RAG, ...HERRAMIENTAS_PLAN];
  }
  return HERRAMIENTAS_RAG;
}

// Se permiten varias búsquedas por turno porque una referencia puede contener
// conceptos comerciales distintos; el límite evita dejar una conversación
// colgada indefinidamente.
export const VUELTAS_MAX = 10;

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
  // `confirmar_seleccion_rag` resolvió al menos un id real; el frontend usa
  // esto para disparar /api/generate sin que el cliente haga clic.
  seleccionFinalIA?: Producto[];
  instruccionIA?: string;
  // Whitelist de productos realmente recuperados en ESTE request/turno (plan
  // §4.8). `ejecutar.ts` crea este estado por ejecución; sólo se acumulan
  // varias llamadas de herramienta del mismo turno, nunca historial viejo.
  ragIdsRecuperados: Set<string>;
  /** Product -> exact variant whitelist exposed by retrieval in this request. */
  ragVariantIdsRecuperados: Map<string, Set<string>>;
  /** Published catalog snapshot used to build the current retrieval whitelist. */
  ragCatalogSnapshotId?: string;
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
 * Por cada producto que dejó una estructura SIN_COBERTURA: qué tamaños
 * faltaron, cuáles tiene disponibles en los candidatos de este turno y qué
 * mezclas sí caben con ellos. Sin esto el modelo reintentaba a ciegas (A6).
 */
export function coberturaPorProducto(
  sinCobertura: ReadonlyArray<{ estructura_id: string; product_id: string; tamano: string }>,
  candidatos: ReadonlyArray<ProductoCandidato>,
): Array<{ estructura_id: string; product_id: string; tamanos_faltantes: string[]; tamanos_disponibles: string[]; mezclas_compatibles: string[] }> {
  const grupos = new Map<string, { estructura_id: string; product_id: string; faltantes: Set<string> }>();
  for (const item of sinCobertura) {
    const clave = `${item.estructura_id}|${item.product_id}`;
    const grupo = grupos.get(clave) ?? { estructura_id: item.estructura_id, product_id: item.product_id, faltantes: new Set<string>() };
    grupo.faltantes.add(item.tamano);
    grupos.set(clave, grupo);
  }
  return [...grupos.values()].map((grupo) => {
    const candidato = candidatos.find((item) => item.productId === grupo.product_id || item.variantes.some((variante) => variante.variantId === grupo.product_id));
    const diametros = [...new Set((candidato?.variantes ?? [])
      .filter((variante) => variante.disponible && variante.forma === "redondo" && variante.diamPulg != null)
      .map((variante) => variante.diamPulg!))].sort((a, b) => a - b);
    return {
      estructura_id: grupo.estructura_id,
      product_id: grupo.product_id,
      tamanos_faltantes: [...grupo.faltantes],
      tamanos_disponibles: diametros.map((diametro) => `R-${diametro}`),
      mezclas_compatibles: mezclasCompatiblesConDiametros(diametros),
    };
  });
}

/**
 * Al agotar VUELTAS_MAX no siempre "se enredó" de verdad: si el modelo
 * llamó confirmar_seleccion_rag justo en la última vuelta permitida, la
 * selección ya quedó guardada y la imagen ya se está generando — decirle al
 * cliente "me enredé" ahí sería mentirle sobre algo que en realidad sí
 * funcionó, solo que no alcanzó a mandar el texto de cierre.
 */
export function textoAlAgotarVueltas(estado: EstadoConversacion): string {
  // Modo diseño: el plan ya quedó verificado y la tarjeta se muestra con el
  // evento `fin`; decir "me enredé" contradice lo que el cliente ve en pantalla
  // (caso "cardinalidad" de eval/chat/jerga-v001.json, 2026-09-14).
  if (estado.planResuelto) {
    return "Ya te armé la propuesta: revisa el desglose en pantalla y dime si la apruebas o qué quieres ajustar.";
  }
  if (estado.seleccionFinalIA?.length) {
    return "¡Ya elegí las piezas y se está generando tu visualización! Dame un momento.";
  }
  return "Perdón, me enredé un poco. ¿Me lo repites de otra forma?";
}

/** Arma el registro de herramientas (nombre → handler) que el motor genérico
 * de @sempertex/agente-core despacha — cada cuerpo es el mismo que tenía el
 * if-chain de ejecutar.ts antes de esta extracción, sin cambios de lógica. */
export function crearRegistroHerramientas(estado: EstadoConversacion, options: {
  pool?: Pool;
  catalogAllowlist?: CatalogAllowlist;
  /** `LORA_*` cause when the active LoRA mode could not resolve its catalog pool: catalog tools fail closed. */
  catalogoLoraNoDisponible?: string;
  correlationId?: string;
  signal?: AbortSignal;
  /** Creativity level chosen in the UI; decides how many extra pieces a reference plan may add. */
  creatividad?: NivelCreatividad;
} = {}): RegistroHerramientas {
  const ragPool = options.pool ?? getRagPool();
  const catalogoBloqueado = options.catalogoLoraNoDisponible;
  return {
    guardar_brief: async (args) => {
      Object.assign(estado.brief, args);
      return { ok: true, brief: estado.brief };
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

    buscar_catalogo_rag: async (args) => {
      if (catalogoBloqueado) return respuestaCatalogoLoraNoDisponible(catalogoBloqueado);
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
      // The budget pipeline is still TypeScript-owned. Do not execute it when
      // Python is selected; a partial canary must not silently mix authorities.
      const franjaResuelta = RAG_FRANJAS_ENABLED && seleccionarBackendPython().backend !== "python"
        ? resolverFranja(estado.brief.presupuesto)
        : null;

      if (franjaResuelta) {
        const respuesta = await buscarCatalogoRagConPresupuesto(
          pool,
          mensaje,
          franjaResuelta.franja,
          franjaResuelta.cifraCliente,
          {
            filtrosDuros,
            eventIntent,
            focusedQueries: [mensaje],
            allowlist: options.catalogAllowlist,
            rerankRequestId: estado.ragRequestId,
            rerankCorrelationId: options.correlationId ?? estado.ragRequestId,
            rerankSignal: options.signal,
          },
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

      const respuesta = await buscarCatalogoRag(pool, mensaje, {
        filtrosDuros,
        eventIntent,
        focusedQueries: [mensaje],
        allowlist: options.catalogAllowlist,
        catalogSnapshotId: estado.ragCatalogSnapshotId,
        rerankRequestId: estado.ragRequestId,
        rerankCorrelationId: options.correlationId ?? estado.ragRequestId,
        rerankSignal: options.signal,
      });
      estado.ragCandidatos = [...new Map(
        [...(estado.ragCandidatos ?? []), ...respuesta.candidatos].map((candidate) => [candidate.productId, candidate]),
      ).values()];
      if (respuesta.catalogSnapshotId) estado.ragCatalogSnapshotId = respuesta.catalogSnapshotId;
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
      if (catalogoBloqueado) return respuestaCatalogoLoraNoDisponible(catalogoBloqueado);
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
      const resultado = await validarSeleccion(
        pool,
        seleccion,
        estado.ragVariantIdsRecuperados,
        estado.ragCatalogSnapshotId,
        { signal: options.signal, correlationId: options.correlationId ?? estado.ragRequestId },
      );
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

      // Fase 3.8: la fila que crea `registrarBusqueda` (tool `buscar_catalogo_rag`,
      // ya awaiteada en una vuelta anterior) es durable para cuando el modelo
      // puede llegar a llamar a esta herramienta — la selección/actualización
      // de esa fila puede salir de la ruta crítica sin arriesgar el orden.
      encolarEscrituraObservabilidad(registrarSeleccion(pool, {
        requestId: estado.ragRequestId,
        selectedProductIds: resultado.validados.map((v) => v.productId),
        rejected: resultado.rechazados,
        status: statusSeleccion,
        latencyTotalMs: Date.now() - t0,
      }));
      encolarEscrituraObservabilidad(actualizarResultadoBusqueda(
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
      ));

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
      if (catalogoBloqueado) return respuestaCatalogoLoraNoDisponible(catalogoBloqueado);
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
        encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion"));
        return { ok: false, errores: parseado.error.issues.map((issue) => `${issue.path.join(".") || "plan"}: ${issue.message}`), mensaje_cliente: MENSAJE_CLIENTE_PLAN_EN_AJUSTE };
      }
      // Colores del material al vocabulario del catálogo antes de validar y
      // resolver: "azul rey" → "azul", "rosa" → "rosado" (A6).
      const { plan: planCanonico } = canonizarColoresPlan(parseado.data);
      const erroresDeIntencion = validarRestriccionesPlan(planCanonico, estado.restriccionesUsuario);
      const erroresDeCardinalidad = validarCardinalidadEventoAbierto(
        planCanonico,
        eventIntent.event_type,
        estado.solicitudOriginal,
        estado.ragIdsRecuperados.size > 0,
        estado.referenceBlueprint,
        perfilCreatividad(options.creatividad).rangoEstructuras,
      );
      const erroresDeReferencia = validarEstructurasFueraDeReferencia(planCanonico, estado.referenceBlueprint, estado.solicitudOriginal, perfilCreatividad(options.creatividad).estructurasExtraConReferencia);
      const erroresDeContrato = [...erroresDeIntencion, ...erroresDeCardinalidad, ...erroresDeReferencia];
      if (erroresDeContrato.length > 0) {
        estado.planResuelto = undefined;
        estado.seleccionFinalIA = [];
        encolarEscrituraObservabilidad(registrarPlanAudit(ragPool, {
          requestId: estado.ragRequestId,
          solicitudOriginal: estado.solicitudOriginal,
          restricciones: estado.restriccionesUsuario,
          candidateProductIds: [...estado.ragIdsRecuperados],
          status: "RESTRICCIONES_INCONSISTENTES",
          error: erroresDeContrato.join(" | "),
        }));
        encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion"));
        return {
          ok: false,
          status: "RESTRICCIONES_INCONSISTENTES",
          errores: erroresDeContrato,
          accion_requerida: erroresDeReferencia.length > 0
            ? "Con imagen de referencia, cada estructura de globos debe materializar un elemento de la referencia con referencia_element_id: quita las estructuras que la referencia no tiene y vuelve a confirmar; no anuncies ni generes una imagen."
            : "Corrige la cardinalidad o los colores del plan antes de confirmar; no anuncies ni generes una imagen.",
          mensaje_cliente: mensajeClienteRestricciones(erroresDeContrato),
        };
      }
      const categoriaPorProducto = new Map((estado.ragCandidatos ?? []).map((candidato) => [candidato.productId, candidato.categoria]));
      const erroresDeGlobos = validarPresenciaGlobos(planCanonico, categoriaPorProducto, estado.solicitudOriginal);
      if (erroresDeGlobos.length > 0) {
        estado.planResuelto = undefined;
        estado.seleccionFinalIA = [];
        encolarEscrituraObservabilidad(registrarPlanAudit(ragPool, {
          requestId: estado.ragRequestId,
          solicitudOriginal: estado.solicitudOriginal,
          restricciones: estado.restriccionesUsuario,
          candidateProductIds: [...estado.ragIdsRecuperados],
          status: "PLAN_SIN_GLOBOS",
          error: erroresDeGlobos.join(" | "),
        }));
        encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion"));
        return {
          ok: false,
          status: "PLAN_SIN_GLOBOS",
          errores: erroresDeGlobos,
          accion_requerida: "El plan solo tiene accesorios. Busca globos en los colores pedidos con buscar_catalogo_rag (sin exigir la ocasión si no aparecen) y arma al menos una estructura de globos; serpentinas, velas y banderolas solo acompañan. No anuncies ni generes este plan.",
          mensaje_cliente: MENSAJE_CLIENTE_SIN_GLOBOS,
        };
      }
      const estructurasSinGlobos = validarEstructurasDeGlobosConGlobos(planCanonico, categoriaPorProducto);
      if (estructurasSinGlobos.length > 0) {
        estado.planResuelto = undefined;
        estado.seleccionFinalIA = [];
        encolarEscrituraObservabilidad(registrarPlanAudit(ragPool, {
          requestId: estado.ragRequestId,
          solicitudOriginal: estado.solicitudOriginal,
          restricciones: estado.restriccionesUsuario,
          candidateProductIds: [...estado.ragIdsRecuperados],
          status: "ESTRUCTURA_SIN_GLOBOS",
          error: estructurasSinGlobos.join(" | "),
        }));
        encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion"));
        return {
          ok: false,
          status: "ESTRUCTURA_SIN_GLOBOS",
          errores: estructurasSinGlobos,
          accion_requerida: "Una estructura oficial de globos (figura, bouquet, centro de mesa, arco…) quedó materializada solo con accesorios. Arma esa estructura con globos del catálogo de este turno; una banderola, serpentina o cartel va como tipo accesorio, sin estructura_oficial y sin nombre de estructura de globos. No anuncies ni generes este plan.",
          mensaje_cliente: MENSAJE_CLIENTE_SIN_GLOBOS,
        };
      }
      // Cobertura referencia→plan (plan de integración de referencias
      // visuales, R4): con una imagen de referencia analizada en este turno,
      // cada elemento aprobado debe quedar cubierto por una estructura
      // (referencia_element_id) o declarado omitido (referencia_omitida) —
      // omitir uno en silencio es tan deshonesto como omitir un producto sin
      // decirlo (ver HONESTIDAD AL SUSTITUIR en el prompt del sistema).
      const elementosSinCubrir = validarCoberturaReferencia(planCanonico, estado.referenceBlueprint);
      if (elementosSinCubrir.length > 0) {
        estado.planResuelto = undefined;
        estado.seleccionFinalIA = [];
        encolarEscrituraObservabilidad(registrarPlanAudit(ragPool, {
          requestId: estado.ragRequestId,
          solicitudOriginal: estado.solicitudOriginal,
          restricciones: estado.restriccionesUsuario,
          candidateProductIds: [...estado.ragIdsRecuperados],
          status: "COBERTURA_REFERENCIA_INCOMPLETA",
          error: elementosSinCubrir.join(" | "),
        }));
        encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion"));
        return {
          ok: false,
          status: "COBERTURA_REFERENCIA_INCOMPLETA",
          elementos_sin_cubrir: elementosSinCubrir,
          accion_requerida: "Para cada elemento sin cubrir: asígnale una estructura con referencia_element_id, o decláralo en referencia_omitida con un motivo real. No anuncies ni generes esta imagen hasta cubrir todos.",
          mensaje_cliente: MENSAJE_CLIENTE_REFERENCIA,
        };
      }
      if (featureEnabled("SCENE_PLAN_V2_SHADOW") && estado.solicitudOriginal.trim()) {
        let shadow: Awaited<ReturnType<typeof sceneShadowPipeline>>;
        try {
          shadow = await sceneShadowPipeline(estado.solicitudOriginal, ragPool, planCanonico.estructuras.length);
        } catch (error) {
          shadow = {
            v1_exists: planCanonico.estructuras.length > 0,
            v2_ran: false,
            v2_slots_covered: 0,
            v2_total_slots: 0,
            v2_gaps: 0,
            v2_approved: false,
            latency_v2_ms: 0,
            error: error instanceof Error ? error.message : String(error),
          };
        }
        encolarEscrituraObservabilidad(registrarPlanAudit(ragPool, {
          requestId: estado.ragRequestId,
          solicitudOriginal: estado.solicitudOriginal,
          geometry: shadow,
          status: "SCENE_V2_SHADOW",
          error: shadow.error,
          flagSnapshot: { scenePlanV2Shadow: true },
        }));
      }
      const planningStart = Date.now();
      const backendPlan = seleccionarBackendPython().backend;
      // Same-turn allowlist: only the variants the model actually saw in this
      // turn. It travels signed with the plan so /api/generate and
      // /api/plan-editar can restate it without trusting the browser.
      const allowlistTurno = allowlistDesdeMapa(estado.ragVariantIdsRecuperados);
      const snapshotTurno = estado.ragCatalogSnapshotId ?? null;
      const correlacionPython = z.string().uuid().safeParse(options.correlationId);
      const fallarPorBackend = (motivo: string, detalle: string, accionRequerida: string, mensajeCliente: string) => {
        estado.planResuelto = undefined;
        estado.seleccionFinalIA = [];
        encolarEscrituraObservabilidad(registrarPlanAudit(ragPool, {
          requestId: estado.ragRequestId,
          solicitudOriginal: estado.solicitudOriginal,
          restricciones: estado.restriccionesUsuario,
          candidateProductIds: [...estado.ragIdsRecuperados],
          status: "BACKEND_NO_DISPONIBLE",
          error: `${motivo}: ${detalle}`,
        }));
        encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion", Date.now() - planningStart));
        return { ok: false, status: "BACKEND_NO_DISPONIBLE", accion_requerida: accionRequerida, mensaje_cliente: mensajeCliente };
      };
      const FALLO_TECNICO = "No se pudo verificar el plan contra el catálogo comercial. Dile al cliente que hubo un problema técnico y que vuelva a intentarlo; no inventes precios, no confirmes el plan y no generes ninguna imagen.";
      // When the Python resolver is the selected commercial authority it needs
      // the published snapshot of this turn, and there is no implicit fallback
      // to TypeScript: answering with a plan the operator never verified would
      // hide a broken cutover. PYTHON_BACKEND_KILL_SWITCH is the rollback.
      if (backendPlan === "python" && !snapshotTurno) {
        return fallarPorBackend(
          "SIN_SNAPSHOT_CATALOGO",
          "el turno no tiene un snapshot de catálogo publicado",
          "Busca primero en el catálogo con buscar_catalogo_rag: sin una búsqueda de este turno no hay catálogo verificado contra el que validar precios, stock ni variantes. No confirmes el plan ni generes una imagen hasta tenerla.",
          MENSAJE_CLIENTE_SIN_BUSQUEDA,
        );
      }
      let resolucion: ResolucionPlan;
      try {
        resolucion = backendPlan === "python" && snapshotTurno
          ? await resolverPlanConBackend({
              backend: "python",
              plan: planCanonico,
              allowlist: allowlistTurno,
              catalogSnapshotId: snapshotTurno,
              loraAllowlist: options.catalogAllowlist,
              requestId: estado.ragRequestId,
              correlationId: correlacionPython.success ? correlacionPython.data : estado.ragRequestId,
              ...(options.signal ? { signal: options.signal } : {}),
            })
          : await resolverPlanConBackend({
              backend: "next",
              pool: ragPool,
              plan: planCanonico,
              whitelist: estado.ragVariantIdsRecuperados,
              loraAllowlist: options.catalogAllowlist,
            });
      } catch (error) {
        if (error instanceof AllowlistProductoVarianteError) {
          // Model-correctable: the plan paired a variant with a product that
          // does not own it. Not a technical failure, so the model can retry.
          estado.planResuelto = undefined;
          estado.seleccionFinalIA = [];
          encolarEscrituraObservabilidad(registrarPlanAudit(ragPool, {
            requestId: estado.ragRequestId,
            solicitudOriginal: estado.solicitudOriginal,
            restricciones: estado.restriccionesUsuario,
            candidateProductIds: [...estado.ragIdsRecuperados],
            status: "PRODUCTO_VARIANTE_INCONSISTENTE",
            error: `${error.causa}: ${error.message}`,
          }));
          encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion", Date.now() - planningStart));
          return {
            ok: false,
            status: "PRODUCTO_VARIANTE_INCONSISTENTE",
            accion_requerida: "Cada material y cada variant_override debe usar un variant_id que pertenezca a su product_id según buscar_catalogo_rag. Corrige los ids y vuelve a confirmar; no anuncies ni generes imagen.",
            mensaje_cliente: MENSAJE_CLIENTE_PIEZAS,
          };
        }
        if (isPythonAdapterError(error)) return fallarPorBackend(error.code, error.domainCode ?? error.message, FALLO_TECNICO, MENSAJE_CLIENTE_VERIFICACION_FALLIDA);
        if (error instanceof PythonPlanMappingError) return fallarPorBackend(error.code, error.message, FALLO_TECNICO, MENSAJE_CLIENTE_VERIFICACION_FALLIDA);
        throw error;
      }
      const resuelto = resolucion.resuelto;
      const materialEstimate = resolucion.materialEstimate;
      const estimateValidation = validateMaterialEstimate(materialEstimate);
      const physicalWarnings = blockingPhysicalWarnings(materialEstimate);
      const auditarResuelto = (status: string, error?: string) => encolarEscrituraObservabilidad(registrarPlanAudit(ragPool, {
        requestId: estado.ragRequestId,
        planHash: resuelto.plan_hash,
        solicitudOriginal: estado.solicitudOriginal,
        restricciones: estado.restriccionesUsuario,
        candidateProductIds: [...estado.ragIdsRecuperados],
        selectedProductIds: planCanonico.estructuras.flatMap((estructura) => estructura.materiales.map((material) => material.product_id)),
        geometry: resuelto.estructuras.map((estructura) => ({ id: estructura.estructura_id, tipo: estructura.tipo, repeticiones: estructura.repeticiones, unidades: estructura.total_unidades })),
        costMinCop: Math.min(resuelto.totales.total_cop, ...resuelto.alternativas.map((alternativa) => alternativa.total_cop)),
        costChosenCop: resuelto.totales.total_cop,
        ceilingCop: resuelto.comercial.techo_cop,
        deltaCop: resuelto.comercial.delta_cop,
         packages: { ahorro_paquetes_cop: resuelto.totales.ahorro_paquetes_cop, lineas: resuelto.compras.map((compra) => ({ variant_id: compra.variant_id, paquetes: compra.paquetes, unidades: compra.unidades_necesarias, subtotal: compra.subtotal })) },
        instances: planCanonico.estructuras.map((estructura) => ({ id: estructura.estructura_id, repeticiones: estructura.repeticiones })),
        status,
        error,
      }));
      if (!estimateValidation.ok || physicalWarnings.length > 0) {
        estado.planResuelto = undefined;
        estado.seleccionFinalIA = [];
        const error = [...estimateValidation.errors, ...physicalWarnings].join(" | ");
        auditarResuelto("ESTIMACION_INCONSISTENTE", error);
        encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion", Date.now() - planningStart));
        return {
          ok: false,
          status: "ESTIMACION_INCONSISTENTE",
          advertencias: [...new Set([...estimateValidation.warnings, ...physicalWarnings])],
          accion_requerida: "Revisa las medidas, densidad, mezcla o número de estructuras; la cantidad física estimada no es compatible con la escala solicitada. No cotices ni generes la imagen hasta corregirlo.",
          mensaje_cliente: MENSAJE_CLIENTE_ESTIMACION,
        };
      }
      if (resuelto.sin_cobertura.length > 0 || resuelto.compras.length === 0) {
        estado.planResuelto = undefined;
        estado.seleccionFinalIA = [];
        auditarResuelto("SIN_COBERTURA", resuelto.sin_cobertura.map((item) => `${item.estructura_id}:${item.tamano}`).join(" | "));
        encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion", Date.now() - planningStart));
        return {
          ok: false,
          status: "SIN_COBERTURA",
          sin_cobertura: resuelto.sin_cobertura,
          sustituciones_admisibles: resuelto.sustituciones,
          cobertura_por_producto: coberturaPorProducto(resuelto.sin_cobertura, estado.ragCandidatos ?? []),
          accion_requerida: "Revisa cobertura_por_producto: en cada estructura usa una mezcla de mezclas_compatibles para ese producto, o elige con buscar_catalogo_rag otro producto del mismo color que tenga los tamaños faltantes. Si mezclas_compatibles está vacío, ese producto no sirve para una estructura de globos: cámbialo. No anuncies ni generes este plan.",
          mensaje_cliente: mensajeClienteSinCobertura(resuelto.sin_cobertura, new Map(planCanonico.estructuras.map((estructura) => [estructura.estructura_id, estructura.nombre]))),
        };
      }
      if (resuelto.comercial.estado === "PRESUPUESTO_EXCEDIDO") {
        estado.planResuelto = undefined;
        estado.seleccionFinalIA = [];
        auditarResuelto("PRESUPUESTO_EXCEDIDO");
        encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion", Date.now() - planningStart));
        return {
          ok: false,
          status: "PRESUPUESTO_EXCEDIDO",
          total_cop: resuelto.totales.total_cop,
          techo_cop: resuelto.comercial.techo_cop,
          delta_cop: resuelto.comercial.delta_cop,
          alternativas: resuelto.alternativas,
          accion_requerida: "Reduce la complejidad o elige una alternativa compatible; no confirmes ni generes este plan por encima del techo.",
          mensaje_cliente: mensajeClientePresupuesto(resuelto.totales.total_cop, resuelto.comercial.techo_cop, resuelto.comercial.delta_cop),
        };
      }
      resuelto.request_id = estado.ragRequestId;
      enriquecerPlanResueltoEvento(resuelto, eventIntent, estado.ragEventEvidence ?? new Map(), estado.ragEventRelaxations ?? []);
      resuelto.approval_token = crearTokenPlan({
        planHash: resuelto.plan_hash,
        requestId: estado.ragRequestId,
        backend: resolucion.backend,
        catalogSnapshotId: snapshotTurno,
        allowlist: allowlistTurno,
      });
      estado.planResuelto = resuelto;
      estado.cotizacion = resolucion.cotizacion;
      // La cotización se muestra, pero generar queda bloqueado hasta la
      // aprobación explícita del cliente en la tarjeta del plan.
      estado.seleccionFinalIA = [];
      const estadoAuditoria = resuelto.comercial.estado === "APROBACION_REQUERIDA" ? "APROBACION_REQUERIDA" : "VERIFICADO";
      auditarResuelto(estadoAuditoria);
      encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, resuelto.estructuras.length ? "plan_confirmado" : "NO_MATCH", Date.now() - planningStart));
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

  };
}
