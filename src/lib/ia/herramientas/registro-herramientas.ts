import "server-only";
import type { RegistroHerramientas } from "@sempertex/agente-core";
import type { Pool } from "pg";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import { FalloTecnicoTurnoError } from "@/lib/ia/herramientas/fallo-tecnico-turno";
import { advertenciasPuertaFisica, mezclasCompatiblesConDiametros, tamanosObligatorios } from "@/lib/plan/mezclas";
import { getRagPool } from "@/lib/rag/db";
import { buscarCatalogoRag, type ProductoCandidato } from "@/lib/rag/chat/buscar";
import { avisoFiltrosBusqueda, filtrosDurosDeBusqueda } from "@/lib/rag/chat/filtros-turno";
import type { FiltrosDurosBusqueda } from "@/lib/rag/query-parser/hard-filters";
import { parseEventSearchIntent } from "@/lib/rag/query-parser/event-search";
import { aProductoValidado, validarSeleccion, type ItemRechazado, type ItemValidado, type SeleccionSolicitada } from "@/lib/rag/chat/validar";
import { actualizarResultadoBusqueda, encolarEscrituraObservabilidad, registrarBusqueda, registrarPlanAudit, registrarSeleccion, type HechosPeticionPlan } from "@/lib/rag/observability/log";
import { PlanDecoracionSchema, type PlanDecoracion } from "@/lib/plan/tipos";
import type { PistaArmado } from "@/lib/plan/armado-bouquet";
import type { PistaPatron } from "@/lib/plan/patron-color";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { aplicarColoresReferencia, extraerRestriccionesUsuario, validarCardinalidadEventoAbierto, validarCoberturaReferencia, validarEstructurasDeGlobosConGlobos, validarEstructurasFueraDeReferencia, validarPresenciaGlobos, validarRangoCreatividad, validarReferenciaSinGlobos, validarRestriccionesPlan, validarUnidadesDeclaradas, MENSAJE_CLIENTE_REFERENCIA_SIN_GLOBOS } from "@/lib/plan/restricciones";
import { CREATIVIDAD_POR_DEFECTO, perfilCreatividad, type NivelCreatividad } from "@/lib/ia/escena/creatividad";
import { parseEventIntent } from "@/lib/rag/query-parser/parse-event";
import type { CatalogAllowlist, EventMatchEvidence, EventMatchLevel } from "@/lib/rag/retrieval/types";
import { abrirContextoPlan, allowlistDesdeMapa, crearTokenPlan, verificarTokenAprobacion } from "@/lib/plan/aprobacion";
import { aplicarEdicionPlan } from "@/lib/plan/aplicar-edicion";
import { EdicionSchema, type BasePlan, type Edicion } from "@/lib/plan/edicion-esquemas";
import { PlanEditError } from "@/lib/plan/edicion-error";
import { respuestaCatalogoLoraNoDisponible } from "@/lib/lora/catalogo-no-disponible";
import {
  MENSAJE_CLIENTE_ESTIMACION,
  MENSAJE_CLIENTE_PIEZAS,
  MENSAJE_CLIENTE_PLAN_EN_AJUSTE,
  MENSAJE_CLIENTE_REFERENCIA,
  MENSAJE_CLIENTE_SIN_BUSQUEDA,
  MENSAJE_CLIENTE_SIN_GLOBOS,
  mensajeClientePresupuesto,
  mensajeClienteRestricciones,
  mensajeClienteSinCobertura,
} from "@/lib/ia/herramientas/mensajes-cliente";
import { PythonPlanMappingError } from "@/lib/plan/python-mapper";
import { resolverPlan, type ResolucionPlan } from "@/lib/plan/resolver-backend";
import { canonizarColoresPlan } from "@/lib/plan/colores-catalogo";
import { coloresSinCubrir } from "@/lib/rag/chat/relajacion-filtros";
import { coloresVigentes, extraerRestriccionesConversacion } from "@/lib/plan/restricciones-conversacion";
import { digitoDeFiguraNumero, numerosDeLaFoto, numerosPedidos, validarNumerosDeLaFoto, validarNumerosPedidos } from "@/lib/plan/numeros-pedidos";
import { conFotosDeCatalogo } from "@/lib/plan/cotizacion-fotos";
import { sanearPorquesPlan } from "@/lib/plan/porque-cliente";
import { sanearMarcasPlan } from "@/lib/plan/marcas-registradas";
import { aplicarFuenteMedidasEspacio, clienteDioMedidasEspacio } from "@/lib/plan/medidas-defecto";
import { coloresElementoReferencia, coloresFotoParaBusqueda, coloresReferenciaOmitidos, esSustitucionDeColor, productosGloboPorColor, type ProductoColorDisponible } from "@/lib/plan/colores-referencia";
import { colorDeCompraSinVenta } from "@/lib/rag/catalog/similitud-color";
import { buscarGlobosPorColor } from "@/lib/rag/catalog/globos-por-color";
import { buscarNumerosPorDigito, digitosBuscados } from "@/lib/rag/catalog/numeros-por-digito";
import { RAG_ENABLED, featureEnabled } from "@/lib/ia/nucleo/feature-flags";
import { isPythonAdapterError } from "@/lib/ia/nucleo/python-adapter";
import { AllowlistProductoVarianteError } from "@/lib/plan/allowlist-producto-variante";
import { sceneShadowPipeline } from "@/lib/scene/orchestrator";
import { validateMaterialEstimate } from "@/lib/materiales/estimacion";
import type { Faceta, FiltrosCatalogo } from "@/lib/shopify/consultas";
import type { Brief, DecoracionConProductos, Producto } from "@/lib/types";
import { ajustarCoberturaPlan, avisosClienteAjustes, mezclasAdmisiblesEstructura, type AjusteCobertura } from "@/lib/plan/cobertura-materiales";
import { TIPOS_ESTRUCTURA_GEOMETRICOS } from "@/lib/plan/composicion";
import { ACCION_PLAN_NO_CONVERGE, disponibilidadDelTurno, quitarMaterialesSinCobertura, RECHAZOS_MAXIMOS, RECHAZOS_PARA_CONVERGER, unirCandidatosTurno } from "./convergencia-plan";
import { normalizarArgsBrief } from "./brief-herramienta";
import { AJUSTAR_PLAN_DECORACION, HERRAMIENTAS_PLAN, HERRAMIENTAS_RAG } from "./herramientas";
import type { ReferenceBlueprintV2 } from "../referencia/reference-blueprint";
import type { Herramienta } from "../nucleo/tipos";
import { z } from "zod";

/**
 * Fase 3.9: herramientas sin efectos comerciales — nunca deciden catálogo,
 * precio, stock ni aprobación (invariante del capítulo 6), y lo único que
 * escriben en `EstadoConversacion` son campos de resultado de búsqueda que
 * de todas formas se sobrescriben por completo en cada llamada nueva. Se
 * excluye deliberadamente cualquier herramienta que toque
 * `seleccionFinalIA`/`planResuelto`/`cotizacion` o que dependa del orden de
 * ejecución (`guardar_brief`, `confirmar_seleccion_rag`,
 * `confirmar_plan_decoracion`). `ejecutarConversacion`/`ejecutarConversacionStream`
 * solo paralelizan una vuelta si CADA llamada de esa vuelta está en este
 * set Y ningún nombre se repite (ver `puedeParalelizarse` en agente-core) —
 * dos llamadas al mismo handler en la misma vuelta seguirían corriendo en
 * secuencia porque compiten por el mismo campo de estado.
 */
export const HERRAMIENTAS_SOLO_LECTURA = new Set([
  "buscar_catalogo_rag",
]);

/**
 * Herramientas expuestas al modelo (el parámetro existe para poder probar
 * el catálogo apagado sin tocar el entorno). DISEÑO DE DECORACIÓN es el único
 * modo: las cantidades y los tamaños de una estructura tienen un solo dueño,
 * `confirmar_plan_decoracion`.
 *
 * `planVigente` expone `ajustar_plan_decoracion` (§7 "editar una propuesta
 * desde el chat") — nunca por defecto: el llamador solo la activa cuando
 * `estado.planVigente` ya existe, es decir cuando el token firmado del turno
 * verificó una propuesta editable (`planVigenteDelTurno`). El modelo no puede
 * convocar la herramienta con solo pedirla.
 */
export function herramientasActivas(flags: { ragEnabled?: boolean; planVigente?: boolean } = {}): Herramienta[] {
  const ragEnabled = flags.ragEnabled ?? RAG_ENABLED;
  if (!ragEnabled) return [];
  return [...HERRAMIENTAS_RAG, ...HERRAMIENTAS_PLAN, ...(flags.planVigente ? [AJUSTAR_PLAN_DECORACION] : [])];
}

/**
 * Evidencia no-modelo de que hay una propuesta vigente para editar (§7): el
 * navegador ecoa el plan que muestra la tarjeta, y esto verifica su token
 * firmado (firma HMAC, TTL, `backend === "python"` — un token "next" es
 * irresoluble desde que se borró el resolutor de TypeScript — y el mismo
 * `plan_hash`) antes de creer nada. Un candidato que falle cualquier chequeo
 * es exactamente como si el navegador no hubiera mandado nada:
 * `ajustar_plan_decoracion` queda oculta y el modelo solo puede diseñar una
 * propuesta nueva. El booleano que ve el resto del turno (`Boolean(estado.planVigente)`)
 * sale de aquí, nunca de una inferencia del modelo.
 */
export function planVigenteDelTurno(candidato: BasePlan | undefined): { base: BasePlan } | undefined {
  if (!candidato) return undefined;
  if (!verificarTokenAprobacion(candidato.approval_token, candidato.plan_hash)) return undefined;
  const contexto = abrirContextoPlan(candidato.approval_token);
  if (!contexto || contexto.backend !== "python") return undefined;
  return { base: candidato };
}

// Se permiten varias búsquedas por turno porque una referencia puede contener
// conceptos comerciales distintos; el límite evita dejar una conversación
// colgada indefinidamente.
export const VUELTAS_MAX = 10;

export type EstadoConversacion = {
  brief: Brief;
  solicitudOriginal: string;
  /** The assistant already told the customer the photo has no balloons and the
   * customer replied (`referenciaSinGlobosYaPreguntada`): do not ask again. */
  referenciaSinGlobosPreguntada: boolean;
  /** Photo colors `confirmar_plan_decoracion` already sent back this turn
   * (COLORES_REFERENCIA_OMITIDOS). The refusal is sent at most once per turn:
   * any later omission goes on with a notice, so a search that cannot find the
   * color never loops. */
  coloresReferenciaReclamados: Set<string>;
  /** Structures already asked to carry the photo's number balloons (once per turn, like the colors). */
  numerosReferenciaReclamados: Set<string>;
  /** Refusals of `confirmar_plan_decoracion` in this turn (convergencia-plan.ts). */
  rechazosPlan: number;
  /** When this turn started (ms since epoch): bounds how long it may keep calling the model. */
  inicioTurnoMs: number;
  /** Server adjustments of material colors, mixes and uncovered materials in this turn (cobertura-materiales.ts). */
  ajustesCobertura: AjusteCobertura[];
  restriccionesUsuario: ReturnType<typeof extraerRestriccionesUsuario>;
  /** Colors a later customer message withdrew ("cambia el plateado por blanco"):
   * they are no longer a search filter either. */
  coloresRetiradosCliente: string[];
  recomendaciones: Producto[];
  decoraciones: DecoracionConProductos[];
  categoriasSugeridas: Faceta[];
  // Filtros que produjeron `categoriasSugeridas` (ocasión, colores, texto…),
  // sin la categoría en sí. El cliente los reusa para navegar directo a un
  // tipo puntual sin pasarle otro turno al modelo (§ page.tsx navegarCategoria).
  filtrosCategorias?: FiltrosCatalogo;
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
  /**
   * Colores de la foto que NINGÚN candidato de las búsquedas del turno ofrece
   * (fase 2.9). Antes solo se registraba el caso en que la escalera llegaba a
   * relajar el color, que es un caso raro: lo normal es que la búsqueda devuelva
   * resultados de sobra y ninguno lleve el color de la foto, y eso no dejaba
   * rastro en ninguna parte.
   *
   * Es una señal, no un filtro. Convertir la paleta de la foto en filtro duro
   * vaciaría la búsqueda cada vez que el catálogo no vende ese tono, que es
   * justo por lo que `coloresFotoParaBusqueda` ya los excluye. Lo que faltaba no
   * era la restricción sino el registro.
   */
  ragColoresFotoSinCubrir?: string[];
  ragValidados?: ItemValidado[];
  ragRechazados?: ItemRechazado[];
  ragTotal?: number;
  /** Une búsqueda con selección en rag_query_log — un id por conversación, no por turno. */
  ragRequestId: string;
  planResuelto?: PlanResuelto;
  /** Blueprint de la(s) imagen(es) de referencia adjuntas a ESTE turno, ya
   * analizado por /api/references/analyze — plan de integración de
   * referencias visuales, R2/R4. Ausente si el cliente no adjuntó nada. */
  referenceBlueprint?: ReferenceBlueprintV2;
  /**
   * Propuesta ya vigente al empezar el turno, verificada (§7 "editar una
   * propuesta desde el chat"): presente solo cuando el navegador mandó un
   * plan y su token firmado pasó `planVigenteDelTurno`. Habilita
   * `ajustar_plan_decoracion` en `herramientasActivas` y es el ÚNICO origen
   * del `base` que esa herramienta edita — el modelo nunca aporta el plan
   * base, solo contenido semántico y variantes de `buscar_catalogo_rag`.
   */
  planVigente?: { base: BasePlan };
  /**
   * Qué herramienta comercial (confirmar_plan_decoracion o
   * ajustar_plan_decoracion) se llamó primero en este turno — a lo sumo una
   * de las dos por turno (§7 punto 3): nada impedía antes que el modelo
   * llamara ambas en la misma vuelta. Reintentar la MISMA herramienta sigue
   * permitido (confirmar_plan_decoracion ya se apoya en eso para corregir un
   * rechazo); lo que se bloquea es mezclar las dos.
   */
  herramientaComercialUsada?: "confirmar_plan_decoracion" | "ajustar_plan_decoracion";
};

const EVENT_MATCH_PRIORITY: Record<EventMatchLevel, number> = {
  adaptable: 0,
  thematic: 1,
  exact_event: 2,
};

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

export function crearEstadoConversacion(brief: Brief, solicitudOriginal = "", referenceBlueprint?: ReferenceBlueprintV2, opciones: {
  referenciaSinGlobosPreguntada?: boolean;
  /** The customer messages of the conversation, in order. With them the latest
   * messages win for colors and structures (restricciones-conversacion.ts). */
  mensajesCliente?: readonly string[];
  /** Plan+token the browser echoed for this turn (chat-v1 `planVigente`), not
   * yet verified — `crearEstadoConversacion` runs it through
   * `planVigenteDelTurno` before trusting it (§7). */
  planVigente?: BasePlan;
} = {}): EstadoConversacion {
  // The wrapper in ejecutar.ts calls this once per request/turn, so these
  // sets cannot carry a prior conversation's retrieval whitelist.
  const mensajes = opciones.mensajesCliente;
  return {
    brief: { ...brief },
    solicitudOriginal,
    referenciaSinGlobosPreguntada: opciones.referenciaSinGlobosPreguntada ?? false,
    coloresReferenciaReclamados: new Set(),
    numerosReferenciaReclamados: new Set(),
    rechazosPlan: 0,
    inicioTurnoMs: Date.now(),
    ajustesCobertura: [],
    restriccionesUsuario: mensajes?.length ? extraerRestriccionesConversacion(mensajes, brief) : extraerRestriccionesUsuario(solicitudOriginal, brief),
    coloresRetiradosCliente: mensajes?.length ? coloresVigentes(mensajes).retirados : [],
    recomendaciones: [],
    decoraciones: [],
    categoriasSugeridas: [],
    ragIdsRecuperados: new Set(),
    ragVariantIdsRecuperados: new Map(),
    ragEventEvidence: new Map(),
    ragEventRelaxations: [],
    ragRequestId: crypto.randomUUID(),
    referenceBlueprint,
    planVigente: planVigenteDelTurno(opciones.planVigente),
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

export type AjusteParticipacion =
  | { tipo: "participacion_reescalada"; estructura_id: string; suma_declarada: number }
  | { tipo: "rol_principal_reasignado"; estructura_id: string; product_id: string };

/** Índice de la participación mayor; los empates se quedan con el primero declarado. */
function indiceParticipacionMayor(cuotas: readonly number[]): number {
  return cuotas.reduce((mejor, cuota, indice) => (cuota > cuotas[mejor]! ? indice : mejor), 0);
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/**
 * Ruido de redondeo de las participaciones antes de que el esquema lo convierta
 * en un rechazo.
 *
 * `PlanDecoracionSchema` exige que las participaciones de una estructura sumen 1
 * (±0,001) y cada rechazo cuenta para `rechazosPlan`: dos rechazos apagan el
 * reclamo de los colores de la foto (convergencia-plan.ts), así que un 0,33 × 3
 * degrada la fidelidad de color del resto del turno. Con la suma declarada a
 * menos de 0,02 de 1 se reescala aquí (el residuo va a la participación mayor) y
 * el rol `principal` pasa al material de mayor participación cuando el declarado
 * tiene una menor — cobertura-materiales.ts decide la mezcla con ese material.
 * Cualquier otra desviación sigue siendo un rechazo del esquema.
 *
 * Pura y defensiva: los argumentos vienen del modelo, así que una estructura
 * que no cumpla exactamente la forma esperada se devuelve intacta para que zod
 * la rechace con su mensaje.
 */
export function normalizarParticipacionesPlan(args: Record<string, unknown>): { args: Record<string, unknown>; ajustes: AjusteParticipacion[] } {
  const estructuras = args.estructuras;
  if (!Array.isArray(estructuras)) return { args, ajustes: [] };
  const ajustes: AjusteParticipacion[] = [];
  const normalizadas = estructuras.map((estructura) => {
    if (!esObjeto(estructura)) return estructura;
    const materiales = estructura.materiales;
    if (!Array.isArray(materiales) || materiales.length === 0) return estructura;
    if (!materiales.every((material) => esObjeto(material) && typeof material.participacion === "number" && Number.isFinite(material.participacion) && material.participacion > 0)) return estructura;
    const declaradas = materiales.map((material) => (material as { participacion: number }).participacion);
    const suma = declaradas.reduce((total, cuota) => total + cuota, 0);
    if (Math.abs(suma - 1) > 0.02) return estructura;
    const estructuraId = typeof estructura.estructura_id === "string" ? estructura.estructura_id : "";
    let ajustados = materiales.map((material) => ({ ...(material as Record<string, unknown>) }));
    if (Math.abs(suma - 1) > 1e-9) {
      const mayor = indiceParticipacionMayor(declaradas);
      const reescaladas = declaradas.map((cuota) => cuota / suma);
      reescaladas[mayor] = reescaladas[mayor]! + (1 - reescaladas.reduce((total, cuota) => total + cuota, 0));
      ajustados = ajustados.map((material, indice) => ({ ...material, participacion: reescaladas[indice]! }));
      ajustes.push({ tipo: "participacion_reescalada", estructura_id: estructuraId, suma_declarada: suma });
    }
    const finales = ajustados.map((material) => material.participacion as number);
    const mayor = indiceParticipacionMayor(finales);
    const principalDeclarado = ajustados.findIndex((material) => material.rol_material === "principal");
    if (principalDeclarado >= 0 && finales[principalDeclarado]! < finales[mayor]!) {
      ajustados = ajustados.map((material, indice) => {
        if (indice === mayor) return { ...material, rol_material: "principal" };
        return material.rol_material === "principal" ? { ...material, rol_material: "secundario" } : material;
      });
      ajustes.push({ tipo: "rol_principal_reasignado", estructura_id: estructuraId, product_id: typeof ajustados[mayor]!.product_id === "string" ? String(ajustados[mayor]!.product_id) : "" });
    }
    return { ...estructura, materiales: ajustados };
  });
  return ajustes.length === 0 ? { args, ajustes } : { args: { ...args, estructuras: normalizadas }, ajustes };
}

/** Una línea por ajuste para `plan_audit_log.error`; sin argumentos del modelo. */
export function describirAjustesParticipacion(ajustes: readonly AjusteParticipacion[]): string {
  return ajustes
    .map((ajuste) => ajuste.tipo === "participacion_reescalada"
      ? `${ajuste.estructura_id || "estructura"}: participaciones reescaladas desde ${ajuste.suma_declarada}`
      : `${ajuste.estructura_id || "estructura"}: rol principal al material de mayor participación (${ajuste.product_id})`)
    .join(" | ");
}

// El material lleva el color REAL del producto elegido, nunca la palabra de la
// foto (colores_omitidos.color): esta acción existe porque un color de la foto
// puede cubrirse con una SUSTITUCIÓN (el catálogo no tiene "burdeos" exacto,
// pero sí "rojo") y el modelo declarando el color de la foto sobre ese
// material dispara el mismo perdón que _relabelled_color usa para una etiqueta
// mal escrita (plan.py) -- equivalent_colors lo cuenta como cubierto y
// _reference_color_substitutions nunca reporta la sustitución al cliente. Con
// el color real declarado, colores_referencia (que sigue diciendo "burdeos")
// diverge honestamente de la línea comprada y el aviso sí dispara.
export const ACCION_COLORES_REFERENCIA_OMITIDOS ="La foto de referencia muestra colores dominantes que estas estructuras no usan y el catálogo sí tiene (colores_omitidos). Cubre cada estructura con uno de esos productos: si tiene en_busqueda true, úsalo en materiales; si no, búscalo una sola vez con buscar_catalogo_rag usando una consulta de un solo color (por ejemplo \"globo latex redondo rosado\"): la búsqueda deja de exigir la ocasión cuando esta esconde los colores de la foto. En el material declara el color REAL de ese producto (el que trae el catálogo), nunca la palabra de la foto si el producto no la tiene tal cual: el sistema solo avisa la sustitución al cliente cuando el material dice la verdad. Luego vuelve a confirmar con lo que tengas; si la búsqueda no devolvió un color, confirma igual y el sistema se lo avisará al cliente. Este aviso llega una sola vez por mensaje. No anuncies ni generes una imagen.";
export const ACCION_NUMEROS_REFERENCIA_OMITIDOS = "La foto de referencia muestra globos de número que la propuesta no lleva (numeros_omitidos, uno por estructura con sus dígitos). Busca cada dígito por separado con buscar_catalogo_rag (por ejemplo \"globo metalizado numero 8 dorado\" y \"globo metalizado numero 0 dorado\"), agrégalos a materiales de esa estructura (un material por dígito, con su variant_id) y vuelve a confirmar. Si el catálogo no tiene un dígito en ese color, usa el color en que sí está (numeros_en_catalogo de la búsqueda) y díselo al cliente en una frase. Este aviso llega una sola vez por mensaje. No anuncies ni generes una imagen.";
export const MENSAJE_CLIENTE_NUMEROS_REFERENCIA = "Estoy agregando los globos de número que se ven en tu foto.";
export const ACCION_NUMERO_INCORRECTO = "Los globos de número deben formar exactamente el número que pidió el cliente, un globo por dígito. Busca cada dígito por separado con buscar_catalogo_rag (por ejemplo \"globo metalizado numero 4 plata\" y \"globo metalizado numero 0 plata\"), usa esos productos en la figura y vuelve a confirmar. Si el catálogo no tiene uno de los dígitos en el color pedido, quita la figura de número y ofrécele al cliente el color en que sí está ese dígito (numeros_en_catalogo de la búsqueda) en vez de decirle solo que no hay. No anuncies ni generes una imagen.";
export const ACCION_NUMEROS_EN_CATALOGO = "numeros_en_catalogo lista los globos de número que el catálogo disponible sí tiene para cada dígito que esta búsqueda no devolvió. No le digas al cliente solo que no hay ese número: ofrécele el color que sí existe para ese dígito (por ejemplo «el 4 lo tengo en latte, ¿te sirve?») y pregúntale si lo quiere; si disponibles está vacío, dile que ese dígito no está disponible y ofrece la decoración sin número. No uses ese globo en un plan hasta que el cliente lo acepte y lo busques.";
export const ACCION_TAMANO_CLIENTE_SIN_COBERTURA = "Los tamaños que faltan son los que pidió el cliente y los productos de ese color no los tienen en el catálogo disponible. No reintentes el mismo plan: busca una vez ese tamaño en otro color o producto si no lo hiciste; si tampoco sirve, responde ya al cliente con lo que sí hay (el color en otros tamaños o ese tamaño en otro color) y pregúntale cómo prefiere seguir. No anuncies ni generes este plan.";

/** Every uncovered size is a size the customer made mandatory: retrying the same plan cannot work. */
function faltanTamanosDelCliente(sinCobertura: ReadonlyArray<{ tamano: string }>, plan: PlanDecoracion): boolean {
  const delCliente = new Set(tamanosObligatorios(plan.restricciones).map((pulgadas) => `R-${pulgadas}`));
  return delCliente.size > 0 && sinCobertura.length > 0 && sinCobertura.every((item) => delCliente.has(item.tamano));
}

export const MENSAJE_CLIENTE_COLORES_REFERENCIA = "Estoy ajustando la propuesta para que lleve los colores de tu foto.";

/** Hard filters the relaxation ladder never loosens (relajacion-filtros.ts). */
function tieneFiltrosNoRelajables(filtros: FiltrosDurosBusqueda): boolean {
  return filtros.categorias.length > 0 || filtros.formas.length > 0 || filtros.acabados.length > 0 || filtros.diametros_pulgadas.length > 0 || filtros.precio_max != null;
}

/**
 * Photo colors the plan dropped while the catalog offers them (E2E 2026-09-14).
 * Availability comes from this turn's search first and, for colors it did not
 * return, from a read-only lookup inside the active catalog pool (the LoRA
 * dataset when present). A color the customer chose explicitly overrides the
 * photo. A lookup failure never blocks the plan: the resolver still records the
 * notice.
 *
 * No loop (E2E 2026-09-15, "Semiarcos rosa y plata" + "para un cumpleaños" ran
 * out of turns): only the dominant colors of the referenced element are claimed
 * (never the palette extras `aplicarColoresReferencia` adds for the notice), the
 * refusal is sent at most once per turn, and a catalog product found only by the
 * lookup counts when this turn's search can actually return it — i.e. the turn
 * has no hard filter the ladder never relaxes (category, shape, finish, size,
 * price). Otherwise the plan goes on and the customer gets the notice.
 */
async function coloresReferenciaOmitidosDelTurno(
  plan: PlanDecoracion,
  estado: EstadoConversacion,
  pool: Pool,
  catalogAllowlist: CatalogAllowlist | undefined,
) {
  if (!estado.referenceBlueprint || estado.restriccionesUsuario.colores.length > 0 || estado.coloresReferenciaReclamados.size > 0) return [];
  // After repeated refusals the photo colors are notices, never another refusal.
  if (estado.rechazosPlan >= RECHAZOS_PARA_CONVERGER) return [];
  const pendientes = plan.estructuras.map((estructura) => ({
    ...estructura,
    colores_referencia: coloresElementoReferencia(estado.referenceBlueprint, estructura.referencia_element_id),
  }));
  const faltantes = [...new Set(pendientes.flatMap((estructura) => {
    const usados = new Set(estructura.materiales.map((material) => material.color?.trim().toLowerCase()).filter(Boolean));
    // An unsold photo color is covered by the color it is bought as ("gris" as "plateado").
    return estructura.colores_referencia.filter((color) => !usados.has(color.trim().toLowerCase()) && !usados.has(colorDeCompraSinVenta(color) ?? ""));
  }))];
  if (faltantes.length === 0) return [];
  const disponibles = new Map<string, ProductoColorDisponible[]>(productosGloboPorColor(estado.ragCandidatos ?? [], faltantes));
  const sinBusqueda = faltantes.filter((color) => !disponibles.has(color));
  const busquedaLosPuedeDevolver = !tieneFiltrosNoRelajables(filtrosDurosDeBusqueda({ mensaje: "", solicitudOriginal: estado.solicitudOriginal, brief: estado.brief }));
  if (sinBusqueda.length > 0 && busquedaLosPuedeDevolver) {
    try {
      const catalogo = await buscarGlobosPorColor(pool, sinBusqueda, { variantIds: catalogAllowlist?.variantIds ?? null, catalogSnapshotId: estado.ragCatalogSnapshotId ?? null });
      for (const [color, productos] of catalogo) disponibles.set(color, productos);
    } catch (error) {
      console.warn("[plan] no se pudo consultar colores de la foto en el catálogo", { requestId: estado.ragRequestId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  // A color is claimed only when one of its products can build the structure
  // in a mix close to the one chosen: otherwise the claim contradicts
  // SIN_COBERTURA (E2E 2026-09-15, clear balloon without R-5).
  const disponibilidad = disponibilidadDelTurno(estado.ragCandidatos ?? []);
  const geometricas = new Set<string>(TIPOS_ESTRUCTURA_GEOMETRICOS);
  return coloresReferenciaOmitidos(pendientes, disponibles, (estructura, producto) => {
    if (!geometricas.has(estructura.tipo) || !producto.diametros) return true;
    const admisibles = mezclasAdmisiblesEstructura(estructura, disponibilidad);
    if (admisibles.length === 0) return true;
    const mezclasProducto = mezclasCompatiblesConDiametros(producto.diametros);
    return admisibles.some((mezcla) => mezclasProducto.includes(mezcla));
  });
}

/** Tope de `pistas_patron` en `plan-resolution.v1`. */
const MAX_PISTAS_PATRON = 16;

/**
 * Pistas de patrón de color de la foto para las estructuras que materializan un
 * elemento de la referencia (ADR-0028 §7). Misma fuente que los colores de la
 * foto (`coloresElementoReferencia`): el elemento aprobado del blueprint del
 * turno con ese `referencia_element_id`. Una pista por elemento aunque varias
 * estructuras lo materialicen: Python la aplica a cada una.
 */
export function pistasPatronDelPlan(plan: Pick<PlanDecoracion, "estructuras">, blueprint: ReferenceBlueprintV2 | undefined): PistaPatron[] {
  if (!blueprint) return [];
  const elementos = new Map(blueprint.elements.filter((elemento) => elemento.approved).map((elemento) => [elemento.element_id, elemento]));
  const pistas = new Map<string, PistaPatron>();
  for (const estructura of plan.estructuras) {
    const elementId = estructura.referencia_element_id;
    const patron = elementId ? elementos.get(elementId)?.appearance.patron_color : undefined;
    if (!elementId || !patron || pistas.has(elementId)) continue;
    pistas.set(elementId, { referencia_element_id: elementId, ...patron });
  }
  return [...pistas.values()].slice(0, MAX_PISTAS_PATRON);
}

/**
 * Lecturas del armado de la foto para los bouquets que materializan un elemento
 * de la referencia (ADR-0030). Misma fuente y misma regla que
 * `pistasPatronDelPlan`: el elemento aprobado del blueprint del turno con ese
 * `referencia_element_id`, una lectura por elemento.
 */
export function pistasArmadoDelPlan(plan: Pick<PlanDecoracion, "estructuras">, blueprint: ReferenceBlueprintV2 | undefined): PistaArmado[] {
  if (!blueprint) return [];
  const elementos = new Map(blueprint.elements.filter((elemento) => elemento.approved).map((elemento) => [elemento.element_id, elemento]));
  const pistas = new Map<string, PistaArmado>();
  for (const estructura of plan.estructuras) {
    const elementId = estructura.referencia_element_id;
    const lectura = elementId ? elementos.get(elementId)?.appearance.armado_bouquet : undefined;
    if (!elementId || !lectura || pistas.has(elementId)) continue;
    pistas.set(elementId, { referencia_element_id: elementId, ...lectura });
  }
  return [...pistas.values()].slice(0, MAX_PISTAS_PATRON);
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
  /** Request facts for plan_audit_log columns (Plan A §A0.1); observability only. */
  hechosPeticion?: Omit<HechosPeticionPlan, "rechazosTurno" | "claseRechazo">;
} = {}): RegistroHerramientas {
  const ragPool = options.pool ?? getRagPool();
  // Every plan audit row of this turn carries the request facts and the
  // refusals counted so far; clase_rechazo waits for the A4.1 classes.
  const auditarPlan = (datos: Omit<Parameters<typeof registrarPlanAudit>[1], "hechos">) =>
    registrarPlanAudit(ragPool, { ...datos, hechos: { ...options.hechosPeticion, rechazosTurno: estado.rechazosPlan } });
  const catalogoBloqueado = options.catalogoLoraNoDisponible;

  /**
   * Invariante §7 punto 3: a lo sumo una herramienta comercial (confirmar_plan_decoracion
   * o ajustar_plan_decoracion) por turno — nada impedía antes que el modelo
   * llamara las dos en la misma vuelta (`HERRAMIENTAS_SOLO_LECTURA` solo
   * protege las de lectura). Marca la primera que se llama y bloquea la OTRA
   * mientras dure el turno; reintentar la MISMA sigue permitido porque
   * confirmar_plan_decoracion ya depende de eso para corregir un rechazo
   * (ver el E2E de colores de referencia: dos confirmaciones válidas en un
   * mismo turno). No se activa por un intento que ni siquiera llegó a
   * ejecutarse (p. ej. bloqueado por rechazosPlan): solo por una llamada real.
   */
  const bloqueoHerramientaComercial = (nombre: "confirmar_plan_decoracion" | "ajustar_plan_decoracion"): Record<string, unknown> | null => {
    if (estado.herramientaComercialUsada && estado.herramientaComercialUsada !== nombre) {
      return {
        ok: false,
        status: "HERRAMIENTA_COMERCIAL_YA_USADA",
        accion_requerida: `Ya usaste ${estado.herramientaComercialUsada} en este turno. No llames ${nombre} en el mismo turno: son excluyentes. Si el resultado anterior no sirve, respóndele al cliente con lo que ya tienes en vez de intentar la otra herramienta.`,
        mensaje_cliente: MENSAJE_CLIENTE_PLAN_EN_AJUSTE,
      };
    }
    estado.herramientaComercialUsada = nombre;
    return null;
  };

  const confirmarPlan = async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (catalogoBloqueado) return respuestaCatalogoLoraNoDisponible(catalogoBloqueado);
    // C4: occasion is the customer's open label, not a closed taxonomy
    // value invented by the model. Keep model wording only when no label
    // was recoverable from the original request.
    const eventLabel = parseEventSearchIntent(estado.solicitudOriginal).event_label;
    const eventIntent = parseEventIntent(estado.solicitudOriginal);
    // Ruido de redondeo de las participaciones y un `principal` que no es el
    // material de mayor participación se corrigen antes del esquema, para no
    // gastar un rechazo (normalizarParticipacionesPlan).
    const normalizado = normalizarParticipacionesPlan(args);
    if (normalizado.ajustes.length > 0) {
      encolarEscrituraObservabilidad(auditarPlan({
        requestId: estado.ragRequestId,
        status: "PLAN_PARTICIPACION_NORMALIZADA",
        error: describirAjustesParticipacion(normalizado.ajustes),
      }));
    }
    const parseado = PlanDecoracionSchema.safeParse({
      ...normalizado.args,
      ...(eventLabel
        ? { concepto: { ...((args as { concepto?: Record<string, unknown> }).concepto ?? {}), ocasion: eventLabel } }
        : {}),
      plan_version: "1.0",
      plan_id: crypto.randomUUID(),
      supuestos: [],
      restricciones: estado.restriccionesUsuario,
    });
    if (!parseado.success) {
      const erroresEsquema = parseado.error.issues.map((issue) => `${issue.path.join(".") || "plan"}: ${issue.message}`);
      // Plan A §A0.1: schema refusals were only visible as "aclaracion" in rag_query_log.
      // Only paths and validator messages are stored, never the model's arguments.
      encolarEscrituraObservabilidad(auditarPlan({
        requestId: estado.ragRequestId,
        restricciones: estado.restriccionesUsuario,
        candidateProductIds: [...estado.ragIdsRecuperados],
        status: "PLAN_ESQUEMA_INVALIDO",
        error: erroresEsquema.join(" | "),
      }));
      encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion"));
      return { ok: false, errores: erroresEsquema, mensaje_cliente: MENSAJE_CLIENTE_PLAN_EN_AJUSTE };
    }
    const perfil = perfilCreatividad(options.creatividad);
    // Photo without balloons and no named pieces: ask before designing
    // anything (user decision, audit Media #4).
    const erroresReferenciaSinGlobos = validarReferenciaSinGlobos(estado.referenceBlueprint, estado.solicitudOriginal, perfil.estructurasExtraConReferencia, estado.referenciaSinGlobosPreguntada);
    if (erroresReferenciaSinGlobos.length > 0) {
      estado.planResuelto = undefined;
      estado.seleccionFinalIA = [];
      encolarEscrituraObservabilidad(auditarPlan({
        requestId: estado.ragRequestId,
        solicitudOriginal: estado.solicitudOriginal,
        restricciones: estado.restriccionesUsuario,
        candidateProductIds: [...estado.ragIdsRecuperados],
        status: "REFERENCIA_SIN_GLOBOS",
        error: erroresReferenciaSinGlobos.join(" | "),
      }));
      encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion"));
      return {
        ok: false,
        status: "REFERENCIA_SIN_GLOBOS",
        errores: erroresReferenciaSinGlobos,
        accion_requerida: "No armes ni confirmes una propuesta todavía. Dile al cliente que su foto no tiene decoración con globos y pregúntale qué piezas quiere (por ejemplo un arco, columnas o centros de mesa), o sugiérele elegir una foto de ejemplo. No inventes piezas, no anuncies ni generes una imagen.",
        mensaje_cliente: MENSAJE_CLIENTE_REFERENCIA_SIN_GLOBOS,
      };
    }
    // Colores del material al vocabulario del catálogo antes de validar y
    // resolver: "azul rey" → "azul", "rosa" → "rosado" (A6).
    // The server, not the model, records the dominant colors of the photo
    // element each structure materializes; the resolver reports the ones the
    // plan does not buy (audit Alta #3, colores-referencia.ts).
    // Space measures are the customer's or an estimate, never the model's
    // reading of a photo (E2E 2026-09-14, medidas-defecto.ts).
    // `porque` is shown to the customer: internal wording is removed before signing.
    // Character and brand names never title a proposal (marcas-registradas.ts).
    // Materials follow the sizes and colors this turn's search really has: a
    // one-color product keeps its color and a structure gets a close mix every
    // material can build (cobertura-materiales.ts, E2E 2026-09-15).
    const cobertura = ajustarCoberturaPlan(canonizarColoresPlan(parseado.data).plan, disponibilidadDelTurno(estado.ragCandidatos ?? []));
    estado.ajustesCobertura = cobertura.ajustes;
    let planCanonico = sanearMarcasPlan(sanearPorquesPlan(aplicarFuenteMedidasEspacio(
      aplicarColoresReferencia(cobertura.plan, estado.referenceBlueprint),
      clienteDioMedidasEspacio(estado.solicitudOriginal, estado.brief.espacio),
    )));
    const erroresDeIntencion = validarRestriccionesPlan(
      planCanonico,
      estado.restriccionesUsuario,
      // A color the server itself replaced (rule 1) still covers what the
      // customer asked for: the balloon bought is the one that color matched.
      cobertura.ajustes.flatMap((ajuste) => (ajuste.tipo === "color_material" ? [{ antes: ajuste.antes, despues: ajuste.despues }] : [])),
    );
    // Default level: historical rule (open events). Any other level the
    // customer chose: its structure range for every event type.
    const erroresDeCardinalidad = perfil.nivel === CREATIVIDAD_POR_DEFECTO
      ? validarCardinalidadEventoAbierto(
          planCanonico,
          eventIntent.event_type,
          estado.solicitudOriginal,
          estado.ragIdsRecuperados.size > 0,
          estado.referenceBlueprint,
          perfil.rangoEstructuras,
        )
      : validarRangoCreatividad(planCanonico, {
          nivel: perfil.nivel,
          solicitudOriginal: estado.solicitudOriginal,
          hayCandidatosCatalogo: estado.ragIdsRecuperados.size > 0,
          referenceBlueprint: estado.referenceBlueprint,
        });
    const erroresDeReferencia = validarEstructurasFueraDeReferencia(planCanonico, estado.referenceBlueprint, estado.solicitudOriginal, perfil.estructurasExtraConReferencia);
    const erroresDeContrato = [...erroresDeIntencion, ...erroresDeCardinalidad, ...erroresDeReferencia];
    if (erroresDeContrato.length > 0) {
      estado.planResuelto = undefined;
      estado.seleccionFinalIA = [];
      encolarEscrituraObservabilidad(auditarPlan({
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
          : "Corrige el número de estructuras (respeta el rango de CREATIVIDAD DEL DISEÑO si está presente) o los colores del plan antes de confirmar; no anuncies ni generes una imagen.",
        mensaje_cliente: mensajeClienteRestricciones(erroresDeContrato),
      };
    }
    // Number figures spell the customer's number (numeros-pedidos.ts, E2E 2026-09-15 D4).
    const erroresDeNumero = validarNumerosPedidos(planCanonico, new Map((estado.ragCandidatos ?? []).map((candidato) => [candidato.productId, candidato])), numerosPedidos(estado.solicitudOriginal));
    if (erroresDeNumero.length > 0) {
      estado.planResuelto = undefined;
      estado.seleccionFinalIA = [];
      encolarEscrituraObservabilidad(auditarPlan({
        requestId: estado.ragRequestId,
        solicitudOriginal: estado.solicitudOriginal,
        restricciones: estado.restriccionesUsuario,
        candidateProductIds: [...estado.ragIdsRecuperados],
        status: "NUMERO_INCORRECTO",
        error: erroresDeNumero.join(" | "),
      }));
      encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion"));
      return {
        ok: false,
        status: "NUMERO_INCORRECTO",
        errores: erroresDeNumero,
        accion_requerida: ACCION_NUMERO_INCORRECTO,
        mensaje_cliente: mensajeClienteRestricciones(erroresDeNumero),
      };
    }
    // The photo's foil numbers must be in the plan (ADR-0030, 2026-09-25):
    // without them Python cannot follow the photo's count and colors. Asked
    // once per structure and never after the convergence threshold.
    const numerosFoto = numerosDeLaFoto(planCanonico, estado.referenceBlueprint);
    for (const id of estado.numerosReferenciaReclamados) numerosFoto.delete(id);
    const erroresDeNumerosFoto = estado.rechazosPlan >= RECHAZOS_PARA_CONVERGER
      ? []
      : validarNumerosDeLaFoto(planCanonico, new Map((estado.ragCandidatos ?? []).map((candidato) => [candidato.productId, candidato])), numerosFoto);
    if (erroresDeNumerosFoto.length > 0) {
      for (const id of numerosFoto.keys()) estado.numerosReferenciaReclamados.add(id);
      estado.planResuelto = undefined;
      estado.seleccionFinalIA = [];
      encolarEscrituraObservabilidad(auditarPlan({
        requestId: estado.ragRequestId,
        solicitudOriginal: estado.solicitudOriginal,
        restricciones: estado.restriccionesUsuario,
        candidateProductIds: [...estado.ragIdsRecuperados],
        status: "NUMEROS_REFERENCIA_OMITIDOS",
        error: erroresDeNumerosFoto.join(" | "),
      }));
      encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion"));
      return {
        ok: false,
        status: "NUMEROS_REFERENCIA_OMITIDOS",
        numeros_omitidos: [...numerosFoto.entries()].map(([estructura_id, digitos]) => ({ estructura_id, digitos })),
        errores: erroresDeNumerosFoto,
        accion_requerida: ACCION_NUMEROS_REFERENCIA_OMITIDOS,
        mensaje_cliente: MENSAJE_CLIENTE_NUMEROS_REFERENCIA,
      };
    }
    const categoriaPorProducto = new Map((estado.ragCandidatos ?? []).map((candidato) => [candidato.productId, candidato.categoria]));
    const erroresDeGlobos = validarPresenciaGlobos(planCanonico, categoriaPorProducto, estado.solicitudOriginal);
    if (erroresDeGlobos.length > 0) {
      estado.planResuelto = undefined;
      estado.seleccionFinalIA = [];
      encolarEscrituraObservabilidad(auditarPlan({
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
      encolarEscrituraObservabilidad(auditarPlan({
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
    const erroresDeUnidades = validarUnidadesDeclaradas(planCanonico, categoriaPorProducto);
    if (erroresDeUnidades.length > 0) {
      estado.planResuelto = undefined;
      estado.seleccionFinalIA = [];
      encolarEscrituraObservabilidad(auditarPlan({
        requestId: estado.ragRequestId,
        solicitudOriginal: estado.solicitudOriginal,
        restricciones: estado.restriccionesUsuario,
        candidateProductIds: [...estado.ragIdsRecuperados],
        status: "UNIDADES_INSUFICIENTES",
        error: erroresDeUnidades.join(" | "),
      }));
      encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion"));
      return {
        ok: false,
        status: "UNIDADES_INSUFICIENTES",
        errores: erroresDeUnidades,
        accion_requerida: "Corrige unidades_declaradas: es el total de globos (o de piezas si el material es un kit empaquetado o un accesorio) de la pieza completa sumando sus repeticiones, nunca el número de figuras o bouquets. Declara al menos una unidad por material y el mínimo de globos por pieza indicado, y vuelve a confirmar; no anuncies ni generes imagen.",
        mensaje_cliente: mensajeClienteRestricciones(erroresDeUnidades),
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
      encolarEscrituraObservabilidad(auditarPlan({
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
    const coloresOmitidos = await coloresReferenciaOmitidosDelTurno(planCanonico, estado, ragPool, options.catalogAllowlist);
    if (coloresOmitidos.length > 0) {
      for (const item of coloresOmitidos) estado.coloresReferenciaReclamados.add(`${item.estructura_id}|${item.color}`);
      estado.planResuelto = undefined;
      estado.seleccionFinalIA = [];
      encolarEscrituraObservabilidad(auditarPlan({
        requestId: estado.ragRequestId,
        solicitudOriginal: estado.solicitudOriginal,
        restricciones: estado.restriccionesUsuario,
        candidateProductIds: [...estado.ragIdsRecuperados],
        status: "COLORES_REFERENCIA_OMITIDOS",
        error: coloresOmitidos.map((item) => `${item.estructura_id}:${item.color}`).join(" | "),
      }));
      encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion"));
      return {
        ok: false,
        status: "COLORES_REFERENCIA_OMITIDOS",
        colores_omitidos: coloresOmitidos,
        accion_requerida: ACCION_COLORES_REFERENCIA_OMITIDOS,
        mensaje_cliente: MENSAJE_CLIENTE_COLORES_REFERENCIA,
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
      encolarEscrituraObservabilidad(auditarPlan({
        requestId: estado.ragRequestId,
        solicitudOriginal: estado.solicitudOriginal,
        geometry: shadow,
        status: "SCENE_V2_SHADOW",
        error: shadow.error,
        flagSnapshot: { scenePlanV2Shadow: true },
      }));
    }
    const planningStart = Date.now();
    // Same-turn allowlist: only the variants the model actually saw in this
    // turn. It travels signed with the plan so /api/generate and
    // /api/plan-editar can restate it without trusting the browser.
    const allowlistTurno = allowlistDesdeMapa(estado.ragVariantIdsRecuperados);
    const snapshotTurno = estado.ragCatalogSnapshotId ?? null;
    const correlacionPython = z.string().uuid().safeParse(options.correlationId);
    const auditarFalloBackend = (motivo: string, detalle: string) => {
      estado.planResuelto = undefined;
      estado.seleccionFinalIA = [];
      encolarEscrituraObservabilidad(auditarPlan({
        requestId: estado.ragRequestId,
        solicitudOriginal: estado.solicitudOriginal,
        restricciones: estado.restriccionesUsuario,
        candidateProductIds: [...estado.ragIdsRecuperados],
        status: "BACKEND_NO_DISPONIBLE",
        error: `${motivo}: ${detalle}`,
      }));
      encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion", Date.now() - planningStart));
    };
    /** Fallo que el modelo SÍ puede corregir en el turno: vuelve como resultado. */
    const fallarPorBackend = (motivo: string, detalle: string, accionRequerida: string, mensajeCliente: string) => {
      auditarFalloBackend(motivo, detalle);
      return { ok: false, status: "BACKEND_NO_DISPONIBLE", accion_requerida: accionRequerida, mensaje_cliente: mensajeCliente };
    };
    /**
     * Fallo de infraestructura que el modelo NO puede corregir. Corta el turno en
     * vez de devolverle un texto que parafrasear: el cliente recibe el error
     * literal de `ui-error.v1`, con su acción de salida.
     */
    const abortarPorFalloTecnico = (motivo: string, detalle: string): never => {
      auditarFalloBackend(motivo, detalle);
      throw new FalloTecnicoTurnoError(motivo, detalle);
    };
    // Python es la única autoridad comercial (ADR-0023 paso 5) y necesita el
    // snapshot publicado de este turno. No hay reserva: responder con un plan
    // que nadie verificó escondería un corte roto.
    if (!snapshotTurno) {
      return fallarPorBackend(
        "SIN_SNAPSHOT_CATALOGO",
        "el turno no tiene un snapshot de catálogo publicado",
        "Busca primero en el catálogo con buscar_catalogo_rag: sin una búsqueda de este turno no hay catálogo verificado contra el que validar precios, stock ni variantes. No confirmes el plan ni generes una imagen hasta tenerla.",
        MENSAJE_CLIENTE_SIN_BUSQUEDA,
      );
    }
    // Confirmar es el único momento en que Python completa los patrones de color
    // (ADR-0028 §7): desde la pista de la foto o el preset de cada estructura. El
    // reintento de convergencia pasa por aquí también, con las mismas opciones.
    // Detrás de PATRONES_COLOR_V1 (default OFF): con la bandera apagada la
    // petición es la de siempre y el plan sale sin patrón.
    const completarPatrones = featureEnabled("PATRONES_COLOR_V1");
    // ADR-0030: lo mismo para el armado de los bouquets, detrás de BOUQUETS_ARMADO_V1.
    const completarArmados = featureEnabled("BOUQUETS_ARMADO_V1");
    const resolverPlanDelTurno = (plan: PlanDecoracion) => {
      const pistasPatron = completarPatrones ? pistasPatronDelPlan(plan, estado.referenceBlueprint) : [];
      const pistasArmado = completarArmados ? pistasArmadoDelPlan(plan, estado.referenceBlueprint) : [];
      return resolverPlan({
        plan,
        allowlist: allowlistTurno,
        catalogSnapshotId: snapshotTurno,
        loraAllowlist: options.catalogAllowlist,
        ...(completarPatrones ? { completarPatrones } : {}),
        ...(pistasPatron.length > 0 ? { pistasPatron } : {}),
        ...(completarArmados ? { completarArmados } : {}),
        ...(pistasArmado.length > 0 ? { pistasArmado } : {}),
        requestId: estado.ragRequestId,
        correlationId: correlacionPython.success ? correlacionPython.data : estado.ragRequestId,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    };
    let resolucion: ResolucionPlan;
    const avisosConvergencia: string[] = [];
    try {
      resolucion = await resolverPlanDelTurno(planCanonico);
      // Convergence: after repeated refusals the materials without size
      // coverage leave the structure (with a notice) instead of another
      // SIN_COBERTURA refusal (convergencia-plan.ts).
      if (estado.rechazosPlan >= RECHAZOS_PARA_CONVERGER && resolucion.resuelto.sin_cobertura.length > 0) {
        const reparado = quitarMaterialesSinCobertura(planCanonico, resolucion.resuelto.sin_cobertura);
        if (reparado.cambiado) {
          const reintento = await resolverPlanDelTurno(reparado.plan);
          if (reintento.resuelto.sin_cobertura.length === 0 && reintento.resuelto.compras.length > 0) {
            planCanonico = reparado.plan;
            resolucion = reintento;
            avisosConvergencia.push(...reparado.avisos);
          }
        }
      }
    } catch (error) {
      if (error instanceof AllowlistProductoVarianteError) {
        // Model-correctable: the plan paired a variant with a product that
        // does not own it. Not a technical failure, so the model can retry.
        estado.planResuelto = undefined;
        estado.seleccionFinalIA = [];
        encolarEscrituraObservabilidad(auditarPlan({
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
      if (isPythonAdapterError(error)) abortarPorFalloTecnico(error.code, error.domainCode ?? error.message);
      if (error instanceof PythonPlanMappingError) abortarPorFalloTecnico(error.code, error.message);
      throw error;
    }
    const resuelto = resolucion.resuelto;
    const materialEstimate = resolucion.materialEstimate;
    const estimateValidation = validateMaterialEstimate(materialEstimate);
    // Un solo dueño de la puerta física sobre el plan resuelto de cualquiera de
    // los dos backends (estimacion.ts), por estructura lineal y con su densidad.
    const physicalWarnings = advertenciasPuertaFisica(resuelto.advertencias);
    const auditarResuelto = (status: string, error?: string) => encolarEscrituraObservabilidad(auditarPlan({
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
        accion_requerida: faltanTamanosDelCliente(resuelto.sin_cobertura, planCanonico)
          ? ACCION_TAMANO_CLIENTE_SIN_COBERTURA
          : "Revisa cobertura_por_producto: en cada estructura usa una mezcla de mezclas_compatibles para ese producto, o elige con buscar_catalogo_rag otro producto del mismo color que tenga los tamaños faltantes. Si mezclas_compatibles está vacío, ese producto no sirve para una estructura de globos: cámbialo. No anuncies ni generes este plan.",
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
      backend: "python",
      catalogSnapshotId: snapshotTurno,
      allowlist: allowlistTurno,
      // The image of this plan is generated with the level it was designed with.
      creatividad: perfilCreatividad(options.creatividad).nivel,
    });
    estado.planResuelto = resuelto;
    estado.cotizacion = conFotosDeCatalogo(resolucion.cotizacion, resuelto.compras);
    // La cotización se muestra, pero generar queda bloqueado hasta la
    // aprobación explícita del cliente en la tarjeta del plan.
    estado.seleccionFinalIA = [];
    const estadoAuditoria = resuelto.comercial.estado === "APROBACION_REQUERIDA" ? "APROBACION_REQUERIDA" : "VERIFICADO";
    // Photo colors the plan does not include: the model must tell the customer.
    // Materials the server removed for lack of sizes are notices too, and so
    // are the finishes and colors the server rewrote before resolving: sin eso
    // el resumen prometía un acabado o un color que la cotización no lleva.
    const sustitucionesDeColor = resuelto.sustituciones.filter(esSustitucionDeColor);
    // Un material que la cobertura o la convergencia sacaron del plan no lleva
    // aviso de acabado ni de color: la cotización no lo compra y el aviso de
    // material quitado ya lo cuenta. `planCanonico` es el plan que se resolvió.
    const materialesEnPlan = new Set(planCanonico.estructuras.flatMap((estructura) => estructura.materiales.map((material) => `${estructura.estructura_id}|${material.product_id}`)));
    const avisosCliente = [...new Set([
      ...estado.ajustesCobertura.flatMap((ajuste) => (ajuste.tipo === "material_quitado" ? [ajuste.aviso_cliente] : [])),
      ...avisosClienteAjustes(estado.ajustesCobertura, {
        nombres: new Map(planCanonico.estructuras.map((estructura) => [estructura.estructura_id, estructura.nombre])),
        coloresReportados: sustitucionesDeColor.map((item) => ({ estructura_id: item.estructura_id, color: item.pedido })),
        coloresDelCliente: estado.restriccionesUsuario.colores.map((color) => color.valor),
        materialesFuera: estado.ajustesCobertura.flatMap((ajuste) => (
          ajuste.tipo !== "mezcla" && !materialesEnPlan.has(`${ajuste.estructura_id}|${ajuste.product_id}`)
            ? [{ estructura_id: ajuste.estructura_id, product_id: ajuste.product_id }]
            : []
        )),
      }),
      ...avisosConvergencia,
      ...sustitucionesDeColor.map((item) => item.motivo),
    ])];
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
      avisos_cliente: avisosCliente,
      ...(avisosCliente.length
        ? { accion_requerida: "avisos_cliente trae colores de la foto o globos que la propuesta no incluye, y los ajustes de color o acabado que el sistema le hizo al plan que confirmaste: la tarjeta de la propuesta se los muestra al cliente uno por uno, así que no los enumeres: menciónalos en una sola frase de tu resumen, con tus palabras (no afirmes que el catálogo no tiene un color), y ofrece buscar esos colores si quiere acercarse más a la foto." }
        : {}),
      sin_cobertura: resuelto.sin_cobertura,
      advertencias: resuelto.advertencias,
      comercial: resuelto.comercial,
      alternativas: resuelto.alternativas,
      fase: "desglose_previo; la imagen se genera despues de mostrarlo",
      cotizacion: estado.cotizacion,
    };
  };

  return {
    guardar_brief: async (args) => {
      // Model output: invented keys are mapped or dropped, never stored
      // (brief-herramienta.ts). The terminal event validates the brief strictly.
      const { brief, descartadas } = normalizarArgsBrief(args);
      Object.assign(estado.brief, brief);
      return { ok: true, brief: estado.brief, ...(descartadas.length ? { campos_ignorados: descartadas } : {}) };
    },

    buscar_catalogo_rag: async (args) => {
      if (catalogoBloqueado) return respuestaCatalogoLoraNoDisponible(catalogoBloqueado);
      // Component text drives lexical/semantic retrieval. Customer constraints
      // stay locked from original request + brief, so model enrichment cannot
      // turn a style term such as "glamour" into a hard catalog filter.
      const mensaje = typeof args.mensaje === "string" ? args.mensaje : "";
      const solicitudParaFiltros = estado.solicitudOriginal.trim() || mensaje;
      // Sizes come from this search's own message, never from the original
      // request (filtros-turno.ts, E2E 2026-09-15 rid bc991913).
      const filtrosDuros = filtrosDurosDeBusqueda({ mensaje, solicitudOriginal: estado.solicitudOriginal, brief: estado.brief, coloresRetirados: estado.coloresRetiradosCliente });
      const avisoFiltros = avisoFiltrosBusqueda(filtrosDuros);
      const eventIntent = parseEventSearchIntent(solicitudParaFiltros);
      // Photo colors are not filters, but the occasion must not hide them
      // (relajacion-filtros.ts). The customer's own colors replace the photo's.
      const coloresContexto = estado.restriccionesUsuario.colores.length > 0 ? [] : coloresFotoParaBusqueda(estado.referenceBlueprint);
      const pool = ragPool;
      const t0 = Date.now();

      const respuesta = await buscarCatalogoRag(pool, mensaje, {
        filtrosDuros,
        eventIntent,
        focusedQueries: [mensaje],
        allowlist: options.catalogAllowlist,
        catalogSnapshotId: estado.ragCatalogSnapshotId,
        coloresContexto,
        rerankRequestId: estado.ragRequestId,
        rerankCorrelationId: options.correlationId ?? estado.ragRequestId,
        rerankSignal: options.signal,
      });
      // Every variant seen this turn stays known, also when a later search is narrower.
      estado.ragCandidatos = unirCandidatosTurno(estado.ragCandidatos ?? [], respuesta.candidatos);
      if (respuesta.catalogSnapshotId) estado.ragCatalogSnapshotId = respuesta.catalogSnapshotId;
      for (const candidate of respuesta.candidatos) {
        if (candidate.eventEvidence) {
          estado.ragEventEvidence?.set(candidate.productId, mergeEventEvidence(estado.ragEventEvidence.get(candidate.productId), candidate.eventEvidence));
        }
      }
      estado.ragEventRelaxations = [...new Set([...(estado.ragEventRelaxations ?? []), ...respuesta.observabilidad.relaxations])];
      // Incondicional a propósito (fase 2.9): un color de la foto que la
      // búsqueda no puede ofrecer es la misma pérdida haya habido relajación o
      // no, y hasta ahora solo se veía en el caso raro.
      if (coloresContexto.length > 0) {
        const sinCubrir = coloresSinCubrir(coloresContexto, respuesta.candidatos);
        if (sinCubrir.length > 0) estado.ragColoresFotoSinCubrir = [...new Set([...(estado.ragColoresFotoSinCubrir ?? []), ...sinCubrir])];
      }
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

      // A number digit the search did not return: say which colors of that
      // digit the active catalog does have, so the model offers them instead
      // of only saying there is none (numeros-por-digito.ts).
      const digitosSinFigura = digitosBuscados(mensaje).filter((digito) => !respuesta.candidatos.some((candidato) => digitoDeFiguraNumero(candidato) === digito));
      let numerosEnCatalogo: Array<{ digito: string; disponibles: string[] }> = [];
      if (digitosSinFigura.length > 0) {
        try {
          const porDigito = await buscarNumerosPorDigito(pool, digitosSinFigura, { variantIds: options.catalogAllowlist?.variantIds ?? null, catalogSnapshotId: estado.ragCatalogSnapshotId ?? null });
          numerosEnCatalogo = digitosSinFigura.map((digito) => ({ digito, disponibles: porDigito.get(digito) ?? [] }));
        } catch (error) {
          console.warn("[rag] no se pudo consultar globos de número por dígito", { requestId: estado.ragRequestId, error: error instanceof Error ? error.message : String(error) });
        }
      }

      return {
        status: respuesta.status,
        sku_status: respuesta.skuStatus,
        filtro_relajado: respuesta.filtroRelajado,
        ...(numerosEnCatalogo.length ? { numeros_en_catalogo: numerosEnCatalogo, accion_numeros: ACCION_NUMEROS_EN_CATALOGO } : {}),
        ...(avisoFiltros ? { limite_busqueda: avisoFiltros } : {}),
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

      // Cada ítem trae su variante explícita: las cantidades y los tamaños de
      // una estructura los calcula confirmar_plan_decoracion (ADR-0023).
      const seleccion: SeleccionSolicitada[] = (seleccionCruda as Record<string, unknown>[]).map((cruda) => ({
        productId: String(cruda.product_id ?? ""),
        variantId: String(cruda.variant_id ?? ""),
        cantidad: Number(cruda.cantidad ?? 0),
        razon: typeof cruda.razon === "string" ? cruda.razon : undefined,
      }));

      const t0 = Date.now();
      const resultado = await validarSeleccion(
        pool,
        seleccion,
        estado.ragVariantIdsRecuperados,
        estado.ragCatalogSnapshotId,
        { signal: options.signal, correlationId: options.correlationId ?? estado.ragRequestId },
      );
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
        fase: "propuesta_visual; la cotizacion llega despues de generar la imagen",
      };
    },

    confirmar_plan_decoracion: async (args) => {
      const bloqueo = bloqueoHerramientaComercial("confirmar_plan_decoracion");
      if (bloqueo) return bloqueo;
      // "Diseñar otra cosa" con una propuesta ya vigente: no se bloquea (el
      // cliente puede de verdad querer empezar de cero), pero se audita aparte
      // para medir cuántas veces pasa antes de decidir si conviene bloquearlo
      // (§7 punto 3).
      if (estado.planVigente) {
        encolarEscrituraObservabilidad(auditarPlan({ requestId: estado.ragRequestId, status: "PLAN_REEMPLAZADO_SOBRE_APROBADO", candidateProductIds: [...estado.ragIdsRecuperados] }));
      }
      // Bounded retries: after RECHAZOS_MAXIMOS refusals the model must answer
      // the customer instead of confirming again (convergencia-plan.ts).
      if (estado.rechazosPlan >= RECHAZOS_MAXIMOS) {
        encolarEscrituraObservabilidad(auditarPlan({ requestId: estado.ragRequestId, status: "PLAN_NO_CONVERGE", candidateProductIds: [...estado.ragIdsRecuperados] }));
        return { ok: false, status: "PLAN_NO_CONVERGE", accion_requerida: ACCION_PLAN_NO_CONVERGE, mensaje_cliente: MENSAJE_CLIENTE_PLAN_EN_AJUSTE };
      }
      const respuesta = await confirmarPlan(args);
      if (respuesta.ok !== false) return respuesta;
      estado.rechazosPlan += 1;
      if (estado.rechazosPlan < RECHAZOS_MAXIMOS) return respuesta;
      encolarEscrituraObservabilidad(auditarPlan({ requestId: estado.ragRequestId, status: "PLAN_NO_CONVERGE", candidateProductIds: [...estado.ragIdsRecuperados] }));
      return { ...respuesta, accion_requerida: ACCION_PLAN_NO_CONVERGE };
    },

    /**
     * Ajusta la propuesta vigente en vez de rediseñarla (§7). Solo se registra
     * como herramienta activa cuando `estado.planVigente` existe
     * (`herramientasActivas`), pero el handler igual repite la comprobación:
     * el modelo nunca autoriza nada con solo llamarla, la autorización es el
     * token firmado que ya verificó `planVigenteDelTurno`.
     */
    ajustar_plan_decoracion: async (args) => {
      const bloqueo = bloqueoHerramientaComercial("ajustar_plan_decoracion");
      if (bloqueo) return bloqueo;
      const planVigente = estado.planVigente;
      if (!planVigente) {
        return {
          ok: false,
          status: "SIN_PROPUESTA_VIGENTE",
          accion_requerida: "No hay una propuesta vigente en este turno para ajustar. Usa confirmar_plan_decoracion para diseñar una propuesta.",
          mensaje_cliente: MENSAJE_CLIENTE_PLAN_EN_AJUSTE,
        };
      }
      const parsedEdicion = EdicionSchema.safeParse(args);
      if (!parsedEdicion.success) {
        const errores = parsedEdicion.error.issues.map((issue) => `${issue.path.join(".") || "edicion"}: ${issue.message}`);
        encolarEscrituraObservabilidad(auditarPlan({ requestId: estado.ragRequestId, status: "AJUSTE_ESQUEMA_INVALIDO", error: errores.join(" | ") }));
        return {
          ok: false,
          status: "AJUSTE_ESQUEMA_INVALIDO",
          errores,
          accion_requerida: "Corrige accion/estructura_id/objetivo_variant_id/variante/participacion según el esquema y vuelve a llamar ajustar_plan_decoracion.",
          mensaje_cliente: MENSAJE_CLIENTE_PLAN_EN_AJUSTE,
        };
      }
      const edicion: Edicion = parsedEdicion.data;
      // Misma allowlist que confirmar_plan_decoracion (allowlistDesdeMapa(estado.ragVariantIdsRecuperados)):
      // el variant_id que el modelo propone tiene que haber salido de
      // buscar_catalogo_rag EN ESTE MISMO turno. `aplicarEdicionPlan` admite la
      // variante contra el snapshot firmado, pero eso no exige que el modelo la
      // haya buscado — sin este paso podría "recordar" un variant_id sin
      // pasarlo por el catálogo de este turno.
      if (edicion.accion !== "quitar") {
        const variante = edicion.variante!;
        const vistas = estado.ragVariantIdsRecuperados.get(variante.product_id);
        if (!vistas?.has(variante.variant_id)) {
          encolarEscrituraObservabilidad(auditarPlan({ requestId: estado.ragRequestId, status: "AJUSTE_VARIANTE_FUERA_DE_BUSQUEDA", error: `${variante.product_id}:${variante.variant_id}` }));
          return {
            ok: false,
            status: "VARIANTE_FUERA_DE_BUSQUEDA",
            accion_requerida: "El product_id/variant_id de `variante` debe haber aparecido en buscar_catalogo_rag de este mismo turno. Búscalo primero y usa exactamente ese par.",
            mensaje_cliente: MENSAJE_CLIENTE_PIEZAS,
          };
        }
      }
      try {
        const { plan: resuelto, cotizacion, avisos } = await aplicarEdicionPlan({
          base: planVigente.base,
          edicion,
          catalogAllowlist: options.catalogAllowlist ?? null,
          correlationId: options.correlationId,
          pool: ragPool,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        estado.planResuelto = resuelto;
        estado.cotizacion = cotizacion;
        estado.seleccionFinalIA = [];
        encolarEscrituraObservabilidad(auditarPlan({
          requestId: estado.ragRequestId,
          planHash: resuelto.plan_hash,
          status: "PLAN_AJUSTADO_CHAT",
          geometry: { accion: edicion.accion, estructura_id: edicion.estructura_id, objetivo_variant_id: edicion.objetivo_variant_id, nueva_variant_id: edicion.variante?.variant_id },
          costChosenCop: resuelto.totales.total_cop,
        }));
        return {
          ok: true,
          status: "PLAN_AJUSTADO",
          // Point 4 of §7: what changed vs. the previous card, so the model
          // can say it instead of presenting the update as a first proposal.
          estructura_ajustada: edicion.estructura_id,
          accion: edicion.accion,
          material_nuevo: edicion.accion === "quitar" ? undefined : `${edicion.variante!.product_id}/${edicion.variante!.variant_id}`,
          total_cop: resuelto.totales.total_cop,
          // Python's own sentences about the edit (e.g. the color pattern was
          // rebuilt because a color left the piece): relay them, don't reword.
          ...(avisos.length > 0 ? { avisos } : {}),
          accion_requerida: avisos.length > 0
            ? "Cuéntale al cliente qué cambiaste (la estructura y el material, no todo el plan), incluidos los avisos tal cual, y que el desglose en pantalla ya lo refleja. No llames confirmar_plan_decoracion en este turno ni presentes esto como una propuesta nueva."
            : "Cuéntale al cliente qué cambiaste (la estructura y el material, no todo el plan) y que el desglose en pantalla ya lo refleja. No llames confirmar_plan_decoracion en este turno ni presentes esto como una propuesta nueva.",
          fase: "propuesta_actualizada; el desglose en pantalla ya refleja el ajuste",
        };
      } catch (error) {
        if (error instanceof PlanEditError) {
          encolarEscrituraObservabilidad(auditarPlan({ requestId: estado.ragRequestId, status: "AJUSTE_RECHAZADO", error: `${error.causa ?? "sin_causa"}: ${error.message}` }));
          return {
            ok: false,
            status: "AJUSTE_RECHAZADO",
            ...(error.causa ? { causa: error.causa } : {}),
            accion_requerida: "El ajuste no se pudo aplicar. Dile al cliente el motivo; si la propuesta expiró o el catálogo cambió, ofrécele pedirla de nuevo en vez de inventar un resultado.",
            mensaje_cliente: error.message,
          };
        }
        if (error instanceof AllowlistProductoVarianteError) {
          encolarEscrituraObservabilidad(auditarPlan({ requestId: estado.ragRequestId, status: "PRODUCTO_VARIANTE_INCONSISTENTE", error: error.message }));
          return {
            ok: false,
            status: "PRODUCTO_VARIANTE_INCONSISTENTE",
            accion_requerida: "El variant_id no pertenece a ese product_id según buscar_catalogo_rag; corrige el par y vuelve a llamar ajustar_plan_decoracion.",
            mensaje_cliente: MENSAJE_CLIENTE_PIEZAS,
          };
        }
        if (isPythonAdapterError(error)) throw new FalloTecnicoTurnoError(error.code, error.domainCode ?? error.message);
        if (error instanceof PythonPlanMappingError) throw new FalloTecnicoTurnoError(error.code, error.message);
        throw error;
      }
    },

  };
}
