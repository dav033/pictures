import type { LecturaFoto } from "./lectura-foto";
import { escalaDeGlobos, mezclaConMuestras } from "./mezcla-lectura";

/**
 * **La lectura de la IA, medida con lo que mide bien.** El lector escribe a ojo la escala de la foto y los diámetros de
 * los globos, y en los dos se equivoca (en un arco de Pinterest dijo que la imagen medía 280 cm cuando eran ~400 y vio los
 * globos 1,5 veces más grandes): la guirnalda salía con la mitad de los globos. Las cajas de globos sueltos (`muestras`)
 * y el formato que nombra para cada escalón sí son fiables, así que aquí, sin modelo:
 * - los diámetros de cada escalón salen de sus cajas;
 * - la escala sale de los propios globos (el diámetro real del formato entre lo que mide en la foto), si se aparta más
 *   de un 15 % de la escrita. Así el cuerpo y los globos quedan en la proporción de la foto, que es lo que se ve.
 * Una lectura sin formatos ni cajas (las hechas a mano) queda igual. Aplicarla dos veces no cambia nada.
 */
const DESVIO_TOLERADO = 0.15;

export function ajustarLectura(l: LecturaFoto): { lectura: LecturaFoto; notas: string[] } {
  const notas: string[] = [];
  const piezas = l.piezas.map((p) => ("mezcla" in p && p.mezcla ? { ...p, mezcla: mezclaConMuestras(p.mezcla, l.aspecto) } : p));
  const escalas = piezas.flatMap((p) => ("mezcla" in p ? [escalaDeGlobos(p.mezcla)] : [])).filter((e): e is number => e !== null).sort((a, b) => a - b);
  let escala = l.escala;
  if (escalas.length) {
    const deGlobos = Math.min(1500, Math.max(60, Math.round(escalas[Math.floor(escalas.length / 2)]!)));
    if (Math.abs(deGlobos - l.escala.altoImagenCm) / l.escala.altoImagenCm > DESVIO_TOLERADO) {
      notas.push(`La escala escrita (${l.escala.altoImagenCm} cm) no cuadra con los globos medidos: va ${deGlobos} cm, la que dan los globos.`);
      escala = { altoImagenCm: deGlobos, referencia: `${l.escala.referencia} · corregida por los globos`.slice(0, 80) };
    }
  }
  return { lectura: { ...l, escala, piezas }, notas };
}
