import type { Escena } from "../escena";
import type { FotoAdjuntaIA } from "../cuerpo-escena-ia";
import type { Encuadre } from "../encuadre-foto";
import { veredictoSinComparar, type Veredicto } from "./motivos";
import type { ContextoEvaluacion } from "./bucle";

/**
 * El criterio de aceptación de una ronda de refinado, del lado del navegador (REQ-001 paso 9, P-016): captura la escena de
 * después y se la manda al servidor junto con la foto, la de antes y las dos escenas (`/api/escena-ia/similitud`); el servidor
 * decide y lo registra (`similitud-servidor.ts`), aquí solo se recibe el veredicto. Sin React; la captura, la reducción de la
 * foto y el pedido se inyectan para probarlo sin red ni visor. Nunca lanza: si algo falla, la ronda se rechaza («sin
 * comparación») y se queda la versión anterior.
 */

/** Lo que se le manda al servidor para que decida una ronda. */
export type CuerpoVeredicto = {
  foto: FotoAdjuntaIA;
  antes: FotoAdjuntaIA;
  despues: FotoAdjuntaIA;
  escenaAntes: Escena;
  escenaDespues: Escena;
  lectura: unknown;
  ronda: number;
};

export type PedirVeredicto = (cuerpo: CuerpoVeredicto, signal: AbortSignal) => Promise<Veredicto | null>;

export type DependenciasEvaluador = {
  capturar: (escena: Escena, encuadre: Encuadre) => Promise<FotoAdjuntaIA>;
  /** Lleva la foto del usuario al tamaño de las capturas (1024 px): el servidor solo admite imágenes de ese tamaño. */
  reducirFoto: (foto: FotoAdjuntaIA) => Promise<FotoAdjuntaIA>;
  veredicto: PedirVeredicto;
};

export function crearEvaluadorDeRonda(deps: DependenciasEvaluador): (contexto: ContextoEvaluacion) => Promise<Veredicto> {
  // La foto es la misma en todas las rondas: se reduce una sola vez.
  let reducida: { original: FotoAdjuntaIA; promesa: Promise<FotoAdjuntaIA> } | null = null;
  const fotoReducida = (foto: FotoAdjuntaIA): Promise<FotoAdjuntaIA> => {
    if (reducida?.original !== foto) reducida = { original: foto, promesa: deps.reducirFoto(foto) };
    return reducida.promesa;
  };
  return async (c) => {
    try {
      const capturaDespues = await deps.capturar(c.despues, c.encuadre);
      if (c.signal.aborted) return veredictoSinComparar();
      const veredicto = await deps.veredicto(
        { foto: await fotoReducida(c.foto), antes: c.capturaAntes, despues: capturaDespues, escenaAntes: c.antes, escenaDespues: c.despues, lectura: c.lectura, ronda: c.ronda },
        c.signal,
      );
      return veredicto ?? veredictoSinComparar();
    } catch {
      return veredictoSinComparar();
    }
  };
}
