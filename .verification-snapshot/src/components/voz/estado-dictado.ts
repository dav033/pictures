export type CodigoErrorDictado =
  | "sin_permiso"
  | "sin_microfono"
  | "sin_conexion"
  | "muy_corto"
  | "demasiado_largo"
  | "ocupado"
  | "demasiados"
  | "sesion"
  | "no_disponible"
  | "no_se_entendio"
  | "fallo";

export type EstadoDictado =
  | { fase: "reposo"; error: CodigoErrorDictado | null }
  | { fase: "permiso" }
  | { fase: "grabando" }
  | { fase: "transcribiendo" };

export type EventoDictado =
  | { tipo: "pedir" }
  | { tipo: "grabando" }
  | { tipo: "detener" }
  | { tipo: "cancelar" }
  | { tipo: "terminado" }
  | { tipo: "fallo"; codigo: CodigoErrorDictado }
  | { tipo: "descartar_error" };

export const ESTADO_INICIAL: EstadoDictado = { fase: "reposo", error: null };

/** La máquina de estados del dictado: reposo → permiso → grabando → transcribiendo → reposo. Un evento fuera de turno no cambia nada. */
export function reducirDictado(estado: EstadoDictado, evento: EventoDictado): EstadoDictado {
  switch (evento.tipo) {
    case "pedir": return estado.fase === "reposo" ? { fase: "permiso" } : estado;
    case "grabando": return estado.fase === "permiso" ? { fase: "grabando" } : estado;
    case "detener": return estado.fase === "grabando" ? { fase: "transcribiendo" } : estado;
    case "cancelar": return estado.fase === "reposo" ? estado : { fase: "reposo", error: null };
    case "terminado": return estado.fase === "transcribiendo" ? { fase: "reposo", error: null } : estado;
    case "fallo": return { fase: "reposo", error: evento.codigo };
    case "descartar_error": return estado.fase === "reposo" && estado.error ? { fase: "reposo", error: null } : estado;
  }
}

/** 0:07, 1:00. */
export function formatearTiempo(segundos: number): string {
  const entero = Math.max(0, Math.floor(segundos));
  return `${Math.floor(entero / 60)}:${String(entero % 60).padStart(2, "0")}`;
}
