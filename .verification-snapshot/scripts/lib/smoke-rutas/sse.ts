import { ChatSseEventV1Schema, type ChatSseEventV1 } from "../../../src/lib/ia/contracts/chat-v1";

/**
 * Parses the /api/chat SSE stream (`event: <type>\ndata: <json>\n\n`) and
 * validates every frame against the versioned event contract. Text deltas are
 * counted, never kept: the smoke must not log the conversation.
 */

type EventoFin = Extract<ChatSseEventV1, { type: "fin" }>;
type EventoError = Extract<ChatSseEventV1, { type: "error" }>;

export type ResultadoSse = {
  frames: number;
  deltasTexto: number;
  herramientas: Array<{ nombre: string; estado: "ejecutando" | "lista" }>;
  fin?: EventoFin;
  error?: EventoError;
  erroresContrato: string[];
  terminales: number;
};

function procesarFrame(bloque: string, resultado: ResultadoSse): void {
  let nombre: string | undefined;
  const datos: string[] = [];
  for (const linea of bloque.split("\n")) {
    if (linea.startsWith("event:")) nombre = linea.slice(6).trim();
    else if (linea.startsWith("data:")) datos.push(linea.slice(5).trimStart());
  }
  if (!nombre && datos.length === 0) return;
  resultado.frames += 1;
  let json: unknown;
  try {
    json = JSON.parse(datos.join("\n")) as unknown;
  } catch {
    resultado.erroresContrato.push(`frame ${resultado.frames}: data no es JSON`);
    return;
  }
  const parsed = ChatSseEventV1Schema.safeParse(json);
  if (!parsed.success) {
    resultado.erroresContrato.push(`frame ${resultado.frames} (${nombre ?? "?"}): no cumple ChatSseEventV1Schema: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
    return;
  }
  const evento = parsed.data;
  if (evento.type !== nombre) {
    resultado.erroresContrato.push(`frame ${resultado.frames}: event:${nombre ?? "?"} no coincide con type:${evento.type}`);
  }
  if (evento.type === "texto") resultado.deltasTexto += 1;
  else if (evento.type === "herramienta") resultado.herramientas.push({ nombre: evento.nombre, estado: evento.estado });
  else if (evento.type === "fin") {
    resultado.fin = evento;
    resultado.terminales += 1;
  } else {
    resultado.error = evento;
    resultado.terminales += 1;
  }
}

export async function leerSse(response: Response): Promise<ResultadoSse> {
  const resultado: ResultadoSse = { frames: 0, deltasTexto: 0, herramientas: [], erroresContrato: [], terminales: 0 };
  if (!response.body) {
    resultado.erroresContrato.push("respuesta sin body");
    return resultado;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let corte = buffer.indexOf("\n\n");
    while (corte >= 0) {
      procesarFrame(buffer.slice(0, corte), resultado);
      buffer = buffer.slice(corte + 2);
      corte = buffer.indexOf("\n\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) procesarFrame(buffer, resultado);
  return resultado;
}

/** Tool names in completion order, e.g. `buscar_catalogo_rag>confirmar_plan_decoracion`. */
export function secuenciaHerramientas(resultado: ResultadoSse): string {
  return resultado.herramientas.filter((item) => item.estado === "lista").map((item) => item.nombre).join(">") || "(ninguna)";
}
