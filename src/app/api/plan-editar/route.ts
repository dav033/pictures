import { z } from "zod";
import { buscarCatalogoRag, type FiltrosExploracion, type ProductoCandidato } from "@/lib/rag/chat/buscar";
import { listarColoresCatalogo } from "@/lib/rag/chat/colores-catalogo";
import { claveColores, coloresParaExplorar } from "@/lib/rag/chat/cache-exploracion";
import { getRagPool } from "@/lib/rag/db";
import { isPythonAdapterError, pythonErrorBody } from "@/lib/ia/nucleo/python-adapter";
import { PythonPlanMappingError } from "@/lib/plan/python-mapper";
import { AllowlistProductoVarianteError } from "@/lib/plan/allowlist-producto-variante";
import { PlanEditError } from "@/lib/plan/edicion-error";
import { exigirContextoPython, recomendarAlternativasPython } from "@/lib/plan/edicion-python";
import { PlanBackendNoDisponibleError } from "@/lib/plan/resolver-backend";
import { registrarFalloUi, traducirErrorServidor } from "@/lib/errores-ui/traducir-error-servidor";
import { filtrarCandidatosCompatibles } from "@/lib/plan/edicion-compatibilidad";
import {
  abrirContextoExigido,
  aplicarEdicionPlan,
  correlationDesde,
} from "@/lib/plan/aplicar-edicion";
import { BasePlanSchema, EdicionArmadoArcoOrganicoSchema, EdicionArmadoArcoSchema, EdicionArmadoColumnaOrganicaSchema, EdicionArmadoColumnaSchema, EdicionArmadoGuirnaldaOrganicaSchema, EdicionArmadoGuirnaldaSchema, EdicionArmadoSchema, EdicionFormaSchema, EdicionMezclaSchema, EdicionPatronSchema, EdicionPropiedadesSchema, EdicionRepartoSchema, EdicionSchema } from "@/lib/plan/edicion-esquemas";
import { conRegistro } from "@/lib/registro/servidor";
import { agregarColorPlan, quitarPiezaPlan } from "@/lib/plan/ajuste-plan-entero";

/** Candidates a search returns when the caller does not say (what the inline editor always got). */
const LIMITE_BUSQUEDA_PREDETERMINADO = 8;
/** Python's own cap: with a target line it is asked for everything so the compatibility filter cannot starve the page. */
const LIMITE_PYTHON_MAXIMO = 50;
/** Python never reads this text when the search has filters and no text (`sinTexto`): it only labels the request. */
const ETIQUETA_EXPLORACION = "catalogo";

const FiltrosBusquedaSchema = z.object({
  colores: z.array(z.string().trim().min(1).max(60)).max(8).optional(),
  tamanos_pulgadas: z.array(z.number().positive().max(100)).max(8).optional(),
  formas: z.array(z.string().trim().min(1).max(40)).max(4).optional(),
  acabados: z.array(z.string().trim().min(1).max(40)).max(4).optional(),
}).strict();

function exploracionDe(filtros: z.infer<typeof FiltrosBusquedaSchema> | undefined): FiltrosExploracion | undefined {
  if (!filtros) return undefined;
  const exploracion: FiltrosExploracion = {
    ...(filtros.colores?.length ? { colores: filtros.colores } : {}),
    ...(filtros.formas?.length ? { formas: filtros.formas } : {}),
    ...(filtros.acabados?.length ? { acabados: filtros.acabados } : {}),
    ...(filtros.tamanos_pulgadas?.length ? { diametros_pulgadas: filtros.tamanos_pulgadas } : {}),
  };
  return Object.keys(exploracion).length ? exploracion : undefined;
}

const BodySchema = z.discriminatedUnion("modo", [
  z.object({
    modo: z.literal("buscar"),
    /** Free text; it may be empty (or one character) only when `filtros` carries at least one filter. */
    consulta: z.string().trim().max(240),
    approval_token: z.string().min(1).max(256 * 1024).optional(),
    /** Line the search would replace ("Modificar"): a balloon only accepts balloons of the same shape. */
    linea_objetivo: z.object({
      forma: z.string().trim().min(1).max(40).nullable().optional(),
      diam_pulg: z.number().positive().max(100).nullable().optional(),
    }).strict().optional(),
    /** What the customer clicked in the explorer; explicit requirements, never relaxed. */
    filtros: FiltrosBusquedaSchema.optional(),
    /** How many candidates to return (default 8). */
    limite: z.number().int().min(1).max(40).optional(),
  }).strict().superRefine((valor, contexto) => {
    if (valor.consulta.length < 2 && exploracionDe(valor.filtros) === undefined) {
      contexto.addIssue({ code: "custom", path: ["consulta"], message: "Escribe al menos 2 caracteres o elige algún filtro." });
    }
  }),
  z.object({
    modo: z.literal("colores"),
    approval_token: z.string().min(1).max(256 * 1024).optional(),
  }).strict(),
  z.object({ modo: z.literal("recomendadas"), variant_id: z.string().trim().min(1).max(160), approval_token: z.string().min(1) }).strict(),
  // «Ajustar mi plan» de la guiada (ajuste-plan-entero.ts): quitar UNA pieza o añadir un color sin modelo; Python
  // vuelve a resolver y a firmar, y lo demás queda igual.
  z.object({ modo: z.literal("quitar_pieza"), base: BasePlanSchema, estructura_id: z.string().regex(/^EST_\d{2}_[A-Z_]+$/) }).strict(),
  z.object({
    modo: z.literal("agregar_color"),
    base: BasePlanSchema,
    color: z.string().trim().min(1).max(40),
    product_id: z.string().trim().min(1).max(160),
    variant_ids: z.array(z.string().trim().min(1).max(160)).min(1).max(24).refine((ids) => new Set(ids).size === ids.length),
  }).strict(),
  z.object({ modo: z.literal("aplicar"), base: BasePlanSchema, edicion: z.union([EdicionSchema, EdicionRepartoSchema, EdicionMezclaSchema, EdicionPatronSchema, EdicionArmadoSchema, EdicionArmadoGuirnaldaSchema, EdicionArmadoArcoSchema, EdicionArmadoColumnaSchema, EdicionArmadoColumnaOrganicaSchema, EdicionArmadoGuirnaldaOrganicaSchema, EdicionArmadoArcoOrganicoSchema, EdicionFormaSchema, EdicionPropiedadesSchema]) }).strict(),
]);

const MENSAJE_JSON_INVALIDO = "El cuerpo de la solicitud no es JSON válido.";

/**
 * Variants kept per product. The explorer shows one option per size and color and folds the package sizes into it,
 * so cutting the list would hide sizes or colors the customer could pick. The catalog's most-varied product has 20
 * (measured); 48 leaves room without letting one product bloat the answer.
 */
const MAX_VARIANTES_POR_PRODUCTO = 48;

function serializarCandidatos(candidatos: readonly ProductoCandidato[], limite: number) {
  return candidatos.slice(0, limite).map((candidato) => ({
    productId: candidato.productId,
    titulo: candidato.titulo,
    categoria: candidato.categoria,
    imagen: candidato.imagen,
    disponible: candidato.disponible,
    variantes: candidato.variantes.slice(0, MAX_VARIANTES_POR_PRODUCTO),
  }));
}

function requestIdDe(request: Request): string {
  const cabecera = request.headers.get("x-request-id");
  return z.string().uuid().safeParse(cabecera).success ? cabecera! : crypto.randomUUID();
}

// Auditado (src/lib/registro): entrada, salida, errores y lo que la petición llame (IA, Python, decisiones).
export const POST = conRegistro("/api/plan-editar", atenderPOST);

async function atenderPOST(request: Request) {
  // Every response carries X-Request-ID, so a failed edit can be traced (E2E 2026-09-14).
  const requestIdHttp = requestIdDe(request);
  const cabeceras = { "X-Request-ID": requestIdHttp };
  let json: unknown;
  try {
    json = await request.json();
  } catch (error) {
    // A malformed body is the client's error, not a 500.
    const uiError = traducirErrorServidor(error instanceof SyntaxError ? error : new SyntaxError(MENSAJE_JSON_INVALIDO), requestIdHttp);
    registrarFalloUi("/api/plan-editar", uiError);
    return Response.json({ error: MENSAJE_JSON_INVALIDO, ui_error: uiError }, { status: 400, headers: cabeceras });
  }
  try {
    const body = BodySchema.parse(json);
    const pool = getRagPool();

    if (body.modo === "buscar") {
      // Con un token de plan Python la búsqueda queda fijada al snapshot firmado;
      // sin token (o con uno de Next) conserva el comportamiento anterior.
      const contextoBusqueda = body.approval_token === undefined ? null : abrirContextoExigido(body.approval_token);
      const catalogSnapshotId = contextoBusqueda?.backend === "python" ? exigirContextoPython(contextoBusqueda) : undefined;
      // La lectura usa filtros del cliente y el snapshot firmado, sin restringir por modo de generación.
      const exploracion = exploracionDe(body.filtros);
      const sinTexto = body.consulta.length < 2;
      const limite = body.limite ?? LIMITE_BUSQUEDA_PREDETERMINADO;
      const limitePython = body.linea_objetivo ? LIMITE_PYTHON_MAXIMO : body.limite;
      const resultado = await buscarCatalogoRag(pool, sinTexto ? ETIQUETA_EXPLORACION : body.consulta, {
        ...(catalogSnapshotId === undefined ? {} : { catalogSnapshotId }),
        ...(exploracion === undefined ? {} : { exploracion }),
        ...(sinTexto ? { sinTexto: true } : {}),
        ...(limitePython === undefined ? {} : { limite: limitePython }),
      });
      const compatibles = filtrarCandidatosCompatibles(resultado.candidatos, body.linea_objetivo);
      // `hayMas`: there are candidates beyond the page (the compatible ones exceed it, or Python filled the page it was asked for).
      const hayMas = compatibles.length > limite || (limitePython !== undefined && resultado.candidatos.length >= limitePython);
      return Response.json(
        { status: resultado.status, candidatos: serializarCandidatos(compatibles, limite), filtroRelajado: resultado.filtroRelajado, hayMas },
        { headers: cabeceras },
      );
    }

    if (body.modo === "colores") {
      // Mismo snapshot firmado que `buscar`.
      const contextoColores = body.approval_token === undefined ? null : abrirContextoExigido(body.approval_token);
      const catalogSnapshotId = contextoColores?.backend === "python" ? exigirContextoPython(contextoColores) : undefined;
      // La lista de un snapshot publicado no cambia: se recuerda por snapshot (cache-exploracion.ts).
      const colores = await coloresParaExplorar(
        claveColores(catalogSnapshotId),
        catalogSnapshotId !== undefined,
        () => listarColoresCatalogo({
          ...(catalogSnapshotId === undefined ? {} : { catalogSnapshotId }),
          requestId: requestIdHttp,
        }),
      );
      return Response.json({ colores }, { headers: cabeceras });
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
        correlationId: correlationDesde(contextoPlan.requestId),
        signal: request.signal,
      });
      return Response.json({ candidatos }, { headers: cabeceras });
    }

    if (body.modo === "quitar_pieza") {
      const { plan: resuelto, cotizacion } = await quitarPiezaPlan({ base: body.base, estructuraId: body.estructura_id, pool, signal: request.signal });
      return Response.json({ plan: resuelto, cotizacion }, { headers: cabeceras });
    }
    if (body.modo === "agregar_color") {
      const { plan: resuelto, cotizacion, piezas } = await agregarColorPlan({ base: body.base, color: body.color, productId: body.product_id, variantIds: body.variant_ids, pool, signal: request.signal });
      return Response.json({ plan: resuelto, cotizacion, piezas }, { headers: cabeceras });
    }

    // The signed-approval / re-resolution / admission logic lives in
    // `aplicarEdicionPlan` (src/lib/plan/aplicar-edicion.ts) so the chat tool
    // `ajustar_plan_decoracion` (src/lib/ia/herramientas/registro-herramientas.ts) can call
    // the exact same checks instead of a second implementation.
    const { plan: resuelto, cotizacion, avisos } = await aplicarEdicionPlan({
      base: body.base,
      edicion: body.edicion,
      pool,
      signal: request.signal,
    });
    // `avisos` only when the edit has something to say (a rebuilt color pattern).
    return Response.json({ plan: resuelto, cotizacion, ...(avisos.length ? { avisos } : {}) }, { headers: cabeceras });
  } catch (error) {
    // Los campos legacy (`error`, `causa`, `detalles`, sobre operational.v1) se
    // conservan para los consumidores actuales; `ui_error` (ui-error.v1) es lo
    // que muestra la interfaz.
    const uiError = traducirErrorServidor(error, isPythonAdapterError(error) ? error.requestId : requestIdHttp);
    registrarFalloUi("/api/plan-editar", uiError);
    const responder = (cuerpo: Record<string, unknown>, status: number) => Response.json({ ...cuerpo, ui_error: uiError }, { status, headers: cabeceras });
    if (error instanceof z.ZodError) return responder({ error: "La edición del plan no tiene un formato válido.", detalles: error.issues }, 400);
    if (error instanceof PlanEditError) {
      return responder({ error: error.message, ...(error.causa ? { causa: error.causa } : {}), ...(error.patron ? { motivo: error.patron.motivo, mensaje: error.patron.mensaje } : {}) }, error.status);
    }
    if (error instanceof PlanBackendNoDisponibleError) return responder({ error: error.message, causa: error.motivo }, 409);
    if (error instanceof AllowlistProductoVarianteError) return responder({ error: error.message, causa: error.causa }, 422);
    if (error instanceof Error && /^FLUX_/.test(error.message)) return responder({ error: error.message }, 409);
    if (isPythonAdapterError(error)) {
      return responder(pythonErrorBody(error), error.status >= 400 && error.status <= 599 ? error.status : 502);
    }
    if (error instanceof PythonPlanMappingError) return responder({ error: error.message }, 502);
    console.error("[plan-edit] error inesperado:", error);
    return responder({ error: "No se pudo actualizar el plan contra el catálogo real." }, 500);
  }
}
