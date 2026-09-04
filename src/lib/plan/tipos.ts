import { z } from "zod";
import {
  anclaSatisfaceRelacion,
  CATEGORIAS_SUJETO_ESCULTURA,
  DISTRIBUCIONES_ESPACIALES,
  FUNCIONES_PARTE_ESCULTURA,
  MAX_ANCLAS_ESPACIO,
  PROCEDENCIAS_ANCLA,
  RELACIONES_FISICAS,
  TIPOS_ANCLA_ESPACIO,
  TIPOS_ESTRUCTURA as TIPOS_ESTRUCTURA_PLAN_1_1,
  TIPOS_ESTRUCTURA_1_0,
  TIPOS_ESTRUCTURA_GEOMETRICOS,
  UBICACIONES_1_0,
  UBICACIONES_1_1,
  validarCoberturaEsculturaBom,
  validarGrafoRelaciones,
  validarRelacionesDeElemento,
  type RelacionFisicaInput,
} from "./composicion";

/**
 * Vocabulario de Plan 1.0, importado de la fuente única
 * (`src/lib/plan/composicion.ts`) — no se mantiene una segunda lista manual.
 * `escultura` y las ubicaciones 1.1 no existen en este vocabulario a propósito:
 * Plan 1.0 nunca accede parcialmente a esas piezas nuevas.
 */
export const TIPOS_ESTRUCTURA = TIPOS_ESTRUCTURA_1_0;
export const UBICACIONES = UBICACIONES_1_0;

export const ROLES_MATERIAL = ["principal", "secundario", "acento"] as const;
export const ROLES_ESCENA = ["focal", "soporte", "relleno", "acento", "servicio"] as const;
export const DENSIDADES = ["sencilla", "media", "lujosa"] as const;
export const MEZCLAS = ["clasica", "organica_fina", "organica_gruesa", "solo_grandes"] as const;
export const PROCEDENCIAS = ["explicito", "inferido", "supuesto"] as const;

const ValorConProcedenciaSchema = z.object({
  valor: z.string().trim().min(1).max(120),
  procedencia: z.enum(PROCEDENCIAS),
  texto_original: z.string().trim().min(1).max(240),
  polaridad: z.enum(["obligatorio", "prohibido", "preferencia"]).default("obligatorio"),
}).strict();

export const RestriccionesUsuarioSchema = z.object({
  presupuesto: z.object({
    techo_cop: z.number().int().positive(),
    procedencia: z.enum(PROCEDENCIAS),
    texto_original: z.string().trim().min(1).max(240),
  }).optional(),
  estructuras: z.array(z.object({
    tipo: z.enum(TIPOS_ESTRUCTURA),
    repeticiones: z.number().int().min(1).max(24),
    procedencia: z.enum(PROCEDENCIAS),
    texto_original: z.string().trim().min(1).max(240),
    polaridad: z.enum(["obligatorio", "prohibido", "preferencia"]).default("obligatorio"),
  }).strict()).max(24).default([]),
  colores: z.array(ValorConProcedenciaSchema).max(12).default([]),
  tamanos: z.array(ValorConProcedenciaSchema).max(12).default([]),
  acabados: z.array(ValorConProcedenciaSchema).max(12).default([]),
}).strict();

const MedidasSchema = z.object({
  ancho_m: z.number().positive().max(100).optional(),
  alto_m: z.number().positive().max(100).optional(),
  largo_m: z.number().positive().max(100).optional(),
}).strict();

const MaterialPlanSchema = z.object({
  product_id: z.string().trim().min(1).max(160),
  variant_id: z.string().trim().min(1).max(160).optional(),
  color: z.string().trim().min(1).max(80).optional(),
  acabado: z.string().trim().min(1).max(80).optional(),
  participacion: z.number().gt(0).lte(1),
  rol_material: z.enum(ROLES_MATERIAL),
}).strict();

const VariantOverrideSchema = z.object({
  objetivo_variant_id: z.string().trim().min(1).max(160),
  product_id: z.string().trim().min(1).max(160),
  variant_id: z.string().trim().min(1).max(160),
  color: z.string().trim().min(1).max(80).optional(),
}).strict();

const EstructuraPlanSchema = z.object({
  estructura_id: z.string().regex(/^EST_\d{2}_[A-Z_]+$/),
  nombre: z.string().trim().min(1).max(160),
  tipo: z.enum(TIPOS_ESTRUCTURA),
  rol_escena: z.enum(ROLES_ESCENA),
  ubicacion: z.enum(UBICACIONES),
  medidas: MedidasSchema,
  repeticiones: z.number().int().min(1).max(24).default(1),
  densidad: z.enum(DENSIDADES),
  mezcla: z.enum(MEZCLAS),
  materiales: z.array(MaterialPlanSchema).min(1).max(6),
  unidades_declaradas: z.number().int().positive().max(999).optional(),
  porque: z.string().trim().min(1).max(240),
  /** Replaces one resolved catalog line without changing every size in a geometric structure. */
  variant_overrides: z.array(VariantOverrideSchema).max(24).optional(),
  /** Qué elemento del blueprint de referencia (analizado en este turno) materializa
   * esta estructura — plan de integración de referencias visuales, R4. Solo tiene
   * sentido cuando el cliente adjuntó una imagen de referencia en este turno. */
  referencia_element_id: z.string().trim().min(1).max(80).optional(),
}).strict().superRefine((value, ctx) => {
  const participacion = value.materiales.reduce((sum, material) => sum + material.participacion, 0);
  if (Math.abs(participacion - 1) > 0.001) {
    ctx.addIssue({ code: "custom", path: ["materiales"], message: "Las participaciones deben sumar 1 (±0,001)." });
  }
  const geometrica = (TIPOS_ESTRUCTURA_GEOMETRICOS as readonly string[]).includes(value.tipo);
  if (geometrica && value.unidades_declaradas !== undefined) {
    ctx.addIssue({ code: "custom", path: ["unidades_declaradas"], message: "Las estructuras geométricas no declaran unidades; las calcula el backend." });
  }
  if (!geometrica && value.unidades_declaradas === undefined) {
    ctx.addIssue({ code: "custom", path: ["unidades_declaradas"], message: "Las piezas sin geometría requieren unidades_declaradas." });
  }
  if (!geometrica && value.materiales.some((material) => !material.variant_id)) {
    ctx.addIssue({ code: "custom", path: ["materiales"], message: "Las piezas sin geometría requieren variant_id por material." });
  }
  if (value.tipo === "backdrop" && value.ubicacion !== "fondo_pared") {
    ctx.addIssue({ code: "custom", path: ["ubicacion"], message: "Un backdrop debe ubicarse en fondo_pared." });
  }
  if (value.tipo === "centro_mesa" && !["mesas_invitados", "sobre_mesa_principal"].includes(value.ubicacion)) {
    ctx.addIssue({ code: "custom", path: ["ubicacion"], message: "Un centro_mesa debe ubicarse en mesas_invitados o sobre_mesa_principal." });
  }
});

export const MOTIVOS_OMISION_REFERENCIA = [
  "fuera_de_catalogo",
  "emulacion_propuesta",
  "emulacion_rechazada",
  "decision_de_diseno",
] as const;

export const MotivoOmissionReferenciaSchema = z.enum(MOTIVOS_OMISION_REFERENCIA);
// Alias descriptivo para callers que hablan de tipo de motivo, sin romper el
// nombre interno usado por el plan.
export const MotivoTipoReferenciaSchema = MotivoOmissionReferenciaSchema;

export const ReferenciaOmitidaSchema = z.object({
  element_id: z.string().trim().min(1).max(80),
  motivo: z.string().trim().min(1).max(240),
  motivo_tipo: MotivoOmissionReferenciaSchema,
  propuesta: z.string().trim().min(1).max(240).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.motivo_tipo === "emulacion_propuesta" && !value.propuesta) {
    ctx.addIssue({ code: "custom", path: ["propuesta"], message: "Una emulación propuesta debe explicar qué se construirá." });
  }
});

export const PlanDecoracionSchema = z.object({
  plan_version: z.literal("1.0"),
  plan_id: z.string().uuid(),
  concepto: z.object({
    titulo: z.string().trim().min(1).max(160),
    descripcion: z.string().trim().min(1).max(320),
    paleta: z.array(z.string().trim().min(1).max(80)).max(8),
    estilo: z.string().trim().max(80).optional(),
    /** Customer's free event label; never restricted to catalog occasions. */
    ocasion: z.string().trim().max(160).optional(),
    momento_dia: z.string().trim().max(80).optional(),
  }).strict(),
  espacio: z.object({
    tipo: z.string().trim().min(1).max(80),
    ancho_m: z.number().positive().max(100).optional(),
    alto_m: z.number().positive().max(100).optional(),
    largo_m: z.number().positive().max(100).optional(),
    fuente: z.enum(["cliente", "supuesto", "foto"]),
  }).strict(),
  estructuras: z.array(EstructuraPlanSchema).min(1).max(8),
  supuestos: z.array(z.string().trim().min(1).max(240)).max(30),
  restricciones: RestriccionesUsuarioSchema.optional(),
  /** Elementos detectados en la referencia visual que el plan decide NO
   * cubrir, con el motivo real — plan de integración de referencias
   * visuales, R4. Junto con `estructuras[].referencia_element_id`, cubre la
   * unión completa de elementos aprobados del blueprint del turno; ver
   * `validarCoberturaReferencia`. */
  referencia_omitida: z.array(ReferenciaOmitidaSchema).max(40).default([]),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  for (const estructura of value.estructuras) {
    if (ids.has(estructura.estructura_id)) {
      ctx.addIssue({ code: "custom", path: ["estructuras"], message: `estructura_id repetido: ${estructura.estructura_id}` });
    }
    ids.add(estructura.estructura_id);
  }
  if (!value.estructuras.some((estructura) => estructura.rol_escena === "focal")) {
    ctx.addIssue({ code: "custom", path: ["estructuras"], message: "El plan necesita al menos una estructura focal." });
  }
  if (value.estructuras.filter((estructura) => estructura.ubicacion === "fondo_pared").length > 1) {
    ctx.addIssue({ code: "custom", path: ["estructuras"], message: "Solo puede haber una estructura en fondo_pared." });
  }
  if (value.estructuras.filter((estructura) => estructura.ubicacion === "techo").length > 1) {
    ctx.addIssue({ code: "custom", path: ["estructuras"], message: "Solo puede haber una estructura en techo." });
  }
});

export type MaterialPlan = z.infer<typeof MaterialPlanSchema>;
export type EstructuraPlan = z.infer<typeof EstructuraPlanSchema>;
export type PlanDecoracion = z.infer<typeof PlanDecoracionSchema>;
export type TipoEstructura = PlanDecoracion["estructuras"][number]["tipo"];
export type Ubicacion = PlanDecoracion["estructuras"][number]["ubicacion"];
export type Densidad = PlanDecoracion["estructuras"][number]["densidad"];
export type Mezcla = PlanDecoracion["estructuras"][number]["mezcla"];
export type RestriccionesUsuario = z.infer<typeof RestriccionesUsuarioSchema>;
export type MotivoOmissionReferencia = z.infer<typeof MotivoOmissionReferenciaSchema>;
export type MotivoTipoReferencia = MotivoOmissionReferencia;
export type ReferenciaOmitida = z.infer<typeof ReferenciaOmitidaSchema>;

// ---------------------------------------------------------------------------
// Plan 1.1 (PLAN-COMPOSICION-RICA-V001.md §6): escultura con BOM exacto,
// anclas del espacio con evidencia, relaciones físicas tipadas y props de
// catálogo independientes. No sustituye Plan 1.0: conviven mientras existan
// pestañas abiertas con planes 1.0 ya aprobados (ver §6.1). Un plan 1.0 nunca
// accede parcialmente a estos campos porque usa `PlanDecoracionSchema`, un
// schema `.strict()` distinto que no los declara.
// ---------------------------------------------------------------------------

const BBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
}).strict();

export const AnclaEspacioSchema = z.object({
  ancla_id: z.string().regex(/^ANC_[A-Za-z0-9_]+$/),
  tipo: z.enum(TIPOS_ANCLA_ESPACIO),
  procedencia: z.enum(PROCEDENCIAS_ANCLA),
  evidencia: z.string().trim().min(1).max(240),
  bbox: BBoxSchema.optional(),
}).strict();
export type AnclaEspacio = z.infer<typeof AnclaEspacioSchema>;

const RelacionTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ancla_espacio"), id: z.string().trim().min(1).max(80) }).strict(),
  z.object({ kind: z.literal("elemento_plan"), id: z.string().trim().min(1).max(80) }).strict(),
]);

export const RelacionFisicaSchema = z.object({
  relacion: z.enum(RELACIONES_FISICAS),
  target: RelacionTargetSchema,
  prioridad: z.enum(["primaria", "secundaria"]),
  distribucion: z.enum(DISTRIBUCIONES_ESPACIALES).optional(),
}).strict();
export type RelacionFisica = z.infer<typeof RelacionFisicaSchema>;

/** Reusa el invariante puro de composicion.ts como superRefine de zod. */
function validarRelacionesFisicasSchema(relaciones: RelacionFisicaInput[], ctx: z.RefinementCtx): void {
  for (const error of validarRelacionesDeElemento(relaciones)) {
    ctx.addIssue({ code: "custom", path: ["relaciones_fisicas"], message: error });
  }
}

const ParteEsculturaSchema = z.object({
  parte_id: z.string().trim().min(1).max(60),
  funcion: z.enum(FUNCIONES_PARTE_ESCULTURA),
  descriptor_perceptual_en: z.string().trim().min(1).max(200),
  variant_ids: z.array(z.string().trim().min(1).max(160)).min(1).max(12),
}).strict();

export const EsculturaVisualSchema = z.object({
  categoria_sujeto: z.enum(CATEGORIAS_SUJETO_ESCULTURA),
  sujeto: z.string().trim().min(1).max(80),
  descripcion_perceptual_en: z.string().trim().min(1).max(400),
  partes: z.array(ParteEsculturaSchema).min(1).max(12),
}).strict().superRefine((value, ctx) => {
  const idsPartes = new Set<string>();
  for (const parte of value.partes) {
    if (idsPartes.has(parte.parte_id)) {
      ctx.addIssue({ code: "custom", path: ["partes"], message: `parte_id repetido: ${parte.parte_id}` });
    }
    idsPartes.add(parte.parte_id);
  }
});
export type EsculturaVisual = z.infer<typeof EsculturaVisualSchema>;

const MaterialPlan1_1Schema = z.object({
  product_id: z.string().trim().min(1).max(160),
  variant_id: z.string().trim().min(1).max(160).optional(),
  color: z.string().trim().min(1).max(80).optional(),
  acabado: z.string().trim().min(1).max(80).optional(),
  participacion: z.number().gt(0).lte(1).optional(),
  rol_material: z.enum(ROLES_MATERIAL),
  /** Exclusivo de `escultura`: unidades exactas de este material por instancia física. */
  unidades_por_instancia: z.number().int().positive().max(999).optional(),
  /** Exclusivo de `escultura`: qué partes construye este material. */
  parte_ids: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
}).strict();
export type MaterialPlan1_1 = z.infer<typeof MaterialPlan1_1Schema>;

export const PropCatalogoSchema = z.object({
  prop_id: z.string().regex(/^PROP_[A-Za-z0-9_]+$/),
  product_id: z.string().trim().min(1).max(160),
  variant_id: z.string().trim().min(1).max(160),
  unidades_declaradas: z.number().int().positive().max(999),
  rol_escena: z.enum(ROLES_ESCENA),
  ubicacion: z.enum(UBICACIONES_1_1),
  relaciones_fisicas: z.array(RelacionFisicaSchema).max(2).default([]),
  porque: z.string().trim().min(1).max(240),
  referencia_element_id: z.string().trim().min(1).max(80).optional(),
  // Sin `nombre`, `motivo`, `material`, `color` ni `descripcion_visual`: esos
  // datos se cargan del concepto visual ligado a la variante real, nunca los
  // escribe el LLM (PLAN-COMPOSICION-RICA-V001.md §6.7).
}).strict().superRefine((value, ctx) => validarRelacionesFisicasSchema(value.relaciones_fisicas, ctx));
export type PropCatalogo = z.infer<typeof PropCatalogoSchema>;

export const EstructuraPlan1_1Schema = z.object({
  estructura_id: z.string().regex(/^EST_\d{2}_[A-Z_]+$/),
  nombre: z.string().trim().min(1).max(160),
  tipo: z.enum(TIPOS_ESTRUCTURA_PLAN_1_1),
  rol_escena: z.enum(ROLES_ESCENA),
  ubicacion: z.enum(UBICACIONES_1_1),
  medidas: MedidasSchema,
  repeticiones: z.number().int().min(1).max(24).default(1),
  densidad: z.enum(DENSIDADES),
  mezcla: z.enum(MEZCLAS),
  materiales: z.array(MaterialPlan1_1Schema).min(1).max(12),
  unidades_declaradas: z.number().int().positive().max(999).optional(),
  /** Requerido cuando `tipo === "escultura"`; ausente en cualquier otro tipo. */
  escultura_visual: EsculturaVisualSchema.optional(),
  relaciones_fisicas: z.array(RelacionFisicaSchema).max(2).default([]),
  porque: z.string().trim().min(1).max(240),
  variant_overrides: z.array(VariantOverrideSchema).max(24).optional(),
  referencia_element_id: z.string().trim().min(1).max(80).optional(),
}).strict().superRefine((value, ctx) => {
  validarRelacionesFisicasSchema(value.relaciones_fisicas, ctx);

  if (value.tipo === "escultura") {
    if (!value.escultura_visual) {
      ctx.addIssue({ code: "custom", path: ["escultura_visual"], message: "Una escultura requiere escultura_visual." });
    } else {
      if (value.unidades_declaradas !== undefined) {
        ctx.addIssue({ code: "custom", path: ["unidades_declaradas"], message: "Una escultura no usa unidades_declaradas; cada material declara unidades_por_instancia." });
      }
      if (value.materiales.some((material) => !material.variant_id || !material.unidades_por_instancia)) {
        ctx.addIssue({ code: "custom", path: ["materiales"], message: "Todo material de una escultura requiere variant_id y unidades_por_instancia." });
      }
      for (const error of validarCoberturaEsculturaBom(value.materiales, value.escultura_visual.partes)) {
        ctx.addIssue({ code: "custom", path: ["escultura_visual", "partes"], message: error });
      }
    }
  } else {
    if (value.escultura_visual) {
      ctx.addIssue({ code: "custom", path: ["escultura_visual"], message: "Solo una estructura de tipo escultura puede declarar escultura_visual." });
    }
    if (value.materiales.some((material) => material.unidades_por_instancia !== undefined || material.parte_ids !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["materiales"], message: "unidades_por_instancia y parte_ids son exclusivos de escultura." });
    }
    const geometrica = (TIPOS_ESTRUCTURA_GEOMETRICOS as readonly string[]).includes(value.tipo);
    if (value.materiales.some((material) => material.participacion === undefined)) {
      ctx.addIssue({ code: "custom", path: ["materiales"], message: "Toda estructura no escultórica requiere participacion por material." });
    } else {
      const participacion = value.materiales.reduce((sum, material) => sum + (material.participacion ?? 0), 0);
      if (Math.abs(participacion - 1) > 0.001) {
        ctx.addIssue({ code: "custom", path: ["materiales"], message: "Las participaciones deben sumar 1 (±0,001)." });
      }
    }
    if (geometrica && value.unidades_declaradas !== undefined) {
      ctx.addIssue({ code: "custom", path: ["unidades_declaradas"], message: "Las estructuras geométricas no declaran unidades; las calcula el backend." });
    }
    if (!geometrica && value.unidades_declaradas === undefined) {
      ctx.addIssue({ code: "custom", path: ["unidades_declaradas"], message: "Las piezas sin geometría requieren unidades_declaradas." });
    }
    if (!geometrica && value.materiales.some((material) => !material.variant_id)) {
      ctx.addIssue({ code: "custom", path: ["materiales"], message: "Las piezas sin geometría requieren variant_id por material." });
    }
  }

  if (value.tipo === "backdrop" && value.ubicacion !== "fondo_pared") {
    ctx.addIssue({ code: "custom", path: ["ubicacion"], message: "Un backdrop debe ubicarse en fondo_pared." });
  }
  if (value.tipo === "centro_mesa" && !["mesas_invitados", "sobre_mesa_principal"].includes(value.ubicacion)) {
    ctx.addIssue({ code: "custom", path: ["ubicacion"], message: "Un centro_mesa debe ubicarse en mesas_invitados o sobre_mesa_principal." });
  }
});
export type EstructuraPlan1_1 = z.infer<typeof EstructuraPlan1_1Schema>;

export const PlanDecoracion1_1Schema = z.object({
  plan_version: z.literal("1.1"),
  plan_id: z.string().uuid(),
  concepto: z.object({
    titulo: z.string().trim().min(1).max(160),
    descripcion: z.string().trim().min(1).max(320),
    paleta: z.array(z.string().trim().min(1).max(80)).max(8),
    estilo: z.string().trim().max(80).optional(),
    ocasion: z.string().trim().max(160).optional(),
    momento_dia: z.string().trim().max(80).optional(),
  }).strict(),
  espacio: z.object({
    tipo: z.string().trim().min(1).max(80),
    ancho_m: z.number().positive().max(100).optional(),
    alto_m: z.number().positive().max(100).optional(),
    largo_m: z.number().positive().max(100).optional(),
    fuente: z.enum(["cliente", "supuesto", "foto"]),
    anclas: z.array(AnclaEspacioSchema).max(MAX_ANCLAS_ESPACIO).default([]),
  }).strict(),
  estructuras: z.array(EstructuraPlan1_1Schema).min(1).max(8),
  props_catalogo: z.array(PropCatalogoSchema).max(16).default([]),
  supuestos: z.array(z.string().trim().min(1).max(240)).max(30),
  restricciones: RestriccionesUsuarioSchema.optional(),
  referencia_omitida: z.array(ReferenciaOmitidaSchema).max(40).default([]),
}).strict().superRefine((value, ctx) => {
  const idsEstructura = new Set<string>();
  for (const estructura of value.estructuras) {
    if (idsEstructura.has(estructura.estructura_id)) {
      ctx.addIssue({ code: "custom", path: ["estructuras"], message: `estructura_id repetido: ${estructura.estructura_id}` });
    }
    idsEstructura.add(estructura.estructura_id);
  }
  const idsProp = new Set<string>();
  for (const prop of value.props_catalogo) {
    if (idsProp.has(prop.prop_id)) {
      ctx.addIssue({ code: "custom", path: ["props_catalogo"], message: `prop_id repetido: ${prop.prop_id}` });
    }
    idsProp.add(prop.prop_id);
  }
  const idsAncla = new Set<string>();
  for (const ancla of value.espacio.anclas) {
    if (idsAncla.has(ancla.ancla_id)) {
      ctx.addIssue({ code: "custom", path: ["espacio", "anclas"], message: `ancla_id repetido: ${ancla.ancla_id}` });
    }
    idsAncla.add(ancla.ancla_id);
  }

  if (!value.estructuras.some((estructura) => estructura.rol_escena === "focal")) {
    ctx.addIssue({ code: "custom", path: ["estructuras"], message: "El plan necesita al menos una estructura focal." });
  }
  if (value.estructuras.filter((estructura) => estructura.ubicacion === "fondo_pared").length > 1) {
    ctx.addIssue({ code: "custom", path: ["estructuras"], message: "Solo puede haber una estructura en fondo_pared." });
  }
  if (value.estructuras.filter((estructura) => estructura.ubicacion === "techo").length > 1) {
    ctx.addIssue({ code: "custom", path: ["estructuras"], message: "Solo puede haber una estructura en techo." });
  }

  const anclasPorId = new Map(value.espacio.anclas.map((ancla) => [ancla.ancla_id, ancla]));
  const nodos = [
    ...value.estructuras.map((estructura) => ({ id: estructura.estructura_id, relaciones: estructura.relaciones_fisicas })),
    ...value.props_catalogo.map((prop) => ({ id: prop.prop_id, relaciones: prop.relaciones_fisicas })),
  ];
  for (const nodo of nodos) {
    for (const relacion of nodo.relaciones) {
      if (relacion.target.kind === "ancla_espacio") {
        const ancla = anclasPorId.get(relacion.target.id);
        if (ancla && !anclaSatisfaceRelacion(relacion.relacion, ancla.tipo)) {
          ctx.addIssue({ code: "custom", path: ["estructuras"], message: `${nodo.id}: la relación "${relacion.relacion}" no admite un ancla de tipo "${ancla.tipo}".` });
        }
      }
    }
  }
  for (const error of validarGrafoRelaciones(nodos, new Set(anclasPorId.keys()))) {
    ctx.addIssue({ code: "custom", path: ["estructuras"], message: error });
  }
});

export type PlanDecoracion1_1 = z.infer<typeof PlanDecoracion1_1Schema>;
export type TipoEstructura1_1 = PlanDecoracion1_1["estructuras"][number]["tipo"];
export type Ubicacion1_1Plan = PlanDecoracion1_1["estructuras"][number]["ubicacion"];
