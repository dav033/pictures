import "server-only";
import type { RegistroHerramientas } from "@sempertex/agente-core";
import type { Pool } from "pg";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import { TEXTO_PLAN_LISTO } from "@/lib/ia/omoikane/texto-final-turno";
import { FalloTecnicoTurnoError } from "@/lib/ia/herramientas/fallo-tecnico-turno";
import { advertenciasPuertaFisica, mezclasCompatiblesConDiametros, pulgadasDeMezcla, tamanosObligatorios } from "@/lib/plan/mezclas";
import { sustitucionesCliente } from "@/lib/plan/presentacion-cliente";
import { getRagPool } from "@/lib/rag/db";
import { buscarCatalogoRag, type ProductoCandidato } from "@/lib/rag/chat/buscar";
import { avisoFiltrosBusqueda, filtrosDurosDeBusqueda } from "@/lib/rag/chat/filtros-turno";
import { tonosExclusivos } from "@/lib/plan/tonos-color";
import type { FiltrosDurosBusqueda } from "@/lib/rag/query-parser/hard-filters";
import { parseEventSearchIntent } from "@/lib/rag/query-parser/event-search";
import { type ItemRechazado, type ItemValidado } from "@/lib/rag/chat/validar";
import { actualizarResultadoBusqueda, encolarEscrituraObservabilidad, registrarBusqueda, registrarPlanAudit, type HechosPeticionPlan } from "@/lib/rag/observability/log";
import { PlanDecoracionSchema, type PlanDecoracion } from "@/lib/plan/tipos";
import { igualarParejas, parejasDeInstruccion, separarEstructurasRepetidas } from "@/lib/plan/piezas-individuales";
import { decidir } from "@/lib/registro/servidor";
import type { PistaArmado } from "@/lib/plan/armado-bouquet";
import type { PistaRemate } from "@/lib/plan/armado-columna";
import type { PistaGuirnalda } from "@/lib/plan/armado-guirnalda";
import type { ArmadoArcoV1 } from "@/lib/plan/armado-arco";
import type { ArmadoColumnaV1 } from "@/lib/plan/armado-columna";
import type { ArmadoGuirnaldaOrganicaV1 } from "@/lib/plan/armado-guirnalda-organica";
import {
  CLAVE_ARMADO,
  TIPOS_ARMADO_MOTOR,
  aplicarArmadosCompletados,
  piezaDelPlan,
  sinArmadosDeMotor,
  sinColumnaOrganicaDelModelo,
  type PiezaArmado,
  type TipoArmadoMotor,
} from "@/lib/plan/armado-estructura-ia";
import { llamarPythonEstimarConteo, llamarPythonOmoikaneArmarEstructura, llamarPythonOmoikaneCatalogoArmado, llamarPythonOmoikaneCompletarArmados } from "@/lib/ia/nucleo/python-adapter";
import type { PistaConteo } from "@/lib/plan/conteo-referencia";
import type { PistaGeometria } from "@/lib/plan/geometria-referencia";
import type { PistaPatron, PistaTamanos } from "@/lib/plan/patron-color";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { aplicarColoresReferencia, comoCubrirElementosReferencia, extraerRestriccionesUsuario, validarCardinalidadEventoAbierto, validarCoberturaReferencia, validarEstructurasDeGlobosConGlobos, validarEstructurasFueraDeReferencia, validarPresenciaGlobos, validarRangoCreatividad, validarReferenciaSinGlobos, validarRestriccionesPlan, validarUnidadesDeclaradas, MENSAJE_CLIENTE_REFERENCIA_SIN_GLOBOS } from "@/lib/plan/restricciones";
import { CREATIVIDAD_POR_DEFECTO, perfilCreatividad, type NivelCreatividad } from "@/lib/ia/escena/creatividad";
import { parseEventIntent } from "@/lib/rag/query-parser/parse-event";
import type { EventMatchEvidence, EventMatchLevel } from "@/lib/rag/retrieval/types";
import { abrirContextoPlan, allowlistDesdeMapa, crearTokenPlan, verificarTokenAprobacion } from "@/lib/plan/aprobacion";
import { aplicarEdicionPlan } from "@/lib/plan/aplicar-edicion";
import type { BasePlan } from "@/lib/plan/edicion-esquemas";
import { leerEdicionesChat } from "@/lib/plan/edicion-chat";
import { aplicarEdicionesEncadenadas, cambioParaElModelo, EdicionEncadenadaError, geometriaAuditadaChat, mensajeClienteDeRechazo, primeraVarianteNoBuscada } from "./ajustar-plan-chat";
import { PlanEditError } from "@/lib/plan/edicion-error";
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
import { sellarEstructurasOficiales } from "@/lib/plan/estructuras-oficiales";
import { sanearMarcasPlan } from "@/lib/plan/marcas-registradas";
import { aplicarFuenteMedidasEspacio, clienteDioMedidasEspacio, estructurasMedidasPorCliente } from "@/lib/plan/medidas-defecto";
import { acabadosObservadosDeMateriales, coloresElementoReferencia, coloresFotoParaBusqueda, coloresReferenciaOmitidos, esSustitucionDeColor, materialesDeColorInventado, productosGloboPorColor, type ProductoColorDisponible } from "@/lib/plan/colores-referencia";
import { colorDeCompraSinVenta } from "@/lib/rag/catalog/similitud-color";
import { evidenciaColorFoto, PARTE_MINIMA_RECLAMO, type EvidenciaColorFoto } from "@/lib/plan/reclamo-color-referencia";
import { buscarGlobosPorColor } from "@/lib/rag/catalog/globos-por-color";
import { buscarNumerosPorDigito, digitosBuscados } from "@/lib/rag/catalog/numeros-por-digito";
import { RAG_ENABLED, featureEnabled } from "@/lib/ia/nucleo/feature-flags";
import { isPythonAdapterError } from "@/lib/ia/nucleo/python-adapter";
import { AllowlistProductoVarianteError } from "@/lib/plan/allowlist-producto-variante";
import { sceneShadowPipeline } from "@/lib/scene/orchestrator";
import { validateMaterialEstimate } from "@/lib/materiales/estimacion";
import type { Faceta, FiltrosCatalogo } from "@/lib/shopify/consultas";
import type { Brief, DecoracionConProductos, Producto } from "@/lib/types";
import { ajustarCoberturaPlan, aplicarAcabadoReferencia, avisosClienteAjustes, busquedasDeAcabado, busquedasDeMismoColor, coloresSinTamanos, mezclasAdmisiblesEstructura, productosDelAjuste, quitarMaterialesDeColorInventado, type AjusteCobertura } from "@/lib/plan/cobertura-materiales";
import { aplicarReferenciasMedidas, busquedasDeReferencias, familiaDeTitulo } from "@/lib/plan/referencias-medidas";
import { TIPOS_ESTRUCTURA_GEOMETRICOS } from "@/lib/plan/composicion";
import { ACCION_PLAN_NO_CONVERGE, accionEstimacionInconsistente, disponibilidadDelTurno, quitarMaterialesSinCobertura, RECHAZOS_MAXIMOS, RECHAZOS_PARA_CONVERGER, sinCoronaSinCobertura, unirCandidatosTurno } from "./convergencia-plan";
import { normalizarArgsBrief } from "./brief-herramienta";
import { ArgsArmarEstructuraSchema, ArgsConsultarOpcionesArmadoSchema, erroresDeArgs, opcionesDePares } from "./armado-motor";
import { EstimarConteoRequestV1Schema } from "@/lib/ia/contracts/domain-v1";
import { ArgsEstimarConteoGlobosSchema, erroresDeEstimacion, objetivoDeLaFoto, solicitudDeEstimacion, type ObjetivoDeLaEstimacion } from "./estimar-conteo";
import { AJUSTAR_PLAN_DECORACION, ESTIMAR_CONTEO_GLOBOS, HERRAMIENTAS_ARMADO_MOTOR, HERRAMIENTAS_PLAN, HERRAMIENTAS_RAG } from "./herramientas";
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
 * ejecución (`guardar_brief`,
 * `confirmar_plan_decoracion`). `ejecutarConversacion`/`ejecutarConversacionStream`
 * solo paralelizan una vuelta si CADA llamada de esa vuelta está en este
 * set Y ningún nombre se repite (ver `puedeParalelizarse` en agente-core) —
 * dos llamadas al mismo handler en la misma vuelta seguirían corriendo en
 * secuencia porque compiten por el mismo campo de estado.
 */
export const HERRAMIENTAS_SOLO_LECTURA = new Set([
  "buscar_catalogo_rag",
  // ADR-0034 §5: el catálogo de patrones del motor es una consulta pura. No
  // toca `EstadoConversacion`, no decide catálogo ni precio y su respuesta no
  // depende del orden, así que puede correr junto a una búsqueda en la misma
  // vuelta. `armar_estructura` queda fuera a propósito: escribe en
  // `armadosEstructura`.
  "consultar_opciones_armado",
  // ADR-0038: estimar el conteo es una consulta pura a Python. No escribe en
  // `EstadoConversacion` (solo lee `armadosEstructura`, el blueprint y las
  // restricciones), no toca `planResuelto`, el token ni `plan_hash`, y su
  // respuesta no depende del orden: puede correr junto a una búsqueda o a una
  // consulta de armado en la misma vuelta.
  "estimar_conteo_globos",
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
 *
 * `armadoMotor` expone las dos herramientas del motor del diseñador
 * (ADR-0034 §5) detrás de `ARMADO_ARCO_COLUMNA_V1`, encendida fuera de
 * producción. Con la bandera apagada el modelo no las ve y el turno es
 * exactamente el de antes.
 *
 * `estimarConteo` expone `estimar_conteo_globos` (ADR-0038, solo lectura)
 * detrás de `ESTIMAR_CONTEO_V1`, con el mismo default: encendida fuera de
 * producción, apagada en producción.
 */
export function herramientasActivas(flags: { ragEnabled?: boolean; planVigente?: boolean; armadoMotor?: boolean; estimarConteo?: boolean } = {}): Herramienta[] {
  const ragEnabled = flags.ragEnabled ?? RAG_ENABLED;
  if (!ragEnabled) return [];
  const armadoMotor = flags.armadoMotor ?? featureEnabled("ARMADO_ARCO_COLUMNA_V1");
  const estimarConteo = flags.estimarConteo ?? featureEnabled("ESTIMAR_CONTEO_V1");
  return [
    ...HERRAMIENTAS_RAG,
    ...HERRAMIENTAS_PLAN,
    ...(armadoMotor ? HERRAMIENTAS_ARMADO_MOTOR : []),
    ...(estimarConteo ? [ESTIMAR_CONTEO_GLOBOS] : []),
    ...(flags.planVigente ? [AJUSTAR_PLAN_DECORACION] : []),
  ];
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
  // Restos de la selección visual retirada (auditoría 2026-10-04, C2): ya no
  // hay herramienta que lo escriba. Se conserva hasta retirar `seleccionIA`
  // del evento `fin` del contrato chat.sse.v1 (primero el consumidor).
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
  /**
   * Lo que `armar_estructura` dejó validado en este turno, por `estructura_id`
   * (ADR-0034 §5). No es un armado que el modelo afirme tener: cada entrada
   * pasó por la puerta del motor en Python, y al confirmar se vuelve a validar
   * contra la pieza de verdad —que es el único momento en el que se sabe
   * cuántos materiales lleva— antes de escribirse en el plan. Por eso el
   * modelo no repite el armado en los argumentos de
   * `confirmar_plan_decoracion`: lo que entra en la pieza es esto, no su eco.
   */
  armadosEstructura?: Map<string, { tipo: TipoArmadoMotor; armado: ArmadoArcoV1 | ArmadoColumnaV1 | ArmadoGuirnaldaOrganicaV1 }>;
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
 * Al agotar VUELTAS_MAX no siempre "se enredó" de verdad: si el plan ya quedó
 * verificado, la tarjeta se muestra con el evento `fin`, y decir "me enredé"
 * contradice lo que el cliente ve en pantalla (caso "cardinalidad" de
 * eval/chat/jerga-v001.json, 2026-09-14). El texto es el mismo del cierre
 * normal: un solo dueño, `TEXTO_PLAN_LISTO`.
 */
export function textoAlAgotarVueltas(estado: EstadoConversacion): string {
  if (estado.planResuelto) return TEXTO_PLAN_LISTO;
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
export const ACCION_COLORES_EN_CATALOGO = "colores_en_catalogo lista los globos redondos del catálogo disponible que SÍ tienen cada color de la foto que esta búsqueda no devolvió. Búscalos con buscar_catalogo_rag por su título o su color antes de armar el plan y úsalos para cubrir ese color: un color de la foto que el plan no compra se le avisa al cliente como sustitución y, si la foto traía un patrón, lo descarta entero. Si disponibles está vacío, ese color no está en el catálogo activo: díselo al cliente y ofrécele con qué color se arma en su lugar.";
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
) {
  if (!estado.referenceBlueprint || estado.restriccionesUsuario.colores.length > 0 || estado.coloresReferenciaReclamados.size > 0) return [];
  // After repeated refusals the photo colors are notices, never another refusal.
  if (estado.rechazosPlan >= RECHAZOS_PARA_CONVERGER) return [];
  // Solo se le exige al modelo un color con respaldo en la pieza (reclamo-color-referencia.ts): uno que la lectura
  // nombró sin que los píxeles ni la disposición lo muestren (luz morada leída como «azul pastel») o que es un acento
  // de poca proporción se queda en aviso. Antes forzaba un Reflex Azul oscuro en unas columnas rosa y plata (2026-10-06).
  const elementosFoto = new Map(estado.referenceBlueprint.elements.filter((elemento) => elemento.approved).map((elemento) => [elemento.element_id, elemento] as const));
  const noExigidos: Array<{ estructura_id: string; element_id: string } & EvidenciaColorFoto> = [];
  const pendientes = plan.estructuras.map((estructura) => {
    const usados = new Set(estructura.materiales.map((material) => material.color?.trim().toLowerCase()).filter(Boolean));
    const elemento = estructura.referencia_element_id ? elementosFoto.get(estructura.referencia_element_id) : undefined;
    const colores = coloresElementoReferencia(estado.referenceBlueprint, estructura.referencia_element_id).filter((color) => {
      if (!elemento || usados.has(color.trim().toLowerCase()) || usados.has(colorDeCompraSinVenta(color) ?? "")) return true;
      const evidencia = evidenciaColorFoto(elemento.appearance, color);
      if (!evidencia.reclamable) noExigidos.push({ estructura_id: estructura.estructura_id, element_id: elemento.element_id, ...evidencia });
      return evidencia.reclamable;
    });
    return { ...estructura, colores_referencia: colores };
  });
  if (noExigidos.length > 0) {
    decidir("regla:colores_referencia_no_exigidos", "colores de la foto que el plan no compra y no se le exigen al modelo (dudosos o de poca proporción)", noExigidos, {
      entrada: { parteMinima: PARTE_MINIMA_RECLAMO },
      motivo: "sin respaldo en los píxeles ni en la disposición de la pieza, o por debajo de la parte mínima: queda como aviso, no como rechazo",
    });
  }
  const faltantes = [...new Set(pendientes.flatMap((estructura) => {
    const usados = new Set(estructura.materiales.map((material) => material.color?.trim().toLowerCase()).filter(Boolean));
    // An unsold photo color is covered by the color it is bought as ("gris" as "plateado").
    return estructura.colores_referencia.filter((color) => !usados.has(color.trim().toLowerCase()) && !usados.has(colorDeCompraSinVenta(color) ?? ""));
  }))];
  if (faltantes.length === 0) return [];
  const disponibles = new Map<string, ProductoColorDisponible[]>(productosGloboPorColor(estado.ragCandidatos ?? [], faltantes));
  // También se consulta el catálogo cuando los productos del turno de ese color no arman ninguna mezcla (el Metal
  // Vinotinto, solo R-9): sin eso el vino de la foto 07 no se reclamaba nunca, porque el único burdeos del turno no
  // servía y el Fashion Merlot, que sí, no se miraba (banco de fotos, 2026-10-06).
  const sirveParaAlgo = (producto: ProductoColorDisponible) => !producto.diametros || mezclasCompatiblesConDiametros(producto.diametros).length > 0;
  const sinBusqueda = faltantes.filter((color) => !(disponibles.get(color) ?? []).some(sirveParaAlgo));
  const busquedaLosPuedeDevolver = !tieneFiltrosNoRelajables(filtrosDurosDeBusqueda({ mensaje: "", solicitudOriginal: estado.solicitudOriginal, brief: estado.brief }));
  if (sinBusqueda.length > 0 && busquedaLosPuedeDevolver) {
    try {
      const catalogo = await buscarGlobosPorColor(pool, sinBusqueda, { catalogSnapshotId: estado.ragCatalogSnapshotId ?? null });
      for (const [color, productos] of catalogo) {
        const delTurno = disponibles.get(color) ?? [];
        disponibles.set(color, [...delTurno, ...productos.filter((producto) => !delTurno.some((visto) => visto.product_id === producto.product_id))]);
      }
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

/**
 * Lecturas de la foto para las guirnaldas que materializan un elemento de la
 * referencia (ADR-0032, E4). Misma fuente y misma regla que `pistasArmadoDelPlan`.
 */
export function pistasGuirnaldaDelPlan(plan: Pick<PlanDecoracion, "estructuras">, blueprint: ReferenceBlueprintV2 | undefined): PistaGuirnalda[] {
  if (!blueprint) return [];
  const elementos = new Map(blueprint.elements.filter((elemento) => elemento.approved).map((elemento) => [elemento.element_id, elemento]));
  const pistas = new Map<string, PistaGuirnalda>();
  for (const estructura of plan.estructuras) {
    const elementId = estructura.referencia_element_id;
    const lectura = elementId ? elementos.get(elementId)?.appearance.armado_guirnalda : undefined;
    if (!elementId || !lectura || pistas.has(elementId)) continue;
    pistas.set(elementId, { referencia_element_id: elementId, ...lectura });
  }
  return [...pistas.values()].slice(0, MAX_PISTAS_PATRON);
}

/** Desde qué parte de globos grandes y gigantes contados la foto contradice «chicos con pocos grandes». */
export const PARTE_GRANDES_CONTRADICE = 0.4;

/**
 * Los tamaños que la foto leyó en una pieza, reconciliando sus dos lecturas (UI-4, 2026-10-05).
 *
 * `tamanos_leidos` es una categoría y casi siempre dice «chicos_con_pocos_grandes» (46 de 48 piezas de la
 * línea base): no discrimina. El conteo de la MISMA pieza trae el reparto por tamaño en cifras, y en la
 * columna dorada del CASE-001 de images-judge medía 0,4-0,5 de grandes y gigantes (el resto de casos, 0,15-0,3)
 * mientras la categoría decía «pocos grandes»: la pieza se compraba con un 7 % de 18"/24" y es casi toda de
 * globos grandes. Cuando las dos lecturas se contradicen así —un 40 % o más de grandes con confianza de al
 * menos 0,5—, manda la cifra y la pieza es «grandes_con_pocos_chicos». En cualquier otro caso, la categoría
 * tal cual: esto solo resuelve una contradicción, no reinterpreta la lectura.
 */
export function tamanosDeLaFoto(apariencia: ReferenceBlueprintV2["elements"][number]["appearance"]): typeof apariencia.tamanos_leidos {
  const leido = apariencia.tamanos_leidos;
  if (leido !== "chicos_con_pocos_grandes") return leido;
  const conteo = apariencia.conteo;
  if (!conteo || conteo.confianza < 0.5) return leido;
  const grandes = conteo.por_tamano.filter((item) => item.clase === "grande" || item.clase === "gigante").reduce((suma, item) => suma + item.proporcion, 0);
  return grandes >= PARTE_GRANDES_CONTRADICE ? "grandes_con_pocos_chicos" : leido;
}

/**
 * Los tamaños de globo que la foto leyó en las piezas que materializan un elemento de la referencia. Misma
 * fuente y misma regla que `pistasRemateDelPlan`, y por la misma razón que esa existe aparte de
 * `pistasPatronDelPlan`: un tamaño no es una disposición de color, así que **no** depende de que la pieza
 * haya dejado `patron_color`. Una columna de un solo color no deja ninguno y es justo la que había que leer.
 */
export function pistasTamanosDelPlan(plan: Pick<PlanDecoracion, "estructuras">, blueprint: ReferenceBlueprintV2 | undefined): PistaTamanos[] {
  if (!blueprint) return [];
  const elementos = new Map(blueprint.elements.filter((elemento) => elemento.approved).map((elemento) => [elemento.element_id, elemento]));
  const pistas = new Map<string, PistaTamanos>();
  for (const estructura of plan.estructuras) {
    const elementId = estructura.referencia_element_id;
    const elemento = elementId ? elementos.get(elementId) : undefined;
    const leido = elemento ? tamanosDeLaFoto(elemento.appearance) : undefined;
    if (!elementId || !leido || pistas.has(elementId)) continue;
    // La confianza del patrón no juzga los tamaños —como no juzga el remate—, pero cuando la hay es la
    // única medida de cuánto se vio la pieza, así que se reaprovecha; sin patrón, la lectura se da por buena.
    pistas.set(elementId, { referencia_element_id: elementId, tamanos: leido, confianza: elemento?.appearance.patron_color?.confianza ?? 1 });
  }
  return [...pistas.values()].slice(0, MAX_PISTAS_PATRON);
}

/**
 * Lo que la foto leyó del remate de las columnas que materializan un elemento de
 * la referencia (ADR-0039). Misma fuente y misma regla que `pistasArmadoDelPlan`.
 *
 * Solo de las columnas: el arco del motor no tiene remate y el bouquet tiene el
 * suyo (ADR-0030). Una columna que no sale en la lista deja el remate del motor.
 */
export function pistasRemateDelPlan(plan: Pick<PlanDecoracion, "estructuras">, blueprint: ReferenceBlueprintV2 | undefined): PistaRemate[] {
  if (!blueprint) return [];
  const elementos = new Map(blueprint.elements.filter((elemento) => elemento.approved).map((elemento) => [elemento.element_id, elemento]));
  const pistas = new Map<string, PistaRemate>();
  for (const estructura of plan.estructuras) {
    if (estructura.tipo !== "columna") continue;
    const elementId = estructura.referencia_element_id;
    const lectura = elementId ? elementos.get(elementId)?.appearance.remate_columna : undefined;
    if (!elementId || !lectura || pistas.has(elementId)) continue;
    pistas.set(elementId, { referencia_element_id: elementId, ...lectura });
  }
  return [...pistas.values()].slice(0, MAX_PISTAS_PATRON);
}

/**
 * Hacia dónde se va cada pieza y cuánto, leído de la foto (fracción de su alto,
 * negativo a la izquierda). Misma fuente y misma regla que `pistasArmadoDelPlan`.
 * Una pieza recta solo viaja si es columna: la columna asimétrica arranca con su
 * plantilla inclinada (25 % del alto) cuando no recibe nada, así que "la foto la
 * muestra recta" se envía como 0 y el motor la deja recta. En las demás piezas el
 * 0 sigue sin viajar: no hay un valor de partida inclinado que contradecir.
 */
export function pistasInclinacionDelPlan(plan: Pick<PlanDecoracion, "estructuras">, blueprint: ReferenceBlueprintV2 | undefined): { referencia_element_id: string; inclinacion: number }[] {
  if (!blueprint) return [];
  const elementos = new Map(blueprint.elements.filter((elemento) => elemento.approved).map((elemento) => [elemento.element_id, elemento]));
  const pistas = new Map<string, { referencia_element_id: string; inclinacion: number }>();
  for (const estructura of plan.estructuras) {
    const elementId = estructura.referencia_element_id;
    const inclinacion = elementId ? elementos.get(elementId)?.appearance.inclinacion : undefined;
    if (!elementId || inclinacion === undefined || pistas.has(elementId)) continue;
    if (inclinacion === 0 && estructura.tipo !== "columna") continue;
    pistas.set(elementId, { referencia_element_id: elementId, inclinacion });
  }
  return [...pistas.values()].slice(0, MAX_PISTAS_PATRON);
}

/**
 * La línea de cada guirnalda leída en la foto (ADR-0032, decisiones 27 a 29), para
 * el motor: su forma, su soporte, sus puntos de anclaje, hacia dónde se curva y
 * cuánto (`arriba` es la tendida sobre un fondo que cae por los dos lados y `abajo`
 * el festón que cuelga), el desnivel de sus extremos, la caída de una lectura v2 y
 * la confianza, todo relativo al largo como lo lee la foto. Misma fuente y misma
 * regla que `pistasArmadoDelPlan`.
 *
 * Viaja la lectura y Python la traduce con la misma función que el armado por
 * partes (`armado_guirnalda.linea_de_lectura`). Antes solo viajaban el sentido y la
 * flecha, y el desnivel se perdía: la foto del 2026-09-28 (curva hacia arriba
 * 0,107 y el extremo derecho 0,335 del largo más bajo) salía nivelada. Lo que la
 * lectura no distingue (`null`) no viaja; el sentido y la flecha de una lectura v3
 * o v4 y la caída de una v2 no viajan juntos, que es como Python las distingue.
 */
export function pistasCurvaDelPlan(plan: Pick<PlanDecoracion, "estructuras">, blueprint: ReferenceBlueprintV2 | undefined): {
  referencia_element_id: string;
  soporte: PistaGuirnalda["soporte"];
  forma: PistaGuirnalda["forma"];
  confianza: number;
  puntos_de_anclaje?: number;
  sentido?: "arriba" | "abajo";
  flecha?: number;
  desnivel?: number;
  caida?: number;
}[] {
  if (!blueprint) return [];
  type PistaCurva = ReturnType<typeof pistasCurvaDelPlan>[number];
  const elementos = new Map(blueprint.elements.filter((elemento) => elemento.approved).map((elemento) => [elemento.element_id, elemento]));
  const pistas = new Map<string, PistaCurva>();
  for (const estructura of plan.estructuras) {
    const elementId = estructura.referencia_element_id;
    const lectura = elementId ? elementos.get(elementId)?.appearance.armado_guirnalda : undefined;
    if (!elementId || !lectura || pistas.has(elementId)) continue;
    // Una lectura v2 no trae las claves del sentido ni de la flecha: su caída es la de entonces.
    const v2 = lectura.sentido_curva === undefined && lectura.flecha_relativa === undefined;
    pistas.set(elementId, {
      referencia_element_id: elementId,
      soporte: lectura.soporte,
      forma: lectura.forma,
      confianza: lectura.confianza,
      ...(lectura.puntos_de_anclaje === undefined ? {} : { puntos_de_anclaje: lectura.puntos_de_anclaje }),
      ...(lectura.sentido_curva ? { sentido: lectura.sentido_curva } : {}),
      ...(typeof lectura.flecha_relativa === "number" ? { flecha: lectura.flecha_relativa } : {}),
      ...(typeof lectura.desnivel_relativo === "number" ? { desnivel: lectura.desnivel_relativo } : {}),
      ...(v2 && typeof lectura.caida_relativa === "number" ? { caida: lectura.caida_relativa } : {}),
    });
  }
  return [...pistas.values()].slice(0, MAX_PISTAS_PATRON);
}

/**
 * Conteos de globos de la foto para las estructuras que materializan un
 * elemento de la referencia (ADR-0031). Misma fuente y misma regla que
 * `pistasArmadoDelPlan`: una lectura por elemento aprobado.
 */
export function pistasConteoDelPlan(plan: Pick<PlanDecoracion, "estructuras">, blueprint: ReferenceBlueprintV2 | undefined): PistaConteo[] {
  if (!blueprint) return [];
  const elementos = new Map(blueprint.elements.filter((elemento) => elemento.approved).map((elemento) => [elemento.element_id, elemento]));
  const pistas = new Map<string, PistaConteo>();
  for (const estructura of plan.estructuras) {
    const elementId = estructura.referencia_element_id;
    const conteo = elementId ? elementos.get(elementId)?.appearance.conteo : undefined;
    if (!elementId || !conteo || pistas.has(elementId)) continue;
    pistas.set(elementId, { referencia_element_id: elementId, ...conteo });
  }
  return [...pistas.values()].slice(0, MAX_PISTAS_PATRON);
}

/**
 * Los avisos de Python que cuentan cómo quedó el reparto de color de una pieza (`plan._color_warnings` y
 * `patron_color`, 2026-10-05). No son algo que el modelo pueda corregir volviendo a confirmar: un arco clásico
 * reparte su espiral por igual pida lo que pida la participación, y un patrón sin material para un acento lo
 * pierde igual. Si viajaran en `advertencias`, que el prompt trata como instrucciones para corregir el plan,
 * cada uno costaría una vuelta entera del modelo y otra resolución. Viajan aparte, en `notas_reparto`, para que
 * el modelo los explique al cliente.
 */
const PREFIJOS_NOTA_REPARTO = ["reparto_distinto:", "color_sin_globos:", "patron_sin_aplicar:", "pista_patron_incompleta:"] as const;

export function separarNotasReparto(advertencias: readonly string[]): { advertencias: string[]; notasReparto: string[] } {
  const esNota = (aviso: string) => PREFIJOS_NOTA_REPARTO.some((prefijo) => aviso.startsWith(prefijo));
  return { advertencias: advertencias.filter((aviso) => !esNota(aviso)), notasReparto: advertencias.filter(esNota) };
}

/** Arma el registro de herramientas (nombre → handler) que el motor genérico
 * de @sempertex/agente-core despacha — cada cuerpo es el mismo que tenía el
 * if-chain de ejecutar.ts antes de esta extracción, sin cambios de lógica. */
export function crearRegistroHerramientas(estado: EstadoConversacion, options: {
  pool?: Pool;
  correlationId?: string;
  signal?: AbortSignal;
  /** Creativity level chosen in the UI; decides how many extra pieces a reference plan may add. */
  creatividad?: NivelCreatividad;
  /** Request facts for plan_audit_log columns (Plan A §A0.1); observability only. */
  hechosPeticion?: Omit<HechosPeticionPlan, "rechazosTurno" | "claseRechazo">;
  /**
   * Vista guiada (chat-v1 `piezasIndividuales`): cada pieza es individual. `confirmar_plan_decoracion` separa toda
   * estructura con repeticiones N en N piezas con nombre propio antes de resolver con Python (piezas-individuales.ts).
   */
  piezasIndividuales?: boolean;
  /**
   * Vista guiada (chat-v1 `solicitudCliente`): lo que dijo el cliente, porque su mensaje es una instrucción de máquina.
   * Da la ocasión del plan (`concepto.ocasion`, antes «Fiesta» inventada para una boda) y su `original_request` (la
   * escena de la imagen). Las validaciones y los filtros del catálogo siguen leyendo `solicitudOriginal`.
   */
  solicitudCliente?: string;
} = {}): RegistroHerramientas {
  const ragPool = options.pool ?? getRagPool();
  // Every plan audit row of this turn carries the request facts and the
  // refusals counted so far; clase_rechazo waits for the A4.1 classes.
  const auditarPlan = (datos: Omit<Parameters<typeof registrarPlanAudit>[1], "hechos">) =>
    registrarPlanAudit(ragPool, { ...datos, hechos: { ...options.hechosPeticion, rechazosTurno: estado.rechazosPlan } });

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
    // C4: occasion is the customer's open label, not a closed taxonomy
    // value invented by the model. Keep model wording only when no label
    // was recoverable from the original request.
    // Vista guiada: la ocasión y la petición del plan salen de las palabras del cliente (`solicitudCliente`), no de la
    // instrucción de máquina; las validaciones siguen con `eventIntent` de la solicitud del turno.
    const eventLabel = parseEventSearchIntent(options.solicitudCliente ?? estado.solicitudOriginal).event_label;
    const eventIntent = parseEventIntent(estado.solicitudOriginal);
    const intentoDelPlan = options.solicitudCliente ? parseEventIntent(options.solicitudCliente) : eventIntent;
    if (options.solicitudCliente) {
      decidir("regla:solicitud_cliente_guiada", "ocasión y petición del plan desde las palabras del cliente (no de la instrucción de máquina)", { ocasion: eventLabel, original_request: intentoDelPlan.original_request }, {
        entrada: { solicitudCliente: options.solicitudCliente, ocasionModelo: (args as { concepto?: { ocasion?: unknown } }).concepto?.ocasion ?? null },
      });
    }
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
    // Los globos REALES medidos en la foto (`referencias_medidas` del blueprint): si el turno no trae el
    // producto exacto de alguno, lo busca el servidor con la frase con que se pide («globo latex redondo
    // Satin Rosado»). La búsqueda del modelo por color devuelve primero la línea Fashion, y sin el producto
    // en el turno nadie podía comprarlo (2026-10-04: columnas de rosa pastel compradas en Reflex Fucsia). Un
    // color que el cliente pidió manda sobre la foto, como en el resto de la auditoría de color.
    // Lo mismo para el ACABADO que la foto muestra de un color (UI-2c, 2026-10-05): si el turno no trae ese
    // color en ese acabado, `aplicarAcabadoReferencia` solo podía avisar. El modelo junta los colores en una
    // frase («plateado reflex rosado gris») y el «reflex» del plateado le traía un Reflex Rosado a una foto
    // pastel (CASE-002 de images-judge). Se mira sobre el plan ya canonizado y cubierto, que es el que juzga
    // la regla; un acabado que el cliente pidió manda sobre la foto.
    const fotoManda = estado.restriccionesUsuario.colores.length === 0;
    const disponibilidadPrevia = disponibilidadDelTurno(estado.ragCandidatos ?? []);
    const busquedasAcabado = estado.restriccionesUsuario.acabados.length === 0
      ? (() => {
        const previo = ajustarCoberturaPlan(canonizarColoresPlan(parseado.data).plan, disponibilidadPrevia).plan;
        return busquedasDeAcabado(previo, acabadosObservadosDeMateriales(previo.estructuras, estado.referenceBlueprint), disponibilidadPrevia);
      })()
      : [];
    // Un color cuyo producto no tiene los tamaños de su pieza (el Metal Vinotinto, solo R-9) sin otro producto del
    // turno de ese color que los tenga: el servidor consulta el catálogo por ese color y trae los que sí la arman,
    // para que la regla 2a de cobertura lo compre en vez de quitar el color (banco de fotos 07, 2026-10-06: el vino
    // salió del arco con el Fashion Merlot en todos los tamaños en el catálogo).
    const faltanTamanos = coloresSinTamanos(canonizarColoresPlan(parseado.data).plan, disponibilidadPrevia);
    let busquedasMismoColor: string[] = [];
    if (faltanTamanos.length > 0) {
      try {
        const catalogoPorColor = await buscarGlobosPorColor(ragPool, faltanTamanos.map((item) => item.color), { catalogSnapshotId: estado.ragCatalogSnapshotId ?? null });
        busquedasMismoColor = busquedasDeMismoColor(faltanTamanos, catalogoPorColor, disponibilidadPrevia);
      } catch (error) {
        console.warn("[confirmar] no se pudo consultar el catálogo por color", { requestId: estado.ragRequestId, error: error instanceof Error ? error.message : String(error) });
      }
      decidir("regla:mismo_color_con_tamanos", "colores cuyo producto no arma su pieza: buscar otro del mismo color que sí", { busquedas: busquedasMismoColor }, {
        entrada: { faltan: faltanTamanos },
        ...(busquedasMismoColor.length ? {} : { motivo: "el catálogo no tiene ese color en los tamaños de la pieza: la regla 3 lo quita con aviso" }),
      });
    }
    const busquedasReferencia = [...new Set([
      ...(fotoManda ? busquedasDeReferencias(parseado.data, estado.referenceBlueprint, disponibilidadPrevia) : []),
      ...busquedasAcabado,
      ...busquedasMismoColor,
    ])];
    if (busquedasReferencia.length > 0) {
      const respuestas = await Promise.all(busquedasReferencia.map((frase) => buscarCatalogoRag(ragPool, frase, {
        focusedQueries: [frase],
        catalogSnapshotId: estado.ragCatalogSnapshotId,
        rerankRequestId: estado.ragRequestId,
        rerankCorrelationId: options.correlationId ?? estado.ragRequestId,
        rerankSignal: options.signal,
      }).catch((error: unknown) => {
        console.warn("[confirmar] búsqueda de referencia medida fallida", { frase, error: error instanceof Error ? error.message : String(error) });
        return null;
      })));
      for (const respuesta of respuestas) {
        if (!respuesta) continue;
        estado.ragCandidatos = unirCandidatosTurno(estado.ragCandidatos ?? [], respuesta.candidatos);
        for (const candidato of respuesta.candidatos) {
          estado.ragIdsRecuperados.add(candidato.productId);
          const variantes = estado.ragVariantIdsRecuperados.get(candidato.productId) ?? new Set<string>();
          for (const variante of candidato.variantes) variantes.add(variante.variantId);
          estado.ragVariantIdsRecuperados.set(candidato.productId, variantes);
        }
      }
    }
    const disponibilidadTurno = disponibilidadDelTurno(estado.ragCandidatos ?? []);
    const coberturaBase = ajustarCoberturaPlan(canonizarColoresPlan(parseado.data).plan, disponibilidadTurno);
    const delCatalogo = coberturaBase.ajustes.filter((ajuste) => ajuste.tipo === "color_catalogo" || ajuste.tipo === "producto_mismo_color");
    if (delCatalogo.length > 0) {
      decidir("regla:cobertura_desde_catalogo", "material sin color: el del producto; material sin tamaños: otro producto de su mismo color", delCatalogo, {
        motivo: "el color de un material sale del catálogo y no se pierde un color de la pieza por los tamaños de un producto",
      });
    }
    // Cada globo de una pieza con referencias medidas tiene que SER una de ellas (referencias-medidas.ts).
    // Va antes de la poda de colores inventados: un Reflex Fucsia que la foto no tiene se cambia por la
    // referencia rosada más cercana en vez de quitarse.
    const medidas = fotoManda
      ? aplicarReferenciasMedidas(coberturaBase.plan, estado.referenceBlueprint, disponibilidadTurno)
      : { plan: coberturaBase.plan, ajustes: [] as AjusteCobertura[] };
    const cobertura = { plan: medidas.plan, ajustes: [...coberturaBase.ajustes, ...medidas.ajustes] };
    // Un color que la foto no tiene no entra al plan (2026-09-29): se poda aquí,
    // con el color REAL del producto ya resuelto por la regla 1 y antes de que
    // `aplicarColoresReferencia` cuente qué colores compra el plan. Es la mitad
    // que le faltaba a la auditoría de color, y se acota en vez de rechazarse:
    // no gasta un rechazo ni otra llamada al modelo. Si el cliente pidió colores,
    // la foto ya no es la única autoridad y no se juzga nada — la misma regla que
    // usa `coloresReferenciaOmitidosDelTurno` para el caso inverso.
    const coloresInventados = estado.restriccionesUsuario.colores.length > 0
      ? []
      : materialesDeColorInventado(cobertura.plan.estructuras, estado.referenceBlueprint);
    const podado = quitarMaterialesDeColorInventado(cobertura.plan, coloresInventados);
    if (coloresInventados.length > 0) {
      encolarEscrituraObservabilidad(auditarPlan({
        requestId: estado.ragRequestId,
        status: "PLAN_COLOR_SIN_REFERENCIA",
        error: coloresInventados.map((item) => `${item.estructura_id}:${item.color}`).join(" | "),
      }));
    }
    // Y el acabado que la foto muestra PARA ESE COLOR (2026-09-29): el blush
    // perlado de la pared "Mr & Mrs" se compró cromado y nada lo detectaba. Se
    // acota igual que el color inventado —el producto del mismo color en el
    // acabado de la foto, si la búsqueda del turno lo tiene— y si el catálogo no
    // lo ofrece se deja el que hay con aviso, nunca se quita el color. Un
    // acabado que el cliente pidió manda sobre la foto, como con los colores.
    const acabadoReferencia = estado.restriccionesUsuario.acabados.length > 0
      ? { plan: podado.plan, ajustes: [] as AjusteCobertura[] }
      : aplicarAcabadoReferencia(podado.plan, acabadosObservadosDeMateriales(podado.plan.estructuras, estado.referenceBlueprint), disponibilidadTurno);
    estado.ajustesCobertura = [...cobertura.ajustes, ...podado.ajustes, ...acabadoReferencia.ajustes];
    // La oficial de cada pieza que no la declaró se sella aquí, antes de armar y de resolver: Python solo lee
    // `estructura_oficial`, y sin ella un aro circular se armaba como arco y un techo como guirnalda
    // (`sellarEstructurasOficiales`). Va dentro del plan, así que `plan_hash` la cubre.
    let planCanonico = sellarEstructurasOficiales(sanearMarcasPlan(sanearPorquesPlan(aplicarFuenteMedidasEspacio(
      aplicarColoresReferencia(acabadoReferencia.plan, estado.referenceBlueprint),
      clienteDioMedidasEspacio(estado.solicitudOriginal),
    ))));
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
    // Piezas SIEMPRE individuales en la guiada (regla del dueño, 2026-10-06): una estructura con repeticiones N pasa a
    // N piezas («Columna izquierda» y «Columna derecha») ANTES de resolver; Python cuenta N piezas de 1 en vez de 1 de N.
    // Va después de los validadores de rango y de restricciones, que cuentan lo que escribió el modelo, así que no
    // aparecen rechazos nuevos; la cobertura de la foto, las unidades, los armados y Python ya ven piezas individuales.
    if (options.piezasIndividuales) {
      const separado = separarEstructurasRepetidas(planCanonico, estado.referenceBlueprint);
      const deLaEntrada = planCanonico.estructuras.map((estructura) => ({ id: estructura.estructura_id, oficial: estructura.estructura_oficial ?? null, repeticiones: estructura.repeticiones, ubicacion: estructura.ubicacion, nombre: estructura.nombre, referencia: estructura.referencia_element_id ?? null }));
      const cambia = separado.separadas.length > 0 || separado.renombradas.length > 0;
      const valido = cambia ? PlanDecoracionSchema.safeParse(separado.plan) : null;
      if (valido?.success) {
        // Cada copia materializa su propio elemento de la foto: sus colores son los de ese elemento.
        planCanonico = separado.separadas.length ? aplicarColoresReferencia(valido.data, estado.referenceBlueprint) : valido.data;
        for (const { origen, nuevas } of separado.separadas) {
          const armado = estado.armadosEstructura?.get(origen);
          if (armado) for (const id of nuevas) estado.armadosEstructura!.set(id, armado);
        }
      }
      // Se registra siempre (también «sin cambios»: el modelo ya escribió piezas individuales con su nombre).
      decidir("regla:piezas_individuales", "piezas individuales: separar repeticiones y nombrar cada pieza", valido && !valido.success
        ? { aplicado: false, errores: valido.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) }
        : { aplicado: cambia, separadas: separado.separadas, renombradas: separado.renombradas, sinSeparar: separado.sinSeparar }, {
        entrada: { estructuras: deLaEntrada },
        ...(valido && !valido.success ? { motivo: "el plan separado no pasa el esquema: se resuelve como lo escribió el modelo" } : cambia ? {} : { motivo: "sin cambios: cada pieza ya era individual y con su nombre" }),
      });
      // Parejas simétricas (la instrucción de la guiada las declara, `lineaPareja`): la izquierda y la derecha de una
      // misma línea de la propuesta llevan los mismos materiales y medidas aunque el modelo las haya repartido distinto.
      const parejas = parejasDeInstruccion(estado.solicitudOriginal);
      if (parejas.length) {
        const piezasAntes = planCanonico.estructuras.filter((estructura) => parejas.some((pareja) => pareja.includes(estructura.estructura_id))).map((estructura) => ({ id: estructura.estructura_id, ubicacion: estructura.ubicacion, medidas: estructura.medidas, materiales: estructura.materiales.map((material) => `${material.color ?? "?"} ${material.product_id} ${material.participacion}`) }));
        const igualado = igualarParejas(planCanonico, parejas);
        const validoParejas = igualado.igualadas.length ? PlanDecoracionSchema.safeParse(igualado.plan) : null;
        if (validoParejas?.success) planCanonico = validoParejas.data;
        decidir("regla:pareja_simetrica", "las dos piezas de una pareja (izquierda y derecha) llevan los mismos materiales y medidas", validoParejas && !validoParejas.success
          ? { aplicado: false, errores: validoParejas.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) }
          : { aplicado: igualado.igualadas.length > 0, igualadas: igualado.igualadas, noIgualadas: igualado.noIgualadas }, {
          entrada: { parejas, piezas: piezasAntes },
          ...(validoParejas && !validoParejas.success ? { motivo: "la pareja igualada no pasa el esquema: se resuelve como lo escribió el modelo" } : igualado.igualadas.length ? {} : { motivo: "la pareja ya era igual o no se puede igualar sin quitar colores" }),
        });
      }
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
        accion_requerida: `Para cada elemento sin cubrir: ${comoCubrirElementosReferencia(elementosSinCubrir, estado.referenceBlueprint).join(" ")} No anuncies ni generes esta imagen hasta cubrir todos.`,
        mensaje_cliente: MENSAJE_CLIENTE_REFERENCIA,
      };
    }
    const coloresOmitidos = await coloresReferenciaOmitidosDelTurno(planCanonico, estado, ragPool);
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
    // ADR-0032: y el de las guirnaldas, detrás de GUIRNALDAS_ARMADO_V1 (solo receta hasta E4).
    const completarArmadosGuirnalda = featureEnabled("GUIRNALDAS_ARMADO_V1");
    // ADR-0031: el conteo de globos de la foto, detrás de CONTEO_REFERENCIA_V1.
    // Sin conteos leídos no hay nada que ajustar y la petición es la de siempre.
    const completarConteos = featureEnabled("CONTEO_REFERENCIA_V1");
    // ADR-0031, revisión 33: las medidas que el cliente dio para una pieza no las mueve la foto.
    const medidasDelCliente = completarConteos && clienteDioMedidasEspacio(estado.solicitudOriginal);
    // ADR-0034 §5: y el armado del arco y de la columna con el motor del
    // diseñador, detrás de ARMADO_ARCO_COLUMNA_V1 (encendida fuera de
    // producción). Apagada, un `armado_arco` o `armado_columna` que el modelo
    // haya puesto en los argumentos se descarta antes de resolver: la salida
    // del modelo no escribe en el plan un campo de una capacidad apagada.
    const armadoMotor = featureEnabled("ARMADO_ARCO_COLUMNA_V1");
    /**
     * El armado de cada arco y cada columna del plan, decidido por Python: el
     * que el modelo armó con `armar_estructura` si se sostiene contra la pieza
     * de verdad, y si no la receta del motor. Se pide antes de resolver y se
     * escribe en el plan, así que lo que Python cuenta y firma es el plan con
     * su armado dentro.
     *
     * Su sitio natural es la resolución, al lado de
     * `completar_armados_guirnalda`; está aquí mientras `plan.py` cambia por
     * el conteo con motor del ADR-0034, y el dueño de la receta sigue siendo
     * Python en los dos casos.
     *
     * **Un fallo de esta llamada no tumba la confirmación.** El armado
     * enriquece una propuesta, no la autoriza: un plan válido se confirma
     * igual, por el camino de siempre y sin armado, que es exactamente lo que
     * pasa con la bandera apagada. Es el mismo criterio que `plan.py`, donde
     * `_completar_armados_guirnalda` deja sin armado la pieza que no se puede
     * arreglar y solo es duro resolver un armado que la pieza YA declara. El
     * respaldo es deliberado, así que se anota con su propio estado
     * (`ARMADO_MOTOR_NO_DISPONIBLE`) y está probado en
     * `scripts/test/test-armado-estructura-ia.ts`.
     *
     * Lo que sí se cae con el motor es el armado que el modelo propuso: sin la
     * puerta que lo valide contra la pieza, `sinArmadosDeMotor` lo quita antes
     * de resolver. La salida del modelo no entra en el plan sin pasar por
     * Python, ni cuando Python no está.
     */
    const conArmadosDeMotor = async (plan: PlanDecoracion): Promise<PlanDecoracion> => {
      if (!armadoMotor) return sinArmadosDeMotor(plan);
      if (!plan.estructuras.some((estructura) => (TIPOS_ARMADO_MOTOR as readonly string[]).includes(estructura.tipo))) return sinColumnaOrganicaDelModelo(plan);
      const armados = [...(estado.armadosEstructura ?? new Map())].map(([estructura_id, armado]) => ({ estructura_id, ...armado }));
      try {
        // Lo que la foto leyó del patrón de cada pieza (ADR-0039). No lo gobierna `PATRONES_COLOR_V1`,
        // que decide si Python escribe `patron_color` al confirmar: aquí la lectura o está en el blueprint
        // del turno o no está, y sin ella la receta es la de siempre.
        const pistas = pistasPatronDelPlan(plan, estado.referenceBlueprint);
        const remates = pistasRemateDelPlan(plan, estado.referenceBlueprint);
        const inclinaciones = pistasInclinacionDelPlan(plan, estado.referenceBlueprint);
        const curvas = pistasCurvaDelPlan(plan, estado.referenceBlueprint);
        // Los tamaños viajan aquí además de a la resolución: el motor arma ANTES de que el plan se
        // resuelva, así que con la lectura llegando solo a `plan.py` la pieza salía dibujada con la mezcla
        // declarada y cobrada con la leída. Las dos ramas la traducen con la misma función de Python.
        const tamanosLeidos = pistasTamanosDelPlan(plan, estado.referenceBlueprint);
        const respuesta = await llamarPythonOmoikaneCompletarArmados({
          plan,
          ...(armados.length > 0 ? { armados } : {}),
          ...(pistas.length > 0 ? { pistas } : {}),
          ...(remates.length > 0 ? { remates } : {}),
          ...(inclinaciones.length > 0 ? { inclinaciones } : {}),
          ...(curvas.length > 0 ? { curvas } : {}),
          ...(tamanosLeidos.length > 0 ? { tamanosLeidos } : {}),
          requestId: estado.ragRequestId,
          correlationId: correlacionPython.success ? correlacionPython.data : estado.ragRequestId,
          ...(options.signal ? { parentSignal: options.signal } : {}),
        });
        // Diagnóstico (ids y origen, nunca el armado entero): de dónde salió el armado de cada pieza.
        console.info("[plan] armados de motor", JSON.stringify({ request_id: estado.ragRequestId, armados: respuesta.armados.map((completado) => ({ id: completado.estructura_id, tipo: completado.tipo, origen: completado.origen, avisos: completado.avisos.length })) }));
        // Primero se quita lo que el modelo haya escrito (ninguna herramienta compone una columna orgánica),
        // y DESPUÉS se aplica lo que Python decidió: al revés se borraba la columna orgánica que la propia
        // receta acababa de armar, y la pieza volvía a salir con anillos.
        return aplicarArmadosCompletados(sinColumnaOrganicaDelModelo(plan), respuesta.armados);
      } catch (error) {
        // No es `BACKEND_NO_DISPONIBLE`: la resolución sí está disponible y el
        // plan se confirma igual, solo sin armado. Queda registrado aparte para
        // poder medir cuántas veces pasa.
        encolarEscrituraObservabilidad(auditarPlan({
          requestId: estado.ragRequestId,
          status: "ARMADO_MOTOR_NO_DISPONIBLE",
          error: error instanceof Error ? error.message : String(error),
        }));
        return sinArmadosDeMotor(plan);
      }
    };
    const resolverPlanDelTurno = (plan: PlanDecoracion) => {
      const blueprint = estado.referenceBlueprint;
      const elementos = new Map(blueprint?.elements.filter((elemento) => elemento.approved).map((elemento) => [elemento.element_id, elemento]) ?? []);
      const proporciones = new Map(blueprint?.source_images.map((imagen) => [imagen.image_id, imagen.aspect_ratio]).filter((entrada): entrada is [string, number] => entrada[1] !== undefined) ?? []);
      const pistasGeometria = new Map<string, PistaGeometria>();
      for (const estructura of plan.estructuras) {
        const id = estructura.referencia_element_id;
        const elemento = id ? elementos.get(id) : undefined;
        const aspectRatio = elemento ? proporciones.get(elemento.source_image_id) : undefined;
        if (!id || !elemento || pistasGeometria.has(id)) continue;
        pistasGeometria.set(id, {
          referencia_element_id: id,
          source_image_id: elemento.source_image_id,
          caja: { ...elemento.reference_bbox },
          ...(aspectRatio === undefined ? {} : { aspect_ratio: aspectRatio }),
          confianza: elemento.detection_confidence,
        });
      }
      const pistasPatron = completarPatrones ? pistasPatronDelPlan(plan, estado.referenceBlueprint) : [];
      const pistasArmado = completarArmados ? pistasArmadoDelPlan(plan, estado.referenceBlueprint) : [];
      const pistasGuirnalda = completarArmadosGuirnalda ? pistasGuirnaldaDelPlan(plan, estado.referenceBlueprint) : [];
      const pistasConteo = completarConteos ? pistasConteoDelPlan(plan, estado.referenceBlueprint) : [];
      // Los tamaños **no** van con `completarPatrones`, que decide si Python escribe `patron_color`:
      // un tamaño no es una disposición de color y la pieza que los motivó —una columna de un solo
      // color— no deja patrón ninguno. Misma regla que el remate, la inclinación y la curva en
      // `conArmadosDeMotor` (ADR-0039): la lectura está en el blueprint del turno o no está, y sin ella
      // la mezcla es la que el plan declaró. Atarlos a esa bandera, que está apagada por defecto, dejó
      // la lectura entera sin llegar nunca al motor (2026-10-03).
      const pistasTamanos = pistasTamanosDelPlan(plan, estado.referenceBlueprint);
      // Diagnóstico (ids y conteos, nunca la foto): qué lecturas de la foto viajan con la confirmación.
      // El del patrón dice por qué una pieza salió con el preset en vez de con la foto: el
      // preset de una pared es confeti y el de la pista también, así que el patrón resuelto no
      // distingue las dos ramas (ADR-0028 §7). Cada campo descarta una causa: `referencia` nula
      // (la pieza no materializa ningún elemento, la pista nunca puede casar), `materiales` < 2
      // (no lleva patrón), `patron_declarado` (ya traía uno y no se sugiere otro), y en las
      // pistas el `modo` (uno que el tipo no admite se descarta) y la `confianza` (< 0,5 se
      // descarta). Sin esto la caída de la pista al preset era invisible.
      if (completarPatrones) console.info("[plan] pistas de patrón", JSON.stringify({ request_id: estado.ragRequestId, estructuras: plan.estructuras.map((estructura) => ({ id: estructura.estructura_id, tipo: estructura.tipo, referencia: estructura.referencia_element_id ?? null, materiales: estructura.materiales.length, patron_declarado: estructura.patron_color !== undefined })), pistas: pistasPatron.map((pista) => ({ referencia: pista.referencia_element_id, modo: pista.modo, confianza: pista.confianza, colores: pista.colores, zonas: pista.zonas?.length ?? null })) }));
      if (completarArmados) console.info("[plan] pistas de armado", JSON.stringify({ request_id: estado.ragRequestId, bouquets: plan.estructuras.filter((estructura) => estructura.estructura_oficial === "bouquet").map((estructura) => ({ id: estructura.estructura_id, referencia: estructura.referencia_element_id ?? null, unidades: estructura.unidades_declaradas ?? null })), pistas: pistasArmado.map((pista) => ({ referencia: pista.referencia_element_id, confianza: pista.confianza, numeros: pista.numeros?.map((numero) => numero.digito).join("") ?? null })) }));
      return resolverPlan({
        plan,
        allowlist: allowlistTurno,
        catalogSnapshotId: snapshotTurno,
        ...(completarPatrones ? { completarPatrones } : {}),
        ...(pistasPatron.length > 0 ? { pistasPatron } : {}),
        ...(pistasTamanos.length > 0 ? { pistasTamanos } : {}),
        ...(completarArmados ? { completarArmados } : {}),
        ...(pistasArmado.length > 0 ? { pistasArmado } : {}),
        ...(completarArmadosGuirnalda ? { completarArmadosGuirnalda } : {}),
        ...(pistasGuirnalda.length > 0 ? { pistasGuirnalda } : {}),
        ...(pistasConteo.length > 0 ? { completarConteos: true, pistasConteo } : {}),
        ...(pistasGeometria.size > 0 ? { pistasGeometria: [...pistasGeometria.values()] } : {}),
        ...(pistasGeometria.size > 0 ? { medidasClienteDe: estructurasMedidasPorCliente(plan.estructuras, estado.solicitudOriginal) } : {}),
        ...(pistasGeometria.size > 0 && medidasDelCliente ? { medidasDelCliente: true } : {}),
        requestId: estado.ragRequestId,
        correlationId: correlacionPython.success ? correlacionPython.data : estado.ragRequestId,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    };
    let resolucion: ResolucionPlan;
    const avisosConvergencia: string[] = [];
    try {
      planCanonico = await conArmadosDeMotor(planCanonico);
      resolucion = await resolverPlanDelTurno(planCanonico);
      // La talla del globo de la punta la pone el motor, no el modelo: ningún reintento la arregla, así que no se
      // espera a la convergencia. El Python nuevo ya la sirve con la talla más cercana del mismo producto; esto es
      // para el de producción anterior al 36 en la escalera (`sinCoronaSinCobertura`, banco de fotos 04).
      if (resolucion.resuelto.sin_cobertura.length > 0) {
        const sinCorona = sinCoronaSinCobertura(planCanonico, resolucion.resuelto.sin_cobertura);
        if (sinCorona.cambiado) {
          const reintento = await resolverPlanDelTurno(sinCorona.plan);
          const mejora = reintento.resuelto.sin_cobertura.length < resolucion.resuelto.sin_cobertura.length;
          decidir("regla:corona_sin_talla", "globo de la punta en una talla que el producto no tiene: la columna va sin él", { aplicado: mejora, avisos: sinCorona.avisos }, {
            entrada: { sin_cobertura: resolucion.resuelto.sin_cobertura },
            ...(mejora ? {} : { motivo: "quitarlo no cubrió más tallas: se responde SIN_COBERTURA como antes" }),
          });
          if (mejora) {
            planCanonico = sinCorona.plan;
            resolucion = reintento;
            avisosConvergencia.push(...sinCorona.avisos);
          }
        }
      }
      // Convergence: after repeated refusals the materials without size
      // coverage leave the structure (with a notice) instead of another
      // SIN_COBERTURA refusal (convergencia-plan.ts).
      if (estado.rechazosPlan >= RECHAZOS_PARA_CONVERGER && resolucion.resuelto.sin_cobertura.length > 0) {
        const reparado = quitarMaterialesSinCobertura(planCanonico, resolucion.resuelto.sin_cobertura);
        if (reparado.cambiado) {
          // Quitar un material corre los índices de la pieza, así que su
          // armado se vuelve a decidir sobre la pieza nueva: con un índice que
          // ya no existe no se sostendría, y Python lo cambia por la receta.
          const conArmado = await conArmadosDeMotor(reparado.plan);
          const reintento = await resolverPlanDelTurno(conArmado);
          if (reintento.resuelto.sin_cobertura.length === 0 && reintento.resuelto.compras.length > 0) {
            planCanonico = conArmado;
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
      // Una pieza que cuenta el motor (trae su armado) no cambia de total con las medidas, la densidad ni la
      // mezcla: si es la que la puerta física señala, mandar al modelo a tocarlas repite el mismo plan.
      const piezasConArmadoDelMotor = resuelto.plan.estructuras
        .filter((estructura) => (TIPOS_ARMADO_MOTOR as readonly string[]).includes(estructura.tipo)
          && (estructura as Record<string, unknown>)[CLAVE_ARMADO[estructura.tipo as TipoArmadoMotor]] !== undefined
          && physicalWarnings.some((aviso) => aviso.includes(estructura.estructura_id)))
        .map((estructura) => estructura.estructura_id);
      auditarResuelto("ESTIMACION_INCONSISTENTE", error);
      encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, "aclaracion", Date.now() - planningStart));
      return {
        ok: false,
        status: "ESTIMACION_INCONSISTENTE",
        advertencias: [...new Set([...estimateValidation.warnings, ...physicalWarnings])],
        accion_requerida: accionEstimacionInconsistente(piezasConArmadoDelMotor),
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
    enriquecerPlanResueltoEvento(resuelto, intentoDelPlan, estado.ragEventEvidence ?? new Map(), estado.ragEventRelaxations ?? []);
    resuelto.approval_token = crearTokenPlan({
      planHash: resuelto.plan_hash,
      requestId: estado.ragRequestId,
      backend: "python",
      catalogSnapshotId: snapshotTurno,
      allowlist: allowlistTurno,
      // The image of this plan is generated with the level it was designed with.
      creatividad: perfilCreatividad(options.creatividad).nivel,
      // An edit has no customer text: it reads this to keep those measures fixed (revisión 33).
      ...(medidasDelCliente ? { medidasDelCliente: true } : {}),
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
    // Una talla que la pieza no pide en su mezcla (el R-36 del globo de la punta que pone el motor) y que se compró
    // con la más cercana del mismo producto: se le dice al cliente (banco de fotos 04). Las sustituciones de las
    // tallas de la mezcla ya las enseña la tarjeta del plan y no se repiten aquí.
    const tallasDeLaMezcla = new Map(planCanonico.estructuras.map((estructura) => [estructura.estructura_id, new Set(pulgadasDeMezcla(estructura.mezcla).map((pulgadas) => `R-${pulgadas}`))]));
    const tallasFueraDeMezcla = resuelto.sustituciones.filter((item) => !esSustitucionDeColor(item) && /^R-\d+$/.test(item.pedido) && tallasDeLaMezcla.get(item.estructura_id)?.has(item.pedido) === false);
    const avisosTalla = sustitucionesCliente(tallasFueraDeMezcla, new Map(planCanonico.estructuras.map((estructura) => [estructura.estructura_id, estructura.nombre.toLowerCase()])));
    if (tallasFueraDeMezcla.length > 0) {
      decidir("regla:talla_mas_cercana", "talla que el producto no tiene servida con la más cercana del mismo producto", tallasFueraDeMezcla, { motivo: "se avisa al cliente en vez de rechazar el plan" });
    }
    const avisosCliente = [...new Set([
      ...avisosTalla,
      ...estado.ajustesCobertura.flatMap((ajuste) => (ajuste.tipo === "material_quitado" ? [ajuste.aviso_cliente] : [])),
      ...avisosClienteAjustes(estado.ajustesCobertura, {
        nombres: new Map(planCanonico.estructuras.map((estructura) => [estructura.estructura_id, estructura.nombre])),
        coloresReportados: sustitucionesDeColor.map((item) => ({ estructura_id: item.estructura_id, color: item.pedido })),
        coloresDelCliente: estado.restriccionesUsuario.colores.map((color) => color.valor),
        // También el producto NUEVO de un cambio de producto (`productosDelAjuste`): el aviso de un color que
        // cambió por el globo medido en la foto habla de ese, y la convergencia pudo sacarlo después.
        materialesFuera: estado.ajustesCobertura.flatMap((ajuste) => productosDelAjuste(ajuste)
          .filter((productId) => !materialesEnPlan.has(`${ajuste.estructura_id}|${productId}`))
          .map((productId) => ({ estructura_id: ajuste.estructura_id, product_id: productId }))),
      }),
      ...avisosConvergencia,
      ...sustitucionesDeColor.map((item) => item.motivo),
    ])];
    auditarResuelto(estadoAuditoria);
    encolarEscrituraObservabilidad(actualizarResultadoBusqueda(ragPool, estado.ragRequestId, resuelto.estructuras.length ? "plan_confirmado" : "NO_MATCH", Date.now() - planningStart));
    const { advertencias, notasReparto } = separarNotasReparto(resuelto.advertencias);
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
        // La tarjeta solo enseña lo que viaja firmado en el plan (`sustituciones`): los colores de la foto que la
        // propuesta no lleva. Los ajustes del servidor (un globo cambiado por el medido en la foto, quitado o
        // con otro acabado) solo le llegan al cliente por el resumen del modelo.
        ? { accion_requerida: "avisos_cliente trae colores de la foto o globos que la propuesta no incluye, y los ajustes de color o acabado que el sistema le hizo al plan que confirmaste. La tarjeta de la propuesta solo le muestra al cliente los colores de la foto que la propuesta no lleva; los ajustes (un globo que cambió de color o de acabado, o que se quitó) solo los sabrá por ti. No los enumeres uno por uno: menciónalos en una sola frase de tu resumen, con tus palabras (no afirmes que el catálogo no tiene un color), y ofrece buscar esos colores si quiere acercarse más a la foto." }
        : {}),
      sin_cobertura: resuelto.sin_cobertura,
      advertencias,
      // Cómo quedó el reparto de color que arma el motor o el patrón: para que el modelo lo explique, no
      // para que rehaga el plan (prompt-sistema.ts, CÓMO HABLAS DE LO INTERNO).
      ...(notasReparto.length ? { notas_reparto: notasReparto } : {}),
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
        catalogSnapshotId: estado.ragCatalogSnapshotId,
        coloresContexto,
        // «celeste» sin otro azul (del cliente o de esta búsqueda): de los azules solo vuelven los celestes (tonos-color.ts).
        tonos: [...new Set([...tonosExclusivos(estado.solicitudOriginal), ...tonosExclusivos(mensaje)])],
        rerankRequestId: estado.ragRequestId,
        rerankCorrelationId: options.correlationId ?? estado.ragRequestId,
        rerankSignal: options.signal,
      });
      console.info("[chat] busqueda", JSON.stringify({ request_id: estado.ragRequestId, mensaje: mensaje.slice(0, 200), filtrosDuros, relajado: respuesta.filtroRelajado ?? null, titulos: respuesta.candidatos.slice(0, 8).map((candidato) => candidato.titulo) }).slice(0, 1500));
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
      // Un color de la foto solo lo cubre un globo LISO de ese color (`familiaDeTitulo`): un impreso no es un
      // globo dorado para armar una pieza. Sin embeddings, la búsqueda léxica pone primero los impresos —repiten
      // el color en el título («2 Caras Copa Dorada Reflex Dorado»)— y el arco de la foto 1 de las pruebas del
      // 2026-10-05 se armó con copas impresas; contándolos como cubiertos, la pista del liso no salía nunca.
      const lisos = respuesta.candidatos.filter((candidato) => familiaDeTitulo(candidato.titulo) !== null);
      const coloresFotoSinCubrir = coloresContexto.length > 0 ? coloresSinCubrir(coloresContexto, lisos) : [];
      if (coloresFotoSinCubrir.length > 0) estado.ragColoresFotoSinCubrir = [...new Set([...(estado.ragColoresFotoSinCubrir ?? []), ...coloresFotoSinCubrir])];
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
          const porDigito = await buscarNumerosPorDigito(pool, digitosSinFigura, { catalogSnapshotId: estado.ragCatalogSnapshotId ?? null });
          numerosEnCatalogo = digitosSinFigura.map((digito) => ({ digito, disponibles: porDigito.get(digito) ?? [] }));
        } catch (error) {
          console.warn("[rag] no se pudo consultar globos de número por dígito", { requestId: estado.ragRequestId, error: error instanceof Error ? error.message : String(error) });
        }
      }

      // Un color de la foto que esta búsqueda no cubrió: decirle al modelo qué
      // globos del catálogo activo sí lo tienen, como ya se hace con los dígitos
      // de número. Hasta 2026-09-29 solo se registraba en
      // `ragColoresFotoSinCubrir` y el modelo no se enteraba: el plan salía sin
      // ese color y, con él, se caía entero el patrón leído en la foto
      // (`patron_desde_pista` devuelve None si un color no tiene material).
      let coloresEnCatalogo: Array<{ color: string; disponibles: Array<{ product_id: string; titulo: string }> }> = [];
      if (coloresFotoSinCubrir.length > 0) {
        try {
          const porColor = await buscarGlobosPorColor(pool, coloresFotoSinCubrir, { catalogSnapshotId: estado.ragCatalogSnapshotId ?? null });
          coloresEnCatalogo = coloresFotoSinCubrir.map((color) => ({
            color,
            disponibles: (porColor.get(color) ?? []).slice(0, 3).map((producto) => ({ product_id: producto.product_id, titulo: producto.titulo })),
          }));
        } catch (error) {
          console.warn("[rag] no se pudo consultar globos por color de la foto", { requestId: estado.ragRequestId, error: error instanceof Error ? error.message : String(error) });
        }
      }

      return {
        status: respuesta.status,
        sku_status: respuesta.skuStatus,
        filtro_relajado: respuesta.filtroRelajado,
        ...(numerosEnCatalogo.length ? { numeros_en_catalogo: numerosEnCatalogo, accion_numeros: ACCION_NUMEROS_EN_CATALOGO } : {}),
        ...(coloresEnCatalogo.length ? { colores_en_catalogo: coloresEnCatalogo, accion_colores: ACCION_COLORES_EN_CATALOGO } : {}),
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

    /**
     * El catálogo de armado del motor del diseñador (ADR-0034 §5): los catorce
     * patrones del arco o los nueve de la columna, con sus mandos, rangos y
     * mínimos de color. Es una consulta: no toca el plan, el catálogo de
     * productos ni el estado del turno. La lista la publica Python desde el
     * motor; aquí no hay ni un nombre de patrón escrito a mano.
     */
    consultar_opciones_armado: async (args) => {
      const parseado = ArgsConsultarOpcionesArmadoSchema.safeParse(args);
      if (!parseado.success) {
        return {
          ok: false,
          status: "ARGUMENTOS_INVALIDOS",
          errores: erroresDeArgs(parseado.error, "consulta"),
          accion_requerida: `Llama consultar_opciones_armado con tipo igual a ${TIPOS_ARMADO_MOTOR.join(" o ")}.`,
        };
      }
      try {
        const { catalogo } = await llamarPythonOmoikaneCatalogoArmado({
          tipo: parseado.data.tipo,
          requestId: estado.ragRequestId,
          correlationId: options.correlationId ?? estado.ragRequestId,
          ...(options.signal ? { parentSignal: options.signal } : {}),
        });
        return {
          ok: true,
          tipo: catalogo.tipo,
          opciones: catalogo.opciones,
          accion_requerida: "En un arco o una columna, elige un patrón cuyo min_colores y max_colores quepan en los colores de la pieza y llama armar_estructura con su id y, si quieres, sus mandos. En una guirnalda no hay patrón: llama armar_estructura con su paleta (un color por material, con su acabado y su papel) y, si quieres, su reparto, su forma y su mezcla de tamaños. No le describas al cliente nombres de patrón, acabados internos ni mandos: háblale de cómo se verá.",
        };
      } catch (error) {
        // El modelo no puede corregir que el motor no responda. No corta el
        // turno: puede seguir sin armar y el servidor pondrá la receta.
        if (isPythonAdapterError(error)) {
          return {
            ok: false,
            status: "ARMADO_NO_DISPONIBLE",
            accion_requerida: "No pude consultar las opciones de armado. Sigue con la propuesta sin armar las piezas: el sistema les pone el armado por defecto.",
          };
        }
        throw error;
      }
    },

    /**
     * Arma un arco o una columna con el motor y devuelve lo que lleva de
     * verdad, o el motivo por el que no se sostiene. Lo que valida es la
     * puerta de Python; lo que hace este handler es acotar los argumentos,
     * preferir lo que dice el plan vigente sobre lo que dice el modelo, y
     * guardar el armado que quedó validado para la confirmación.
     */
    armar_estructura: async (args) => {
      const parseado = ArgsArmarEstructuraSchema.safeParse(args);
      if (!parseado.success) {
        return {
          ok: false,
          status: "ARGUMENTOS_INVALIDOS",
          errores: erroresDeArgs(parseado.error, "armado"),
          accion_requerida: "Corrige los argumentos de armar_estructura (estructura_id, tipo y colores son siempre obligatorios; un arco o una columna necesitan además patron y materiales, y una guirnalda su paleta; los mandos del patrón van como lista de pares clave/valor) y vuelve a llamarla.",
        };
      }
      const peticion = parseado.data;
      // La pieza de la propuesta vigente manda sobre lo que diga el modelo: si
      // el turno ya tiene una, el tipo, los colores y las medidas salen de
      // ella. Sin propuesta vigente todavía no hay pieza, así que los da el
      // modelo y Python los vuelve a comprobar al confirmar.
      const delPlan = estado.planVigente ? piezaDelPlan(estado.planVigente.base.plan, peticion.estructura_id) : null;
      if (delPlan && delPlan.tipo !== peticion.tipo) {
        return {
          ok: false,
          status: "TIPO_NO_CORRESPONDE",
          accion_requerida: `La pieza ${peticion.estructura_id} de la propuesta vigente es un ${delPlan.tipo}, no un ${peticion.tipo}. Usa el tipo que tiene la pieza o arma otra.`,
        };
      }
      const pieza: PiezaArmado = delPlan ?? { tipo: peticion.tipo, colores: peticion.colores };
      // Cada tipo manda lo suyo y nada del otro: una guirnalda no tiene patrón ni mandos de patrón, y un arco
      // no tiene paleta ni festones. Lo que no corresponde al tipo se deja fuera en vez de viajar y ser
      // ignorado al otro lado, que es donde se esconden los malentendidos.
      const esGuirnalda = peticion.tipo === "guirnalda";
      const dePatron = esGuirnalda
        ? {}
        : {
            patron: peticion.patron,
            materiales: peticion.materiales,
            ...(opcionesDePares(peticion.opciones) === undefined ? {} : { opciones: opcionesDePares(peticion.opciones)! }),
            ...(peticion.geometria === undefined ? {} : { geometria: peticion.geometria }),
            ...(peticion.tipo === "columna" && peticion.remate !== undefined ? { remate: peticion.remate } : {}),
          };
      const deGuirnalda = esGuirnalda
        ? {
            paleta: peticion.paleta,
            ...(peticion.reparto === undefined ? {} : { reparto: peticion.reparto }),
            ...(peticion.forma_lista === undefined ? {} : { formaLista: peticion.forma_lista }),
            ...(peticion.estilo === undefined ? {} : { estilo: peticion.estilo }),
            ...(peticion.mezcla_colores === undefined ? {} : { mezclaColores: peticion.mezcla_colores }),
            ...(peticion.forma === undefined ? {} : { forma: peticion.forma }),
            ...(peticion.volumen === undefined ? {} : { volumen: peticion.volumen }),
            ...(peticion.tamanos === undefined ? {} : { tamanos: peticion.tamanos }),
            ...(peticion.adornos === undefined ? {} : { adornos: peticion.adornos }),
          }
        : {};
      try {
        const { armado } = await llamarPythonOmoikaneArmarEstructura({
          pieza,
          ...dePatron,
          ...deGuirnalda,
          estructuraId: peticion.estructura_id,
          requestId: estado.ragRequestId,
          correlationId: options.correlationId ?? estado.ragRequestId,
          ...(options.signal ? { parentSignal: options.signal } : {}),
        });
        // Evidencia del servidor, no del modelo: lo que entra en el plan al
        // confirmar es esto, y Python lo vuelve a validar contra la pieza de
        // verdad antes de escribirlo.
        estado.armadosEstructura ??= new Map();
        estado.armadosEstructura.set(peticion.estructura_id, { tipo: armado.tipo, armado: armado.armado });
        // Qué colores de la pieza usó el armado: en un arco o una columna son los índices del patrón, y en
        // una guirnalda los de su paleta. De ahí sale cuántos materiales tiene que llevar la pieza.
        const coloresUsados = armado.tipo === "guirnalda"
          ? armado.armado.colores.paleta.map((color) => color.material)
          : armado.armado.materiales;
        return {
          ok: true,
          status: "ARMADO_VALIDO",
          estructura_id: peticion.estructura_id,
          tipo: armado.tipo,
          // Una guirnalda orgánica no tiene patrón: lo que la describe es su reparto de color.
          ...(armado.tipo === "guirnalda"
            ? { reparto: armado.armado.colores.reparto }
            : { patron: armado.armado.patron }),
          colores_usados: coloresUsados,
          // Cuando la propuesta vigente contradice el `colores` del modelo,
          // manda la pieza y hay que decírselo: con ese número eligió el patrón.
          ...(pieza.colores === peticion.colores ? {} : { colores_de_la_pieza: pieza.colores }),
          resumen: armado.resumen,
          ...(armado.avisos.length > 0 ? { avisos: armado.avisos } : {}),
          accion_requerida: `El armado quedó guardado para ${peticion.estructura_id}: NO lo repitas en confirmar_plan_decoracion, entra solo. Esa pieza tiene que llevar en confirmar_plan_decoracion el mismo estructura_id, el mismo tipo y al menos ${Math.max(...coloresUsados) + 1} materiales. Las cantidades que le digas al cliente siguen saliendo de confirmar_plan_decoracion, no de este resumen.`,
        };
      } catch (error) {
        // `armado_invalido` es lo único que el modelo puede corregir, y llega
        // con el motivo estable del motor y su frase en español.
        if (isPythonAdapterError(error) && error.domainCode === "armado_invalido") {
          const detalles = error.domainDetails;
          encolarEscrituraObservabilidad(auditarPlan({
            requestId: estado.ragRequestId,
            status: "ARMADO_MOTOR_RECHAZADO",
            error: `${peticion.estructura_id} ${peticion.tipo}/${peticion.patron ?? "sin_patron"}: ${detalles?.motivo ?? "sin_motivo"}`,
          }));
          return {
            ok: false,
            status: "ARMADO_INVALIDO",
            ...(detalles?.motivo ? { motivo: detalles.motivo } : {}),
            ...(detalles?.mensaje ? { detalle: detalles.mensaje } : {}),
            accion_requerida: "El motor rechazó ese armado. Corrige lo que dice el motivo (usa consultar_opciones_armado para ver qué patrones, acabados o repartos hay y cuántos colores admite cada uno) y vuelve a llamar armar_estructura, o sigue sin armar esta pieza: el sistema le pondrá el armado por defecto.",
          };
        }
        if (isPythonAdapterError(error)) {
          return {
            ok: false,
            status: "ARMADO_NO_DISPONIBLE",
            accion_requerida: "No pude armar la pieza con el motor. Sigue con la propuesta sin armarla: el sistema le pone el armado por defecto.",
          };
        }
        throw error;
      }
    },

    /**
     * Estimar cuántos globos cobraría el plan (ADR-0038). De SOLO LECTURA: no
     * escribe en el estado, no toca `planResuelto`, el token ni `plan_hash`, y
     * el número que se le dice al cliente sigue saliendo de
     * `confirmar_plan_decoracion`. Este handler valida el borde, junta lo que el
     * turno ya sabe (el armado que `armar_estructura` guardó, el conteo de la
     * foto, los tamaños y las medidas del cliente) y llama a Python, que es el
     * único dueño de cada cifra; no calcula ni compara nada.
     */
    estimar_conteo_globos: async (args) => {
      if (!featureEnabled("ESTIMAR_CONTEO_V1")) {
        return {
          ok: false,
          status: "HERRAMIENTA_NO_DISPONIBLE",
          accion_requerida: "estimar_conteo_globos no está disponible. Sigue con la propuesta: el número real sale de confirmar_plan_decoracion.",
        };
      }
      const parseado = ArgsEstimarConteoGlobosSchema.safeParse(args);
      if (!parseado.success) {
        return {
          ok: false,
          status: "ARGUMENTOS_INVALIDOS",
          errores: erroresDeEstimacion(parseado.error),
          accion_requerida: "Corrige los argumentos de estimar_conteo_globos (de 1 a 6 candidatos con etiqueta única, tipo, densidad y mezcla; las medidas son opcionales y, si faltan, se asumen las de por defecto como al confirmar; el objetivo, si lo mandas, lleva un conteo entero positivo) y vuelve a llamarla.",
        };
      }
      const pedido = parseado.data;
      // El objetivo del modelo manda; sin él, el conteo leído en la foto (la regla de confianza y bandera es la
      // del prompt: una lectura que el modelo no vio no es un objetivo).
      let objetivo: ObjetivoDeLaEstimacion | undefined = pedido.objetivo === undefined
        ? undefined
        : { conteo: pedido.objetivo.conteo, exacto: pedido.objetivo.exacto ?? false, origen: "modelo" };
      let objetivoAmbiguo: string[] | undefined;
      if (objetivo === undefined) {
        const delaFoto = objetivoDeLaFoto(estado.referenceBlueprint, pedido.referencia_element_id);
        if (delaFoto && "objetivo" in delaFoto) objetivo = delaFoto.objetivo;
        else if (delaFoto) objetivoAmbiguo = delaFoto.ambiguo;
      }
      const armada = solicitudDeEstimacion(pedido, {
        armados: estado.armadosEstructura,
        objetivo,
        tamanosObligatorios: tamanosObligatorios(estado.restriccionesUsuario),
        medidasDelCliente: clienteDioMedidasEspacio(estado.solicitudOriginal),
      });
      if ("armadoNoResuelto" in armada) {
        const { estructura_id: estructuraId, motivo } = armada.armadoNoResuelto;
        return {
          ok: false,
          status: motivo === "no_guardado" ? "ARMADO_NO_ENCONTRADO" : "ARMADO_NO_CORRESPONDE",
          estructura_id: estructuraId,
          accion_requerida: motivo === "no_guardado"
            ? `No hay un armado guardado para ${estructuraId} en este turno. Arma la pieza con armar_estructura primero, o quita armado_de para estimarla con la fórmula.`
            : `El armado guardado para ${estructuraId} es de otro tipo de pieza que el candidato. Usa el mismo tipo o quita armado_de.`,
        };
      }
      // La pregunta completa contra el contrato, antes de salir: lo que Python rechazaría por la forma se le dice
      // al modelo aquí, con el campo, en vez de volver como «no disponible».
      const contrato = EstimarConteoRequestV1Schema.safeParse({ schema_version: "estimar-conteo.v1", ...armada.solicitud });
      if (!contrato.success) {
        return {
          ok: false,
          status: "ARGUMENTOS_INVALIDOS",
          errores: erroresDeEstimacion(contrato.error),
          accion_requerida: "Corrige esos campos de estimar_conteo_globos y vuelve a llamarla, o sigue sin estimar: confirmar_plan_decoracion da el número real.",
        };
      }
      try {
        const resultado = await llamarPythonEstimarConteo({
          solicitud: armada.solicitud,
          requestId: estado.ragRequestId,
          correlationId: options.correlationId ?? estado.ragRequestId,
          ...(options.signal ? { parentSignal: options.signal } : {}),
        });
        return {
          ok: true,
          status: "ESTIMACION",
          origen_objetivo: objetivo?.origen ?? "ninguno",
          ...(objetivo?.elemento === undefined ? {} : { elemento_objetivo: objetivo.elemento }),
          ...(objetivoAmbiguo === undefined ? {} : { elementos_con_conteo: objetivoAmbiguo }),
          objetivo: resultado.objetivo,
          candidatos: resultado.candidatos,
          mejor: resultado.mejor,
          accion_requerida: `${objetivoAmbiguo === undefined ? "" : "La foto trae conteos de varios elementos y no elegiste cuál: manda referencia_element_id u objetivo para comparar contra uno. "}Esto es una ESTIMACIÓN de solo lectura: no cambió el plan, no fijó estado ni token y no cobra nada. ${resultado.objetivo === null ? "Compara los candidatos por su total_vigente y su puerta_fisica." : "Elige el candidato con brecha.dentro_de_tolerancia y sin avisos en puerta_fisica (mejor es el más cercano que cumple ambas)."} Lee la nota de cada pieza con armado: su densidad, su mezcla y sus medidas NO mueven un total que sale del motor; la sugerencia indica qué mando del armado mover. Luego arma (armar_estructura) y confirma (confirmar_plan_decoracion) con ese candidato. El número que le digas al cliente sale SIEMPRE de confirmar_plan_decoracion, nunca de esta estimación.`,
        };
      } catch (error) {
        // `candidato_invalido` y `armado_invalido` son lo único que el modelo puede corregir, con el motivo
        // estable de Python y su frase.
        if (isPythonAdapterError(error) && (error.domainCode === "candidato_invalido" || error.domainCode === "armado_invalido")) {
          const detalles = error.domainDetails;
          return {
            ok: false,
            status: error.domainCode === "candidato_invalido" ? "CANDIDATO_INVALIDO" : "ARMADO_INVALIDO",
            ...(detalles?.estructuraId ? { candidato: detalles.estructuraId } : {}),
            ...(detalles?.motivo ? { motivo: detalles.motivo } : {}),
            ...(detalles?.mensaje ? { detalle: detalles.mensaje } : {}),
            accion_requerida: "Corrige ese candidato (etiquetas distintas, y un armado que corresponda a su tipo y a sus colores) y vuelve a llamar estimar_conteo_globos, o sigue sin estimar: confirmar_plan_decoracion da el número real.",
          };
        }
        // Otra estimación está corriendo: la ruta no hace cola detrás de la resolución. Es reintentable.
        if (isPythonAdapterError(error) && error.domainCode === "estimacion_ocupada") {
          return {
            ok: false,
            status: "ESTIMACION_OCUPADA",
            reintentable: true,
            accion_requerida: "Hay otra estimación en curso. Espera unos segundos y vuelve a llamar estimar_conteo_globos una vez; si sigue ocupada, sigue sin estimar: confirmar_plan_decoracion da el número real.",
          };
        }
        // Python rechazó la forma de la pregunta aunque Zod la aceptó (el contrato derivó): es de los argumentos, no de la disponibilidad.
        if (isPythonAdapterError(error) && error.domainCode === "invalid_request") {
          return {
            ok: false,
            status: "ARGUMENTOS_INVALIDOS",
            errores: ["La pregunta no cumple estimar-conteo.v1 (coherencia de la estructura oficial con su tipo y densidad, medidas finitas y positivas, un objetivo entero positivo)."],
            accion_requerida: "Corrige los candidatos (que la estructura oficial corresponda al tipo y a la densidad, y que las medidas sean números positivos) y vuelve a llamarla una vez, o sigue sin estimar.",
          };
        }
        if (isPythonAdapterError(error)) {
          return {
            ok: false,
            status: "ESTIMACION_NO_DISPONIBLE",
            accion_requerida: "No pude estimar el conteo ahora. Sigue sin estimarlo: el número real sale de confirmar_plan_decoracion.",
          };
        }
        throw error;
      }
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
      // Sin esto el motivo del rechazo solo lo veía el modelo y en producción no había forma de depurarlo (2026-10-06).
      console.warn("[plan] confirmar rechazado", JSON.stringify({ request_id: estado.ragRequestId, rechazo: estado.rechazosPlan + 1, respuesta, args }).slice(0, 6000));
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
     *
     * Una edición suelta (la forma original) o `ediciones` (1 a 8): se aplican
     * en orden, cada una sobre el plan que firmó la anterior, y de forma
     * atómica: `estado.planResuelto` solo cambia si TODAS se aplicaron. Cada
     * edición conserva las comprobaciones de siempre (variante de este turno,
     * allowlist del modo LoRA, rechazos de Python → `mensaje_cliente`).
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
      const lectura = leerEdicionesChat(args);
      if (!lectura.ok) {
        encolarEscrituraObservabilidad(auditarPlan({ requestId: estado.ragRequestId, status: "AJUSTE_ESQUEMA_INVALIDO", error: lectura.errores.join(" | ") }));
        return {
          ok: false,
          status: "AJUSTE_ESQUEMA_INVALIDO",
          errores: lectura.errores,
          ...(lectura.indice !== undefined && "ediciones" in args ? { edicion_fallida: lectura.indice, ediciones_aplicadas: 0 } : {}),
          accion_requerida: "Corrige los argumentos según el esquema y vuelve a llamar ajustar_plan_decoracion: accion (agregar, reemplazar, quitar, repartir o mezcla) y estructura_id en cada edición; objetivo_variant_id en reemplazar y quitar; variante en agregar y reemplazar; participaciones en repartir; mezcla en mezcla. Varios cambios van en `ediciones` (de 1 a 8), sin mezclarlos con los campos sueltos. No se aplicó ninguna edición.",
          mensaje_cliente: MENSAJE_CLIENTE_PLAN_EN_AJUSTE,
        };
      }
      const ediciones = lectura.ediciones;
      const varias = ediciones.length > 1;
      // Misma allowlist que confirmar_plan_decoracion (allowlistDesdeMapa(estado.ragVariantIdsRecuperados)):
      // el variant_id que el modelo propone tiene que haber salido de
      // buscar_catalogo_rag EN ESTE MISMO turno. `aplicarEdicionPlan` admite la
      // variante contra el snapshot firmado, pero eso no exige que el modelo la
      // haya buscado — sin este paso podría "recordar" un variant_id sin
      // pasarlo por el catálogo de este turno. Se revisan TODAS antes de aplicar
      // la primera: una variante sin buscar no gasta ninguna llamada a Python.
      const sinBuscar = primeraVarianteNoBuscada(ediciones, estado.ragVariantIdsRecuperados);
      if (sinBuscar) {
        encolarEscrituraObservabilidad(auditarPlan({ requestId: estado.ragRequestId, status: "AJUSTE_VARIANTE_FUERA_DE_BUSQUEDA", error: `${sinBuscar.product_id}:${sinBuscar.variant_id}` }));
        return {
          ok: false,
          status: "VARIANTE_FUERA_DE_BUSQUEDA",
          ...(varias ? { edicion_fallida: sinBuscar.indice, ediciones_aplicadas: 0 } : {}),
          accion_requerida: `El product_id/variant_id de \`variante\`${varias ? ` en la edición ${sinBuscar.indice}` : ""} debe haber aparecido en buscar_catalogo_rag de este mismo turno. Búscalo primero y usa exactamente ese par.${varias ? " No se aplicó ninguna edición." : ""}`,
          mensaje_cliente: MENSAJE_CLIENTE_PIEZAS,
        };
      }
      try {
        const { plan: resuelto, cotizacion, pasos } = await aplicarEdicionesEncadenadas({
          base: planVigente.base,
          ediciones,
          aplicar: ({ base, edicion, esUltima }) => aplicarEdicionPlan({
            base,
            edicion,
            correlationId: options.correlationId,
            pool: ragPool,
            ...(esUltima ? {} : { omitirAuditoria: true }),
            ...(options.signal ? { signal: options.signal } : {}),
          }),
        });
        // Todas se aplicaron: solo ahora cambia lo que ve la tarjeta.
        estado.planResuelto = resuelto;
        estado.cotizacion = cotizacion;
        estado.seleccionFinalIA = [];
        encolarEscrituraObservabilidad(auditarPlan({
          requestId: estado.ragRequestId,
          planHash: resuelto.plan_hash,
          status: "PLAN_AJUSTADO_CHAT",
          geometry: geometriaAuditadaChat(ediciones),
          costChosenCop: resuelto.totales.total_cop,
        }));
        // Python's own sentences about the edits (e.g. the color pattern was
        // rebuilt because a color left the piece): relay them, don't reword.
        const avisos = [...new Set(pasos.flatMap((paso) => paso.avisos))];
        const cambios = ediciones.map((edicion, posicion) => cambioParaElModelo(edicion, posicion + 1));
        const primera = cambios[0]!;
        return {
          ok: true,
          status: "PLAN_AJUSTADO",
          // Point 4 of §7: what changed vs. the previous card, so the model
          // can say it instead of presenting the update as a first proposal.
          ediciones_aplicadas: ediciones.length,
          cambios,
          estructuras_ajustadas: [...new Set(ediciones.map((edicion) => edicion.estructura_id))],
          // The original single-edit answer keeps its flat fields.
          ...(varias ? {} : { estructura_ajustada: primera.estructura_id, accion: primera.accion, ...(primera.material_nuevo !== undefined ? { material_nuevo: primera.material_nuevo } : {}) }),
          total_cop: resuelto.totales.total_cop,
          ...(avisos.length > 0 ? { avisos } : {}),
          accion_requerida: `Cuéntale al cliente en una frase qué cambiaste (${varias ? "las estructuras y los materiales" : "la estructura y el material"}, no todo el plan), el nuevo total (total_cop, exactamente ese número) y que el desglose en pantalla ya lo refleja.${avisos.length > 0 ? " Incluye los avisos tal cual." : ""} No llames confirmar_plan_decoracion en este turno ni presentes esto como una propuesta nueva.`,
          fase: "propuesta_actualizada; el desglose en pantalla ya refleja el ajuste",
        };
      } catch (envuelto) {
        // Which edit failed (1-based) when there were several; nothing was applied either way.
        const fallida = envuelto instanceof EdicionEncadenadaError ? envuelto : undefined;
        const error = fallida ? fallida.causa : envuelto;
        const donde = varias && fallida ? { edicion_fallida: fallida.indice, ediciones_aplicadas: 0 } : {};
        const prefijoModelo = varias && fallida ? `La edición ${fallida.indice} de ${fallida.total} falló y NO se aplicó ninguna: la propuesta sigue exactamente igual. ` : "";
        if (error instanceof PlanEditError) {
          encolarEscrituraObservabilidad(auditarPlan({ requestId: estado.ragRequestId, status: "AJUSTE_RECHAZADO", error: `${varias && fallida ? `edicion ${fallida.indice}: ` : ""}${error.causa ?? "sin_causa"}: ${error.message}` }));
          return {
            ok: false,
            status: "AJUSTE_RECHAZADO",
            ...(error.causa ? { causa: error.causa } : {}),
            ...donde,
            accion_requerida: `${prefijoModelo}El ajuste no se pudo aplicar. Dile al cliente el motivo; si la propuesta expiró o el catálogo cambió, ofrécele pedirla de nuevo en vez de inventar un resultado.${varias ? " Si el cliente quiere el resto de los cambios, vuelve a llamar sin la edición que falló o corrigiéndola." : ""}`,
            mensaje_cliente: varias ? `La propuesta sigue como estaba. ${mensajeClienteDeRechazo(error.message)}` : mensajeClienteDeRechazo(error.message),
          };
        }
        if (error instanceof AllowlistProductoVarianteError) {
          encolarEscrituraObservabilidad(auditarPlan({ requestId: estado.ragRequestId, status: "PRODUCTO_VARIANTE_INCONSISTENTE", error: error.message }));
          return {
            ok: false,
            status: "PRODUCTO_VARIANTE_INCONSISTENTE",
            ...donde,
            accion_requerida: `${prefijoModelo}El variant_id no pertenece a ese product_id según buscar_catalogo_rag; corrige el par y vuelve a llamar ajustar_plan_decoracion.`,
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
