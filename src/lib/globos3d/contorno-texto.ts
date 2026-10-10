import { regionDeContorno, type ContornoForma } from "./formas";
import { normalizarTexto } from "./letras";
import { fallar } from "./herramientas-escena-colores";

/** El trazo de un número o una letra relleno de globos mide un cuarto de su alto, entre estos dos valores (cm). */
const GROSOR_TRAZO_CM = [24, 40] as const;

/**
 * El contorno de un número, una letra o una palabra corta para rellenarlo con globos (`forma` con `texto`). `altoCm` es lo que mide de alto
 * lo que se ve (el esqueleto más el grosor del trazo); su ancho sale del texto y no puede pasar de `anchoMaximoCm`, lo que admite una forma.
 * Error claro (de herramienta) si el texto no se dibuja o no cabe.
 */
export function contornoDeTexto(texto: string, altoCm: number, anchoMaximoCm: number): Extract<ContornoForma, { tipo: "texto" }> {
  const grosorCm = Math.max(GROSOR_TRAZO_CM[0], Math.min(GROSOR_TRAZO_CM[1], Math.round(altoCm / 4)));
  const contorno = { tipo: "texto" as const, texto: normalizarTexto(texto.trim()), altoCm: Math.max(10, altoCm - grosorCm), grosorCm };
  let ancho: number;
  try {
    const { caja } = regionDeContorno(contorno);
    ancho = caja.maxX - caja.minX;
  } catch {
    return fallar(`No sé dibujar «${texto}»: usa letras, números o espacios.`);
  }
  if (ancho > anchoMaximoCm) fallar(`«${texto}» a ${altoCm} cm de alto mide ${Math.round(ancho)} cm de ancho y una forma llega a ${anchoMaximoCm} cm: baja alto_cm o escribe menos caracteres.`);
  return contorno;
}
