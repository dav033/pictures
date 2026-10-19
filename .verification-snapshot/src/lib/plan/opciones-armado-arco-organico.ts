import { z } from "zod";
import {
  ACABADOS_GUIRNALDA,
  REPARTOS_GUIRNALDA,
  ROLES_GUIRNALDA,
  TAMANOS_GUIRNALDA,
  TamanosGuirnaldaSchema,
} from "./armado-guirnalda-organica";
import {
  ArcoOrganicoResueltoSchema,
  FormaArcoOrganicoSchema,
  VolumenArcoOrganicoSchema,
} from "./armado-arco-organico";

/**
 * Lo que el editor de arcos orgánicos puede ofrecer para una pieza (`opciones_admitidas` y `limites_de` en
 * services/ai-api/app/armado_arco_organico.py), decidido por el motor migrado del diseñador: acabados, repartos,
 * papeles, tamaños, las quince formas listas —medios arcos incluidos—, los cuatro estilos y los rangos que la
 * interfaz puede mover con el armado puesto.
 *
 * **Esta lista no se escribe aquí.** Sale del motor en cada llamada (ADR-0034, decisión 5): si allá cambia un rango o
 * se añade una forma, aquí se ve sin tocar nada. Lo único que este archivo hace es comprobar que lo que llegó tiene
 * la forma esperada antes de que el editor lo dibuje; los valores siguen siendo de Python.
 *
 * Parte del contrato local de la vista previa (`plan-armado-arco-organico-result.v1`), no de un contrato de dominio:
 * no viaja dentro del plan ni entra en `plan_hash`. Sin dependencias de servidor: lo leen la ruta de Next y el
 * navegador.
 *
 * **No tiene nada que ver con `opciones-armado-arco.ts`** (la rejilla de patrones del arco clásico): son dos
 * editores distintos sobre el mismo tipo de pieza y conviven.
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

/**
 * Una forma lista: la silueta entera del arco, el volumen y la mezcla de tamaños, sin colores ni adornos. La forma
 * va completa y no recortada porque un medio arco **es** una forma lista con `corte` menor que 1 y su `espejo`.
 */
const FormaListaSchema = z
  .object({
    id: z.string().min(1).max(40),
    nombre: z.string().min(1).max(80),
    descripcion: z.string().min(1).max(300),
    forma: FormaArcoOrganicoSchema,
    volumen: VolumenArcoOrganicoSchema,
    tamanos: TamanosGuirnaldaSchema,
    semilla: z.number().int().min(1).max(99999),
  })
  .strict();

/** Un estilo listo: cuánto se llena el arco. Solo el de focales cambia también los tamaños. */
const EstiloListoSchema = z
  .object({
    id: z.string().min(1).max(40),
    nombre: z.string().min(1).max(80),
    ayuda: z.string().min(1).max(300),
    volumen: VolumenArcoOrganicoSchema,
    tamanos: TamanosGuirnaldaSchema.optional(),
  })
  .strict();

export const OpcionesArmadoArcoOrganicoSchema = z
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
    /** Ancho de pata a pata, alto hasta la cima y grosor de la banda, en metros. */
    ancho_m: RangoSchema,
    alto_m: RangoSchema,
    grosor_m: RangoSchema,
    max_materiales: z.number().int().positive(),
    formas: z.array(FormaListaSchema).max(24),
    estilos: z.array(EstiloListoSchema).max(16),
  })
  .strict();

export type OpcionesArmadoArcoOrganico = z.infer<typeof OpcionesArmadoArcoOrganicoSchema>;
export type FormaListaArcoOrganicoDescrita = z.infer<typeof FormaListaSchema>;
export type EstiloListoArcoOrganico = z.infer<typeof EstiloListoSchema>;

/**
 * Los rangos que la interfaz puede mover **con este armado puesto**: el alto mínimo sube con el ancho y con el
 * grosor de la cima, el grosor máximo baja con el ancho (una banda gruesa taparía la abertura) y `tamanos` dice qué
 * globos caben en el grosor de ahora. Van en camelCase porque son los mandos del motor, como el resto de
 * `armado-arco-organico.v1`.
 */
export const LimitesArcoOrganicoSchema = z
  .object({
    anchoMin: z.number().positive(),
    anchoMax: z.number().positive(),
    altoMin: z.number().positive(),
    altoMax: z.number().positive(),
    grosorPatasMin: z.number().positive(),
    grosorPatasMax: z.number().positive(),
    grosorCimaMin: z.number().positive(),
    grosorCimaMax: z.number().positive(),
    /** Los tamaños de globo que caben en esta banda; los que no, el motor los quita de la mezcla y lo avisa. */
    tamanos: z.array(z.literal(TAMANOS_GUIRNALDA)).max(TAMANOS_GUIRNALDA.length).refine(sinRepetidos),
  })
  .strict();

export type LimitesArcoOrganico = z.infer<typeof LimitesArcoOrganicoSchema>;

/**
 * Lo que devuelve la ruta del editor: el arco resuelto **y su dibujo**.
 *
 * El SVG lo emite el mismo motor que colocó los globos, así que la gráfica no vuelve a calcular nada: lo muestra. Va
 * aquí y no dentro de `ArcoOrganicoResueltoSchema` a propósito — son decenas de kilobytes por pieza, se regenera
 * cuando haga falta y no entra en `plan_hash`.
 *
 * El lienzo de este motor **sí es cuadrado** (600 × 600), al contrario que el de la columna (600 × 720) y el de la
 * guirnalda (760 × 440); aun así lleva `ancho` y `alto` porque son los dos lados que Python publica.
 */
export const VistaArcoOrganicoSchema = z
  .object({
    arco: ArcoOrganicoResueltoSchema,
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

export type VistaArcoOrganico = z.infer<typeof VistaArcoOrganicoSchema>;
