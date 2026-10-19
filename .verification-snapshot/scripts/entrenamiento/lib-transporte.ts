/**
 * El transporte de Claude que usa el arnés en real, leído como lo normaliza la config de Claude local (sin espacios ni
 * mayúsculas; cualquier valor que no sea `cli` es `api`). Con `cli` (la suscripción de Claude Code) no hay precio por modelo
 * ni llave: la llamada va con el alias del modelo y cuesta 0; el tope que queda es el de llamadas.
 */
import type { TransporteArnes } from "./lib-agregado";

type Entorno = Readonly<Record<string, string | undefined>>;

export function transporteDeClaude(entorno: Entorno): Exclude<TransporteArnes, "seco"> {
  return entorno.IA_CLAUDE_TRANSPORTE?.trim().toLowerCase() === "cli" ? "cli" : "api";
}

/**
 * El arnés y la app tienen que hablar del mismo transporte: la guarda de red de `cli` bloquea todo `fetch`, así que si la app
 * enviara por la API cada foto fallaría anotada como `cli`. `transporteDeLaApp` es el de su config, o `undefined` si esta
 * versión de la app aún no distingue transportes (solo existe la API).
 */
export function verificarTransporteDeLaApp(esperado: Exclude<TransporteArnes, "seco">, transporteDeLaApp: string | undefined): void {
  if (transporteDeLaApp === undefined && esperado === "cli") {
    throw new Error("IA_CLAUDE_TRANSPORTE=cli, pero esta versión de la app no tiene el transporte cli: el arnés no corre contra otro transporte.");
  }
  if (transporteDeLaApp !== undefined && transporteDeLaApp !== esperado) {
    throw new Error(`El arnés espera el transporte «${esperado}» (IA_CLAUDE_TRANSPORTE) y la app usa «${transporteDeLaApp}».`);
  }
}
