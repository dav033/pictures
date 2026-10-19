import { ErrorImagen } from "@/lib/generacion/pedir-imagen";
import { CODIGO_MOTOR_3D_CORTADO } from "@/lib/guiada-motor/corte-motor3d";
import type { FuenteMotor } from "@/lib/guiada-motor/tipos";
import type { AvisosRecalculo } from "./aviso-recalculo";

/**
 * El aviso de que un plan del 3D abierto tiene que recalcularse con el método de siempre porque el 3D está cortado (P-049).
 * Sin React: la vista guiada se suscribe; la armada y la imagen lo publican cuando el servidor responde `MOTOR_3D_CORTADO`, y la
 * carga de la conversación lo publica si el plan del 3D abierto encuentra el corte puesto.
 * `origen` dice qué lo disparó:
 * - `carga`: se abrió la conversación con un plan del 3D;
 * - `dibujo`: la vista pidió la armada por su cuenta (las miniaturas), sin que el cliente tocara nada;
 * - `toque`: el cliente pidió «Ver cómo quedaría» y la imagen no llegó. Es una respuesta a lo que él hizo, así que se le contesta
 *   aunque el aviso ya se hubiera mostrado antes (si no, el botón se quedaba girando sin decir nada).
 * Ninguno cambia el plan.
 */
export { CODIGO_MOTOR_3D_CORTADO };
export type OrigenAviso = "carga" | "dibujo" | "toque";
export type EscuchaCorte3d = (planHash: string, origen: OrigenAviso) => void;

const escuchas = new Set<EscuchaCorte3d>();

export function suscribirCorte3d(escucha: EscuchaCorte3d): () => void {
  escuchas.add(escucha);
  return () => { escuchas.delete(escucha); };
}

export function avisarCorte3d(planHash: string, origen: OrigenAviso): void {
  for (const escucha of [...escuchas]) escucha(planHash, origen);
}

/**
 * Si el fallo de una imagen es el corte del 3D lo publica como `toque` y dice que ya lo atendió; cualquier otro fallo, no.
 * `antes` corre justo antes de publicar (la vista deja ahí el registro de la causa, que debe quedar antes del aviso).
 */
export function avisarSiEsCorteDeLaImagen(causa: unknown, planHash: string, antes?: () => void): boolean {
  if (!(causa instanceof ErrorImagen) || causa.codigo !== CODIGO_MOTOR_3D_CORTADO) return false;
  antes?.();
  avisarCorte3d(planHash, "toque");
  return true;
}

/** El tipo de la acción de la tarjeta del aviso («Recalcular mi plan»). */
export const TIPO_ACCION_RECALCULAR_3D = "recalcular-3d";

/** La tarjeta que queda cuando llega un plan nuevo: el aviso de recálculo de un plan que ya no es el vigente se quita; otra tarjeta, no. */
export function sinAvisoDeCorte<F extends { accion: { tipo: string } }>(fallo: F | null): F | null {
  return fallo?.accion.tipo === TIPO_ACCION_RECALCULAR_3D ? null : fallo;
}

export type EntradaAvisoCorte = {
  planHash: string;
  origen: OrigenAviso;
  /** El plan vigente de la pantalla: el aviso solo vale si el corte nombra ESE plan. */
  planVigenteHash: string | null;
  yaAvisado: boolean;
  cargando: boolean;
  hayFallo: boolean;
};

/**
 * ¿Mostrar el aviso ahora? Solo para el plan que está en pantalla; no si hay una petición en curso ni si la tarjeta de fallo ya
 * dice algo (el aviso no pisa «Tu último mensaje quedó sin respuesta» ni su «Reintentar»); y no por segunda vez a un plan cuyo
 * cliente ya lo leyó, salvo que sea él quien lo pidió (`toque`).
 */
export function debeMostrarAvisoCorte3d({ planHash, origen, planVigenteHash, yaAvisado, cargando, hayFallo }: EntradaAvisoCorte): boolean {
  if (planVigenteHash !== planHash || cargando || hayFallo) return false;
  return origen === "toque" || !yaAvisado;
}

export type DependenciasEscucha = {
  avisos: AvisosRecalculo;
  /** Lo que la vista tiene en el momento en que llega el aviso (no al montar). */
  estado: () => { planVigenteHash: string | null; cargando: boolean; hayFallo: boolean };
  mostrar: (planHash: string, origen: OrigenAviso) => void;
};

/** La escucha de la vista: decide con `debeMostrarAvisoCorte3d`, marca al plan como avisado y deja a `mostrar` pintar la tarjeta. */
export function crearEscuchaCorte3d({ avisos, estado, mostrar }: DependenciasEscucha): EscuchaCorte3d {
  return (planHash, origen) => {
    if (!debeMostrarAvisoCorte3d({ planHash, origen, ...estado(), yaAvisado: avisos.yaAvisado(planHash) })) return;
    avisos.marcar(planHash);
    mostrar(planHash, origen);
  };
}

/** El plan del 3D que hay que avisar al cargar: solo si el corte está puesto (`fuente` `corte`). */
export function hashAvisoCorteAlCargar(planHash3d: string | null, fuente: FuenteMotor | null): string | null {
  return planHash3d !== null && fuente === "corte" ? planHash3d : null;
}
