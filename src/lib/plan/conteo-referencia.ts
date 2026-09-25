import { z } from "zod";

/**
 * Conteo de globos leído en la foto de referencia (`conteo-referencia.v1`,
 * ADR-0031): cuántos globos se ven en cada pieza, si esa cuenta es el total, un
 * estimado del total en piezas densas, los racimos, el reparto por tamaño y la
 * escala respecto de algo conocido de la foto.
 *
 * Es una lectura, no una decisión: Amaterasu describe lo que ve y el plan no la
 * usa todavía (E1). Cuando la use (E2), el único dueño de qué hacer con ella
 * será `services/ai-api/app/plan.py`.
 *
 * Este esquema es el dueño de la forma. Viaja exportado dentro de
 * `reference-blueprint.v2` (`appearance.conteo`) y Python lee de ahí sus
 * clases, referencias y topes (`app/amaterasu/conteo_referencia.py`). Las
 * reglas de coherencia que un esquema no expresa (una cuenta exacta tiene a lo
 * sumo 40 globos visibles y no lleva estimado; el estimado nunca es menor que
 * lo visible) las aplica la validación de Python. Aquí solo se comprueba lo que
 * el esquema exportado no alcanza a decir del reparto por tamaño: cada clase una
 * vez y proporciones que suman 1.
 */

export const CONTEO_REFERENCIA_VERSION = "conteo-referencia.v1" as const;

/** Clases de tamaño del conteo: 5"/9" · 12" · 18"/24" · 36". */
export const CLASES_TAMANO_CONTEO = ["chico", "mediano", "grande", "gigante"] as const;
export type ClaseTamanoConteo = (typeof CLASES_TAMANO_CONTEO)[number];

/** Algo de la foto con una altura conocida contra la que se mide la pieza. */
export const REFERENCIAS_ESCALA_CONTEO = ["persona", "puerta", "mesa"] as const;
export type ReferenciaEscalaConteo = (typeof REFERENCIAS_ESCALA_CONTEO)[number];

/** Topes de forma: rechazan lo absurdo, no deciden nada. */
export const MAX_GLOBOS_CONTEO = 10_000;
export const MAX_RACIMOS_CONTEO = 2_500;
export const MAX_GLOBOS_POR_RACIMO_CONTEO = 8;
export const MAX_VECES_REFERENCIA_CONTEO = 50;
/** Tolerancia de la suma de `por_tamano` (Python la normaliza a 1 antes de entregarla). */
const TOLERANCIA_SUMA_POR_TAMANO = 0.01;

/** Largo o alto de la pieza como múltiplo de la altura de la referencia. */
const EscalaRelativaSchema = z.object({
  referencia: z.enum(REFERENCIAS_ESCALA_CONTEO),
  veces: z.number().gt(0).max(MAX_VECES_REFERENCIA_CONTEO),
}).strict();

const PorTamanoSchema = z.array(z.object({
  clase: z.enum(CLASES_TAMANO_CONTEO),
  proporcion: z.number().gt(0).max(1),
}).strict()).max(CLASES_TAMANO_CONTEO.length).superRefine((items, ctx) => {
  if (new Set(items.map((item) => item.clase)).size !== items.length) {
    ctx.addIssue({ code: "custom", message: "Cada clase de tamaño aparece una sola vez." });
  }
  const suma = items.reduce((total, item) => total + item.proporcion, 0);
  if (items.length > 0 && Math.abs(suma - 1) > TOLERANCIA_SUMA_POR_TAMANO) {
    ctx.addIssue({ code: "custom", message: "Las proporciones por tamaño suman 1." });
  }
});

/** Lectura del conteo de una pieza de la foto (sin el id del elemento). */
export const LecturaConteoSchema = z.object({
  /** Globos que se ven y se distinguen uno a uno. */
  globos_visibles: z.number().int().min(0).max(MAX_GLOBOS_CONTEO),
  /** `globos_visibles` es el total: pieza chica y sin nada oculto. */
  exacto: z.boolean(),
  /** Piezas densas: el total estimado, ocultos incluidos; `null` con `exacto`. */
  estimado_total: z.number().int().min(1).max(MAX_GLOBOS_CONTEO).nullable(),
  racimos: z.number().int().min(1).max(MAX_RACIMOS_CONTEO).nullable(),
  globos_por_racimo: z.number().int().min(1).max(MAX_GLOBOS_POR_RACIMO_CONTEO).nullable(),
  /** Vacío cuando no se pudo leer. */
  por_tamano: PorTamanoSchema,
  largo_relativo: EscalaRelativaSchema.nullable(),
  alto_relativo: EscalaRelativaSchema.nullable(),
  confianza: z.number().min(0).max(1),
}).strict();

export type LecturaConteo = z.infer<typeof LecturaConteoSchema>;
