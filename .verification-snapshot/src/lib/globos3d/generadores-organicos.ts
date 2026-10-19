import type { OpcionesOrganico } from "./organico";
import type { OpcionesFlores } from "./flores-artificiales";
import type { Pieza } from "./piezas";
import { escalarTrazo, opcionesTrazoOrganico, type ParametrosTrazoOrganico } from "./trazo-organico";

/**
 * Los **generadores** de las piezas orgánicas paramétricas: lo que la pieza `organico` guarda en `generador` para
 * editarse por sus parámetros (no por su lista de tramos). Quien cambia el generador vuelve a sacar las `opciones`
 * con `piezaDeGenerador`; así lo que se arma y lo que se edita no se separan. Hoy: el trazo libre.
 */
export type GeneradorOrganico = { tipo: "trazo"; trazo: ParametrosTrazoOrganico };

type Organico = Extract<Pieza, { tipo: "organico" }>;

export function opcionesDeGenerador(g: GeneradorOrganico): OpcionesOrganico {
  switch (g.tipo) {
    case "trazo": return opcionesTrazoOrganico(g.trazo);
  }
}

/** La pieza armable de un generador, con sus flores (los huecos que ya tenía la pieza, si las lleva). */
export function piezaDeGenerador(g: GeneradorOrganico, flores: OpcionesFlores | null = null, huecosFlores = 14): Organico {
  const opciones = opcionesDeGenerador(g);
  return { tipo: "organico", opciones: { ...opciones, huecosFlores: flores ? huecosFlores : 0 }, flores, generador: g };
}

/** Otra versión de la pieza con el generador cambiado (conserva sus flores). */
export function conGenerador(pieza: Organico, g: GeneradorOrganico): Organico {
  return piezaDeGenerador(g, pieza.flores, Math.max(14, pieza.opciones.huecosFlores));
}

/** Medidas nuevas por fuera (ancho, alto) y/o grosor (factor), por el generador. */
export function escalarGenerador(g: GeneradorOrganico, cambio: { anchoCm?: number; altoCm?: number; grosor?: number }): GeneradorOrganico {
  switch (g.tipo) {
    case "trazo": return { tipo: "trazo", trazo: escalarTrazo(g.trazo, cambio) };
  }
}

export function coloresDeGenerador(g: GeneradorOrganico) {
  switch (g.tipo) {
    case "trazo": return g.trazo.colores;
  }
}
