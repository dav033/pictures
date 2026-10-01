import { z } from "zod";
import { ArmadoBouquetV1Schema } from "./armado-bouquet";
import { ArmadoGuirnaldaV1Schema } from "./armado-guirnalda";
import { MODOS_PATRON_COLOR, PatronColorV1Schema } from "./patron-color";
import { DENSIDADES, PlanDecoracionSchema } from "./tipos";

/**
 * Wire shapes for editing an already-resolved plan: the base plan the client
 * (browser card or chat turn) echoes back, and the edit operation itself.
 *
 * Pure schemas, no server-only code: `src/app/api/plan-editar/route.ts`,
 * `src/lib/plan/aplicar-edicion.ts` (the server-side application of an edit)
 * and `src/lib/ia/contracts/chat-v1.ts` (the chat request's `planVigente`
 * field, bundled into the browser) all import from here instead of keeping
 * their own copy — a single owner for what an edit request must look like.
 */

const BaseLineaSchema = z.object({
  product_id: z.string().min(1),
  variant_id: z.string().min(1),
  color: z.string().nullable().optional(),
}).passthrough();

/**
 * The plan envelope an edit is applied against. `.passthrough()` throughout
 * because callers hold the full `PlanResuelto` (totales, comercial,
 * alternativas...) and send it back as-is; only the fields named here are
 * read.
 */
export const BasePlanSchema = z.object({
  plan: PlanDecoracionSchema,
  plan_hash: z.string().regex(/^[a-f0-9]{64}$/i),
  approval_token: z.string().min(1),
  request_id: z.string().uuid().optional(),
  estructuras: z.array(z.object({
    estructura_id: z.string().min(1),
    lineas: z.array(BaseLineaSchema),
  }).passthrough()).min(1),
  compras: z.array(z.object({
    product_id: z.string().min(1),
    variant_id: z.string().min(1),
  }).passthrough()).min(1),
}).passthrough();

export type BasePlan = z.infer<typeof BasePlanSchema>;

const VarianteEdicionSchema = z.object({
  product_id: z.string().trim().min(1).max(160),
  variant_id: z.string().trim().min(1).max(160),
  color: z.string().trim().min(1).max(80).optional(),
  acabado: z.string().trim().min(1).max(80).optional(),
}).strict();

export const EdicionSchema = z.object({
  accion: z.enum(["agregar", "reemplazar", "quitar"]),
  estructura_id: z.string().trim().min(1).max(160),
  objetivo_variant_id: z.string().trim().min(1).max(160).optional(),
  variante: VarianteEdicionSchema.optional(),
  participacion: z.number().gt(0.01).lt(0.8).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.accion !== "agregar" && !value.objetivo_variant_id) {
    ctx.addIssue({ code: "custom", path: ["objetivo_variant_id"], message: "La operación necesita una variante objetivo." });
  }
  if (value.accion !== "quitar" && !value.variante) {
    ctx.addIssue({ code: "custom", path: ["variante"], message: "La operación necesita una variante del catálogo." });
  }
});

export type Edicion = z.infer<typeof EdicionSchema>;

/** Smallest share a color keeps when redistributing: below it, removing the color is the honest action. */
export const PARTICIPACION_MINIMA_REPARTO = 0.05;

/**
 * Redistribution of the colors of one structure from the proposal card's
 * slider: the new `participacion` of each material, in the order of the
 * structure's `materiales`. Only the HTTP editor offers it; the chat tool
 * keeps `EdicionSchema`. Python resolves the counts, as for any edit.
 */
export const EdicionRepartoSchema = z.object({
  accion: z.literal("repartir"),
  estructura_id: z.string().trim().min(1).max(160),
  participaciones: z.array(z.number().min(PARTICIPACION_MINIMA_REPARTO).lt(1)).min(2).max(6),
}).strict();

export type EdicionReparto = z.infer<typeof EdicionRepartoSchema>;

/**
 * Size balance of one structure from the card's "más pequeños ↔ más grandes"
 * slider: it picks one of the existing mixes (`mezclas.ts`). The contract and
 * the resolver are unchanged; Python counts the balloons of the new mix.
 */
export const EdicionMezclaSchema = z.object({
  accion: z.literal("mezcla"),
  estructura_id: z.string().trim().min(1).max(160),
  mezcla: z.enum(["clasica", "organica_fina", "organica_gruesa", "solo_grandes"]),
}).strict();

export type EdicionMezcla = z.infer<typeof EdicionMezclaSchema>;

/**
 * Color pattern of one structure from the pattern editor (ADR-0028 §9):
 * `null` removes it. Only the shape is checked here; Python validates the
 * pattern against the structure (`patron_invalido`) and rewrites the shares.
 */
export const EdicionPatronSchema = z.object({
  accion: z.literal("patron"),
  estructura_id: z.string().trim().min(1).max(160),
  patron_color: PatronColorV1Schema.nullable(),
}).strict();

export type EdicionPatron = z.infer<typeof EdicionPatronSchema>;

/**
 * Assembly of one bouquet from the assembly editor (ADR-0030): `null` removes
 * it. Only the shape is checked here; Python validates it against what the
 * plan buys (`armado_invalido`).
 */
export const EdicionArmadoSchema = z.object({
  accion: z.literal("armado"),
  estructura_id: z.string().trim().min(1).max(160),
  armado_bouquet: ArmadoBouquetV1Schema.nullable(),
}).strict();

export type EdicionArmado = z.infer<typeof EdicionArmadoSchema>;

/**
 * Assembly of one garland (ADR-0032): `null` removes it. Only the shape is
 * checked here; Python validates it against the plan (`armado_invalido`).
 */
export const EdicionArmadoGuirnaldaSchema = z.object({
  accion: z.literal("armado_guirnalda"),
  estructura_id: z.string().trim().min(1).max(160),
  armado_guirnalda: ArmadoGuirnaldaV1Schema.nullable(),
}).strict();

export type EdicionArmadoGuirnalda = z.infer<typeof EdicionArmadoGuirnaldaSchema>;

/**
 * Density of one structure. It is the same field the plan already declares, so
 * nothing is added to the contract: what changes is that the chat can move it.
 *
 * On a **classic arch** the density is not a multiplier: it is how the piece is
 * built. `sencilla` is a quartet (four balloons per ring), `media` a quintet and
 * `lujosa` a sextet (`services/ai-api/app/arco_clasico.ARMADO_POR_DENSIDAD`),
 * and the count is `rings x balloons per ring`. Python rejects a density the
 * official structure does not admit (`arco_no_denso` only takes `sencilla`).
 */
export const EdicionDensidadSchema = z.object({
  accion: z.literal("densidad"),
  estructura_id: z.string().trim().min(1).max(160),
  densidad: z.enum(DENSIDADES),
}).strict();

export type EdicionDensidad = z.infer<typeof EdicionDensidadSchema>;

/**
 * Color pattern of one structure **by style name**: the caller asks for a mode
 * and Python builds the starting point for it (`sugerir_patron_modo`), keeping
 * what that style admits of the pattern the piece already had.
 *
 * It exists because the chat cannot compose a whole `patron-color.v1` document
 * in a tool call without inviting invalid patterns, while the editor card can
 * (`accion: "patron"`). A style the piece does not admit comes back as
 * `patron_invalido` naming the ones it does, so the model can correct itself.
 */
export const EdicionPatronModoSchema = z.object({
  accion: z.literal("patron_modo"),
  estructura_id: z.string().trim().min(1).max(160),
  modo: z.enum(MODOS_PATRON_COLOR),
  /**
   * The style's own knobs, asked for by their common name so the chat does not
   * have to know which field each style calls them. Python maps each one to the
   * field that style carries, clamps it to what the contract admits and returns
   * a notice for a style that does not have it, so no combination of these can
   * produce an invalid pattern.
   */
  ajustes: z.object({
    /** Stripe thickness in rows: `franjas`, `zigzag`, `chevron`. */
    ancho: z.number().min(0.5).max(6).optional(),
    /** Rows between repeats: `anillos`, `flor`, `diamante`, `punteado`, `intercalado`, `damero`. */
    separacion: z.number().min(1).max(24).optional(),
    /** How much the stripe slants: `franjas`, `chevron`. */
    inclinacion: z.number().min(-3).max(4).optional(),
    /** Flips the style's order or direction: `chevron`, `apilado`, `arcoiris`, `doslados`. */
    invertir: z.boolean().optional(),
  }).strict().optional(),
}).strict();

export type EdicionPatronModo = z.infer<typeof EdicionPatronModoSchema>;

/** Every edit the plan editor applies (Python applies it: services/ai-api/app/plan_edicion.py). */
export type EdicionPlan =
  | Edicion
  | EdicionReparto
  | EdicionMezcla
  | EdicionPatron
  | EdicionPatronModo
  | EdicionDensidad
  | EdicionArmado
  | EdicionArmadoGuirnalda;

/**
 * What the chat turn may ask for with `ajustar_plan_decoracion`: a material
 * edit, the density, or a pattern by style name. The editor card's own actions
 * (`repartir`, `patron` with a whole document, the assemblies) are not here:
 * those come from a person moving a control, not from a tool call.
 */
export const EdicionChatSchema = z.union([
  EdicionSchema,
  EdicionDensidadSchema,
  EdicionPatronModoSchema,
]);

export type EdicionChat = z.infer<typeof EdicionChatSchema>;

/**
 * Whether this edit is one of the material ones, which are the only edits that
 * carry a `variante` and an `objetivo_variant_id`. `accion !== "densidad"` does
 * not narrow the union on its own, so the check lives here once instead of
 * being re-derived wherever an edit is read.
 */
export function esEdicionDeMaterial(edicion: EdicionChat): edicion is Edicion {
  return edicion.accion === "agregar" || edicion.accion === "reemplazar" || edicion.accion === "quitar";
}
