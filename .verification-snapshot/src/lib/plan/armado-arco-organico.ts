import { z } from "zod";
import {
  ACABADOS_GUIRNALDA,
  AdornosGuirnaldaSchema,
  AspectoGuirnaldaSchema,
  CantidadesPorTamanoSchema,
  ColoresGuirnaldaSchema,
  TAMANOS_GUIRNALDA,
  TamanosGuirnaldaSchema,
} from "./armado-guirnalda-organica";

/**
 * Armado de un arco orgánico con el motor del diseñador (ADR-0034): una banda irregular de globos de varios
 * tamaños que sube por una pata, corre por la cima y baja por la otra, con racimos que se solapan, globos que
 * se salen de la banda, follaje y flores. Es declarativo y apunta a `materiales` por índice, como el resto de
 * los armados.
 *
 * **Un medio arco es este armado con `forma.corte < 1`.** La taxonomía retiró `semiarco` porque todo medio
 * arco es orgánico (AGENTS.md, decisiones vigentes): se arma aquí, cortando la banda antes de que baje.
 *
 * **Convive con `armado-arco.v1`, no lo reemplaza.** Aquel es el arco clásico de la rejilla de patrones
 * (`solido`, `espiral`, `chevron`…, ADR-0034), con sus capas y secciones; este es el arco orgánico, que no
 * lleva patrón sino una mezcla de tamaños y una paleta con su acabado. Cuando una pieza trae los dos, manda
 * el clásico: es el que ya existía, igual que la columna clásica manda sobre la orgánica.
 *
 * **El dueño de la lógica es `clasificador-decoraciones`** (`src/lib/organico/`, el diseñador de
 * `/arcos-organicos`), migrado a `services/ai-api/app/organico/`. Este archivo es solo la forma: las reglas
 * cruzadas —qué alto admite un ancho, qué grosor cabe en esa abertura, qué tamaños caben en esa banda— las
 * valida únicamente `app/armado_arco_organico.py`.
 *
 * Ningún campo lleva `.default()`: Zod 4 lo exportaría como requerido y lo escribiría dentro del plan que
 * firma `plan_hash`. **Los mandos del motor van en camelCase** porque son su vocabulario y viajan tal cual
 * hasta él; lo que mira el plan va en snake_case, como el resto de los contratos. La mezcla de tamaños, la
 * paleta, los adornos y el aspecto son los mismos esquemas que la guirnalda y la columna orgánicas: es el
 * mismo motor compartido.
 */

export const ARMADO_ARCO_ORGANICO_VERSION = "armado-arco-organico.v1" as const;

export const ORIGENES_ARMADO_ARCO_ORGANICO = ["decorador", "referencia", "sugerido"] as const;

/**
 * Las formas listas que publica el original (`src/lib/organico/formas.ts`, `FORMAS_LISTAS`) y que
 * `opciones_admitidas()` devuelve con sus valores: arcos completos, marcos de puerta y medios arcos.
 *
 * **Estos ids no viajan en el armado**: aplicar una forma lista es copiar su `forma`, su `volumen`, sus
 * `tamanos` y su `semilla` a este armado, así que lo guardado sigue siendo la disposición y no el nombre de
 * una receta (igual que en la columna orgánica). La lista está aquí para nombrarlas en la interfaz y en el
 * chat sin copiar ninguna cifra del diseñador, y para que se vea si allá se añade o se quita una.
 */
export const FORMAS_LISTAS_ARCO_ORGANICO = [
  "estandar",
  "simetrico",
  "entrada",
  "puerta",
  "fondo-fotos",
  "asimetrico",
  "medio-pila",
  "medio-corto",
  "medio-aireado",
  "focales",
  // Las cuatro que se añadieron el 2026-10-03 en el repo dueño: el arco bajo de la mesa de postres, la
  // herradura de fachada, el de globos gigantes y el que se derrama en una pila en el piso.
  "mesa",
  "herradura",
  "gigantes",
  "cascada",
  "racimos-sueltos",
] as const;
export type FormaListaArcoOrganico = (typeof FORMAS_LISTAS_ARCO_ORGANICO)[number];

const IndiceMaterialSchema = z.number().int().min(0).max(11);

/**
 * La silueta del arco, en metros. Los rangos son los que el motor impone siempre
 * (`app/organico/limites.py`); los que dependen del armado puesto —el alto según el ancho y el grosor— los
 * publica `limites_de()` y no se pueden escribir aquí.
 */
export const FormaArcoOrganicoSchema = z
  .object({
    /** Ancho de pata a pata. */
    anchoM: z.number().min(1.5).max(10),
    /** Alto hasta la cima. El rango vivo es más estrecho: lo dice `limites_de`. */
    altoM: z.number().min(1).max(6),
    /** Dónde queda la cima a lo largo del arco: 0,5 es centrada. */
    cima: z.number().min(0.3).max(0.7),
    /** Cuánto se cierra la curva: más es más herradura. */
    curva: z.number().min(1.7).max(3.4),
    /** Cuánto tiembla la línea guía (0 = limpia). */
    ondulacion: z.number().min(0).max(1),
    /** Lado más cargado: −1 izquierda, +1 derecha. Ese lado es más grueso y lleva los globos más grandes. */
    carga: z.number().min(-1).max(1),
    /** Dónde se corta la banda: 1 es el arco completo y menos de 1, un medio arco que termina en el aire. */
    corte: z.number().min(0.55).max(1),
    /** Corta por el otro lado, para el medio arco que sube a la derecha. */
    espejo: z.boolean(),
    suelo: z.boolean(),
  })
  .strict();

/** Grosor visible de la banda y cómo se agrupan los globos. */
export const VolumenArcoOrganicoSchema = z
  .object({
    /** Grosor en las patas y en la cima. El tope real baja con el ancho: una banda gruesa taparía la abertura. */
    grosorPatasM: z.number().min(0.35).max(1.6),
    grosorCimaM: z.number().min(0.35).max(1.6),
    irregularidad: z.number().min(0).max(1),
    relleno: z.number().min(0).max(1),
    /** Globos por racimo. */
    racimo: z.number().int().min(1).max(8),
    /** Fracción de globos que se salen de la banda. */
    salientes: z.number().min(0).max(1),
  })
  .strict();

export const ArmadoArcoOrganicoV1Schema = z
  .object({
    version: z.literal(ARMADO_ARCO_ORGANICO_VERSION),
    origen: z.enum(ORIGENES_ARMADO_ARCO_ORGANICO),
    forma: FormaArcoOrganicoSchema,
    volumen: VolumenArcoOrganicoSchema,
    tamanos: TamanosGuirnaldaSchema,
    colores: ColoresGuirnaldaSchema,
    adornos: AdornosGuirnaldaSchema,
    aspecto: AspectoGuirnaldaSchema,
  })
  .strict();

export type ArmadoArcoOrganicoV1 = z.infer<typeof ArmadoArcoOrganicoV1Schema>;

/** Un globo ya colocado por el motor. */
export const GloboArcoOrganicoSchema = z
  .object({
    /**
     * Posición y radio **en metros**: `x` a la derecha desde la pata izquierda, `y` hacia arriba desde el
     * piso. Quien quiera dibujarlo no tiene que escalarlo: el SVG que emite el motor ya viene en su lienzo
     * cuadrado de 600 × 600. Estos números son para medir, no para pintar.
     */
    x: z.number(),
    y: z.number(),
    r: z.number().nonnegative(),
    /** Capa de profundidad: 0 es la del fondo. */
    capa: z.number().int().nonnegative(),
    tamano: z.literal(TAMANOS_GUIRNALDA),
    material: IndiceMaterialSchema,
    acabado: z.enum(ACABADOS_GUIRNALDA),
  })
  .strict();

/**
 * El arco orgánico resuelto: lo que Python devuelve y la gráfica muestra sin recalcular nada.
 *
 * El dibujo **no viaja aquí**: son decenas de kilobytes por pieza, se regenera cuando haga falta y no entra
 * en `plan_hash`. Lo publica aparte la puerta, como en las otras dos orgánicas.
 */
export const ArcoOrganicoResueltoSchema = z
  .object({
    version: z.literal(ARMADO_ARCO_ORGANICO_VERSION),
    globos: z.array(GloboArcoOrganicoSchema).max(900),
    capas: z.number().int().nonnegative(),
    /** Medidas reales en metros. */
    ancho_m: z.number().nonnegative(),
    alto_m: z.number().nonnegative(),
    /** Lo que mide la banda recorrida de punta a punta: con esto se cuenta, no con el ancho. */
    largo_m: z.number().nonnegative(),
    grosor_patas_m: z.number().nonnegative(),
    grosor_cima_m: z.number().nonnegative(),
    globos_por_metro: z.number().nonnegative(),
    globos_por_pie: z.number().nonnegative(),
    /** Globos que quedaron sin tocar a ningún otro. Con el motor bien puesto es 0, y si no lo es, se ve. */
    sueltos: z.number().int().nonnegative(),
    conteo: z
      .array(
        z
          .object({
            material: IndiceMaterialSchema,
            tamano: z.literal(TAMANOS_GUIRNALDA),
            acabado: z.enum(ACABADOS_GUIRNALDA),
            cantidad: z.number().int().positive(),
          })
          .strict(),
      )
      .max(64),
    /** Lo que hay que comprar por material y tamaño, con el desperdicio redondeado hacia arriba. */
    compra: z
      .array(
        z
          .object({
            material: IndiceMaterialSchema,
            por_tamano: CantidadesPorTamanoSchema,
            cantidad: z.number().int().positive(),
            comprar: z.number().int().positive(),
          })
          .strict(),
      )
      .max(16),
    total_comprar: z.number().int().nonnegative(),
    /** Follaje y flores: se listan para que nadie los olvide, pero no están en el catálogo de globos. */
    adornos: z.object({ ramas: z.number().int().nonnegative(), flores: z.number().int().nonnegative() }).strict(),
    /** Lo que el motor corrigió del armado pedido, en español, para mostrarlo. */
    avisos: z.array(z.string().min(1).max(300)).max(32),
    /**
     * Derivados para la imagen, igual que en el arco y en la guirnalda orgánica (ADR-0035): a qué estructura
     * pertenece y cómo le cuenta Python este armado a los modelos de imagen, en inglés (el del LoRA en ASCII
     * y sin cifras). Opcionales: los escribe la resolución, no el motor, y viajan **fuera** del snapshot, así
     * que no entran en `plan_hash`. TypeScript solo los inserta, tal cual.
     *
     * Sin ellos el caption solo sabe nombrar la pieza y sus colores, y lo que no dice lo inventa el LoRA con
     * lo que aprendió del corpus: el 2026-10-04, dos columnas orgánicas salieron coronadas por un globo
     * gigante que el plan apaga a propósito y que nadie estaba cobrando.
     */
    estructura_id: z.string().min(1).max(160).optional(),
    prompt_gemini: z.string().max(1500).optional(),
    prompt_lora: z.string().max(600).optional(),
  })
  .strict();

export type ArcoOrganicoResuelto = z.infer<typeof ArcoOrganicoResueltoSchema>;
