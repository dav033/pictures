import "server-only";
import { configuracion } from "./configuracion";
import { sanearIdConversacion, sanearIdSolicitud } from "./contexto";
import { diagnosticoEscritor } from "./escritor";
import { serializarError } from "./redaccion";
import { auditar, informar, registrar } from "./registro";
import { CABECERA_CONVERSACION, CABECERA_SOLICITUD, CABECERA_VISTA } from "./tipos";

/**
 * Lo que engancha src/instrumentation.ts: una línea de arranque y la captura de errores del proceso y de
 * peticiones sin manejar (onRequestError de Next). Solo observa: no cambia cómo muere o sigue el proceso.
 */

declare global {
  var __registroProcesoIniciado: boolean | undefined;
}

export function iniciarRegistroDelProceso(datos: Record<string, unknown> = {}): void {
  if (globalThis.__registroProcesoIniciado) return;
  globalThis.__registroProcesoIniciado = true;
  try {
    const cfg = configuracion();
    informar("servidor.arranque", {
      ...datos,
      pid: process.pid,
      node: process.version,
      entorno: cfg.entorno,
      raizRegistros: diagnosticoEscritor().raizActiva,
      archivos: cfg.archivosActivos,
      nivelArchivo: cfg.nivelArchivo,
      nivelStdout: cfg.nivelStdout,
      auditoriaEnStdout: cfg.auditoriaEnStdout,
    });
    // `uncaughtExceptionMonitor` observa sin impedir que el proceso termine (a diferencia de `uncaughtException`).
    // También ve los rechazos sin manejar cuando nadie escucha `unhandledRejection` (Node los convierte en excepción).
    process.on("uncaughtExceptionMonitor", (error, origen) => {
      registrar("error", "proceso.excepcion_no_capturada", { origen }, { error });
    });
    // Si alguien ya escucha `unhandledRejection` (Next lo hace), el proceso no muere por ellos: añadir otro
    // oyente no cambia esa semántica y así quedan registrados.
    if (process.listenerCount("unhandledRejection") > 0) {
      process.on("unhandledRejection", (razon) => {
        registrar("error", "proceso.rechazo_no_manejado", undefined, { error: razon });
      });
    }
  } catch {
    // Nunca lanza.
  }
}

function cabecera(cabeceras: NodeJS.Dict<string | string[]>, nombre: string): string | undefined {
  const valor = cabeceras[nombre];
  return Array.isArray(valor) ? valor[0] : valor;
}

/** Para `onRequestError`: cualquier error de render, route handler, server action o proxy que Next vea. */
export function registrarErrorDePeticion(
  error: unknown,
  peticion: Readonly<{ path: string; method: string; headers: NodeJS.Dict<string | string[]> }>,
  contexto: Readonly<{ routerKind: string; routePath: string; routeType: string; renderSource?: string }>,
): void {
  try {
    const solicitud = sanearIdSolicitud(cabecera(peticion.headers, CABECERA_SOLICITUD)) ?? "sin-solicitud";
    const conversacion = sanearIdConversacion(cabecera(peticion.headers, CABECERA_CONVERSACION));
    const vista = cabecera(peticion.headers, CABECERA_VISTA)?.slice(0, 32);
    const contextoRegistro = { solicitud, ...(conversacion ? { conversacion } : {}), ...(vista ? { vista } : {}), ruta: contexto.routePath, inicio: Date.now() };
    const datos = { metodo: peticion.method, ruta: peticion.path, routePath: contexto.routePath, routeType: contexto.routeType, routerKind: contexto.routerKind, ...(contexto.renderSource ? { renderSource: contexto.renderSource } : {}) };
    registrar("error", "peticion.error_no_controlado", datos, { error, contexto: contextoRegistro });
    if (conversacion) auditar("error", { origen: `next:${contexto.routeType}`, error: serializarError(error), datos }, { contexto: contextoRegistro });
  } catch {
    // Nunca lanza.
  }
}
