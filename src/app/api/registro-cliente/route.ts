import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import { auditar, conContexto, registrar, sanearIdConversacion } from "@/lib/registro";

/**
 * Eventos y errores del navegador (src/lib/registro/cliente.ts y CapturaErroresCliente). Quedan en el
 * registro general como `cliente.<evento>` y, con id de conversación, en el archivo de auditoría de esa
 * conversación como `accion_cliente` o `error`. Responde 204 sin cuerpo.
 *
 * Corre en Node (el runtime por defecto): con `cacheComponents` Next rechaza declarar `export const runtime`.
 */

const MAX_BYTES = 16 * 1024;
const LIMITE_POR_MINUTO_IP = 120;

const EventoClienteSchema = z.object({
  evento: z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N}_.:\- ]+$/u),
  nivel: z.enum(["debug", "info", "warn", "error"]).optional(),
  tipo: z.enum(["accion", "error", "evento"]).optional(),
  datos: z.record(z.string(), z.unknown()).optional(),
  idConversacion: z.string().max(200).optional(),
  vista: z.string().max(40).optional(),
  ruta: z.string().max(500).optional(),
  sesion: z.string().max(80).optional(),
  ts: z.string().max(40).optional(),
  suprimidos: z.number().int().min(0).max(1_000_000).optional(),
}).strict();

declare global {
  var __registroClientePorIp: Map<string, number[]> | undefined;
}

function ipDe(request: Request): string {
  const reenviada = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (reenviada || request.headers.get("x-real-ip")?.trim() || "desconocida").slice(0, 64);
}

/** Ventana deslizante en memoria por IP; poda el mapa para que no crezca sin límite. */
function dentroDelLimite(ip: string): boolean {
  if (!globalThis.__registroClientePorIp) globalThis.__registroClientePorIp = new Map();
  const mapa = globalThis.__registroClientePorIp;
  const ahora = Date.now();
  if (mapa.size > 5_000) {
    for (const [clave, marcas] of mapa) if (!marcas.some((marca) => ahora - marca < 60_000)) mapa.delete(clave);
    if (mapa.size > 5_000) mapa.clear();
  }
  const recientes = (mapa.get(ip) ?? []).filter((marca) => ahora - marca < 60_000);
  if (recientes.length >= LIMITE_POR_MINUTO_IP) {
    mapa.set(ip, recientes);
    return false;
  }
  recientes.push(ahora);
  mapa.set(ip, recientes);
  return true;
}

/**
 * Contra CSRF: si el navegador manda Origin, su host debe ser el host al que mandó la petición (Host o
 * X-Forwarded-Host). No se usa `isSameOriginRequest` porque en `next dev` `request.url` dice «localhost»
 * aunque la página se abra por 127.0.0.1 o por la IP de la red, y se perderían los registros de esas pestañas.
 */
function mismoOrigen(request: Request): boolean {
  const origen = request.headers.get("origin");
  if (!origen) return true;
  try {
    const host = new URL(origen).host;
    const candidatos = [request.headers.get("x-forwarded-host"), request.headers.get("host"), new URL(request.url).host];
    return candidatos.some((candidato) => candidato?.split(",")[0]?.trim() === host);
  } catch {
    return false;
  }
}

function sinContenido(estado = 204): Response {
  return new Response(null, { status: estado });
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthenticatedRequest(request)) return sinContenido(401);
  if (!mismoOrigen(request)) return sinContenido(403);
  const longitud = Number(request.headers.get("content-length"));
  if (Number.isFinite(longitud) && longitud > MAX_BYTES) return sinContenido(413);
  let texto: string;
  try {
    texto = await request.text();
  } catch {
    return sinContenido(400);
  }
  if (Buffer.byteLength(texto, "utf8") > MAX_BYTES) return sinContenido(413);
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto) as unknown;
  } catch {
    return sinContenido(400);
  }
  const validado = EventoClienteSchema.safeParse(crudo);
  if (!validado.success) {
    registrar("warn", "cliente.evento_invalido", { problemas: validado.error.issues.slice(0, 5).map((problema) => `${problema.path.join(".")}: ${problema.message}`) });
    return sinContenido(400);
  }
  const ip = ipDe(request);
  if (!dentroDelLimite(ip)) {
    registrar("debug", "cliente.limite_superado", { ip });
    return sinContenido(429);
  }
  const evento = validado.data;
  const conversacion = sanearIdConversacion(evento.idConversacion);
  const nivel = evento.nivel ?? (evento.tipo === "error" ? "error" : "info");
  const esError = evento.tipo === "error" || nivel === "error";
  conContexto({
    solicitud: request.headers.get("x-request-id") ?? randomUUID(),
    ...(conversacion ? { conversacion } : {}),
    ...(evento.vista ? { vista: evento.vista } : {}),
    ruta: "/api/registro-cliente",
  }, () => {
    const datos = {
      ...(evento.datos ? { datos: evento.datos } : {}),
      ...(evento.ruta ? { rutaCliente: evento.ruta } : {}),
      ...(evento.sesion ? { sesion: evento.sesion } : {}),
      ...(evento.ts ? { tsCliente: evento.ts } : {}),
      ...(evento.suprimidos ? { suprimidos: evento.suprimidos } : {}),
      agente: request.headers.get("user-agent")?.slice(0, 200),
    };
    registrar(nivel, `cliente.${evento.evento}`, datos);
    if (!conversacion) return;
    const donde = { ...(evento.ruta ? { rutaCliente: evento.ruta } : {}), ...(evento.sesion ? { sesion: evento.sesion } : {}) };
    if (esError) auditar("error", { origen: `navegador:${evento.evento}`, error: evento.datos ?? {}, ...(Object.keys(donde).length ? { datos: donde } : {}) });
    else auditar("accion_cliente", { evento: evento.evento, ...(evento.datos ? { datos: evento.datos } : {}), ...(evento.sesion ? { sesion: evento.sesion } : {}), ...(evento.ruta ? { rutaCliente: evento.ruta } : {}) });
  });
  return sinContenido();
}
