import type { ManifiestoRepositorio } from "../../tipos";
import lock from "./lock.json";

/**
 * **Escenografía**: lo que viste el montaje y no es globo ni se alquila para sentarse: los fondos de las fotos (panel redondo,
 * media luna, arcos chiara, lentejuelas, cortinas, letrero, tapete, pedestales) y el decorado de pie modelado en casa (aros y
 * arcos metálicos, peldaños, biombo, pampas, lámpara, neón, nombre de acrílico, bases de pastel y el pastel). No se vende.
 */
export const MANIFIESTO_ESCENOGRAFIA: ManifiestoRepositorio = {
  esquema: 1,
  id: "escenografia",
  version: lock.version,
  historial: lock.historial,
  nombre: "Escenografía",
  descripcion: "Fondos, paneles, cortinas, pedestales, aros y decorado de pie del montaje.",
  clases: ["fondo", "decorado"],
  licencia: {
    regimen: "propia",
    titular: "Equipo demo-decoracion",
    atribucion: "Los rótulos en cursiva (neón, nombre de acrílico, textos de paneles) usan la fuente Great Vibes (SIL Open Font License 1.1, D-018).",
    restricciones: [],
  },
  precio: { tipo: "sin-precio", motivo: "escenografía del montaje: no se vende" },
  visiblePorDefecto: ["taller", "ia_taller", "foto"],
  depende: [],
  idsLocales: { exactos: "del-cargador" },
  datos: "data/catalogos/escenografia",
};
