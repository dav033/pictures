import { z } from "zod";

export const TIPOS_ESTRUCTURA = [
  "arco", "semiarco", "guirnalda", "columna", "pared",
  "centro_mesa", "backdrop", "kit", "accesorio",
] as const;

export const UBICACIONES = [
  "fondo_pared", "arco_central", "sobre_mesa_principal",
  "lateral_izquierdo", "lateral_derecho", "piso_frontal",
  "mesas_invitados", "entrada", "techo",
] as const;

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
  const geometrica = ["arco", "semiarco", "guirnalda", "columna", "pared", "centro_mesa"].includes(value.tipo);
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

export const PlanDecoracionSchema = z.object({
  plan_version: z.literal("1.0"),
  plan_id: z.string().uuid(),
  concepto: z.object({
    titulo: z.string().trim().min(1).max(160),
    descripcion: z.string().trim().min(1).max(320),
    paleta: z.array(z.string().trim().min(1).max(80)).max(8),
    estilo: z.string().trim().max(80).optional(),
    ocasion: z.string().trim().max(80).optional(),
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
  referencia_omitida: z.array(z.object({
    element_id: z.string().trim().min(1).max(80),
    motivo: z.string().trim().min(1).max(240),
  }).strict()).max(40).default([]),
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
