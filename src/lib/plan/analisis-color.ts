import { z } from "zod";

/**
 * La forma del análisis de color de una foto de referencia: los colores de cada pieza, cruzados con una
 * referencia del catálogo Sempertex y su Pantone.
 *
 * Vive aparte de quien lo calcula (`src/lib/ia/amaterasu/color-sempertex.ts`) porque eso toca `sharp` y la
 * pantalla no puede arrastrar `sharp` al navegador. Aquí solo está el contrato, puro, y lo validan los dos
 * lados: el servidor al armarlo y el cliente al recibirlo.
 *
 * **No es un contrato de dominio.** Viaja fuera del blueprint, no se exporta a Python, no se firma en el
 * `plan_hash` y nadie compra nada con él: hoy es un bloque que se mira. El día que el color medido tenga que
 * decidir qué se compra, esto pasa a `reference-blueprint.ts` con su versión y su esquema exportado.
 */

export const ANALISIS_COLOR_VERSION = "analisis-color-sempertex.v1" as const;

const HEX = /^#[0-9a-f]{6}$/;

export const CandidataColorSchema = z
  .object({
    codigo: z.string().regex(/^[0-9]{3}$/),
    nombre: z.string().min(1).max(60),
    /** El nombre con el que se pide: la familia delante («Reflex Dorado»). */
    nombreCompleto: z.string().min(1).max(80),
    nombreEn: z.string().min(1).max(60),
    /** El Pantone con el que se fabrica. `null` en las referencias que no lo llevan (blancos y negros). */
    pms: z.string().min(1).max(20).nullable(),
    acabado: z.string().min(1).max(40),
    /** El color del globo inflado con el que se comparó, que es contra lo que se cruza. */
    hexGlobo: z.string().regex(HEX),
    /** Distancia CIELAB directa: se informa, pero no es la que ordena. */
    deltaE: z.number().min(0),
    /** La que ordena: pesa el tono y perdona la pérdida de croma que la sombra provoca siempre. */
    distancia: z.number().min(0),
    /** Separación de tono en grados: el número fiable (mediana de 3° en una foto real). */
    tono: z.number().min(0).max(180),
    /** Croma medido entre croma del globo: por debajo de 1 es sombra; muy por encima, un error. */
    razonCroma: z.number().min(0),
  })
  .strict();

export const CruceColorSchema = z
  .object({
    hex: z.string().regex(HEX),
    candidatas: z.array(CandidataColorSchema).min(1).max(5),
    /** La primera la nombró el analizador con el nombre exacto de esa referencia, y los píxeles no la desmienten. */
    porNombre: z.boolean(),
    /** Un color sin croma: no se identifica por tono, solo por claridad. */
    neutro: z.boolean(),
    /** Las dos primeras están tan juntas que la foto no permite elegir. */
    ambigua: z.boolean(),
    /** Ninguna referencia se parece lo bastante: ese color no es de un globo (sombra, mueble o fondo). */
    sinReferencia: z.boolean(),
    /**
     * Las familias a las que se restringió por el acabado que el analizador escribió («chrome gold»). Vacío =
     * no dijo el acabado y no se restringió, que es cuando un cromado se confunde con un mate.
     */
    familias: z.array(z.string().min(1).max(20)).max(4),
  })
  .strict();

export const ColorConReferenciaSchema = z
  .object({
    hex: z.string().regex(HEX),
    /** Parte de la zona medida que ocupa, de 0 a 1. */
    parte: z.number().min(0).max(1),
    pixeles: z.number().int().nonnegative(),
    cruce: CruceColorSchema,
  })
  .strict();

export const ColorDePiezaSchema = z
  .object({
    elementId: z.string().min(1).max(80),
    /** El tipo de estructura del plan con el que se eligió la forma del croquis. */
    tipo: z.string().max(40),
    croquis: z.object({ forma: z.string().min(1).max(60), parteDeLaCaja: z.number().min(0).max(1) }).strict(),
    pixeles: z.object({ medidos: z.number().int().nonnegative(), deLaCaja: z.number().int().nonnegative() }).strict(),
    colores: z.array(ColorConReferenciaSchema).max(5),
    avisos: z.array(z.string().min(1).max(200)).max(6),
  })
  .strict();

export const AnalisisColorSempertexSchema = z
  .object({
    version: z.literal(ANALISIS_COLOR_VERSION),
    piezas: z.array(ColorDePiezaSchema).max(16),
  })
  .strict();

export type CandidataColor = z.infer<typeof CandidataColorSchema>;
export type CruceColorMedido = z.infer<typeof CruceColorSchema>;
export type ColorConReferencia = z.infer<typeof ColorConReferenciaSchema>;
export type ColorDePieza = z.infer<typeof ColorDePiezaSchema>;
export type AnalisisColorSempertex = z.infer<typeof AnalisisColorSempertexSchema>;

/** Lo que llegó del servidor, o `null` si no vino o no cuadra. Nunca lanza: es un añadido, no el análisis. */
export function leerAnalisisColor(valor: unknown): AnalisisColorSempertex | null {
  const leido = AnalisisColorSempertexSchema.safeParse(valor);
  return leido.success ? leido.data : null;
}

/**
 * Los colores del catálogo que se vieron en la foto, para enseñárselos al cliente.
 *
 * Reemplazan a las palabras genéricas del analizador («rojo metalizado», «gris»): aquí cada chip es una
 * **referencia que existe y se puede comprar**, con su código, su nombre comercial y el color del globo real.
 * Se juntan las piezas —un mismo dorado en tres piezas es un dorado— y se ordenan por cuánto ocupan.
 */
export type ColorCanonico = {
  codigo: string;
  /** El nombre con el que se pide el globo: familia y color, como en la tienda («Reflex Dorado»). */
  nombre: string;
  acabado: string;
  pms: string | null;
  /** El color del globo inflado: el que se parece a lo que el cliente va a recibir. */
  hexGlobo: string;
  /** Parte de lo medido que ocupa, sumando todas las piezas donde aparece. */
  parte: number;
};

export function coloresCanonicos(
  analisis: AnalisisColorSempertex | null,
  maximo = 6,
): ColorCanonico[] {
  if (!analisis) return [];
  const porCodigo = new Map<string, ColorCanonico>();
  for (const pieza of analisis.piezas) {
    for (const color of pieza.colores) {
      const mejor = color.cruce.candidatas[0];
      if (!mejor) continue;
      const previo = porCodigo.get(mejor.codigo);
      if (previo) {
        previo.parte = Math.round((previo.parte + color.parte) * 1e4) / 1e4;
        continue;
      }
      porCodigo.set(mejor.codigo, {
        codigo: mejor.codigo,
        nombre: mejor.nombreCompleto,
        acabado: mejor.acabado,
        pms: mejor.pms,
        hexGlobo: mejor.hexGlobo,
        parte: color.parte,
      });
    }
  }
  return [...porCodigo.values()].sort((a, b) => b.parte - a.parte).slice(0, maximo);
}
