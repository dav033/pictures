import type { Escena } from "./escena";
import type { FotoAdjuntaIA } from "./cuerpo-escena-ia";
import type { Encuadre } from "./encuadre-foto";
import { decidirAceptacion, revisarEstructura, type Similitud, type Veredicto } from "./aceptacion-refinado";
import type { ContextoEvaluacion } from "./refinar-foto-cliente";

/**
 * El criterio de aceptación de una ronda de refinado, del lado del navegador (REQ-001 paso 9, P-016): captura la escena
 * de después, pide al servidor qué tanto se parece cada captura a la foto (`/api/escena-ia/similitud`) y suma la revisión
 * de la estructura (`aceptacion-refinado.ts`). Sin React; la captura y el pedido se inyectan para probarlo sin red ni
 * visor. Nunca lanza: si algo falla, la ronda se rechaza («sin comparación») y se queda la versión anterior.
 */

export type PedirSimilitud = (cuerpo: { foto: FotoAdjuntaIA; antes: FotoAdjuntaIA; despues: FotoAdjuntaIA }, signal: AbortSignal) => Promise<Similitud | null>;

export type DependenciasEvaluador = {
  capturar: (escena: Escena, encuadre: Encuadre) => Promise<FotoAdjuntaIA>;
  similitud: PedirSimilitud;
};

export function crearEvaluadorDeRonda(deps: DependenciasEvaluador): (contexto: ContextoEvaluacion) => Promise<Veredicto> {
  return async (c) => {
    try {
      // La estructura se revisa primero: es gratis y, si falla, no hace falta capturar ni pagar los embeddings.
      const estructura = revisarEstructura(c.antes, c.despues, c.encuadre, { permiteReducir: c.permiteReducir });
      if (estructura) return decidirAceptacion(null, estructura);
      const capturaDespues = await deps.capturar(c.despues, c.encuadre);
      if (c.signal.aborted) return decidirAceptacion(null, null);
      return decidirAceptacion(await deps.similitud({ foto: c.foto, antes: c.capturaAntes, despues: capturaDespues }, c.signal), null);
    } catch {
      return decidirAceptacion(null, null);
    }
  };
}

const esSimilitud = (v: unknown): v is Similitud =>
  typeof v === "object" && v !== null && Number.isFinite((v as { antes?: unknown }).antes) && Number.isFinite((v as { despues?: unknown }).despues);

/** El pedido real a `/api/escena-ia/similitud` con las cabeceras de la conversación; `null` si no se pudo comparar. */
export function pedirSimilitudHttp(cabeceras: Record<string, string>, origen = ""): PedirSimilitud {
  return async (cuerpo, signal) => {
    try {
      const r = await fetch(`${origen}/api/escena-ia/similitud`, { method: "POST", headers: { "Content-Type": "application/json", ...cabeceras }, body: JSON.stringify(cuerpo), signal });
      const datos: unknown = await r.json().catch(() => null);
      return r.ok && esSimilitud(datos) ? { antes: datos.antes, despues: datos.despues } : null;
    } catch {
      return null;
    }
  };
}
