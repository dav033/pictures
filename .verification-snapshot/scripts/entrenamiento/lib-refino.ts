/**
 * El bucle de refino de una pasada: hasta N vueltas del asistente sobre la escena armada, puntuando cada una (`lib-convergencia.ts` decide
 * cuándo parar). Se queda con la escena de la vuelta de mejor puntuación (la del turno 0 si ninguna vuelta mejora): un asistente que empeora
 * una escena no la deja peor. Separado de `lib-pasada.ts` para probarlo con un asistente falso. Nunca lanza: un fallo del asistente corta el
 * refino y queda en `error`.
 */
import type { Escena } from "@/lib/globos3d/escena";
import type { PuntajeDeTurno } from "./lib-agregado";
import { evaluarTurno, type MotivoParada, type TurnoEvaluado } from "./lib-convergencia";
import type { PuntuacionEscena } from "./lib-puntuacion";

export type RespuestaTurno = { escena: Escena; respuesta: string; acciones: ReadonlyArray<{ consulta: boolean }> };
export type MensajeHistorial = { rol: "usuario" | "asistente"; texto: string };

export type EntradaRefino = {
  escena: Escena;
  turnos: number;
  mensaje: string;
  historialInicial: MensajeHistorial[];
  /** ¿Queda margen de coste y de llamadas para otra vuelta? */
  margen: () => boolean;
  atender: (escena: Escena, historial: MensajeHistorial[]) => Promise<RespuestaTurno>;
  puntuar: (escena: Escena) => PuntuacionEscena | null;
};

export type ResultadoRefino = {
  /** La escena de la mejor vuelta. */
  escena: Escena;
  turnosHechos: number;
  convergio: boolean;
  motivoParada: MotivoParada | null;
  puntajePorTurno: PuntajeDeTurno[];
  /** La vuelta (0: la escena de la lectura) cuya escena se conserva. */
  turnoConservado: number;
  erroresAgente: number;
  error: string | null;
};

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function refinarEscena(o: EntradaRefino): Promise<ResultadoRefino> {
  const base = o.puntuar(o.escena);
  const puntajePorTurno: PuntajeDeTurno[] = base ? [{ turno: 0, puntajes: base.puntajes, puntajesTodos: base.puntajesTodos, soloConsulta: null }] : [];
  const evaluados: TurnoEvaluado[] = [];
  let actual = o.escena, historial = o.historialInicial;
  let mejor = { escena: o.escena, proporciones: base?.puntajes.proporciones ?? null, turno: 0 };
  const salida: ResultadoRefino = { escena: o.escena, turnosHechos: 0, convergio: false, motivoParada: null, puntajePorTurno, turnoConservado: 0, erroresAgente: 0, error: null };
  for (let t = 1; t <= o.turnos; t += 1) {
    if (!o.margen()) break;
    try {
      const dato = await o.atender(actual, historial);
      actual = dato.escena;
      salida.turnosHechos += 1;
      historial = [...historial, { rol: "usuario", texto: o.mensaje }, { rol: "asistente", texto: dato.respuesta.slice(0, 1500) }];
      const medida = o.puntuar(actual);
      const soloConsulta = dato.acciones.every((a) => a.consulta);
      if (medida) puntajePorTurno.push({ turno: t, puntajes: medida.puntajes, puntajesTodos: medida.puntajesTodos, soloConsulta });
      const proporciones = medida?.puntajes.proporciones ?? null;
      // Sin puntaje no hay con qué comparar: la última escena manda. Con él, solo una vuelta que mejora (estrictamente) desplaza a la conservada.
      if (proporciones === null || mejor.proporciones === null || proporciones > mejor.proporciones) mejor = { escena: actual, proporciones, turno: t };
      evaluados.push({ soloConsulta, sinAcciones: dato.acciones.length === 0, proporciones });
      const veredicto = evaluarTurno(evaluados, base?.puntajes.proporciones ?? null);
      if (!veredicto.seguir) { salida.convergio = veredicto.convergio; salida.motivoParada = veredicto.motivo; break; }
    } catch (e) {
      salida.erroresAgente += 1;
      salida.error = mensajeDe(e);
      break;
    }
  }
  return { ...salida, escena: mejor.escena, turnoConservado: mejor.turno };
}
