import { perezoso } from "@/lib/globos3d/perezoso";
import { idCalificado } from "./ids";
import type { DatoDeClase, EntradaCatalogo, Repositorio } from "./repositorio";
import type { ClaseEntrada, IdRepositorio, ManifiestoRepositorio, Procedencia } from "./tipos";

/**
 * Cómo se arma una entrada y un repositorio a partir de una lista (REQ-013): lo fijo (id, nombre, procedencia) se lee sin armar
 * nada y `descripcion` / `dato` se calculan la primera vez que se piden (D-001, como `itemPerezoso` de la biblioteca).
 */

type DatosEntrada<C extends ClaseEntrada> = {
  clase: C;
  idLocal: string;
  nombre: string;
  descripcion: string | (() => string);
  procedencia: Procedencia;
  dato: () => DatoDeClase[C];
};

export function crearEntrada<C extends ClaseEntrada>(repositorio: IdRepositorio, d: DatosEntrada<C>): EntradaCatalogo<C> {
  const descripcion = typeof d.descripcion === "string" ? d.descripcion : perezoso(d.descripcion);
  const dato = perezoso(d.dato);
  const entrada = {
    id: idCalificado(repositorio, d.idLocal), idLocal: d.idLocal, repositorio, clase: d.clase, nombre: d.nombre, procedencia: d.procedencia,
    get descripcion() { return typeof descripcion === "string" ? descripcion : descripcion(); },
    get dato() { return dato(); },
  };
  return entrada as EntradaCatalogo<C>;
}

/**
 * Un repositorio sobre una lista de entradas que se arma al pedirla por primera vez. `fueraDeLista`: los ids locales que el
 * repositorio resuelve sin listarlos (los derivados de las escenas de Sempertex, que exigen armar la escena).
 */
export function repositorioDeLista(
  manifiesto: ManifiestoRepositorio,
  construir: () => EntradaCatalogo[],
  fueraDeLista?: (idLocal: string) => EntradaCatalogo | undefined,
): Repositorio {
  const entradas = perezoso((): readonly EntradaCatalogo[] => Object.freeze(construir()));
  const porId = perezoso(() => new Map(entradas().map((e) => [e.idLocal, e])));
  return { manifiesto, entradas, porIdLocal: (idLocal) => porId().get(idLocal) ?? fueraDeLista?.(idLocal) };
}
