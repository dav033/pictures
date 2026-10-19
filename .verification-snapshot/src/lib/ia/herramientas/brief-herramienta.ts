import { z } from "zod";
import type { Brief } from "@/lib/types";

/**
 * `guardar_brief` arguments are model output: the model invents keys
 * ("estilo_decorativo", "estilo_decoracion", "paleta") and the terminal `fin`
 * event validates the brief against the strict `chat.v1` schema, so one
 * invented key turned a finished plan into "No pude responder" (E2E 2026-09-15,
 * rid da911f76, ab7efb1a, ed4f9eb8).
 *
 * Rule: every argument is mapped to a `Brief` field (exact name, or an obvious
 * synonym such as `estilo_*` → `estilo`, `paleta` → `colores`), coerced when the
 * value is unambiguous, validated field by field, and dropped otherwise. Only
 * valid fields ever reach the conversation state. Pure: no provider, HTTP or
 * database.
 */

const CAMPOS_BRIEF = ["tipo_evento", "espacio", "invitados", "colores", "estilo", "momento_dia", "fecha", "presupuesto"] as const;
type CampoBrief = (typeof CAMPOS_BRIEF)[number];

const esquemaCampo: Record<CampoBrief, z.ZodType<unknown>> = {
  tipo_evento: z.string().trim().min(1),
  espacio: z.string().trim().min(1),
  invitados: z.number().int().positive(),
  colores: z.array(z.string().trim().min(1)).min(1),
  estilo: z.string().trim().min(1),
  momento_dia: z.string().trim().min(1),
  fecha: z.string().trim().min(1),
  presupuesto: z.union([z.number().finite(), z.string().trim().min(1)]),
};

/** Invented key → field. Checked in order; the first matching rule wins. */
const SINONIMOS: ReadonlyArray<readonly [RegExp, CampoBrief]> = [
  [/^(?:estilo|estilos|style|tematica|tema|ambiente|vibe)(?:_.*)?$/, "estilo"],
  [/^(?:colores?|paleta|paleta_colores|palette|colors?|tonos?)(?:_.*)?$/, "colores"],
  [/^(?:tipo_evento|evento|tipo_de_evento|ocasion|event|event_type)(?:_.*)?$/, "tipo_evento"],
  [/^(?:invitados|numero_invitados|num_invitados|cantidad_invitados|personas|asistentes|guests)(?:_.*)?$/, "invitados"],
  [/^(?:espacio|lugar|locacion|ubicacion|venue|space)(?:_.*)?$/, "espacio"],
  [/^(?:momento_dia|momento|horario|hora|jornada)(?:_.*)?$/, "momento_dia"],
  [/^(?:fecha|dia|date)(?:_.*)?$/, "fecha"],
  [/^(?:presupuesto|budget)(?:_.*)?$/, "presupuesto"],
];

function claveNormalizada(clave: string): string {
  return clave.replace(/([a-z0-9])([A-Z])/g, "$1_$2").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function campoDeClave(clave: string): CampoBrief | null {
  const normalizada = claveNormalizada(clave);
  if ((CAMPOS_BRIEF as readonly string[]).includes(normalizada)) return normalizada as CampoBrief;
  return SINONIMOS.find(([patron]) => patron.test(normalizada))?.[1] ?? null;
}

function coaccionar(campo: CampoBrief, valor: unknown): unknown {
  if (campo === "invitados" && typeof valor === "string" && /^\s*\d+\s*$/.test(valor)) return Number(valor);
  if (campo === "colores") {
    if (typeof valor === "string") return valor.split(/\s*(?:,|;|\by\b)\s*/).map((color) => color.trim()).filter(Boolean);
    if (Array.isArray(valor)) return valor.filter((color): color is string => typeof color === "string" && color.trim().length > 0).map((color) => color.trim());
  }
  if (typeof valor === "string") return valor.trim();
  return valor;
}

export type BriefNormalizado = { brief: Partial<Brief>; descartadas: string[] };

/** Valid `Brief` fields of a `guardar_brief` call; unknown or invalid keys are listed in `descartadas`. */
export function normalizarArgsBrief(args: unknown): BriefNormalizado {
  const brief: Record<string, unknown> = {};
  const descartadas: string[] = [];
  if (!args || typeof args !== "object" || Array.isArray(args)) return { brief: {}, descartadas };
  for (const [clave, valor] of Object.entries(args as Record<string, unknown>)) {
    const campo = campoDeClave(clave);
    const exacta = campo === clave;
    // An exact field always wins over a synonym written in the same call.
    if (!campo || (!exacta && Object.prototype.hasOwnProperty.call(args, campo))) {
      descartadas.push(clave);
      continue;
    }
    const validado = esquemaCampo[campo].safeParse(coaccionar(campo, valor));
    if (!validado.success) {
      descartadas.push(clave);
      continue;
    }
    brief[campo] = validado.data;
  }
  return { brief: brief as Partial<Brief>, descartadas };
}

/** A brief with only valid fields, for the terminal event: never fails. */
export function sanearBrief(brief: unknown): Brief {
  return normalizarArgsBrief(brief).brief;
}
