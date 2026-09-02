/**
 * CORS + API key para los endpoints de Happie pensados para un consumidor
 * externo desde el navegador (no la sesión de cookie de la app). El origen
 * se valida contra una lista blanca porque la API key viaja en JS de
 * cliente y por tanto es visible — no es secreta frente a quien inspeccione
 * la página, solo frente a terceros que no controlen ese origen.
 */
const ORIGENES_PERMITIDOS = (process.env.HAPPIE_EXTERNO_ORIGENES ?? "")
  .split(",")
  .map((origen) => origen.trim())
  .filter(Boolean);

function origenPermitido(request: Request): string | null {
  const origin = request.headers.get("origin");
  return origin && ORIGENES_PERMITIDOS.includes(origin) ? origin : null;
}

export function encabezadosCors(request: Request): Record<string, string> {
  const origin = origenPermitido(request);
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-api-key",
    Vary: "Origin",
  };
}

export function respuestaPreflight(request: Request): Response {
  return new Response(null, { status: 204, headers: encabezadosCors(request) });
}

export function apiKeyValida(request: Request): boolean {
  const esperada = process.env.HAPPIE_EXTERNO_API_KEY;
  return Boolean(esperada) && request.headers.get("x-api-key") === esperada;
}

export function conEncabezadosCors(respuesta: Response, cors: Record<string, string>): Response {
  const headers = new Headers(respuesta.headers);
  for (const [clave, valor] of Object.entries(cors)) headers.set(clave, valor);
  return new Response(respuesta.body, { status: respuesta.status, headers });
}
