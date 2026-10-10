import type { BrowserContext } from "playwright";

/** El tope de turnos del asistente en una pasada: cada uno es una llamada al proveedor de IA. */
export const MAX_TURNOS_DE_CHAT = 2;

const RUTA_DEL_ASISTENTE = "/api/asistente-guiado";

/**
 * Rutas que generan imágenes o llaman a modelos de pago por otro camino. Todo lo que no sea una lectura (GET: comprobar caché,
 * consultar el estado de un render) se aborta en el navegador, así un cambio de la interfaz no puede gastar sin que la prueba falle.
 */
const RUTAS_DE_PAGO: readonly string[] = [
  "/api/generate",
  "/api/guiada-imagen",
  "/api/guiada/motor/imagen",
  "/api/render-3d-imagen",
  "/api/modulos-render",
  "/api/modulos-interpretar",
  "/api/escena-ia",
  "/api/escena-desde-foto",
  "/api/taller/buscar-foto",
  "/api/references/analyze",
  "/api/laboratorio-referencias",
  "/api/chat",
  "/api/happie",
];

type Veredicto = { accion: "permitir" } | { accion: "contar-turno" } | { accion: "bloquear"; motivo: string };

export function juzgarPeticion(metodo: string, ruta: string, turnosHechos: number): Veredicto {
  if (ruta === RUTA_DEL_ASISTENTE && metodo === "POST") {
    return turnosHechos >= MAX_TURNOS_DE_CHAT ? { accion: "bloquear", motivo: `tercer turno de chat (tope ${MAX_TURNOS_DE_CHAT})` } : { accion: "contar-turno" };
  }
  const esDePago = RUTAS_DE_PAGO.some((prefijo) => ruta === prefijo || ruta.startsWith(`${prefijo}/`));
  if (esDePago && metodo !== "GET") return { accion: "bloquear", motivo: "ruta de pago" };
  return { accion: "permitir" };
}

export type GuardiaDeGasto = {
  turnosDeChat: () => number;
  bloqueadas: () => readonly string[];
};

export async function instalarGuardiaDeGasto(contexto: BrowserContext, permitirChat: boolean): Promise<GuardiaDeGasto> {
  let turnos = 0;
  const bloqueadas: string[] = [];
  await contexto.route("**/api/**", async (ruta) => {
    const peticion = ruta.request();
    const { pathname } = new URL(peticion.url());
    const veredicto = juzgarPeticion(peticion.method(), pathname, turnos);
    if (veredicto.accion === "contar-turno" && !permitirChat) {
      bloqueadas.push(`${peticion.method()} ${pathname} (turno de chat con la IA de pago de una base remota)`);
      return ruta.abort("blockedbyclient");
    }
    if (veredicto.accion === "bloquear") {
      bloqueadas.push(`${peticion.method()} ${pathname} (${veredicto.motivo})`);
      return ruta.abort("blockedbyclient");
    }
    if (veredicto.accion === "contar-turno") turnos += 1;
    return ruta.continue();
  });
  return { turnosDeChat: () => turnos, bloqueadas: () => bloqueadas };
}

export const PASO_GUARDIA = "guardia de gasto: ninguna llamada de pago";

/** Falla si la interfaz intentó alguna llamada que la guardia tuvo que abortar. */
export function comprobarGasto(guardia: GuardiaDeGasto): string {
  const bloqueadas = guardia.bloqueadas();
  if (bloqueadas.length > 0) throw new Error(`La interfaz intentó ${bloqueadas.length} llamada(s) no permitida(s): ${bloqueadas.join("; ")}`);
  return `${guardia.turnosDeChat()} turno(s) de chat, 0 llamadas de pago`;
}
