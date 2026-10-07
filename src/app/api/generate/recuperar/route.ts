import { getRagPool } from "@/lib/rag/db";
import { leerImagenRecuperable, PlanHashImagenSchema, SolicitudImagenSchema, type ImagenRecuperable } from "@/lib/generacion/imagen-recuperable";
import { conRegistro, decidir } from "@/lib/registro/servidor";

/**
 * ¿Llegó a generarse la imagen de esta solicitud? La consulta el navegador cuando /api/generate se le cortó (red,
 * tiempo, 5xx) ANTES de pedir otra imagen: si el servidor la terminó, se recupera sin volver a pagarla.
 * `GET /api/generate/recuperar?solicitud=<uuid>&plan=<plan_hash>` → `{ estado: "lista", imagen, avisoNoCotizado? }`,
 * `{ estado: "en_curso" }`, `{ estado: "fallida" }` o `{ estado: "no_encontrada" }`; 503 si no hay dónde mirar.
 */
// Auditado (src/lib/registro): entrada, salida, errores y la decisión de qué se encontró.
export const GET = conRegistro("/api/generate/recuperar", atenderGET);

const SIN_CACHE = { "Cache-Control": "no-store" } as const;

async function atenderGET(request: Request): Promise<Response> {
  const parametros = new URL(request.url).searchParams;
  const solicitud = SolicitudImagenSchema.safeParse(parametros.get("solicitud"));
  const plan = PlanHashImagenSchema.safeParse(parametros.get("plan"));
  if (!solicitud.success || !plan.success) {
    return Response.json({ error: "Falta la solicitud o el plan de la imagen." }, { status: 400, headers: SIN_CACHE });
  }
  const entrada = { solicitudId: solicitud.data.toLowerCase(), planHash: plan.data };
  let resultado: ImagenRecuperable;
  try {
    resultado = await leerImagenRecuperable(getRagPool(), entrada);
  } catch (error) {
    decidir("regla:imagen_recuperada", "qué encontró la recuperación de una imagen cortada", "no_disponible", {
      entrada,
      motivo: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    });
    return Response.json({ estado: "no_disponible" }, { status: 503, headers: SIN_CACHE });
  }
  decidir("regla:imagen_recuperada", "qué encontró la recuperación de una imagen cortada", resultado.estado, {
    entrada,
    ...(resultado.estado === "lista" ? { motivo: `imagen de ${Math.round((resultado.imagen.length * 3) / 4 / 1024)} KB` } : {}),
  });
  return Response.json(resultado, { headers: SIN_CACHE });
}
