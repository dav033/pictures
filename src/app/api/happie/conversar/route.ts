import { HappiaClient, cargarConfigDesdeEnv, type HappiaPackage } from "@sempertex/happie-package-ia";
import { manejarChatWebhook } from "@/lib/happie/conversacion-webhook";
import { ambitoDeSesion, rechazoDePanel } from "@/lib/happie/panel-prueba";
import { registrarFalloHappie } from "@/lib/happie/registrar-fallo";
import { conRegistro } from "@/lib/registro/servidor";

/**
 * Chat de /happie: la misma conversación de varios turnos del webhook (tipo de evento → invitados → presupuesto →
 * servicios y estilo → confirmación → paquetes), autenticada con la sesión de la app. Cuando llegan recomendaciones se
 * le adjunta a cada una su paquete (para las tarjetas y el carrito); si no se pueden resolver, queda el enlace.
 */
// Auditado (src/lib/registro): entrada, salida, errores y lo que la petición llame (IA, Python, decisiones).
export const POST = conRegistro("/api/happie/conversar", atenderPOST, { vista: "happie" });

type Recomendacion = { url: string; razon: string };
/** The paquete lookup must not stretch the turn: the recommendation is already paid for, a card is a bonus. */
const PLAZO_PAQUETES_MS = 8_000;

const esRecomendacion = (r: unknown): r is Recomendacion =>
  typeof r === "object" && r !== null && typeof (r as Recomendacion).url === "string" && typeof (r as Recomendacion).razon === "string";

/** The browser must not choose the origin of the links the server builds: `url` is dropped for session callers. */
async function sinUrlDelCliente(request: Request): Promise<Request> {
  const texto = await request.text();
  try {
    const cuerpo: unknown = JSON.parse(texto);
    if (typeof cuerpo === "object" && cuerpo !== null && !Array.isArray(cuerpo) && "url" in cuerpo) {
      const resto: Record<string, unknown> = { ...(cuerpo as Record<string, unknown>) };
      delete resto.url;
      return new Request(request.url, { method: request.method, headers: request.headers, body: JSON.stringify(resto), signal: request.signal });
    }
  } catch { /* malformed JSON: the shared 400 path reports it */ }
  return new Request(request.url, { method: request.method, headers: request.headers, body: texto, signal: request.signal });
}

async function atenderPOST(request: Request) {
  const rechazo = rechazoDePanel(request, { mutacion: true });
  const entrante = rechazo ? request : await sinUrlDelCliente(request);
  const respuesta = await manejarChatWebhook(entrante, rechazo, { ambito: ambitoDeSesion(request), superficie: "/api/happie/conversar" });
  if (respuesta.status !== 200) return respuesta;

  const cuerpo: unknown = await respuesta.clone().json().catch(() => null);
  if (typeof cuerpo !== "object" || cuerpo === null || !("tipo" in cuerpo) || cuerpo.tipo !== "recomendaciones" || !("recomendaciones" in cuerpo) || !Array.isArray(cuerpo.recomendaciones)) {
    return respuesta;
  }
  const recomendaciones = cuerpo.recomendaciones.filter(esRecomendacion);
  const correlationId = respuesta.headers.get("x-correlation-id") ?? undefined;

  let porId = new Map<string, HappiaPackage>();
  try {
    const plazo = AbortSignal.any([request.signal, AbortSignal.timeout(PLAZO_PAQUETES_MS)]);
    const { packages } = await new HappiaClient(cargarConfigDesdeEnv()).listarPackages(plazo);
    porId = new Map(packages.map((p) => [p.id, p]));
  } catch (error) {
    registrarFalloHappie("conversar-paquetes", error, correlationId);
  }
  const enriquecidas = recomendaciones.map((r) => {
    let id: string | null = null;
    try { id = new URL(r.url).searchParams.get("package"); } catch { /* the link stays, without its card */ }
    return { ...r, paquete: (id && porId.get(id)) || undefined };
  });
  return Response.json(
    { ...cuerpo, recomendaciones: enriquecidas },
    { status: 200, headers: { "Cache-Control": "no-store", ...(correlationId ? { "X-Correlation-ID": correlationId } : {}) } },
  );
}
