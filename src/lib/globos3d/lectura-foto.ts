import { z } from "zod";
import { FONDOS_CATALOGO } from "./fondos-escenografia";
import { RACIMOS_PREDEFINIDOS } from "./racimos-globos";

/**
 * **Lectura de una foto de decoración** (Pinterest, Instagram, una foto del cliente): lo que hay en ella, dicho con las
 * piezas que el taller sabe armar, en coordenadas de la IMAGEN. La escribe Gemini mirando la foto (solo lee: nunca
 * genera imágenes) o una persona a mano (las fotos de referencia del dueño); `compilar-lectura.ts` la convierte en una
 * escena sin ningún modelo de por medio, así que lo que sale se puede probar y corregir.
 *
 * Coordenadas: `x` de 0 (borde izquierdo) a 1 (derecho), `y` de 0 (arriba) a 1 (abajo). Los tamaños (grosor, ancho,
 * diámetro, alto) van en FRACCIÓN DEL ALTO de la imagen. La escala la da `escala.altoImagenCm` (cuántos cm de la
 * realidad mide de alto la imagen a la distancia de la decoración, estimado con lo que tiene medida conocida: una
 * mesa de 75 cm, una puerta de 200 cm, un globo de 12" de 30 cm) y `pisoY`, la línea del piso bajo la decoración.
 */

const Fraccion = z.number().min(-0.2).max(1.2);
const Tamano = z.number().min(0.005).max(2);

export const ColorLeidoSchema = z.object({
  nombre: z.string().min(2).max(40).describe("color en español o inglés, como lo diría un decorador: «azul marino», «dorado», «blush», «verde esmeralda», «blanco perla»"),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe("el color medido en la foto, en la parte iluminada del globo"),
  peso: z.number().min(0).max(100).describe("cuánto se ve de este color en la pieza (los pesos de una pieza suman ~100)"),
  acabado: z.enum(["mate", "brillante", "cromado", "perla", "cristal", "confeti"]).describe("mate/brillante = látex normal; cromado = espejo (Reflex); perla = satinado (Silk); cristal = transparente; confeti = transparente con confeti"),
});
export type ColorLeido = z.infer<typeof ColorLeidoSchema>;

const Tamanos = z.object({
  "R-36": z.number().min(0).max(100), "R-24": z.number().min(0).max(100), "R-18": z.number().min(0).max(100),
  "R-12": z.number().min(0).max(100), "R-9": z.number().min(0).max(100), "R-5": z.number().min(0).max(100),
}).partial().describe("cuántos globos de cada tamaño, en proporción (los grandes de 36\"/24\" que resaltan, los de 12\" de base, los chiquitos de 5\")");

/**
 * La mezcla de tamaños medida en la foto, por tres escalones y con el diámetro que tiene cada uno en la imagen: es lo que
 * el compilador usa (por encima de `tamanos`) para elegir los formatos con la escala de la foto. Sin ella, `tamanos`.
 */
const FormatoRedondo = z.enum(["R-36", "R-24", "R-18", "R-12", "R-9", "R-5"]);

export const MezclaLeidaSchema = z.object({
  gigantes: z.number().min(0).max(100).optional().describe("% de los globos que son GIGANTES (36\", los que dominan el arco; 0 o sin poner si no hay)"),
  grandes: z.number().min(0).max(100).describe("% de los globos de esta pieza que son de los grandes (18\" o 24\", los que resaltan sin ser gigantes)"),
  medianos: z.number().min(0).max(100).describe("% de los globos medianos (la base: 10\"–12\")"),
  chicos: z.number().min(0).max(100).describe("% de los globos chicos (5\", los puntitos y racimitos)"),
  diametroGigante: Tamano.optional().describe("diámetro de uno de los gigantes, en fracción del ALTO de la imagen"),
  diametroGrande: Tamano.describe("diámetro de uno de los globos grandes, en fracción del ALTO de la imagen (mídelo en la foto)"),
  diametroMediano: Tamano.optional().describe("diámetro de uno mediano, en fracción del alto de la imagen"),
  diametroChico: Tamano.optional().describe("diámetro de uno chico, en fracción del alto de la imagen"),
  formatoGigante: FormatoRedondo.optional().describe("formato de los gigantes (casi siempre R-36)"),
  formatoGrande: FormatoRedondo.optional().describe("formato de los grandes: R-24 o R-18, por proporción con los medianos (R-24 ≈ 2 medianos de 12\" de ancho, R-18 ≈ 1,5)"),
  formatoMediano: FormatoRedondo.optional().describe("formato de los medianos: R-12 (o R-9 si son muy chicos)"),
  formatoChico: FormatoRedondo.optional().describe("formato de los chicos: R-5 (un R-5 mide menos de la mitad de un R-12)"),
  muestras: z.array(z.object({
    escalon: z.enum(["gigantes", "grandes", "medianos", "chicos"]),
    box_2d: z.array(z.number().int().min(0).max(1000)).length(4).describe("[ymin, xmin, ymax, xmax] normalizado 0-1000"),
  })).max(12).optional().describe("cajas de globos sueltos típicos, 2 o 3 por escalón, de los que están a la altura de la pared (no los del frente en el piso): de ellas se miden los diámetros"),
}).describe("mezcla de tamaños medida en la foto: reparto por escalón (suma ~100), el diámetro de cada uno y su formato");
export type MezclaLeida = z.infer<typeof MezclaLeidaSchema>;

/** El reparto de un tramo, cuando no es el de toda la pieza (los escalones son los de la `mezcla` de la pieza). */
export const MezclaTramoSchema = z.object({
  gigantes: z.number().min(0).max(100).optional(), grandes: z.number().min(0).max(100), medianos: z.number().min(0).max(100), chicos: z.number().min(0).max(100),
}).describe("% por escalón (suma ~100) en ESTE tramo, si se ve distinto del resto: el racimo de gigantes de una pata, la esquina de puros chicos");
export type MezclaTramo = z.infer<typeof MezclaTramoSchema>;

const Punto = z.object({
  x: Fraccion, y: Fraccion, grosor: Tamano.describe("diámetro del cuerpo de globos en ese punto, en fracción del alto de la imagen"),
  mezcla: MezclaTramoSchema.optional(),
  dominante: z.string().max(40).optional().describe("si en este tramo domina un color (el pie casi todo dorado), su nombre tal como va en colores"),
});

const ESCALONES_LEIDOS = ["gigantes", "grandes", "medianos", "chicos"] as const;

/** Un globo grande o gigante de la foto, uno por uno: va fijo en ese sitio y con ese color (lo mide la detección). */
export const AnclaLeidaSchema = z.object({
  x: Fraccion, y: Fraccion, escalon: z.enum(["gigantes", "grandes"]), color: z.string().min(1).max(60).describe("nombre de uno de los colores de la pieza"),
});
export type AnclaLeida = z.infer<typeof AnclaLeidaSchema>;
/** Los colores de un escalón cuando no son los de toda la pieza («los gigantes dorados, los chicos dorados»). */
export const ColoresEscalonSchema = z.object({
  escalon: z.enum(ESCALONES_LEIDOS),
  pesos: z.array(z.number().min(0).max(100)).min(1).max(6).describe("peso de cada color de la pieza en ese escalón, en el mismo orden que colores"),
});
export type ColoresEscalon = z.infer<typeof ColoresEscalonSchema>;

const Comun = {
  colores: z.array(ColorLeidoSchema).min(1).max(6),
  nota: z.string().max(200).optional().describe("lo que no se pudo leer bien o no encaja"),
};

export const PiezaLeidaSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("guirnalda_organica"),
    puntos: z.array(Punto).min(2).max(24).describe("el eje de la guirnalda de un extremo al otro, en orden, con su grosor en cada punto (más grueso donde carga); si un extremo llega al piso, su punto va en el piso"),
    tamanos: Tamanos, mezcla: MezclaLeidaSchema.optional(), racimos: z.number().min(0).max(1).describe("0 = cuerpo parejo, 1 = muy abultado en racimos"),
    coloresPorEscalon: z.array(ColoresEscalonSchema).max(4).optional().describe("si los colores cambian con el tamaño (los gigantes casi todos dorados, los chicos solo dorados): el reparto de colores de cada escalón"),
    anclas: z.array(AnclaLeidaSchema).max(80).optional().describe("los globos grandes y gigantes uno por uno, donde están en la foto (los mide la detección)"),
    follaje: z.array(z.string().max(30)).max(4).optional().describe("hojas y flores de tela entre los globos: monstera, palma, helecho, eucalipto, hoja_seca, rosa, hortensia, gypsophila (con color opcional: «hoja_seca dorada»)"),
    ...Comun,
  }),
  z.object({
    tipo: z.literal("columna_organica"),
    forma: z.enum(["recta", "racimos", "s", "inclinada"]).describe("recta = la silueta de una columna normal; racimos = racimos apilados que se corren de lado; s = ondula; inclinada = se inclina al subir"),
    x: Fraccion.describe("centro de la base"), yBase: Fraccion, yArriba: Fraccion, ancho: Tamano.describe("ancho total de la columna"), grosor: Tamano.describe("diámetro del cuerpo"),
    tamanos: Tamanos, mezcla: MezclaLeidaSchema.optional(), racimos: z.number().min(0).max(1), ...Comun,
  }),
  z.object({
    tipo: z.literal("racimo_piso"),
    x: Fraccion.describe("centro del montón"), yPie: Fraccion.describe("y del borde de abajo del montón (donde toca el piso más cerca de la cámara)"),
    yArriba: Fraccion.describe("y de lo más alto del montón"), ancho: Tamano.describe("ancho del montón en fracción del ALTO de la imagen"),
    tamanos: Tamanos, mezcla: MezclaLeidaSchema.optional(), racimos: z.number().min(0).max(1),
    coloresPorEscalon: z.array(ColoresEscalonSchema).max(4).optional(), ...Comun,
  }).describe("montón de globos apoyado en el PISO por delante de la decoración (el pie de un arco que se abre hacia la cámara, el racimo grande del piso): si su borde de abajo queda más abajo que la línea del piso, está más cerca de la cámara"),
  z.object({
    tipo: z.literal("columna_clasica"),
    x: Fraccion, yBase: Fraccion, yArriba: Fraccion,
    ...Comun, colores: z.array(ColorLeidoSchema).min(1).max(4).describe("en el orden en que se repiten al subir (la base dorada aparte va como otra columna corta)"),
  }),
  z.object({
    tipo: z.literal("guirnalda_clasica"),
    x1: Fraccion, x2: Fraccion, y: Fraccion.describe("altura del eje"), caida: Tamano.optional(), ...Comun,
  }),
  z.object({
    tipo: z.literal("globo"),
    x: Fraccion, y: Fraccion.describe("centro del globo"), diametro: Tamano, en: z.enum(["piso", "aire"]), ...Comun,
  }),
  z.object({
    tipo: z.literal("ramo_helio"),
    x: Fraccion, yBase: Fraccion, yArriba: Fraccion, cantidad: z.number().int().min(2).max(20), ...Comun,
  }),
  z.object({
    tipo: z.literal("decoracion"),
    id: z.enum(RACIMOS_PREDEFINIDOS.map((r) => r.id) as [string, ...string[]]).describe(RACIMOS_PREDEFINIDOS.map((r) => `${r.id}: ${r.descripcion}`).join(" ")),
    x: Fraccion, y: Fraccion, cantidad: z.number().int().min(1).max(12).describe("cuántas iguales hay"), ...Comun,
  }),
  z.object({
    tipo: z.literal("metalizado"),
    texto: z.string().min(1).max(16), cursiva: z.boolean(), x: Fraccion, y: Fraccion.describe("centro"), alto: Tamano, ...Comun,
  }),
  z.object({
    tipo: z.literal("fondo"),
    id: z.enum(FONDOS_CATALOGO.map((f) => f.id) as [string, ...string[]]).describe(FONDOS_CATALOGO.map((f) => `${f.id}: ${f.descripcion}`).join(" ")),
    x: Fraccion.describe("centro"), yBase: Fraccion, ancho: Tamano, alto: Tamano, texto: z.string().max(30).optional().describe("letrero: lo que dice"), ...Comun,
  }),
  z.object({
    tipo: z.literal("otro"),
    descripcion: z.string().min(2).max(120).describe("lo que no es de globos ni del catálogo (torta, dulces, figuras, flores naturales…): no se arma, solo se anota"),
  }),
]);
export type PiezaLeida = z.infer<typeof PiezaLeidaSchema>;

export const LecturaFotoSchema = z.object({
  resumen: z.string().min(5).max(300).describe("qué es la decoración, en una frase"),
  aspecto: z.number().min(0.3).max(3).describe("ancho / alto de la imagen"),
  escala: z.object({
    altoImagenCm: z.number().min(60).max(1500).describe("cuántos cm reales mide de alto la imagen a la distancia de la decoración"),
    referencia: z.string().max(80).describe("con qué se midió: «mesa de 75 cm», «puerta», «globos de 12 pulgadas»…"),
  }),
  pisoY: z.number().min(0).max(2).nullable().describe("y de la línea del piso bajo la decoración; null si no se ve"),
  sala: z.object({ pared: z.string().regex(/^#[0-9a-fA-F]{6}$/), piso: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  piezas: z.array(PiezaLeidaSchema).min(1).max(30),
});
export type LecturaFoto = z.infer<typeof LecturaFotoSchema>;

/** El JSON Schema de la lectura (para `responseJsonSchema` de Gemini). */
export const ESQUEMA_LECTURA_FOTO = z.toJSONSchema(LecturaFotoSchema, { target: "draft-7" });
