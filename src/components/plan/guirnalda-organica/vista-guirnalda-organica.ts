import type { ArmadoGuirnaldaOrganicaV1 } from "@/lib/plan/armado-guirnalda-organica";
import type { PeticionVistaArmadoGuirnaldaOrganica, VistaArmadoGuirnaldaOrganica } from "@/lib/plan/peticion-armado-guirnalda-organica";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { jsonEstable } from "../bouquet/borrador-armado";

/**
 * Qué se pide a /api/plan-armado-guirnalda-organica por una pieza y qué muestra el bloque con lo que llega (ADR-0034).
 * Puro: sin React, para poder probarlo sin montar nada.
 *
 * Aquí no se cuenta ni se mide: la guirnalda, su dibujo y sus avisos vienen resueltos del motor. Lo único que
 * este módulo decide es **cuándo el dibujo que hay a la vista ya no sirve** (`claveVistaGuirnaldaOrganica`) y **qué estado se
 * dibuja** (`panelVistaGuirnaldaOrganica`).
 */

/** La pieza sobre la que se pide el dibujo: el plan que se está mostrando, la estructura y sus tonos. */
export type PiezaVistaGuirnaldaOrganica = {
  plan: PlanResuelto["plan"];
  estructuraId: string;
  /**
   * Los tonos de la pieza, uno por material y en su orden, tal como el navegador los tiene después de que el
   * catálogo los resolvió. Solo pintan: el conteo y la compra van por índice de material. Sin ellos el motor
   * dibuja en su gris neutro y lo dice en los avisos.
   */
  colores?: readonly string[];
};

/**
 * Los colores con los que se dibuja la pieza, como una sola cadena: si cambia, lo que el motor dibujó y lo que se
 * recordó de él ya no vale (otro color, o otro número de colores, cambia a qué apunta cada índice de la paleta).
 */
export function firmaColoresGuirnaldaOrganica(pieza: Pick<PiezaVistaGuirnaldaOrganica, "colores">): string {
  return JSON.stringify(pieza.colores ?? null);
}

/** Cuerpo de /api/plan-armado-guirnalda-organica para una pieza. Solo transporte. */
export function peticionVistaGuirnaldaOrganica(pieza: PiezaVistaGuirnaldaOrganica, armado: ArmadoGuirnaldaOrganicaV1 | null): PeticionVistaArmadoGuirnaldaOrganica {
  return {
    plan: pieza.plan,
    estructura_id: pieza.estructuraId,
    armado_guirnalda_organica: armado,
    ...(pieza.colores === undefined ? {} : { colores: pieza.colores }),
  };
}

/**
 * Qué hace distinto a un dibujo de otro: la pieza, su armado y sus tonos.
 *
 * El plan entero **no** entra. Con un armado dado, el motor saca del armado toda la geometría (la forma, el
 * volumen, los tamaños, la paleta, los adornos y el aspecto) y de `colores` todo el color; del plan solo necesita
 * encontrar la pieza y validarse. Por eso un cambio en otra parte del plan —otro precio, otra pieza— no
 * cambia esta guirnalda y no se vuelve a pedir. Las medidas del plan solo mandan en la receta (`armado_guirnalda_organica:
 * null`), que este bloque nunca pide.
 */
export function claveVistaGuirnaldaOrganica(pieza: PiezaVistaGuirnaldaOrganica, armado: ArmadoGuirnaldaOrganicaV1): string {
  return jsonEstable({ estructura: pieza.estructuraId, armado, colores: pieza.colores ?? null });
}

/** La última respuesta buena del motor y el dibujo al que corresponde. */
export type RespuestaVistaGuirnaldaOrganica = { clave: string; vista: VistaArmadoGuirnaldaOrganica };
/** Lo último que falló y por cuál dibujo: `armadoInvalido` no se reintenta solo ni a mano. */
export type FalloVistaGuirnaldaOrganica = { clave: string; mensaje: string; armadoInvalido: boolean };

/**
 * Lo que muestra el bloque, con cada estado explícito. `vencido` (solo al editar): el dibujo es el último que
 * llegó y el cambio que se pidió después no se pudo dibujar, así que no es el del borrador.
 */
export type PanelVistaGuirnaldaOrganica =
  /** Nada que dibujar todavía: el motor está armando. */
  | { fase: "cargando" }
  /** El motor no puede armar esta guirnalda: el armado que trae el plan no se sostiene y su frase dice por qué. */
  | { fase: "vacio"; mensaje: string }
  /** Nada que dibujar y el motor no respondió: esto sí se reintenta (lo de `vacio`, no). */
  | { fase: "error"; mensaje: string }
  /** Un dibujo del motor; `actualizando`: el del armado nuevo está en camino; `fallo`: el último no llegó. */
  | { fase: "listo"; vista: VistaArmadoGuirnaldaOrganica; actualizando: boolean; fallo: string | null; vencido?: boolean };

/**
 * El estado del bloque para el dibujo que se quiere ver (`clave`), sin estado derivado guardado aparte: sale
 * de la última respuesta y del último fallo, que es todo lo que hay.
 *
 * Mientras llega el dibujo de un armado nuevo se conserva el anterior (`actualizando`), como en el panel de
 * la guirnalda: cambiar de armado no deja el hueco en blanco. Un rechazo del motor sí lo tapa, porque ese
 * dibujo es de un armado que la pieza ya no tiene.
 */
export function panelVistaGuirnaldaOrganica(clave: string, respuesta: RespuestaVistaGuirnaldaOrganica | null, fallo: FalloVistaGuirnaldaOrganica | null): PanelVistaGuirnaldaOrganica {
  if (respuesta?.clave === clave) return { fase: "listo", vista: respuesta.vista, actualizando: false, fallo: null };
  const propio = fallo?.clave === clave ? fallo : null;
  if (propio) {
    if (propio.armadoInvalido) return { fase: "vacio", mensaje: propio.mensaje };
    if (respuesta) return { fase: "listo", vista: respuesta.vista, actualizando: false, fallo: propio.mensaje };
    return { fase: "error", mensaje: propio.mensaje };
  }
  if (respuesta) return { fase: "listo", vista: respuesta.vista, actualizando: true, fallo: null };
  return { fase: "cargando" };
}
