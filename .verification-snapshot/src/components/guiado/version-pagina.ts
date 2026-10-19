import { CABECERA_VERSION_APP } from "@/lib/registro/tipos";

/**
 * Una pestaña abierta antes de un despliegue habla con el servidor NUEVO con su código VIEJO (probador 124, hallazgo 2):
 * el cliente validaba la respuesta con su esquema viejo, decía «Se cortó la conexión», «Reintentar» fallaba igual y, al
 * recargar, el mensaje quedaba sin respuesta y sin «Reintentar». Aquí se decide, sin React ni red, qué pasó y qué decir:
 * la página sabe con qué código se sirvió (`versionCodigo()` de la página) y cada respuesta de /api dice con cuál se
 * respondió (cabecera `x-version-app`, `conRegistro`). Puro: lo prueba scripts/test/test-interfaz-probador-124.ts.
 */

export { CABECERA_VERSION_APP };

/** Una versión con la que se puede comparar: la de un commit, no «desconocida» ni la de un árbol local con cambios. */
export function versionComparable(version: string | null | undefined): version is string {
  const limpia = version?.trim() ?? "";
  return limpia !== "" && limpia !== "desconocida" && !limpia.endsWith("+local");
}

/** El servidor que respondió es de otro despliegue que la página (solo si las dos versiones se pueden comparar). */
export function hayVersionNueva(versionPagina: string | null | undefined, versionServidor: string | null | undefined): boolean {
  return versionComparable(versionPagina) && versionComparable(versionServidor) && versionPagina.trim() !== versionServidor.trim();
}

/**
 * La respuesta del asistente no se puede usar con el código de esta página: el servidor anunció otra versión
 * (`motivo: "version"`) o lo que mandó no pasa el esquema de la página (`motivo: "contrato"`).
 */
export class RespuestaIncompatibleError extends Error {
  readonly motivo: "version" | "contrato";
  readonly versionServidor: string | null;
  /** Los campos que no pasaron el esquema (rutas, sin valores): van al registro para saber qué cambió. */
  readonly campos: readonly string[];
  constructor(motivo: "version" | "contrato", mensaje: string, versionServidor: string | null, opciones: { campos?: readonly string[]; cause?: unknown } = {}) {
    super(mensaje, opciones.cause === undefined ? undefined : { cause: opciones.cause });
    this.name = "RespuestaIncompatibleError";
    this.motivo = motivo;
    this.versionServidor = versionServidor;
    this.campos = opciones.campos ?? [];
  }
}

/** Rutas de los campos que no pasaron un esquema de zod («brief.estructura»), como mucho seis; nunca los valores. */
export function camposInvalidos(error: unknown): string[] {
  if (!error || typeof error !== "object" || !("issues" in error) || !Array.isArray(error.issues)) return [];
  return error.issues.slice(0, 6).map((issue: unknown) => {
    const ruta = issue && typeof issue === "object" && "path" in issue && Array.isArray(issue.path) ? issue.path.map(String).join(".") : "";
    const claves = issue && typeof issue === "object" && "keys" in issue && Array.isArray(issue.keys) ? issue.keys.map(String) : [];
    // Una clave que el esquema de la página no conoce (`unrecognized_keys`) se nombra: es la huella de otro despliegue.
    const base = ruta || "(raíz)";
    return claves.length ? `${base}: ${claves.slice(0, 4).join(", ")}` : base;
  });
}

export type FalloDeRespuesta = "version-nueva" | "contrato";

/**
 * Qué decirle al cliente. Otra versión anunciada: hay una página nueva. Un esquema que no pasa: también, salvo que las dos
 * versiones se sepan y sean la misma (entonces no es un despliegue y recargar no lo arregla: «Reintentar»). Sin versiones
 * comparables (desarrollo local) un esquema que no pasa se trata como versión nueva: recargar trae el código del servidor.
 */
export function clasificarIncompatible(error: Pick<RespuestaIncompatibleError, "motivo" | "versionServidor">, versionPagina: string | null | undefined): FalloDeRespuesta {
  if (error.motivo === "version") return "version-nueva";
  const mismaVersion = versionComparable(versionPagina) && versionComparable(error.versionServidor) && versionPagina.trim() === error.versionServidor.trim();
  return mismaVersion ? "contrato" : "version-nueva";
}

/** Lo que se le dice al cliente con una versión nueva: la conversación está en la sesión y vuelve al recargar. */
export const AVISO_VERSION_NUEVA = {
  titulo: "Hay una versión nueva de la página",
  detalle: "Recarga para seguir; tu conversación se conserva.",
  etiqueta: "Recargar",
} as const;

/**
 * El último mensaje del cliente quedó sin respuesta (un turno que falló, o una recarga a mitad de uno): la conversación
 * restaurada termina en él. Null si termina en el asistente o en un mensaje vacío.
 */
export function turnoSinRespuesta<M extends { role: "user" | "assistant"; content: string }>(mensajes: readonly M[]): M | null {
  const ultimo = mensajes.at(-1);
  return ultimo?.role === "user" && ultimo.content.trim() ? ultimo : null;
}

/**
 * «Reintentar» repite el MISMO mensaje del cliente: el id de su último mensaje si dice lo mismo, para conservar su
 * burbuja. Con un id nuevo la burbuja vieja salía mientras entraba otra igual y se veían dos (probador 124, hallazgo 14).
 * Null: no hay a quién repetir (y se crea un mensaje nuevo).
 */
export function idParaReintento(mensajes: ReadonlyArray<{ id: string; role: "user" | "assistant"; content: string }>, contenido: string): string | null {
  for (let indice = mensajes.length - 1; indice >= 0; indice -= 1) {
    const mensaje = mensajes[indice]!;
    if (mensaje.role === "user") return mensaje.content === contenido ? mensaje.id : null;
  }
  return null;
}
