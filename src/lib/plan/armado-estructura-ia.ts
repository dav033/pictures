import { z } from "zod";
import { ArmadoArcoV1Schema, type ArmadoArcoV1 } from "./armado-arco";
import { ArmadoColumnaV1Schema, TAMANOS_COLUMNA, type ArmadoColumnaV1 } from "./armado-columna";
import { ArmadoGuirnaldaOrganicaV1Schema, type ArmadoGuirnaldaOrganicaV1 } from "./armado-guirnalda-organica";
import { OpcionesArmadoArcoSchema } from "./opciones-armado-arco";
import { OpcionesArmadoColumnaSchema } from "./opciones-armado-columna";
import { OpcionesArmadoGuirnaldaOrganicaSchema } from "./opciones-armado-guirnalda-organica";
import type { EstructuraPlan, PlanDecoracion } from "./tipos";

/**
 * La forma de lo que contestan las herramientas de armado del agente de chat (ADR-0034 §5), y las dos
 * traducciones de frontera que hacen falta para usarlas: qué dice una estructura del plan de sí misma, y cómo
 * se escribe en el plan el armado que Python completó.
 *
 * **Aquí no se decide ningún armado.** El patrón, los rangos, la receta y si un armado se sostiene los decide
 * `services/ai-api/app/omoikane/armado_estructura.py` sobre los motores migrados. Este archivo valida la
 * frontera (lo que llega de Python tiene la forma esperada) y traduce; recalcular algo de esto sería un
 * segundo dueño de las reglas del motor.
 *
 * No es un contrato de dominio: nada de esto viaja dentro del plan salvo el propio `armado_arco` /
 * `armado_columna`, que ya tienen su contrato publicado. Sin dependencias de servidor.
 */

/**
 * Los tres tipos de pieza con motor migrado y puerta en Python. Las demás no tienen motor y siguen por el
 * camino de siempre.
 *
 * `guirnalda` es la **orgánica** del motor (`armado-guirnalda-organica.v1`). No tiene nada que ver con
 * `armado-guirnalda.v1` de ADR-0032 —racimos, relleno y remates—, que sigue vivo con su editor y su
 * `completar_armados_guirnalda`: una pieza puede traer los dos, y cuando eso pasa manda el del motor, que es
 * el que coloca los globos. Nada de este archivo lee ni escribe el viejo.
 */
export const TIPOS_ARMADO_MOTOR = ["arco", "columna", "guirnalda"] as const;
export type TipoArmadoMotor = (typeof TIPOS_ARMADO_MOTOR)[number];

/** En qué campo del plan vive el armado de cada tipo. */
export const CLAVE_ARMADO = {
  arco: "armado_arco",
  columna: "armado_columna",
  guirnalda: "armado_guirnalda_organica",
} as const satisfies Record<TipoArmadoMotor, keyof EstructuraPlan>;

/** Los tres campos del plan que esta operación decide. `armado_guirnalda` (ADR-0032) **no** está. */
export const CLAVES_ARMADO_MOTOR = ["armado_arco", "armado_columna", "armado_guirnalda_organica"] as const;

/**
 * Los campos del plan que la salida del modelo no escribe: los tres que esta capacidad decide y el
 * `armado_columna_organica` (la columna del diseñador, ADR-0034), que **no** completa ninguna herramienta del
 * modelo: lo escribe el decorador desde su editor, por la edición del plan. Con la bandera apagada se descartan los
 * cuatro (los planes nuevos salen sin armado) y con ella encendida se descarta el último, porque ninguna
 * herramienta lo decide y un plan del modelo no puede traer un armado que nadie validó contra la pieza.
 */
export const CLAVES_FUERA_DEL_MODELO = [...CLAVES_ARMADO_MOTOR, "armado_columna_organica"] as const;

/**
 * Lo que la pieza dice de sí misma, que es de dónde sale la geometría por defecto: el modelo no tiene que
 * repetir el ancho ni el alto. `colores` es cuántos materiales lleva, y es el tope de los índices que su
 * armado puede nombrar.
 */
export const PiezaArmadoSchema = z
  .object({
    tipo: z.enum(TIPOS_ARMADO_MOTOR),
    colores: z.number().int().min(1).max(12),
    ancho_m: z.number().positive().max(100).optional(),
    alto_m: z.number().positive().max(100).optional(),
    /** El largo, que es lo que define una guirnalda. */
    largo_m: z.number().positive().max(100).optional(),
    /**
     * La participación de cada material de la pieza, en su orden, y el acabado que el plan declara para cada
     * uno. Con eso la paleta de la guirnalda reparte sus pesos y sabe qué látex es cada color, sin que el
     * modelo lo repita. **Solo viajan en una guirnalda**: el patrón del arco y de la columna no los lee.
     */
    pesos: z.array(z.number().min(0).max(1)).max(12).optional(),
    acabados: z.array(z.string().min(1).max(80).nullable()).max(12).optional(),
  })
  .strict();

export type PiezaArmado = z.infer<typeof PiezaArmadoSchema>;

const TamanoSchema = z.literal(TAMANOS_COLUMNA);

/**
 * Los ajustes de geometría que el modelo puede pedir, todos opcionales: lo que falte lo pone el motor desde
 * las medidas de la pieza o desde su propia receta. Lo que se salga del rango del motor se **acota** con un
 * aviso, que es lo que hace el diseñador al mover un control a su tope.
 */
export const GeometriaPedidaSchema = z
  .object({
    /** Arco: la línea guía. */
    forma: z.enum(["alto", "semi", "herradura"]).optional(),
    ancho_m: z.number().positive().max(100).optional(),
    alto_m: z.number().positive().max(100).optional(),
    /** Arco: globos a lo ancho de la banda. */
    globos_ancho: z.number().int().min(1).max(40).optional(),
    suelo: z.boolean().optional(),
    tamano_globo: TamanoSchema.optional(),
    /** Columna: globos por anillo, y el tamaño de la primera y la última capa. */
    globos_capa: z.number().int().min(1).max(12).optional(),
    abajo: TamanoSchema.optional(),
    arriba: TamanoSchema.optional(),
  })
  .strict();

export type GeometriaPedida = z.infer<typeof GeometriaPedidaSchema>;

/**
 * Un color de la paleta de la guirnalda: qué material es y, si el modelo lo dice, cómo se ve.
 *
 * `acabado` y `rol` viajan como texto y **no** como enum a propósito: son valores que el modelo elige del
 * catálogo que el motor publica (`consultar_opciones_armado`), con su etiqueta y su ayuda, igual que un id de
 * patrón. Fijarlos en el esquema de la herramienta sería copiar una lista del motor; los comprueba Python
 * contra la suya y rechaza con su motivo.
 */
export const ColorPedidoSchema = z
  .object({
    material: z.number().int().min(0).max(11),
    /** Proporción relativa. Sin ella, la de la participación del material en la pieza. */
    peso: z.number().positive().max(100).optional(),
    acabado: z.string().trim().min(1).max(40).optional(),
    rol: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

export type ColorPedido = z.infer<typeof ColorPedidoSchema>;

/** Cuánto pesa un tamaño de globo en la mezcla. Los pesos son relativos y el motor los normaliza. */
export const PesoTamanoSchema = z.object({ tamano: TamanoSchema, peso: z.number().min(0).max(100) }).strict();

export type PesoTamano = z.infer<typeof PesoTamanoSchema>;

/**
 * La línea de la guirnalda. Todo opcional: el largo sale de las medidas de la pieza y lo demás del motor. Lo
 * que se salga de su rango se acota con un aviso.
 */
export const FormaPedidaSchema = z
  .object({
    largo_m: z.number().positive().max(100).optional(),
    /** Altura de la línea guía sobre el piso en el extremo izquierdo. */
    altura_m: z.number().min(0).max(10).optional(),
    /** Cuánto sube (+) o baja (−) el extremo derecho respecto al izquierdo. */
    pendiente_m: z.number().min(-5).max(5).optional(),
    /** Amplitud de la ondulación y cuántas ondas hay a lo largo. */
    onda_m: z.number().min(0).max(5).optional(),
    ondas: z.number().min(0).max(20).optional(),
    /** Cuánto cuelga la línea entre sujeciones, y en cuántos festones. */
    colgado_m: z.number().min(0).max(5).optional(),
    festones: z.number().int().min(1).max(20).optional(),
    /** Lado más cargado: −1 izquierda, +1 derecha. */
    carga: z.number().min(-1).max(1).optional(),
    suelo: z.boolean().optional(),
  })
  .strict();

export type FormaPedida = z.infer<typeof FormaPedidaSchema>;

/** El grosor de la banda y cómo se agrupan los globos. */
export const VolumenPedidoSchema = z
  .object({
    grosor_extremos_m: z.number().positive().max(5).optional(),
    grosor_centro_m: z.number().positive().max(5).optional(),
    irregularidad: z.number().min(0).max(1).optional(),
    relleno: z.number().min(0).max(1).optional(),
    /** Globos por racimo, y la fracción que se sale de la banda. */
    racimo: z.number().int().min(1).max(20).optional(),
    salientes: z.number().min(0).max(1).optional(),
  })
  .strict();

export type VolumenPedido = z.infer<typeof VolumenPedidoSchema>;

/** Follaje y flores por metro de línea guía. No se cotizan: no están en el catálogo de globos. */
export const AdornosPedidosSchema = z
  .object({ follaje: z.number().min(0).max(5).optional(), flores: z.number().min(0).max(5).optional() })
  .strict();

export type AdornosPedidos = z.infer<typeof AdornosPedidosSchema>;

/** El remate de una columna. Sin él, el motor pone el suyo. */
export const RematePedidoSchema = z
  .object({
    tipo: z.enum(["ninguno", "globo", "racimo", "estrella", "corazon"]),
    material: z.number().int().min(0).max(11).optional(),
    tamano: TamanoSchema.optional(),
    cantidad: z.number().int().min(3).max(5).optional(),
    foil_m: z.number().positive().max(4).optional(),
  })
  .strict();

export type RematePedido = z.infer<typeof RematePedidoSchema>;

const LineaConteoSchema = z.object({ material: z.number().int().min(0).max(11), cantidad: z.number().int().positive() }).strict();

/** Lo que de verdad lleva el arco armado, para que el modelo pueda contárselo al cliente. Sin globos ni SVG. */
export const ResumenArcoSchema = z
  .object({
    total_globos: z.number().int().nonnegative(),
    filas: z.number().int().nonnegative(),
    columnas: z.number().int().nonnegative(),
    largo_m: z.number().nonnegative(),
    ancho_m: z.number().nonnegative(),
    alto_m: z.number().nonnegative(),
    grosor_m: z.number().nonnegative(),
    globos_por_metro: z.number().nonnegative(),
    conteo: z.array(LineaConteoSchema).max(16),
    compra: z.array(LineaConteoSchema.extend({ comprar: z.number().int().positive() }).strict()).max(16),
    total_comprar: z.number().int().nonnegative(),
  })
  .strict();

export type ResumenArco = z.infer<typeof ResumenArcoSchema>;

/** Lo mismo para la columna. El remate llega descrito en español porque es lo que se le dice al cliente. */
export const ResumenColumnaSchema = z
  .object({
    total_globos: z.number().int().nonnegative(),
    capas: z.number().int().nonnegative(),
    alto_cuerpo_m: z.number().nonnegative(),
    alto_total_m: z.number().nonnegative(),
    diametro_m: z.number().nonnegative(),
    conteo: z.array(LineaConteoSchema.extend({ tamano: TamanoSchema }).strict()).max(32),
    remate: z.string().min(1).max(200),
  })
  .strict();

export type ResumenColumna = z.infer<typeof ResumenColumnaSchema>;

/** Lo que de verdad lleva la guirnalda armada. Sin globos ni SVG, como los otros dos. */
export const ResumenGuirnaldaSchema = z
  .object({
    total_globos: z.number().int().nonnegative(),
    capas: z.number().int().nonnegative(),
    largo_m: z.number().nonnegative(),
    ancho_m: z.number().nonnegative(),
    alto_m: z.number().nonnegative(),
    grosor_extremos_m: z.number().nonnegative(),
    grosor_centro_m: z.number().nonnegative(),
    globos_por_metro: z.number().nonnegative(),
    /** Globos que no tocan a ningún otro. Con el motor bien puesto es 0, y si no lo es, se ve. */
    sueltos: z.number().int().nonnegative(),
    conteo: z
      .array(
        LineaConteoSchema.extend({ tamano: TamanoSchema, acabado: z.string().min(1).max(40) }).strict(),
      )
      .max(64),
    compra: z
      .array(
        LineaConteoSchema.extend({
          por_tamano: z.record(z.string(), z.number().int().nonnegative()),
          comprar: z.number().int().positive(),
        }).strict(),
      )
      .max(16),
    total_comprar: z.number().int().nonnegative(),
    /** Follaje y flores: se listan para que nadie los olvide al montar, no se cobran. */
    adornos: z.object({ ramas: z.number().int().nonnegative(), flores: z.number().int().nonnegative() }).strict(),
  })
  .strict();

export type ResumenGuirnalda = z.infer<typeof ResumenGuirnaldaSchema>;

const AvisosSchema = z.array(z.string().min(1).max(300)).max(32);

/** El armado de un arco, validado por la puerta del motor y resuelto para decir qué lleva. */
export const ArmadoArcoDeIaSchema = z
  .object({
    tipo: z.literal("arco"),
    estructura_id: z.string().min(1).max(160).optional(),
    armado: ArmadoArcoV1Schema,
    resumen: ResumenArcoSchema,
    avisos: AvisosSchema,
  })
  .strict();

/** El armado de una columna, igual. */
export const ArmadoColumnaDeIaSchema = z
  .object({
    tipo: z.literal("columna"),
    estructura_id: z.string().min(1).max(160).optional(),
    armado: ArmadoColumnaV1Schema,
    resumen: ResumenColumnaSchema,
    avisos: AvisosSchema,
  })
  .strict();

/** El armado de una guirnalda orgánica. Es el único de los tres sin patrón. */
export const ArmadoGuirnaldaDeIaSchema = z
  .object({
    tipo: z.literal("guirnalda"),
    estructura_id: z.string().min(1).max(160).optional(),
    armado: ArmadoGuirnaldaOrganicaV1Schema,
    resumen: ResumenGuirnaldaSchema,
    avisos: AvisosSchema,
  })
  .strict();

export const ArmadoDeIaSchema = z.discriminatedUnion("tipo", [
  ArmadoArcoDeIaSchema,
  ArmadoColumnaDeIaSchema,
  ArmadoGuirnaldaDeIaSchema,
]);
export type ArmadoDeIa = z.infer<typeof ArmadoDeIaSchema>;

/** El catálogo de lo que el modelo puede usar, por tipo de pieza. Sale del motor, no de una lista a mano. */
export const CatalogoArmadoSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("arco"), opciones: OpcionesArmadoArcoSchema }).strict(),
  z.object({ tipo: z.literal("columna"), opciones: OpcionesArmadoColumnaSchema }).strict(),
  z.object({ tipo: z.literal("guirnalda"), opciones: OpcionesArmadoGuirnaldaOrganicaSchema }).strict(),
]);
export type CatalogoArmado = z.infer<typeof CatalogoArmadoSchema>;

/** La versión del contrato que le corresponde a cada tipo de pieza. */
const VERSION_POR_TIPO = {
  arco: "armado-arco.v1",
  columna: "armado-columna.v1",
  guirnalda: "armado-guirnalda-organica.v1",
} as const satisfies Record<TipoArmadoMotor, string>;

/**
 * Un armado ya decidido para una estructura del plan: el que el modelo armó si se sostiene contra la pieza de
 * verdad, y si no la receta del motor. `avisos` dice por qué cayó a la receta cuando pasó.
 */
export const ArmadoCompletadoSchema = z
  .object({
    estructura_id: z.string().min(1).max(160),
    tipo: z.enum(TIPOS_ARMADO_MOTOR),
    clave: z.enum(CLAVES_ARMADO_MOTOR),
    origen: z.enum(["modelo", "receta"]),
    armado: z.union([ArmadoArcoV1Schema, ArmadoColumnaV1Schema, ArmadoGuirnaldaOrganicaV1Schema]),
    avisos: AvisosSchema,
  })
  .strict()
  .refine((completado) => completado.clave === CLAVE_ARMADO[completado.tipo], {
    message: "la clave del plan no corresponde al tipo de la pieza",
  })
  .refine((completado) => completado.armado.version === VERSION_POR_TIPO[completado.tipo], {
    message: "el armado no es el del tipo de la pieza",
  });

export type ArmadoCompletado = z.infer<typeof ArmadoCompletadoSchema>;

/**
 * Qué dice del arco (o de la columna) su estructura del plan. `null` cuando la pieza no tiene motor migrado o
 * no lleva materiales: entonces no hay nada que armar y sigue por el camino de siempre.
 */
export function piezaDeEstructura(estructura: Pick<EstructuraPlan, "tipo" | "medidas" | "materiales">): PiezaArmado | null {
  const tipo = (TIPOS_ARMADO_MOTOR as readonly string[]).includes(estructura.tipo)
    ? (estructura.tipo as TipoArmadoMotor)
    : null;
  if (tipo === null || estructura.materiales.length === 0) return null;
  const materiales = estructura.materiales.slice(0, 12);
  // La participación y el acabado que el plan declara **solo** viajan en una guirnalda: su paleta reparte los
  // pesos con la primera y elige el látex de cada color con el segundo. El patrón de un arco o de una columna
  // no los lee, y mandar a Python campos que esa rama ignora es ruido en la frontera. Si algún día la receta
  // del arco ordenara sus colores por participación, `pesos` vuelve aquí para los tres.
  const dePaleta = tipo === "guirnalda"
    ? {
        pesos: materiales.map((material) => material.participacion),
        acabados: materiales.map((material) => material.acabado ?? null),
      }
    : {};
  return {
    tipo,
    colores: materiales.length,
    ...(estructura.medidas.ancho_m === undefined ? {} : { ancho_m: estructura.medidas.ancho_m }),
    ...(estructura.medidas.alto_m === undefined ? {} : { alto_m: estructura.medidas.alto_m }),
    ...(estructura.medidas.largo_m === undefined ? {} : { largo_m: estructura.medidas.largo_m }),
    ...dePaleta,
  };
}

/** La pieza de una estructura concreta del plan, buscada por su id. */
export function piezaDelPlan(plan: Pick<PlanDecoracion, "estructuras">, estructuraId: string): PiezaArmado | null {
  const estructura = plan.estructuras.find((candidata) => candidata.estructura_id === estructuraId);
  return estructura ? piezaDeEstructura(estructura) : null;
}

/**
 * Escribe en el plan los armados que Python completó, uno por estructura.
 *
 * Es traducción, no decisión: cada armado ya pasó por la puerta del motor contra su pieza de verdad y lo que
 * aquí ocurre es ponerlo en su campo. Un armado para una estructura que el plan no tiene se ignora —el plan
 * manda sobre la respuesta—, y las piezas sin armado completado se quedan exactamente como estaban.
 */
export function aplicarArmadosCompletados(plan: PlanDecoracion, armados: readonly ArmadoCompletado[]): PlanDecoracion {
  if (armados.length === 0) return plan;
  const porEstructura = new Map(armados.map((completado) => [completado.estructura_id, completado]));
  return {
    ...plan,
    estructuras: plan.estructuras.map((estructura) => {
      const completado = porEstructura.get(estructura.estructura_id);
      if (!completado || piezaDeEstructura(estructura)?.tipo !== completado.tipo) return estructura;
      // Se escribe UN campo y se conserva todo lo demás. En una guirnalda eso incluye su
      // `armado_guirnalda` de ADR-0032, que tiene otro dueño: aquí no se pisa ni se borra.
      if (completado.tipo === "arco") return { ...estructura, armado_arco: completado.armado as ArmadoArcoV1 };
      if (completado.tipo === "columna") return { ...estructura, armado_columna: completado.armado as ArmadoColumnaV1 };
      return { ...estructura, armado_guirnalda_organica: completado.armado as ArmadoGuirnaldaOrganicaV1 };
    }),
  };
}

/** Si la estructura trae alguno de los armados que la salida del modelo no escribe. */
function traeArmadoDeMotor(estructura: EstructuraPlan): boolean {
  return CLAVES_FUERA_DEL_MODELO.some((clave) => estructura[clave] !== undefined);
}

/**
 * Quita los armados del motor que trajera el plan (los tres de esta capacidad y la columna orgánica). Es lo que corre con la bandera apagada: la salida del
 * modelo no escribe en el plan un campo que la capacidad no tiene encendida.
 *
 * **No toca `armado_guirnalda`** (ADR-0032): ese campo no es de esta capacidad, lo completa la resolución y
 * una guirnalda puede traerlo con o sin el del motor.
 */
export function sinArmadosDeMotor(plan: PlanDecoracion): PlanDecoracion {
  if (!plan.estructuras.some(traeArmadoDeMotor)) return plan;
  return {
    ...plan,
    estructuras: plan.estructuras.map((estructura) => {
      if (!traeArmadoDeMotor(estructura)) return estructura;
      const limpia: EstructuraPlan = { ...estructura };
      delete limpia.armado_arco;
      delete limpia.armado_columna;
      delete limpia.armado_guirnalda_organica;
      delete limpia.armado_columna_organica;
      return limpia;
    }),
  };
}

/**
 * Quita solo el `armado_columna_organica` que trajera el plan del modelo. Es lo que corre con la bandera encendida,
 * donde los otros tres armados sí los decide la capacidad: ninguna herramienta completa la columna orgánica, así que
 * la que llega en un plan del modelo no pasó por ninguna puerta y no entra.
 */
export function sinColumnaOrganicaDelModelo(plan: PlanDecoracion): PlanDecoracion {
  if (!plan.estructuras.some((estructura) => estructura.armado_columna_organica !== undefined)) return plan;
  return {
    ...plan,
    estructuras: plan.estructuras.map((estructura) => {
      if (estructura.armado_columna_organica === undefined) return estructura;
      const limpia: EstructuraPlan = { ...estructura };
      delete limpia.armado_columna_organica;
      return limpia;
    }),
  };
}
