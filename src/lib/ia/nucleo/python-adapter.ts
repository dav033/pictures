import {
  DEADLINE_DEFAULT_MS,
  DEADLINE_MAX_MS,
  InternalRequestSignatureV1Schema,
  OperationalContextV1Schema,
  crearDeadlineSignal,
  firmarRequestInterna,
  sha256Body,
} from "@/lib/ia/contracts/operational-v1";
import {
  CATALOG_COLORS_CONTRACT_VERSION,
  CATALOG_RECOMMENDATIONS_CONTRACT_VERSION,
  CatalogColorsResultV1Schema,
  CatalogRecommendationsResultV1Schema,
  ESTIMAR_CONTEO_CONTRACT_VERSION,
  EstimarConteoResultV1Schema,
  PlanResolutionResultV1Schema,
  type EstimarConteoRequestV1,
  type EstimarConteoResultV1,
} from "@/lib/ia/contracts/domain-v1";
import { ListaMaterialesResultadoSchema, ListaMaterialesRequestSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import {
  ArmadoBouquetResueltoSchema,
  DISPOSICIONES_NUMERO,
  LecturaArmadoSchema,
  VARIANTES_BOUQUET,
  type ArmadoBouquetResuelto,
  type ArmadoBouquetV1,
  type PistaArmado,
} from "@/lib/plan/armado-bouquet";
import {
  ArmadoGuirnaldaResueltoSchema,
  LecturaGuirnaldaSchema,
  type ArmadoGuirnaldaResuelto,
  type ArmadoGuirnaldaV1,
  type PistaGuirnalda,
} from "@/lib/plan/armado-guirnalda";
import {
  ArcoResueltoSchema,
  ArmadoArcoV1Schema,
  VistaArcoSchema,
  type ArcoResuelto,
  type ArmadoArcoV1,
  type VistaArco,
} from "@/lib/plan/armado-arco";
import { OpcionesArmadoGuirnaldaSchema, type OpcionesArmadoGuirnalda } from "@/lib/plan/opciones-armado-guirnalda";
import { GraficaDibujoEstructuraSchema, type GraficaDibujoEstructura } from "@/lib/plan/dibujo-estructura";
import { PLAN_GUIA_ESCENA_CONTRACT_VERSION, PlanGuiaEscenaRequestV1Schema, PlanGuiaEscenaResultV1Schema, type PlanGuiaEscenaRequestV1, type PlanGuiaEscenaResultV1 } from "@/lib/plan/guia-escena";
import {
  LimitesArcoSchema,
  OpcionesArmadoArcoSchema,
  type LimitesArco,
  type OpcionesArmadoArco,
} from "@/lib/plan/opciones-armado-arco";
import {
  ArcoOrganicoResueltoSchema,
  ArmadoArcoOrganicoV1Schema,
  type ArcoOrganicoResuelto,
  type ArmadoArcoOrganicoV1,
} from "@/lib/plan/armado-arco-organico";
import {
  LimitesArcoOrganicoSchema,
  OpcionesArmadoArcoOrganicoSchema,
  VistaArcoOrganicoSchema,
  type LimitesArcoOrganico,
  type OpcionesArmadoArcoOrganico,
  type VistaArcoOrganico,
} from "@/lib/plan/opciones-armado-arco-organico";
import {
  ArmadoColumnaOrganicaV1Schema,
  ColumnaOrganicaResueltaSchema,
  type ArmadoColumnaOrganicaV1,
  type ColumnaOrganicaResuelta,
} from "@/lib/plan/armado-columna-organica";
import {
  LimitesColumnaOrganicaSchema,
  OpcionesArmadoColumnaOrganicaSchema,
  VistaColumnaOrganicaSchema,
  type LimitesColumnaOrganica,
  type OpcionesArmadoColumnaOrganica,
  type VistaColumnaOrganica,
} from "@/lib/plan/opciones-armado-columna-organica";
import {
  ArmadoGuirnaldaOrganicaV1Schema,
  GuirnaldaOrganicaResueltaSchema,
  type ArmadoGuirnaldaOrganicaV1,
  type GuirnaldaOrganicaResuelta,
} from "@/lib/plan/armado-guirnalda-organica";
import {
  LimitesGuirnaldaOrganicaSchema,
  OpcionesArmadoGuirnaldaOrganicaSchema,
  VistaGuirnaldaOrganicaSchema,
  type LimitesGuirnaldaOrganica,
  type OpcionesArmadoGuirnaldaOrganica,
  type VistaGuirnaldaOrganica,
} from "@/lib/plan/opciones-armado-guirnalda-organica";
import {
  ArmadoCompletadoSchema,
  ArmadoDeIaSchema,
  CatalogoArmadoSchema,
  type AdornosPedidos,
  type ArmadoCompletado,
  type ArmadoDeIa,
  type CatalogoArmado,
  type ColorPedido,
  type FormaPedida,
  type GeometriaPedida,
  type PesoTamano,
  type PiezaArmado,
  type RematePedido,
  type TipoArmadoMotor,
  type VolumenPedido,
} from "@/lib/plan/armado-estructura-ia";
import { ArmadoColumnaV1Schema, ColumnaResueltaSchema, RemateLeidoSchema, VistaColumnaSchema, type ArmadoColumnaV1, type ColumnaResuelta, type PistaRemate, type VistaColumna } from "@/lib/plan/armado-columna";
import { LimitesColumnaSchema, OpcionesArmadoColumnaSchema, type LimitesColumna, type OpcionesArmadoColumna } from "@/lib/plan/opciones-armado-columna";
import { LecturaConteoSchema, type PistaConteo } from "@/lib/plan/conteo-referencia";
import type { EdicionPlan } from "@/lib/plan/edicion-esquemas";
import { CotizacionProfesionalResultadoSchema, type CotizacionProfesionalResultado, type EntradaCotizacionProfesional } from "@/lib/cotizacion/profesional";
import {
  MODOS_PATRON_COLOR,
  ModoAdmitidoSchema,
  PatronColorResueltoSchema,
  PistaPatronSchema,
  TAMANOS_LEIDOS,
  type ModoAdmitido,
  type ModoPatronColor,
  type PatronColor,
  type PatronColorResuelto,
  type PistaPatron,
  type PistaTamanos,
} from "@/lib/plan/patron-color";
import { PlanDecoracionSchema, type PlanDecoracion } from "@/lib/plan/tipos";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { z } from "zod";

export const PYTHON_ECHO_PATH = "/internal/v1/echo";
export const PYTHON_ECHO_SCOPE = "ai.echo";
export const PYTHON_RERANK_PATH = "/internal/v1/rerank";
export const PYTHON_RERANK_SCOPE = "ai.rerank";
export const PYTHON_EMBEDDING_PATH = "/internal/v1/embed";
export const PYTHON_EMBEDDING_SCOPE = "ai.embedding";
export const PYTHON_CATALOG_SEARCH_PATH = "/internal/v1/catalog/search";
export const PYTHON_CATALOG_SEARCH_SCOPE = "catalog.search";
export const PYTHON_CATALOG_COLORS_PATH = "/internal/v1/catalog/colors";
export const PYTHON_CATALOG_COLORS_SCOPE = "catalog.colors";
export const PYTHON_CATALOG_SELECTION_PATH = "/internal/v1/catalog/selection";
export const PYTHON_CATALOG_SELECTION_SCOPE = "catalog.selection";
export const PYTHON_PLAN_RESOLUTION_PATH = "/internal/v1/plan/resolve";
export const PYTHON_PLAN_RESOLUTION_SCOPE = "plan.resolve";
export const PYTHON_CATALOG_RECOMMENDATIONS_PATH = "/internal/v1/catalog/recommendations";
export const PYTHON_CATALOG_RECOMMENDATIONS_SCOPE = "catalog.recommendations";
export const PYTHON_INTENT_PARSE_PATH = "/internal/v1/ia/intent-parse";
export const PYTHON_INTENT_PARSE_SCOPE = "ia.intent_parse";
export const PYTHON_HAPPIE_GENERATE_PATH = "/internal/v1/ia/happie-generate";
export const PYTHON_HAPPIE_GENERATE_SCOPE = "ia.happie_generate";
export const PYTHON_REFERENCE_TURN_PATH = "/internal/v1/ia/reference-turn";
export const PYTHON_REFERENCE_TURN_SCOPE = "ia.reference_turn";
export const PYTHON_LORA_GENERATE_PATH = "/internal/v1/ia/lora-generate";
export const PYTHON_LORA_GENERATE_SCOPE = "ia.lora_generate";
export const PYTHON_CHAT_TURN_STREAM_PATH = "/internal/v1/ia/chat-turn-stream";
export const PYTHON_CHAT_TURN_STREAM_SCOPE = "ia.chat_turn_stream";
export const PYTHON_PATRON_REFERENCIA_PATH = "/internal/v1/ia/patron-referencia";
export const PYTHON_PATRON_REFERENCIA_SCOPE = "ia.patron_referencia";
export const PYTHON_BOUQUET_REFERENCIA_PATH = "/internal/v1/ia/bouquet-referencia";
export const PYTHON_BOUQUET_REFERENCIA_SCOPE = "ia.bouquet_referencia";
export const PYTHON_CONTEO_REFERENCIA_PATH = "/internal/v1/ia/conteo-referencia";
export const PYTHON_CONTEO_REFERENCIA_SCOPE = "ia.conteo_referencia";
export const PYTHON_GUIRNALDA_REFERENCIA_PATH = "/internal/v1/ia/guirnalda-referencia";
export const PYTHON_GUIRNALDA_REFERENCIA_SCOPE = "ia.guirnalda_referencia";
export const PYTHON_LECTURA_UNICA_PATH = "/internal/v1/ia/lectura-unica";
export const PYTHON_LECTURA_UNICA_SCOPE = "ia.lectura_unica";
export const PYTHON_PLAN_EDIT_PATH = "/internal/v1/plan/edit";
export const PYTHON_PLAN_EDIT_SCOPE = "plan.edit";
export const PYTHON_PLAN_PATRON_PATH = "/internal/v1/plan/patron";
export const PYTHON_PLAN_PATRON_SCOPE = "plan.patron";
export const PYTHON_PLAN_ARMADO_PATH = "/internal/v1/plan/armado-bouquet";
export const PYTHON_PLAN_ARMADO_SCOPE = "plan.armado_bouquet";
export const PYTHON_PLAN_ARMADO_GUIRNALDA_PATH = "/internal/v1/plan/armado-guirnalda";
export const PYTHON_PLAN_ARMADO_GUIRNALDA_SCOPE = "plan.armado_guirnalda";
export const PYTHON_PLAN_ARMADO_ARCO_PATH = "/internal/v1/plan/armado-arco";
export const PYTHON_PLAN_ARMADO_ARCO_SCOPE = "plan.armado_arco";
export const PYTHON_PLAN_ARMADO_COLUMNA_PATH = "/internal/v1/plan/armado-columna";
export const PYTHON_PLAN_ARMADO_COLUMNA_SCOPE = "plan.armado_columna";
/** The organic garland of the designer's engine. It does NOT replace PYTHON_PLAN_ARMADO_GUIRNALDA_PATH (ADR-0032, clusters and toppers): both coexist on the same piece. */
/** The organic arch of the designer's engine. It does NOT replace PYTHON_PLAN_ARMADO_ARCO_PATH (the pattern grid): both coexist on the same kind of piece, and a half arch is armed here with `forma.corte` below 1. */
export const PYTHON_PLAN_ARMADO_ARCO_ORGANICO_PATH = "/internal/v1/plan/armado-arco-organico";
export const PYTHON_PLAN_ARMADO_ARCO_ORGANICO_SCOPE = "plan.armado_arco_organico";
/** The organic column of the designer's engine. It does NOT replace PYTHON_PLAN_ARMADO_COLUMNA_PATH (the ring tower with patterns): both coexist on the same kind of piece. */
export const PYTHON_PLAN_ARMADO_COLUMNA_ORGANICA_PATH = "/internal/v1/plan/armado-columna-organica";
export const PYTHON_PLAN_ARMADO_COLUMNA_ORGANICA_SCOPE = "plan.armado_columna_organica";
export const PYTHON_PLAN_ARMADO_GUIRNALDA_ORGANICA_PATH = "/internal/v1/plan/armado-guirnalda-organica";
export const PYTHON_PLAN_ARMADO_GUIRNALDA_ORGANICA_SCOPE = "plan.armado_guirnalda_organica";
/** The schematic drawing of a piece no engine builds (the wall, the circular hoop, the balloon ceiling, the table centerpiece). It resolves no assembly and counts nothing. */
export const PYTHON_PLAN_DIBUJO_ESTRUCTURA_PATH = "/internal/v1/plan/dibujo-estructura";
export const PYTHON_PLAN_DIBUJO_ESTRUCTURA_SCOPE = "plan.dibujo_estructura";
/** The balloons of every structure of the plan as flat discs in meters, for the scene guide the image model receives instead of the reference photo. It places and counts nothing: it reads what the engines and the schematic drawings already placed. */
export const PYTHON_PLAN_GUIA_ESCENA_PATH = "/internal/v1/plan/guia-escena";
export const PYTHON_PLAN_GUIA_ESCENA_SCOPE = "plan.guia_escena";
export const PYTHON_OMOIKANE_ARMADO_PATH = "/internal/v1/omoikane/armado-estructura";
export const PYTHON_OMOIKANE_ARMADO_SCOPE = "omoikane.armado_estructura";
export const PYTHON_COTIZACION_PROFESIONAL_PATH = "/internal/v1/plan/cotizacion-profesional";
export const PYTHON_COTIZACION_PROFESIONAL_SCOPE = "plan.cotizacion_profesional";
export const PYTHON_LISTA_MATERIALES_PATH = "/internal/v1/plan/lista-materiales";
export const PYTHON_LISTA_MATERIALES_SCOPE = "plan.lista_materiales";
export const PYTHON_ESTIMAR_CONTEO_PATH = "/internal/v1/plan/estimar-conteo";
export const PYTHON_ESTIMAR_CONTEO_SCOPE = "plan.estimar_conteo";
export const PYTHON_EMBEDDING_MODEL = "gemini-embedding-2";
export const PYTHON_EMBEDDING_DIMENSIONS = 768;
export const PYTHON_MAX_BODY_BYTES = 64 * 1024;
/** Reference-image analysis (Amaterasu) only -- same 10MB cap Next already enforces client-side (LIMITE_CUERPO_ANALISIS_BYTES in analisis-http.ts). */
export const PYTHON_MAX_BODY_BYTES_IMAGENES = 11 * 1024 * 1024;
/** Omoikane's chat turn only -- just above the 25_000_000-byte body /api/chat/route.ts already accepts from the browser, so the same photos fit on the Next -> Python hop. */
export const PYTHON_MAX_BODY_BYTES_CHAT = 25 * 1024 * 1024;
/** Happie's package recommendation only -- it carries the active Happia catalog as JSON text (MAX_BODY_BYTES_HAPPIE in main.py). */
export const PYTHON_MAX_BODY_BYTES_HAPPIE = 4 * 1024 * 1024;

/**
 * Stable domain error codes reported by POST /internal/v1/plan/resolve
 * (services/ai-api/app/plan.py). They arrive as PythonAdapterError.domainCode
 * under the PYTHON_INVALID_REQUEST transport code. A plan with no catalog
 * coverage is NOT an error: the service answers 200 with
 * `plan_resuelto.sin_cobertura` populated. `allowlist_product_mismatch` means a
 * variant was paired with a product that does not own it in the snapshot.
 */
export const PYTHON_PLAN_RESOLUTION_DOMAIN_CODES = ["invalid_plan", "catalog_snapshot_not_found", "allowlist_product_mismatch"] as const;
export type PythonPlanResolutionDomainCode = (typeof PYTHON_PLAN_RESOLUTION_DOMAIN_CODES)[number];

/**
 * Stable domain error codes reported by POST /internal/v1/catalog/selection
 * (services/ai-api/app/catalog.py). Same transport as plan resolution.
 */
export const PYTHON_CATALOG_SELECTION_DOMAIN_CODES = ["allowlist_product_mismatch"] as const;
export type PythonCatalogSelectionDomainCode = (typeof PYTHON_CATALOG_SELECTION_DOMAIN_CODES)[number];

/**
 * Stable domain error codes reported by POST /internal/v1/catalog/recommendations
 * (services/ai-api/app/recommendations.py), under PYTHON_INVALID_REQUEST.
 */
export const PYTHON_CATALOG_RECOMMENDATIONS_DOMAIN_CODES = ["catalog_snapshot_not_found", "reference_variant_not_found"] as const;
export type PythonCatalogRecommendationsDomainCode = (typeof PYTHON_CATALOG_RECOMMENDATIONS_DOMAIN_CODES)[number];

/**
 * Stable domain error codes reported by POST /internal/v1/plan/edit
 * (services/ai-api/app/plan_edicion.py, ADR-0028 §9). They keep Python's HTTP
 * status (404, 409, 400 or 422), so they do not all classify as
 * PYTHON_INVALID_REQUEST: callers branch on `domainCode`. `patron_invalido`
 * carries `domainDetails` (structure, stable `motivo`, Spanish `mensaje`).
 */
export const PYTHON_PLAN_EDIT_DOMAIN_CODES = [
  "estructura_no_encontrada",
  "variante_objetivo_no_encontrada",
  "reparto_no_corresponde",
  "material_no_editable",
  "unico_material",
  "sin_participacion",
  "patron_activo",
  "patron_invalido",
  "armado_invalido",
  "invalid_plan",
] as const;
export type PythonPlanEditDomainCode = (typeof PYTHON_PLAN_EDIT_DOMAIN_CODES)[number];

/**
 * Stable domain error codes reported by POST /internal/v1/plan/armado-bouquet
 * (ADR-0030). Its `armado_invalido` also carries the styles and number
 * placements the purchase admits (`domainDetails.variantesAdmitidas`,
 * `disposicionesAdmitidas`).
 */
export const PYTHON_PLAN_ARMADO_DOMAIN_CODES = [
  "estructura_no_encontrada",
  "armado_invalido",
  "invalid_plan",
] as const;
export type PythonPlanArmadoDomainCode = (typeof PYTHON_PLAN_ARMADO_DOMAIN_CODES)[number];

/**
 * Stable domain error codes reported by POST /internal/v1/plan/armado-guirnalda
 * (ADR-0032). Its `armado_invalido` carries the structure, the stable
 * `motivo` and Python's `mensaje` (`domainDetails`), never the options: the
 * editor asks for them with `armado_guirnalda: null`.
 */
export const PYTHON_PLAN_ARMADO_GUIRNALDA_DOMAIN_CODES = PYTHON_PLAN_ARMADO_DOMAIN_CODES;

/**
 * Stable domain error codes reported by POST /internal/v1/plan/armado-arco
 * (ADR-0034). The same three as the garland's: its `armado_invalido` carries
 * the structure, the stable `motivo` and Python's `mensaje`
 * (`domainDetails`), and never the options -- the editor asks for them with
 * `armado_arco: null`.
 */
export const PYTHON_PLAN_ARMADO_ARCO_DOMAIN_CODES = PYTHON_PLAN_ARMADO_DOMAIN_CODES;

/**
 * Stable domain error codes reported by POST /internal/v1/plan/armado-columna
 * (ADR-0034, ADR-0035 step 3). The same three as the arch's: its
 * `armado_invalido` carries the structure, the stable `motivo` and Python's
 * `mensaje` (`domainDetails`), and never the options -- the editor asks for
 * them with `armado_columna: null`.
 */
export const PYTHON_PLAN_ARMADO_COLUMNA_DOMAIN_CODES = PYTHON_PLAN_ARMADO_DOMAIN_CODES;

/**
 * Stable domain error codes reported by POST
 * /internal/v1/plan/armado-guirnalda-organica (ADR-0034). The same three as
 * the arch's: its `armado_invalido` carries the structure, the stable
 * `motivo` and Python's `mensaje` (`domainDetails`), and never the options --
 * the editor asks for them with `armado_guirnalda_organica: null`.
 */
export const PYTHON_PLAN_ARMADO_GUIRNALDA_ORGANICA_DOMAIN_CODES = PYTHON_PLAN_ARMADO_DOMAIN_CODES;

/**
 * Stable domain error codes reported by POST
 * /internal/v1/plan/armado-columna-organica (ADR-0034). The same three as the
 * arch's: its `armado_invalido` carries the structure, the stable `motivo` and
 * Python's `mensaje` (`domainDetails`), and never the options -- the editor
 * asks for them with `armado_columna_organica: null`.
 */
export const PYTHON_PLAN_ARMADO_COLUMNA_ORGANICA_DOMAIN_CODES = PYTHON_PLAN_ARMADO_DOMAIN_CODES;

/**
 * Stable domain error codes reported by POST
 * /internal/v1/plan/armado-arco-organico (ADR-0034). The same three as the
 * classic arch's: its `armado_invalido` carries the structure, the stable
 * `motivo` and Python's `mensaje` (`domainDetails`), and never the options --
 * the editor asks for them with `armado_arco_organico: null`.
 */
export const PYTHON_PLAN_ARMADO_ARCO_ORGANICO_DOMAIN_CODES = PYTHON_PLAN_ARMADO_DOMAIN_CODES;

/**
 * Stable domain error codes reported by POST /internal/v1/omoikane/armado-estructura
 * (ADR-0034 §5, the chat agent's engine tools). `armado_invalido` is the only
 * one the model can act on, and it carries the stable `motivo` and Python's
 * `mensaje` (`domainDetails`) so the refusal that reaches the model says what
 * did not hold -- an unknown pattern, a color the piece does not have, a
 * pattern that needs more colors than the piece has.
 */
export const PYTHON_OMOIKANE_ARMADO_DOMAIN_CODES = ["armado_invalido", "invalid_plan"] as const;
export type PythonOmoikaneArmadoDomainCode = (typeof PYTHON_OMOIKANE_ARMADO_DOMAIN_CODES)[number];

/**
 * Stable domain error codes reported by POST /internal/v1/plan/estimar-conteo
 * (ADR-0038, the chat agent's read-only count estimate). Both carry
 * `domainDetails`: the candidate's label (as `estructuraId`), a stable `motivo`
 * and Python's Spanish `mensaje`, so the refusal that reaches the model says
 * which candidate failed and why. `candidato_invalido`: two candidates share a
 * label, an assembly does not belong to the piece's type, or more guirnaldas with
 * an assembly than one query admits; `armado_invalido`: the engine's gate rejected
 * the assembly; `invalid_request`: the body does not meet the contract (a 422 with
 * no details); `estimacion_ocupada` (HTTP 429): another estimate is running and the
 * route does not queue behind it -- the caller retries.
 */
export const PYTHON_ESTIMAR_CONTEO_DOMAIN_CODES = ["candidato_invalido", "armado_invalido", "invalid_request", "estimacion_ocupada"] as const;
export type PythonEstimarConteoDomainCode = (typeof PYTHON_ESTIMAR_CONTEO_DOMAIN_CODES)[number];

/**
 * Stable domain error codes reported by POST /internal/v1/plan/patron (ADR-0028 §10).
 * Its `patron_invalido` also carries the structure's styles (`domainDetails.modosAdmitidos`).
 * The colors slider's preview (`participaciones`) adds the three answers of
 * its `repartir`: `sin_patron`, `patron_activo` and `reparto_no_corresponde`.
 */
export const PYTHON_PLAN_PATRON_DOMAIN_CODES = [
  "estructura_no_encontrada",
  "patron_invalido",
  "invalid_plan",
  "sin_patron",
  "patron_activo",
  "reparto_no_corresponde",
] as const;
export type PythonPlanPatronDomainCode = (typeof PYTHON_PLAN_PATRON_DOMAIN_CODES)[number];

type AdapterEnvironment = Record<string, string | undefined>;
type JsonObject = Record<string, unknown>;

export type PythonAdapterErrorCode =
  | "PYTHON_BACKEND_NOT_SELECTED"
  | "PYTHON_BACKEND_NOT_CONFIGURED"
  | "PYTHON_BACKEND_INVALID_URL"
  | "PYTHON_BACKEND_TIMEOUT"
  | "PYTHON_REQUEST_CANCELLED"
  | "PYTHON_AUTH_FAILED"
  | "PYTHON_AUTH_UNAVAILABLE"
  | "PYTHON_SCOPE_DENIED"
  | "PYTHON_REPLAY"
  | "PYTHON_IDEMPOTENCY_CONFLICT"
  | "PYTHON_IDEMPOTENCY_IN_FLIGHT"
  | "PYTHON_INVALID_REQUEST"
  | "PYTHON_PAYLOAD_TOO_LARGE"
  | "PYTHON_INVALID_RESPONSE"
  | "PYTHON_BUSY"
  | "PYTHON_UNAVAILABLE";

const ERROR_MESSAGES: Record<PythonAdapterErrorCode, string> = {
  PYTHON_BACKEND_NOT_SELECTED: "La ruta Python no está seleccionada.",
  PYTHON_BACKEND_NOT_CONFIGURED: "El backend Python no está configurado.",
  PYTHON_BACKEND_INVALID_URL: "La URL del backend Python no es válida.",
  PYTHON_BACKEND_TIMEOUT: "El backend Python agotó su deadline.",
  PYTHON_REQUEST_CANCELLED: "La solicitud al backend Python fue cancelada.",
  PYTHON_AUTH_FAILED: "El backend Python rechazó la autenticación.",
  PYTHON_AUTH_UNAVAILABLE: "La autenticación del backend Python no está disponible.",
  PYTHON_SCOPE_DENIED: "El backend Python rechazó el scope solicitado.",
  PYTHON_REPLAY: "El backend Python rechazó el replay de la solicitud.",
  PYTHON_IDEMPOTENCY_CONFLICT: "La clave de idempotencia ya fue usada con otro cuerpo.",
  PYTHON_IDEMPOTENCY_IN_FLIGHT: "Ya existe una solicitud en curso con esa clave de idempotencia.",
  PYTHON_INVALID_REQUEST: "El backend Python rechazó la solicitud.",
  PYTHON_PAYLOAD_TOO_LARGE: "La solicitud supera el tamaño máximo permitido.",
  PYTHON_INVALID_RESPONSE: "El backend Python devolvió una respuesta inválida.",
  PYTHON_BUSY: "El backend Python está ocupado y no aceptó el trabajo.",
  PYTHON_UNAVAILABLE: "No se pudo contactar al backend Python.",
};

const RETRYABLE_CODES = new Set<PythonAdapterErrorCode>([
  "PYTHON_BACKEND_TIMEOUT",
  "PYTHON_AUTH_UNAVAILABLE",
  "PYTHON_IDEMPOTENCY_IN_FLIGHT",
  "PYTHON_BUSY",
  "PYTHON_UNAVAILABLE",
]);

/**
 * El cupo global de los motores (`app/exclusion_motores.py`): un solo trabajo de motor a la vez en todo
 * `ai-api`. Quien no lo consigue recibe `motor_ocupado` (429) **al instante**, antes de que el trabajo se
 * encole, y su propio diseño dice que el cliente reintente. Sin estos reintentos el 429 llegaba hasta el
 * cliente como "el servicio no respondió" cada vez que dos dibujos coincidían (visto el 2026-10-02 moviendo
 * el editor de la guirnalda).
 *
 * Reintentar es seguro: la reserva se toma ANTES de encolar, así que un 429 garantiza que el trabajo no
 * corrió, y un dibujo no tiene efecto que duplicar. La espera es corta a propósito —un trabajo del motor
 * tarda unos cientos de milisegundos, no el segundo del `Retry-After`— y el presupuesto total lo acota el
 * `deadline_ms` de la llamada, que no se reinicia entre intentos.
 */
const REINTENTOS_MOTOR_OCUPADO = 3;
const ESPERA_MOTOR_OCUPADO_MS = 120;
const CODIGO_MOTOR_OCUPADO = "motor_ocupado";

const responseSchema = z.object({
  schema_version: z.literal("operational.v1"),
  request_id: z.string().uuid(),
  correlation_id: z.string().uuid(),
  payload: z.record(z.string(), z.unknown()),
}).strict();

export interface PythonEmbeddingAttempt {
  attempt: number;
  result: "ok" | "error";
  elapsed_ms: number;
}

const embeddingAttemptSchema = z.object({
  attempt: z.number().int().positive(),
  result: z.enum(["ok", "error"]),
  elapsed_ms: z.number().int().nonnegative(),
}).strict();

function upstreamEmbeddingAttempts(value: unknown): PythonEmbeddingAttempt[] | undefined {
  if (!isJsonObject(value) || !isJsonObject(value.detail)) return undefined;
  const parsed = z.array(embeddingAttemptSchema).min(1).safeParse(value.detail.attempts);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Generic passthrough for a domain error's original provider status/detail
 * (Kagutsuchi's account-rejected fal.ai responses -- see
 * ProveedorImagenNoDisponibleError in kagutsuchi/sempertex-lora.ts, which
 * needs the real 401/402/403 fal returned, not the boundary's own 502/503).
 * Not specific to one operation: any future domain error can populate these
 * two fields the same way Python's `_detail_metadata` already does.
 */
function upstreamProviderStatus(value: unknown): number | undefined {
  if (!isJsonObject(value) || !isJsonObject(value.detail)) return undefined;
  const parsed = z.number().int().positive().safeParse(value.detail.provider_status);
  return parsed.success ? parsed.data : undefined;
}

function upstreamProviderDetail(value: unknown): string | undefined {
  if (!isJsonObject(value) || !isJsonObject(value.detail)) return undefined;
  const parsed = z.string().min(1).safeParse(value.detail.provider_detail);
  return parsed.success ? parsed.data : undefined;
}

/**
 * What a domain error says next to its code (Python's `_detail_metadata`):
 * `patron_invalido` names the structure, a stable rule and a Spanish sentence
 * for the decorator; the pattern preview's rejection also carries the styles
 * the structure admits (`modos_admitidos`, ADR-0028 §10). Written by the
 * domain, never echoed from the request.
 */
export interface PythonDomainDetails {
  estructuraId?: string;
  motivo?: string;
  mensaje?: string;
  modosAdmitidos?: ModoAdmitido[];
  /** `armado_invalido` of the bouquet preview (ADR-0030): what the purchase admits. */
  variantesAdmitidas?: VarianteBouquet[];
  disposicionesAdmitidas?: DisposicionNumero[];
}

type VarianteBouquet = (typeof VARIANTES_BOUQUET)[number];
type DisposicionNumero = (typeof DISPOSICIONES_NUMERO)[number];

/** The styles of a structure: at most one entry per mode, each in the contract. */
const modosAdmitidosSchema = z.array(ModoAdmitidoSchema).max(MODOS_PATRON_COLOR.length)
  .refine((modos) => new Set(modos.map((modo) => modo.modo)).size === modos.length);
/** Bouquet options: each value once, all in the contract. */
const variantesAdmitidasSchema = z.array(z.enum(VARIANTES_BOUQUET)).max(VARIANTES_BOUQUET.length)
  .refine((lista) => new Set(lista).size === lista.length);
const disposicionesAdmitidasSchema = z.array(z.enum(DISPOSICIONES_NUMERO)).max(DISPOSICIONES_NUMERO.length)
  .refine((lista) => new Set(lista).size === lista.length);

function upstreamDomainDetails(value: unknown): PythonDomainDetails | undefined {
  if (!isJsonObject(value) || !isJsonObject(value.detail)) return undefined;
  const detail = value.detail;
  const texto = (campo: unknown, maximo: number): string | undefined => {
    const parsed = z.string().trim().min(1).max(maximo).safeParse(campo);
    return parsed.success ? parsed.data : undefined;
  };
  const estructuraId = texto(detail.estructura_id, 160);
  const motivo = texto(detail.motivo, 64);
  const mensaje = texto(detail.mensaje, 400);
  // All or nothing: a list that breaks the contract is dropped whole.
  const modos = modosAdmitidosSchema.safeParse(detail.modos_admitidos);
  const modosAdmitidos = modos.success ? modos.data : undefined;
  const variantes = variantesAdmitidasSchema.safeParse(detail.variantes_admitidas);
  const variantesAdmitidas = variantes.success ? variantes.data : undefined;
  const disposiciones = disposicionesAdmitidasSchema.safeParse(detail.disposiciones_admitidas);
  const disposicionesAdmitidas = disposiciones.success ? disposiciones.data : undefined;
  if (
    estructuraId === undefined && motivo === undefined && mensaje === undefined
    && modosAdmitidos === undefined && variantesAdmitidas === undefined && disposicionesAdmitidas === undefined
  ) return undefined;
  return {
    ...(estructuraId === undefined ? {} : { estructuraId }),
    ...(motivo === undefined ? {} : { motivo }),
    ...(mensaje === undefined ? {} : { mensaje }),
    ...(modosAdmitidos === undefined ? {} : { modosAdmitidos }),
    ...(variantesAdmitidas === undefined ? {} : { variantesAdmitidas }),
    ...(disposicionesAdmitidas === undefined ? {} : { disposicionesAdmitidas }),
  };
}

export class PythonAdapterError extends Error {
  readonly code: PythonAdapterErrorCode;
  /**
   * Domain error code reported by the Python service (`detail.code`), when the
   * failure came from the service instead of the transport. The adapter code
   * above only classifies the transport outcome: several distinct domain
   * failures collapse into `PYTHON_INVALID_REQUEST`, so a caller that needs to
   * tell `catalog_snapshot_not_found` from `invalid_plan` reads this instead.
   * Never present for locally raised transport errors.
   */
  readonly domainCode?: string;
  readonly status: number;
  readonly requestId: string;
  readonly correlationId: string;
  readonly retryable: boolean;
  readonly attempts?: PythonEmbeddingAttempt[];
  /** See upstreamProviderStatus/upstreamProviderDetail above. */
  readonly providerStatus?: number;
  readonly providerDetail?: string;
  /** See upstreamDomainDetails above. */
  readonly domainDetails?: PythonDomainDetails;

  constructor(input: {
    code: PythonAdapterErrorCode;
    status: number;
    requestId: string;
    correlationId: string;
    attempts?: PythonEmbeddingAttempt[];
    domainCode?: string;
    providerStatus?: number;
    providerDetail?: string;
    domainDetails?: PythonDomainDetails;
  }) {
    super(ERROR_MESSAGES[input.code]);
    this.name = "PythonAdapterError";
    this.code = input.code;
    this.status = input.status;
    this.requestId = input.requestId;
    this.correlationId = input.correlationId;
    this.retryable = RETRYABLE_CODES.has(input.code);
    this.attempts = input.attempts;
    this.domainCode = input.domainCode;
    this.providerStatus = input.providerStatus;
    this.providerDetail = input.providerDetail;
    this.domainDetails = input.domainDetails;
  }
}

export function isPythonAdapterError(error: unknown): error is PythonAdapterError {
  return error instanceof PythonAdapterError;
}

export interface PythonOperationInput {
  payload: JsonObject;
  /** Optional operation fields for endpoints whose body is not { payload }. */
  operationBody?: JsonObject;
  requestId: string;
  correlationId: string;
  bodySha256?: string;
  deadlineMs?: number;
  idempotencyKey?: string;
  scopes?: readonly string[];
  /** Overrides PYTHON_MAX_BODY_BYTES for one call (Amaterasu's reference images). */
  maxBodyBytes?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonOperationResponse {
  schema_version: "operational.v1";
  request_id: string;
  correlation_id: string;
  payload: JsonObject;
  replayed?: boolean;
}

/** @deprecated use PythonOperationInput -- kept as an alias so existing echo call sites and tests do not need to change. */
export type PythonEchoInput = PythonOperationInput;
/** @deprecated use PythonOperationResponse -- kept as an alias so existing echo call sites and tests do not need to change. */
export type PythonEchoResponse = PythonOperationResponse;

function errorFor(
  code: PythonAdapterErrorCode,
  status: number,
  requestId: string,
  correlationId: string,
  attempts?: PythonEmbeddingAttempt[],
  domainCode?: string,
  providerStatus?: number,
  providerDetail?: string,
  domainDetails?: PythonDomainDetails,
): PythonAdapterError {
  return new PythonAdapterError({ code, status, requestId, correlationId, attempts, domainCode, providerStatus, providerDetail, domainDetails });
}

function normalizeDeadlineMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEADLINE_DEFAULT_MS;
  return Math.min(DEADLINE_MAX_MS, Math.max(1, Math.trunc(value)));
}

function readPythonConfig(
  env: AdapterEnvironment,
  requestId: string,
  correlationId: string,
): { url: URL; secret: string } {
  const rawUrl = env.PYTHON_BACKEND_URL?.trim();
  const secret = env.INTERNAL_HMAC_SECRET?.trim();
  if (!rawUrl || !secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw errorFor("PYTHON_BACKEND_NOT_CONFIGURED", 503, requestId, correlationId);
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw errorFor("PYTHON_BACKEND_INVALID_URL", 503, requestId, correlationId);
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw errorFor("PYTHON_BACKEND_INVALID_URL", 503, requestId, correlationId);
  }
  url.search = "";
  url.hash = "";
  return { url, secret };
}

function endpointUrl(baseUrl: URL, path: string): URL {
  const result = new URL(baseUrl.toString());
  const basePath = result.pathname.endsWith("/") ? result.pathname : `${result.pathname}/`;
  result.pathname = `${basePath}${path.slice(1)}`.replace(/\/+/g, "/");
  return result;
}

function stringCode(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim().toLowerCase() : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function upstreamCode(value: unknown): string | undefined {
  if (!isJsonObject(value)) return undefined;
  const record = value;
  const direct = stringCode(record.code);
  if (direct) return direct;
  if (!isJsonObject(record.detail)) return undefined;
  return stringCode(record.detail.code);
}

function mapUpstreamError(
  status: number,
  body: unknown,
  requestId: string,
  correlationId: string,
): PythonAdapterError {
  const code = upstreamCode(body);
  const attempts = upstreamEmbeddingAttempts(body);
  const providerStatus = upstreamProviderStatus(body);
  const providerDetail = upstreamProviderDetail(body);
  const domainDetails = upstreamDomainDetails(body);
  // The upstream domain code travels on the error so a caller can tell apart
  // failures that all classify as the same transport outcome (see
  // PythonAdapterError.domainCode).
  const upstream = (adapterCode: PythonAdapterErrorCode, adapterStatus: number): PythonAdapterError =>
    errorFor(adapterCode, adapterStatus, requestId, correlationId, attempts, code, providerStatus, providerDetail, domainDetails);
  if (status === 401 && (code === "nonce_replay" || code === "replay")) {
    return upstream("PYTHON_REPLAY", 401);
  }
  if (status === 408 || code === "deadline_exceeded") {
    return upstream("PYTHON_BACKEND_TIMEOUT", 504);
  }
  if (status === 499 || code === "client_cancelled") {
    return upstream("PYTHON_REQUEST_CANCELLED", 499);
  }
  if (status === 401) return upstream("PYTHON_AUTH_FAILED", 401);
  if (status === 403) return upstream("PYTHON_SCOPE_DENIED", 403);
  if (status === 413) return upstream("PYTHON_PAYLOAD_TOO_LARGE", 413);
  if (status === 422) return upstream("PYTHON_INVALID_REQUEST", 422);
  // El servicio SÍ respondió: dijo que está ocupado. Mezclarlo con "no se pudo contactar" le enseña al
  // cliente una causa que no es (`traducir-error-servidor.ts` lo lleva a SERVICIO_OCUPADO).
  if (status === 429) return upstream("PYTHON_BUSY", 429);
  if (status === 503 && code === "auth_unavailable") {
    return upstream("PYTHON_AUTH_UNAVAILABLE", 503);
  }
  if (status === 409) {
    if (code === "replay" || code === "nonce_replay" || code === "idempotency_replay") {
      return upstream("PYTHON_REPLAY", 409);
    }
    if (code === "conflict" || code === "idempotency_conflict") {
      return upstream("PYTHON_IDEMPOTENCY_CONFLICT", 409);
    }
    if (code === "in_flight" || code === "idempotency_in_flight") {
      return upstream("PYTHON_IDEMPOTENCY_IN_FLIGHT", 409);
    }
  }
  return upstream("PYTHON_UNAVAILABLE", status >= 500 ? 502 : status);
}

function readJsonObject(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

type DeadlinePython = ReturnType<typeof crearDeadlineSignal>;

interface PeticionPythonAbierta {
  response: Response;
  requestId: string;
  correlationId: string;
  /** Owned by the caller from here on: it must `dispose()` it once the body is consumed. */
  deadline: DeadlinePython;
}

function normalizarErrorPython(error: unknown, requestId: string, correlationId: string): PythonAdapterError {
  if (error instanceof PythonAdapterError) return error;
  if (error instanceof z.ZodError) return errorFor("PYTHON_INVALID_REQUEST", 422, requestId, correlationId);
  return errorFor("PYTHON_UNAVAILABLE", 502, requestId, correlationId);
}

/** Maps a failure while the request or its body was in flight, once the deadline signal may have fired. */
function errorDeTransporte(error: unknown, deadline: DeadlinePython, requestId: string, correlationId: string): PythonAdapterError {
  if (deadline.wasDeadlineExceeded()) return errorFor("PYTHON_BACKEND_TIMEOUT", 504, requestId, correlationId);
  if (deadline.signal.aborted) return errorFor("PYTHON_REQUEST_CANCELLED", 499, requestId, correlationId);
  if (error instanceof PythonAdapterError) return error;
  return errorFor("PYTHON_UNAVAILABLE", 502, requestId, correlationId);
}

/**
 * Shared Next -> Python boundary for every /internal/v1/* operation: HMAC
 * signing, deadline, nonce, idempotency headers and upstream error mapping
 * are identical across operations. Only `path` (which endpoint) and the
 * default `scope` (when the caller does not pass explicit scopes) vary.
 * Returns only OK responses; how the body is read (one JSON envelope, or an
 * NDJSON stream) is the caller's.
 */
async function abrirPeticionPython(
  path: string,
  defaultScope: string,
  input: PythonOperationInput,
): Promise<PeticionPythonAbierta> {
  const requestId = z.string().uuid().parse(input.requestId);
  const correlationId = z.string().uuid().parse(input.correlationId);
  const env = input.env ?? process.env;
  const { url: baseUrl, secret } = readPythonConfig(env, requestId, correlationId);
  const target = endpointUrl(baseUrl, path);
  const scopes = [...(input.scopes ?? [defaultScope])];
  const deadlineMs = normalizeDeadlineMs(input.deadlineMs);
  const parentSignal = input.parentSignal ?? new AbortController().signal;
  const deadline = crearDeadlineSignal(parentSignal, deadlineMs);
  const randomUUID = input.randomUUID ?? (() => crypto.randomUUID());
  const operationBody = input.operationBody ?? { payload: input.payload };
  const inputBodySha256 = input.bodySha256 ?? sha256Body(JSON.stringify(input.operationBody ?? input.payload));

  try {
    const context = OperationalContextV1Schema.parse({
      schema_version: "operational.v1",
      request_id: requestId,
      correlation_id: correlationId,
      deadline_at: new Date(deadline.deadlineAt).toISOString(),
      deadline_ms: deadlineMs,
      body_sha256: inputBodySha256,
      ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
      scopes,
    });
    const body = JSON.stringify({
      context,
      ...operationBody,
    });
    const maxBodyBytes = input.maxBodyBytes ?? PYTHON_MAX_BODY_BYTES;
    if (new TextEncoder().encode(body).byteLength > maxBodyBytes) {
      throw errorFor("PYTHON_PAYLOAD_TOO_LARGE", 413, requestId, correlationId);
    }

    const bodyHash = sha256Body(body);
    const signature = InternalRequestSignatureV1Schema.parse(firmarRequestInterna({
      secret,
      method: "POST",
      path: target.pathname,
      bodySha256: bodyHash,
      scopes,
      timestamp: Math.floor(Date.now() / 1000),
      nonce: randomUUID(),
    }));
    const headers = new Headers({
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-request-id": requestId,
      "x-correlation-id": correlationId,
      "x-deadline-ms": String(deadlineMs),
      "x-deadline-at": new Date(deadline.deadlineAt).toISOString(),
      "x-internal-schema-version": signature.schema_version,
      "x-internal-timestamp": String(signature.timestamp),
      "x-internal-nonce": signature.nonce,
      "x-internal-signature": signature.signature,
      "x-internal-scopes": signature.scopes.join(","),
    });
    if (input.idempotencyKey) headers.set("idempotency-key", input.idempotencyKey);

    let response: Response;
    try {
      response = await (input.fetchImpl ?? fetch)(target, {
        method: "POST",
        headers,
        body,
        signal: deadline.signal,
        cache: "no-store",
      });
    } catch (error) {
      throw errorDeTransporte(error, deadline, requestId, correlationId);
    }

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = undefined;
      }
      throw mapUpstreamError(response.status, errorBody, requestId, correlationId);
    }
    return { response, requestId, correlationId, deadline };
  } catch (error) {
    deadline.dispose();
    throw normalizarErrorPython(error, requestId, correlationId);
  }
}

/** `true` si el fallo es el cupo global de los motores, que se reintenta (ver `REINTENTOS_MOTOR_OCUPADO`). */
function esMotorOcupado(error: unknown): boolean {
  return isPythonAdapterError(error) && error.code === "PYTHON_BUSY" && error.domainCode === CODIGO_MOTOR_OCUPADO;
}

function esperar(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    // Un corte del llamante no deja el reintento esperando: se resuelve y el intento siguiente falla rápido
    // contra la señal ya abortada, que es donde el error correcto se forma.
    signal?.addEventListener("abort", () => { clearTimeout(id); resolve(); }, { once: true });
  });
}

async function llamarPythonOperacion(
  path: string,
  defaultScope: string,
  input: PythonOperationInput,
): Promise<PythonOperationResponse> {
  // El presupuesto es el de la llamada entera, no el de cada intento: `abrirPeticionPython` crea un deadline
  // nuevo por intento, así que sin esto tres reintentos triplicarían el plazo que pidió el llamante.
  const limite = Date.now() + normalizeDeadlineMs(input.deadlineMs);
  for (let intento = 0; ; intento += 1) {
    try {
      return await unaOperacionPython(path, defaultScope, input);
    } catch (error) {
      if (!esMotorOcupado(error) || intento >= REINTENTOS_MOTOR_OCUPADO || Date.now() >= limite) throw error;
      await esperar(ESPERA_MOTOR_OCUPADO_MS * (intento + 1), input.parentSignal);
    }
  }
}

async function unaOperacionPython(
  path: string,
  defaultScope: string,
  input: PythonOperationInput,
): Promise<PythonOperationResponse> {
  const { response, requestId, correlationId, deadline } = await abrirPeticionPython(path, defaultScope, input);
  try {
    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = undefined;
    }
    const parsed = responseSchema.safeParse(responseBody);
    const replayed = response.headers.get("x-idempotency-result") === "replay";
    if (
      !parsed.success ||
      (!replayed &&
        (parsed.data.request_id !== requestId || parsed.data.correlation_id !== correlationId))
    ) {
      throw errorFor("PYTHON_INVALID_RESPONSE", 502, requestId, correlationId);
    }
    return replayed ? { ...parsed.data, replayed: true } : parsed.data;
  } catch (error) {
    throw normalizarErrorPython(error, requestId, correlationId);
  } finally {
    deadline.dispose();
  }
}

/**
 * Streaming counterpart of `llamarPythonOperacion`: same signing and error
 * mapping, then yields each NDJSON line of the body as parsed JSON (not yet
 * validated -- that belongs to the operation). Returning early (the consumer
 * stopped, or the terminal event arrived) cancels the body reader, which
 * closes the connection; Python sees the disconnect and closes the provider
 * stream.
 */
async function* leerPythonNdjson(
  path: string,
  defaultScope: string,
  input: PythonOperationInput,
): AsyncGenerator<unknown, void, undefined> {
  const { response, requestId, correlationId, deadline } = await abrirPeticionPython(path, defaultScope, input);
  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.body || !contentType.startsWith("application/x-ndjson")) {
      throw errorFor("PYTHON_INVALID_RESPONSE", 502, requestId, correlationId);
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    const parsear = (linea: string): unknown => {
      try {
        return JSON.parse(linea) as unknown;
      } catch {
        throw errorFor("PYTHON_INVALID_RESPONSE", 502, requestId, correlationId);
      }
    };
    try {
      let pendiente = "";
      while (true) {
        let lectura: ReadableStreamReadResult<string>;
        try {
          lectura = await reader.read();
        } catch (error) {
          throw errorDeTransporte(error, deadline, requestId, correlationId);
        }
        if (lectura.done) break;
        pendiente += lectura.value;
        let salto = pendiente.indexOf("\n");
        while (salto >= 0) {
          const linea = pendiente.slice(0, salto).trim();
          pendiente = pendiente.slice(salto + 1);
          if (linea) yield parsear(linea);
          salto = pendiente.indexOf("\n");
        }
      }
      if (pendiente.trim()) yield parsear(pendiente.trim());
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  } catch (error) {
    throw normalizarErrorPython(error, requestId, correlationId);
  } finally {
    deadline.dispose();
  }
}

export async function llamarPythonEcho(input: PythonOperationInput): Promise<PythonOperationResponse> {
  return llamarPythonOperacion(PYTHON_ECHO_PATH, PYTHON_ECHO_SCOPE, input);
}

export interface PythonRerankCandidate {
  id: string;
  text: string;
}

export interface PythonRerankInput {
  query: string;
  candidates: PythonRerankCandidate[];
  requestId: string;
  correlationId: string;
  bodySha256?: string;
  deadlineMs?: number;
  idempotencyKey?: string;
  scopes?: readonly string[];
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonRerankResult {
  /** Candidate ids in reranked order -- always a permutation of the input ids. */
  order: string[];
  scores: Record<string, number>;
  replayed?: boolean;
}

export interface PythonEmbeddingInput {
  text: string;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  idempotencyKey?: string;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonEmbeddingResult {
  values: number[];
  model: string;
  dimensions: number;
  task_type: "RETRIEVAL_QUERY";
  attempts: PythonEmbeddingAttempt[];
  replayed?: boolean;
}

export interface PythonIntentParseInput {
  message: string;
  systemInstruction: string;
  /** `z.toJSONSchema(IntentQuerySchema, { target: "draft-7" })` -- Python stays schema-agnostic and just forwards this to Gemini. */
  responseJsonSchema: Record<string, unknown>;
  model?: string;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  idempotencyKey?: string;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonIntentParseUsage {
  prompt_token_count?: number;
  candidates_token_count?: number;
  thoughts_token_count?: number;
  cached_content_token_count?: number;
  total_token_count?: number;
}

export interface PythonIntentParseResult {
  text: string;
  model: string;
  usage: PythonIntentParseUsage | null;
  replayed?: boolean;
}

export type PythonHappieGeneratePurpose = "conversation_extract" | "package_recommend";

export interface PythonHappieGenerateInput {
  purpose: PythonHappieGeneratePurpose;
  /** Text parts of the single user message, in order. */
  parts: string[];
  systemInstruction: string;
  /** Already adapted with `paraGoogleSchema`; Python forwards it to Gemini untouched. */
  responseJsonSchema: Record<string, unknown>;
  model?: string;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonHappieGenerateUsage extends PythonIntentParseUsage {
  tool_use_prompt_token_count?: number;
}

export interface PythonHappieGenerateResult {
  text: string;
  model: string;
  usage: PythonHappieGenerateUsage | null;
}

export interface PythonReferenceTurnImage {
  id: string;
  mime: "image/png" | "image/jpeg" | "image/webp";
  base64: string;
  descripcion?: string;
}

export interface PythonReferenceTurnTool {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export interface PythonReferenceTurnInput {
  systemInstruction: string;
  message: string;
  images: PythonReferenceTurnImage[];
  tools: PythonReferenceTurnTool[];
  temperature?: number;
  maxOutputTokens?: number;
  model?: string;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  idempotencyKey?: string;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonReferenceTurnToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface PythonReferenceTurnResult {
  text: string;
  toolCalls: PythonReferenceTurnToolCall[];
  model: string;
  usage: PythonIntentParseUsage | null;
  finishReason: string | null;
  blockReason: string | null;
  replayed?: boolean;
}

/** A balloon structure the reference analysis found in one photo. */
export interface PythonPatronReferenciaElemento {
  elementId: string;
  /** Plan structure type (`visual_semantics.structure_type`) or "desconocido"; context for the model only. */
  tipo: string;
  bbox?: { x: number; y: number; width: number; height: number };
  coloresObservados: string[];
}

export interface PythonPatronReferenciaInput {
  imagen: { mimeType: "image/png" | "image/jpeg" | "image/webp"; dataBase64: string };
  /** 1..12, unique ids, all from the same photo as `imagen`. */
  elementos: PythonPatronReferenciaElemento[];
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

/** A bouquet the reference analysis found in one photo (ADR-0030). */
export interface PythonBouquetReferenciaElemento {
  elementId: string;
  bbox?: { x: number; y: number; width: number; height: number };
  coloresObservados: string[];
}

export interface PythonBouquetReferenciaInput {
  imagen: { mimeType: "image/png" | "image/jpeg" | "image/webp"; dataBase64: string };
  /** 1..12, unique ids, all from the same photo as `imagen`. */
  elementos: PythonBouquetReferenciaElemento[];
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

/** One reading as Python validated it: the assembly of one bouquet. */
export type PythonBouquetReferenciaLectura = z.infer<typeof bouquetReferenciaLecturaSchema>;

export interface PythonBouquetReferenciaResult {
  lecturas: PythonBouquetReferenciaLectura[];
  modelo: string;
  promptVersion: string;
  usage: z.infer<typeof bouquetReferenciaPayloadResultSchema>["usage"];
  replayed?: boolean;
}

/** A balloon structure the reference analysis found in one photo, to be counted (ADR-0031). */
export interface PythonConteoReferenciaElemento {
  elementId: string;
  /** Plan structure type (`visual_semantics.structure_type`) or "desconocido". */
  tipo: string;
  /** The official structure the chat would give it (`identificarEstructuraOficial`), when there is one. */
  estructuraOficial?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  /** Identical pieces the element stands for ("2 columns"); Python counts one. Omitted when 1. */
  piezas?: number;
}

export interface PythonConteoReferenciaInput {
  imagen: { mimeType: "image/png" | "image/jpeg" | "image/webp"; dataBase64: string };
  /** 1..12, unique ids, all from the same photo as `imagen`. */
  elementos: PythonConteoReferenciaElemento[];
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

/** One reading as Python validated it: the balloon count of one piece. */
export type PythonConteoReferenciaLectura = z.infer<typeof conteoReferenciaLecturaSchema>;

/** A garland the reference analysis found in one photo (ADR-0032, E4). */
export interface PythonGuirnaldaReferenciaElemento {
  elementId: string;
  bbox?: { x: number; y: number; width: number; height: number };
  coloresObservados: string[];
}

/** Another balloon piece of the same photo: a garland may be wrapped around it. */
export interface PythonGuirnaldaReferenciaOtra {
  elementId: string;
  tipo: string;
  bbox?: { x: number; y: number; width: number; height: number };
}

export interface PythonGuirnaldaReferenciaInput {
  imagen: { mimeType: "image/png" | "image/jpeg" | "image/webp"; dataBase64: string };
  /** 1..12, unique ids, all from the same photo as `imagen`. */
  elementos: PythonGuirnaldaReferenciaElemento[];
  /** 0..12 other balloon pieces of the photo; ids distinct from `elementos`. */
  otras: PythonGuirnaldaReferenciaOtra[];
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

/** One reading as Python validated it: how one garland is built. */
export type PythonGuirnaldaReferenciaLectura = z.infer<typeof guirnaldaReferenciaLecturaSchema>;

export interface PythonGuirnaldaReferenciaResult {
  lecturas: PythonGuirnaldaReferenciaLectura[];
  modelo: string;
  promptVersion: string;
  usage: z.infer<typeof guirnaldaReferenciaPayloadResultSchema>["usage"];
  replayed?: boolean;
}

export interface PythonConteoReferenciaResult {
  lecturas: PythonConteoReferenciaLectura[];
  modelo: string;
  promptVersion: string;
  usage: z.infer<typeof conteoReferenciaPayloadResultSchema>["usage"];
  replayed?: boolean;
}

/**
 * One element of the reference analysis with the four raw readings the SAME
 * vision call wrote for it (variant `v17-lectura-unica`). The blocks travel
 * unvalidated on purpose: Python validates each one with the validator of the
 * production reading that owns it.
 */
export interface PythonLecturaUnicaElemento {
  elementId: string;
  /**
   * Plan structure type (`visual_semantics.structure_type`) or "desconocido".
   * The only element field any of the four validations reads (it decides
   * whether a column's `remate` is kept); the rest were the prompts' context,
   * and the prompt already saw them in the same call.
   */
  tipo: string;
  /** This piece may host a garland (`sobre_estructura`). */
  anfitrionaPosible?: boolean;
  patron?: Record<string, unknown>;
  conteo?: Record<string, unknown>;
  armadoBouquet?: Record<string, unknown>;
  armadoGuirnalda?: Record<string, unknown>;
}

export interface PythonLecturaUnicaInput {
  imagen: { mimeType: "image/png" | "image/jpeg" | "image/webp"; dataBase64: string };
  /** 1..12, unique ids, all from the same photo as `imagen`. */
  elementos: PythonLecturaUnicaElemento[];
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonLecturaUnicaResult {
  pistas: PythonPatronReferenciaPista[];
  conteos: PythonConteoReferenciaLectura[];
  armadosBouquet: PythonBouquetReferenciaLectura[];
  armadosGuirnalda: PythonGuirnaldaReferenciaLectura[];
  validadorVersion: string;
  replayed?: boolean;
}

/** One hint as Python validated it; "ninguno" carries no colors. */
export type PythonPatronReferenciaPista = z.infer<typeof patronReferenciaPistaSchema>;

export interface PythonPatronReferenciaResult {
  pistas: PythonPatronReferenciaPista[];
  modelo: string;
  promptVersion: string;
  usage: PythonIntentParseUsage | null;
  replayed?: boolean;
}

export interface PythonLoraSpec {
  path: string;
  scale: number;
}

export interface PythonLoraGenerateInput {
  mode: "text" | "edit";
  prompt: string;
  loras: PythonLoraSpec[];
  guidanceScale: number;
  numInferenceSteps: number;
  imageWidth: number;
  imageHeight: number;
  seed?: number;
  /** `data:<mime>;base64,<...>` strings, already built by referenciasParaLoraEdit's caller -- empty for mode "text". */
  imageDataUrls: string[];
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  idempotencyKey?: string;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonLoraGenerateResult {
  imageBase64: string;
  mime: string;
  providerRequestId: string | null;
  endpoint: string;
  replayed?: boolean;
}

export interface PythonChatTurnTool {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

/**
 * No `idempotencyKey`: the Python route rejects one, because replaying a
 * streamed turn would repeat text the customer already saw and a provider
 * charge (see `_handle_operational_stream` in services/ai-api/app/main.py).
 */
export interface PythonChatTurnStreamInput {
  systemInstruction: string;
  /** Gemini `Content` JSON exactly as `historialAContents` (agente-core) builds it. */
  contents: unknown[];
  tools: PythonChatTurnTool[];
  thinkingLevel?: "low" | "minimal";
  temperature?: number;
  maxOutputTokens?: number;
  model?: string;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonCatalogSearchFilters {
  available?: boolean;
  price_max?: number;
  categories?: string[];
  occasions?: string[];
  colors?: string[];
  finishes?: string[];
  shapes?: string[];
  diameters_inches?: number[];
}

export interface PythonCatalogSearchAllowlistEntry {
  product_id: string;
  variant_ids: string[];
}

export interface PythonCatalogSearchInput {
  message: string;
  filters: PythonCatalogSearchFilters;
  allowlist: PythonCatalogSearchAllowlistEntry[];
  limit?: number;
  catalogSnapshotId?: string;
  /** Recall by `filters` alone; `message` is only a label (the editor's explorer without text). */
  browse?: boolean;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  idempotencyKey?: string;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonCatalogSearchResult {
  status: "OK" | "NO_MATCH" | "AMBIGUOUS_SKU";
  sku_status: "not_sku" | "unique" | "ambiguous" | "not_found" | "filtered_out" | null;
  candidates: Array<{
    product_id: string;
    title: string;
    category: string | null;
    colors: string[];
    finishes: string[];
    occasions: string[];
    available: boolean;
    image: string | null;
    score: number;
    variants: Array<{
      variant_id: string;
      sku: string | null;
      title: string | null;
      price: number;
      available: boolean;
      size_code: string | null;
      diameter_inches: number | null;
      shape: string | null;
      colors: string[];
    }>;
  }>;
  whitelist: PythonCatalogSearchAllowlistEntry[];
  catalog_snapshot_id: string | null;
  latency_parse_ms: number;
  latency_retrieval_ms: number;
  color_substitutions?: Array<{ pedido: string; entregado: string }>;
  replayed?: boolean;
}

export interface PythonCatalogColorsInput {
  /** Empty means unrestricted; a restricted mode with no entries fails closed before calling. */
  allowlist: PythonCatalogSearchAllowlistEntry[];
  catalogSnapshotId?: string;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export type PythonCatalogColorsResult = z.infer<typeof CatalogColorsResultV1Schema> & {
  replayed?: boolean;
};

export interface PythonCatalogSelectionInput {
  items: Array<{
    product_id: string;
    variant_id: string;
    quantity: number;
    reason?: string;
  }>;
  allowlist: PythonCatalogSearchAllowlistEntry[];
  catalogSnapshotId?: string;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  idempotencyKey?: string;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonCatalogSelectionResult {
  status: "ok" | "partial" | "empty";
  catalog_snapshot_id: string | null;
  validados: Array<{
    product_id: string;
    variant_id: string;
    sku: string | null;
    product_title: string;
    title: string;
    unit_price_cop: number;
    quantity: number;
    subtotal_cop: number;
    image_url: string | null;
    handle: string | null;
    product_type: string | null;
    category: string | null;
    colors: string[];
    description: string | null;
    units_per_package: number | null;
    size_code: string | null;
    shape: string | null;
    diameter_inches: number | null;
  }>;
  rechazados: Array<{
    product_id: string;
    variant_id: string;
    reason: string;
  }>;
  total_cop: number;
  replayed?: boolean;
}

export interface PythonPlanResolutionInput {
  plan: PlanDecoracion;
  allowlist: PythonCatalogSearchAllowlistEntry[];
  catalogSnapshotId: string;
  /** Absent unless the caller passes it: every other request stays byte-identical (ADR-0028 §7). */
  completarPatrones?: boolean;
  pistasPatron?: PistaPatron[];
  pistasTamanos?: PistaTamanos[];
  /** Absent unless the caller passes it (ADR-0030): same byte-identical rule. */
  completarArmados?: boolean;
  pistasArmado?: PistaArmado[];
  completarArmadosDe?: string[];
  /** Absent unless the caller passes it (ADR-0032): same byte-identical rule. */
  completarArmadosGuirnalda?: boolean;
  /** Absent unless the caller passes it (ADR-0032, E4): the garland readings of the photo. */
  pistasGuirnalda?: PistaGuirnalda[];
  /** Absent unless the caller passes it (ADR-0031): same byte-identical rule. */
  completarConteos?: boolean;
  pistasConteo?: PistaConteo[];
  completarConteosDe?: string[];
  /** With `completarConteos`: the customer gave measures, so the structures' declared measures stay (ADR-0031). */
  medidasDelCliente?: boolean;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  idempotencyKey?: string;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export type PythonPlanResolutionResult = z.infer<typeof PlanResolutionResultV1Schema> & {
  replayed?: boolean;
};

export interface PythonCatalogRecommendationsInput {
  referenceVariantId: string;
  catalogSnapshotId: string;
  limit?: number;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export type PythonCatalogRecommendationsResult = z.infer<typeof CatalogRecommendationsResultV1Schema> & {
  replayed?: boolean;
};

/** A resolved line of the edited structure, as the verified base resolution printed it. */
export interface PythonPlanEditLineaBase {
  product_id: string;
  variant_id: string;
  color: string | null;
}

export interface PythonPlanEditInput {
  plan: PlanDecoracion;
  lineasBase: ReadonlyArray<{ estructura_id: string; lineas: readonly PythonPlanEditLineaBase[] }>;
  edicion: EdicionPlan;
  /** Real colors of the variant admitted for "agregar"/"reemplazar"; empty otherwise. */
  coloresVariante: readonly string[];
  /** `PATRONES_COLOR_V1`: a piece going from one color to two gets its preset pattern. */
  completarPatrones: boolean;
  /** `BOUQUETS_ARMADO_V1`: the notice of a removed assembly says it is suggested again (ADR-0030). */
  completarArmados?: boolean;
  /** `GUIRNALDAS_ARMADO_V1`: the same for a garland's assembly (ADR-0032). */
  completarArmadosGuirnalda?: boolean;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonPlanEditResult {
  plan: PlanDecoracion;
  /** Sentences for the decorator (e.g. "El patrón se rehízo porque quitaste un color."). */
  avisos: string[];
  replayed?: boolean;
}

/** Same bound as a structure's base lines in plan-edit.v1 (`MAX_LINEAS_PIEZA` in plan_edicion.py). */
export const PYTHON_PLAN_PATRON_MAX_LINEAS = 256;

/**
 * One resolved line of the previewed structure, as the browser holds it in
 * `PlanResuelto.estructuras[].lineas`, reduced to what says what is bought
 * (`LineaComprada` in services/ai-api/app/plan_edicion.py). A naming hint
 * only: Python reads from the lines which color each material buys after a
 * replacement (ADR-0028 §8, §10); it never counts or prices with them.
 */
export const PythonPlanPatronLineaSchema = z.object({
  product_id: z.string().min(1).max(160),
  variant_id: z.string().min(1).max(160),
  color: z.string().max(160).nullable(),
  acabado: z.string().max(160).nullable().optional(),
  unidades: z.number().int().min(1).max(1_000_000),
  diam_pulg: z.number().min(0).max(100).nullable().optional(),
}).strict();
export type PythonPlanPatronLinea = z.infer<typeof PythonPlanPatronLineaSchema>;
export const PythonPlanPatronLineasSchema = z.array(PythonPlanPatronLineaSchema).max(PYTHON_PLAN_PATRON_MAX_LINEAS);

export interface PythonPlanPatronInput {
  plan: PlanDecoracion;
  estructuraId: string;
  /** `null` asks for the suggested pattern of a structure. */
  patronColor: PatronColor | null;
  /**
   * The colors slider over a confeti, while dragging (with `patronColor`
   * null): Python applies the same `repartir` the edit will, without saving.
   */
  participaciones?: readonly number[];
  /** With `patronColor` null: the starting point of that style instead of the preset. */
  modo?: ModoPatronColor;
  /**
   * With `modo`: the editor's current draft. Python keeps from it what the
   * new style admits (cluster size, direction, mirror, accents).
   */
  desde?: PatronColor;
  /**
   * The structure's resolved lines (any of the above): Python names each
   * color by what is bought, as resolution does. Only the fields of
   * `PythonPlanPatronLineaSchema` travel.
   */
  lineas?: readonly PythonPlanPatronLinea[];
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonPlanPatronResult {
  patron: PatronColorResuelto;
  /** The styles the editor may offer for this structure, decided by Python. */
  modos_admitidos: ModoAdmitido[];
  replayed?: boolean;
}

/** Plan 1.1 allows up to 12 materials per structure (`MAX_GLOBOS_PIEZA` in plan_edicion.py). */
export const PYTHON_PLAN_ARMADO_MAX_GLOBOS = 12;

/**
 * What the browser knows of one balloon of the bouquet, from
 * `PlanResuelto.estructuras[].lineas` (`GloboNavegador` in
 * services/ai-api/app/plan_edicion.py). It only classifies each material
 * (latex, foil, bubble or number, and its size) the way the catalog does at
 * resolution; the counts are the plan's own. Never a price.
 */
export const PythonPlanArmadoGloboSchema = z.object({
  product_id: z.string().min(1).max(160),
  variant_id: z.string().min(1).max(160),
  titulo: z.string().max(400),
  forma: z.string().max(40).nullable().optional(),
  diam_pulg: z.number().min(0).max(100).nullable().optional(),
  tamano_codigo: z.string().max(40).nullable().optional(),
  color: z.string().max(160).nullable().optional(),
  acabado: z.string().max(160).nullable().optional(),
}).strict();
export type PythonPlanArmadoGlobo = z.infer<typeof PythonPlanArmadoGloboSchema>;
export const PythonPlanArmadoGlobosSchema = z.array(PythonPlanArmadoGloboSchema).min(1).max(PYTHON_PLAN_ARMADO_MAX_GLOBOS);

export interface PythonPlanArmadoInput {
  plan: PlanDecoracion;
  estructuraId: string;
  /** `null` asks for the recipe of the bouquet (ADR-0030). */
  armadoBouquet: ArmadoBouquetV1 | null;
  /** The bouquet's balloons as the browser holds them; only the contract fields travel. */
  globos: readonly PythonPlanArmadoGlobo[];
  /** With `armadoBouquet` null: the style the decorator chose. */
  variante?: VarianteBouquet;
  /** With `armadoBouquet` null: where the decorator put the numbers. */
  disposicion?: DisposicionNumero;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonPlanArmadoResult {
  armado: ArmadoBouquetResuelto;
  /** The styles and number placements the editor may offer, decided by Python from the purchase. */
  variantes_admitidas: VarianteBouquet[];
  disposiciones_admitidas: DisposicionNumero[];
  replayed?: boolean;
}

/**
 * One resolved line of the previewed garland (`LineaGuirnalda` in
 * services/ai-api/app/plan_edicion.py): the pattern preview's line plus the
 * size code, with which Python names each code of the legend as at
 * resolution. It only names; the counts are the plan's own.
 */
export const PythonPlanArmadoGuirnaldaLineaSchema = PythonPlanPatronLineaSchema.extend({
  tamano_codigo: z.string().max(40).nullable().optional(),
}).strict();
export type PythonPlanArmadoGuirnaldaLinea = z.infer<typeof PythonPlanArmadoGuirnaldaLineaSchema>;
export const PythonPlanArmadoGuirnaldaLineasSchema = z.array(PythonPlanArmadoGuirnaldaLineaSchema).max(PYTHON_PLAN_PATRON_MAX_LINEAS);

export { OpcionesArmadoGuirnaldaSchema, type OpcionesArmadoGuirnalda };

export interface PythonPlanArmadoGuirnaldaInput {
  plan: PlanDecoracion;
  estructuraId: string;
  /** `null` asks for the recipe of the garland (ADR-0032). */
  armadoGuirnalda: ArmadoGuirnaldaV1 | null;
  /** The garland's resolved lines as the browser holds them; only the contract fields travel. */
  lineas?: readonly PythonPlanArmadoGuirnaldaLinea[];
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonPlanArmadoGuirnaldaResult {
  armado: ArmadoGuirnaldaResuelto;
  opciones: OpcionesArmadoGuirnalda;
  replayed?: boolean;
}

export { LimitesArcoSchema, OpcionesArmadoArcoSchema, type LimitesArco, type OpcionesArmadoArco };
export { LimitesColumnaSchema, OpcionesArmadoColumnaSchema, type LimitesColumna, type OpcionesArmadoColumna };

export interface PythonPlanArmadoColumnaInput {
  plan: PlanDecoracion;
  estructuraId: string;
  /** `null` asks for the recipe of the column (ADR-0034). */
  armadoColumna: ArmadoColumnaV1 | null;
  /**
   * The piece's tones as `#rrggbb`, one per material and in its order, as the
   * browser holds them once the catalog resolved them. Optional: without them
   * Python draws in its neutral grey and says so in the column's `avisos`. They
   * only paint -- the count goes by material index.
   */
  colores?: readonly string[];
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonPlanArmadoColumnaResult {
  columna: ColumnaResuelta;
  /** The engine's own drawing: the canvas and the `<svg>` interior. Derived, never part of `plan_hash`. */
  grafica: VistaColumna["grafica"];
  /** The assembly it was resolved with, so the editor can keep the recipe it asked for. */
  armado: ArmadoColumnaV1;
  opciones: OpcionesArmadoColumna;
  limites: LimitesColumna;
  replayed?: boolean;
}

export interface PythonPlanArmadoArcoInput {
  plan: PlanDecoracion;
  estructuraId: string;
  /** `null` asks for the recipe of the arch (ADR-0034). */
  armadoArco: ArmadoArcoV1 | null;
  /**
   * The piece's tones as `#rrggbb`, one per material and in its order, as the
   * browser holds them once the catalog resolved them. Optional: without them
   * Python draws in its neutral grey and says so in the arch's `avisos`. They
   * only paint -- the count and the purchase go by material index.
   */
  colores?: readonly string[];
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonPlanArmadoArcoResult {
  arco: ArcoResuelto;
  /** The engine's own drawing: the canvas side and the `<svg>` interior. Derived, never part of `plan_hash`. */
  grafica: VistaArco["grafica"];
  /** The assembly it was resolved with, so the editor can keep the recipe it asked for. */
  armado: ArmadoArcoV1;
  opciones: OpcionesArmadoArco;
  limites: LimitesArco;
  replayed?: boolean;
}

export {
  LimitesArcoOrganicoSchema,
  OpcionesArmadoArcoOrganicoSchema,
  type LimitesArcoOrganico,
  type OpcionesArmadoArcoOrganico,
  type VistaArcoOrganico,
};

export interface PythonPlanArmadoArcoOrganicoInput {
  plan: PlanDecoracion;
  estructuraId: string;
  /** `null` asks for the recipe of the arch (ADR-0034). */
  armadoArcoOrganico: ArmadoArcoOrganicoV1 | null;
  /**
   * The piece's tones as `#rrggbb`, one per material and in its order, as the
   * browser holds them once the catalog resolved them. Optional: without them
   * Python draws in its neutral grey and says so in the arch's `avisos`. They
   * only paint -- the count and the purchase go by material index.
   */
  colores?: readonly string[];
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonPlanArmadoArcoOrganicoResult {
  arco: ArcoOrganicoResuelto;
  /** The engine's own drawing. Its canvas is square, and both sides travel because both are what Python publishes. Derived, never part of `plan_hash`. */
  grafica: VistaArcoOrganico["grafica"];
  /** The assembly it was resolved with, so the editor can keep the recipe it asked for. */
  armado: ArmadoArcoOrganicoV1;
  opciones: OpcionesArmadoArcoOrganico;
  limites: LimitesArcoOrganico;
  replayed?: boolean;
}

export {
  LimitesColumnaOrganicaSchema,
  OpcionesArmadoColumnaOrganicaSchema,
  type LimitesColumnaOrganica,
  type OpcionesArmadoColumnaOrganica,
  type VistaColumnaOrganica,
};

export interface PythonPlanArmadoColumnaOrganicaInput {
  plan: PlanDecoracion;
  estructuraId: string;
  /** `null` asks for the recipe of the column (ADR-0034). */
  armadoColumnaOrganica: ArmadoColumnaOrganicaV1 | null;
  /**
   * The piece's tones as `#rrggbb`, one per material and in its order, as the
   * browser holds them once the catalog resolved them. Optional: without them
   * Python draws in its neutral grey and says so in the column's `avisos`.
   * They only paint -- the count and the purchase go by material index.
   */
  colores?: readonly string[];
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonPlanArmadoColumnaOrganicaResult {
  columna: ColumnaOrganicaResuelta;
  /** The engine's own drawing. Its canvas is not square, so both sides travel. Derived, never part of `plan_hash`. */
  grafica: VistaColumnaOrganica["grafica"];
  /** The assembly it was resolved with, so the editor can keep the recipe it asked for. */
  armado: ArmadoColumnaOrganicaV1;
  opciones: OpcionesArmadoColumnaOrganica;
  limites: LimitesColumnaOrganica;
  replayed?: boolean;
}

export {
  LimitesGuirnaldaOrganicaSchema,
  OpcionesArmadoGuirnaldaOrganicaSchema,
  type LimitesGuirnaldaOrganica,
  type OpcionesArmadoGuirnaldaOrganica,
  type VistaGuirnaldaOrganica,
};

export interface PythonPlanArmadoGuirnaldaOrganicaInput {
  plan: PlanDecoracion;
  estructuraId: string;
  /** `null` asks for the recipe of the garland (ADR-0034). */
  armadoGuirnaldaOrganica: ArmadoGuirnaldaOrganicaV1 | null;
  /**
   * The piece's tones as `#rrggbb`, one per material and in its order, as the
   * browser holds them once the catalog resolved them. Optional: without them
   * Python draws in its neutral grey and says so in the garland's `avisos`.
   * They only paint -- the count and the purchase go by material index.
   */
  colores?: readonly string[];
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonPlanArmadoGuirnaldaOrganicaResult {
  guirnalda: GuirnaldaOrganicaResuelta;
  /** The engine's own drawing. Its canvas is not square, so both sides travel. Derived, never part of `plan_hash`. */
  grafica: VistaGuirnaldaOrganica["grafica"];
  /** The assembly it was resolved with, so the editor can keep the recipe it asked for. */
  armado: ArmadoGuirnaldaOrganicaV1;
  opciones: OpcionesArmadoGuirnaldaOrganica;
  limites: LimitesGuirnaldaOrganica;
  replayed?: boolean;
}

export interface PythonPlanDibujoEstructuraInput {
  plan: PlanDecoracion;
  estructuraId: string;
  /**
   * The piece's real size mix, copied from
   * `plan_resuelto.estructuras[].mezcla_real`. The drawing spreads the balloon
   * sizes in that proportion; it is NOT recomputed here nor in Python, because
   * the piece has one count and it is `plan.py`'s.
   */
  mezclaReal?: readonly { diam_pulg: number; forma: string | null; unidades: number; pct: number }[];
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonPlanGuiaEscenaInput {
  /** The approved plan as resolved (`plan_resuelto.plan`), with the assemblies the engines resolve. */
  plan: PlanResuelto["plan"];
  /**
   * What the resolution already knows of each piece (`mezclas[]` of `plan-guia-escena.v1`): its `mezcla_real`,
   * the catalog of its lines, its bouquet legend and the photo box aspect. Derived; Python never recomputes it.
   */
  mezclas?: ReadonlyArray<NonNullable<PlanGuiaEscenaRequestV1["mezclas"]>[number]>;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonPlanGuiaEscenaResult {
  resultado: PlanGuiaEscenaResultV1;
  replayed?: boolean;
}

export interface PythonPlanDibujoEstructuraResult {
  /** The schematic drawing: both canvas sides and the `<svg>` interior. Derived, never part of `plan_hash`. */
  grafica: GraficaDibujoEstructura;
  replayed?: boolean;
}

/**
 * The chat agent's engine tools (ADR-0034 §5). Three calls on one operation
 * because they are the same work seen from three moments of the turn: what the
 * model may use, one assembly it wants to try, and -- when the plan is
 * confirmed -- the assembly of every arch and column that has none.
 *
 * Python decides all three. Next sends the facts (`pieza`) and writes the
 * answer into the plan; it never picks a pattern nor fills a default.
 */
interface OmoikaneArmadoComun {
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonOmoikaneCatalogoArmadoInput extends OmoikaneArmadoComun {
  tipo: TipoArmadoMotor;
}

export interface PythonOmoikaneArmarEstructuraInput extends OmoikaneArmadoComun {
  /** What the piece says of itself; the geometry defaults come from here. */
  pieza: PiezaArmado;
  /**
   * Arch and column only: an organic garland has no pattern. What defines it is its line, its volume, its
   * size mix and its palette, which travel in the fields below.
   */
  patron?: string;
  /** Arch and column: material indices of the structure, in order; the first is the main color. */
  materiales?: readonly number[];
  /** Arch and column: the pattern's own knobs. Out of range they are clamped by the engine, with a notice. */
  opciones?: Readonly<Record<string, number>>;
  geometria?: GeometriaPedida;
  /** Column only. */
  remate?: RematePedido;
  /** Garland only: each color with its finish and its role. */
  paleta?: readonly ColorPedido[];
  reparto?: string;
  mezclaColores?: number;
  /** Id de la forma lista del catálogo del motor; la puerta de Python valida que exista. */
  formaLista?: string;
  estilo?: string;
  forma?: FormaPedida;
  volumen?: VolumenPedido;
  tamanos?: readonly PesoTamano[];
  adornos?: AdornosPedidos;
  /** The structure of the plan being assembled, when the turn already has one; travels for the refusal's text. */
  estructuraId?: string;
}

/**
 * The line of one garland as the photo read it (`LecturaGuirnaldaSchema`, ADR-0032 decisions 27-29), in the
 * reading's own relative units, addressed to the reference element it belongs to. Python translates it with the
 * same function as the by-parts assembly (`armado_guirnalda.linea_de_lectura`), so both garlands read the same
 * photo the same way. Until 2026-10-05 only `sentido` and `flecha` travelled and the height difference between
 * the ends was lost. The Python model (`CurvaPistaFoto`) keeps every field but the element optional, so a body
 * with only `sentido` and `flecha` is still read as before.
 */
export type PistaCurvaGuirnalda = {
  referencia_element_id: string;
  soporte: PistaGuirnalda["soporte"];
  forma: PistaGuirnalda["forma"];
  confianza: number;
  puntos_de_anclaje?: number;
  /** Which way the centre line leaves the straight line between the ends; travels with `flecha`. */
  sentido?: "arriba" | "abajo";
  /** How far, as a fraction of the horizontal length. */
  flecha?: number;
  /** Right end minus left end, as a fraction of the horizontal length (negative: lower on the right). */
  desnivel?: number;
  /** A v2 reading's drop (it only knew how to hang); never together with `sentido`/`flecha`. */
  caida?: number;
};

export interface PythonOmoikaneCompletarArmadosInput extends OmoikaneArmadoComun {
  plan: PlanDecoracion;
  /** What the model assembled during the turn, to be revalidated against the real piece. */
  armados?: readonly {
    estructura_id: string;
    tipo: TipoArmadoMotor;
    armado: ArmadoArcoV1 | ArmadoColumnaV1 | ArmadoGuirnaldaOrganicaV1;
  }[];
  /**
   * What the photo read about each reference element's colour pattern (ADR-0028 s7), with which the recipe
   * picks the engine's pattern instead of counting colours (ADR-0039). Same readings as `pistas_patron` in
   * the resolution: one per element, applied by Python to every structure that materialises it.
   */
  pistas?: readonly PistaPatron[];
  /**
   * What the photo read about each column's topper (ADR-0039). A column that is not here keeps the engine's
   * topper: absent means "the top is not visible", and `{ tipo: "ninguno" }` means "it carries nothing".
   */
  remates?: readonly PistaRemate[];
  /** How far each piece leans and to which side, as a signed fraction of its height (ADR-0039). */
  inclinaciones?: readonly { referencia_element_id: string; inclinacion: number }[];
  /**
   * The line of each garland as the photo read it: its shape, support and anchor points, how it curves away
   * from the straight line between its ends and how much lower or higher one end is (ADR-0032, decisions 27-29).
   */
  curvas?: readonly PistaCurvaGuirnalda[];
  /**
   * What sizes of balloon the photo read in each piece. It travels here as well as to the resolution
   * because the engine assembles BEFORE the plan is resolved: with the reading reaching only `plan.py`,
   * the piece was drawn with the declared mix and charged with the read one. Both branches translate it
   * with the same function, so they cannot disagree.
   */
  tamanosLeidos?: readonly PistaTamanos[];
}

export interface PythonOmoikaneCatalogoArmadoResult {
  catalogo: CatalogoArmado;
  replayed?: boolean;
}

export interface PythonOmoikaneArmarEstructuraResult {
  armado: ArmadoDeIa;
  replayed?: boolean;
}

export interface PythonOmoikaneCompletarArmadosResult {
  armados: ArmadoCompletado[];
  replayed?: boolean;
}

const omoikaneArmadoCatalogoResultSchema = z.object({
  operation_schema_version: z.literal("omoikane-armado-estructura-result.v1"),
  accion: z.literal("catalogo"),
}).and(CatalogoArmadoSchema);

const omoikaneArmadoArmarResultSchema = z.object({
  operation_schema_version: z.literal("omoikane-armado-estructura-result.v1"),
  accion: z.literal("armar"),
}).and(ArmadoDeIaSchema);

const omoikaneArmadoCompletarResultSchema = z.object({
  operation_schema_version: z.literal("omoikane-armado-estructura-result.v1"),
  accion: z.literal("completar"),
  armados: z.array(ArmadoCompletadoSchema).max(8),
}).strict();

const rerankPayloadResultSchema = z.object({
  order: z.array(z.string().min(1)),
  scores: z.record(z.string().min(1), z.number().finite()),
});

const intentParseUsageSchema = z.object({
  prompt_token_count: z.number().int().nonnegative().optional(),
  candidates_token_count: z.number().int().nonnegative().optional(),
  thoughts_token_count: z.number().int().nonnegative().optional(),
  cached_content_token_count: z.number().int().nonnegative().optional(),
  total_token_count: z.number().int().nonnegative().optional(),
}).strict();

const intentParsePayloadResultSchema = z.object({
  text: z.string().min(1),
  model: z.string().min(1),
  usage: intentParseUsageSchema.nullable(),
}).strict();

const happieGeneratePayloadResultSchema = z.object({
  text: z.string().min(1),
  model: z.string().min(1),
  usage: intentParseUsageSchema.extend({
    tool_use_prompt_token_count: z.number().int().nonnegative().optional(),
  }).strict().nullable(),
}).strict();

const referenceTurnToolCallSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
}).strict();

const referenceTurnPayloadResultSchema = z.object({
  text: z.string(),
  tool_calls: z.array(referenceTurnToolCallSchema),
  model: z.string().min(1),
  usage: intentParseUsageSchema.nullable(),
  finish_reason: z.string().nullable(),
  block_reason: z.string().nullable(),
}).strict();

// Local contract (ADR-0026 §3): the Pydantic side is
// services/ai-api/app/amaterasu/patron_referencia.py, which owns the prompt,
// the palette and the validation of the provider output.
//
// Derived from the contract's own `PistaPatronSchema` instead of re-typed here.
// A hand-written copy drifted once and cost the whole feature: ADR-0036 added
// `zonas` to the contract and to Python, this copy was not updated, and because
// it is `.strict()` every reading that carried patches failed with
// PYTHON_INVALID_RESPONSE — so the `zonas` mode never once ran from a photo.
// `.omit().extend()` keeps the strictness; a new contract field arrives here on
// its own.
const patronReferenciaPistaSchema = PistaPatronSchema
  .omit({ referencia_element_id: true, modo: true, colores: true })
  .extend({
    element_id: z.string().min(1).max(80),
    // "ninguno" is not a contract mode: the reader sends it when the photo shows
    // no pattern, and only then may the hint come without colors.
    // "ninguno" y "monocromo" no son modos del contrato: los manda el lector. El primero es «no se
    // distingue» y el segundo «toda la pieza de un color», y solo el segundo trae su color.
    modo: z.enum([...MODOS_PATRON_COLOR, "ninguno", "monocromo"]),
    colores: z.array(z.string().trim().min(1).max(80)).max(12),
    // What crowns a column, read by the same call and only for columns (ADR-0039). It is NOT part of
    // `PistaPatronSchema`: that one travels inside `pistas_patron` to the resolution, and a reading of the
    // topper has no business there. It may come with `modo: "ninguno"` -- a single-colour column can still
    // have its big balloon on top.
    remate: RemateLeidoSchema.optional(),
    // Qué tamaños de globo tiene la pieza. Tampoco es parte de `PistaPatronSchema`, por lo mismo que el
    // remate: viaja a la resolución en su propia pista (`PistaTamanosSchema`). Puede venir con
    // `modo: "ninguno"` o `"monocromo"` —una pieza de un color tiene tamaños que se ven igual—, que es
    // exactamente el caso por el que se leen.
    tamanos: z.enum(TAMANOS_LEIDOS).optional(),
  });

const patronReferenciaPayloadResultSchema = z.object({
  operation_schema_version: z.literal("patron-referencia-result.v1"),
  pistas: z.array(patronReferenciaPistaSchema).max(12),
  modelo: z.string().min(1),
  prompt_version: z.string().min(1),
  usage: intentParseUsageSchema.extend({
    tool_use_prompt_token_count: z.number().int().nonnegative().optional(),
  }).strict().nullable(),
}).strict();

/** Hints only for elements that were asked about, once each; only "ninguno" may come without colors. */
function patronReferenciaPayloadIsConsistent(
  payload: { pistas: readonly z.infer<typeof patronReferenciaPistaSchema>[] },
  elementIds: readonly string[],
): boolean {
  const pedidos = new Set(elementIds);
  const vistos = new Set<string>();
  for (const pista of payload.pistas) {
    if (!pedidos.has(pista.element_id) || vistos.has(pista.element_id)) return false;
    if (pista.modo !== "ninguno" && pista.colores.length === 0) return false;
    if (pista.pesos !== undefined && pista.pesos.length !== pista.colores.length) return false;
    vistos.add(pista.element_id);
  }
  return true;
}

// Local contract (ADR-0026 §3): the Pydantic side is
// services/ai-api/app/amaterasu/bouquet_referencia.py; the prompt, the palette
// and the validation of the provider output live in estructuras/bouquet.py.
const bouquetReferenciaLecturaSchema = LecturaArmadoSchema.extend({
  element_id: z.string().min(1).max(80),
}).strict();

const bouquetReferenciaPayloadResultSchema = z.object({
  operation_schema_version: z.literal("bouquet-referencia-result.v1"),
  lecturas: z.array(bouquetReferenciaLecturaSchema).max(12),
  modelo: z.string().min(1),
  prompt_version: z.string().min(1),
  usage: intentParseUsageSchema.extend({
    tool_use_prompt_token_count: z.number().int().nonnegative().optional(),
  }).strict().nullable(),
}).strict();

// Local contract (ADR-0026 §3): the Pydantic side is
// services/ai-api/app/amaterasu/conteo_referencia.py, which owns the prompt and
// the validation; the reading's shape is `LecturaConteoSchema`
// (src/lib/plan/conteo-referencia.ts), exported inside reference-blueprint.v2.
const conteoReferenciaLecturaSchema = LecturaConteoSchema.extend({
  element_id: z.string().min(1).max(80),
}).strict();

const conteoReferenciaPayloadResultSchema = z.object({
  operation_schema_version: z.literal("conteo-referencia-result.v1"),
  lecturas: z.array(conteoReferenciaLecturaSchema).max(12),
  modelo: z.string().min(1),
  prompt_version: z.string().min(1),
  usage: intentParseUsageSchema.extend({
    tool_use_prompt_token_count: z.number().int().nonnegative().optional(),
  }).strict().nullable(),
}).strict();

// Local contract (ADR-0026 §3): the Pydantic side is
// services/ai-api/app/amaterasu/guirnalda_referencia.py; the prompt and the
// validation live in estructuras/guirnalda.py and the reading's shape is
// `LecturaGuirnaldaSchema` (src/lib/plan/armado-guirnalda.ts), exported inside
// reference-blueprint.v2.
const guirnaldaReferenciaLecturaSchema = LecturaGuirnaldaSchema.extend({
  element_id: z.string().min(1).max(80),
}).strict();

const guirnaldaReferenciaPayloadResultSchema = z.object({
  operation_schema_version: z.literal("guirnalda-referencia-result.v1"),
  lecturas: z.array(guirnaldaReferenciaLecturaSchema).max(12),
  modelo: z.string().min(1),
  prompt_version: z.string().min(1),
  usage: intentParseUsageSchema.extend({
    tool_use_prompt_token_count: z.number().int().nonnegative().optional(),
  }).strict().nullable(),
}).strict();

// Local contract (ADR-0026 section 3): the Pydantic side is
// services/ai-api/app/amaterasu/lectura_unica.py. There is no provider call
// behind it and therefore no model, prompt version or usage: those belong to
// the analysis turn that wrote the readings, and its telemetry already has
// them. Every list reuses the schema of the production reading that owns it.
const lecturaUnicaPayloadResultSchema = z.object({
  operation_schema_version: z.literal("lectura-unica-result.v1"),
  pistas: z.array(patronReferenciaPistaSchema).max(12),
  conteos: z.array(conteoReferenciaLecturaSchema).max(12),
  armados_bouquet: z.array(bouquetReferenciaLecturaSchema).max(12),
  armados_guirnalda: z.array(guirnaldaReferenciaLecturaSchema).max(12),
  validador_version: z.string().min(1),
}).strict();

/** Readings only for elements that were asked about, once each (bouquet, count and garland readings). */
function lecturasPorElementoPedido(lecturas: readonly { element_id: string }[], elementIds: readonly string[]): boolean {
  const pedidos = new Set(elementIds);
  const vistos = new Set<string>();
  for (const lectura of lecturas) {
    if (!pedidos.has(lectura.element_id) || vistos.has(lectura.element_id)) return false;
    vistos.add(lectura.element_id);
  }
  return true;
}

/** Readings only for elements that were asked about, once each. */
function bouquetReferenciaPayloadIsConsistent(
  payload: z.infer<typeof bouquetReferenciaPayloadResultSchema>,
  elementIds: readonly string[],
): boolean {
  return lecturasPorElementoPedido(payload.lecturas, elementIds);
}

// Local contracts (ADR-0026 §3) of the plan editor, owned by the Pydantic
// models in services/ai-api/app/plan_edicion.py (ADR-0028 §9, §10). The plan
// is validated with the same Zod owner as every other plan (`tipos.ts`), which
// also checks what JSON Schema cannot (shares that add up to 1).
const planEditPayloadResultSchema = z.object({
  operation_schema_version: z.literal("plan-edit-result.v1"),
  plan: PlanDecoracionSchema,
  avisos: z.array(z.string().min(1).max(400)).max(8),
}).strict();

/** The edit touches one plan: same id and the same structures, in the same order. */
function planEditPayloadIsConsistent(plan: PlanDecoracion, pedido: PlanDecoracion): boolean {
  return plan.plan_id === pedido.plan_id
    && plan.estructuras.length === pedido.estructuras.length
    && plan.estructuras.every((estructura, indice) => estructura.estructura_id === pedido.estructuras[indice]!.estructura_id);
}

const planPatronPayloadResultSchema = z.object({
  operation_schema_version: z.literal("plan-patron-result.v1"),
  patron: PatronColorResueltoSchema,
  modos_admitidos: modosAdmitidosSchema,
}).strict();

const planArmadoPayloadResultSchema = z.object({
  operation_schema_version: z.literal("plan-armado-bouquet-result.v1"),
  armado: ArmadoBouquetResueltoSchema,
  variantes_admitidas: variantesAdmitidasSchema,
  disposiciones_admitidas: disposicionesAdmitidasSchema,
}).strict();

const planArmadoGuirnaldaPayloadResultSchema = z.object({
  operation_schema_version: z.literal("plan-armado-guirnalda-result.v1"),
  armado: ArmadoGuirnaldaResueltoSchema,
  opciones: OpcionesArmadoGuirnaldaSchema,
}).strict();

/**
 * `plan-armado-arco-result.v1`: the resolved arch and its drawing exactly as
 * `VistaArcoSchema` publishes them (its own `grafica` shape, so the published
 * contract stays the single owner of that form), plus the assembly it was
 * resolved with and what the editor may offer for the piece.
 */
const planArmadoArcoPayloadResultSchema = z.object({
  operation_schema_version: z.literal("plan-armado-arco-result.v1"),
  arco: ArcoResueltoSchema,
  grafica: VistaArcoSchema.shape.grafica,
  armado: ArmadoArcoV1Schema,
  opciones: OpcionesArmadoArcoSchema,
  limites: LimitesArcoSchema,
}).strict();

/**
 * `plan-armado-columna-result.v1`: the resolved column and its drawing exactly
 * as `VistaColumnaSchema` publishes them (its own `grafica` shape, so the
 * published contract stays the single owner of that form), plus the assembly it
 * was resolved with and what the editor may offer for the piece.
 */
const planArmadoColumnaPayloadResultSchema = z.object({
  operation_schema_version: z.literal("plan-armado-columna-result.v1"),
  columna: ColumnaResueltaSchema,
  grafica: VistaColumnaSchema.shape.grafica,
  armado: ArmadoColumnaV1Schema,
  opciones: OpcionesArmadoColumnaSchema,
  limites: LimitesColumnaSchema,
}).strict();

/**
 * `plan-armado-guirnalda-organica-result.v1`: the resolved garland and its
 * drawing exactly as `VistaGuirnaldaOrganicaSchema` publishes them (its own
 * `grafica` shape, so that file stays the single owner of that form), plus
 * the assembly it was resolved with and what the editor may offer.
 */
const planArmadoGuirnaldaOrganicaPayloadResultSchema = z.object({
  operation_schema_version: z.literal("plan-armado-guirnalda-organica-result.v1"),
  guirnalda: GuirnaldaOrganicaResueltaSchema,
  grafica: VistaGuirnaldaOrganicaSchema.shape.grafica,
  armado: ArmadoGuirnaldaOrganicaV1Schema,
  opciones: OpcionesArmadoGuirnaldaOrganicaSchema,
  limites: LimitesGuirnaldaOrganicaSchema,
}).strict();

/**
 * `plan-armado-arco-organico-result.v1`: the resolved arch and its drawing
 * exactly as `VistaArcoOrganicoSchema` publishes them (its own `grafica`
 * shape, so that file stays the single owner of that form), plus the assembly
 * it was resolved with and what the editor may offer.
 */
const planArmadoArcoOrganicoPayloadResultSchema = z.object({
  operation_schema_version: z.literal("plan-armado-arco-organico-result.v1"),
  arco: ArcoOrganicoResueltoSchema,
  grafica: VistaArcoOrganicoSchema.shape.grafica,
  armado: ArmadoArcoOrganicoV1Schema,
  opciones: OpcionesArmadoArcoOrganicoSchema,
  limites: LimitesArcoOrganicoSchema,
}).strict();

/**
 * `plan-armado-columna-organica-result.v1`: the resolved column and its drawing
 * exactly as `VistaColumnaOrganicaSchema` publishes them (its own `grafica`
 * shape, so that file stays the single owner of that form), plus the assembly
 * it was resolved with and what the editor may offer.
 */
const planArmadoColumnaOrganicaPayloadResultSchema = z.object({
  operation_schema_version: z.literal("plan-armado-columna-organica-result.v1"),
  columna: ColumnaOrganicaResueltaSchema,
  grafica: VistaColumnaOrganicaSchema.shape.grafica,
  armado: ArmadoColumnaOrganicaV1Schema,
  opciones: OpcionesArmadoColumnaOrganicaSchema,
  limites: LimitesColumnaOrganicaSchema,
}).strict();

/**
 * `plan-dibujo-estructura-result.v1`: the drawing and nothing else, exactly as
 * `GraficaDibujoEstructuraSchema` publishes it (that file stays the single owner
 * of that shape). No resolved piece, no assembly, no options and no limits:
 * these four structures have no engine and the drawing is schematic.
 */
const planDibujoEstructuraPayloadResultSchema = z.object({
  operation_schema_version: z.literal("plan-dibujo-estructura-result.v1"),
  grafica: GraficaDibujoEstructuraSchema,
}).strict();

const chatTurnStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), delta: z.string().min(1) }).strict(),
  z.object({
    type: z.literal("end"),
    text: z.string(),
    tool_calls: z.array(z.object({
      id: z.string().min(1).nullable(),
      name: z.string().min(1),
      args: z.record(z.string(), z.unknown()),
      thought_signature: z.string().min(1).nullable(),
    }).strict()),
    usage_metadata: z.record(z.string(), z.number().int().nonnegative()),
    model: z.string().min(1),
    finish_reason: z.string().nullable(),
    block_reason: z.string().nullable(),
  }).strict(),
  z.object({
    type: z.literal("error"),
    code: z.string().min(1),
    /** "open": nothing reached the provider's output yet, so the turn may be retried. */
    phase: z.enum(["open", "stream"]),
    provider_status: z.number().int().positive().nullable().optional(),
    provider_message: z.string().nullable().optional(),
  }).strict(),
]);

export type PythonChatTurnStreamEvent = z.infer<typeof chatTurnStreamEventSchema>;

const loraGeneratePayloadResultSchema = z.object({
  image_base64: z.string().min(1),
  mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
  provider_request_id: z.string().min(1).nullable(),
  endpoint: z.string().min(1),
}).strict();

const embeddingPayloadResultSchema = z.object({
  values: z.array(z.number().finite()).min(1),
  model: z.string().min(1),
  dimensions: z.number().int().positive(),
  task_type: z.literal("RETRIEVAL_QUERY"),
  attempts: z.array(embeddingAttemptSchema).min(1),
}).strict();

const catalogVariantSchema = z.object({
  variant_id: z.string().min(1),
  sku: z.string().nullable(),
  title: z.string().nullable(),
  price: z.number().finite().nonnegative(),
  available: z.boolean(),
  size_code: z.string().nullable(),
  diameter_inches: z.number().finite().nullable(),
  shape: z.string().nullable(),
  colors: z.array(z.string()),
}).strict();

const catalogCandidateSchema = z.object({
  product_id: z.string().min(1),
  title: z.string().min(1),
  category: z.string().nullable(),
  colors: z.array(z.string()),
  finishes: z.array(z.string()),
  occasions: z.array(z.string()),
  available: z.boolean(),
  image: z.string().nullable(),
  score: z.number().finite(),
  variants: z.array(catalogVariantSchema),
}).strict();

const catalogColorSubstitutionSchema = z.object({
  pedido: z.string().min(1),
  entregado: z.string().min(1),
}).strict();

const catalogPayloadResultSchema = z.object({
  operation_schema_version: z.literal("catalog-search-result.v1"),
  status: z.enum(["OK", "NO_MATCH", "AMBIGUOUS_SKU"]),
  sku_status: z.enum(["not_sku", "unique", "ambiguous", "not_found", "filtered_out"]).nullable(),
  candidates: z.array(catalogCandidateSchema).max(50),
  whitelist: z.array(z.object({
    product_id: z.string().min(1),
    variant_ids: z.array(z.string().min(1)),
  }).strict()),
  catalog_snapshot_id: z.string().min(1).nullable(),
  latency_parse_ms: z.number().int().nonnegative(),
  latency_retrieval_ms: z.number().int().nonnegative(),
  // A requested color the active snapshot does not stock, resolved by Python
  // to the nearest one it has (catalog.py, x-tonos-colores-catalogo). Optional:
  // every mock payload in the test scripts predates this field.
  color_substitutions: z.array(catalogColorSubstitutionSchema).optional(),
}).strict();

const catalogSelectionItemSchema = z.object({
  product_id: z.string().min(1),
  variant_id: z.string().min(1),
  sku: z.string().nullable(),
  product_title: z.string().min(1),
  title: z.string().min(1),
  unit_price_cop: z.number().int().nonnegative().safe(),
  quantity: z.number().int().positive().safe(),
  subtotal_cop: z.number().int().nonnegative().safe(),
  image_url: z.string().url().nullable(),
  handle: z.string().min(1).nullable(),
  product_type: z.string().min(1).nullable(),
  category: z.string().min(1).nullable(),
  colors: z.array(z.string()),
  description: z.string().nullable(),
  units_per_package: z.number().int().positive().safe().nullable(),
  size_code: z.string().min(1).nullable(),
  shape: z.string().min(1).nullable(),
  diameter_inches: z.number().finite().nonnegative().nullable(),
}).strict();

const catalogSelectionPayloadResultSchema = z.object({
  operation_schema_version: z.literal("catalog-selection-result.v1"),
  status: z.enum(["ok", "partial", "empty"]),
  catalog_snapshot_id: z.string().min(1).nullable(),
  validados: z.array(catalogSelectionItemSchema),
  rechazados: z.array(z.object({
    product_id: z.string().min(1),
    variant_id: z.string().min(1),
    reason: z.string().min(1),
  }).strict()),
  total_cop: z.number().int().nonnegative().safe(),
}).strict();

function planResolutionPayloadIsConsistent(
  payload: z.infer<typeof PlanResolutionResultV1Schema>,
  requestedSnapshotId: string,
): boolean {
  const resolvedTotals = payload.plan_resuelto.totales;
  const estimateTotals = payload.material_estimate.totals;
  const quote = payload.quote;
  return payload.catalog_snapshot_id === requestedSnapshotId
    && quote.plan_hash === payload.plan_resuelto.plan_hash
    && resolvedTotals.total_cop === quote.total_cop
    && resolvedTotals.merma_porcentaje === quote.waste_percentage
    && quote.purchase_cost_cop !== undefined
    && quote.consumption_cost_cop !== undefined
    && quote.target_waste_reserve !== undefined
    && quote.covered_waste_reserve !== undefined
    && quote.leftover_inventory !== undefined
    && quote.purchase_cost_cop === resolvedTotals.purchase_cost
    && quote.consumption_cost_cop === resolvedTotals.consumption_cost
    && quote.target_waste_reserve === resolvedTotals.target_waste_reserve
    && quote.covered_waste_reserve === resolvedTotals.covered_waste_reserve
    && quote.leftover_inventory === estimateTotals.operational_surplus
    && estimateTotals.design_quantity === resolvedTotals.design_quantity
    && estimateTotals.purchase_cost === resolvedTotals.purchase_cost
    && estimateTotals.consumption_cost === resolvedTotals.consumption_cost
    && estimateTotals.target_waste_reserve === resolvedTotals.target_waste_reserve
    && estimateTotals.covered_waste_reserve === resolvedTotals.covered_waste_reserve;
}

type CatalogSearchPayloadResult = z.infer<typeof catalogPayloadResultSchema>;
type CatalogSelectionPayloadResult = z.infer<typeof catalogSelectionPayloadResultSchema>;

function hasUniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (!hasUniqueStrings(left) || !hasUniqueStrings(right) || left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function catalogSearchPayloadIsConsistent(
  payload: CatalogSearchPayloadResult,
  requestedSnapshotId: string | undefined,
): boolean {
  if (requestedSnapshotId !== undefined && payload.catalog_snapshot_id !== requestedSnapshotId) return false;
  if (payload.status === "OK" ? payload.candidates.length === 0 : payload.candidates.length > 0) return false;
  if (payload.status === "AMBIGUOUS_SKU" && payload.sku_status !== "ambiguous") return false;
  if (payload.sku_status === "ambiguous" && payload.status !== "AMBIGUOUS_SKU") return false;
  if (payload.candidates.length > 0 && payload.catalog_snapshot_id === null) return false;

  const candidatesByProduct = new Map<string, string[]>();
  const seenVariantIds = new Set<string>();
  for (const candidate of payload.candidates) {
    if (candidatesByProduct.has(candidate.product_id) || candidate.variants.length === 0) return false;
    const variantIds = candidate.variants.map((variant) => variant.variant_id);
    if (!hasUniqueStrings(variantIds)) return false;
    for (const variantId of variantIds) {
      if (seenVariantIds.has(variantId)) return false;
      seenVariantIds.add(variantId);
    }
    candidatesByProduct.set(candidate.product_id, variantIds);
  }

  const whitelistByProduct = new Map<string, string[]>();
  for (const entry of payload.whitelist) {
    if (whitelistByProduct.has(entry.product_id) || !hasUniqueStrings(entry.variant_ids)) return false;
    whitelistByProduct.set(entry.product_id, entry.variant_ids);
  }
  if (candidatesByProduct.size !== whitelistByProduct.size) return false;
  for (const [productId, variantIds] of candidatesByProduct) {
    const whitelistedVariantIds = whitelistByProduct.get(productId);
    if (!whitelistedVariantIds || !sameStringSet(variantIds, whitelistedVariantIds)) return false;
  }
  return true;
}

function selectionPairKey(productId: string, variantId: string): string {
  return `${productId}\u0000${variantId}`;
}

function catalogSelectionPayloadIsConsistent(
  payload: CatalogSelectionPayloadResult,
  input: PythonCatalogSelectionInput,
): boolean {
  if (input.catalogSnapshotId !== undefined && payload.catalog_snapshot_id !== input.catalogSnapshotId) return false;

  const requestedByPair = new Map<string, PythonCatalogSelectionInput["items"][number]>();
  const requestedVariantIds = new Set<string>();
  for (const item of input.items) {
    const key = selectionPairKey(item.product_id, item.variant_id);
    if (requestedByPair.has(key) || requestedVariantIds.has(item.variant_id)) return false;
    requestedByPair.set(key, item);
    requestedVariantIds.add(item.variant_id);
  }
  const allowlistByProduct = new Map<string, Set<string>>();
  for (const entry of input.allowlist) {
    const variantIds = allowlistByProduct.get(entry.product_id) ?? new Set<string>();
    for (const variantId of entry.variant_ids) variantIds.add(variantId);
    allowlistByProduct.set(entry.product_id, variantIds);
  }

  // Identity only: every requested pair comes back exactly once, validated
  // lines stay inside the signed allowlist with the requested quantity. The
  // subtotal, total and status are Python's (catalog.py) and are not
  // recomputed here -- re-deriving a formula to compare it would make Next a
  // second owner (AGENTS.md, the `validateMaterialEstimate` incident).
  const returnedPairs = new Set<string>();
  for (const item of payload.validados) {
    const key = selectionPairKey(item.product_id, item.variant_id);
    const requested = requestedByPair.get(key);
    if (!requested || returnedPairs.has(key)) return false;
    if (item.quantity !== requested.quantity) return false;
    if (!allowlistByProduct.get(item.product_id)?.has(item.variant_id)) return false;
    returnedPairs.add(key);
  }
  for (const item of payload.rechazados) {
    const key = selectionPairKey(item.product_id, item.variant_id);
    if (!requestedByPair.has(key) || returnedPairs.has(key)) return false;
    returnedPairs.add(key);
  }
  if (returnedPairs.size !== requestedByPair.size) return false;
  return !(payload.validados.length > 0 && payload.catalog_snapshot_id === null);
}

/**
 * Reorders a candidate list PostgreSQL already authorized (see
 * buscarHibrido in src/lib/rag/retrieval/search.ts). Never adds or removes a
 * candidate -- `order` is validated to be a permutation of the input ids.
 */
export async function llamarPythonRerank(input: PythonRerankInput): Promise<PythonRerankResult> {
  const { query, candidates, ...rest } = input;
  const operationPayload = { query, candidates };
  const response = await llamarPythonOperacion(PYTHON_RERANK_PATH, PYTHON_RERANK_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
  });
  const parsed = rerankPayloadResultSchema.safeParse(response.payload);
  if (!parsed.success) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const expectedIdList = candidates.map((candidate) => candidate.id);
  const expectedIds = new Set(expectedIdList);
  const returnedIds = new Set(parsed.data.order);
  const scoreIds = new Set(Object.keys(parsed.data.scores));
  const isPermutation = parsed.data.order.length === candidates.length
    && expectedIds.size === expectedIdList.length
    && expectedIds.size === returnedIds.size
    && expectedIds.size === scoreIds.size
    && [...expectedIds].every((id) => returnedIds.has(id) && scoreIds.has(id));
  if (!isPermutation) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return response.replayed
    ? { ...parsed.data, replayed: true }
    : parsed.data;
}

export async function llamarPythonEmbedding(
  input: PythonEmbeddingInput,
): Promise<PythonEmbeddingResult> {
  const { text, ...rest } = input;
  const operationPayload = { text, task_type: "RETRIEVAL_QUERY" as const };
  const response = await llamarPythonOperacion(PYTHON_EMBEDDING_PATH, PYTHON_EMBEDDING_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
  });
  const parsed = embeddingPayloadResultSchema.safeParse(response.payload);
  if (
    !parsed.success
    || parsed.data.model !== PYTHON_EMBEDDING_MODEL
    || parsed.data.dimensions !== PYTHON_EMBEDDING_DIMENSIONS
    || parsed.data.values.length !== PYTHON_EMBEDDING_DIMENSIONS
  ) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return response.replayed
    ? { ...parsed.data, replayed: true }
    : parsed.data;
}

/**
 * The one Gemini call Inari's parser makes (src/lib/ia/inari/parse.ts). Python
 * receives the already-built prompt and JSON schema and does nothing but the
 * provider round trip -- the deterministic-first parse and the merge of local
 * and remote results stay in TypeScript, unchanged.
 */
export async function llamarPythonIntentParse(
  input: PythonIntentParseInput,
): Promise<PythonIntentParseResult> {
  const { message, systemInstruction, responseJsonSchema, model, ...rest } = input;
  const operationPayload = {
    schema_version: "intent-parse.v1" as const,
    message,
    system_instruction: systemInstruction,
    response_json_schema: responseJsonSchema,
    ...(model === undefined ? {} : { model }),
  };
  const response = await llamarPythonOperacion(PYTHON_INTENT_PARSE_PATH, PYTHON_INTENT_PARSE_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
  });
  const parsed = intentParsePayloadResultSchema.safeParse(response.payload);
  if (!parsed.success) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return response.replayed
    ? { ...parsed.data, replayed: true }
    : parsed.data;
}

/**
 * One of Happie's two structured-output Gemini calls: the conversation
 * extractor (src/lib/happie/conversacion-webhook.ts) or the package
 * recommender (packages/happie-package-ia, through the generator the app
 * injects). Python only makes the provider round trip; prompts, the state
 * machine, the package id filter and the Zod validation stay in TypeScript.
 * No idempotency key: the call has no side effect to reconcile, and the
 * direct path never retried it either.
 */
export async function llamarPythonHappieGenerate(
  input: PythonHappieGenerateInput,
): Promise<PythonHappieGenerateResult> {
  const { purpose, parts, systemInstruction, responseJsonSchema, model, ...rest } = input;
  const operationPayload = {
    schema_version: "happie-generate.v1" as const,
    purpose,
    parts,
    system_instruction: systemInstruction,
    response_json_schema: responseJsonSchema,
    ...(model === undefined ? {} : { model }),
  };
  const response = await llamarPythonOperacion(PYTHON_HAPPIE_GENERATE_PATH, PYTHON_HAPPIE_GENERATE_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
    maxBodyBytes: PYTHON_MAX_BODY_BYTES_HAPPIE,
  });
  const parsed = happieGeneratePayloadResultSchema.safeParse(response.payload);
  if (!parsed.success) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return parsed.data;
}

/**
 * The one Gemini tool-calling turn Amaterasu's inventory pass makes
 * (src/lib/ia/amaterasu/analizar-referencias-v2.ts, via the ChatPort
 * `src/lib/ia/amaterasu/chat-python.ts` wraps around this). Python only makes
 * the provider round trip; the retry-on-malformed loop, the blueprint
 * assembly and everything else stays in TypeScript, unchanged. Uses
 * `maxBodyBytes: PYTHON_MAX_BODY_BYTES_IMAGENES` since reference photos are
 * far larger than every other operation's payload.
 */
export async function llamarPythonReferenceTurn(
  input: PythonReferenceTurnInput,
): Promise<PythonReferenceTurnResult> {
  const { systemInstruction, message, images, tools, temperature, maxOutputTokens, model, ...rest } = input;
  const operationPayload = {
    schema_version: "reference-turn.v1" as const,
    system_instruction: systemInstruction,
    message,
    images: images.map((image) => ({ id: image.id, mime: image.mime, base64: image.base64, descripcion: image.descripcion ?? "" })),
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description, parameters_json_schema: tool.parametersJsonSchema })),
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxOutputTokens === undefined ? {} : { max_output_tokens: maxOutputTokens }),
    ...(model === undefined ? {} : { model }),
  };
  const response = await llamarPythonOperacion(PYTHON_REFERENCE_TURN_PATH, PYTHON_REFERENCE_TURN_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
    maxBodyBytes: PYTHON_MAX_BODY_BYTES_IMAGENES,
  });
  const parsed = referenceTurnPayloadResultSchema.safeParse(response.payload);
  if (!parsed.success) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const result: PythonReferenceTurnResult = {
    text: parsed.data.text,
    toolCalls: parsed.data.tool_calls,
    model: parsed.data.model,
    usage: parsed.data.usage,
    finishReason: parsed.data.finish_reason,
    blockReason: parsed.data.block_reason,
  };
  return response.replayed ? { ...result, replayed: true } : result;
}

/**
 * Reads the color pattern of each balloon structure in one reference photo
 * (docs/architecture/decisions/0028 §11). Unlike the reference turn, Python
 * owns everything here -- prompt, palette, response schema and validation of
 * the provider output; this only transports the photo and the elements the
 * analysis already found, and checks the answer is about those elements. No
 * idempotency key and no retry: the call has no side effect and the caller
 * continues without hints on any failure.
 */
export async function llamarPythonPatronReferencia(
  input: PythonPatronReferenciaInput,
): Promise<PythonPatronReferenciaResult> {
  const { imagen, elementos, ...rest } = input;
  const operationPayload = {
    schema_version: "patron-referencia.v1" as const,
    imagen: { mime_type: imagen.mimeType, data_base64: imagen.dataBase64 },
    elementos: elementos.map((elemento) => ({
      element_id: elemento.elementId,
      tipo: elemento.tipo,
      ...(elemento.bbox === undefined ? {} : { bbox: elemento.bbox }),
      colores_observados: elemento.coloresObservados,
    })),
  };
  const response = await llamarPythonOperacion(PYTHON_PATRON_REFERENCIA_PATH, PYTHON_PATRON_REFERENCIA_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
    maxBodyBytes: PYTHON_MAX_BODY_BYTES_IMAGENES,
  });
  const parsed = patronReferenciaPayloadResultSchema.safeParse(response.payload);
  if (!parsed.success || !patronReferenciaPayloadIsConsistent(parsed.data, elementos.map((elemento) => elemento.elementId))) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const result: PythonPatronReferenciaResult = {
    pistas: parsed.data.pistas,
    modelo: parsed.data.modelo,
    promptVersion: parsed.data.prompt_version,
    usage: parsed.data.usage,
  };
  return response.replayed ? { ...result, replayed: true } : result;
}

/**
 * Reads how each bouquet in one reference photo is assembled (ADR-0030). Python
 * owns the prompt, the palette, the response schema and the validation; this
 * only transports the photo and the bouquets the analysis found, and checks the
 * answer is about them. No idempotency key and no retry: the call has no side
 * effect and the caller continues without readings on any failure.
 */
export async function llamarPythonBouquetReferencia(
  input: PythonBouquetReferenciaInput,
): Promise<PythonBouquetReferenciaResult> {
  const { imagen, elementos, ...rest } = input;
  const operationPayload = {
    schema_version: "bouquet-referencia.v1" as const,
    imagen: { mime_type: imagen.mimeType, data_base64: imagen.dataBase64 },
    elementos: elementos.map((elemento) => ({
      element_id: elemento.elementId,
      ...(elemento.bbox === undefined ? {} : { bbox: elemento.bbox }),
      colores_observados: elemento.coloresObservados,
    })),
  };
  const response = await llamarPythonOperacion(PYTHON_BOUQUET_REFERENCIA_PATH, PYTHON_BOUQUET_REFERENCIA_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
    maxBodyBytes: PYTHON_MAX_BODY_BYTES_IMAGENES,
  });
  const parsed = bouquetReferenciaPayloadResultSchema.safeParse(response.payload);
  if (!parsed.success || !bouquetReferenciaPayloadIsConsistent(parsed.data, elementos.map((elemento) => elemento.elementId))) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const result: PythonBouquetReferenciaResult = {
    lecturas: parsed.data.lecturas,
    modelo: parsed.data.modelo,
    promptVersion: parsed.data.prompt_version,
    usage: parsed.data.usage,
  };
  return response.replayed ? { ...result, replayed: true } : result;
}

/**
 * Counts the balloons of each balloon structure in one reference photo
 * (ADR-0031). Python owns the prompt, how each kind of piece is counted, the
 * response schema and the validation; this only transports the photo and the
 * structures the analysis found, and checks the answer is about them and fits
 * the reading's contract. No idempotency key and no retry: the call has no side
 * effect and the caller continues without readings on any failure.
 */
export async function llamarPythonConteoReferencia(
  input: PythonConteoReferenciaInput,
): Promise<PythonConteoReferenciaResult> {
  const { imagen, elementos, ...rest } = input;
  const operationPayload = {
    schema_version: "conteo-referencia.v1" as const,
    imagen: { mime_type: imagen.mimeType, data_base64: imagen.dataBase64 },
    elementos: elementos.map((elemento) => ({
      element_id: elemento.elementId,
      tipo: elemento.tipo,
      ...(elemento.estructuraOficial === undefined ? {} : { estructura_oficial: elemento.estructuraOficial }),
      ...(elemento.bbox === undefined ? {} : { bbox: elemento.bbox }),
      ...(elemento.piezas === undefined ? {} : { piezas: elemento.piezas }),
    })),
  };
  const response = await llamarPythonOperacion(PYTHON_CONTEO_REFERENCIA_PATH, PYTHON_CONTEO_REFERENCIA_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
    maxBodyBytes: PYTHON_MAX_BODY_BYTES_IMAGENES,
  });
  const parsed = conteoReferenciaPayloadResultSchema.safeParse(response.payload);
  if (!parsed.success || !lecturasPorElementoPedido(parsed.data.lecturas, elementos.map((elemento) => elemento.elementId))) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const result: PythonConteoReferenciaResult = {
    lecturas: parsed.data.lecturas,
    modelo: parsed.data.modelo,
    promptVersion: parsed.data.prompt_version,
    usage: parsed.data.usage,
  };
  return response.replayed ? { ...result, replayed: true } : result;
}

/**
 * Reads how each garland in one reference photo is built (ADR-0032, E4).
 * Python owns the prompt, the palette, the response schema and the validation;
 * this only transports the photo, the garlands the analysis found and the other
 * balloon pieces a garland may be wrapped around, and checks the answer is
 * about the garlands asked for. No idempotency key and no retry: the call has
 * no side effect and the caller continues without readings on any failure.
 */
export async function llamarPythonGuirnaldaReferencia(
  input: PythonGuirnaldaReferenciaInput,
): Promise<PythonGuirnaldaReferenciaResult> {
  const { imagen, elementos, otras, ...rest } = input;
  const operationPayload = {
    schema_version: "guirnalda-referencia.v1" as const,
    imagen: { mime_type: imagen.mimeType, data_base64: imagen.dataBase64 },
    elementos: elementos.map((elemento) => ({
      element_id: elemento.elementId,
      ...(elemento.bbox === undefined ? {} : { bbox: elemento.bbox }),
      colores_observados: elemento.coloresObservados,
    })),
    otras: otras.map((otra) => ({
      element_id: otra.elementId,
      tipo: otra.tipo,
      ...(otra.bbox === undefined ? {} : { bbox: otra.bbox }),
    })),
  };
  const response = await llamarPythonOperacion(PYTHON_GUIRNALDA_REFERENCIA_PATH, PYTHON_GUIRNALDA_REFERENCIA_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
    maxBodyBytes: PYTHON_MAX_BODY_BYTES_IMAGENES,
  });
  const parsed = guirnaldaReferenciaPayloadResultSchema.safeParse(response.payload);
  // A host may be another piece or an arch/half-arch that is itself read (review 6/13), never the garland itself.
  const otrasIds = new Set([...otras.map((otra) => otra.elementId), ...elementos.map((elemento) => elemento.elementId)]);
  if (
    !parsed.success
    || !lecturasPorElementoPedido(parsed.data.lecturas, elementos.map((elemento) => elemento.elementId))
    || parsed.data.lecturas.some((lectura) => lectura.anfitriona_element_id !== undefined && (!otrasIds.has(lectura.anfitriona_element_id) || lectura.anfitriona_element_id === lectura.element_id))
  ) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const result: PythonGuirnaldaReferenciaResult = {
    lecturas: parsed.data.lecturas,
    modelo: parsed.data.modelo,
    promptVersion: parsed.data.prompt_version,
    usage: parsed.data.usage,
  };
  return response.replayed ? { ...result, replayed: true } : result;
}

/**
 * Validates the four readings the reference analysis itself returned (variant
 * `v17-lectura-unica`). **No provider call happens behind this**: the only call
 * that looked at the photo is the analysis turn. Python owns every validator
 * (the same ones the four separate readings use), so this only transports the
 * raw blocks and checks the answer is about the elements asked for. The photo
 * travels because `tamano_imagen` needs its header to turn the garland's three
 * centre-line points into curvature and slope (ADR-0032, decision 29). No
 * idempotency key and no retry: the call has no side effect and the caller
 * continues without readings on any failure.
 */
export async function llamarPythonLecturaUnica(
  input: PythonLecturaUnicaInput,
): Promise<PythonLecturaUnicaResult> {
  const { imagen, elementos, ...rest } = input;
  const operationPayload = {
    schema_version: "lectura-unica.v1" as const,
    imagen: { mime_type: imagen.mimeType, data_base64: imagen.dataBase64 },
    elementos: elementos.map((elemento) => ({
      element_id: elemento.elementId,
      tipo: elemento.tipo,
      ...(elemento.anfitrionaPosible === undefined ? {} : { anfitriona_posible: elemento.anfitrionaPosible }),
      ...(elemento.patron === undefined ? {} : { patron: elemento.patron }),
      ...(elemento.conteo === undefined ? {} : { conteo: elemento.conteo }),
      ...(elemento.armadoBouquet === undefined ? {} : { armado_bouquet: elemento.armadoBouquet }),
      ...(elemento.armadoGuirnalda === undefined ? {} : { armado_guirnalda: elemento.armadoGuirnalda }),
    })),
  };
  const response = await llamarPythonOperacion(PYTHON_LECTURA_UNICA_PATH, PYTHON_LECTURA_UNICA_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
    maxBodyBytes: PYTHON_MAX_BODY_BYTES_IMAGENES,
  });
  const parsed = lecturaUnicaPayloadResultSchema.safeParse(response.payload);
  // Each list is checked against the elements that carried that block, with the
  // same rules the four separate readings apply.
  const pedidos = (campo: keyof PythonLecturaUnicaElemento) => elementos.filter((elemento) => elemento[campo] !== undefined).map((elemento) => elemento.elementId);
  const anfitrionasValidas = new Set(elementos.map((elemento) => elemento.elementId));
  if (
    !parsed.success
    || !patronReferenciaPayloadIsConsistent(parsed.data, pedidos("patron"))
    || !lecturasPorElementoPedido(parsed.data.conteos, pedidos("conteo"))
    || !lecturasPorElementoPedido(parsed.data.armados_bouquet, pedidos("armadoBouquet"))
    || !lecturasPorElementoPedido(parsed.data.armados_guirnalda, pedidos("armadoGuirnalda"))
    || parsed.data.armados_guirnalda.some((lectura) => lectura.anfitriona_element_id !== undefined && (!anfitrionasValidas.has(lectura.anfitriona_element_id) || lectura.anfitriona_element_id === lectura.element_id))
  ) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const result: PythonLecturaUnicaResult = {
    pistas: parsed.data.pistas,
    conteos: parsed.data.conteos,
    armadosBouquet: parsed.data.armados_bouquet,
    armadosGuirnalda: parsed.data.armados_guirnalda,
    validadorVersion: parsed.data.validador_version,
  };
  return response.replayed ? { ...result, replayed: true } : result;
}

/**
 * The submit -> poll -> download sequence against fal.ai's queue that
 * `generarConSempertexLora` makes directly today
 * (src/lib/ia/kagutsuchi/sempertex-lora.ts). `prompt`, `loras`, `mode` and
 * every sizing/guidance value already reflect TypeScript's composition
 * (buildLoraEditPrompt, ensureLoraTriggers, referenciasParaLoraEdit,
 * guidanceScaleSeguro) -- Python only talks to the provider and applies the
 * SSRF allow-list. Uses `maxBodyBytes: PYTHON_MAX_BODY_BYTES_IMAGENES` (up to
 * 4 reference images for `/edit`) and a `deadlineMs` above the shared
 * default: fal.ai's own queue can legitimately take up to 105s
 * (submit + poll + download), the same budget the direct path already
 * spends inside the browser-facing /api/generate call.
 */
export async function llamarPythonLoraGenerate(
  input: PythonLoraGenerateInput,
): Promise<PythonLoraGenerateResult> {
  const { mode, prompt, loras, guidanceScale, numInferenceSteps, imageWidth, imageHeight, seed, imageDataUrls, deadlineMs, ...rest } = input;
  const operationPayload = {
    schema_version: "lora-generate.v1" as const,
    mode,
    prompt,
    loras,
    guidance_scale: guidanceScale,
    num_inference_steps: numInferenceSteps,
    image_width: imageWidth,
    image_height: imageHeight,
    ...(seed === undefined ? {} : { seed }),
    image_data_urls: imageDataUrls,
  };
  const response = await llamarPythonOperacion(PYTHON_LORA_GENERATE_PATH, PYTHON_LORA_GENERATE_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
    maxBodyBytes: PYTHON_MAX_BODY_BYTES_IMAGENES,
    deadlineMs: deadlineMs ?? DEADLINE_MAX_MS,
  });
  const parsed = loraGeneratePayloadResultSchema.safeParse(response.payload);
  if (!parsed.success) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const result: PythonLoraGenerateResult = {
    imageBase64: parsed.data.image_base64,
    mime: parsed.data.mime,
    providerRequestId: parsed.data.provider_request_id,
    endpoint: parsed.data.endpoint,
  };
  return response.replayed ? { ...result, replayed: true } : result;
}

/**
 * One streamed Gemini turn of Omoikane's chat
 * (services/ai-api/app/omoikane/turno_stream.py). Yields validated events and
 * guarantees the stream ended with exactly one terminal event (`end` or
 * `error`); anything else -- a malformed line, a truncated body -- is
 * PYTHON_INVALID_RESPONSE. It never retries: whether an `error` with phase
 * "open" is retried is the ChatPort's decision
 * (src/lib/ia/omoikane/chat-python.ts).
 */
export async function* llamarPythonChatTurnStream(
  input: PythonChatTurnStreamInput,
): AsyncGenerator<PythonChatTurnStreamEvent, void, undefined> {
  const { systemInstruction, contents, tools, thinkingLevel, temperature, maxOutputTokens, model, ...rest } = input;
  const operationPayload = {
    schema_version: "chat-turn-stream.v1" as const,
    system_instruction: systemInstruction,
    contents,
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description, parameters_json_schema: tool.parametersJsonSchema })),
    ...(thinkingLevel === undefined ? {} : { thinking_level: thinkingLevel }),
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxOutputTokens === undefined ? {} : { max_output_tokens: maxOutputTokens }),
    ...(model === undefined ? {} : { model }),
  };
  const lineas = leerPythonNdjson(PYTHON_CHAT_TURN_STREAM_PATH, PYTHON_CHAT_TURN_STREAM_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
    maxBodyBytes: PYTHON_MAX_BODY_BYTES_CHAT,
  });
  for await (const linea of lineas) {
    const parsed = chatTurnStreamEventSchema.safeParse(linea);
    if (!parsed.success) {
      throw errorFor("PYTHON_INVALID_RESPONSE", 502, input.requestId, input.correlationId);
    }
    yield parsed.data;
    if (parsed.data.type !== "text") return;
  }
  throw errorFor("PYTHON_INVALID_RESPONSE", 502, input.requestId, input.correlationId);
}

export async function llamarPythonCatalogSearch(
  input: PythonCatalogSearchInput,
): Promise<PythonCatalogSearchResult> {
  const { message, filters, allowlist, limit = 15, catalogSnapshotId, browse, ...rest } = input;
  const operationBody = {
    schema_version: "catalog-search.v1" as const,
    message,
    filters,
    allowlist,
    limit,
    ...(catalogSnapshotId === undefined ? {} : { catalog_snapshot_id: catalogSnapshotId }),
    ...(browse ? { browse: true } : {}),
  };
  const response = await llamarPythonOperacion(PYTHON_CATALOG_SEARCH_PATH, PYTHON_CATALOG_SEARCH_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_CATALOG_SEARCH_SCOPE],
  });
  const parsed = catalogPayloadResultSchema.safeParse(response.payload);
  if (!parsed.success || !catalogSearchPayloadIsConsistent(parsed.data, catalogSnapshotId)) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return response.replayed
    ? { ...parsed.data, replayed: true }
    : parsed.data;
}

/**
 * Colors of the published catalog with how many available products carry each
 * (the editor's explorer chips). Python owns the predicates; Next only checks
 * the answer is for the snapshot it pinned and that no color repeats.
 */
export async function llamarPythonCatalogColors(
  input: PythonCatalogColorsInput,
): Promise<PythonCatalogColorsResult> {
  const { allowlist, catalogSnapshotId, ...rest } = input;
  const operationBody = {
    schema_version: CATALOG_COLORS_CONTRACT_VERSION,
    allowlist,
    ...(catalogSnapshotId === undefined ? {} : { catalog_snapshot_id: catalogSnapshotId }),
  };
  const response = await llamarPythonOperacion(PYTHON_CATALOG_COLORS_PATH, PYTHON_CATALOG_COLORS_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_CATALOG_COLORS_SCOPE],
  });
  const parsed = CatalogColorsResultV1Schema.safeParse(response.payload);
  if (
    !parsed.success
    || (catalogSnapshotId !== undefined && parsed.data.catalog_snapshot_id !== catalogSnapshotId)
    || (parsed.data.catalog_snapshot_id === null && parsed.data.colors.length > 0)
    || !hasUniqueStrings(parsed.data.colors.map((color) => color.value))
  ) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return response.replayed
    ? { ...parsed.data, replayed: true }
    : parsed.data;
}

export async function llamarPythonCatalogSelection(
  input: PythonCatalogSelectionInput,
): Promise<PythonCatalogSelectionResult> {
  const { items, allowlist, catalogSnapshotId, ...rest } = input;
  const operationBody = {
    schema_version: "catalog-selection.v1" as const,
    request_id: input.requestId,
    ...(catalogSnapshotId === undefined ? {} : { catalog_snapshot_id: catalogSnapshotId }),
    items,
    allowlist,
  };
  const response = await llamarPythonOperacion(PYTHON_CATALOG_SELECTION_PATH, PYTHON_CATALOG_SELECTION_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_CATALOG_SELECTION_SCOPE],
  });
  const parsed = catalogSelectionPayloadResultSchema.safeParse(response.payload);
  if (!parsed.success || !catalogSelectionPayloadIsConsistent(parsed.data, input)) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return response.replayed
    ? { ...parsed.data, replayed: true }
    : parsed.data;
}

export async function llamarPythonPlanResolution(
  input: PythonPlanResolutionInput,
): Promise<PythonPlanResolutionResult> {
  const {
    plan,
    allowlist,
    catalogSnapshotId,
    completarPatrones,
    pistasPatron,
    pistasTamanos,
    completarArmados,
    pistasArmado,
    completarArmadosDe,
    completarArmadosGuirnalda,
    pistasGuirnalda,
    completarConteos,
    pistasConteo,
    completarConteosDe,
    medidasDelCliente,
    ...rest
  } = input;
  const operationBody = {
    schema_version: "plan-resolution.v1" as const,
    plan,
    allowlist,
    catalog_snapshot_id: catalogSnapshotId,
    ...(completarPatrones === undefined ? {} : { completar_patrones: completarPatrones }),
    ...(pistasPatron === undefined ? {} : { pistas_patron: pistasPatron }),
    ...(pistasTamanos === undefined ? {} : { pistas_tamanos: pistasTamanos }),
    ...(completarArmados === undefined ? {} : { completar_armados: completarArmados }),
    ...(pistasArmado === undefined ? {} : { pistas_armado: pistasArmado }),
    ...(completarArmadosDe === undefined ? {} : { completar_armados_de: completarArmadosDe }),
    ...(completarArmadosGuirnalda === undefined ? {} : { completar_armados_guirnalda: completarArmadosGuirnalda }),
    ...(pistasGuirnalda === undefined ? {} : { pistas_guirnalda: pistasGuirnalda }),
    ...(completarConteos === undefined ? {} : { completar_conteos: completarConteos }),
    ...(pistasConteo === undefined ? {} : { pistas_conteo: pistasConteo }),
    ...(completarConteosDe === undefined ? {} : { completar_conteos_de: completarConteosDe }),
    ...(medidasDelCliente === undefined ? {} : { medidas_del_cliente: medidasDelCliente }),
  };
  const response = await llamarPythonOperacion(PYTHON_PLAN_RESOLUTION_PATH, PYTHON_PLAN_RESOLUTION_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_PLAN_RESOLUTION_SCOPE],
  });
  const parsed = PlanResolutionResultV1Schema.safeParse(response.payload);
  if (!parsed.success || !planResolutionPayloadIsConsistent(parsed.data, catalogSnapshotId)) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return response.replayed
    ? { ...parsed.data, replayed: true }
    : parsed.data;
}

const CATALOG_RECOMMENDATIONS_DEFAULT_LIMIT = 100;

/**
 * Python owns which rows are recommendable; Next only checks that the answer
 * is the one it asked for and cannot widen anything: pinned snapshot and
 * reference echoed, reference excluded, unique ids, bounded by `limit`.
 */
function catalogRecommendationsPayloadIsConsistent(
  payload: z.infer<typeof CatalogRecommendationsResultV1Schema>,
  input: { referenceVariantId: string; catalogSnapshotId: string; limit: number },
): boolean {
  if (payload.catalog_snapshot_id !== input.catalogSnapshotId) return false;
  if (payload.reference.variant_id !== input.referenceVariantId) return false;
  const productIds = new Set<string>();
  const variantIds = new Set<string>();
  for (const candidate of payload.candidates) {
    if (productIds.has(candidate.product_id)) return false;
    productIds.add(candidate.product_id);
    for (const variant of candidate.variants) {
      if (variant.variant_id === input.referenceVariantId || variantIds.has(variant.variant_id)) return false;
      variantIds.add(variant.variant_id);
    }
  }
  return variantIds.size <= input.limit;
}

export async function llamarPythonCatalogRecommendations(
  input: PythonCatalogRecommendationsInput,
): Promise<PythonCatalogRecommendationsResult> {
  const { referenceVariantId, catalogSnapshotId, limit = CATALOG_RECOMMENDATIONS_DEFAULT_LIMIT, ...rest } = input;
  const operationBody = {
    schema_version: CATALOG_RECOMMENDATIONS_CONTRACT_VERSION,
    catalog_snapshot_id: catalogSnapshotId,
    reference_variant_id: referenceVariantId,
    limit,
  };
  const response = await llamarPythonOperacion(PYTHON_CATALOG_RECOMMENDATIONS_PATH, PYTHON_CATALOG_RECOMMENDATIONS_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_CATALOG_RECOMMENDATIONS_SCOPE],
  });
  const parsed = CatalogRecommendationsResultV1Schema.safeParse(response.payload);
  if (
    !parsed.success
    || !catalogRecommendationsPayloadIsConsistent(parsed.data, { referenceVariantId, catalogSnapshotId, limit })
  ) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return response.replayed
    ? { ...parsed.data, replayed: true }
    : parsed.data;
}

/**
 * Applies one edit to the declarative plan (ADR-0028 §9). Python owns the
 * mutation; Next already verified the approval, admitted the variant, and
 * resolves and signs whatever comes back. No idempotency key: the operation
 * is pure and has no effect to deduplicate.
 */
export async function llamarPythonPlanEdit(input: PythonPlanEditInput): Promise<PythonPlanEditResult> {
  const { plan, lineasBase, edicion, coloresVariante, completarPatrones, completarArmados, completarArmadosGuirnalda, ...rest } = input;
  const operationBody = {
    schema_version: "plan-edit.v1" as const,
    plan,
    lineas_base: lineasBase.map((estructura) => ({
      estructura_id: estructura.estructura_id,
      lineas: estructura.lineas.map((linea) => ({ product_id: linea.product_id, variant_id: linea.variant_id, color: linea.color })),
    })),
    edicion,
    colores_variante: [...coloresVariante],
    completar_patrones: completarPatrones,
    // Absent unless the caller passes it: every other request stays byte-identical.
    ...(completarArmados === undefined ? {} : { completar_armados: completarArmados }),
    ...(completarArmadosGuirnalda === undefined ? {} : { completar_armados_guirnalda: completarArmadosGuirnalda }),
  };
  const response = await llamarPythonOperacion(PYTHON_PLAN_EDIT_PATH, PYTHON_PLAN_EDIT_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_PLAN_EDIT_SCOPE],
  });
  const parsed = planEditPayloadResultSchema.safeParse(response.payload);
  if (!parsed.success || !planEditPayloadIsConsistent(parsed.data.plan, plan)) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const result: PythonPlanEditResult = { plan: parsed.data.plan, avisos: parsed.data.avisos };
  return response.replayed ? { ...result, replayed: true } : result;
}

/** Exactly the fields of `plan-patron.v1`'s line, whatever else the caller's object carries. */
function lineaPlanPatron(linea: PythonPlanPatronLinea): PythonPlanPatronLinea {
  return {
    product_id: linea.product_id,
    variant_id: linea.variant_id,
    color: linea.color,
    ...(linea.acabado === undefined ? {} : { acabado: linea.acabado }),
    unidades: linea.unidades,
    ...(linea.diam_pulg === undefined ? {} : { diam_pulg: linea.diam_pulg }),
  };
}

/**
 * Expands one structure's color pattern, or suggests one with `null`
 * (ADR-0028 §10), for the pattern editor. No catalog and no side effect.
 */
export async function llamarPythonPlanPatron(input: PythonPlanPatronInput): Promise<PythonPlanPatronResult> {
  const { plan, estructuraId, patronColor, participaciones, modo, desde, lineas, ...rest } = input;
  const operationBody = {
    schema_version: "plan-patron.v1" as const,
    plan,
    estructura_id: estructuraId,
    patron_color: patronColor,
    ...(participaciones === undefined ? {} : { participaciones: [...participaciones] }),
    ...(modo === undefined ? {} : { modo }),
    ...(desde === undefined ? {} : { desde }),
    ...(lineas === undefined ? {} : { lineas: lineas.map(lineaPlanPatron) }),
  };
  const response = await llamarPythonOperacion(PYTHON_PLAN_PATRON_PATH, PYTHON_PLAN_PATRON_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_PLAN_PATRON_SCOPE],
  });
  const parsed = planPatronPayloadResultSchema.safeParse(response.payload);
  // The answer is about the structure asked for, and a suggestion is never
  // "aplicado" (a slider preview draws the structure's own pattern, so it is).
  if (
    !parsed.success
    || parsed.data.patron.estructura_id !== estructuraId
    || parsed.data.patron.aplicado !== (patronColor !== null || participaciones !== undefined)
  ) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const resultado = { patron: parsed.data.patron, modos_admitidos: parsed.data.modos_admitidos };
  return response.replayed ? { ...resultado, replayed: true } : resultado;
}

/** Exactly the fields of `plan-armado-bouquet.v1`'s balloon, whatever else the caller's object carries. */
function globoPlanArmado(globo: PythonPlanArmadoGlobo): PythonPlanArmadoGlobo {
  return {
    product_id: globo.product_id,
    variant_id: globo.variant_id,
    titulo: globo.titulo,
    ...(globo.forma === undefined ? {} : { forma: globo.forma }),
    ...(globo.diam_pulg === undefined ? {} : { diam_pulg: globo.diam_pulg }),
    ...(globo.tamano_codigo === undefined ? {} : { tamano_codigo: globo.tamano_codigo }),
    ...(globo.color === undefined ? {} : { color: globo.color }),
    ...(globo.acabado === undefined ? {} : { acabado: globo.acabado }),
  };
}

/**
 * Resolves one bouquet's assembly, or suggests one with `null` (ADR-0030),
 * for the assembly editor. No catalog and no side effect: the browser says
 * what each balloon is and Python arranges the plan's own counts.
 */
export async function llamarPythonPlanArmadoBouquet(input: PythonPlanArmadoInput): Promise<PythonPlanArmadoResult> {
  const { plan, estructuraId, armadoBouquet, globos, variante, disposicion, ...rest } = input;
  const operationBody = {
    schema_version: "plan-armado-bouquet.v1" as const,
    plan,
    estructura_id: estructuraId,
    armado_bouquet: armadoBouquet,
    globos: globos.map(globoPlanArmado),
    ...(variante === undefined ? {} : { variante }),
    ...(disposicion === undefined ? {} : { disposicion }),
  };
  const response = await llamarPythonOperacion(PYTHON_PLAN_ARMADO_PATH, PYTHON_PLAN_ARMADO_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_PLAN_ARMADO_SCOPE],
  });
  const parsed = planArmadoPayloadResultSchema.safeParse(response.payload);
  // The answer is about the structure asked for; a given assembly comes back as given.
  if (
    !parsed.success
    || parsed.data.armado.estructura_id !== estructuraId
    || (armadoBouquet !== null && JSON.stringify(parsed.data.armado.armado) !== JSON.stringify(armadoBouquet))
  ) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const resultado = {
    armado: parsed.data.armado,
    variantes_admitidas: parsed.data.variantes_admitidas,
    disposiciones_admitidas: parsed.data.disposiciones_admitidas,
  };
  return response.replayed ? { ...resultado, replayed: true } : resultado;
}

/** Exactly the fields of `plan-armado-guirnalda.v1`'s line, whatever else the caller's object carries. */
function lineaPlanArmadoGuirnalda(linea: PythonPlanArmadoGuirnaldaLinea): PythonPlanArmadoGuirnaldaLinea {
  return {
    ...lineaPlanPatron(linea),
    ...(linea.tamano_codigo === undefined ? {} : { tamano_codigo: linea.tamano_codigo }),
  };
}

/** Same JSON whatever the key order (Python may echo an object's keys in another order). */
function jsonOrdenado(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(jsonOrdenado).join(",")}]`;
  if (valor && typeof valor === "object") {
    const entradas = Object.entries(valor as Record<string, unknown>).filter(([, campo]) => campo !== undefined).sort(([a], [b]) => a.localeCompare(b));
    return `{${entradas.map(([clave, campo]) => `${JSON.stringify(clave)}:${jsonOrdenado(campo)}`).join(",")}}`;
  }
  return JSON.stringify(valor);
}

/**
 * Resolves one garland's assembly, or suggests one with `null` (ADR-0032),
 * for the garland editor. No catalog and no side effect: the plan counts the
 * balloons and the resolved lines only name each code. Returns what the
 * editor may offer for the piece (`opciones`), decided by Python.
 */
export async function llamarPythonPlanArmadoGuirnalda(input: PythonPlanArmadoGuirnaldaInput): Promise<PythonPlanArmadoGuirnaldaResult> {
  const { plan, estructuraId, armadoGuirnalda, lineas, ...rest } = input;
  const operationBody = {
    schema_version: "plan-armado-guirnalda.v1" as const,
    plan,
    estructura_id: estructuraId,
    armado_guirnalda: armadoGuirnalda,
    ...(lineas === undefined ? {} : { lineas: lineas.map(lineaPlanArmadoGuirnalda) }),
  };
  const response = await llamarPythonOperacion(PYTHON_PLAN_ARMADO_GUIRNALDA_PATH, PYTHON_PLAN_ARMADO_GUIRNALDA_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_PLAN_ARMADO_GUIRNALDA_SCOPE],
  });
  const parsed = planArmadoGuirnaldaPayloadResultSchema.safeParse(response.payload);
  // The answer is about the structure asked for; a given assembly comes back as given.
  if (
    !parsed.success
    || parsed.data.armado.estructura_id !== estructuraId
    || (armadoGuirnalda !== null && jsonOrdenado(parsed.data.armado.armado) !== jsonOrdenado(armadoGuirnalda))
  ) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const resultado = { armado: parsed.data.armado, opciones: parsed.data.opciones };
  return response.replayed ? { ...resultado, replayed: true } : resultado;
}

/**
 * Resolves one arch's assembly, or asks for its recipe with `null`
 * (ADR-0034), for the arch editor, and brings back **the SVG the engine
 * itself emitted**. No catalog and no side effect: the plan says what the
 * piece is and `colores` only paint it. The drawing is derived -- it travels
 * on this route alone and never enters the plan, the snapshot or `plan_hash`.
 */
export async function llamarPythonPlanArmadoArco(input: PythonPlanArmadoArcoInput): Promise<PythonPlanArmadoArcoResult> {
  const { plan, estructuraId, armadoArco, colores, ...rest } = input;
  const operationBody = {
    schema_version: "plan-armado-arco.v1" as const,
    plan,
    estructura_id: estructuraId,
    armado_arco: armadoArco,
    ...(colores === undefined ? {} : { colores: [...colores] }),
  };
  const response = await llamarPythonOperacion(PYTHON_PLAN_ARMADO_ARCO_PATH, PYTHON_PLAN_ARMADO_ARCO_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_PLAN_ARMADO_ARCO_SCOPE],
  });
  const parsed = planArmadoArcoPayloadResultSchema.safeParse(response.payload);
  // A given assembly comes back as given: the engine corrects a draft in `avisos`, never behind the editor's back.
  if (!parsed.success || (armadoArco !== null && jsonOrdenado(parsed.data.armado) !== jsonOrdenado(armadoArco))) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const resultado = {
    arco: parsed.data.arco,
    grafica: parsed.data.grafica,
    armado: parsed.data.armado,
    opciones: parsed.data.opciones,
    limites: parsed.data.limites,
  };
  return response.replayed ? { ...resultado, replayed: true } : resultado;
}

/**
 * Resolves one column's assembly, or asks for its recipe with `null`
 * (ADR-0034), for the column editor, and brings back **the SVG the engine
 * itself emitted**. No catalog and no side effect: the plan says what the
 * piece is and `colores` only paint it. The drawing is derived -- it travels
 * on this route alone and never enters the plan, the snapshot or `plan_hash`.
 */
export async function llamarPythonPlanArmadoColumna(input: PythonPlanArmadoColumnaInput): Promise<PythonPlanArmadoColumnaResult> {
  const { plan, estructuraId, armadoColumna, colores, ...rest } = input;
  const operationBody = {
    schema_version: "plan-armado-columna.v1" as const,
    plan,
    estructura_id: estructuraId,
    armado_columna: armadoColumna,
    ...(colores === undefined ? {} : { colores: [...colores] }),
  };
  const response = await llamarPythonOperacion(PYTHON_PLAN_ARMADO_COLUMNA_PATH, PYTHON_PLAN_ARMADO_COLUMNA_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_PLAN_ARMADO_COLUMNA_SCOPE],
  });
  const parsed = planArmadoColumnaPayloadResultSchema.safeParse(response.payload);
  // A given assembly comes back as given: the engine corrects a draft in `avisos`, never behind the editor's back.
  if (!parsed.success || (armadoColumna !== null && jsonOrdenado(parsed.data.armado) !== jsonOrdenado(armadoColumna))) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const resultado = {
    columna: parsed.data.columna,
    grafica: parsed.data.grafica,
    armado: parsed.data.armado,
    opciones: parsed.data.opciones,
    limites: parsed.data.limites,
  };
  return response.replayed ? { ...resultado, replayed: true } : resultado;
}

/**
 * One call of the chat agent's engine operation (ADR-0034 §5). The three
 * actions share the signing, the scope and the response envelope; what each
 * one answers is validated by its own schema at the call site.
 */
async function llamarOmoikaneArmado(
  operationBody: JsonObject,
  comun: OmoikaneArmadoComun,
): Promise<PythonOperationResponse> {
  return llamarPythonOperacion(PYTHON_OMOIKANE_ARMADO_PATH, PYTHON_OMOIKANE_ARMADO_SCOPE, {
    ...comun,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_OMOIKANE_ARMADO_SCOPE],
  });
}

/**
 * What the model may use for a piece: the fourteen arch patterns (or the nine
 * of the column) with their knobs, ranges and color minimums, straight out of
 * the engine. A read: no plan, no catalog and no side effect.
 */
export async function llamarPythonOmoikaneCatalogoArmado(
  input: PythonOmoikaneCatalogoArmadoInput,
): Promise<PythonOmoikaneCatalogoArmadoResult> {
  const { tipo, ...rest } = input;
  const response = await llamarOmoikaneArmado(
    { schema_version: "omoikane-armado-estructura.v1" as const, accion: "catalogo" as const, tipo },
    rest,
  );
  const parsed = omoikaneArmadoCatalogoResultSchema.safeParse(response.payload);
  // The answer is about the type asked for.
  if (!parsed.success || parsed.data.tipo !== tipo) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const resultado = { catalogo: { tipo: parsed.data.tipo, opciones: parsed.data.opciones } as CatalogoArmado };
  return response.replayed ? { ...resultado, replayed: true } : resultado;
}

/**
 * One assembly for one piece, validated by the engine's gate and resolved so
 * the answer says what it really carries (balloons, count per material,
 * purchase and measures) with its notices. A refusal travels as
 * `armado_invalido` with its stable `motivo`; nothing half-assembled comes
 * back. The drawing does not travel: the model does not look at pixels.
 */
export async function llamarPythonOmoikaneArmarEstructura(
  input: PythonOmoikaneArmarEstructuraInput,
): Promise<PythonOmoikaneArmarEstructuraResult> {
  const { pieza, patron, materiales, opciones, geometria, remate, paleta, reparto, mezclaColores, formaLista, estilo, forma, volumen, tamanos, adornos, estructuraId, ...rest } = input;
  const response = await llamarOmoikaneArmado(
    {
      schema_version: "omoikane-armado-estructura.v1" as const,
      accion: "armar" as const,
      pieza,
      ...(patron === undefined ? {} : { patron }),
      ...(materiales === undefined ? {} : { materiales: [...materiales] }),
      ...(opciones === undefined ? {} : { opciones: { ...opciones } }),
      ...(geometria === undefined ? {} : { geometria }),
      ...(remate === undefined ? {} : { remate }),
      ...(paleta === undefined ? {} : { paleta: paleta.map((color) => ({ ...color })) }),
      ...(reparto === undefined ? {} : { reparto }),
      ...(mezclaColores === undefined ? {} : { mezcla_colores: mezclaColores }),
      ...(formaLista === undefined ? {} : { forma_lista: formaLista }),
      ...(estilo === undefined ? {} : { estilo }),
      ...(forma === undefined ? {} : { forma }),
      ...(volumen === undefined ? {} : { volumen }),
      ...(tamanos === undefined ? {} : { tamanos: tamanos.map((peso) => ({ ...peso })) }),
      ...(adornos === undefined ? {} : { adornos }),
      ...(estructuraId === undefined ? {} : { estructura_id: estructuraId }),
    },
    rest,
  );
  const parsed = omoikaneArmadoArmarResultSchema.safeParse(response.payload);
  // The answer is about the piece asked for, and -- where there is one -- with the pattern asked for. A
  // garland has none: what it was asked for is checked by its palette instead.
  const coherente = parsed.success
    && parsed.data.tipo === pieza.tipo
    && (parsed.data.tipo === "guirnalda"
      ? parsed.data.armado.colores.paleta.length === (paleta?.length ?? parsed.data.armado.colores.paleta.length)
      : parsed.data.armado.patron === patron);
  if (!parsed.success || !coherente) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  // Only the assembly travels on: the envelope's own fields (version, action) stay at the boundary. The
  // branches are spelled out so each variant keeps its own type instead of collapsing to a union.
  const comun = { avisos: parsed.data.avisos, ...(parsed.data.estructura_id === undefined ? {} : { estructura_id: parsed.data.estructura_id }) };
  const armado: ArmadoDeIa = parsed.data.tipo === "arco"
    ? { tipo: "arco", armado: parsed.data.armado, resumen: parsed.data.resumen, ...comun }
    : parsed.data.tipo === "columna"
      ? { tipo: "columna", armado: parsed.data.armado, resumen: parsed.data.resumen, ...comun }
      : { tipo: "guirnalda", armado: parsed.data.armado, resumen: parsed.data.resumen, ...comun };
  const resultado = { armado };
  return response.replayed ? { ...resultado, replayed: true } : resultado;
}

/**
 * The assembly of every arch, column and organic garland of the plan: the one
 * the model assembled when it holds against the real piece, and the engine's
 * recipe when it does not. Python revalidates both what the model assembled
 * during the turn and what it wrote straight into the plan -- only here is the
 * piece's material count known, so only here can an index be checked.
 *
 * It never reads nor writes `armado_guirnalda` (ADR-0032): that field has its
 * own owner in the resolution, and a garland may carry both.
 */
export async function llamarPythonOmoikaneCompletarArmados(
  input: PythonOmoikaneCompletarArmadosInput,
): Promise<PythonOmoikaneCompletarArmadosResult> {
  const { plan, armados, pistas, remates, inclinaciones, curvas, tamanosLeidos, ...rest } = input;
  const response = await llamarOmoikaneArmado(
    {
      schema_version: "omoikane-armado-estructura.v1" as const,
      accion: "completar" as const,
      plan,
      ...(armados === undefined || armados.length === 0
        ? {}
        : { armados: armados.map((propuesto) => ({ ...propuesto })) }),
      ...(pistas === undefined || pistas.length === 0
        ? {}
        : { pistas: pistas.map((pista) => ({ ...pista })) }),
      ...(remates === undefined || remates.length === 0
        ? {}
        : { remates: remates.map((lectura) => ({ ...lectura })) }),
      ...(inclinaciones === undefined || inclinaciones.length === 0
        ? {}
        : { inclinaciones: inclinaciones.map((lectura) => ({ ...lectura })) }),
      ...(curvas === undefined || curvas.length === 0
        ? {}
        : { curvas: curvas.map((lectura) => ({ ...lectura })) }),
      ...(tamanosLeidos === undefined || tamanosLeidos.length === 0
        ? {}
        : { tamanos_leidos: tamanosLeidos.map((lectura) => ({ ...lectura })) }),
    },
    rest,
  );
  const parsed = omoikaneArmadoCompletarResultSchema.safeParse(response.payload);
  if (!parsed.success) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const resultado = { armados: parsed.data.armados as ArmadoCompletado[] };
  return response.replayed ? { ...resultado, replayed: true } : resultado;
}

/**
 * Resolves one garland's assembly with the designer's engine, or asks for its
 * recipe with `null` (ADR-0034), and brings back **the SVG the engine itself
 * emitted**. It does NOT replace `llamarPythonPlanArmadoGuirnalda` (ADR-0032,
 * clusters and toppers): both describe the same piece from different angles
 * and coexist. No catalog and no side effect: the plan says what the piece is
 * and `colores` only paint it. The drawing is derived -- it travels on this
 * route alone and never enters the plan, the snapshot or `plan_hash`.
 */
export async function llamarPythonPlanArmadoGuirnaldaOrganica(input: PythonPlanArmadoGuirnaldaOrganicaInput): Promise<PythonPlanArmadoGuirnaldaOrganicaResult> {
  const { plan, estructuraId, armadoGuirnaldaOrganica, colores, ...rest } = input;
  const operationBody = {
    schema_version: "plan-armado-guirnalda-organica.v1" as const,
    plan,
    estructura_id: estructuraId,
    armado_guirnalda_organica: armadoGuirnaldaOrganica,
    ...(colores === undefined ? {} : { colores: [...colores] }),
  };
  const response = await llamarPythonOperacion(PYTHON_PLAN_ARMADO_GUIRNALDA_ORGANICA_PATH, PYTHON_PLAN_ARMADO_GUIRNALDA_ORGANICA_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_PLAN_ARMADO_GUIRNALDA_ORGANICA_SCOPE],
  });
  const parsed = planArmadoGuirnaldaOrganicaPayloadResultSchema.safeParse(response.payload);
  // A given assembly comes back as given: the engine corrects a draft in `avisos`, never behind the editor's back.
  if (!parsed.success || (armadoGuirnaldaOrganica !== null && jsonOrdenado(parsed.data.armado) !== jsonOrdenado(armadoGuirnaldaOrganica))) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const resultado = {
    guirnalda: parsed.data.guirnalda,
    grafica: parsed.data.grafica,
    armado: parsed.data.armado,
    opciones: parsed.data.opciones,
    limites: parsed.data.limites,
  };
  return response.replayed ? { ...resultado, replayed: true } : resultado;
}

/**
 * Resolves one arch's assembly with the designer's organic engine, or asks for
 * its recipe with `null` (ADR-0034), and brings back **the SVG the engine
 * itself emitted**. It does NOT replace `llamarPythonPlanArmadoArco` (the
 * pattern grid of the classic arch): both describe the same kind of piece and
 * coexist, and a half arch is armed here with `forma.corte` below 1. No
 * catalog and no side effect: the plan says what the piece is and `colores`
 * only paint it. The drawing is derived -- it travels on this route alone and
 * never enters the plan, the snapshot or `plan_hash`.
 */
export async function llamarPythonPlanArmadoArcoOrganico(input: PythonPlanArmadoArcoOrganicoInput): Promise<PythonPlanArmadoArcoOrganicoResult> {
  const { plan, estructuraId, armadoArcoOrganico, colores, ...rest } = input;
  const operationBody = {
    schema_version: "plan-armado-arco-organico.v1" as const,
    plan,
    estructura_id: estructuraId,
    armado_arco_organico: armadoArcoOrganico,
    ...(colores === undefined ? {} : { colores: [...colores] }),
  };
  const response = await llamarPythonOperacion(PYTHON_PLAN_ARMADO_ARCO_ORGANICO_PATH, PYTHON_PLAN_ARMADO_ARCO_ORGANICO_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_PLAN_ARMADO_ARCO_ORGANICO_SCOPE],
  });
  const parsed = planArmadoArcoOrganicoPayloadResultSchema.safeParse(response.payload);
  // A given assembly comes back as given: the engine corrects a draft in `avisos`, never behind the editor's back.
  if (!parsed.success || (armadoArcoOrganico !== null && jsonOrdenado(parsed.data.armado) !== jsonOrdenado(armadoArcoOrganico))) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const resultado = {
    arco: parsed.data.arco,
    grafica: parsed.data.grafica,
    armado: parsed.data.armado,
    opciones: parsed.data.opciones,
    limites: parsed.data.limites,
  };
  return response.replayed ? { ...resultado, replayed: true } : resultado;
}

/**
 * Brings back the schematic drawing of a piece no engine builds: the wall, the
 * circular hoop, the balloon ceiling and the table centerpiece (ADR-0034).
 *
 * It is NOT one of the four assembly previews. There is no engine and no
 * assembly here, so there is nothing to echo back and nothing to count: the
 * drawings are schematic (`referencias/dibujos.ts` of the classifier, ported
 * 1:1) and the piece's count, measures and purchase stay exactly what
 * `plan.py` resolved. `mezclaReal` is that resolved size mix, handed over so
 * nobody recomputes it. The drawing is derived -- it travels on this route
 * alone and never enters the plan, the snapshot or `plan_hash`.
 */
export async function llamarPythonPlanDibujoEstructura(input: PythonPlanDibujoEstructuraInput): Promise<PythonPlanDibujoEstructuraResult> {
  const { plan, estructuraId, mezclaReal, ...rest } = input;
  const operationBody = {
    schema_version: "plan-dibujo-estructura.v1" as const,
    plan,
    estructura_id: estructuraId,
    ...(mezclaReal === undefined ? {} : { mezcla_real: mezclaReal.map((linea) => ({ ...linea })) }),
  };
  const response = await llamarPythonOperacion(PYTHON_PLAN_DIBUJO_ESTRUCTURA_PATH, PYTHON_PLAN_DIBUJO_ESTRUCTURA_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_PLAN_DIBUJO_ESTRUCTURA_SCOPE],
  });
  const parsed = planDibujoEstructuraPayloadResultSchema.safeParse(response.payload);
  if (!parsed.success) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const resultado = { grafica: parsed.data.grafica };
  return response.replayed ? { ...resultado, replayed: true } : resultado;
}

/**
 * The balloons of every balloon structure of the approved plan as flat discs
 * (`plan-guia-escena.v1`): meters, local frame, the inflated-balloon color of
 * the Sempertex reference bought. Python owns every coordinate -- it reads the
 * balloons the engines already placed (the same door as the resolution) and
 * those of the schematic drawings -- and TypeScript only composes them into the
 * scene guide (`src/lib/ia/kagutsuchi/guia-escena.ts`). Derived: it never enters
 * the plan, the snapshot or `plan_hash`, and the response is validated against
 * the Zod owner of the contract (`src/lib/plan/guia-escena.ts`).
 */
export async function llamarPythonPlanGuiaEscena(input: PythonPlanGuiaEscenaInput): Promise<PythonPlanGuiaEscenaResult> {
  const { plan, mezclas, ...rest } = input;
  const operationBody = {
    schema_version: PLAN_GUIA_ESCENA_CONTRACT_VERSION,
    plan,
    ...(mezclas === undefined ? {} : { mezclas: PlanGuiaEscenaRequestV1Schema.shape.mezclas.unwrap().parse(mezclas) }),
  };
  const response = await llamarPythonOperacion(PYTHON_PLAN_GUIA_ESCENA_PATH, PYTHON_PLAN_GUIA_ESCENA_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_PLAN_GUIA_ESCENA_SCOPE],
  });
  const parsed = PlanGuiaEscenaResultV1Schema.safeParse(response.payload);
  if (!parsed.success) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return response.replayed ? { resultado: parsed.data, replayed: true } : { resultado: parsed.data };
}

/**
 * Resolves one column's assembly with the designer's organic engine, or asks
 * for its recipe with `null` (ADR-0034), and brings back **the SVG the engine
 * itself emitted**. It does NOT replace `llamarPythonPlanArmadoColumna` (the
 * ring tower with patterns): both describe a column and coexist. No catalog
 * and no side effect: the plan says what the piece is and `colores` only paint
 * it. The drawing is derived -- it travels on this route alone and never
 * enters the plan, the snapshot or `plan_hash`.
 */
export async function llamarPythonPlanArmadoColumnaOrganica(input: PythonPlanArmadoColumnaOrganicaInput): Promise<PythonPlanArmadoColumnaOrganicaResult> {
  const { plan, estructuraId, armadoColumnaOrganica, colores, ...rest } = input;
  const operationBody = {
    schema_version: "plan-armado-columna-organica.v1" as const,
    plan,
    estructura_id: estructuraId,
    armado_columna_organica: armadoColumnaOrganica,
    ...(colores === undefined ? {} : { colores: [...colores] }),
  };
  const response = await llamarPythonOperacion(PYTHON_PLAN_ARMADO_COLUMNA_ORGANICA_PATH, PYTHON_PLAN_ARMADO_COLUMNA_ORGANICA_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_PLAN_ARMADO_COLUMNA_ORGANICA_SCOPE],
  });
  const parsed = planArmadoColumnaOrganicaPayloadResultSchema.safeParse(response.payload);
  // A given assembly comes back as given: the engine corrects a draft in `avisos`, never behind the editor's back.
  if (!parsed.success || (armadoColumnaOrganica !== null && jsonOrdenado(parsed.data.armado) !== jsonOrdenado(armadoColumnaOrganica))) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const resultado = {
    columna: parsed.data.columna,
    grafica: parsed.data.grafica,
    armado: parsed.data.armado,
    opciones: parsed.data.opciones,
    limites: parsed.data.limites,
  };
  return response.replayed ? { ...resultado, replayed: true } : resultado;
}

export interface PythonCotizacionProfesionalInput {
  entrada: EntradaCotizacionProfesional;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

/**
 * The professional quote (`cotizacion-profesional.v1`): the decorator's own
 * costs and profit on top of the plan's materials. Python computes every
 * total; no catalog and no side effect, so nothing here touches `plan_hash`.
 */
export async function llamarPythonCotizacionProfesional(input: PythonCotizacionProfesionalInput): Promise<CotizacionProfesionalResultado> {
  const { entrada, ...rest } = input;
  const operationBody = { schema_version: "cotizacion-profesional.v1" as const, ...entrada };
  const response = await llamarPythonOperacion(PYTHON_COTIZACION_PROFESIONAL_PATH, PYTHON_COTIZACION_PROFESIONAL_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_COTIZACION_PROFESIONAL_SCOPE],
  });
  const parsed = CotizacionProfesionalResultadoSchema.safeParse(response.payload);
  // The answer is about the lines asked for, in the same order.
  if (
    !parsed.success
    || parsed.data.materiales.lineas.length !== entrada.materiales.length
    || parsed.data.materiales.lineas.some((linea, indice) => linea.variant_id !== entrada.materiales[indice]!.variant_id)
  ) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return parsed.data;
}

export type PythonListaMaterialesEntrada = z.infer<typeof ListaMaterialesRequestSchema>;
export type PythonListaMaterialesResultado = z.infer<typeof ListaMaterialesResultadoSchema>;

export async function llamarPythonListaMateriales(input: {
  entrada: PythonListaMaterialesEntrada;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
}): Promise<PythonListaMaterialesResultado> {
  const operationBody = input.entrada;
  const response = await llamarPythonOperacion(PYTHON_LISTA_MATERIALES_PATH, PYTHON_LISTA_MATERIALES_SCOPE, {
    requestId: input.requestId,
    correlationId: input.correlationId,
    deadlineMs: input.deadlineMs,
    parentSignal: input.parentSignal,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_LISTA_MATERIALES_SCOPE],
  });
  const parsed = ListaMaterialesResultadoSchema.safeParse(response.payload);
  if (!parsed.success || parsed.data.lineas.length !== input.entrada.materiales.length || parsed.data.lineas.some((linea, index) => linea.variant_id !== input.entrada.materiales[index]?.variant_id)) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return parsed.data;
}

export interface PythonEstimarConteoInput {
  /** The question, without its version: the adapter stamps `estimar-conteo.v1`. */
  solicitud: Omit<EstimarConteoRequestV1, "schema_version">;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

/**
 * How many balloons the plan would charge for some candidates, and which
 * variation of knobs brings them closer to a target count (`estimar-conteo.v1`,
 * ADR-0038). A read: no catalog, no database and no side effect, so nothing here
 * touches `planResuelto`, the approval token or `plan_hash`. Python decides every
 * figure; the answer is only checked against its contract and for being about
 * the candidates asked, in the same order.
 */
export async function llamarPythonEstimarConteo(input: PythonEstimarConteoInput): Promise<EstimarConteoResultV1 & { replayed?: boolean }> {
  const { solicitud, ...rest } = input;
  const operationBody = { schema_version: ESTIMAR_CONTEO_CONTRACT_VERSION, ...solicitud };
  const response = await llamarPythonOperacion(PYTHON_ESTIMAR_CONTEO_PATH, PYTHON_ESTIMAR_CONTEO_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_ESTIMAR_CONTEO_SCOPE],
  });
  const parsed = EstimarConteoResultV1Schema.safeParse(response.payload);
  if (
    !parsed.success
    || parsed.data.candidatos.length !== solicitud.candidatos.length
    || parsed.data.candidatos.some((candidato, indice) => candidato.etiqueta !== solicitud.candidatos[indice]!.etiqueta)
    || (solicitud.objetivo === undefined) !== (parsed.data.objetivo === null)
    || (solicitud.objetivo !== undefined && parsed.data.objetivo?.conteo !== solicitud.objetivo.conteo)
  ) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return response.replayed ? { ...parsed.data, replayed: true } : parsed.data;
}

export function pythonErrorBody(error: PythonAdapterError): {
  schema_version: "operational.v1";
  code: PythonAdapterErrorCode;
  message: string;
  retryable: boolean;
  request_id: string;
  correlation_id: string;
} {
  return {
    schema_version: "operational.v1",
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    request_id: error.requestId,
    correlation_id: error.correlationId,
  };
}

export function parseEchoPayload(value: unknown): JsonObject | undefined {
  return readJsonObject(value);
}
