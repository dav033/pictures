import { dimensionesDeElementos } from "./escala-por-muebles";
import { TELONES_DE_DIAMETRO, entradaDeCatalogo, esTelon } from "./fondos-escenografia";
import type { LecturaFoto, PiezaLeida } from "./lectura-foto";

/**
 * **La escala leída, contrastada con los telones del montaje** (caso del dueño «quince-mesa»): el lector dice con qué midió la escala
 * («panel de lentejuelas y puertas de 220 cm») pero a veces la cuenta no le sale con sus propias piezas (escribió 320 cm con el panel en
 * 0,35 del alto de la foto: 220 / 0,35 ≈ 630) o la tomó de la mesa del primer plano (280 cm). Con la escala corta, la medida con los
 * globos queda topada al doble de ella (`RAZON_MAXIMA_SIN_MUEBLES`) y la guirnalda sale chica y de globos chicos.
 *
 * Los telones de piso del montaje (lentejuelas, arcos chiara, marco con tela, aros, arco metálico, biombo) tienen un alto de catálogo y el
 * lector da su borde de arriba; con la línea del piso, lo que miden en la foto va de ese borde al piso (su pie suele quedar tapado). Su
 * escala es su alto de catálogo entre eso; la de varios, la mediana (la baja con dos). Si los telones dicen al menos `RAZON_CORTA` veces
 * más que la leída, la leída es la que está mal y se toma la suya. Solo se sube: un telón bajo que la foto enseña entero no dice que la
 * leída sea grande (los paneles reales varían de 1,8 a 2,4 m). Pura.
 */

/** Cuántas veces más que la leída tienen que decir los telones para tomar la suya. */
const RAZON_CORTA = 1.6;
/** Un telón que mide menos que esto (fracción del alto de la foto) de arriba al piso está casi todo tapado: no se fía. */
const ALTO_MINIMO = 0.1;
/** Un telón cuyo borde de arriba queda a esto (fracción del alto) del borde de la foto está cortado: no enseña su alto. */
const BORDE_DE_ARRIBA = 0.02;
const ESCALA_MINIMA_CM = 60;
const ESCALA_MAXIMA_CM = 1500;

type Fondo = Extract<PiezaLeida, { tipo: "fondo" }>;

/** El alto real (cm) de una pieza del catálogo: el de sus medidas o el de sus elementos armados. */
export function altoDeCatalogo(id: string): number | null {
  const e = entradaDeCatalogo(id);
  if (!e) return null;
  const alto = e.clase === "mueble" ? e.medidas.altoCm : dimensionesDeElementos(e.elementos()).alto;
  return alto > 0 ? alto : null;
}

/** ¿Un telón de piso del montaje de alto propio (no un panel redondo, que es un diámetro)? */
const esTelonDePiso = (p: PiezaLeida): p is Fondo => {
  if (p.tipo !== "fondo" || !esTelon(p.id) || TELONES_DE_DIAMETRO.has(p.id)) return false;
  const e = entradaDeCatalogo(p.id);
  return e?.lugar === "piso" && e.flotaCm === undefined;
};

/** La escala (cm de alto de la foto) que dan los telones de piso: alto de catálogo entre lo que miden de su borde de arriba al piso. */
export function escalaDeTelones(piezas: readonly PiezaLeida[], pisoY: number | null): number | null {
  // Sin la línea del piso no se sabe cuánto del telón queda tapado abajo; uno cortado por el borde de arriba no enseña su alto.
  if (pisoY === null) return null;
  const escalas = piezas.filter(esTelonDePiso).flatMap((p) => {
    const arriba = p.yBase - p.alto;
    const alto = altoDeCatalogo(p.id);
    const enLaFoto = Math.max(p.alto, pisoY - arriba);
    return alto && arriba > BORDE_DE_ARRIBA && enLaFoto >= ALTO_MINIMO ? [alto / enLaFoto] : [];
  }).sort((a, b) => a - b);
  return escalas.length ? escalas[Math.floor((escalas.length - 1) / 2)]! : null;
}

/** La lectura con la escala de sus telones si la leída se queda corta frente a ellos (y la nota que lo dice). */
export function escalaDelMontaje(l: LecturaFoto): { lectura: LecturaFoto; notas: string[] } {
  const telones = escalaDeTelones(l.piezas, l.pisoY);
  if (telones === null || telones < l.escala.altoImagenCm * RAZON_CORTA) return { lectura: l, notas: [] };
  const altoImagenCm = Math.round(Math.min(ESCALA_MAXIMA_CM, Math.max(ESCALA_MINIMA_CM, telones)));
  return {
    lectura: { ...l, escala: { altoImagenCm, referencia: `telones del fondo (leída ${l.escala.altoImagenCm}: ${l.escala.referencia})`.slice(0, 80) } },
    notas: [`La escala leída (${l.escala.altoImagenCm} cm, «${l.escala.referencia}») no cuadra con los paneles del fondo que leyó: ellos dan ${altoImagenCm} cm de alto de la foto, y se toma esa.`],
  };
}
