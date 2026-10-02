import { z } from "zod";
import { FORMAS_ARCO, MAX_SECUENCIA_ARCO, PATRONES_ARCO, TAMANOS_ARCO } from "./armado-arco";

/**
 * Lo que el editor de armado de arcos puede ofrecer para una pieza
 * (`opciones_admitidas` y `limites_de` en services/ai-api/app/armado_arco.py), decidido por el motor migrado
 * del diseñador: los catorce patrones con sus mandos, rangos y ayudas, las formas de la línea guía, los
 * tamaños de globo y los rangos que la interfaz puede mover con el armado puesto.
 *
 * **Esta lista no se escribe aquí.** Sale del motor en cada llamada (ADR-0034, decisión 5): si allá se añade
 * un patrón o cambia un rango, aquí se ve sin tocar nada. Lo único que este archivo hace es comprobar que lo
 * que llegó tiene la forma esperada antes de que el editor lo dibuje; los valores siguen siendo de Python.
 *
 * Parte del contrato local de la vista previa (`plan-armado-arco-result.v1`), no de un contrato de dominio:
 * no viaja dentro del plan ni entra en `plan_hash`. Sin dependencias de servidor: lo leen la ruta de Next y
 * el navegador.
 */

/** Cada valor una sola vez. */
const sinRepetidos = <T>(lista: readonly T[]) => new Set(lista).size === lista.length;

/**
 * Un mando del patrón: el rango y el paso con los que el editor puede moverlo, y su valor por defecto.
 * `interruptor` lo pinta como un 0/1 y `seleccion` como una lista de opciones cuyo valor es el índice.
 */
export const ControlPatronArcoSchema = z
  .object({
    clave: z.string().min(1).max(40),
    etiqueta: z.string().min(1).max(80),
    min: z.number(),
    max: z.number(),
    paso: z.number().positive(),
    defecto: z.number(),
    interruptor: z.literal(true).optional(),
    seleccion: z.array(z.string().min(1).max(60)).min(2).max(8).optional(),
    ayuda: z.string().min(1).max(300).optional(),
  })
  .strict();

export type ControlPatronArco = z.infer<typeof ControlPatronArcoSchema>;

/**
 * Un patrón con lo que necesita para ofrecerse: cuántos colores admite y, cuando los suyos tienen una función
 * fija (Centro, Pétalos, Punto…), cómo se llama cada uno (`roles`). `lista` es el patrón de longitud
 * variable; `null` cuando el patrón tiene un número fijo de colores.
 */
export const PatronArcoAdmitidoSchema = z
  .object({
    id: z.enum(PATRONES_ARCO),
    nombre: z.string().min(1).max(80),
    descripcion: z.string().min(1).max(300),
    roles: z.array(z.string().min(1).max(40)).max(8).nullable(),
    lista: z
      .object({ min: z.number().int().positive(), max: z.number().int().positive(), etiqueta: z.string().min(1).max(80) })
      .strict()
      .nullable(),
    min_colores: z.number().int().positive(),
    max_colores: z.number().int().positive(),
    controles: z.array(ControlPatronArcoSchema).max(12),
  })
  .strict();

export type PatronArcoAdmitido = z.infer<typeof PatronArcoAdmitidoSchema>;

const RangoSchema = z.object({ min: z.number().positive(), max: z.number().positive() }).strict();

export const OpcionesArmadoArcoSchema = z
  .object({
    formas: z.array(z.enum(FORMAS_ARCO)).max(FORMAS_ARCO.length).refine(sinRepetidos),
    patrones: z.array(PatronArcoAdmitidoSchema).max(PATRONES_ARCO.length).refine((lista) => sinRepetidos(lista.map((p) => p.id))),
    tamanos: z.array(z.literal(TAMANOS_ARCO)).max(TAMANOS_ARCO.length).refine(sinRepetidos),
    /** Ancho y alto exteriores que el motor admite, en metros. */
    ancho_m: RangoSchema,
    alto_m: RangoSchema,
    max_materiales: z.number().int().positive(),
    max_secuencia: z.literal(MAX_SECUENCIA_ARCO),
    /** Alto de cada sección por altura, en metros. */
    seccion_m: z.number().positive(),
  })
  .strict();

export type OpcionesArmadoArco = z.infer<typeof OpcionesArmadoArcoSchema>;

/**
 * Los rangos que la interfaz puede mover **con este armado puesto**: el ancho mínimo sube con el tamaño del
 * globo y con los globos a lo ancho, y el alto depende de la forma de la línea guía. Van en camelCase porque
 * son los mandos del motor, como el resto de `armado-arco.v1`.
 */
export const LimitesArcoSchema = z
  .object({
    anchoMin: z.number().positive(),
    anchoMax: z.number().positive(),
    altoMin: z.number().positive(),
    altoMax: z.number().positive(),
    /** Globos a lo ancho de la banda: mínimo, máximo y en qué saltos se puede mover (el arcoíris va por bandas). */
    nMin: z.number().positive(),
    nMax: z.number().positive(),
    nPaso: z.number().positive(),
  })
  .strict();

export type LimitesArco = z.infer<typeof LimitesArcoSchema>;
