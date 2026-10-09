/**
 * Las frases «No pude: …» que el cliente lee cuando un cambio del plan 3D no se hace (REQ-007, fase 5). Sin `server-only`:
 * las usan el servidor (la ruta) y el navegador (la vista), que las muestran tal cual. Lo que el motor dice por dentro
 * (códigos de formato, «armado», «paleta», nombres de lista de materiales) se traduce aquí a palabras de cliente; el motivo
 * técnico queda en la auditoría, no en la respuesta.
 */
import { PREFIJO_NO_PUDE } from "@/lib/globos3d/motor/prefijo-no-pude";

export { PREFIJO_NO_PUDE };

const mayuscula = (texto: string): string => texto.charAt(0).toLocaleUpperCase("es") + texto.slice(1);

/** Une las razones de un cambio que no se hizo (cada una ya dicha por el servidor) en una sola frase para el cliente. */
export function unirNoPude(frases: readonly string[]): string {
  return frases.map((frase, indice) => (indice === 0 ? frase : mayuscula(frase.replace(PREFIJO_NO_PUDE, "")))).join(" ");
}

const REGLAS_MOTIVO: ReadonlyArray<readonly [RegExp, string]> = [
  [/tope|pasa de/i, "esa pieza quedaría demasiado grande para el plan; prueba con un tamaño menor"],
  [/color|paleta|fabric|tienda|cobertura/i, "ese color no se puede armar en esa pieza; prueba con otro color"],
  [/medida|metro|diámetro|\balto\b|\bancho\b|\blargo\b/i, "esa medida no se puede armar; prueba con otra"],
];
const MOTIVO_GENERICO = "esa pieza no se puede armar con ese cambio";

/** El motivo técnico que dice el motor, en palabras del cliente (sin la frase «No pude»). Lo desconocido cae al genérico. */
export function motivoParaCliente(motivoTecnico: string): string {
  return REGLAS_MOTIVO.find(([patron]) => patron.test(motivoTecnico))?.[1] ?? MOTIVO_GENERICO;
}

/** La frase «No pude: …» de una lista de motivos técnicos: cada uno en palabras de cliente, sin repetir. */
export function noPudeDeMotivos(motivosTecnicos: readonly string[]): string {
  const frases = [...new Set(motivosTecnicos.map(motivoParaCliente))];
  return `${PREFIJO_NO_PUDE}${frases.join("; ")}.`;
}
