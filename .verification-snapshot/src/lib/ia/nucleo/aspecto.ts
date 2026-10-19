import type { PeticionImagen } from "./tipos";

/** Los lienzos que genera el proveedor de imagen, con su proporción ancho/alto. */
export const ASPECTOS_SOPORTADOS: { valor: PeticionImagen["aspecto"]; razon: number }[] = [
  { valor: "3:2", razon: 3 / 2 },
  { valor: "1:1", razon: 1 },
  { valor: "2:3", razon: 2 / 3 },
  { valor: "16:9", razon: 16 / 9 },
];

/** El lienzo soportado más parecido a una proporción ancho/alto (distancia en escala logarítmica). */
export function aspectoMasCercano(razon: number): PeticionImagen["aspecto"] {
  let mejor = ASPECTOS_SOPORTADOS[0]!;
  let mejorDistancia = Infinity;
  for (const candidato of ASPECTOS_SOPORTADOS) {
    const distancia = Math.abs(Math.log(razon / candidato.razon));
    if (distancia < mejorDistancia) {
      mejorDistancia = distancia;
      mejor = candidato;
    }
  }
  return mejor.valor;
}

/**
 * El lienzo de una propuesta hecha desde fotos de referencia (2026-10-06).
 *
 * Sin foto del espacio la app no manda aspecto y el servidor generaba siempre 3:2. Una columna en una foto
 * vertical quedaba sola en el centro de un lienzo apaisado y FLUX llenaba los lados con ramos de globos que nadie
 * compró (CASE-001, las tres imágenes). Con UNA foto de referencia cuya proporción se midió
 * (`source_images[].aspect_ratio`), el lienzo es el soportado más parecido a ella. Con varias fotos, o sin
 * medida, `undefined`: el llamador sigue con su valor por defecto.
 */
export function aspectoDeLaReferencia(blueprint: { source_images?: ReadonlyArray<{ aspect_ratio?: number }> } | undefined): PeticionImagen["aspecto"] | undefined {
  const fotos = blueprint?.source_images ?? [];
  const razon = fotos.length === 1 ? fotos[0]!.aspect_ratio : undefined;
  return razon !== undefined && razon > 0 ? aspectoMasCercano(razon) : undefined;
}
