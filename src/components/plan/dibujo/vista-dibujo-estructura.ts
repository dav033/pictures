import type { GraficaDibujoEstructura } from "@/lib/plan/dibujo-estructura";
import type { LineaMezclaReal, PeticionDibujoEstructura } from "@/lib/plan/peticion-dibujo-estructura";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { jsonEstable } from "../bouquet/borrador-armado";

/**
 * Qué se pide a /api/plan-dibujo-estructura por una pieza y qué muestra el bloque con lo que llega.
 * Puro: sin React, para poder probarlo sin montar nada.
 *
 * Aquí no se cuenta ni se mide: el dibujo viene hecho de Python. Lo único que este módulo decide es **cuándo
 * el dibujo que hay a la vista ya no sirve** (`claveDibujoEstructura`) y **qué estado se dibuja**
 * (`panelDibujoEstructura`).
 */

/**
 * Lo que el dibujo lee de la pieza declarada. El tipo es estructural a propósito: así vale para Plan 1.0 y
 * para Plan 1.1 sin que este módulo tenga que distinguirlos, que no es asunto suyo.
 */
export type DeclaradaDibujo = {
  tipo: string;
  estructura_oficial?: string;
  /** La forma que eligió el decorador (`formas-pieza.ts`); sin ella manda la que implica su oficial. */
  forma?: string;
  /** Lo que el editor de la pieza parte del plan (`borrador-pieza.ts`); el dibujo no los lee. */
  densidad?: string;
  medidas?: { ancho_m?: number; alto_m?: number; largo_m?: number };
  materiales: readonly { color?: string; acabado?: string; participacion?: number }[];
  patron_color?: { base: { modo: string } };
};

/** La pieza sobre la que se pide el dibujo: el plan a la vista, la estructura y su mezcla de tamaños resuelta. */
export type PiezaDibujoEstructura = {
  plan: PlanResuelto["plan"];
  estructuraId: string;
  /** La pieza tal como el plan la declara: de ella salen el dibujo, los colores y el patrón. */
  declarada: DeclaradaDibujo;
  /** `plan_resuelto.estructuras[].mezcla_real` de esta pieza: el dibujo reparte los tamaños en esa proporción. */
  mezclaReal: readonly LineaMezclaReal[];
};

/** Cuerpo de /api/plan-dibujo-estructura para una pieza. Solo transporte. */
export function peticionDibujoEstructura(pieza: PiezaDibujoEstructura): PeticionDibujoEstructura {
  return {
    plan: pieza.plan,
    estructura_id: pieza.estructuraId,
    mezcla_real: pieza.mezclaReal,
  };
}

/**
 * Qué hace distinto a un dibujo de otro: la pieza, sus colores, su patrón de color y su mezcla de tamaños, que
 * es todo lo que el dibujo lee.
 *
 * El plan entero **no** entra, y las medidas tampoco: el dibujo es esquemático y su medida es la típica de la
 * estructura, no la del trabajo («No calculan cantidades», encabezado de `dibujos.py`), así que cambiar el
 * ancho de la pared no lo mueve. Lo que sí lo mueve es la estructura oficial (otro dibujo), **la forma elegida**
 * (otra silueta del mismo dibujo), los materiales (otros colores y otros pesos), el modo del patrón (otro
 * reparto de color) y la mezcla real (otros tamaños). Un cambio en otra pieza o en el precio no vuelve a pedir
 * nada.
 */
export function claveDibujoEstructura(pieza: PiezaDibujoEstructura): string {
  const { declarada } = pieza;
  return jsonEstable({
    estructura: pieza.estructuraId,
    oficial: declarada.estructura_oficial ?? null,
    forma: declarada.forma ?? null,
    tipo: declarada.tipo,
    materiales: declarada.materiales.map((material) => [material.color ?? null, material.acabado ?? null, material.participacion ?? null]),
    modo: declarada.patron_color?.base.modo ?? null,
    mezcla: pieza.mezclaReal.map((linea) => [linea.forma, linea.diam_pulg, linea.unidades]),
  });
}

/** La última respuesta buena y el dibujo al que corresponde. */
export type RespuestaDibujoEstructura = { clave: string; grafica: GraficaDibujoEstructura };
/** Lo último que falló y por cuál dibujo. */
export type FalloDibujoEstructura = { clave: string; mensaje: string };

/**
 * Lo que muestra el bloque, con cada estado explícito. No hay fase `vacio` como en los bloques de los motores:
 * allí el motor puede rechazar el armado que trae el plan, y aquí no hay armado que rechazar.
 */
export type PanelDibujoEstructura =
  /** Nada que dibujar todavía. */
  | { fase: "cargando" }
  /** Nada que dibujar y la petición no llegó: esto se reintenta. */
  | { fase: "error"; mensaje: string }
  /** El dibujo; `actualizando`: el de la pieza cambiada está en camino; `fallo`: el último no llegó. */
  | { fase: "listo"; grafica: GraficaDibujoEstructura; actualizando: boolean; fallo: string | null };

/**
 * El estado del bloque para el dibujo que se quiere ver (`clave`), sin estado derivado guardado aparte: sale de
 * la última respuesta y del último fallo, que es todo lo que hay.
 *
 * Mientras llega el dibujo de una pieza que cambió se conserva el anterior (`actualizando`), como en los
 * bloques de los motores: cambiar un color no deja el hueco en blanco.
 */
export function panelDibujoEstructura(
  clave: string,
  respuesta: RespuestaDibujoEstructura | null,
  fallo: FalloDibujoEstructura | null,
): PanelDibujoEstructura {
  if (respuesta?.clave === clave) return { fase: "listo", grafica: respuesta.grafica, actualizando: false, fallo: null };
  const propio = fallo?.clave === clave ? fallo : null;
  if (propio) {
    if (respuesta) return { fase: "listo", grafica: respuesta.grafica, actualizando: false, fallo: propio.mensaje };
    return { fase: "error", mensaje: propio.mensaje };
  }
  if (respuesta) return { fase: "listo", grafica: respuesta.grafica, actualizando: true, fallo: null };
  return { fase: "cargando" };
}
