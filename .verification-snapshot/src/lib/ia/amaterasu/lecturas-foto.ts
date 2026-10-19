import "server-only";
import type { ImagenEtiquetada } from "@/lib/ia/nucleo/tipos";
import type { ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { reclasificarColumnasConGuirnalda, reubicarGuirnaldas } from "@/lib/ia/referencia/reference-structure";
import { conArmadosDe, leerArmadosReferencia } from "./bouquet-referencia";
import { conConteosDe, leerConteosReferencia } from "./conteo-referencia";
import { conGuirnaldasDe, leerGuirnaldasReferencia } from "./guirnalda-referencia";
import { detectarPatronesReferencia } from "./patron-referencia";

/**
 * Las lecturas de la foto que corren después del análisis de Amaterasu, en
 * paralelo y con el mismo vencimiento: patrón de color (ADR-0028 §11), armado
 * del bouquet (ADR-0030), conteo de globos (ADR-0031) y armado de la guirnalda
 * (ADR-0032, E4). Cada una parte del blueprint del análisis y devuelve su
 * copia; aquí se juntan por elemento.
 *
 * Una lectura apagada no llama a Python ni toca el blueprint. Ninguna rompe el
 * análisis: un fallo deja el blueprint sin esa lectura y queda en el registro
 * con los ids de la petición. Con la de guirnaldas encendida, la ubicación de
 * cada guirnalda se refina después con su lectura y los muebles de la foto
 * (`reubicarGuirnaldas`); apagada, el blueprint es el de siempre.
 */

export type BanderasLecturasFoto = {
  patron: boolean;
  bouquet: boolean;
  conteo: boolean;
  /** Opcional: ausente es apagada (ADR-0032, E4). */
  guirnalda?: boolean;
};

export type ContextoLecturasFoto = {
  requestId: string;
  correlationId: string;
  signal?: AbortSignal;
  /** Epoch ms en que la ruta tiene que haber respondido; acota el deadline de cada lectura. */
  vencimiento?: number;
  /** "Reintentar" de la UI (`sin_cache`): ninguna lectura reutiliza una guardada. */
  sinCache?: boolean;
};

export async function leerLecturasDeFoto(
  blueprint: ReferenceBlueprintV2,
  referencias: readonly ImagenEtiquetada[],
  contexto: ContextoLecturasFoto,
  banderas: BanderasLecturasFoto,
): Promise<ReferenceBlueprintV2> {
  const [conPatron, conArmado, conConteo, conGuirnalda] = await Promise.all([
    banderas.patron ? detectarPatronesReferencia(blueprint, referencias, contexto) : blueprint,
    banderas.bouquet ? leerArmadosReferencia(blueprint, referencias, contexto) : blueprint,
    banderas.conteo ? leerConteosReferencia(blueprint, referencias, contexto) : blueprint,
    banderas.guirnalda ? leerGuirnaldasReferencia(blueprint, referencias, contexto) : blueprint,
  ]);
  const conLecturas = conArmadosDe(conPatron, conArmado);
  const conConteos = banderas.conteo ? conConteosDe(conLecturas, conConteo) : conLecturas;
  return banderas.guirnalda ? reubicarGuirnaldas(reclasificarColumnasConGuirnalda(conGuirnaldasDe(conConteos, conGuirnalda))) : conConteos;
}
