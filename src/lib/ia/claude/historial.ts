import { bytesDeBase64, type LlamadaHerramienta, type Mensaje } from "@sempertex/agente-core";
import { META_CONTENIDO, esUsoHerramienta } from "./respuesta";
import type { BloqueCrudo, BloqueEntrada, MensajeAnthropic } from "./tipos";

/**
 * Transcript neutral (`Mensaje[]`) → `messages` de Anthropic. Reglas de la API (NOTES.md §6.5):
 * - el historial es de solo agregar: cada turno del modelo se reenvía tal como llegó (con su razonamiento);
 * - los `tool_result` de un turno van juntos en el siguiente mensaje de usuario, antes de cualquier texto;
 * - mensajes seguidos del mismo rol se juntan; el primero es del usuario; nunca termina en el asistente (sin prefill);
 * - un bloque de texto vacío es un 400: no se manda.
 * A diferencia de Gemini, las imágenes se reenvían en cada vuelta: quitarlas cambiaría un mensaje anterior.
 */

const TEXTO_VACIO = "(sin texto)";

function bloquesDeUsuario(mensaje: Extract<Mensaje, { rol: "usuario" }>): { bloques: BloqueEntrada[]; bytes: number } {
  const bloques: BloqueEntrada[] = [];
  let bytes = 0;
  // Mismo rótulo que el adaptador de Gemini: el modelo no ve EXIF/XMP; el ID llega como texto junto a cada imagen.
  for (const imagen of mensaje.imagenes ?? []) {
    if (imagen.id) bloques.push({ type: "text", text: `[IMAGEN_ID=${imagen.id}]${imagen.descripcion ? ` ${imagen.descripcion}` : ""}` });
    bloques.push({ type: "image", source: { type: "base64", media_type: imagen.mime, data: imagen.base64 } });
    bytes += bytesDeBase64(imagen.base64);
  }
  if (mensaje.texto.trim()) bloques.push({ type: "text", text: mensaje.texto });
  if (!bloques.length) bloques.push({ type: "text", text: TEXTO_VACIO });
  return { bloques, bytes };
}

/**
 * El turno del modelo con sus llamadas: tal cual llegó si las llamadas son las mismas (mismos ids, mismo orden); si no
 * (un historial armado por otro proveedor), se rearma con un `tool_use` por llamada.
 */
function bloquesDeLlamadas(llamadas: readonly LlamadaHerramienta[], idDe: (llamada: LlamadaHerramienta, indice: number) => string): BloqueEntrada[] {
  const original = llamadas[0]?.meta?.[META_CONTENIDO];
  if (Array.isArray(original)) {
    const contenido = original as BloqueCrudo[];
    const ids = contenido.filter(esUsoHerramienta).map((bloque) => bloque.id);
    if (ids.length === llamadas.length && ids.every((id, indice) => id === llamadas[indice]!.id)) return contenido;
  }
  return llamadas.map((llamada, indice) => ({ type: "tool_use", id: idDe(llamada, indice), name: llamada.nombre, input: llamada.args }));
}

/** Copia el arreglo: el contenido reenviado tal cual es el mismo objeto guardado en `meta` y no se debe mutar. */
function juntar(mensajes: MensajeAnthropic[], siguiente: MensajeAnthropic): void {
  const ultimo = mensajes[mensajes.length - 1];
  if (ultimo?.role === siguiente.role) ultimo.content.push(...siguiente.content);
  else mensajes.push({ role: siguiente.role, content: [...siguiente.content] });
}

export function historialAMensajes(historial: readonly Mensaje[]): { mensajes: MensajeAnthropic[]; bytesImagen: number } {
  const mensajes: MensajeAnthropic[] = [];
  let bytesImagen = 0;
  let generados = 0;
  // Llamadas sin id (Gemini a veces no lo manda): el id inventado se empareja con su resultado por nombre y orden.
  let sinResultado: Array<{ nombre: string; id: string }> = [];

  for (const mensaje of historial) {
    if (mensaje.rol === "usuario") {
      const { bloques, bytes } = bloquesDeUsuario(mensaje);
      bytesImagen += bytes;
      juntar(mensajes, { role: "user", content: bloques });
    } else if (mensaje.rol === "asistente" && "texto" in mensaje) {
      if (mensaje.texto.trim()) juntar(mensajes, { role: "assistant", content: [{ type: "text", text: mensaje.texto }] });
    } else if (mensaje.rol === "asistente") {
      const ids = mensaje.llamadas.map((llamada) => llamada.id ?? `toolu_local_${(generados += 1)}`);
      sinResultado = mensaje.llamadas.map((llamada, indice) => ({ nombre: llamada.nombre, id: ids[indice]! }));
      juntar(mensajes, { role: "assistant", content: bloquesDeLlamadas(mensaje.llamadas, (_llamada, indice) => ids[indice]!) });
    } else {
      const pendiente = mensaje.llamadaId
        ? sinResultado.find((llamada) => llamada.id === mensaje.llamadaId)
        : sinResultado.find((llamada) => llamada.nombre === mensaje.nombre) ?? sinResultado[0];
      if (pendiente) sinResultado = sinResultado.filter((llamada) => llamada !== pendiente);
      const contenido = JSON.stringify(mensaje.resultado ?? null);
      juntar(mensajes, { role: "user", content: [{ type: "tool_result", tool_use_id: mensaje.llamadaId ?? pendiente?.id ?? `toolu_local_${(generados += 1)}`, content: contenido }] });
    }
  }

  if (mensajes[0]?.role === "assistant") mensajes.unshift({ role: "user", content: [{ type: "text", text: "(continúa la conversación)" }] });
  return { mensajes, bytesImagen };
}
