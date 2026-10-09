import type { AcabadoEscenografia, ElementoEscenografia } from "./escenografia";

/**
 * Los tipos del **registro de fondos y mobiliario** (`FONDOS_CATALOGO`): una entrada es un fondo fijo de foto
 * (`clase: "fondo"`, solo trae sus elementos) o un mueble paramétrico (`clase: "mueble"`, se arma por medidas y colores).
 * Aparte para que el catálogo, la pieza guardada y las herramientas no se importen en círculo.
 */

export type MedidasMueble = { anchoCm: number; fondoCm: number; altoCm: number };
export type OpcionesMueble = MedidasMueble & { colores: readonly string[]; acabado?: AcabadoEscenografia; texto?: string; /** Un conjunto de mesa con sillas: cuántas lleva (si falta, las de siempre). */ sillas?: number };

export type GrupoCatalogo = "fondo" | "asiento" | "mesa" | "decorado";

type EntradaComun = {
  id: string; nombre: string; descripcion: string; lugar: "piso" | "pared";
  /** Cuánto se separa de la pared del fondo al ponerlo en el piso (cm); si falta, `RETIRO_PISO_CM`. */
  retiroCm?: number;
  /** En la pared: la altura del borde de abajo al ponerlo (cm); por defecto 0. */
  alturaParedCm?: number;
  /** Va en el aire a esta altura sobre el piso (cm), sin esquivar lo que ya está: un nombre de acrílico delante de un aro. */
  flotaCm?: number;
  /** Un telón: se para contra la pared (aros, arcos, marcos, biombo, escalera apoyada) y nunca avanza hacia la cámara de una foto. */
  telon?: true;
  /**
   * Admite un rótulo en cursiva (`mueble.rotulo` de su pieza). `true`: lo lleva su ÚLTIMO elemento (el panel de delante, la tela del
   * marco); `"mayor"`: el de más área (el arco más grande de unos escalonados, con el texto arriba de lo que lo tapa). Ver `rotulos.ts`.
   */
  rotulable?: true | "mayor";
  elementos: () => ElementoEscenografia[];
};

/** Un fondo de foto (panel, pedestales, cortina…): trae sus elementos hechos y no cambia de medida ni de color. */
export type FondoFijo = EntradaComun & { clase: "fondo"; grupo?: GrupoCatalogo };

export type MuebleCatalogo = EntradaComun & {
  clase: "mueble";
  grupo: Exclude<GrupoCatalogo, "fondo">;
  /** Las medidas **totales** de partida (cm): lo que mide la pieza armada. `anchoCm` es el diámetro en lo redondo. */
  medidas: MedidasMueble;
  /** Solo en los conjuntos de mesa con sillas: cuántas lleva de partida y cuántas admite (`par`: las imperiales llevan una en cada cabecera y las demás por pares a los lados). */
  sillas?: { porDefecto: number; min: number; max: number; par: boolean };
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
  /** Cuántos asientos trae la pieza armada si no son configurables (un conjunto fijo con sus sillas). Lo lee `asientosDeEntrada`. */
  asientos?: number;
  /** Lleva un texto (el neón, el nombre de acrílico). */
  conTexto?: boolean;
  /** El texto con que se arma y se muestra si no se pide otro (solo con `conTexto`). */
  textoPorDefecto?: string;
  /** Cuántas líneas admite su texto (1 por defecto: el neón; el nombre de acrílico, 3). Solo con `conTexto`. */
  lineasTexto?: number;
  /** Los materiales del color principal que ofrece este mueble, con su nombre («metal» es el espejo de un nombre de acrílico); si falta, los de siempre. */
  acabadosPropios?: ReadonlyArray<readonly [AcabadoEscenografia, string]>;
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

/**
 * Cuántas sillas trae una entrada del catálogo con las opciones dadas: `opciones.sillas` (las que fijó el salón o el usuario), si no
 * las de siempre del conjunto (`sillas.porDefecto`, o `asientos` en el que no es configurable); una silla suelta cuenta 1; 0 si no trae.
 * Es la única fuente de ese número (`mobiliario-asientos-mesa.ts` la usa para toda la escena).
 */
export function asientosDeEntrada(m: MuebleCatalogo, opciones?: { sillas?: number }): number {
  return opciones?.sillas ?? m.sillas?.porDefecto ?? m.asientos ?? (m.asiento ? 1 : 0);
}
