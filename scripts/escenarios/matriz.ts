import type { EspecClienteV1, PiezaEspec } from "../../src/lib/globos3d/motor/espec-cliente-v1";
import { bandaDePieza } from "./bandas";
import type { Escenario } from "./generador";
import { observar } from "./ejecutar";
import { evaluar, piezasConBanda, type Chequeo, type OpcionesEvaluar } from "./invariantes";

/**
 * **El núcleo compartido por el CLI y la prueba rápida**: correr un escenario por los invariantes y, cuando falla, reducirlo a
 * un repro mínimo que siga fallando con la MISMA clase (se quitan piezas, campos opcionales y los colores de más mientras el
 * fallo siga).
 */

export type Resultado = {
  escenario: Escenario;
  /** El esquema del cliente rechazó el escenario: es un fallo (no se descuenta del denominador). */
  rechazoEsquema: boolean;
  /** Tiempo de la fachada (ms); 0 si el esquema rechazó el escenario. */
  tiempoMs: number;
  chequeos: Chequeo[];
  /** Piezas sin banda de conteo (ni acierto ni fallo): su estructura y proporción de tamaños. */
  sinBanda: string[];
  /** Celdas de banda (estructura:densidad) que se comprobaron en este escenario. */
  celdasComprobadas: string[];
  /** Ancho de la sala que decidió el motor (cm); null si el esquema rechazó el escenario. */
  anchoSalaCm: number | null;
};

export function correr(escenario: Escenario, opciones: OpcionesEvaluar = { conTiempo: true }): Resultado {
  const obs = observar(escenario.espec);
  const chequeos = evaluar(obs, opciones);
  const sinBanda = obs.rechazoEsquema ? [] : escenario.espec.piezas.filter((p) => bandaDePieza(p).tipo === "sin_banda").map(etiquetaSinBanda);
  const celdasComprobadas = piezasConBanda(obs).map((p) => p.celda);
  return {
    escenario, rechazoEsquema: obs.rechazoEsquema !== null, tiempoMs: obs.tiempoMs, chequeos, sinBanda, celdasComprobadas,
    anchoSalaCm: obs.geometria?.sala.anchoCm ?? null,
  };
}

/** La estructura y la proporción de tamaños de una pieza sin banda: lo que el informe muestra como hueco de cobertura. */
export const etiquetaSinBanda = (p: PiezaEspec): string => `${p.oficial}:${p.tamanos}`;

export const clasesDe = (r: Resultado): string[] => r.chequeos.flatMap((c) => c.clases);

export function fallaConClase(e: Escenario, clase: string): boolean {
  return evaluar(observar(e.espec)).some((c) => c.clases.includes(clase));
}

const OPCIONALES = ["flores", "remate", "densidad", "capas", "forma", "unidades", "declarada", "medidas"] as const;

/** El escenario mínimo que todavía produce la clase: una pieza, sin opcionales, con un solo color si se puede. */
export function minimizar(e: Escenario, clase: string): Escenario {
  const falla = (candidato: Escenario): boolean => fallaConClase(candidato, clase);
  let actual = e;
  for (const pieza of e.espec.piezas) {
    if (e.espec.piezas.length === 1) break;
    const candidato: Escenario = { ...actual, espec: { ...actual.espec, piezas: [pieza] } };
    if (falla(candidato)) { actual = candidato; break; }
  }
  for (let i = 0; i < actual.espec.piezas.length; i++) {
    for (const campo of OPCIONALES) {
      const pieza = actual.espec.piezas[i]!;
      if (!(campo in pieza)) continue;
      const resto: Record<string, unknown> = { ...pieza };
      delete resto[campo];
      const candidato = conPieza(actual, i, resto as PiezaEspec);
      if (falla(candidato)) actual = candidato;
    }
    const pieza = actual.espec.piezas[i]!;
    if (pieza.colores.length > 1) {
      const candidato = conPieza(actual, i, { ...pieza, colores: [{ ...pieza.colores[0]!, peso: 1 }] });
      if (falla(candidato)) actual = candidato;
    }
  }
  return actual;
}

function conPieza(e: Escenario, indice: number, pieza: PiezaEspec): Escenario {
  const piezas = e.espec.piezas.map((p, k) => (k === indice ? pieza : p));
  const espec: EspecClienteV1 = { ...e.espec, piezas };
  return { ...e, espec };
}
