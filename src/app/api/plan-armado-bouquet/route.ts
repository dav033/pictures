import { z } from "zod";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import { registrarFalloUi, traducirErrorServidor } from "@/lib/errores-ui/traducir-error-servidor";
import { construirUiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";
import { isPythonAdapterError, pythonErrorBody, PYTHON_MAX_BODY_BYTES, PythonPlanArmadoGlobosSchema } from "@/lib/ia/nucleo/python-adapter";
import { ArmadoBouquetV1Schema, DISPOSICIONES_NUMERO, VARIANTES_BOUQUET } from "@/lib/plan/armado-bouquet";
import { PlanEditError } from "@/lib/plan/edicion-error";
import { RechazoVistaArmadoError, vistaPreviaArmadoPython } from "@/lib/plan/edicion-python";
import { PlanDecoracionSchema } from "@/lib/plan/tipos";

/**
 * Vista previa del editor de armado de bouquets (ADR-0030, segunda entrega):
 * el navegador manda el plan, la pieza, el armado en borrador (`null` pide la
 * receta) y lo que sabe de cada globo de la pieza (`globos`, de sus líneas
 * resueltas), y recibe la leyenda, los niveles, los insumos y los textos que
 * escribe Python. Transporte puro: no firma, no escribe en la base y no toca
 * el catálogo; la edición que sí cambia el plan va por `/api/plan-editar`
 * (acción `armado`). Un rechazo `armado_invalido` trae además los estilos y
 * las disposiciones que Python admite para la pieza.
 *
 * Misma autenticación que `/api/plan-editar` (la sesión que exige
 * `src/proxy.ts`), repetida aquí como guardia del handler.
 */

const BodySchema = z.object({
  plan: PlanDecoracionSchema,
  estructura_id: z.string().trim().min(1).max(160),
  armado_bouquet: ArmadoBouquetV1Schema.nullable(),
  /** Los globos de la pieza tal como los tiene el navegador (estrictos, a lo sumo 12): clasifican, nunca cuentan. */
  globos: PythonPlanArmadoGlobosSchema,
  /** Con `armado_bouquet` null: el estilo que eligió el decorador. */
  variante: z.enum(VARIANTES_BOUQUET).optional(),
  /** Con `armado_bouquet` null: dónde puso los números. */
  disposicion: z.enum(DISPOSICIONES_NUMERO).optional(),
}).strict().refine((body) => body.armado_bouquet === null || (body.variante === undefined && body.disposicion === undefined), {
  message: "variante y disposicion solo piden una sugerencia.",
  path: ["variante"],
});

/** Lo que se reenvía a Python cabe en su límite de cuerpo; un cuerpo mayor nunca llegaría. */
const LIMITE_CUERPO_BYTES = PYTHON_MAX_BODY_BYTES;
const SUPERFICIE = "/api/plan-armado-bouquet";

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
    const resultado = await vistaPreviaArmadoPython({
      plan: body.plan,
      estructuraId: body.estructura_id,
      armadoBouquet: body.armado_bouquet,
      globos: body.globos,
      ...(body.variante === undefined ? {} : { variante: body.variante }),
      ...(body.disposicion === undefined ? {} : { disposicion: body.disposicion }),
      correlationId: requestIdHttp,
      signal: request.signal,
    });
    return Response.json(resultado, { headers: cabeceras });
  } catch (error) {
    const uiError = traducirErrorServidor(error, isPythonAdapterError(error) ? error.requestId : requestIdHttp);
    registrarFalloUi(SUPERFICIE, uiError);
    const responder = (datos: Record<string, unknown>, status: number) => Response.json({ ...datos, ui_error: uiError }, { status, headers: cabeceras });
    if (error instanceof z.ZodError) return responder({ error: "La vista previa del armado no tiene un formato válido.", detalles: error.issues }, 400);
    if (error instanceof PlanEditError) {
      // `armado_invalido`: `motivo` estable y `mensaje` de Python para el decorador, y las opciones de la pieza.
      const opciones = error instanceof RechazoVistaArmadoError ? error.opciones : null;
      return responder({
        error: error.message,
        ...(error.causa ? { causa: error.causa } : {}),
        ...(error.patron ? { motivo: error.patron.motivo, mensaje: error.patron.mensaje } : {}),
        ...(opciones ?? {}),
      }, error.status);
    }
    if (isPythonAdapterError(error)) {
      return responder(pythonErrorBody(error), error.status >= 400 && error.status <= 599 ? error.status : 502);
    }
    console.error("[plan-armado-bouquet] error inesperado:", error);
    return responder({ error: "No se pudo dibujar el armado." }, 500);
  }
}
