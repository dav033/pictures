import { z } from "zod";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import { EntradaCotizacionProfesionalSchema } from "@/lib/cotizacion/profesional";
import { registrarFalloUi, traducirErrorServidor } from "@/lib/errores-ui/traducir-error-servidor";
import { construirUiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";
import { isPythonAdapterError, llamarPythonCotizacionProfesional, pythonErrorBody, PYTHON_MAX_BODY_BYTES } from "@/lib/ia/nucleo/python-adapter";
import { EDICION_PYTHON_DEADLINE_MS } from "@/lib/plan/edicion-python";

/**
 * Cotización profesional: el navegador manda los materiales de la cotización
 * que ya tiene (producto, bolsas, precio de catálogo y el precio por bolsa que
 * haya puesto el decorador) y los costos que escribió, y recibe los totales
 * que calcula Python (`cotizacion-profesional-result.v1`). Transporte puro: no
 * firma, no escribe en la base y no toca el catálogo ni el `plan_hash`.
 *
 * Los materiales no se vuelven a verificar contra el plan firmado: esta
 * cotización es una herramienta del decorador para su propio precio, no una
 * compra.
 */

const LIMITE_CUERPO_BYTES = PYTHON_MAX_BODY_BYTES;
const SUPERFICIE = "/api/cotizacion-profesional";

function requestIdDe(request: Request): string {
  const cabecera = request.headers.get("x-request-id");
  return z.string().uuid().safeParse(cabecera).success ? cabecera! : crypto.randomUUID();
}

type CuerpoLeido = { ok: true; json: unknown } | { ok: false; status: 400 | 413; mensaje: string; codigo: string };

async function leerCuerpo(request: Request): Promise<CuerpoLeido> {
  const demasiado = { ok: false, status: 413, mensaje: "La solicitud es demasiado grande.", codigo: "PAYLOAD_TOO_LARGE" } as const;
  const declarado = Number(request.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > LIMITE_CUERPO_BYTES) return demasiado;
  let texto: string;
  try {
    texto = await request.text();
  } catch {
    return { ok: false, status: 400, mensaje: "El cuerpo de la solicitud no se pudo leer.", codigo: "INVALID_JSON" };
  }
  if (Buffer.byteLength(texto, "utf8") > LIMITE_CUERPO_BYTES) return demasiado;
  try {
    return { ok: true, json: JSON.parse(texto) as unknown };
  } catch {
    return { ok: false, status: 400, mensaje: "El cuerpo de la solicitud no es JSON válido.", codigo: "INVALID_JSON" };
  }
}

export async function POST(request: Request) {
  const requestIdHttp = requestIdDe(request);
  const cabeceras = { "X-Request-ID": requestIdHttp };
  const rechazoTransporte = (status: number, mensaje: string, codigo: string) => {
    const uiError = construirUiErrorV1("SOLICITUD_INVALIDA", { mensaje, codigoOrigen: codigo, requestId: requestIdHttp });
    registrarFalloUi(SUPERFICIE, uiError);
    return Response.json({ error: mensaje, ui_error: uiError }, { status, headers: cabeceras });
  };

  if (!isAuthenticatedRequest(request)) return rechazoTransporte(401, "La sesión no es válida.", "UNAUTHORIZED");
  const cuerpo = await leerCuerpo(request);
  if (!cuerpo.ok) return rechazoTransporte(cuerpo.status, cuerpo.mensaje, cuerpo.codigo);

  try {
    const entrada = EntradaCotizacionProfesionalSchema.parse(cuerpo.json);
    const resultado = await llamarPythonCotizacionProfesional({
      entrada,
      requestId: crypto.randomUUID(),
      correlationId: requestIdHttp,
      deadlineMs: EDICION_PYTHON_DEADLINE_MS,
      parentSignal: request.signal,
    });
    return Response.json(resultado, { headers: cabeceras });
  } catch (error) {
    const uiError = traducirErrorServidor(error, isPythonAdapterError(error) ? error.requestId : requestIdHttp);
    registrarFalloUi(SUPERFICIE, uiError);
    const responder = (datos: Record<string, unknown>, status: number) => Response.json({ ...datos, ui_error: uiError }, { status, headers: cabeceras });
    if (error instanceof z.ZodError) return responder({ error: "La cotización profesional no tiene un formato válido.", detalles: error.issues }, 400);
    if (isPythonAdapterError(error)) {
      return responder(pythonErrorBody(error), error.status >= 400 && error.status <= 599 ? error.status : 502);
    }
    console.error("[cotizacion-profesional] error inesperado:", error);
    return responder({ error: "No se pudo calcular la cotización profesional." }, 500);
  }
}
