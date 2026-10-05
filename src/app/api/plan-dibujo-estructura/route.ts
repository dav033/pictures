import { z } from "zod";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import { registrarFalloUi, traducirErrorServidor } from "@/lib/errores-ui/traducir-error-servidor";
import { construirUiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";
import { isPythonAdapterError, pythonErrorBody, PYTHON_MAX_BODY_BYTES } from "@/lib/ia/nucleo/python-adapter";
import { PlanEditError } from "@/lib/plan/edicion-error";
import { vistaPreviaDibujoEstructuraPython } from "@/lib/plan/edicion-python";
import { PlanDecoracionSchema } from "@/lib/plan/tipos";

/**
 * Dibujo esquemático de una pieza que ningún motor arma (ADR-0034): el
 * navegador manda el plan, la pieza y su mezcla de tamaños ya resuelta
 * (`mezcla_real`, copiada de `plan_resuelto.estructuras[]`), y recibe **solo la
 * gráfica**: el lienzo y el interior del `<svg>`. Transporte puro: no firma, no
 * escribe en la base y no toca el catálogo.
 *
 * **No es una de las cuatro rutas `plan-armado-*`.** Esas resuelven un armado
 * con el motor del diseñador, que coloca cada globo y además cuenta y compra.
 * Aquí no hay motor ni armado: la pared, el aro circular, el techo de globos y
 * el centro de mesa no lo tienen, y lo que se devuelve es el dibujo que Python
 * porta 1 a 1 de `referencias/dibujos.ts` del clasificador, que lo dice en su
 * encabezado — «No calculan cantidades: la medida es la típica de cada
 * estructura». Lo que la pieza lleva, cuesta y se compra sigue siendo lo que
 * calculó `plan.py`; el aro, con su `π × diámetro`.
 *
 * Por eso la respuesta no trae pieza resuelta, ni armado, ni opciones, ni
 * límites, y esta ruta no tiene edición: no hay nada que guardar. El SVG es
 * derivado y **nunca entra en el plan ni en el snapshot que firma `plan_hash`**
 * (ADR-0034, consecuencia 2): se regenera cuando haga falta. Su lienzo no es
 * cuadrado y cambia con la pieza, así que la gráfica lleva `ancho` y `alto`.
 *
 * Misma autenticación que `/api/plan-editar` (la sesión que exige
 * `src/proxy.ts`), repetida aquí como guardia del handler. El plazo con Python
 * es el corto del editor (`EDICION_PYTHON_DEADLINE_MS`).
 */

const BodySchema = z.object({
  plan: PlanDecoracionSchema,
  estructura_id: z.string().trim().min(1).max(160),
  /** La mezcla de tamaños que la resolución ya calculó para la pieza: el dibujo la reparte, nunca la recalcula. */
  mezcla_real: z.array(z.object({
    diam_pulg: z.number().min(0),
    forma: z.string().nullable(),
    unidades: z.number().int().min(0),
    pct: z.number().min(0).max(100),
    // 36 = los 6 materiales de una pieza por los 6 tamanos redondos del catalogo, que es la rejilla que
    // `mezcla_real` puede llenar (agrupa por forma de globo y diametro). Mismo tope que `MAX_LINEAS_MEZCLA`
    // en `app/plan_dibujo_estructura.py`, donde los dos factores se leen del contrato.
  }).strict()).max(36).optional(),
}).strict();

/**
 * Cuántos dibujos puede tener en vuelo este proceso. El tope es más alto que el de las cuatro rutas de armado
 * (4) porque el trabajo no es comparable: aquellas relajan colisiones globo a globo y tardan cientos de
 * milisegundos o segundos, y estos dibujos son esquemáticos y deterministas — medidos en este repo, 12,6 ms la
 * pared (el más caro), 9,0 ms el aro, 2,4 ms el techo y 0,5 ms el centro de mesa. Ocho es el tope de
 * `estructuras` de `plan-decoracion.v1`: una tarjeta monta un bloque por pieza y todas piden su dibujo al
 * abrirse, así que con menos una propuesta llena se negaría a sí misma. Pasado el tope responde 429 con una
 * frase y `Retry-After`, no encola sin límite.
 */
const MAX_DIBUJOS_EN_VUELO = 8;
let dibujosEnVuelo = 0;

/** Lo que se reenvía a Python cabe en su límite de cuerpo; un cuerpo mayor nunca llegaría. */
const LIMITE_CUERPO_BYTES = PYTHON_MAX_BODY_BYTES;
const SUPERFICIE = "/api/plan-dibujo-estructura";

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
  if (dibujosEnVuelo >= MAX_DIBUJOS_EN_VUELO) {
    const requestId = requestIdDe(request);
    const mensaje = "Hay demasiados dibujos en curso. Espera un momento y vuelve a intentarlo.";
    // `SERVICIO_OCUPADO` y no `SOLICITUD_INVALIDA`: el tope es temporal y reintentar es lo correcto. Con el
    // código de solicitud inválida el cliente leía su frase de catálogo —«Recarga la página e inténtalo de
    // nuevo»— y daba el error por no reintentable, justo al revés de lo que dice el `Retry-After` de abajo
    // (2026-10-04). `mensajeUsuario` hace que se lea la frase de esta ruta y no la genérica.
    const uiError = construirUiErrorV1("SERVICIO_OCUPADO", { mensaje, mensajeUsuario: mensaje, codigoOrigen: "DEMASIADAS_SOLICITUDES", requestId });
    registrarFalloUi(SUPERFICIE, uiError);
    return Response.json({ error: mensaje, ui_error: uiError }, { status: 429, headers: { "X-Request-ID": requestId, "Retry-After": "1" } });
  }
  dibujosEnVuelo += 1;
  try {
    return await atender(request);
  } finally {
    dibujosEnVuelo -= 1;
  }
}

async function atender(request: Request) {
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
    const resultado = await vistaPreviaDibujoEstructuraPython({
      plan: body.plan,
      estructuraId: body.estructura_id,
      ...(body.mezcla_real === undefined ? {} : { mezclaReal: body.mezcla_real }),
      correlationId: requestIdHttp,
      signal: request.signal,
    });
    return Response.json(resultado, { headers: cabeceras });
  } catch (error) {
    const uiError = traducirErrorServidor(error, isPythonAdapterError(error) ? error.requestId : requestIdHttp);
    registrarFalloUi(SUPERFICIE, uiError);
    const responder = (datos: Record<string, unknown>, status: number) => Response.json({ ...datos, ui_error: uiError }, { status, headers: cabeceras });
    if (error instanceof z.ZodError) return responder({ error: "La petición del dibujo no tiene un formato válido.", detalles: error.issues }, 400);
    if (error instanceof PlanEditError) {
      return responder({
        error: error.message,
        ...(error.causa ? { causa: error.causa } : {}),
      }, error.status);
    }
    if (isPythonAdapterError(error)) {
      return responder(pythonErrorBody(error), error.status >= 400 && error.status <= 599 ? error.status : 502);
    }
    console.error("[plan-dibujo-estructura] error inesperado:", error);
    return responder({ error: "No se pudo dibujar la pieza." }, 500);
  }
}
