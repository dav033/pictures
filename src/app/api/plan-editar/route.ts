import { z } from "zod";
import { buscarCatalogoRag, type ProductoCandidato } from "@/lib/rag/chat/buscar";
import { getRagPool } from "@/lib/rag/db";
import { isPythonAdapterError, pythonErrorBody } from "@/lib/ia/python-adapter";
import { PythonPlanMappingError } from "@/lib/plan/python-mapper";
import { AllowlistProductoVarianteError } from "@/lib/plan/allowlist-producto-variante";
import { PlanEditError } from "@/lib/plan/edicion-error";
import { exigirContextoPython, recomendarAlternativasPython } from "@/lib/plan/edicion-python";
import { PlanBackendNoDisponibleError } from "@/lib/plan/resolver-backend";
import { LoraModeSlugSchema } from "@/lib/lora/schema";
import { resolveLoraModeDatasetAllowlist } from "@/lib/lora/mode-resolver";
import type { CatalogAllowlist } from "@/lib/rag/retrieval/types";
import { registrarFalloUi, traducirErrorServidor } from "@/lib/errores-ui/traducir-error-servidor";
import { filtrarCandidatosCompatibles } from "@/lib/plan/edicion-compatibilidad";
import {
  abrirContextoExigido,
  aplicarEdicionPlan,
  correlationDesde,
} from "@/lib/plan/aplicar-edicion";
import { BasePlanSchema, EdicionSchema } from "@/lib/plan/edicion-esquemas";

const BodySchema = z.discriminatedUnion("modo", [
  z.object({
    modo: z.literal("buscar"),
    consulta: z.string().trim().min(2).max(240),
    approval_token: z.string().min(1).max(256 * 1024).optional(),
    loraMode: LoraModeSlugSchema.optional(),
    /** Line the search would replace ("Modificar"): a balloon only accepts balloons of the same shape. */
    linea_objetivo: z.object({
      forma: z.string().trim().min(1).max(40).nullable().optional(),
      diam_pulg: z.number().positive().max(100).nullable().optional(),
    }).strict().optional(),
  }).strict(),
  z.object({ modo: z.literal("recomendadas"), variant_id: z.string().trim().min(1).max(160), approval_token: z.string().min(1), loraMode: LoraModeSlugSchema.optional() }).strict(),
  z.object({ modo: z.literal("aplicar"), base: BasePlanSchema, edicion: EdicionSchema, loraMode: LoraModeSlugSchema.optional() }).strict(),
]);

function serializarCandidatos(candidatos: readonly ProductoCandidato[]) {
  return candidatos.slice(0, 8).map((candidato) => ({
    productId: candidato.productId,
    titulo: candidato.titulo,
    categoria: candidato.categoria,
    imagen: candidato.imagen,
    disponible: candidato.disponible,
    variantes: candidato.variantes.slice(0, 16),
  }));
}

function requestIdDe(request: Request): string {
  const cabecera = request.headers.get("x-request-id");
  return z.string().uuid().safeParse(cabecera).success ? cabecera! : crypto.randomUUID();
}

export async function POST(request: Request) {
  // Every response carries X-Request-ID, so a failed edit can be traced (E2E 2026-09-14).
  const requestIdHttp = requestIdDe(request);
  const cabeceras = { "X-Request-ID": requestIdHttp };
  try {
    const body = BodySchema.parse(await request.json());
    const pool = getRagPool();

    // Un modo LoRA restringido (training_1/2) nunca debe poder ofrecer ni
    // aplicar una pieza fuera de su dataset — el mismo allowlist que ya
    // filtra la búsqueda del chat contra la allowlist del turno. Sin esto, el
    // editor podía agregar/reemplazar cualquier producto real del catálogo y el
    // rechazo solo aparecía al generar, ya tarde. Se resuelve después de abrir
    // el token para que una aprobación inválida no llegue a consultar nada.
    const resolverCatalogAllowlist = async (): Promise<CatalogAllowlist | null> => body.loraMode
      ? await resolveLoraModeDatasetAllowlist(body.loraMode, pool)
      : null;

    if (body.modo === "buscar") {
      // Con un token de plan Python la búsqueda queda fijada al snapshot firmado;
      // sin token (o con uno de Next) conserva el comportamiento anterior.
      const contextoBusqueda = body.approval_token === undefined ? null : abrirContextoExigido(body.approval_token);
      const catalogSnapshotId = contextoBusqueda?.backend === "python" ? exigirContextoPython(contextoBusqueda) : undefined;
      const catalogAllowlist = await resolverCatalogAllowlist();
      const resultado = await buscarCatalogoRag(pool, body.consulta, {
        allowlist: catalogAllowlist ?? undefined,
        ...(catalogSnapshotId === undefined ? {} : { catalogSnapshotId }),
      });
      return Response.json(
        { status: resultado.status, candidatos: serializarCandidatos(filtrarCandidatosCompatibles(resultado.candidatos, body.linea_objetivo)), filtroRelajado: resultado.filtroRelajado },
        { headers: cabeceras },
      );
    }

    if (body.modo === "recomendadas") {
      // Python owns which alternatives are sellable (/catalog/recommendations).
      // A token without a signed catalog snapshot (the retired Next backend)
      // is rejected with SIN_SNAPSHOT_CATALOGO instead of falling back to SQL.
      const contextoPlan = abrirContextoExigido(body.approval_token);
      exigirContextoPython(contextoPlan);
      const candidatos = await recomendarAlternativasPython({
        contexto: contextoPlan,
        variantId: body.variant_id,
        catalogAllowlist: await resolverCatalogAllowlist(),
        correlationId: correlationDesde(contextoPlan.requestId),
        signal: request.signal,
      });
      return Response.json({ candidatos }, { headers: cabeceras });
    }

    // The signed-approval / re-resolution / admission logic lives in
    // `aplicarEdicionPlan` (src/lib/plan/aplicar-edicion.ts) so the chat tool
    // `ajustar_plan_decoracion` (src/lib/ia/registro-herramientas.ts) can call
    // the exact same checks instead of a second implementation.
    const catalogAllowlist = await resolverCatalogAllowlist();
    const { plan: resuelto, cotizacion } = await aplicarEdicionPlan({
      base: body.base,
      edicion: body.edicion,
      catalogAllowlist,
      pool,
      signal: request.signal,
    });
    return Response.json({ plan: resuelto, cotizacion }, { headers: cabeceras });
  } catch (error) {
    // Los campos legacy (`error`, `causa`, `detalles`, sobre operational.v1) se
    // conservan para los consumidores actuales; `ui_error` (ui-error.v1) es lo
    // que muestra la interfaz.
    const uiError = traducirErrorServidor(error, isPythonAdapterError(error) ? error.requestId : requestIdHttp);
    registrarFalloUi("/api/plan-editar", uiError);
    const responder = (cuerpo: Record<string, unknown>, status: number) => Response.json({ ...cuerpo, ui_error: uiError }, { status, headers: cabeceras });
    if (error instanceof z.ZodError) return responder({ error: "La edición del plan no tiene un formato válido.", detalles: error.issues }, 400);
    if (error instanceof PlanEditError) return responder({ error: error.message, ...(error.causa ? { causa: error.causa } : {}) }, error.status);
    if (error instanceof PlanBackendNoDisponibleError) return responder({ error: error.message, causa: error.motivo }, 409);
    if (error instanceof AllowlistProductoVarianteError) return responder({ error: error.message, causa: error.causa }, 422);
    if (error instanceof Error && /^LORA_/.test(error.message)) return responder({ error: error.message }, 409);
    if (isPythonAdapterError(error)) {
      return responder(pythonErrorBody(error), error.status >= 400 && error.status <= 599 ? error.status : 502);
    }
    if (error instanceof PythonPlanMappingError) return responder({ error: error.message }, 502);
    console.error("[plan-edit] error inesperado:", error);
    return responder({ error: "No se pudo actualizar el plan contra el catálogo real." }, 500);
  }
}
