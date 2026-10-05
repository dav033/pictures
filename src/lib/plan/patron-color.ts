import { z } from "zod";

/**
 * Patrón de color de una estructura (ADR-0028): DÓNDE va cada color, no solo
 * cuánto. Es declarativo y apunta a `materiales` por índice, nunca por nombre
 * de color: el catálogo reetiqueta colores y dos materiales pueden compartir
 * uno.
 *
 * Solo forma. Las reglas cruzadas (índices dentro de `materiales`, modos por
 * tipo de estructura, racimo del tamaño correcto, colores sin uso) las valida
 * únicamente `services/ai-api/app/patron_color.py`; repetirlas aquí sería un
 * segundo dueño. Ningún campo lleva `.default()`: Zod 4 lo exportaría como
 * requerido y lo escribiría dentro del plan que firma `plan_hash`.
 */

export const PATRON_COLOR_VERSION = "patron-color.v1" as const;

export const MODOS_PATRON_COLOR = ["espiral", "anillos", "bloques", "degradado", "aleatorio", "flor", "damero", "zonas"] as const;
export type ModoPatronColor = (typeof MODOS_PATRON_COLOR)[number];

export const TRAZOS_ESPIRAL = ["espiral", "zigzag", "recto"] as const;
export const ORIGENES_PATRON_COLOR = ["decorador", "referencia", "sugerido"] as const;
export const DIRECCIONES_PATRON_COLOR = ["longitudinal", "transversal", "diagonal"] as const;

/**
 * Qué tamaños de globo se ven en la pieza de la foto, en las cuatro formas en que un ojo lo distingue sin
 * medir nada: casi todos gigantes, grandes con algún chico metido, chicos con pocos grandes de acento, o
 * todos del mismo tamaño.
 *
 * No son mezclas: son observaciones. La mezcla —qué proporción de 5", 9", 12", 18" y 24" se compra— la
 * decide `mezclas.ts`, que es su dueño, y el puente entre las dos tablas vive en un solo sitio
 * (`patron_de_la_foto.mezcla_del_motor`). Por eso aquí no dice «solo_grandes»: quien mira la foto no sabe
 * qué diámetros existen en el catálogo, igual que no sabe qué modos admite la pieza.
 *
 * Hacía falta porque nadie se lo preguntaba a la foto: la IA que arma el plan elegía la mezcla a ojo desde
 * la descripción, y una columna dorada de globos casi todos gigantes salía armada `organica_gruesa`
 * —45 % de 12"— contra una foto en la que no había casi ningún 12" (2026-10-03).
 */
export const TAMANOS_LEIDOS = [
  "casi_todos_gigantes",
  "grandes_con_pocos_chicos",
  "chicos_con_pocos_grandes",
  "un_solo_tamano",
] as const;
export type TamanoLeido = (typeof TAMANOS_LEIDOS)[number];

/**
 * Dónde se agrupa una mancha de color sobre la pieza (modo `zonas`, ADR-0036).
 * Los nueve sitios en que un decorador —y el modelo que lee la foto— parte una
 * pared al describirla: tercio de arriba, del medio y de abajo por izquierda,
 * centro y derecha. Son posiciones ABSOLUTAS de la pieza, no un recorrido a lo
 * largo de un eje: por eso el modo no admite dirección ni espejo.
 *
 * El punto exacto de cada ancla dentro de la pieza lo decide Python
 * (`patron_color._ANCLAS`), que es el dueño de la semántica del patrón; aquí
 * solo vive la lista de valores admitidos.
 */
export const ANCLAS_ZONA = [
  "superior_izquierda",
  "superior_centro",
  "superior_derecha",
  "media_izquierda",
  "centro",
  "media_derecha",
  "inferior_izquierda",
  "inferior_centro",
  "inferior_derecha",
] as const;
export type AnclaZona = (typeof ANCLAS_ZONA)[number];

/** Parte de la pieza que puede ocupar UNA mancha, en porcentaje. */
export const EXTENSION_ZONA_MAXIMA = 60;
/**
 * Manchas por patrón. Ocho cubre el caso del oficio (un color agrupado en tres
 * o cuatro sitios más otro en uno o dos) y deja sitio al fondo: con doce
 * colores, uno es el fondo, ocho van en manchas y los tres restantes caben en
 * los cuatro `acentos` que el contrato admite.
 */
export const ZONAS_MAXIMAS = 8;

const IndiceMaterialSchema = z.number().int().min(0).max(11);
/**
 * Última fila o posición que puede tener una rejilla. Python expande hasta
 * 4000 celdas (`MAX_CELDAS`, ADR-0028 §2) y una pared puede salir con una sola
 * fila, así que una fila o una columna llegan a 4000 posiciones: una pared de
 * 10 m × 2,4 m ya tiene 76 columnas. Un tope menor dejaría globos de la gráfica
 * que el editor dibuja pero no puede pintar.
 */
const INDICE_REJILLA_MAXIMO = 3999;
const IndiceRejillaSchema = z.number().int().min(0).max(INDICE_REJILLA_MAXIMO);
const RacimoSchema = z.array(IndiceMaterialSchema).min(1).max(8);
const PesoMaterialSchema = z.object({
  material: IndiceMaterialSchema,
  peso: z.number().int().min(1).max(100),
}).strict();

export const BasePatronColorSchema = z.discriminatedUnion("modo", [
  z.object({
    modo: z.literal("espiral"),
    /** Colores de las posiciones de cada racimo; todos los racimos son iguales. */
    racimo: RacimoSchema,
    trazo: z.enum(TRAZOS_ESPIRAL),
  }).strict(),
  z.object({
    modo: z.literal("anillos"),
    /** Cada racimo (o fila) de un solo color, en este orden, repitiéndose. */
    secuencia: z.array(IndiceMaterialSchema).min(1).max(12),
    /** Racimos (o filas) seguidos de cada color. */
    largo: z.number().int().min(1).max(24),
  }).strict(),
  z.object({
    modo: z.literal("bloques"),
    /** Secciones contiguas en este orden, con su peso relativo. */
    bloques: z.array(PesoMaterialSchema).min(2).max(12),
  }).strict(),
  z.object({
    modo: z.literal("degradado"),
    paradas: z.array(IndiceMaterialSchema).min(2).max(6),
    transicion: z.enum(["suave", "escalonada"]),
  }).strict(),
  z.object({
    modo: z.literal("aleatorio"),
    pesos: z.array(PesoMaterialSchema).min(1).max(6),
    /** Solo fija la posición de cada globo; el conteo sale de los pesos. */
    semilla: z.number().int().min(0).max(2147483647),
  }).strict(),
  z.object({
    modo: z.literal("flor"),
    fondo: IndiceMaterialSchema,
    petalo: IndiceMaterialSchema,
    centro: IndiceMaterialSchema,
    /** Racimos de fondo entre una flor y la siguiente. */
    separacion: z.number().int().min(1).max(6),
  }).strict(),
  z.object({
    modo: z.literal("damero"),
    secuencia: z.array(IndiceMaterialSchema).min(2).max(4),
    tamano: z.number().int().min(1).max(4),
  }).strict(),
  z.object({
    modo: z.literal("zonas"),
    /** El color que llena todo lo que las manchas no toman. */
    fondo: IndiceMaterialSchema,
    /**
     * Manchas de un color AGRUPADAS en un sitio de la pieza. Varias pueden
     * repetir color: así se dice "el dorado va en cuatro zonas". Las primeras
     * mandan donde se solapen.
     */
    zonas: z.array(z.object({
      material: IndiceMaterialSchema,
      ancla: z.enum(ANCLAS_ZONA),
      extension: z.number().int().min(1).max(EXTENSION_ZONA_MAXIMA),
    }).strict()).min(1).max(ZONAS_MAXIMAS),
  }).strict(),
]);

export const AcentoPatronColorSchema = z.object({
  material: IndiceMaterialSchema,
  cada: z.number().int().min(2).max(24),
  desde: z.number().int().min(1).max(24),
  posiciones: z.array(IndiceRejillaSchema).min(1).max(64).optional(),
}).strict();

export const PintadoPatronColorSchema = z.object({
  fila: IndiceRejillaSchema,
  /** Sin columna se pinta el racimo (o la fila) completo. */
  columna: IndiceRejillaSchema.optional(),
  material: IndiceMaterialSchema,
}).strict();

export const PatronColorV1Schema = z.object({
  version: z.literal(PATRON_COLOR_VERSION),
  origen: z.enum(ORIGENES_PATRON_COLOR),
  globos_por_racimo: z.number().int().min(1).max(8).optional(),
  base: BasePatronColorSchema,
  acentos: z.array(AcentoPatronColorSchema).max(4).optional(),
  pintados: z.array(PintadoPatronColorSchema).max(512).optional(),
  simetria: z.literal("espejo").optional(),
  direccion: z.enum(DIRECCIONES_PATRON_COLOR).optional(),
}).strict();

export type PatronColor = z.infer<typeof PatronColorV1Schema>;
export type BasePatronColor = z.infer<typeof BasePatronColorSchema>;
export type AcentoPatronColor = z.infer<typeof AcentoPatronColorSchema>;
export type PintadoPatronColor = z.infer<typeof PintadoPatronColorSchema>;

const EnteroNoNegativo = z.number().int().min(0);
const EnteroPositivo = z.number().int().min(1);

/**
 * Un globo colocado sobre la silueta real de la pieza, en METROS, con `y = 0`
 * en el suelo (el motor `services/ai-api/app/silueta.py` crece hacia arriba; la
 * pantalla, hacia abajo). `capa` es la profundidad, 0 = fondo.
 *
 * Solo dibujo. Las cantidades por color no salen de aquí: salen de `conteo`, y
 * son las mismas con posiciones o sin ellas (`app/silueta_patron.py` reasigna el
 * color de sitio, nunca de cantidad). Tope: `silueta.MAX_GLOBOS`, el límite del
 * propio motor; el presupuesto de dibujo de Python es más estricto y puede
 * bajar o subir sin tocar el contrato.
 */
const MAX_POSICIONES_SILUETA = 1600;
/** Ninguna pieza del oficio pasa de esto; acota un metraje absurdo, no dibuja nada. */
const METROS_MAXIMOS = 60;
const PosicionSiluetaSchema = z.object({
  x: z.number().min(0).max(METROS_MAXIMOS),
  y: z.number().min(0).max(METROS_MAXIMOS),
  /** Radio inflado (m). */
  r: z.number().gt(0).max(1),
  capa: EnteroNoNegativo.max(15),
  material: IndiceMaterialSchema,
}).strict();

export type PosicionSilueta = z.infer<typeof PosicionSiluetaSchema>;

/**
 * Por qué una pieza se quedó SIN croquis y la gráfica se dibuja con la rejilla
 * de siempre. La degradación es correcta —un aro no tiene silueta, una pared
 * enorme no cabe en el presupuesto de dibujo— pero no puede ser invisible:
 * hasta que este campo existió, una pieza de más de 420 globos por instancia (u
 * 840 por resolución) volvía a la rejilla sin dejar rastro en ningún sitio.
 *
 * Cada valor descarta una causa al leer el log: el `tipo` de la pieza, una
 * medida que el plan no declara, el tamaño de la pieza, el presupuesto que se
 * gastaron las piezas anteriores de la misma resolución, el motor de silueta y
 * un despiece que no corresponde con la rejilla. Dueño de los valores:
 * `services/ai-api/app/silueta_patron.MotivoSinSilueta`.
 */
export const MOTIVOS_SIN_SILUETA = [
  "tipo_sin_silueta",
  "medidas_incompletas",
  "pieza_muy_grande",
  "presupuesto_agotado",
  "motor_rechazo",
  "despiece_incoherente",
] as const;

export type MotivoSinSilueta = (typeof MOTIVOS_SIN_SILUETA)[number];

/**
 * Lo que Python devuelve de un patrón ya expandido: la rejilla, el conteo, el
 * paso a paso y los textos. Viaja en `plan_resuelto.patrones_color` (fuera del
 * snapshot que firma `plan_hash`) y en la vista previa del editor. La UI solo
 * lo dibuja; nunca lo recalcula.
 */
export const PatronColorResueltoSchema = z.object({
  estructura_id: z.string().min(1).max(160),
  /** `false`: sugerencia para una estructura sin `patron_color`; el plan no la usa. */
  aplicado: z.boolean(),
  patron: PatronColorV1Schema,
  geometria: z.enum(["racimos", "rejilla"]),
  filas: EnteroPositivo,
  columnas: EnteroPositivo,
  repeticiones: EnteroPositivo,
  globos_por_instancia: EnteroPositivo,
  /** `filas × columnas` índices de material. */
  celdas: z.array(z.array(EnteroNoNegativo)),
  /** Globos que no ocupan una posición del racimo (el centro de una flor). */
  extras: z.array(z.object({ fila: EnteroNoNegativo, material: EnteroNoNegativo }).strict()),
  /**
   * Los globos de UNA instancia sobre la silueta real de la pieza, del fondo al
   * frente (ADR-0028 decisión 5: derivado, fuera del snapshot, no toca
   * `plan_hash`). Ausente cuando Python no pudo armar la silueta —tipo sin
   * silueta, una medida que falta, el presupuesto de dibujo— y entonces la
   * gráfica dibuja la rejilla de siempre. Solo geometría: `celdas` y `conteo`
   * siguen siendo los mismos con posiciones o sin ellas.
   */
  posiciones: z.array(PosicionSiluetaSchema).max(MAX_POSICIONES_SILUETA).optional(),
  /**
   * Por qué NO hay `posiciones`. Presente exactamente cuando faltan: las dos
   * juntas serían un croquis que además se excusa, y ninguna de las dos es un
   * plan sin patrón resuelto. Dibujo, como `posiciones`: no entra en el
   * snapshot ni en `plan_hash`.
   */
  sin_silueta: z.enum(MOTIVOS_SIN_SILUETA).optional(),
  conteo: z.array(z.object({
    material: EnteroNoNegativo,
    color: z.string().nullable(),
    acabado: z.string().nullable(),
    unidades_por_instancia: EnteroNoNegativo,
    unidades_total: EnteroNoNegativo,
  }).strict()),
  /** Filas idénticas consecutivas, 1-based e inclusivas. */
  pasos: z.array(z.object({
    desde: EnteroPositivo,
    hasta: EnteroPositivo,
    celdas: z.array(EnteroNoNegativo),
    extras: z.array(EnteroNoNegativo),
  }).strict()),
  nombre: z.string().min(1),
  descripcion: z.string(),
  instrucciones: z.array(z.string()),
  prompt_gemini: z.string(),
  prompt_lora: z.string(),
  avisos: z.array(z.string()),
}).strict();

export type PatronColorResuelto = z.infer<typeof PatronColorResueltoSchema>;

/**
 * Con qué geometría se DIBUJA un patrón resuelto: `silueta` cuando Python pudo
 * armar el croquis real de la pieza, y los `racimos` o la `rejilla` de siempre
 * cuando no. `geometria` sigue diciendo cómo se leen las FILAS de `celdas` (una
 * pared va en filas, todo lo demás en racimos) porque de eso viven la gráfica
 * numerada, la hoja de armado y las etiquetas del editor; la silueta solo cambia
 * el dibujo, así que no puede pisar ese dato. Un solo dueño de la decisión.
 */
export type GeometriaDibujoPatron = PatronColorResuelto["geometria"] | "silueta";

export function geometriaDeDibujo(
  resuelto: Pick<PatronColorResuelto, "geometria" | "posiciones">,
): GeometriaDibujoPatron {
  return resuelto.posiciones && resuelto.posiciones.length > 0 ? "silueta" : resuelto.geometria;
}

/**
 * Un estilo que el editor puede ofrecer para una estructura, con sus
 * direcciones y si admite espejo. Lo decide Python (`modos_admitidos` de la
 * vista previa, ADR-0028 §10): la interfaz no repite esas reglas.
 */
export const ModoAdmitidoSchema = z.object({
  modo: z.enum(MODOS_PATRON_COLOR),
  direcciones: z.array(z.enum(DIRECCIONES_PATRON_COLOR)).min(1),
  espejo: z.boolean(),
}).strict();

export type ModoAdmitido = z.infer<typeof ModoAdmitidoSchema>;

/** Pista de patrón leída en la foto de referencia (ADR-0028 §7). */
export const PistaPatronSchema = z.object({
  referencia_element_id: z.string().trim().min(1).max(80),
  modo: z.enum(MODOS_PATRON_COLOR),
  colores: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  globos_por_racimo: z.number().int().min(1).max(8).optional(),
  pesos: z.array(z.number().int().min(1).max(100)).max(12).optional(),
  /**
   * Manchas leídas en la foto cuando `modo` es `zonas` (ADR-0036): el color va
   * por NOMBRE de catálogo, como `colores`, porque quien lee la foto no conoce
   * los índices de `materiales` de la pieza; Python los resuelve con la misma
   * tabla de tonos (`material_de_color`). `colores[0]` es el fondo.
   */
  zonas: z.array(z.object({
    color: z.string().trim().min(1).max(80),
    ancla: z.enum(ANCLAS_ZONA),
    extension: z.number().int().min(1).max(EXTENSION_ZONA_MAXIMA),
  }).strict()).max(ZONAS_MAXIMAS).optional(),
  /**
   * Colores que aparecen **salpicados sobre las secciones** en vez de ocupar una: las burbujas cristal de un
   * arco orgánico, los cromados sueltos, un dorado que asoma cada tantos globos. Por NOMBRE de catálogo, como
   * `colores`.
   *
   * Un color así no es una sección y no cabe en `colores`: nombrarlo allí lo convierte en un tramo que la
   * foto no tiene, y dejarlo fuera lo borra del dibujo. El motor orgánico ya sabe armarlos —son sus
   * **acentos**, «globos sueltos que no se tocan entre sí» (`organico/motor.py`)—, así que lo único que
   * faltaba era que la lectura pudiera decir cuáles son.
   */
  motas: z.array(z.string().trim().min(1).max(80)).max(4).optional(),
  /**
   * Por qué eje recorre el patrón la pieza, cuando se ve (ADR-0039). Sin esto,
   * un degradé leído en una pared salía siempre `longitudinal` aunque en la foto
   * baje de lado a lado o en diagonal, y el ombré del motor arrancaba siempre a
   * lo largo del arco.
   *
   * Quien la lee no sabe qué direcciones admite la pieza: eso lo decide
   * `patron_color` con la misma tabla que publica `modos_admitidos`, y una que
   * no admita se descarta sin tumbar la lectura.
   */
  direccion: z.enum(DIRECCIONES_PATRON_COLOR).optional(),
  /**
   * Que las dos mitades de la pieza sean iguales, reflejadas (ADR-0039): las dos
   * patas de un arco desde la clave, los dos extremos de una guirnalda en U
   * desde el centro. Solo se conserva donde la pieza lo admite (`_admite_espejo`).
   */
  simetria: z.literal("espejo").optional(),
  confianza: z.number().min(0).max(1),
}).strict();

export type PistaPatron = z.infer<typeof PistaPatronSchema>;

/**
 * Los tamaños que la foto leyó en una pieza, con su propia pista y **no dentro de `PistaPatronSchema`**.
 *
 * Por lo mismo que el remate de la columna tiene la suya: un tamaño no es una disposición de color. Puesto
 * dentro de la pista de patrón no habría llegado nunca al caso que lo motivó —una columna dorada de un solo
 * color no deja patrón (`patronDePista` devuelve `undefined` en `monocromo`), así que no deja pista—, y los
 * tamaños de esa columna son justo los que había que leer.
 */
export const PistaTamanosSchema = z.object({
  referencia_element_id: z.string().trim().min(1).max(80),
  tamanos: z.enum(TAMANOS_LEIDOS),
  confianza: z.number().min(0).max(1),
}).strict();

export type PistaTamanos = z.infer<typeof PistaTamanosSchema>;
