/**
 * Los tipos que comparten el servidor y el navegador sobre la aceptación de una ronda de refinado (REQ-001 paso 9, P-016):
 * por qué se rechaza una ronda, qué le dice la barra al usuario por cada motivo (sin números: esos solo van al registro) y
 * el veredicto que el servidor devuelve al navegador. Nada de three.js ni de red.
 */

export type MotivoRechazo = "no_mejora" | "pieza_baja" | "pieza_quitada" | "pieza_oculta" | "menos_globos" | "sin_comparacion";
/** `detalle` lleva los números y los nombres: va al registro, nunca a la pantalla. */
export type Rechazo = { motivo: MotivoRechazo; detalle: string };
export type Similitud = { antes: number; despues: number };

/** Una sola frase por motivo para el usuario; el «porqué» con cifras queda en el registro del servidor. */
export const MENSAJE_RECHAZO: Readonly<Record<MotivoRechazo, string>> = {
  no_mejora: "La comparación no mejoró; dejé la versión anterior.",
  pieza_baja: "La comparación bajaba una pieza que en la foto cuelga; dejé la versión anterior.",
  pieza_quitada: "La comparación quitaba una pieza que se ve en la foto; dejé la versión anterior.",
  pieza_oculta: "La comparación dejaba una pieza tapada por otra; dejé la versión anterior.",
  menos_globos: "La comparación quitaba demasiados globos; dejé la versión anterior.",
  sin_comparacion: "No pude comparar con la foto para saber si mejoraba; dejé la versión anterior.",
};

/** Lo que `/api/escena-ia/similitud` le contesta al navegador sobre una ronda: el veredicto y lo que costó decidirlo. */
export type Veredicto = {
  aceptada: boolean;
  /** Por qué se rechazó; `null` si se aceptó. */
  motivo: MotivoRechazo | null;
  /** Qué tanto se parecen a la foto la captura de antes y la de después; `null` si no se llegó a medir. */
  similitud: Similitud | null;
  costeEstimadoUsd: number;
};

export const veredictoSinComparar = (): Veredicto => ({ aceptada: false, motivo: "sin_comparacion", similitud: null, costeEstimadoUsd: 0 });
