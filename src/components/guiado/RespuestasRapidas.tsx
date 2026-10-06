/**
 * Botones de respuesta rápida para la pregunta que el asistente acaba de hacer. Pulsar uno envía su texto tal
 * cual, como si el cliente lo hubiera escrito; escribir otra cosa sigue siendo posible.
 */
export function RespuestasRapidas({ opciones, onElegir, deshabilitado }: { opciones: readonly string[]; onElegir: (texto: string) => void; deshabilitado?: boolean }) {
  if (!opciones.length) return null;
  return <div className="mt-3 flex flex-wrap gap-2" aria-label="Respuestas rápidas">
    {opciones.map((opcion) => <button key={opcion} type="button" disabled={deshabilitado} onClick={() => onElegir(opcion)} className="rounded-full border border-borde-suave bg-superficie px-4 py-2.5 text-sm font-medium transition-colors hover:border-acento hover:text-acento disabled:opacity-50">{opcion}</button>)}
  </div>;
}

/**
 * El asistente cierra cada pregunta con una línea `Opciones: a | b | c` (regla del prompt guiado). Se separa del
 * texto visible y se devuelve como botones; un mensaje sin esa línea no trae botones.
 */
export function separarOpciones(texto: string): { texto: string; opciones: string[] } {
  const lineas = texto.trimEnd().split("\n");
  const ultima = lineas.at(-1)?.trim() ?? "";
  const coincide = /^\**\s*opciones\s*:\**\s*(.+)$/i.exec(ultima);
  if (!coincide) return { texto, opciones: [] };
  const opciones = [...new Set(coincide[1]!.split("|").map((opcion) => opcion.replace(/\*+/g, "").trim()).filter((opcion) => opcion.length > 0 && opcion.length <= 60))].slice(0, 6);
  return { texto: lineas.slice(0, -1).join("\n").trimEnd(), opciones };
}
