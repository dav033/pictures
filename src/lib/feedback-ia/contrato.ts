import { z } from "zod";
import { MOTIVO_IDS } from "./motivos";

/**
 * Contrato HTTP de la calificación de la IA (REQ-010). Lo importan las rutas /api/feedback-ia/*, el panel de
 * administración y la UI de calificación (Taller 3D y chat del cliente); no depende de servidor.
 *
 * Flujo de la UI:
 *  1. Al terminar el turno de la IA: POST /api/feedback-ia con turnoId, producto, solicitudId (cabecera `x-request-id` de la
 *     respuesta del turno), conversacionId, pedido, respuesta, escenas y métricas. Sin `calificacion`: el turno queda registrado.
 *  2. Las capturas antes/después: POST /api/feedback-ia/capturas (multipart), una por momento.
 *  3. Cuando la persona califica: POST /api/feedback-ia con el mismo turnoId + calificacion (+ motivos, comentario). Es idempotente
 *     por (producto, turnoId): repetir el pedido no duplica nada y los campos que no se mandan se conservan.
 *  4. Si la persona deshace el turno o corrige a la IA: POST con `deshecho: true`.
 */

export const PRODUCTOS_FEEDBACK = ["taller", "cliente"] as const;
export type ProductoFeedback = (typeof PRODUCTOS_FEEDBACK)[number];

export const MOMENTOS_CAPTURA = ["antes", "despues"] as const;
export type MomentoCaptura = (typeof MOMENTOS_CAPTURA)[number];

/** Tope de cada escena serializada (el taller serializa ~50-200 kB; el plan del cliente mucho menos). */
export const TOPE_ESCENA_BYTES = 400_000;
export const TOPE_CAPTURA_BYTES = 600 * 1024;
export const TOPE_CUERPO_FEEDBACK_BYTES = 1_000_000;
export const LIMITE_MAXIMO_LISTADO = 100;
export const TOPE_FILAS_EXPORTACION = 5_000;

const IdSeguro = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Solo letras, números, guion y guion bajo (máx. 64).");

const Escena = z.record(z.string(), z.unknown()).refine(
  (valor) => JSON.stringify(valor).length <= TOPE_ESCENA_BYTES,
  { message: `La escena supera ${TOPE_ESCENA_BYTES} bytes.` },
);

export const EntradaFeedbackSchema = z.object({
  turnoId: IdSeguro,
  producto: z.enum(PRODUCTOS_FEEDBACK),
  conversacionId: IdSeguro.optional(),
  solicitudId: IdSeguro.optional(),
  calificacion: z.number().int().min(1).max(10).optional(),
  motivos: z.array(z.enum(MOTIVO_IDS)).max(MOTIVO_IDS.length).optional(),
  comentario: z.string().trim().max(2000).optional(),
  deshecho: z.boolean().optional(),
  pedido: z.string().trim().max(4000).optional(),
  respuesta: z.string().trim().max(8000).optional(),
  modelo: z.string().trim().max(120).optional(),
  costeUsd: z.number().finite().min(0).max(1000).optional(),
  latenciaMs: z.number().int().min(0).max(3_600_000).optional(),
  escenaAntes: Escena.optional(),
  escenaDespues: Escena.optional(),
}).strict();

export type EntradaFeedback = z.infer<typeof EntradaFeedbackSchema>;

export type RespuestaFeedback = {
  ok: true;
  turnoId: string;
  producto: ProductoFeedback;
  calificacion: number | null;
  /** `true` solo la primera vez que se registra el turno. */
  creado: boolean;
  actualizadoEn: string;
};

/** Campos de texto de POST /api/feedback-ia/capturas (multipart/form-data); el archivo va en el campo `imagen` (JPEG). */
export const CamposCapturaSchema = z.object({
  turnoId: IdSeguro,
  producto: z.enum(PRODUCTOS_FEEDBACK),
  momento: z.enum(MOMENTOS_CAPTURA),
}).strict();

export type RespuestaCaptura = {
  ok: true;
  turnoId: string;
  producto: ProductoFeedback;
  momento: MomentoCaptura;
  bytes: number;
};

/** Códigos de error estables para la UI (campo `codigo` de toda respuesta de error). */
export type CodigoErrorFeedback =
  | "SESION_REQUERIDA"
  | "ORIGEN_NO_PERMITIDO"
  | "SOLO_ADMINISTRADOR"
  | "DEMASIADAS_PETICIONES"
  | "CUERPO_INVALIDO"
  | "CUERPO_DEMASIADO_GRANDE"
  | "IMAGEN_INVALIDA"
  | "ALMACEN_NO_CONFIGURADO"
  | "ALMACEN_NO_DISPONIBLE"
  | "BASE_NO_DISPONIBLE"
  | "NO_ENCONTRADO"
  | "TURNO_AJENO";

export type ErrorFeedback = { error: string; codigo: CodigoErrorFeedback; detalle?: string[] };

const Entero = (minimo: number, maximo: number) => z.coerce.number().int().min(minimo).max(maximo);

/** Filtros de GET /api/feedback-ia/admin (query string). */
export const FiltrosAdminSchema = z.object({
  producto: z.enum(PRODUCTOS_FEEDBACK).optional(),
  minimo: Entero(1, 10).optional(),
  maximo: Entero(1, 10).optional(),
  motivo: z.enum(MOTIVO_IDS).optional(),
  desde: z.iso.date().optional(),
  hasta: z.iso.date().optional(),
  texto: z.string().trim().min(1).max(120).optional(),
  deshecho: z.enum(["1"]).optional(),
  sinCalificar: z.enum(["1"]).optional(),
  limite: Entero(1, LIMITE_MAXIMO_LISTADO).default(50),
  desplazamiento: Entero(0, 1_000_000).default(0),
  formato: z.enum(["json", "csv"]).default("json"),
  completo: z.enum(["1"]).optional(),
}).strict().refine((f) => f.minimo === undefined || f.maximo === undefined || f.minimo <= f.maximo, { message: "minimo no puede superar a maximo." });

export type FiltrosAdmin = z.infer<typeof FiltrosAdminSchema>;

export type ItemListadoFeedback = {
  id: number;
  turnoId: string;
  producto: ProductoFeedback;
  creadoEn: string;
  calificacion: number | null;
  motivos: string[];
  comentario: string | null;
  deshecho: boolean;
  pedido: string | null;
  modelo: string | null;
  costeUsd: number | null;
  latenciaMs: number | null;
  herramientas: string[];
  tieneImagenAntes: boolean;
  tieneImagenDespues: boolean;
};

export type RespuestaListadoFeedback = {
  total: number;
  limite: number;
  desplazamiento: number;
  items: ItemListadoFeedback[];
};

export type PasoAuditado = {
  ts: string;
  tipo: string;
  /** Herramienta, decisión o modelo; lo que mejor identifica el paso. */
  nombre: string;
  resumen: string;
  ms?: number;
};

export type LlamadaIaFeedback = {
  capacidad: string;
  modelo: string;
  herramienta: string | null;
  vuelta: number | null;
  ms: number;
  resultado: string;
  costeEstimadoUsd: number | null;
};

export type DiferenciaEscena = {
  agregados: string[];
  quitados: string[];
  modificados: { id: string; campos: string[] }[];
  /** Cambios fuera de `nodos` (sala, plan del cliente...), por ruta de campo. */
  otros: string[];
};

export type DetalleFeedback = ItemListadoFeedback & {
  usuarioId: string;
  actualizadoEn: string;
  respuesta: string | null;
  solicitudId: string | null;
  conversacionId: string | null;
  versionApp: string | null;
  pasos: PasoAuditado[];
  llamadasIa: LlamadaIaFeedback[];
  diferencia: DiferenciaEscena | null;
  escenaAntes: Record<string, unknown> | null;
  escenaDespues: Record<string, unknown> | null;
  /** Rutas servidas por GET /api/feedback-ia/admin/imagen (solo administrador); `null` si no hay captura. */
  imagenAntesUrl: string | null;
  imagenDespuesUrl: string | null;
};

export type ConteoPorClave = { clave: string; total: number; promedio: number | null };

export type FraseFrecuente = { frase: string; veces: number };

export type EjemploPeor = {
  id: number;
  turnoId: string;
  producto: ProductoFeedback;
  calificacion: number;
  motivos: string[];
  comentario: string | null;
  pedido: string | null;
};

export type MetricasAnalisis = {
  porMotivo: ConteoPorClave[];
  porProducto: ConteoPorClave[];
  porHerramienta: ConteoPorClave[];
  deshechos: number;
  frases: FraseFrecuente[];
  peores: EjemploPeor[];
};

export type AnalisisFeedback = {
  id: number;
  creadoEn: string;
  origen: "cron" | "manual" | "script";
  desde: string;
  hasta: string;
  dias: number;
  totalTurnos: number;
  totalCalificados: number;
  promedio: number | null;
  metricas: MetricasAnalisis;
  resumen: string | null;
  resumenModelo: string | null;
  resumenCosteUsd: number | null;
};

export const PedidoAnalisisSchema = z.object({
  dias: z.number().int().min(1).max(365).default(7),
  conResumen: z.boolean().default(false),
}).strict();
