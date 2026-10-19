import { z } from "zod";
import { ArmadoArcoV1Schema } from "./armado-arco";
import { ArmadoArcoOrganicoV1Schema } from "./armado-arco-organico";
import { ArmadoBouquetV1Schema } from "./armado-bouquet";
import { ArmadoColumnaV1Schema } from "./armado-columna";
import { ArmadoColumnaOrganicaV1Schema } from "./armado-columna-organica";
import { ArmadoGuirnaldaV1Schema } from "./armado-guirnalda";
import { ArmadoGuirnaldaOrganicaV1Schema } from "./armado-guirnalda-organica";
import { FloresPiezaV1Schema } from "./flores-pieza";
import { MAX_LARGO_FORMA_PIEZA } from "./formas-pieza";
import { PatronColorV1Schema } from "./patron-color";
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
 * structure's `materiales`. The HTTP editor and the chat tool
 * (`ajustar_plan_decoracion`, via `src/lib/plan/edicion-chat.ts`) both offer
 * it. Python resolves the counts, as for any edit.
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
 * the resolver are unchanged; Python counts the balloons of the new mix. The
 * chat tool offers it too ("globos más grandes").
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
 * Assembly of one arch from the arch editor (ADR-0035, step 1): `null` removes
 * it. Only the shape is checked here (`armado-arco.v1`); Python validates it
 * against the piece (`armado_invalido`) and the resolver that follows counts it.
 */
export const EdicionArmadoArcoSchema = z.object({
  accion: z.literal("armado_arco"),
  estructura_id: z.string().trim().min(1).max(160),
  armado_arco: ArmadoArcoV1Schema.nullable(),
}).strict();

export type EdicionArmadoArco = z.infer<typeof EdicionArmadoArcoSchema>;

/**
 * Assembly of one column from the column editor (ADR-0035, step 3): `null` removes
 * it. Only the shape is checked here (`armado-columna.v1`); Python validates it
 * against the piece (`armado_invalido`) and the resolver that follows counts it.
 */
export const EdicionArmadoColumnaSchema = z.object({
  accion: z.literal("armado_columna"),
  estructura_id: z.string().trim().min(1).max(160),
  armado_columna: ArmadoColumnaV1Schema.nullable(),
}).strict();

export type EdicionArmadoColumna = z.infer<typeof EdicionArmadoColumnaSchema>;

/**
 * Assembly of one column built by the designer's organic engine, from its editor (ADR-0035, step 3): `null` removes
 * it. Only the shape is checked here (`armado-columna-organica.v1`); Python validates it against the piece
 * (`armado_invalido`) and the resolver that follows counts it. It is NOT `armado_columna` (the ring tower with
 * patterns): both describe a column and coexist; when a piece has both, the classic one rules.
 */
export const EdicionArmadoColumnaOrganicaSchema = z.object({
  accion: z.literal("armado_columna_organica"),
  estructura_id: z.string().trim().min(1).max(160),
  armado_columna_organica: ArmadoColumnaOrganicaV1Schema.nullable(),
}).strict();

export type EdicionArmadoColumnaOrganica = z.infer<typeof EdicionArmadoColumnaOrganicaSchema>;

/**
 * Assembly of one garland built by the designer's engine, from its editor (ADR-0035, step 3): `null` removes it. Only
 * the shape is checked here (`armado-guirnalda-organica.v1`); Python validates it against the piece
 * (`armado_invalido`) and the resolver that follows counts it. It is NOT `armado_guirnalda` (ADR-0032: clusters,
 * fill and toppers): both describe the same piece and coexist.
 */
export const EdicionArmadoGuirnaldaOrganicaSchema = z.object({
  accion: z.literal("armado_guirnalda_organica"),
  estructura_id: z.string().trim().min(1).max(160),
  armado_guirnalda_organica: ArmadoGuirnaldaOrganicaV1Schema.nullable(),
}).strict();

export type EdicionArmadoGuirnaldaOrganica = z.infer<typeof EdicionArmadoGuirnaldaOrganicaSchema>;

/**
 * Assembly of one arch built by the designer's organic engine — the organic or asymmetric arch AND every
 * half arch (`semiarco`), which is this same assembly with `forma.corte < 1` — from its editor: `null` removes
 * it. Only the shape is checked here (`armado-arco-organico.v1`); Python validates it against the piece
 * (`armado_invalido`, `services/ai-api/app/plan_edicion_arco_organico.py`) and the resolver that follows counts
 * it. It is NOT `armado_arco` (the pattern grid): on an `arco` carrying both, the classic one rules.
 */
export const EdicionArmadoArcoOrganicoSchema = z.object({
  accion: z.literal("armado_arco_organico"),
  estructura_id: z.string().trim().min(1).max(160),
  armado_arco_organico: ArmadoArcoOrganicoV1Schema.nullable(),
}).strict();

export type EdicionArmadoArcoOrganico = z.infer<typeof EdicionArmadoArcoOrganicoSchema>;

/** The measures an edit may change: the plan's `medidas` fields, each one optional and positive. */
const MedidasEdicionSchema = z.object({
  ancho_m: z.number().positive().max(100).optional(),
  alto_m: z.number().positive().max(100).optional(),
  largo_m: z.number().positive().max(100).optional(),
}).strict();

/**
 * Lo que el editor de una pieza **sin motor** («Editar pared», «Editar aro», «Editar techo», «Editar centro de
 * mesa») cambia en una sola edición: la forma elegida (`formas-pieza.ts`; `null` la quita, ausente no la toca),
 * la densidad y las medidas, que son lo que la fórmula de `plan.py` lee para contar la pieza. Una edición, una
 * firma nueva y un solo «Deshacer». Python valida la densidad contra la estructura oficial
 * (`densidad_invalida`), la forma contra la suya (`forma_invalida`) y rechaza el cambio en una pieza que un
 * motor cuenta con su armado (`armado_*_activo`): `services/ai-api/app/plan_edicion_pieza.py`.
 */
export const EdicionPropiedadesSchema = z.object({
  accion: z.literal("propiedades"),
  estructura_id: z.string().trim().min(1).max(160),
  forma: z.string().trim().min(1).max(MAX_LARGO_FORMA_PIEZA).nullable().optional(),
  densidad: z.enum(DENSIDADES).optional(),
  medidas: MedidasEdicionSchema.optional(),
}).strict().superRefine((valor, ctx) => {
  const conMedidas = valor.medidas !== undefined && Object.values(valor.medidas).some((medida) => medida !== undefined);
  if (valor.forma === undefined && valor.densidad === undefined && !conMedidas) {
    ctx.addIssue({ code: "custom", path: ["accion"], message: "La edición necesita una forma, una densidad o una medida." });
  }
});

export type EdicionPropiedades = z.infer<typeof EdicionPropiedadesSchema>;

/**
 * Forma elegida de una pieza que ningún motor arma, desde el selector del bloque del dibujo
 * (`formas-pieza.ts`): `null` la quita y la pieza vuelve a dibujarse con la forma que su estructura oficial
 * implica. Aquí solo se comprueba la forma del mensaje; que ESA forma sea de ESA pieza lo valida el par
 * (oficial, forma) en `PlanDecoracionSchema` —la misma tabla que el JSON Schema exportado—, así que Python
 * rechaza exactamente lo mismo (`forma_invalida`).
 *
 * No trae armado ni cifras: el dibujo es esquemático y no cuenta nada, así que lo único que cambia en el plan
 * es este campo. Cambia `estructuras`, eso sí, y por tanto **mueve `plan_hash`**, como cualquier otra edición.
 */
export const EdicionFormaSchema = z.object({
  accion: z.literal("forma"),
  estructura_id: z.string().trim().min(1).max(160),
  forma: z.string().trim().min(1).max(MAX_LARGO_FORMA_PIEZA).nullable(),
}).strict();

export type EdicionForma = z.infer<typeof EdicionFormaSchema>;

/**
 * Flores de globo de una pieza (`flores-pieza.ts`, 2026-10-07): las pone, las cambia o, con `null`, las quita. Cualquier
 * pieza las admite y no tocan sus materiales ni su armado. La forma se valida aquí con el contrato; Python la vuelve a
 * validar con el plan entero y la resolución que sigue cuenta y cotiza sus globos (`app/flores_pieza.py`). Es la
 * operación que usa el chat («ponle flores», `edicionFloresDePedido`).
 */
export const EdicionFloresSchema = z.object({
  accion: z.literal("flores"),
  estructura_id: z.string().trim().min(1).max(160),
  flores: FloresPiezaV1Schema.nullable(),
}).strict();

export type EdicionFlores = z.infer<typeof EdicionFloresSchema>;

/** Every edit the plan editor applies (Python applies it: services/ai-api/app/plan_edicion.py). */
export type EdicionPlan = Edicion | EdicionReparto | EdicionMezcla | EdicionPatron | EdicionArmado | EdicionArmadoGuirnalda | EdicionArmadoArco | EdicionArmadoColumna | EdicionArmadoColumnaOrganica | EdicionArmadoGuirnaldaOrganica | EdicionArmadoArcoOrganico | EdicionForma | EdicionPropiedades | EdicionFlores;
