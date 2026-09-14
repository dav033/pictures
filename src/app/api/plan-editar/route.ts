import { z } from "zod";
import { buscarCatalogoRag, type ProductoCandidato } from "@/lib/rag/chat/buscar";
import { getRagPool } from "@/lib/rag/db";
import { registrarPlanAudit } from "@/lib/rag/observability/log";
import { puntuacionCromatica } from "@/lib/rag/catalog/similitud-color";
import { isPythonAdapterError, pythonErrorBody } from "@/lib/ia/python-adapter";
import { allowlistDesdeMapa, abrirContextoPlan, crearTokenPlan, mapaDesdeAllowlist, verificarTokenAprobacion, type ContextoPlan } from "@/lib/plan/aprobacion";
import { PythonPlanMappingError } from "@/lib/plan/python-mapper";
import { AllowlistProductoVarianteError } from "@/lib/plan/allowlist-producto-variante";
import { PlanEditError } from "@/lib/plan/edicion-error";
import { admitirVariantePython, exigirContextoPython, recomendarAlternativasPython } from "@/lib/plan/edicion-python";
import { PlanBackendNoDisponibleError, resolverPlanConBackend } from "@/lib/plan/resolver-backend";
import { PlanDecoracionSchema, type MaterialPlan, type PlanDecoracion } from "@/lib/plan/tipos";
import { LoraModeSlugSchema } from "@/lib/lora/schema";
import { resolveLoraModeDatasetAllowlist } from "@/lib/lora/mode-resolver";
import type { CatalogAllowlist } from "@/lib/rag/retrieval/types";
import { registrarFalloUi, traducirErrorServidor } from "@/lib/errores-ui/traducir-error-servidor";

const BaseLineaSchema = z.object({
  product_id: z.string().min(1),
  variant_id: z.string().min(1),
  color: z.string().nullable().optional(),
}).passthrough();

const BasePlanSchema = z.object({
  plan: PlanDecoracionSchema,
  plan_hash: z.string().regex(/^[a-f0-9]{64}$/i),
  approval_token: z.string().min(1),
  request_id: z.string().uuid().optional(),
  estructuras: z.array(z.object({
    estructura_id: z.string().min(1),
    lineas: z.array(BaseLineaSchema),
  }).passthrough()).min(1),
  compras: z.array(z.object({
    product_id: z.string().min(1),
    variant_id: z.string().min(1),
  }).passthrough()).min(1),
}).passthrough();

const VarianteEdicionSchema = z.object({
  product_id: z.string().trim().min(1).max(160),
  variant_id: z.string().trim().min(1).max(160),
  color: z.string().trim().min(1).max(80).optional(),
  acabado: z.string().trim().min(1).max(80).optional(),
}).strict();

const EdicionSchema = z.object({
  accion: z.enum(["agregar", "reemplazar", "quitar"]),
  estructura_id: z.string().trim().min(1).max(160),
  objetivo_variant_id: z.string().trim().min(1).max(160).optional(),
  variante: VarianteEdicionSchema.optional(),
  participacion: z.number().gt(0.01).lt(0.8).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.accion !== "agregar" && !value.objetivo_variant_id) {
    ctx.addIssue({ code: "custom", path: ["objetivo_variant_id"], message: "La operación necesita una variante objetivo." });
  }
  if (value.accion !== "quitar" && !value.variante) {
    ctx.addIssue({ code: "custom", path: ["variante"], message: "La operación necesita una variante del catálogo." });
  }
});

const BodySchema = z.discriminatedUnion("modo", [
  z.object({ modo: z.literal("buscar"), consulta: z.string().trim().min(2).max(240), approval_token: z.string().min(1).max(256 * 1024).optional(), loraMode: LoraModeSlugSchema.optional() }).strict(),
  z.object({ modo: z.literal("recomendadas"), variant_id: z.string().trim().min(1).max(160), approval_token: z.string().min(1), loraMode: LoraModeSlugSchema.optional() }).strict(),
  z.object({ modo: z.literal("aplicar"), base: BasePlanSchema, edicion: EdicionSchema, loraMode: LoraModeSlugSchema.optional() }).strict(),
]);

type BasePlan = z.infer<typeof BasePlanSchema>;
type Edicion = z.infer<typeof EdicionSchema>;

const MENSAJE_APROBACION_INVALIDA = "La aprobación base expiró o no corresponde a este plan.";

function correlationDesde(candidato: string | undefined): string {
  const parsed = z.string().uuid().safeParse(candidato);
  return parsed.success ? parsed.data : crypto.randomUUID();
}

function abrirContextoExigido(token: string): ContextoPlan {
  const contexto = abrirContextoPlan(token);
  if (!contexto) throw new PlanEditError(409, MENSAJE_APROBACION_INVALIDA);
  return contexto;
}

function normalizar(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function unicos(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizarParticipaciones(materiales: MaterialPlan[]): MaterialPlan[] {
  const total = materiales.reduce((sum, material) => sum + material.participacion, 0);
  if (total <= 0) throw new PlanEditError(400, "La estructura quedó sin participación de materiales.");

  let acumulado = 0;
  return materiales.map((material, index) => {
    const participacion = index === materiales.length - 1
      ? Math.max(0.000001, Number((1 - acumulado).toFixed(6)))
      : Number((material.participacion / total).toFixed(6));
    acumulado += participacion;
    return { ...material, participacion };
  });
}

async function whitelistDesdeBase(pool: ReturnType<typeof getRagPool>, base: BasePlan): Promise<Map<string, Set<string>>> {
  const ids = unicos([
    ...base.compras.map((compra) => compra.variant_id),
    ...base.plan.estructuras.flatMap((estructura) => estructura.materiales.map((material) => material.variant_id).filter((id): id is string => Boolean(id))),
    ...base.plan.estructuras.flatMap((estructura) => (estructura.variant_overrides ?? []).flatMap((override) => [override.objetivo_variant_id, override.variant_id])),
  ]);
  if (!ids.length) throw new PlanEditError(409, "El plan base no tiene variantes verificables.");

  const { rows } = await pool.query<{ product_id: string; variant_id: string }>(
    `SELECT v.product_id, v.variant_id
       FROM catalog_variants v
       JOIN catalog_products p ON p.product_id = v.product_id
      WHERE v.variant_id = ANY($1::text[])
        AND v.available = true
        AND p.available = true
        AND p.status = 'ACTIVE'`,
    [ids],
  );
  const porVariante = new Map(rows.map((row) => [row.variant_id, row.product_id]));
  if (rows.length !== ids.length || base.compras.some((compra) => porVariante.get(compra.variant_id) !== compra.product_id)) {
    throw new PlanEditError(409, "El catálogo cambió desde que se armó el plan. Vuelve a solicitar la propuesta.");
  }

  const whitelist = new Map<string, Set<string>>();
  for (const row of rows) {
    const variantes = whitelist.get(row.product_id) ?? new Set<string>();
    variantes.add(row.variant_id);
    whitelist.set(row.product_id, variantes);
  }
  return whitelist;
}

async function agregarVarianteAWhitelist(
  pool: ReturnType<typeof getRagPool>,
  whitelist: Map<string, Set<string>>,
  variante: NonNullable<Edicion["variante"]>,
): Promise<void> {
  const { rows } = await pool.query<{ product_id: string; variant_id: string }>(
    `SELECT v.product_id, v.variant_id
       FROM catalog_variants v
       JOIN catalog_products p ON p.product_id = v.product_id
      WHERE v.product_id = $1
        AND v.variant_id = $2
        AND v.available = true
        AND p.available = true
        AND p.status = 'ACTIVE'`,
    [variante.product_id, variante.variant_id],
  );
  if (rows.length !== 1) {
    // Legacy rollback path only: classify the failure so a variant paired with
    // a product that does not own it gets the stable cause instead of the
    // misleading "no longer available". No extra query on success.
    const propietario = await pool.query<{ product_id: string }>(
      "SELECT product_id FROM catalog_variants WHERE variant_id = $1",
      [variante.variant_id],
    );
    const dueno = propietario.rows[0]?.product_id;
    if (dueno !== undefined && dueno !== variante.product_id) throw new AllowlistProductoVarianteError();
    throw new PlanEditError(409, "La variante elegida ya no está disponible en el catálogo.");
  }
  const variantes = whitelist.get(variante.product_id) ?? new Set<string>();
  variantes.add(variante.variant_id);
  whitelist.set(variante.product_id, variantes);
}

function indiceMaterialParaLinea(
  materiales: MaterialPlan[],
  linea: { product_id: string; variant_id: string; color?: string | null },
): number {
  const porVariante = materiales.findIndex((material) => material.product_id === linea.product_id && material.variant_id === linea.variant_id);
  if (porVariante >= 0) return porVariante;
  const color = normalizar(linea.color ?? "");
  return materiales.findIndex((material) => material.product_id === linea.product_id && normalizar(material.color ?? "") === color);
}

function aplicarEdicion(base: BasePlan, edicion: Edicion): PlanDecoracion {
  const estructura = base.plan.estructuras.find((item) => item.estructura_id === edicion.estructura_id);
  if (!estructura) throw new PlanEditError(404, "No se encontró la estructura seleccionada.");

  const materiales = estructura.materiales.map((material) => ({ ...material }));
  if (edicion.accion === "agregar") {
    const variante = edicion.variante!;
    const participacion = edicion.participacion ?? 0.2;
    const restante = 1 - participacion;
    const existentes = normalizarParticipaciones(materiales).map((material) => ({
      ...material,
      participacion: material.participacion * restante,
    }));
    materiales.splice(0, materiales.length, ...normalizarParticipaciones([
      ...existentes,
      {
        product_id: variante.product_id,
        variant_id: variante.variant_id,
        color: variante.color,
        acabado: variante.acabado,
        participacion,
        rol_material: "acento",
      },
    ]));
  } else {
    const lineaObjetivo = base.estructuras
      .find((item) => item.estructura_id === edicion.estructura_id)
      ?.lineas.find((linea) => linea.variant_id === edicion.objetivo_variant_id);
    if (!lineaObjetivo) throw new PlanEditError(404, "No se encontró la variante objetivo en la estructura.");

    if (edicion.accion === "reemplazar" && ["arco", "semiarco", "guirnalda", "columna", "pared", "centro_mesa"].includes(estructura.tipo)) {
      // Las estructuras geométricas no mutan `materiales` (la "receta" de colores/participación);
      // el cambio vive en variant_overrides, que ya encadena ediciones sucesivas sobre la misma
      // pieza. Por eso esta rama no depende de indiceMaterialParaLinea: una pieza ya editada
      // antes puede tener un color que no está en `materiales`, y eso es válido.
      const overrides = (estructura.variant_overrides ?? []).filter((override) => override.objetivo_variant_id !== edicion.objetivo_variant_id);
      const variante = edicion.variante!;
      const overrideAnterior = overrides.find((override) => override.variant_id === edicion.objetivo_variant_id);
      const overridesSinCadena = overrides.filter((override) => override !== overrideAnterior);
      const nuevoOverride = {
        objetivo_variant_id: overrideAnterior?.objetivo_variant_id ?? edicion.objetivo_variant_id!,
        product_id: variante.product_id,
        variant_id: variante.variant_id,
        color: variante.color,
      };
      const planEditado: PlanDecoracion = {
        ...base.plan,
        estructuras: base.plan.estructuras.map((item) => item.estructura_id === estructura.estructura_id
          ? { ...item, variant_overrides: [...overridesSinCadena, nuevoOverride] }
          : item),
      };
      return PlanDecoracionSchema.parse(planEditado);
    }

    const indice = indiceMaterialParaLinea(materiales, lineaObjetivo);
    if (indice < 0) throw new PlanEditError(409, "La variante visible no corresponde a un material editable.");

    if (edicion.accion === "quitar") {
      if (materiales.length === 1) throw new PlanEditError(400, "No puedes quitar el único material de una estructura; reemplázalo o elimina la estructura completa.");
      materiales.splice(indice, 1);
      materiales.splice(0, materiales.length, ...normalizarParticipaciones(materiales));
    } else {
      const variante = edicion.variante!;
      materiales[indice] = {
        ...materiales[indice]!,
        product_id: variante.product_id,
        variant_id: variante.variant_id,
        color: variante.color ?? materiales[indice]!.color,
        acabado: variante.acabado ?? materiales[indice]!.acabado,
      };
    }
  }

  const planEditado: PlanDecoracion = {
    ...base.plan,
    estructuras: base.plan.estructuras.map((item) => item.estructura_id === estructura.estructura_id ? { ...item, materiales } : item),
  };
  return PlanDecoracionSchema.parse(planEditado);
}

function serializarCandidatos(resultado: Awaited<ReturnType<typeof buscarCatalogoRag>>) {
  return resultado.candidatos.slice(0, 8).map((candidato) => ({
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

export async function POST(request: Request) {
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
      return Response.json({ status: resultado.status, candidatos: serializarCandidatos(resultado), filtroRelajado: resultado.filtroRelajado });
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
        return Response.json({ candidatos });
      }
      const catalogAllowlist = await resolverCatalogAllowlist();
      const candidatos = filtrarPorAllowlist(await buscarRecomendaciones(pool, body.variant_id), catalogAllowlist);
      return Response.json({ candidatos: candidatos.slice(0, 12) });
    }

    const base = body.base;
    const aprobacionBase = verificarTokenAprobacion(base.approval_token, base.plan_hash);
    if (!aprobacionBase) throw new PlanEditError(409, MENSAJE_APROBACION_INVALIDA);

    const contextoPlan = abrirContextoExigido(base.approval_token);
    const backend = contextoPlan.backend;
    // Kill switch first: a Python plan never reaches TypeScript resolution or SQL.
    const snapshotPython = backend === "python" ? exigirContextoPython(contextoPlan) : null;
    const catalogAllowlist = await resolverCatalogAllowlist();
    const whitelist = backend === "next"
      ? await whitelistDesdeBase(pool, base)
      : mapaDesdeAllowlist(contextoPlan.allowlist);
    const correlationId = correlationDesde(base.request_id ?? aprobacionBase.requestId);

    const resolver = (plan: PlanDecoracion, allowlistPython: ContextoPlan["allowlist"]) => snapshotPython === null
      ? resolverPlanConBackend({ backend: "next", pool, plan, whitelist, loraAllowlist: catalogAllowlist })
      : resolverPlanConBackend({
          backend: "python",
          plan,
          allowlist: allowlistPython,
          catalogSnapshotId: snapshotPython,
          loraAllowlist: catalogAllowlist,
          requestId: crypto.randomUUID(),
          correlationId,
          signal: request.signal,
        });

    const planBaseVerificado = await resolver(base.plan, contextoPlan.allowlist);
    if (planBaseVerificado.resuelto.plan_hash !== base.plan_hash) {
      throw new PlanEditError(409, "El plan base cambió desde que se mostró. Vuelve a solicitar la propuesta.");
    }
    if (!verificarTokenAprobacion(base.approval_token, planBaseVerificado.resuelto.plan_hash)) {
      throw new PlanEditError(409, MENSAJE_APROBACION_INVALIDA);
    }

    if (body.edicion.accion !== "quitar") {
      const variante = body.edicion.variante!;
      // Se exige la variante exacta: que el producto esté entrenado no dice
      // nada del tamaño concreto, y aceptarlo por `product_id` dejaba pasar
      // tamaños nunca fotografiados (R-24 de un producto entrenado en R-5..R-18).
      if (catalogAllowlist && !catalogAllowlist.variantIds.includes(variante.variant_id)) {
        throw new PlanEditError(409, `LORA_DATASET_ALLOWLIST_REJECTED: ${variante.variant_id}`);
      }
      if (snapshotPython === null) {
        await agregarVarianteAWhitelist(pool, whitelist, variante);
      } else {
        // Python plans: Python admits the pair in the signed snapshot; Next never runs catalog SQL.
        await admitirVariantePython({ variante, catalogSnapshotId: snapshotPython, whitelist, correlationId, signal: request.signal });
      }
    }
    const planEditado = aplicarEdicion(base, body.edicion);
    const allowlistFinal = allowlistDesdeMapa(whitelist);
    const resolucionEditada = await resolver(planEditado, allowlistFinal);
    const resuelto = resolucionEditada.resuelto;
    if (resuelto.compras.length === 0) throw new PlanEditError(422, "El cambio dejó la estructura sin piezas disponibles.");

    const requestId = base.request_id ?? aprobacionBase.requestId;
    resuelto.request_id = requestId;
    resuelto.approval_token = crearTokenPlan({
      planHash: resuelto.plan_hash,
      requestId,
      backend,
      catalogSnapshotId: contextoPlan.catalogSnapshotId,
      allowlist: allowlistFinal,
    });
    await registrarPlanAudit(pool, {
      requestId,
      planHash: resuelto.plan_hash,
      restricciones: resuelto.plan.restricciones,
      selectedProductIds: resuelto.compras.map((compra) => compra.variant_id),
      geometry: { accion: body.edicion.accion, estructura_id: body.edicion.estructura_id, objetivo_variant_id: body.edicion.objetivo_variant_id, nueva_variant_id: body.edicion.variante?.variant_id },
      costChosenCop: resuelto.totales.total_cop,
      ceilingCop: resuelto.comercial.techo_cop,
      deltaCop: resuelto.comercial.delta_cop,
      packages: { ahorro_paquetes_cop: resuelto.totales.ahorro_paquetes_cop, lineas: resuelto.compras.map((compra) => ({ variant_id: compra.variant_id, paquetes: compra.paquetes, subtotal: compra.subtotal })) },
      status: "PLAN_EDITED",
    });

    return Response.json({ plan: resuelto, cotizacion: resolucionEditada.cotizacion });
  } catch (error) {
    // Los campos legacy (`error`, `causa`, `detalles`, sobre operational.v1) se
    // conservan para los consumidores actuales; `ui_error` (ui-error.v1) es lo
    // que muestra la interfaz.
    const uiError = traducirErrorServidor(error, isPythonAdapterError(error) ? error.requestId : undefined);
    registrarFalloUi("/api/plan-editar", uiError);
    const responder = (cuerpo: Record<string, unknown>, status: number) => Response.json({ ...cuerpo, ui_error: uiError }, { status });
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
