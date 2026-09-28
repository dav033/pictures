import "server-only";
import type { ImagenEtiquetada } from "@/lib/ia/nucleo/tipos";
import type { ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { conArmadosDe, leerArmadosReferencia } from "./bouquet-referencia";
import { conConteosDe, leerConteosReferencia } from "./conteo-referencia";
import { detectarPatronesReferencia } from "./patron-referencia";

/**
 * Las lecturas de la foto que corren después del análisis de Amaterasu, en
 * paralelo y con el mismo vencimiento: patrón de color (ADR-0028 §11), armado
 * del bouquet (ADR-0030) y conteo de globos (ADR-0031). Cada una parte del
 * blueprint del análisis y devuelve su copia; aquí se juntan por elemento.
 *
 * Una lectura apagada no llama a Python ni toca el blueprint. Ninguna rompe el
 * análisis: un fallo deja el blueprint sin esa lectura y queda en el registro
 * con los ids de la petición.
 */

export type BanderasLecturasFoto = {
  patron: boolean;
  bouquet: boolean;
  conteo: boolean;
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
  const [conPatron, conArmado, conConteo] = await Promise.all([
    banderas.patron ? detectarPatronesReferencia(blueprint, referencias, contexto) : blueprint,
    banderas.bouquet ? leerArmadosReferencia(blueprint, referencias, contexto) : blueprint,
    banderas.conteo ? leerConteosReferencia(blueprint, referencias, contexto) : blueprint,
  ]);
  const conLecturas = conArmadosDe(conPatron, conArmado);
  return banderas.conteo ? conConteosDe(conLecturas, conConteo) : conLecturas;
}
