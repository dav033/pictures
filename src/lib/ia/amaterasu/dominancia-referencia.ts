import { medirDominanciaElemento, type MuestraPixeles } from "@/lib/plan/dominancia-color";
import { decodificarPixeles } from "./decodificar-pixeles";
import type { ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import type { ImagenEtiquetada } from "@/lib/ia/nucleo/tipos";

/**
 * Rellena `appearance.measured_colors` de cada elemento del blueprint midiendo
 * los píxeles de su caja.
 *
 * Va aquí y no dentro de `buildBlueprint` porque decodificar imágenes es
 * asíncrono y toca `sharp`, mientras que el ensamblaje del blueprint es
 * síncrono y no depende de nada externo. Separarlos mantiene `buildBlueprint`
 * comprobable sin píxeles.
 *
 * Nunca falla el análisis: si una imagen no se puede decodificar, ese elemento
 * se queda sin medida y el camino de color vuelve a las etiquetas del
 * analizador, que es lo que hacía antes. Una medida ausente es peor que una
 * medida, pero mucho mejor que un análisis caído.
 */
export async function enriquecerConDominancia(blueprint: ReferenceBlueprintV2, imagenes: readonly ImagenEtiquetada[]): Promise<ReferenceBlueprintV2> {
  const porImagen = new Map<string, MuestraPixeles>();
  for (const imagen of imagenes) {
    // Una sola decodificación por foto aunque tenga ocho elementos.
    if (porImagen.has(imagen.id)) continue;
    try {
      porImagen.set(imagen.id, await decodificarPixeles(Buffer.from(imagen.base64, "base64")));
    } catch (error) {
      console.warn("[dominancia] no se pudo decodificar una referencia", { image_id: imagen.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (porImagen.size === 0) return blueprint;

  return {
    ...blueprint,
    elements: blueprint.elements.map((elemento) => {
      const muestra = porImagen.get(elemento.source_image_id);
      if (!muestra) return elemento;
      const medicion = medirDominanciaElemento(muestra, elemento.reference_bbox);
      if (medicion.dominantes.length === 0) return elemento;
      return {
        ...elemento,
        appearance: {
          ...elemento.appearance,
          measured_colors: medicion.dominantes.slice(0, 12).map((entrada) => ({ color: entrada.color, share: Number(entrada.participacion.toFixed(4)) })),
        },
      };
    }),
  };
}
