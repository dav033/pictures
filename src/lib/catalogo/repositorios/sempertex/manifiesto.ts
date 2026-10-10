import { PREFIJOS_SEMPERTEX } from "../../ids";
import type { ManifiestoRepositorio } from "../../tipos";
import lock from "./lock.json";

/**
 * **Sempertex**: la marca socia. Toda la biblioteca de fábrica (ideas, Celebra, decoraciones predefinidas, utilería, bases
 * orgánicas, referencias del dueño, escenas de partida) y lo que se deriva de sus escenas; los formatos y la tabla de colores; la
 * utilería de la tienda; la biblioteca de la vista guiada (planes, detalles y decoraciones reales); los módulos de armado.
 * Depende de escenografía y mobiliario: las escenas compiladas de las referencias del dueño ponen fondos y muebles del catálogo.
 */
export const MANIFIESTO_SEMPERTEX: ManifiestoRepositorio = {
  esquema: 1,
  id: "sempertex",
  version: lock.version,
  historial: lock.historial,
  nombre: "Sempertex",
  descripcion: "Globos y decoraciones Sempertex: ideas, revistas Celebra, decoraciones, utilería de la tienda, formatos y colores.",
  clases: ["item-biblioteca", "formato", "color", "producto-tienda", "plan-idea", "decoracion-guiada", "modulo"],
  licencia: {
    regimen: "marca-socio",
    titular: "Sempertex",
    url: "https://sempertex.com",
    restricciones: [
      "fotos solo por url pública https, nunca copiadas al repositorio",
      "los enlaces de productos apuntan a la tienda de Sempertex",
    ],
  },
  precio: { tipo: "crosswalk-tienda" },
  visiblePorDefecto: ["taller", "ia_taller", "foto", "rag", "estudio", "guiada"],
  depende: ["escenografia", "mobiliario"],
  idsLocales: { prefijos: PREFIJOS_SEMPERTEX },
  datos: "data/taller",
};
