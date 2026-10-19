import { EdicionMezclaSchema, EdicionRepartoSchema, EdicionSchema, type Edicion, type EdicionMezcla, type EdicionReparto } from "./edicion-esquemas";

/**
 * What the chat tool `ajustar_plan_decoracion` accepts from the model: one edit
 * (the original shape) or `ediciones`, a short list applied in order and
 * atomically (`src/lib/ia/herramientas/ajustar-plan-chat.ts`).
 *
 * The chat offers four of the editor's operations: the three material edits
 * (agregar / reemplazar / quitar), how much each color weighs (`repartir`) and
 * the balloon size balance (`mezcla`). The color pattern and the structure
 * assemblies (arch, column, garland) stay in the editor: their payloads are
 * large objects the model would have to invent, and Python validates them
 * against the piece (`patron_invalido`, `armado_invalido`).
 *
 * Pure: no server-only code, no I/O. Each edit is validated with the editor's own
 * schema, so the chat and the HTTP editor cannot disagree about what a valid edit is.
 */

/** Bound of one tool call: each edit costs a round trip to Python, and the turn has a deadline. */
export const MAX_EDICIONES_CHAT = 8;

export type EdicionChat = Edicion | EdicionReparto | EdicionMezcla;

export type LecturaEdicionesChat =
  | { ok: true; ediciones: EdicionChat[] }
  /** `indice` is the 1-based position of the first invalid edit; absent when the problem is the call itself. */
  | { ok: false; errores: string[]; indice?: number };

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

type LecturaUna = { ok: true; edicion: EdicionChat } | { ok: false; errores: string[] };

function errores(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>, prefijo: string): string[] {
  return issues.map((issue) => `${prefijo}${issue.path.map(String).join(".") || "edicion"}: ${issue.message}`);
}

/** The schema is chosen by `accion`, so an error names the field that is wrong, not "no union member matched". */
function leerUna(valor: unknown, prefijo: string): LecturaUna {
  const accion = esObjeto(valor) ? valor.accion : undefined;
  if (accion === "repartir") {
    const reparto = EdicionRepartoSchema.safeParse(valor);
    return reparto.success ? { ok: true, edicion: reparto.data } : { ok: false, errores: errores(reparto.error.issues, prefijo) };
  }
  if (accion === "mezcla") {
    const mezcla = EdicionMezclaSchema.safeParse(valor);
    return mezcla.success ? { ok: true, edicion: mezcla.data } : { ok: false, errores: errores(mezcla.error.issues, prefijo) };
  }
  const material = EdicionSchema.safeParse(valor);
  return material.success ? { ok: true, edicion: material.data } : { ok: false, errores: errores(material.error.issues, prefijo) };
}

export function leerEdicionesChat(args: unknown): LecturaEdicionesChat {
  if (!esObjeto(args)) return { ok: false, errores: ["argumentos: se esperaba un objeto con una edición o con `ediciones`."] };
  if (!("ediciones" in args)) {
    const una = leerUna(args, "");
    return una.ok ? { ok: true, ediciones: [una.edicion] } : { ok: false, errores: una.errores, indice: 1 };
  }
  const otros = Object.keys(args).filter((clave) => clave !== "ediciones");
  if (otros.length > 0) {
    return { ok: false, errores: [`argumentos: manda una sola forma, los campos de una edición o \`ediciones\`; sobran ${otros.join(", ")}.`] };
  }
  const lista = args.ediciones;
  if (!Array.isArray(lista) || lista.length < 1 || lista.length > MAX_EDICIONES_CHAT) {
    return { ok: false, errores: [`ediciones: debe ser una lista de 1 a ${MAX_EDICIONES_CHAT} ediciones.`] };
  }
  const leidas: EdicionChat[] = [];
  const fallos: string[] = [];
  let primerFallo: number | undefined;
  lista.forEach((elemento, posicion) => {
    const una = leerUna(elemento, `ediciones[${posicion}].`);
    if (una.ok) {
      leidas.push(una.edicion);
      return;
    }
    primerFallo ??= posicion + 1;
    fallos.push(...una.errores);
  });
  if (fallos.length > 0) return { ok: false, errores: fallos, ...(primerFallo ? { indice: primerFallo } : {}) };
  return { ok: true, ediciones: leidas };
}

/** The new variant an edit brings, when it brings one (agregar / reemplazar). */
export function varianteNuevaDe(edicion: EdicionChat): { product_id: string; variant_id: string } | null {
  if (edicion.accion === "agregar" || edicion.accion === "reemplazar") return edicion.variante ?? null;
  return null;
}
