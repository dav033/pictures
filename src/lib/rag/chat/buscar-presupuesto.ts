import type { Pool } from "pg";
import { embeberTexto } from "../embeddings";
import { interpretarConsulta } from "../query-parser/parse";
import type { IntentQuery } from "../query-parser/schema";
import { buscarPorRol } from "../retrieval/por-rol";
import { puntuarYOrdenar, type CandidatoDetallado, type CandidatoPuntuado } from "../retrieval/rerank";
import { ensamblarCanasta, type Canasta } from "../presupuesto/ensamblar";
import { ROLES_PRESUPUESTO, type Franja, type RolPresupuesto } from "../presupuesto/franjas";
import { planificarCanasta } from "../presupuesto/plan";

export type PoolItemPresupuesto = {
  productId: string;
  variantId: string;
  titulo: string;
  precio: number;
  imagen: string | null;
  disponible: boolean;
};

export type ResultadoBusquedaPresupuesto = {
  status: "OK" | "NO_MATCH";
  franja: { slug: string; nombre: string; rangoMinCop: number; rangoMaxCop: number | null } | null;
  canasta: Canasta | null;
  /** Alternativas reales por rol para que el LLM pueda intercambiar una
   * pieza sin volver a buscar (§3, Etapa 5, `pool_por_rol`). */
  poolPorRol: Partial<Record<RolPresupuesto, PoolItemPresupuesto[]>>;
  relajaciones: string[];
  conflictos: string[];
  intent: IntentQuery | null;
  latencyParseMs: number;
  latencyRetrievalMs: number;
};

type FilaCandidatoDetalle = {
  product_id: string;
  title: string;
  derived: { category: string | null; colors: string[]; occasions: string[] };
  available: boolean;
  imagen_principal: string | null;
  variant_id: string;
  sku: string | null;
  price: string;
  variante_disponible: boolean;
  inventario: number | null;
};

/**
 * Orquesta el pipeline de franjas de presupuesto completo (§3): plan de
 * canasta → retrieval por rol → rerank + diversidad → ensamblaje con
 * presupuesto. Sustituye a `buscarCatalogoRag` cuando el turno tiene una
 * franja resuelta (ver `resolverFranja` — nunca la decide el LLM).
 */
export async function buscarCatalogoRagConPresupuesto(
  pool: Pool,
  mensaje: string,
  franja: Franja,
  cifraCliente: number | undefined,
): Promise<ResultadoBusquedaPresupuesto> {
  const t0 = Date.now();
  const intento = await interpretarConsulta(mensaje);
  const latencyParseMs = Date.now() - t0;

  if (intento.intent !== "product_search") {
    return {
      status: "NO_MATCH",
      franja: null,
      canasta: null,
      poolPorRol: {},
      relajaciones: [],
      conflictos: [],
      intent: intento,
      latencyParseMs,
      latencyRetrievalMs: 0,
    };
  }

  const plan = planificarCanasta(franja, { categoriasPedidas: intento.filtros_duros.categorias }, cifraCliente);
  const franjaInfo = { slug: franja.slug, nombre: franja.nombre, rangoMinCop: franja.minCop, rangoMaxCop: franja.maxCop };

  const t1 = Date.now();
  // Un solo embedding para todo el turno (§3, Etapa 2) — cada rol lo reusa.
  const embeddingBase = intento.semantic_query.trim() ? await embeberTexto(intento.semantic_query, "RETRIEVAL_QUERY") : undefined;

  const resultadosPorRol = await Promise.all(
    plan.roles.map((cuota) =>
      buscarPorRol(pool, intento.semantic_query, embeddingBase, cuota, {
        colores: intento.filtros_duros.colores.length ? intento.filtros_duros.colores : undefined,
        ocasiones: intento.filtros_duros.ocasiones.length ? intento.filtros_duros.ocasiones : undefined,
        disponible: intento.filtros_duros.solo_disponibles,
      }),
    ),
  );
  const latencyRetrievalMs = Date.now() - t1;

  const relajaciones = resultadosPorRol.flatMap((r) => r.relajaciones);

  const pares = resultadosPorRol.flatMap((r) =>
    r.candidatos.flatMap((c) => c.variantIds.map((variantId) => ({ productId: c.productId, variantId, rankRrf: c.finalScore, rol: r.rol }))),
  );

  if (pares.length === 0) {
    return {
      status: "NO_MATCH",
      franja: franjaInfo,
      canasta: null,
      poolPorRol: {},
      relajaciones,
      conflictos: plan.conflictos,
      intent: intento,
      latencyParseMs,
      latencyRetrievalMs,
    };
  }

  // Una sola consulta de detalle para la unión de (producto, variante) de
  // todos los roles, en vez de una por rol.
  const productIds = [...new Set(pares.map((p) => p.productId))];
  const { rows } = await pool.query<FilaCandidatoDetalle>(
    `SELECT p.product_id, p.title, p.derived, p.available, p.image_urls[1] AS imagen_principal,
            v.variant_id, v.sku, v.price, v.available AS variante_disponible, v.inventory_quantity AS inventario
     FROM catalog_products p
     JOIN catalog_variants v ON v.product_id = p.product_id
     WHERE p.product_id = ANY($1::text[])`,
    [productIds],
  );
  const filaPorPar = new Map<string, FilaCandidatoDetalle>(rows.map((r) => [`${r.product_id}:${r.variant_id}`, r]));

  const detalladosPorRol = {} as Record<RolPresupuesto, CandidatoDetallado[]>;
  for (const rol of ROLES_PRESUPUESTO) detalladosPorRol[rol] = [];
  for (const par of pares) {
    const fila = filaPorPar.get(`${par.productId}:${par.variantId}`);
    if (!fila) continue;
    detalladosPorRol[par.rol].push({
      rol: par.rol,
      productId: fila.product_id,
      variantId: fila.variant_id,
      titulo: fila.title,
      categoria: fila.derived.category,
      colores: fila.derived.colors,
      ocasiones: fila.derived.occasions,
      disponible: fila.available && fila.variante_disponible,
      imagen: fila.imagen_principal,
      precio: Number(fila.price),
      inventario: fila.inventario,
      sku: fila.sku,
      rankRrf: par.rankRrf,
    });
  }

  const poolsPuntuados = {} as Record<RolPresupuesto, CandidatoPuntuado[]>;
  for (const cuota of plan.roles) {
    poolsPuntuados[cuota.rol] = puntuarYOrdenar(detalladosPorRol[cuota.rol], {
      topeCop: cuota.topeCop,
      coloresPedidos: intento.filtros_duros.colores,
      ocasionesPedidas: intento.filtros_duros.ocasiones,
    });
  }

  const canasta = ensamblarCanasta(plan, poolsPuntuados);

  const poolPorRol: ResultadoBusquedaPresupuesto["poolPorRol"] = {};
  for (const cuota of plan.roles) {
    if (poolsPuntuados[cuota.rol].length === 0) continue;
    poolPorRol[cuota.rol] = poolsPuntuados[cuota.rol].slice(0, 8).map((c) => ({
      productId: c.productId,
      variantId: c.variantId,
      titulo: c.titulo,
      precio: c.precio,
      imagen: c.imagen,
      disponible: c.disponible,
    }));
  }

  const relajacionesRolesIncompletos = canasta.rolesIncompletos.map(
    (rol) => `${rol}: la cuota mínima de este rol no se cubrió con el inventario disponible`,
  );

  return {
    status: canasta.piezas.length > 0 ? "OK" : "NO_MATCH",
    franja: franjaInfo,
    canasta,
    poolPorRol,
    relajaciones: [...relajaciones, ...relajacionesRolesIncompletos],
    conflictos: plan.conflictos,
    intent: intento,
    latencyParseMs,
    latencyRetrievalMs,
  };
}
