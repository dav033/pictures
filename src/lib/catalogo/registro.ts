import { perezoso } from "@/lib/globos3d/perezoso";
import { REPOSITORIOS_FUNDADORES } from "./ids";
import { parsearIdCatalogo } from "./indice";
import type { EntradaCatalogo, Repositorio } from "./repositorio";
import { cargarEscenografia } from "./repositorios/escenografia/cargador";
import { cargarMobiliario } from "./repositorios/mobiliario/cargador";
import { cargarSempertex } from "./repositorios/sempertex/cargador";
import type { IdRepositorio, IdRepositorioFundador } from "./tipos";

/**
 * El **registro de repositorios de catálogo** (REQ-013): los tres fundadores con sus entradas, como cargas perezosas (importar no
 * arma ninguna, D-001). Para saber a qué repositorio va un id sin cargar nada están `indice.ts` y `manifiestos.ts`. Importa la
 * biblioteca y el motor; el motor nunca lo importa a él (R8, `test-catalogo-capas`).
 */

const cargados = new Set<IdRepositorioFundador>();
const cargaPerezosa = (id: IdRepositorioFundador, cargar: () => Repositorio) => perezoso(() => { cargados.add(id); return cargar(); });
const CARGADORES: Readonly<Record<IdRepositorioFundador, () => Repositorio>> = {
  sempertex: cargaPerezosa("sempertex", cargarSempertex),
  mobiliario: cargaPerezosa("mobiliario", cargarMobiliario),
  escenografia: cargaPerezosa("escenografia", cargarEscenografia),
};

const esRepositorioFundador = (id: IdRepositorio): id is IdRepositorioFundador => (REPOSITORIOS_FUNDADORES as readonly string[]).includes(id);

/** El repositorio (lo carga si hace falta); los de terceros llegan en la fase 7. */
export const repositorio = (id: IdRepositorio): Repositorio | undefined => (esRepositorioFundador(id) ? CARGADORES[id]() : undefined);

/** Qué repositorios se cargaron ya (diagnóstico: importar el registro no carga ninguno). */
export const repositoriosCargados = (): IdRepositorioFundador[] => REPOSITORIOS_FUNDADORES.filter((id) => cargados.has(id));

/** La entrada de un id en cualquiera de sus dos formas (`silla_tiffany` o `mobiliario:silla_tiffany`). */
export function resolverEntrada(s: string): EntradaCatalogo | undefined {
  const p = parsearIdCatalogo(s);
  return "error" in p ? undefined : repositorio(p.repositorio)?.porIdLocal(p.idLocal);
}
