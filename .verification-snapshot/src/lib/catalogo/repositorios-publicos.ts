import type { RepositorioPublico, RespuestaRepositorios } from "./repositorios-api-tipos";
import type { IdRepositorio, ManifiestoRepositorio } from "./tipos";

/** La vista pública de un manifiesto: lo que el Taller necesita para nombrar el repositorio y decir de dónde viene, sin rutas del servidor. */
export function repositorioPublico(manifiesto: ManifiestoRepositorio, visible: boolean): RepositorioPublico {
  const { precio, licencia } = manifiesto;
  return {
    id: manifiesto.id,
    nombre: manifiesto.nombre,
    descripcion: manifiesto.descripcion,
    version: manifiesto.version,
    licencia: {
      regimen: licencia.regimen,
      titular: licencia.titular,
      ...(licencia.url ? { url: licencia.url } : {}),
      ...(licencia.atribucion ? { atribucion: licencia.atribucion } : {}),
      restricciones: [...licencia.restricciones],
    },
    precio: { tipo: precio.tipo, ...(precio.tipo === "sin-precio" ? { motivo: precio.motivo } : {}) },
    visible,
  };
}

/** La respuesta de la ruta a partir de lo ya resuelto —pura y sin servidor, así la arman a mano las pruebas del panel—: los manifiestos en su orden, cada uno con su `visible`. */
export function construirRespuestaRepositorios(entradas: {
  manifiestos: readonly ManifiestoRepositorio[];
  visibles: readonly IdRepositorio[];
  ui: boolean;
}): RespuestaRepositorios {
  return {
    repositorios: entradas.manifiestos.map((m) => repositorioPublico(m, entradas.visibles.includes(m.id))),
    ui: entradas.ui,
  };
}
