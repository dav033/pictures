import { z } from "zod";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import { registrarFalloUi, traducirErrorServidor } from "@/lib/errores-ui/traducir-error-servidor";
import { construirUiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";
import { isPythonAdapterError, pythonErrorBody, PYTHON_MAX_BODY_BYTES } from "@/lib/ia/nucleo/python-adapter";
import { PlanEditError } from "@/lib/plan/edicion-error";
import { vistaPreviaPatronPython } from "@/lib/plan/edicion-python";
import { PatronColorV1Schema } from "@/lib/plan/patron-color";
import { PlanDecoracionSchema } from "@/lib/plan/tipos";

/**
 * Vista previa del editor de patrones de color (ADR-0028 §10): el navegador
 * manda el plan, la estructura y el patrón en borrador (`null` pide la
 * sugerencia) y recibe la rejilla, el conteo y los textos que escribe Python.
 * Transporte puro: no firma, no escribe en la base y no toca el catálogo; la
 * edición que sí cambia el plan va por `/api/plan-editar` (acción `patron`).
 *
 * Misma autenticación que `/api/plan-editar` (la sesión que exige
 * `src/proxy.ts`), repetida aquí como guardia del handler.
 */

const BodySchema = z.object({
  plan: PlanDecoracionSchema,
  estructura_id: z.string().trim().min(1).max(160),
  patron_color: PatronColorV1Schema.nullable(),
}).strict();

/** Lo que se reenvía a Python cabe en su límite de cuerpo; un cuerpo mayor nunca llegaría. */
const LIMITE_CUERPO_BYTES = PYTHON_MAX_BODY_BYTES;
const SUPERFICIE = "/api/plan-patron";

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
    const body = BodySchema.parse(cuerpo.json);
    const patron = await vistaPreviaPatronPython({
      plan: body.plan,
      estructuraId: body.estructura_id,
      patronColor: body.patron_color,
      correlationId: requestIdHttp,
      signal: request.signal,
    });
    return Response.json({ patron }, { headers: cabeceras });
  } catch (error) {
    const uiError = traducirErrorServidor(error, isPythonAdapterError(error) ? error.requestId : requestIdHttp);
    registrarFalloUi(SUPERFICIE, uiError);
    const responder = (datos: Record<string, unknown>, status: number) => Response.json({ ...datos, ui_error: uiError }, { status, headers: cabeceras });
    if (error instanceof z.ZodError) return responder({ error: "La vista previa del patrón no tiene un formato válido.", detalles: error.issues }, 400);
    if (error instanceof PlanEditError) {
      // `patron_invalido`: `motivo` estable y `mensaje` de Python para el decorador.
      return responder({ error: error.message, ...(error.causa ? { causa: error.causa } : {}), ...(error.patron ? { motivo: error.patron.motivo, mensaje: error.patron.mensaje } : {}) }, error.status);
    }
    if (isPythonAdapterError(error)) {
      return responder(pythonErrorBody(error), error.status >= 400 && error.status <= 599 ? error.status : 502);
    }
    console.error("[plan-patron] error inesperado:", error);
    return responder({ error: "No se pudo dibujar el patrón." }, 500);
  }
}
