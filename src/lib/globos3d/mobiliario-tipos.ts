import type { AcabadoEscenografia, ElementoEscenografia } from "./escenografia";

/**
 * Los tipos del **registro de fondos y mobiliario** (`FONDOS_CATALOGO`): una entrada es un fondo fijo de foto
 * (`clase: "fondo"`, solo trae sus elementos) o un mueble paramétrico (`clase: "mueble"`, se arma por medidas y colores).
 * Aparte para que el catálogo, la pieza guardada y las herramientas no se importen en círculo.
 */

export type MedidasMueble = { anchoCm: number; fondoCm: number; altoCm: number };
export type OpcionesMueble = MedidasMueble & { colores: readonly string[]; acabado?: AcabadoEscenografia; texto?: string };

export type GrupoCatalogo = "fondo" | "asiento" | "mesa" | "decorado";

type EntradaComun = {
  id: string; nombre: string; descripcion: string; lugar: "piso" | "pared";
  /** Cuánto se separa de la pared del fondo al ponerlo en el piso (cm); si falta, `RETIRO_PISO_CM`. */
  retiroCm?: number;
  /** En la pared: la altura del borde de abajo al ponerlo (cm); por defecto 0. */
  alturaParedCm?: number;
  elementos: () => ElementoEscenografia[];
};

/** Un fondo de foto (panel, pedestales, cortina…): trae sus elementos hechos y no cambia de medida ni de color. */
export type FondoFijo = EntradaComun & { clase: "fondo"; grupo?: GrupoCatalogo };

export type MuebleCatalogo = EntradaComun & {
  clase: "mueble";
  grupo: Exclude<GrupoCatalogo, "fondo">;
  /** Las medidas **totales** de partida (cm): lo que mide la pieza armada. `anchoCm` es el diámetro en lo redondo. */
  medidas: MedidasMueble;
  /** Colores de partida (`#rrggbb`), en el orden en que se piden. */
  colores: readonly string[];
  /** Para qué sirve cada color, en ese orden («estructura», «cojín»…). */
  coloresDe: readonly string[];
  /**
   * Qué hace el fondo (de frente a atrás) al pedirlo: `libre` (por defecto) lo respeta; `igual_ancho` es redondo (el fondo es el
   * ancho); `proporcional` sale del ancho (un hexágono); `fijo` no cambia (el pie de un aro, el grosor de un letrero). Lo que no
   * es `libre` no tiene deslizador de fondo y su `fondoCm` se rehace solo.
   */
  fondo?: "libre" | "igual_ancho" | "proporcional" | "fijo";
  /** Los colores que no se piden se parecen al primero (en vez de los de partida). */
  seguirPrimero?: boolean;
  /** Es un asiento suelto: se puede repartir en fila o alrededor de una mesa. */
  asiento?: boolean;
  /** Lleva un texto (el neón). */
  conTexto?: boolean;
  /** Va sobre una mesa (la base de pastel). */
  sobreMesa?: boolean;
  armar: (o: OpcionesMueble) => ElementoEscenografia[];
};

export type FondoCatalogo = FondoFijo | MuebleCatalogo;

/** Cuánto se separa de la pared del fondo lo que se pone en el piso si la entrada no dice otra cosa (cm). */
export const RETIRO_PISO_CM = 15;
export const retiroDe = (f: FondoCatalogo): number => f.retiroCm ?? RETIRO_PISO_CM;

/** El texto para el modelo: lo que es y, en un mueble, qué es cada color en el orden en que se pide. */
export function descripcionConColores(f: FondoCatalogo): string {
  return f.clase === "mueble" ? `${f.descripcion} Colores en orden: ${f.coloresDe.map((c, i) => `${i + 1} ${c}`).join(", ")}.` : f.descripcion;
}
