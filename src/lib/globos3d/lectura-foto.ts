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
 *
 * El esquema casi no lleva `describe`: lo que significa cada campo lo dice el prompt de la lectura
 * (`prompt-lectura-foto.ts`, una sola vez), porque el esquema que se manda a Gemini tiene un tope de tamaño y de valores de
 * enumeración (`test-esquema-gemini.ts` lo vigila): repetir la explicación de un color en cada una de las 10 variantes de pieza
 * pesaba 4 KB.
 */

const Fraccion = z.number().min(-0.2).max(1.2);
const Tamano = z.number().min(0.005).max(2);

export const ColorLeidoSchema = z.object({
  nombre: z.string().min(2).max(40),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  peso: z.number().min(0).max(100),
  acabado: z.enum(["mate", "brillante", "cromado", "perla", "cristal", "confeti"]),
});
export type ColorLeido = z.infer<typeof ColorLeidoSchema>;

const Tamanos = z.object({
  "R-36": z.number().min(0).max(100), "R-24": z.number().min(0).max(100), "R-18": z.number().min(0).max(100),
  "R-12": z.number().min(0).max(100), "R-9": z.number().min(0).max(100), "R-5": z.number().min(0).max(100),
}).partial();

const FormatoRedondo = z.enum(["R-36", "R-24", "R-18", "R-12", "R-9", "R-5"]);

/**
 * La mezcla de tamaños medida en la foto, por escalones y con el diámetro que tiene cada uno en la imagen: es lo que el
 * compilador usa (por encima de `tamanos`) para elegir los formatos con la escala de la foto. Sin ella, `tamanos`.
 */
export const MezclaLeidaSchema = z.object({
  gigantes: z.number().min(0).max(100).optional(),
  grandes: z.number().min(0).max(100),
  medianos: z.number().min(0).max(100),
  chicos: z.number().min(0).max(100),
  diametroGigante: Tamano.optional(),
  diametroGrande: Tamano,
  diametroMediano: Tamano.optional(),
  diametroChico: Tamano.optional(),
  formatoGigante: FormatoRedondo.optional(),
  formatoGrande: FormatoRedondo.optional(),
  formatoMediano: FormatoRedondo.optional(),
  formatoChico: FormatoRedondo.optional(),
});
export type MezclaLeida = z.infer<typeof MezclaLeidaSchema>;

/** El reparto de un tramo, cuando no es el de toda la pieza (los escalones son los de la `mezcla` de la pieza). */
export const MezclaTramoSchema = z.object({
  gigantes: z.number().min(0).max(100).optional(), grandes: z.number().min(0).max(100), medianos: z.number().min(0).max(100), chicos: z.number().min(0).max(100),
});
export type MezclaTramo = z.infer<typeof MezclaTramoSchema>;

const Punto = z.object({
  x: Fraccion, y: Fraccion, grosor: Tamano,
  mezcla: MezclaTramoSchema.optional(),
  dominante: z.string().max(40).optional(),
});

const ESCALONES_LEIDOS = ["gigantes", "grandes", "medianos", "chicos"] as const;

/** Un globo grande o gigante de la foto, uno por uno: va fijo en ese sitio y con ese color (lo mide la detección). */
export const AnclaLeidaSchema = z.object({
  x: Fraccion, y: Fraccion, escalon: z.enum(["gigantes", "grandes"]), color: z.string().min(1).max(60),
  diametro: Tamano.optional(),
});
export type AnclaLeida = z.infer<typeof AnclaLeidaSchema>;
/** Los colores de un escalón cuando no son los de toda la pieza («los gigantes dorados, los chicos dorados»). */
export const ColoresEscalonSchema = z.object({
  escalon: z.enum(ESCALONES_LEIDOS),
  pesos: z.array(z.number().min(0).max(100)).min(1).max(6),
});
export type ColoresEscalon = z.infer<typeof ColoresEscalonSchema>;

const Comun = {
  colores: z.array(ColorLeidoSchema).min(1).max(6),
  nota: z.string().max(200).optional(),
};

export const PiezaLeidaSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("guirnalda_organica"),
    puntos: z.array(Punto).min(2).max(24),
    tamanos: Tamanos, mezcla: MezclaLeidaSchema.optional(), racimos: z.number().min(0).max(1),
    coloresPorEscalon: z.array(ColoresEscalonSchema).max(4).optional(),
    anclas: z.array(AnclaLeidaSchema).max(80).optional(),
    follaje: z.array(z.string().max(30)).max(4).optional(),
    ...Comun,
  }),
  z.object({
    tipo: z.literal("columna_organica"),
    forma: z.enum(["recta", "racimos", "s", "inclinada"]),
    x: Fraccion, yBase: Fraccion, yArriba: Fraccion, ancho: Tamano, grosor: Tamano,
    tamanos: Tamanos, mezcla: MezclaLeidaSchema.optional(), racimos: z.number().min(0).max(1), ...Comun,
  }),
  z.object({
    tipo: z.literal("racimo_piso"),
    x: Fraccion, yPie: Fraccion, yArriba: Fraccion, ancho: Tamano,
    tamanos: Tamanos, mezcla: MezclaLeidaSchema.optional(), racimos: z.number().min(0).max(1),
    coloresPorEscalon: z.array(ColoresEscalonSchema).max(4).optional(), ...Comun,
  }),
  z.object({
    tipo: z.literal("columna_clasica"),
    x: Fraccion, yBase: Fraccion, yArriba: Fraccion,
    ...Comun, colores: z.array(ColorLeidoSchema).min(1).max(4),
  }),
  z.object({
    tipo: z.literal("guirnalda_clasica"),
    x1: Fraccion, x2: Fraccion, y: Fraccion, caida: Tamano.optional(), ...Comun,
  }),
  z.object({
    tipo: z.literal("globo"),
    x: Fraccion, y: Fraccion, diametro: Tamano, en: z.enum(["piso", "aire"]), ...Comun,
  }),
  z.object({
    tipo: z.literal("ramo_helio"),
    x: Fraccion, yBase: Fraccion, yArriba: Fraccion, cantidad: z.number().int().min(2).max(20), ...Comun,
  }),
  z.object({
    tipo: z.literal("decoracion"),
    id: z.enum(RACIMOS_PREDEFINIDOS.map((r) => r.id) as [string, ...string[]]),
    x: Fraccion, y: Fraccion, cantidad: z.number().int().min(1).max(12), ...Comun,
  }),
  z.object({
    tipo: z.literal("metalizado"),
    texto: z.string().min(1).max(16), cursiva: z.boolean(), x: Fraccion, y: Fraccion, alto: Tamano, ...Comun,
  }),
  z.object({
    tipo: z.literal("fondo"),
    id: z.enum(FONDOS_CATALOGO.map((f) => f.id) as [string, ...string[]]),
    x: Fraccion, yBase: Fraccion, ancho: Tamano, alto: Tamano, texto: z.string().max(30).optional(), ...Comun,
  }),
  z.object({
    tipo: z.literal("otro"),
    descripcion: z.string().min(2).max(120),
  }),
]);
export type PiezaLeida = z.infer<typeof PiezaLeidaSchema>;

export const LecturaFotoSchema = z.object({
  resumen: z.string().min(5).max(300),
  aspecto: z.number().min(0.3).max(3),
  escala: z.object({
    altoImagenCm: z.number().min(60).max(1500),
    referencia: z.string().max(80),
  }),
  pisoY: z.number().min(0).max(2).nullable(),
  sala: z.object({ pared: z.string().regex(/^#[0-9a-fA-F]{6}$/), piso: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  piezas: z.array(PiezaLeidaSchema).min(1).max(30),
});
export type LecturaFoto = z.infer<typeof LecturaFotoSchema>;

/** El JSON Schema de la lectura (para `responseJsonSchema` de Gemini). */
export const ESQUEMA_LECTURA_FOTO = z.toJSONSchema(LecturaFotoSchema, { target: "draft-7" });
