import { MANIFIESTOS } from "./manifiestos";
import { construirRespuestaRepositorios } from "./repositorios-publicos";
import type { RespuestaRepositorios } from "./repositorios-api-tipos";
import { leerUiRepositorios } from "./ui-repositorios";
import { reposVisiblesVigentes } from "./visibilidad";

/** Lo que dice la ruta ahora: los manifiestos, la visibilidad vigente de la superficie `taller` (fila, variable o manifiesto) y la bandera de la interfaz. */
export async function leerRespuestaRepositorios(): Promise<RespuestaRepositorios> {
  const [visibles, ui] = await Promise.all([reposVisiblesVigentes("taller"), leerUiRepositorios()]);
  return construirRespuestaRepositorios({ manifiestos: Object.values(MANIFIESTOS), visibles, ui: ui.activa });
}
