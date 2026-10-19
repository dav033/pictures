import type { ManifiestoRepositorio } from "../../tipos";
import lock from "./lock.json";

/**
 * **Mobiliario**: lo que se alquila para sentarse y servir, modelado por parámetros en casa (sillas, bancas, taburetes, sofás,
 * mesas con y sin mantel, los conjuntos de mesa con sillas, la zona lounge) y los generadores de mesas y sillas a medida.
 * Sin precio hasta que exista una lista de alquiler.
 */
export const MANIFIESTO_MOBILIARIO: ManifiestoRepositorio = {
  esquema: 1,
  id: "mobiliario",
  version: lock.version,
  historial: lock.historial,
  nombre: "Mobiliario",
  descripcion: "Sillas, mesas, sofás y conjuntos de mesa con sillas para el montaje del evento.",
  clases: ["mueble", "mueble-fijo", "generador"],
  licencia: { regimen: "propia", titular: "Equipo demo-decoracion", restricciones: [] },
  precio: { tipo: "sin-precio", motivo: "aún no hay lista de alquiler de mobiliario" },
  visiblePorDefecto: ["taller", "ia_taller", "foto"],
  depende: [],
  idsLocales: { exactos: "del-cargador" },
  datos: "data/catalogos/mobiliario",
};
