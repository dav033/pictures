import { z } from "zod";
import { COLORES_PROPUESTA_V2, PALETA_COLORES_V2 } from "@/lib/rag/taxonomy/v2";
import { ESTRUCTURAS_OFICIALES_IDS } from "@/lib/plan/estructuras-oficiales";
import { BasePlanSchema } from "@/lib/plan/edicion-esquemas";
import { MAX_PIEZAS_PLAN } from "@/lib/plan/piezas-individuales";
import { MotorGuiadaSchema } from "@/lib/guiada-motor/tipos";

export const ASISTENTE_GUIADO_VERSION = "asistente-guiado.v1" as const;
/**
 * Lo que el cliente ya dijo con sus palabras y el servidor guardó sin modelo (`hechos-cliente.ts`, usabilidad 97 y
 * comparador 100): «Soy decorador… arco orgánico de unos 3 metros… para una boda… cotizarle» dejaba el brief solo con
 * los colores, el plan de 2 × 2,2 m, la cabecera vacía y la pregunta del uso otra vez. Todo opcional: un cliente
 * anterior que no lo manda sigue valiendo.
 */
const MedidaClienteSchema = z.object({
  /** Las palabras del cliente («unos 3 metros»). */
  texto: z.string().trim().min(1).max(80),
  /** Medida sin eje («3 metros»): la pieza decide si es el ancho, el alto o el largo. */
  metros: z.number().positive().max(100).optional(),
  ancho_m: z.number().positive().max(100).optional(),
  alto_m: z.number().positive().max(100).optional(),
  largo_m: z.number().positive().max(100).optional(),
}).strict();
const EstructuraClienteSchema = z.object({
  id: z.enum(ESTRUCTURAS_OFICIALES_IDS),
  /** Las palabras del cliente («arco orgánico»). */
  texto: z.string().trim().min(1).max(80),
  /** Pidió que fuera orgánica («arco orgánico»): mezcla de tamaños aunque la oficial no sea de las orgánicas. */
  organica: z.boolean().optional(),
}).strict();
export const BriefGuiadoSchema = z.object({
  evento: z.string().trim().min(1).max(120).optional(),
  edad: z.number().int().min(0).max(120).optional(),
  tematica: z.string().trim().min(1).max(160).optional(),
  /** El rango que eligió el cliente («4 a 6 años»): la cabecera lo dice tal cual, no la edad que guardó el modelo. */
  edadTexto: z.string().trim().min(1).max(40).optional(),
  uso: z.enum(["negocio", "personal"]).optional(),
  medida: MedidaClienteSchema.optional(),
  estructura: EstructuraClienteSchema.optional(),
  /** Palabras literales del cliente: «en un jardín», «de noche», «300 mil pesos». */
  lugar: z.string().trim().min(1).max(120).optional(),
  momento: z.string().trim().min(1).max(60).optional(),
  presupuesto: z.string().trim().min(1).max(80).optional(),
}).strict();
export type BriefGuiado = z.infer<typeof BriefGuiadoSchema>;
export type MedidaCliente = z.infer<typeof MedidaClienteSchema>;
export type EstructuraCliente = z.infer<typeof EstructuraClienteSchema>;
/** Plan que el cliente tiene a la vista: viaja en cada turno para que «Cambiar algo» conserve lo que no pidió cambiar. */
/** El lado de una pieza individual («Columna izquierda»): lo conserva al rehacer el plan. */
const LateralSchema = z.enum(["lateral_izquierdo", "lateral_derecho"]);
const MedidasPiezaSchema = z.object({ ancho_m: z.number().positive().max(100).optional(), alto_m: z.number().positive().max(100).optional(), largo_m: z.number().positive().max(100).optional() }).strict();
export const PlanActualGuiadoSchema = z.object({
  // Piezas individuales (hasta 8, el tope del plan). `medidas` y `participacion` (de los globos que Python resolvió) viajan
  // para que «Cambiar algo» conserve el tamaño y la proporción de colores de lo que el cliente no pidió cambiar.
  piezas: z.array(z.object({
    estructura: z.enum(ESTRUCTURAS_OFICIALES_IDS),
    cantidad: z.number().int().min(1).max(12),
    nombre: z.string().max(120).optional(),
    ubicacion: LateralSchema.optional(),
    medidas: MedidasPiezaSchema.optional(),
    participacion: z.array(z.object({ color: z.string().trim().min(1).max(40), parte: z.number().min(0).max(1) }).strict()).max(6).optional(),
  }).strict()).min(1).max(MAX_PIEZAS_PLAN),
  colores: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  totalGlobos: z.number().int().nonnegative().optional(),
  resumen: z.string().max(400).optional(),
}).strict();
export type PlanActualGuiado = z.infer<typeof PlanActualGuiadoSchema>;
/** Una idea del catálogo que el cliente tiene a la vista (el último carrusel), en su orden: «me quedo con la primera». */
export const IdeaVisibleGuiadaSchema = z.object({ id: z.string().regex(/^(?:ej|deco)-[a-z0-9-]+$/), titulo: z.string().trim().min(1).max(160) }).strict();
export type IdeaVisibleGuiada = z.infer<typeof IdeaVisibleGuiadaSchema>;
// Sin .strict(): zod descarta las claves desconocidas, así un cliente anterior que todavía manda `propuesta: true` no recibe 400.
const EstadoGuiadoSchema = z.object({
  decoracionId: z.string().regex(/^(ej|deco)-[a-z0-9-]+$/).optional(),
  uso: z.enum(["negocio", "personal"]).optional(),
  alcancePropuesta: z.enum(["completa", "individual"]).optional(),
  piezaPedida: z.enum(ESTRUCTURAS_OFICIALES_IDS).optional(),
  planActual: PlanActualGuiadoSchema.optional(),
  /**
   * El motor del plan vigente (P-045): el aviso de un cambio por chat sigue al PLAN, no a la bandera (un plan del 3D abierto
   * se cambia en el 3D aunque la bandera diga python). La vista solo lo manda con `3d`; sin él, el plan es de Python.
   */
  motorPlan: MotorGuiadaSchema.optional().catch(undefined),
  /** Las ideas del último carrusel, en orden: `elegir_idea` elige entre ellas (edicion-plan-chat.ts). */
  ideasMostradas: z.array(IdeaVisibleGuiadaSchema).max(12).optional(),
});
const FotoInspiracionSchema = z.object({ base64: z.string().min(1).max(8_000_000), mime: z.enum(["image/jpeg", "image/png", "image/webp"]) }).strict();
export const AsistenteGuiadoRequestSchema = z.object({
  schema_version: z.literal(ASISTENTE_GUIADO_VERSION),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(6000) }).strict()).min(1).max(80),
  brief: BriefGuiadoSchema,
  estadoGuiado: EstadoGuiadoSchema.optional(),
  fotoInspiracion: FotoInspiracionSchema.optional(),
}).strict();

export const RespuestaGuiadaSchema = z.object({
  // Parcial: también vuelve cuando solo cambió lo que dijo el cliente (evento, uso, medida…), sin temática todavía.
  brief: BriefGuiadoSchema.optional(),
  decoraciones: z.array(z.unknown()).optional(),
  opciones: z.array(z.enum(["contratar", "costear", "comprar", "aprender"])).optional(),
  preguntaUso: z.boolean().optional(),
  cotizacion: z.unknown().optional(),
  uso: z.enum(["negocio", "personal"]).optional(),
  pasos: z.array(z.object({ orden: z.number().int().positive(), texto: z.string().min(1) }).strict()).optional(),
  proveedores: z.array(z.unknown()).optional(),
}).passthrough();

export const ListaMaterialesRequestSchema = z.object({
  schema_version: z.literal("lista-materiales.v1"),
  materiales: z.array(z.object({ variant_id: z.string().min(1).max(160), cantidad: z.number().int().positive().max(100_000) }).strict()).min(1).max(256)
    .refine((lineas) => new Set(lineas.map((linea) => linea.variant_id)).size === lineas.length),
}).strict();
export const ListaMaterialesResultadoSchema = z.object({
  operation_schema_version: z.literal("lista-materiales-result.v1"),
  currency: z.literal("COP"),
  incluye_iva: z.literal(true),
  lineas: z.array(z.object({ variant_id: z.string(), nombre: z.string(), cantidad_necesaria: z.number().int().positive(), unidades_paquete: z.number().int().positive(), paquetes: z.number().int().positive(), precio_paquete: z.number().int().positive(), subtotal: z.number().int().positive(), sobrante: z.number().int().nonnegative() }).strict()),
  total: z.number().int().positive(),
}).strict();
export const CotizacionGuiadaSchema = z.object({
  lineas: z.array(z.object({ id: z.string(), tamano: z.string(), color: z.enum(PALETA_COLORES_V2).optional(), cantidadNecesaria: z.number().int().positive(), disponible: z.boolean(), varianteId: z.string(), nombre: z.string(), precioPaquete: z.number().int().positive(), unidadesPaquete: z.number().int().positive(), paquetes: z.number().int().positive(), subtotal: z.number().int().positive(), sobrante: z.number().int().nonnegative() }).strict()).min(1),
  total: z.number().int().positive(),
  // 0 en la lista curada de una idea (cantidades exactas, sin reserva); 8 con el motor 3D (merma sobre su conteo, REQ-007).
  mermaPorcentaje: z.number().min(0).max(100), incluyeIva: z.literal(true), complementosSoportados: z.literal(false),
}).strict();

/** Colores de una propuesta: los del plan entero (`concepto.paleta` admite 8). El modelo propone como mucho 5 (su esquema). */
export const MAX_COLORES_PROPUESTA = 8;
export const PropuestaComposicionSchema = z.object({
  frase: z.string().trim().min(1).max(360),
  // La paleta y los tonos claros («celeste», «rosa pastel», «durazno»: taxonomy/v2.ts). Solo TypeScript: al plan de
  // Python le llega la familia («azul») y la búsqueda del catálogo se queda con los globos del tono (tonos-color.ts).
  colores: z.array(z.enum(COLORES_PROPUESTA_V2)).min(1).max(MAX_COLORES_PROPUESTA),
  // Hasta 8 (el tope del plan): «Ajustar mi plan» y «Agregar al plan» la arman con piezas individuales. `ubicacion` no la
  // manda el modelo (su esquema no la tiene): la pone quien arma la propuesta desde un plan con lados. `colores` de una
  // pieza (tampoco los manda el modelo): «Agregar al plan» suma una idea en sus colores sin teñir las piezas que ya había;
  // como mucho 6, los materiales que admite una pieza del plan. `medidas`: las de la pieza de la idea (biblioteca), para que
  // el plan salga del tamaño que el cliente vio en la foto y no con medidas por defecto.
  piezas: z.array(z.object({
    estructura: z.enum(ESTRUCTURAS_OFICIALES_IDS),
    cantidad: z.number().int().min(1).max(12),
    nombre: z.string().min(1).max(120).optional(),
    ubicacion: LateralSchema.optional(),
    colores: z.array(z.enum(COLORES_PROPUESTA_V2)).min(1).max(6).optional(),
    medidas: MedidasPiezaSchema.optional(),
  }).strict()).min(1).max(MAX_PIEZAS_PLAN),
}).strict();
export const PlanGuiadoSchema = BasePlanSchema;
export const CotizacionPlanGuiadoSchema = z.object({
  lineas: z.array(z.object({ id: z.string(), tamano: z.string(), cantidadNecesaria: z.number().int().positive(), disponible: z.boolean(), varianteId: z.string().optional(), nombre: z.string().optional(), precioPaquete: z.number().int().nonnegative().optional(), unidadesPaquete: z.number().int().positive().optional(), paquetes: z.number().int().nonnegative().optional(), subtotal: z.number().int().nonnegative().optional(), sobrante: z.number().int().nonnegative().optional(), color: z.string().optional() }).passthrough()),
  total: z.number().int().nonnegative(), mermaPorcentaje: z.number().nonnegative(), incluyeIva: z.boolean(), complementosSoportados: z.literal(false),
}).passthrough();

export type AsistenteGuiadoRequest = z.infer<typeof AsistenteGuiadoRequestSchema>;
