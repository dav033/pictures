import { z } from "zod";
import { TIPOS_GLOBO_BOUQUET } from "./armado-bouquet";

/**
 * Contrato de la guía de escena (`plan-guia-escena.v1`): los globos de cada estructura del plan aprobado como
 * discos planos en metros, para que la composición de la guía que recibe FLUX por `/edit` los coloque donde la
 * foto de referencia tiene cada pieza.
 *
 * **Python es el único dueño de la geometría** (`services/ai-api/app/guia_escena.py`): toma cada globo de la
 * lista que ya calculó el motor de la pieza o, si ningún motor la arma, del dibujo esquemático
 * (`app/dibujo_estructura.py`) o de su módulo en `app/guia_piezas` (bouquet, figura, guirnalda clásica), con lo
 * que la resolución ya sabe de cada material (`mezclas[]`). Aquí solo se publica la forma de la pregunta y de la
 * respuesta (incluido cómo se sostiene cada pieza: `anclaje` y `elevacion_m`, y lo que se ve sin ser globo:
 * `trazos` y `rellenos`); TypeScript
 * compone y rasteriza (`src/lib/ia/kagutsuchi/guia-escena.ts`), nunca coloca un globo.
 *
 * Derivado: no entra en el plan, en el snapshot ni en `plan_hash`. No cuenta ni cotiza nada.
 */

export const PLAN_GUIA_ESCENA_CONTRACT_VERSION = "plan-guia-escena.v1" as const;
export const PLAN_GUIA_ESCENA_RESULT_CONTRACT_VERSION = "plan-guia-escena-result.v1" as const;

/**
 * Tope de discos de una guía entera (todas las piezas juntas). Una guía de 1024 px no distingue más, y la
 * respuesta queda en unos cientos de KB. Python lee este mismo número del contrato exportado (`maxItems` de
 * `discos`) y rechaza la escena que lo pasa; el Zod lo comprueba además sumando todas las piezas.
 */
export const GUIA_ESCENA_MAX_DISCOS = 3000;
/** Estructuras por plan: el tope de `plan-decoracion.v1` (`estructuras.maxItems`). */
export const GUIA_ESCENA_MAX_PIEZAS = 8;
/** Líneas de `mezcla_real` por pieza: hasta 12 materiales por los 6 tamaños redondos del catálogo. */
const MAX_LINEAS_MEZCLA = 72;

const idSchema = z.string().trim().min(1).max(160);

/** Una línea de `plan_resuelto.estructuras[].mezcla_real`, tal cual la publicó la resolución. */
const LineaMezclaRealSchema = z.object({
  diam_pulg: z.number().nonnegative(),
  forma: z.string().nullable(),
  unidades: z.number().int().nonnegative(),
  pct: z.number().min(0).max(100),
}).strict();

/** Materiales por pieza: holgura sobre lo que declara un plan (la leyenda trae uno por material). */
const MAX_MATERIALES_PIEZA = 24;
const textoCatalogo = (max: number) => z.string().max(max).nullable();

/**
 * Lo que el catálogo dice de una línea resuelta de la pieza (`plan_resuelto.estructuras[].lineas`), recortado a
 * lo que clasifica un globo: título, forma, tamaño, color y acabado. Python lo empareja con cada material
 * (`plan.contexto_bouquet_de_globos`, por `variant_id` y si no por producto y color) y sabe así si es látex,
 * foil, burbuja o número y de cuántas pulgadas, sin catálogo. Las unidades no viajan: las cuentas son del plan.
 */
const LineaCatalogoGuiaSchema = z.object({
  product_id: idSchema,
  variant_id: idSchema,
  titulo: z.string().trim().min(1).max(500),
  color: textoCatalogo(160),
  tamano_codigo: textoCatalogo(80),
  diam_pulg: z.number().nonnegative().max(200).nullable(),
  forma: textoCatalogo(80),
  acabado: textoCatalogo(80),
}).strict();

/**
 * Una entrada de la leyenda del armado resuelto de un bouquet (`plan_resuelto.armados_bouquet[].leyenda`): el
 * tipo de globo y el tamaño que la resolución ya decidió para el material `material` con el catálogo delante.
 * Si viene, manda sobre lo que Python deduce de `lineas`.
 */
const LeyendaGuiaSchema = z.object({
  material: z.number().int().nonnegative().max(MAX_MATERIALES_PIEZA - 1),
  tipo_globo: z.enum(TIPOS_GLOBO_BOUQUET),
  tamano_pulg: z.number().positive().max(200).nullable(),
  digito: z.string().regex(/^\d$/).nullable(),
}).strict();

/** Alto sobre ancho de una caja de la foto, en píxeles de la guía: de una franja muy ancha a una muy alta. */
export const GUIA_ESCENA_ASPECTO_CAJA = { min: 0.05, max: 20 } as const;

export const PlanGuiaEscenaRequestV1Schema = z.object({
  schema_version: z.literal(PLAN_GUIA_ESCENA_CONTRACT_VERSION),
  /** El plan resuelto (`plan_resuelto.plan`). Python lo valida contra `plan-decoracion.v1`. */
  plan: z.record(z.string(), z.unknown()),
  /**
   * Lo que la resolución ya sabe de cada pieza y el plan no dice. Todo derivado: Python lo lee, nunca lo
   * recalcula ni cuenta con ello.
   *
   * - `mezcla_real`: la mezcla de tamaños que la resolución calculó; el dibujo esquemático la reparte y las
   *   piezas sin dibujo (la figura, el bouquet) toman de ella los tamaños de su látex.
   * - `lineas` (opcional): el catálogo de cada línea resuelta, para saber qué globo es cada material (un
   *   corazón metalizado de 18" se dibuja foil de 18", no látex R-12).
   * - `leyenda` (opcional): la leyenda del armado resuelto del bouquet; manda sobre `lineas`.
   * - `aspecto_caja` (opcional): alto sobre ancho de la caja de la foto donde va la pieza, en píxeles de la
   *   guía. La figura sin silueta conocida (un animal, un personaje) dibuja su óvalo con esta proporción.
   */
  mezclas: z.array(z.object({
    estructura_id: idSchema,
    mezcla_real: z.array(LineaMezclaRealSchema).max(MAX_LINEAS_MEZCLA),
    lineas: z.array(LineaCatalogoGuiaSchema).max(MAX_LINEAS_MEZCLA).optional(),
    leyenda: z.array(LeyendaGuiaSchema).max(MAX_MATERIALES_PIEZA).optional(),
    aspecto_caja: z.number().min(GUIA_ESCENA_ASPECTO_CAJA.min).max(GUIA_ESCENA_ASPECTO_CAJA.max).optional(),
  }).strict()).max(GUIA_ESCENA_MAX_PIEZAS).optional(),
}).strict();

/**
 * Un globo de la pieza en su marco local: metros, origen abajo al centro de la pieza y `y` hacia arriba. `hex`
 * es el color del globo inflado de la referencia Sempertex que se compra (`hexGlobo`).
 */
export const DiscoGuiaEscenaSchema = z.object({
  x_m: z.number().min(-100).max(100),
  y_m: z.number().min(-1).max(100),
  r_m: z.number().positive().max(5),
  hex: z.string().regex(/^#[0-9a-f]{6}$/),
}).strict();

export const FUENTES_GUIA_ESCENA = ["motor", "dibujo"] as const;
export const MOTIVOS_OMISION_GUIA_ESCENA = ["sin_dibujo", "sin_materiales"] as const;
/**
 * Cómo se sostiene la pieza: `piso` apoyada abajo, `techo` colgada arriba, `pared` centrada en su caja y
 * `flotante` con helio, atada a una pesa en el piso pero con los globos `elevacion_m` por encima de él.
 */
export const ANCLAJES_GUIA_ESCENA = ["piso", "techo", "flotante", "pared"] as const;
/** La cinta más larga que un ramo de helio lleva en el diseñador del clasificador, con holgura. */
export const GUIA_ESCENA_MAX_ELEVACION_M = 10;

/**
 * Lo que **no es un globo** pero se ve y se construye de verdad: el marco metálico de un aro y su poste, las
 * cintas de un bouquet. Sale de la misma lista que pinta el dibujo de la pieza (`app/referencias/dibujos.py`,
 * capturado sin tocar el SVG) o del diseñador del bouquet, en el mismo marco local que los discos. Opcional y
 * aditivo: una pieza sin estructura visible no lo trae y se compone igual que siempre.
 *
 * Planos y sin texto, como los discos. No cuentan ni cotizan nada: el plan sigue siendo el dueño de lo que se
 * compra (el marco de un aro es parte de la pieza, no una línea de compra aquí).
 */
const metroGuia = z.number().min(-100).max(100);
/** Lo que cuelga por debajo de una pieza flotante (cintas, pesa) llega hasta el piso: `-elevacion_m`. */
const alturaGuia = z.number().min(-GUIA_ESCENA_MAX_ELEVACION_M).max(100);
const hexGuia = z.string().regex(/^#[0-9a-f]{6}$/);
const grosorGuia = z.number().positive().max(1);

export const TrazoGuiaEscenaSchema = z.discriminatedUnion("forma", [
  /** Un tramo recto: el poste de un aro, una cinta. */
  z.object({ forma: z.literal("linea"), x1_m: metroGuia, y1_m: alturaGuia, x2_m: metroGuia, y2_m: alturaGuia, grosor_m: grosorGuia, hex: hexGuia }).strict(),
  /**
   * Un arco de circunferencia en grados (0 = derecha, sentido antihorario con `y` hacia arriba), de `desde` a
   * `hasta`; `hasta - desde >= 360` es el anillo entero.
   */
  z.object({
    forma: z.literal("arco"),
    cx_m: metroGuia,
    cy_m: alturaGuia,
    r_m: z.number().positive().max(50),
    desde_grados: z.number().min(-720).max(720),
    hasta_grados: z.number().min(-720).max(720),
    grosor_m: grosorGuia,
    hex: hexGuia,
  }).strict(),
]);

export const RellenoGuiaEscenaSchema = z.discriminatedUnion("forma", [
  /** El forro de un aro, la base de su poste. */
  z.object({ forma: z.literal("elipse"), cx_m: metroGuia, cy_m: alturaGuia, rx_m: z.number().positive().max(50), ry_m: z.number().positive().max(50), hex: hexGuia }).strict(),
  /** La tela de una media luna, la pesa o la caja de un bouquet. */
  z.object({ forma: z.literal("poligono"), puntos: z.array(z.object({ x_m: metroGuia, y_m: alturaGuia }).strict()).min(3).max(64), hex: hexGuia }).strict(),
]);

/** Trazos y rellenos por pieza: un bouquet lleva una cinta por globo, un aro doble dos anillos con su poste. */
export const GUIA_ESCENA_MAX_TRAZOS = 128;
export const GUIA_ESCENA_MAX_RELLENOS = 16;

export const PiezaGuiaEscenaSchema = z.object({
  estructura_id: idSchema,
  /** `motor`: los globos que colocó el motor de la pieza. `dibujo`: los del dibujo esquemático. */
  fuente: z.enum(FUENTES_GUIA_ESCENA),
  ancho_m: z.number().positive().max(100),
  alto_m: z.number().positive().max(100),
  /**
   * Opcional: cómo se sostiene, cuando Python lo sabe mejor que la ubicación del plan (un bouquet de helio
   * flota). Sin el campo, la composición decide por la ubicación, como siempre.
   */
  anclaje: z.enum(ANCLAJES_GUIA_ESCENA).optional(),
  /**
   * Opcional, solo con `anclaje: "flotante"`: altura en metros del globo más bajo sobre el piso (la pesa y las
   * cintas, que no son globos, no se dibujan). Es la del diseñador del bouquet: la cinta de cada nivel.
   */
  elevacion_m: z.number().min(0).max(GUIA_ESCENA_MAX_ELEVACION_M).optional(),
  /** En orden de pintura: lo de atrás primero. */
  discos: z.array(DiscoGuiaEscenaSchema).min(1).max(GUIA_ESCENA_MAX_DISCOS),
  /**
   * Opcional: la estructura que no es globo y se ve (anillo y poste de un aro, cintas de un bouquet). Se pinta
   * detrás de los discos de la pieza, después de los `rellenos`.
   */
  trazos: z.array(TrazoGuiaEscenaSchema).min(1).max(GUIA_ESCENA_MAX_TRAZOS).optional(),
  /** Opcional: superficies planas que no son globo (el forro de un aro, la pesa o la caja de un bouquet). */
  rellenos: z.array(RellenoGuiaEscenaSchema).min(1).max(GUIA_ESCENA_MAX_RELLENOS).optional(),
}).strict();

export const PlanGuiaEscenaResultV1Schema = z.object({
  operation_schema_version: z.literal(PLAN_GUIA_ESCENA_RESULT_CONTRACT_VERSION),
  piezas: z.array(PiezaGuiaEscenaSchema).max(GUIA_ESCENA_MAX_PIEZAS),
  /** Las estructuras que no tienen ni motor ni dibujo (un bouquet, una figura) o no llevan materiales. */
  omitidas: z.array(z.object({
    estructura_id: idSchema,
    motivo: z.enum(MOTIVOS_OMISION_GUIA_ESCENA),
  }).strict()).max(GUIA_ESCENA_MAX_PIEZAS),
  total_discos: z.number().int().nonnegative().max(GUIA_ESCENA_MAX_DISCOS),
}).strict().superRefine((valor, ctx) => {
  const total = valor.piezas.reduce((suma, pieza) => suma + pieza.discos.length, 0);
  if (total !== valor.total_discos) ctx.addIssue({ code: "custom", path: ["total_discos"], message: "total_discos no suma los discos de las piezas." });
  valor.piezas.forEach((pieza, indice) => {
    if (pieza.elevacion_m !== undefined && pieza.anclaje !== "flotante") ctx.addIssue({ code: "custom", path: ["piezas", indice, "elevacion_m"], message: "elevacion_m solo acompaña a anclaje flotante." });
  });
});

export type PlanGuiaEscenaRequestV1 = z.infer<typeof PlanGuiaEscenaRequestV1Schema>;
export type PlanGuiaEscenaResultV1 = z.infer<typeof PlanGuiaEscenaResultV1Schema>;
export type PiezaGuiaEscena = z.infer<typeof PiezaGuiaEscenaSchema>;
export type DiscoGuiaEscena = z.infer<typeof DiscoGuiaEscenaSchema>;
export type TrazoGuiaEscena = z.infer<typeof TrazoGuiaEscenaSchema>;
export type RellenoGuiaEscena = z.infer<typeof RellenoGuiaEscenaSchema>;
export type AnclajeGuiaEscena = (typeof ANCLAJES_GUIA_ESCENA)[number];
