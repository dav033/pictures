import { z } from "zod";
import { GLOBOS_CAPA_MAX, GLOBOS_CAPA_MIN, MAX_CAPAS_COLUMNA, MODOS_COLUMNA, PATRONES_COLUMNA, REMATES_COLUMNA, TAMANOS_COLUMNA } from "./armado-columna";

/**
 * Lo que se puede ofrecer para armar una columna (`opciones_admitidas` en
 * services/ai-api/app/armado_columna.py), decidido por el motor migrado del diseñador: los nueve patrones
 * con sus mandos y su mínimo de colores, los modos, los remates, los tamaños de globo y los rangos del
 * cuerpo.
 *
 * **Esta lista no se escribe aquí.** Sale del motor en cada llamada (ADR-0034, decisión 5): si allá se añade
 * un patrón o cambia un rango, aquí se ve sin tocar nada. Lo único que este archivo hace es comprobar que lo
 * que llegó tiene la forma esperada antes de que alguien lo use; los valores siguen siendo de Python.
 *
 * Es el gemelo de `opciones-armado-arco.ts` para la columna, y como él no viaja dentro del plan ni entra en
 * `plan_hash`. Sin dependencias de servidor.
 */

/** Cada valor una sola vez. */
const sinRepetidos = <T>(lista: readonly T[]) => new Set(lista).size === lista.length;

/** Un mando del patrón de la columna: su rango y el valor con el que arranca el motor. */
export const ControlPatronColumnaSchema = z
  .object({
    clave: z.string().min(1).max(40),
    min: z.number(),
    max: z.number(),
    defecto: z.number(),
  })
  .strict();

export type ControlPatronColumna = z.infer<typeof ControlPatronColumnaSchema>;

export const PatronColumnaAdmitidoSchema = z
  .object({
    id: z.enum(PATRONES_COLUMNA),
    nombre: z.string().min(1).max(80),
    /** Cuántos colores necesita como mínimo (el ombré, tres; el resto, dos; el sólido, uno). */
    min_colores: z.number().int().positive(),
    controles: z.array(ControlPatronColumnaSchema).max(12),
  })
  .strict();

export type PatronColumnaAdmitido = z.infer<typeof PatronColumnaAdmitidoSchema>;

const RangoSchema = z.object({ min: z.number().positive(), max: z.number().positive() }).strict();

export const OpcionesArmadoColumnaSchema = z
  .object({
    modos: z.array(z.enum(MODOS_COLUMNA)).max(MODOS_COLUMNA.length).refine(sinRepetidos),
    patrones: z
      .array(PatronColumnaAdmitidoSchema)
      .max(PATRONES_COLUMNA.length)
      .refine((lista) => sinRepetidos(lista.map((patron) => patron.id))),
    remates: z.array(z.enum(REMATES_COLUMNA)).max(REMATES_COLUMNA.length).refine(sinRepetidos),
    tamanos: z.array(z.literal(TAMANOS_COLUMNA)).max(TAMANOS_COLUMNA.length).refine(sinRepetidos),
    /** Globos por anillo: de 3 a 6, con 4 como el cuarteto clásico. */
    globos_capa: RangoSchema,
    /** Alto del cuerpo que el motor admite, en metros. */
    alto_m: RangoSchema,
    max_capas: z.literal(MAX_CAPAS_COLUMNA),
  })
  .strict()
  .refine((opciones) => opciones.globos_capa.min === GLOBOS_CAPA_MIN && opciones.globos_capa.max === GLOBOS_CAPA_MAX, {
    message: "los globos por capa del motor no son los del contrato",
  });

export type OpcionesArmadoColumna = z.infer<typeof OpcionesArmadoColumnaSchema>;

/**
 * Los rangos que la interfaz puede mover **con este armado puesto** (`limites_de` en
 * services/ai-api/app/armado_columna.py): el alto que cabe depende del diámetro de la columna, que sube con el
 * tamaño del globo y los globos por capa; el foil, también; y qué globo o racimo guarda proporción como remate
 * cambia con el inflado. Van en camelCase porque son los mandos del motor.
 */
export const LimitesColumnaSchema = z
  .object({
    diametro: z.number().positive(),
    altoMin: z.number().positive(),
    altoMax: z.number().positive(),
    foilMin: z.number().positive(),
    foilMax: z.number().positive(),
    /** Los tamaños de globo que caben como remate de un solo globo, y los que caben en un racimo. */
    rematesGlobo: z.array(z.literal(TAMANOS_COLUMNA)).max(TAMANOS_COLUMNA.length).refine(sinRepetidos),
    rematesRacimo: z.array(z.literal(TAMANOS_COLUMNA)).max(TAMANOS_COLUMNA.length).refine(sinRepetidos),
  })
  .strict();

export type LimitesColumna = z.infer<typeof LimitesColumnaSchema>;
