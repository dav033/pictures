/**
 * Fallo de infraestructura que el modelo no puede corregir dentro del turno:
 * el servicio comercial no respondió, o respondió algo que no cumple el
 * contrato. No es un dato de dominio que la conversación deba narrar.
 *
 * Se lanza en vez de devolverse como resultado de herramienta a propósito. Un
 * `ok:false` vuelve al historial y el modelo lo parafrasea "con sus palabras"
 * (prompt-sistema.ts), que es como una propuesta fallida acabó prometiéndole al
 * cliente un reintento que nadie le había ofrecido. Al lanzarlo, el turno
 * termina en el camino de error de /api/chat, que emite un `ui-error.v1`
 * literal y con `accion_sugerida`, sin pasar por el modelo.
 */
export class FalloTecnicoTurnoError extends Error {
  readonly motivo: string;

  constructor(motivo: string, detalle: string) {
    super(`${motivo}: ${detalle}`);
    this.name = "FalloTecnicoTurnoError";
    this.motivo = motivo;
  }
}
