import { MOTIVO_IDS, type MotivoId } from "@/lib/feedback-ia/motivos";
import { MAX_TURNOS_CONSULTA, type CalificacionGuardada, type ProductoFeedback } from "@/lib/feedback-ia/contrato";
import { esIdSeguro } from "./cliente-feedback";

/**
 * La calificación guardada de un turno, para mostrarla seleccionada al recargar la página (REQ-010). Los turnos que se piden a la
 * vez salen en peticiones GET de hasta 100 ids, y cada turno se pide una vez por página. Lo que se califica en esta página se
 * recuerda con `recordarCalificacion`. Un fallo se recuerda FALLO_TTL_MS (sin reintentos en bucle).
 */

export const FALLO_TTL_MS = 30_000;

type Peticion = { turnoId: string; resolver: (calificacion: CalificacionGuardada | null) => void };
type Lote = { producto: ProductoFeedback; buscar: typeof fetch; peticiones: Peticion[] };

const pedidas = new Map<string, Promise<CalificacionGuardada | null>>();
const fallidasHasta = new Map<string, number>();
const pendientes = new Map<ProductoFeedback, Lote>();

const claveDe = (producto: ProductoFeedback, turnoId: string) => `${producto}:${turnoId}`;
const esMotivo = (valor: unknown): valor is MotivoId => typeof valor === "string" && (MOTIVO_IDS as readonly string[]).includes(valor);

/** Una fila con la forma del contrato; los motivos que el cliente no conoce se descartan y la fila se conserva. */
function leerCalificacion(valor: unknown): CalificacionGuardada | null {
  if (typeof valor !== "object" || valor === null) return null;
  const campos = valor as Record<string, unknown>;
  if (typeof campos.turnoId !== "string") return null;
  if (campos.calificacion !== null && typeof campos.calificacion !== "number") return null;
  if (typeof campos.comentario !== "string" || typeof campos.deshecho !== "boolean" || !Array.isArray(campos.motivos)) return null;
  return {
    turnoId: campos.turnoId,
    calificacion: campos.calificacion,
    motivos: campos.motivos.filter(esMotivo),
    comentario: campos.comentario,
    deshecho: campos.deshecho,
  };
}

/** Las calificaciones de un lote, por id de turno; `undefined` si la petición falló. */
async function leerLote(lote: Lote, turnos: string[]): Promise<Map<string, CalificacionGuardada> | undefined> {
  try {
    const r = await lote.buscar(`/api/feedback-ia?producto=${lote.producto}&turnos=${turnos.join(",")}`, { credentials: "same-origin" });
    const cuerpo: unknown = await r.json().catch(() => null);
    if (!r.ok || typeof cuerpo !== "object" || cuerpo === null) return undefined;
    const lista = (cuerpo as { calificaciones?: unknown }).calificaciones;
    if (!Array.isArray(lista)) return undefined;
    const filas = lista.map(leerCalificacion).filter((fila): fila is CalificacionGuardada => fila !== null);
    return new Map(filas.map((fila) => [fila.turnoId, fila]));
  } catch {
    return undefined;
  }
}

async function enviarLote(lote: Lote, ahora: () => number): Promise<void> {
  for (let desde = 0; desde < lote.peticiones.length; desde += MAX_TURNOS_CONSULTA) {
    const trozo = lote.peticiones.slice(desde, desde + MAX_TURNOS_CONSULTA);
    const mapa = await leerLote(lote, trozo.map((peticion) => peticion.turnoId));
    for (const peticion of trozo) {
      const clave = claveDe(lote.producto, peticion.turnoId);
      if (mapa === undefined) {
        pedidas.delete(clave);
        fallidasHasta.set(clave, ahora() + FALLO_TTL_MS);
      }
      peticion.resolver(mapa?.get(peticion.turnoId) ?? null);
    }
  }
}

function vaciar(ahora: () => number): void {
  const lotes = [...pendientes.values()];
  pendientes.clear();
  for (const lote of lotes) void enviarLote(lote, ahora);
}

/**
 * Pide la calificación guardada de un turno; las pedidas en el mismo momento salen en una sola petición. Un fallo reciente
 * devuelve `null` sin volver a salir a la red. Nunca lanza.
 */
export function pedirCalificacionGuardada(
  producto: ProductoFeedback,
  turnoId: string,
  buscar: typeof fetch = fetch,
  ahora: () => number = Date.now,
): Promise<CalificacionGuardada | null> {
  if (!esIdSeguro(turnoId)) return Promise.resolve(null);
  const clave = claveDe(producto, turnoId);
  const previa = pedidas.get(clave);
  if (previa) return previa;
  const hasta = fallidasHasta.get(clave);
  if (hasta !== undefined && hasta > ahora()) return Promise.resolve(null);
  const pedida = new Promise<CalificacionGuardada | null>((resolver) => {
    const lote = pendientes.get(producto) ?? { producto, buscar, peticiones: [] };
    if (pendientes.size === 0) setTimeout(() => vaciar(ahora), 0);
    pendientes.set(producto, lote);
    lote.peticiones.push({ turnoId, resolver });
  });
  pedidas.set(clave, pedida);
  return pedida;
}

/** Lo que esta página acaba de guardar para un turno: la siguiente carga (p. ej. al volver a montar) lo muestra sin pedirlo. */
export function recordarCalificacion(producto: ProductoFeedback, calificacion: CalificacionGuardada): void {
  const clave = claveDe(producto, calificacion.turnoId);
  fallidasHasta.delete(clave);
  pedidas.set(clave, Promise.resolve(calificacion));
}

/** Para las pruebas: olvida lo pedido, los fallos y lo pendiente. */
export function reiniciarCargasCalificacion(): void {
  pedidas.clear();
  fallidasHasta.clear();
  pendientes.clear();
}
