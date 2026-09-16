import { z } from "zod";
import { buscarCatalogoRag, type ProductoCandidato } from "@/lib/rag/chat/buscar";
import { getRagPool } from "@/lib/rag/db";
import { puntuacionCromatica } from "@/lib/rag/catalog/similitud-color";
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

type RecomendacionRow = {
  product_id: string;
  title: string;
  derived: Record<string, unknown>;
  product_available: boolean;
  imagen_principal: string | null;
  variant_id: string;
  sku: string | null;
  variante_titulo: string | null;
  price: string | number;
  variante_disponible: boolean;
  codigo_tamano: string | null;
  diam_pulg: string | number | null;
  forma: string | null;
  colores: string[];
};

function derivedStrings(derived: Record<string, unknown>, key: string): string[] {
  const value = derived[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function agruparRecomendaciones(rows: RecomendacionRow[]): ProductoCandidato[] {
  const porProducto = new Map<string, ProductoCandidato>();
  for (const row of rows) {
    const producto = porProducto.get(row.product_id) ?? {
      productId: row.product_id,
      titulo: row.title,
      categoria: typeof row.derived.category === "string" ? row.derived.category : null,
      colores: derivedStrings(row.derived, "colors"),
      acabados: derivedStrings(row.derived, "finishes"),
      ocasiones: derivedStrings(row.derived, "occasions"),
      disponible: row.product_available,
      imagen: row.imagen_principal,
      variantes: [],
    };
    producto.variantes.push({
      variantId: row.variant_id,
      sku: row.sku,
      titulo: row.variante_titulo,
      precio: Number(row.price),
      disponible: row.variante_disponible,
      codigoTamano: row.codigo_tamano,
      diamPulg: row.diam_pulg == null ? null : Number(row.diam_pulg),
      forma: row.forma,
      colores: row.colores ?? [],
    });
    porProducto.set(row.product_id, producto);
  }
  return [...porProducto.values()];
}

function cercaniaCromatica(colores: string[], actuales: string[]): number {
  return puntuacionCromatica(actuales, colores);
}

/**
 * `buscarRecomendaciones` no acepta allowlist en su SQL (recorre familia +
 * tamaño físico, no está indexado por dataset). Se filtra después: un
 * producto queda solo si su product_id está permitido, y dentro de él solo
 * las variantes cubiertas — nunca se enseña una variante que el modo LoRA
 * activo no puede renderizar, aunque el producto sí tenga alguna cubierta.
 */
function filtrarPorAllowlist(candidatos: ProductoCandidato[], allowlist: CatalogAllowlist | null): ProductoCandidato[] {
  if (!allowlist) return candidatos;
  const variantes = new Set(allowlist.variantIds);
  return candidatos.flatMap((candidato) => {
    const variantesPermitidas = candidato.variantes.filter((variante) => variantes.has(variante.variantId));
    return variantesPermitidas.length ? [{ ...candidato, variantes: variantesPermitidas }] : [];
  });
}

/**
 * Legacy recommendations for plans produced by the Next backend (rollback path).
 * Python plans never reach this SQL: they use `recomendarAlternativasPython`.
 */
async function buscarRecomendaciones(pool: ReturnType<typeof getRagPool>, variantId: string): Promise<ProductoCandidato[]> {
  const actual = await pool.query<{
    product_id: string;
    derived: Record<string, unknown>;
    codigo_tamano: string | null;
    diam_pulg: string | number | null;
    forma: string | null;
    derived_colors: string[];
  }>(
    `SELECT p.product_id, p.derived, v.codigo_tamano, v.diam_pulg, v.forma, v.derived_colors
       FROM catalog_variants v
       JOIN catalog_products p ON p.product_id = v.product_id
      WHERE v.variant_id = $1
        AND p.status = 'ACTIVE'`,
    [variantId],
  );
  const referencia = actual.rows[0];
  if (!referencia) throw new PlanEditError(404, "No se encontró la variante para recomendar alternativas.");

  const codigoTamano = referencia.codigo_tamano;
  const diamPulg = referencia.diam_pulg == null ? null : Number(referencia.diam_pulg);
  const forma = referencia.forma;
  const categoria = typeof referencia.derived.category === "string" ? referencia.derived.category : null;
  const coloresActuales = referencia.derived_colors ?? [];
  const params: unknown[] = [variantId];
  const filtrosFisicos = codigoTamano
    ? (() => {
        params.push(codigoTamano);
        return `v.codigo_tamano = $${params.length}::text`;
      })()
    : diamPulg != null
      ? (() => {
          params.push(diamPulg);
          return `v.diam_pulg = $${params.length}::numeric`;
        })()
      : "TRUE";
  const filtroForma = forma
    ? (() => {
        params.push(forma);
        return `AND v.forma = $${params.length}::text`;
      })()
    : "";
  params.push(referencia.product_id);
  const productParam = `$${params.length}::text`;
  const filtroFamilia = categoria
    ? (() => {
        params.push(categoria);
        return `AND (p.product_id = ${productParam} OR p.derived->>'category' = $${params.length}::text)`;
      })()
    : `AND p.product_id = ${productParam}`;
  const { rows } = await pool.query<RecomendacionRow>(
    `SELECT p.product_id, p.title, p.derived, p.available AS product_available, p.image_urls[1] AS imagen_principal,
            v.variant_id, v.sku, v.title AS variante_titulo, v.price, v.available AS variante_disponible,
            v.codigo_tamano, v.diam_pulg, v.forma, v.derived_colors AS colores
       FROM catalog_variants v
       JOIN catalog_products p ON p.product_id = v.product_id
      WHERE p.status = 'ACTIVE'
        AND p.available = true
       AND v.available = true
       AND v.variant_id <> $1::text
       AND ${filtrosFisicos}
        ${filtroForma}
        ${filtroFamilia}
      ORDER BY CASE WHEN p.product_id = ${productParam} THEN 0 ELSE 1 END,
               p.title ASC,
               v.price ASC
      LIMIT 100`,
    params,
  );

  rows.sort((a, b) => {
    const familiaA = a.product_id === referencia.product_id ? 0 : 1;
    const familiaB = b.product_id === referencia.product_id ? 0 : 1;
    const colorA = cercaniaCromatica(a.colores ?? [], coloresActuales);
    const colorB = cercaniaCromatica(b.colores ?? [], coloresActuales);
    return colorA - colorB || familiaA - familiaB || a.title.localeCompare(b.title) || Number(a.price) - Number(b.price);
  });

  return agruparRecomendaciones(rows);
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
      const contextoPlan = abrirContextoExigido(body.approval_token);
      if (contextoPlan.backend === "python") {
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
      const catalogAllowlist = await resolverCatalogAllowlist();
      const candidatos = filtrarPorAllowlist(await buscarRecomendaciones(pool, body.variant_id), catalogAllowlist);
      return Response.json({ candidatos: candidatos.slice(0, 12) }, { headers: cabeceras });
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
