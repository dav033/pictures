import { z } from "zod";
import {
  ACABADOS_GUIRNALDA,
  GuirnaldaOrganicaResueltaSchema,
  REPARTOS_GUIRNALDA,
  ROLES_GUIRNALDA,
  TAMANOS_GUIRNALDA,
} from "./armado-guirnalda-organica";

/**
 * Lo que el editor de guirnaldas orgánicas puede ofrecer para una pieza
 * (`opciones_admitidas` y `limites_de` en services/ai-api/app/armado_guirnalda_organica.py), decidido por el
 * motor migrado del diseñador: acabados, repartos, papeles, tamaños y los rangos que la interfaz puede mover
 * con el armado puesto.
 *
 * **Esta lista no se escribe aquí.** Sale del motor en cada llamada (ADR-0034, decisión 5): si allá cambia un
 * rango o se añade un reparto, aquí se ve sin tocar nada. Lo único que este archivo hace es comprobar que lo
 * que llegó tiene la forma esperada antes de que el editor lo dibuje; los valores siguen siendo de Python.
 *
 * Parte del contrato local de la vista previa (`plan-armado-guirnalda-organica-result.v1`), no de un contrato
 * de dominio: no viaja dentro del plan ni entra en `plan_hash`. Sin dependencias de servidor: lo leen la ruta
 * de Next y el navegador.
 *
 * **No tiene nada que ver con `opciones-armado-guirnalda.ts`** (ADR-0032: soportes, anfitrionas, racimos y
 * remates). Son dos editores distintos sobre la misma pieza y conviven.
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

export const OpcionesArmadoGuirnaldaOrganicaSchema = z
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
    /** Largo de la tira, grosor de la banda y altura de la línea guía sobre el piso, en metros. */
    largo_m: RangoSchema,
    grosor_m: RangoSchema,
    altura_m: RangoSchema,
    max_materiales: z.number().int().positive(),
  })
  .strict();

export type OpcionesArmadoGuirnaldaOrganica = z.infer<typeof OpcionesArmadoGuirnaldaOrganicaSchema>;

/**
 * Los rangos que la interfaz puede mover **con este armado puesto**: el largo mínimo sube con el grosor, la
 * altura mínima deja media banda sobre el piso y la onda, el colgado y los festones dependen del largo. Van
 * en camelCase porque son los mandos del motor, como el resto de `armado-guirnalda-organica.v1`.
 */
export const LimitesGuirnaldaOrganicaSchema = z
  .object({
    largoMin: z.number().positive(),
    largoMax: z.number().positive(),
    grosorExtremosMin: z.number().positive(),
    grosorExtremosMax: z.number().positive(),
    grosorCentroMin: z.number().positive(),
    grosorCentroMax: z.number().positive(),
    alturaMin: z.number().nonnegative(),
    alturaMax: z.number().positive(),
    pendienteMax: z.number().nonnegative(),
    ondaMax: z.number().nonnegative(),
    colgadoMax: z.number().nonnegative(),
    festonesMax: z.number().positive(),
  })
  .strict();

export type LimitesGuirnaldaOrganica = z.infer<typeof LimitesGuirnaldaOrganicaSchema>;

/**
 * Lo que devuelve la ruta del editor: la guirnalda resuelta **y su dibujo**.
 *
 * El SVG lo emite el mismo motor que colocó los globos, así que la gráfica no vuelve a calcular nada: lo
 * muestra. Va aquí y no dentro de `GuirnaldaOrganicaResueltaSchema` a propósito — son decenas de kilobytes
 * por pieza, se regenera cuando haga falta y no entra en `plan_hash`.
 *
 * El lienzo del motor **no es cuadrado** (760 × 440), al contrario que el del arco: por eso lleva `ancho` y
 * `alto` por separado y no un solo lado.
 */
export const VistaGuirnaldaOrganicaSchema = z
  .object({
    guirnalda: GuirnaldaOrganicaResueltaSchema,
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

export type VistaGuirnaldaOrganica = z.infer<typeof VistaGuirnaldaOrganicaSchema>;
