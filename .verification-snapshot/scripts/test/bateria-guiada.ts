// Batería de 20 conversaciones contra la vista guiada (SSE chat-v1). PAGA llamadas al LLM de texto (≈ céntimos por corrida):
// no está en plan:test. Uso: GUIADO_BASE_URL=http://localhost:3010 npx tsx scripts/test/bateria-guiada.ts
// Falsos positivos conocidos: «pregunta sin Opciones» tras mostrar tarjetas y «no tengo una exacta, pero…» (honesto, intencional).
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

type Rol = "user" | "assistant";
type Mensaje = { role: Rol; content: string };
type Deco = { id: string; titulo: string; materiales?: unknown[] };
type Resultado = {
  brief?: { evento?: string; edad?: number; tematica?: string };
  decoraciones?: Deco[];
  opciones?: string[];
  preguntaUso?: boolean;
  uso?: "personal" | "negocio";
  cotizacion?: { total?: number; lineas?: unknown[] } | null;
  pasos?: unknown[];
  proveedores?: unknown[];
};
type Evento = { type: string; delta?: string; reply?: string; result?: Resultado; error?: string };
type Caso = { id: string; mensaje: string; accion: "personal" | "negocio" | "pasos" | "proveedor" | "solo-ideas"; extra?: string };
type Turno = { usuario: string; asistente: string; resultado: Resultado; errores: string[] };
type Conversacion = { id: string; turnos: Turno[]; fallos: string[] };

const BASE = process.env.GUIADO_BASE_URL ?? "http://localhost:3010";
const CASOS: Caso[] = [
  { id: "cumple-princesas", mensaje: "Cumpleaños de mi hija de 5 años, tema princesas", accion: "personal" },
  { id: "cumple-dinosaurios", mensaje: "Cumple de niño de 7, dinosaurios", accion: "negocio" },
  { id: "cumple-piratas", mensaje: "Fiesta infantil de 8 años con piratas", accion: "pasos" },
  { id: "cumple-frozen", mensaje: "Cumpleaños para niña de 6, Frozen", accion: "proveedor" },
  { id: "adulto-30-elegante", mensaje: "Cumplo 30, quiero algo elegante", accion: "personal" },
  { id: "adulto-50-neon", mensaje: "Fiesta por mis 50, algo neón", accion: "negocio" },
  { id: "baby-nino", mensaje: "Baby shower de niño", accion: "pasos" },
  { id: "baby-nina", mensaje: "Baby shower de niña", accion: "proveedor" },
  { id: "baby-neutro", mensaje: "Baby shower neutro, colores suaves", accion: "personal" },
  { id: "revelacion", mensaje: "Revelación de género, todavía no sabemos si niño o niña", accion: "negocio" },
  { id: "boda", mensaje: "Decoración para una boda, romántica y dorada", accion: "pasos" },
  { id: "quince", mensaje: "Mis XV, me gusta el morado", accion: "personal" },
  { id: "bautizo", mensaje: "Bautizo de mi bebé, blanco y azul", accion: "proveedor" },
  { id: "graduacion", mensaje: "Celebración de graduación universitaria, azul y dorado", accion: "negocio" },
  { id: "jubilacion", mensaje: "Fiesta de jubilación para mi mamá, algo alegre", accion: "pasos" },
  { id: "divorcio", mensaje: "Quiero celebrar el divorcio de mis padres con algo divertido", accion: "personal" },
  { id: "despedida", mensaje: "Despedida de soltera con tema tropical", accion: "proveedor" },
  { id: "empresa", mensaje: "Fiesta de empresa de fin de año, elegante", accion: "negocio" },
  { id: "madre", mensaje: "Celebración del día de la madre, flores y rosa", accion: "solo-ideas", extra: "sí, algo así" },
  { id: "halloween-navidad", mensaje: "Fiesta de Halloween, naranja y negro", accion: "solo-ideas", extra: "No sé, lo que sea" },
];

function revisarTurno(texto: string, resultado: Resultado, preguntoAntes: Set<string>, respuestas: Set<string>): string[] {
  const errores: string[] = [];
  const preguntas = (texto.match(/\?/g) ?? []).length;
  if (preguntas > 1) errores.push(`más de una pregunta (${preguntas})`);
  if (preguntas > 0 && !/^Opciones:/m.test(texto)) errores.push("pregunta sin línea Opciones:");
  if (/\b(?:no tenemos|no tengo)\b/i.test(texto) && (resultado.decoraciones?.length ?? 0) > 0) errores.push("negación de disponibilidad pese a ideas mostradas");
  if (/\b(?:esta propuesta|estas ideas)\b/i.test(texto) && (resultado.decoraciones?.length ?? 0) === 0) errores.push("alude a ideas sin tarjetas en este turno");
  if (/\b(?:ej-|deco-|SKU|variantId)\b/i.test(texto)) errores.push("muestra identificador interno");
  if (/\b(?:pantalla|botones|tarjetas)\b/i.test(texto)) errores.push("habla de elementos de interfaz");
  if (/\b(?:generar|generación|genero|imagen|render|visualización)\b/i.test(texto)) errores.push("menciona generación o visualización de imágenes");
  if ((texto.match(/no tengo una exacta/gi) ?? []).length > 1) errores.push("repite no tengo una exacta en el turno");
  for (const campo of respuestas) {
    if (preguntoAntes.has(campo) && campo === "uso" && /\b(?:negocio|personal)\b/i.test(texto) && /\?/i.test(texto)) errores.push("vuelve a preguntar uso ya respondido");
    if (preguntoAntes.has(campo) && campo === "edad" && /\bedad\b/i.test(texto) && /\?/i.test(texto)) errores.push("vuelve a preguntar edad ya respondida");
    if (preguntoAntes.has(campo) && campo === "evento" && /\b(?:qué vas a celebrar|qué evento|qué ocasión)\b/i.test(texto) && /\?/i.test(texto)) errores.push("vuelve a preguntar evento ya respondido");
  }
  if ((texto.match(/no tengo una exacta/gi) ?? []).length > 0) preguntoAntes.add("exacta");
  return errores;
}

async function pedir(historial: Mensaje[], estado: { decoracionId?: string; uso?: "personal" | "negocio" }, brief?: Resultado["brief"]): Promise<{ reply: string; result: Resultado }> {
  const response = await fetch(`${BASE}/api/asistente-guiado`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schema_version: "asistente-guiado.v1", messages: historial, brief: brief ?? {}, estadoGuiado: estado }),
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} en /api/asistente-guiado`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
  let result: Resultado = {};
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const partes = buffer.split("\n\n");
    buffer = partes.pop() ?? "";
    for (const parte of partes) {
      const linea = parte.split("\n").find((item) => item.startsWith("data: "));
      if (!linea) continue;
      const evento: Evento = JSON.parse(linea.slice(6)) as Evento;
      if (evento.type === "texto") reply += evento.delta ?? "";
      if (evento.type === "error") throw new Error(evento.error ?? "Error SSE sin detalle");
      if (evento.type === "fin") { reply = evento.reply ?? reply; result = evento.result ?? {}; }
    }
  }
  return { reply, result };
}

async function conversar(caso: Caso): Promise<Conversacion> {
  const historial: Mensaje[] = [];
  const turnos: Turno[] = [];
  const fallos: string[] = [];
  const preguntasPrevias = new Set<string>();
  const respondidos = new Set<string>();
  let brief: Resultado["brief"] = undefined;
  let elegido: Deco | undefined;
  let uso: "personal" | "negocio" | undefined;
  let solicitoPrecio = false;
  let pidioPrecioTrasUso = false;
  let respuestaInicial = caso.mensaje;
  for (let indice = 0; indice < 8; indice++) {
    historial.push({ role: "user", content: respuestaInicial });
    for (const campo of ["evento", "edad", "uso"] as const) {
      if ((campo === "evento" && /cumple|fiesta|boda|baby|baut|gradu|jubil|divorcio|soltera|madre|halloween|empresa|XV/i.test(respuestaInicial)) ||
          (campo === "edad" && /\b\d{1,2}\b/.test(respuestaInicial)) ||
          (campo === "uso" && /\b(?:personal|negocio)\b/i.test(respuestaInicial))) respondidos.add(campo);
    }
    const estado = { ...(elegido ? { decoracionId: elegido.id } : {}), ...(uso ? { uso } : {}) };
    const { reply, result } = await pedir(historial, estado, brief);
    const problemas = revisarTurno(reply, result, preguntasPrevias, respondidos);
    fallos.push(...problemas.map((problema) => `${turnos.length + 1}: ${problema}`));
    turnos.push({ usuario: respuestaInicial, asistente: reply, resultado: result, errores: problemas });
    historial.push({ role: "assistant", content: reply });
    brief = result.brief ?? brief;
    if (/\?/i.test(reply)) {
      if (/edad|cuántos años|qué edad/i.test(reply)) preguntasPrevias.add("edad");
      if (/qué vas a celebrar|qué evento|qué ocasión/i.test(reply)) preguntasPrevias.add("evento");
      if (/negocio|uso personal/i.test(reply)) preguntasPrevias.add("uso");
    }
    if (!elegido && result.decoraciones?.length) {
      elegido = result.decoraciones[0];
      if (caso.accion === "solo-ideas") break;
      // La selección de idea en la interfaz es local; siguiente POST lleva estadoGuiado exactamente como ella.
      respuestaInicial = `Me gusta «${elegido.titulo}».`;
      continue;
    }
    if (elegido && (caso.accion === "personal" || caso.accion === "negocio") && result.cotizacion) break;
    if (elegido && (caso.accion === "personal" || caso.accion === "negocio") && !solicitoPrecio) {
      solicitoPrecio = true;
      respuestaInicial = "¿Cuánto cuesta?";
      continue;
    }
    if (elegido && (caso.accion === "personal" || caso.accion === "negocio") && !uso && (result.preguntaUso || /negocio o.*personal|personal o.*negocio/i.test(reply))) {
      uso = caso.accion;
      respuestaInicial = caso.accion === "personal" ? "Uso personal" : "Es para mi negocio";
      continue;
    }
    if (elegido && uso && !result.cotizacion && !pidioPrecioTrasUso) {
      pidioPrecioTrasUso = true;
      respuestaInicial = "Cotiza los materiales, por favor.";
      continue;
    }
    if (elegido && caso.accion === "pasos" && !result.pasos) { respuestaInicial = "Quiero aprender a armarla paso a paso."; continue; }
    if (elegido && caso.accion === "proveedor" && !result.proveedores) { respuestaInicial = "Quiero contratar un decorador en Bogotá."; continue; }
    if (caso.extra && turnos.length === 2) { respuestaInicial = caso.extra; continue; }
    break;
  }
  if (["personal", "negocio"].includes(caso.accion) && elegido && !turnos.some((turno) => turno.resultado.cotizacion && (turno.resultado.cotizacion.total ?? 0) > 0)) fallos.push("cotización ausente tras idea y uso");
  if (caso.accion === "pasos" && !turnos.some((turno) => (turno.resultado.pasos?.length ?? 0) > 0)) fallos.push("pasos ausentes");
  if (caso.accion === "proveedor" && !turnos.some((turno) => turno.resultado.proveedores !== undefined)) fallos.push("búsqueda de decorador ausente");
  if (!elegido && !turnos.some((turno) => (turno.resultado.decoraciones?.length ?? 0) > 0) && !fallos.some((f) => f.includes("ideas"))) fallos.push("sin ideas para guion donde búsqueda podía encontrar");
  return { id: caso.id, turnos, fallos };
}

async function main(): Promise<void> {
  const conversaciones: Conversacion[] = [];
  for (const caso of CASOS) {
    const conversacion = await conversar(caso);
    conversaciones.push(conversacion);
    console.log(`${caso.id}: ${conversacion.fallos.length ? `FALLOS ${conversacion.fallos.join("; ")}` : "OK"} (${conversacion.turnos.length} turnos)`);
  }
  const fallos = conversaciones.reduce((suma, actual) => suma + actual.fallos.length, 0);
  const ruta = process.env.GUIADO_INFORME ?? join(tmpdir(), "scratchpad", `bateria-guiada-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await mkdir(dirname(ruta), { recursive: true });
  await writeFile(ruta, JSON.stringify({ fecha: new Date().toISOString(), baseUrl: BASE, conversaciones, totalFallos: fallos }, null, 2), "utf8");
  console.log(`Informe: ${ruta}`);
  if (fallos) process.exitCode = 1;
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Fallo de batería"); process.exitCode = 1; });
