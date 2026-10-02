import { z } from "zod";
import {
  ACABADOS_GUIRNALDA,
  REPARTOS_GUIRNALDA,
  ROLES_GUIRNALDA,
  TAMANOS_GUIRNALDA,
  TamanosGuirnaldaSchema,
} from "./armado-guirnalda-organica";
import {
  ColumnaOrganicaResueltaSchema,
  FormaColumnaOrganicaSchema,
  VolumenColumnaOrganicaSchema,
} from "./armado-columna-organica";

/**
 * Lo que el editor de columnas orgánicas puede ofrecer para una pieza (`opciones_admitidas` y `limites_de` en
 * services/ai-api/app/armado_columna_organica.py), decidido por el motor migrado del diseñador: acabados, repartos,
 * papeles, tamaños, las ocho formas listas, los cuatro estilos y los rangos que la interfaz puede mover con el armado
 * puesto.
 *
 * **Esta lista no se escribe aquí.** Sale del motor en cada llamada (ADR-0034, decisión 5): si allá cambia un rango o
 * se añade una forma, aquí se ve sin tocar nada. Lo único que este archivo hace es comprobar que lo que llegó tiene
 * la forma esperada antes de que el editor lo dibuje; los valores siguen siendo de Python.
 *
 * Parte del contrato local de la vista previa (`plan-armado-columna-organica-result.v1`), no de un contrato de
 * dominio: no viaja dentro del plan ni entra en `plan_hash`. Sin dependencias de servidor: lo leen la ruta de Next y
 * el navegador.
 *
 * **No tiene nada que ver con `opciones-armado-columna.ts`** (la torre de anillos y patrones): son dos editores
 * distintos sobre el mismo tipo de pieza y conviven.
 */

/** Cada valor una sola vez. */
const sinRepetidos = <T>(lista: readonly T[]) => new Set(lista).size === lista.length;

/** Una opción del motor tal como la ofrece: el valor que viaja en el armado y cómo se lee en pantalla. */
const OpcionSchema = z
  .object({
    valor: z.string().min(1).max(40),
    texto: z.string().min(1).max(80),
    ayuda: z.string().min(1).max(300).optional(),
  })
  .strict();

const RangoSchema = z.object({ min: z.number().nonnegative(), max: z.number().positive() }).strict();

/** Una forma lista: solo la silueta (los demás mandos de la forma no se tocan), el volumen y la mezcla de tamaños. */
const FormaListaSchema = z
  .object({
    id: z.string().min(1).max(40),
    nombre: z.string().min(1).max(80),
    descripcion: z.string().min(1).max(300),
    forma: FormaColumnaOrganicaSchema.pick({ altoM: true, inclinacionM: true, serpenteoM: true, ondulacion: true }),
    volumen: VolumenColumnaOrganicaSchema,
    tamanos: TamanosGuirnaldaSchema,
    semilla: z.number().int().min(1).max(99999),
  })
  .strict();

/** Un estilo listo: cuánto se llena la columna. Solo el último (gigantes) cambia también los tamaños. */
const EstiloListoSchema = z
  .object({
    id: z.string().min(1).max(40),
    nombre: z.string().min(1).max(80),
    ayuda: z.string().min(1).max(300),
    volumen: VolumenColumnaOrganicaSchema,
    tamanos: TamanosGuirnaldaSchema.optional(),
  })
  .strict();

export const OpcionesArmadoColumnaOrganicaSchema = z
  .object({
    acabados: z
      .array(OpcionSchema.extend({ valor: z.enum(ACABADOS_GUIRNALDA) }))
      .max(ACABADOS_GUIRNALDA.length)
      .refine((lista) => sinRepetidos(lista.map((o) => o.valor))),
    repartos: z
      .array(OpcionSchema.extend({ valor: z.enum(REPARTOS_GUIRNALDA) }))
      .max(REPARTOS_GUIRNALDA.length)
      .refine((lista) => sinRepetidos(lista.map((o) => o.valor))),
    roles: z.array(z.enum(ROLES_GUIRNALDA)).max(ROLES_GUIRNALDA.length).refine(sinRepetidos),
    tamanos: z.array(z.literal(TAMANOS_GUIRNALDA)).max(TAMANOS_GUIRNALDA.length).refine(sinRepetidos),
    /** Alto de la columna y grosor de su cuerpo, en metros. */
    alto_m: RangoSchema,
    grosor_m: RangoSchema,
    max_materiales: z.number().int().positive(),
    formas: z.array(FormaListaSchema).max(16),
    estilos: z.array(EstiloListoSchema).max(16),
  })
  .strict();

export type OpcionesArmadoColumnaOrganica = z.infer<typeof OpcionesArmadoColumnaOrganicaSchema>;
export type FormaListaColumnaOrganica = z.infer<typeof FormaListaSchema>;
export type EstiloListoColumnaOrganica = z.infer<typeof EstiloListoSchema>;

/**
 * Los rangos que la interfaz puede mover **con este armado puesto**: el alto mínimo sube con el grosor, la
 * inclinación y el serpenteo dependen del alto, y `coronaTamanos` dice qué globos guardan proporción con la punta.
 * Van en camelCase porque son los mandos del motor, como el resto de `armado-columna-organica.v1`.
 */
export const LimitesColumnaOrganicaSchema = z
  .object({
    altoMin: z.number().positive(),
    altoMax: z.number().positive(),
    grosorBaseMin: z.number().positive(),
    grosorBaseMax: z.number().positive(),
    grosorPuntaMin: z.number().positive(),
    grosorPuntaMax: z.number().positive(),
    inclinacionMax: z.number().nonnegative(),
    serpenteoMax: z.number().nonnegative(),
    /** Los tamaños de globo que caben sobre esta punta; vacío si ninguno. */
    coronaTamanos: z.array(z.literal(TAMANOS_GUIRNALDA)).max(TAMANOS_GUIRNALDA.length).refine(sinRepetidos),
  })
  .strict();

export type LimitesColumnaOrganica = z.infer<typeof LimitesColumnaOrganicaSchema>;

/**
 * Lo que devuelve la ruta del editor: la columna resuelta **y su dibujo**.
 *
 * El SVG lo emite el mismo motor que colocó los globos, así que la gráfica no vuelve a calcular nada: lo muestra. Va
 * aquí y no dentro de `ColumnaOrganicaResueltaSchema` a propósito — son decenas de kilobytes por pieza, se regenera
 * cuando haga falta y no entra en `plan_hash`.
 *
 * El lienzo del motor **no es cuadrado** (600 × 720): por eso lleva `ancho` y `alto` por separado.
 */
export const VistaColumnaOrganicaSchema = z
  .object({
    columna: ColumnaOrganicaResueltaSchema,
    grafica: z
      .object({
        /** Lados del lienzo del motor, para el `viewBox`. */
        ancho: z.number().int().positive(),
        alto: z.number().int().positive(),
        /** El interior del `<svg>`: `<defs>` con los degradados y un `<g data-…>` por globo. */
        svg: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type VistaColumnaOrganica = z.infer<typeof VistaColumnaOrganicaSchema>;
