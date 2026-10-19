/**
 * **El tiempo de un pedido a la IA de escena** (`/api/escena-ia`, `maxDuration`). Armar una pieza grande bloquea Node varios segundos y el bucle de
 * herramientas encadena hasta 12 vueltas del modelo: sin un plazo, un pedido pesado seguía aplicando herramientas pasado el tiempo que el servidor
 * le da. El plazo es cooperativo: antes de cada vuelta del modelo y de cada herramienta se pregunta si queda tiempo para ella y para que el modelo
 * conteste después; si no, la herramienta no se aplica y el modelo recibe «No pude: …» para que lo diga.
 */

/** Lo que a lo más bloquea una herramienta: los topes de armado (`presupuesto-cuerpo.ts`) dejan una pieza en unos 15 s en el equipo del taller. */
export const HERRAMIENTA_MAXIMA_MS = 15_000;
/** Lo que se reserva a una vuelta del modelo para contestar con lo que pasó (y a la ruta para responder). */
export const VUELTA_DEL_MODELO_MS = 12_000;
/** Cuánto antes del final se corta una llamada al modelo que sigue en pie. */
export const MARGEN_DE_CORTE_MS = 5_000;

export type Plazo = {
  /** Cuánto queda (ms), nunca negativo. */
  restanteMs(): number;
  /** ¿Queda al menos esto? */
  alcanza(necesitaMs: number): boolean;
};

/** Un plazo de `totalMs` desde ahora, con el reloj que se pase (las pruebas ponen uno a mano). */
export function crearPlazo(totalMs: number, ahora: () => number = Date.now): Plazo {
  const vence = ahora() + totalMs;
  const restanteMs = () => Math.max(0, vence - ahora());
  return { restanteMs, alcanza: (necesitaMs) => restanteMs() >= necesitaMs };
}

/** ¿Queda tiempo para aplicar una herramienta y para que el modelo conteste después? */
export const alcanzaParaHerramienta = (plazo: Plazo): boolean => plazo.alcanza(HERRAMIENTA_MAXIMA_MS + VUELTA_DEL_MODELO_MS);

/** ¿Queda tiempo para otra vuelta del modelo? */
export const alcanzaParaVuelta = (plazo: Plazo): boolean => plazo.alcanza(VUELTA_DEL_MODELO_MS);

/** Lo que ve el usuario (en el avance y en la respuesta) de una herramienta que no se aplicó por falta de tiempo. */
export const textoPasoSinTiempo = (nombre: string): string => `No pude: se acabó el tiempo de este pedido antes de aplicar ${nombre}, y no se aplicó.`;

/** Lo que recibe el modelo en lugar del resultado de esa herramienta: lo mismo y qué hacer. */
export const textoHerramientaSinTiempo = (nombre: string): string =>
  `${textoPasoSinTiempo(nombre)} Dile al usuario qué quedó hecho y qué falta, y que vuelva a pedir lo que falte.`;

/** Se agrega a la respuesta cuando una herramienta no se aplicó por falta de tiempo. */
export const TEXTO_PEDIDO_SIN_TIEMPO = "No pude terminar: se acabó el tiempo de este pedido. Revisa lo hecho y pídeme lo que falte.";

/** Cuando el tiempo corta la llamada al modelo y no había nada hecho que devolver. */
export const TEXTO_SIN_TIEMPO_NADA_HECHO = "No pude hacerlo: el pedido tardó más de lo que se permite y no alcancé a cambiar nada. Pídelo en partes más chicas.";

/** El corte que se le pasa al modelo: el del navegador («Detener») o el del plazo, lo primero que llegue. */
export function corteConPlazo(corteDelNavegador: AbortSignal, plazo: Plazo): AbortSignal {
  return AbortSignal.any([corteDelNavegador, AbortSignal.timeout(Math.max(1, plazo.restanteMs() - MARGEN_DE_CORTE_MS))]);
}

/** ¿Cortó el plazo la llamada al modelo (y no el navegador ni el proveedor)? */
export const corteElPlazo = (corte: AbortSignal, corteDelNavegador: AbortSignal): boolean => corte.aborted && !corteDelNavegador.aborted;

/** Qué se saltó el bucle por falta de tiempo. */
export type EstadoDePlazo = {
  /** Una herramienta que el modelo pidió no se aplicó. */
  herramientaSaltada: boolean;
  /** No quedó tiempo para otra vuelta del modelo (si todas las herramientas se aplicaron, solo falta su cierre). */
  vueltaSaltada: boolean;
};

/** Lo que el bucle de herramientas le pregunta al plazo, y lo que anotó. */
export type ControlDePlazo = {
  /** ¿Queda tiempo para otra vuelta del modelo? Si no, se anota. */
  hayVuelta(): boolean;
  /** ¿Queda tiempo para aplicar esta herramienta? Si no, se anota. */
  puedeAplicar(): boolean;
  estado(): EstadoDePlazo;
};

export function controlarPlazo(plazo: Plazo): ControlDePlazo {
  const estado: EstadoDePlazo = { herramientaSaltada: false, vueltaSaltada: false };
  return {
    hayVuelta: () => { const hay = alcanzaParaVuelta(plazo); if (!hay) estado.vueltaSaltada = true; return hay; },
    puedeAplicar: () => { const puede = alcanzaParaHerramienta(plazo); if (!puede) estado.herramientaSaltada = true; return puede; },
    estado: () => ({ ...estado }),
  };
}

/**
 * La respuesta final con lo que el plazo se saltó. Si una herramienta no se aplicó, se dice («No pude terminar…»); si todas se aplicaron y solo
 * faltó la vuelta que las cierra, no hay nada que lamentar: queda el resumen de siempre.
 */
export function respuestaConPlazo(respuesta: string, cambios: number, estado: EstadoDePlazo): string {
  if (!estado.herramientaSaltada) return respuesta || (cambios ? `Listo: ${cambios} cambio${cambios > 1 ? "s" : ""} en la escena.` : "No hice cambios.");
  const hecho = respuesta || (cambios ? `Hice ${cambios} cambio${cambios > 1 ? "s" : ""} en la escena.` : "");
  return `${hecho ? `${hecho} ` : ""}${TEXTO_PEDIDO_SIN_TIEMPO}`;
}
