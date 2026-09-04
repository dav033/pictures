import "server-only";
import type { Pool } from "pg";
import { featureEnabled } from "@/lib/ia/feature-flags";
import { MERMA } from "@/lib/cotizacion/constantes";
import { calcularDespieceEstructura } from "@/lib/medidas/geometria";
import { planHashResuelto } from "./hash";
import { completarMedidas } from "./medidas-defecto";
import { distribuirReservaProyecto, optimizarCobertura } from "./optimizar-materiales";
import { cajasDeEstructuras } from "./ubicaciones";
import type { CatalogAllowlist } from "@/lib/rag/retrieval/types";
import type { MaterialPlan, PlanDecoracion } from "./tipos";
import type { CompraConsolidada, EstructuraResuelta, LineaMaterial, PlanResuelto } from "./resuelto";

type FilaCatalogoPlan = {
  product_id: string;
  variant_id: string;
  sku: string | null;
  producto_titulo: string;
  variante_titulo: string | null;
  precio: number | string;
  unidades_paq: number | null;
  disponible: boolean;
  producto_disponible: boolean;
  codigo_tamano: string | null;
  forma: string | null;
  diam_pulg: number | string | null;
  colores_producto: unknown;
  colores_variante: unknown;
  acabados_producto: unknown;
  descripcion: string | null;
  imagen: string | null;
};

type Candidato = {
  productId: string;
  variantId: string;
  sku: string | null;
  titulo: string;
  precio: number;
  unidadesPaquete: number;
  codigoTamano: string | null;
  forma: string | null;
  diamPulg: number | null;
  colores: string[];
  acabados: string[];
  descripcion: string | null;
  imagen: string | null;
};

const GEOMETRICOS = new Set(["arco", "semiarco", "guirnalda", "columna", "pared", "centro_mesa"]);
const DIAMETROS_ESTANDAR = [5, 9, 12, 18, 24] as const;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizar(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function aCandidato(row: FilaCatalogoPlan): Candidato | null {
  const precio = Number(row.precio);
  const unidadesPaquete = Number(row.unidades_paq);
  const diamPulg = row.diam_pulg == null ? null : Number(row.diam_pulg);
  if (!row.disponible || !row.producto_disponible || !Number.isFinite(precio) || precio <= 0 || !Number.isInteger(unidadesPaquete) || unidadesPaquete <= 0) return null;
  return {
    productId: row.product_id,
    variantId: row.variant_id,
    sku: row.sku,
    titulo: row.variante_titulo ? `${row.producto_titulo} — ${row.variante_titulo}` : row.producto_titulo,
    precio,
    unidadesPaquete,
    codigoTamano: row.codigo_tamano,
    forma: row.forma,
    diamPulg: Number.isFinite(diamPulg) ? diamPulg : null,
     colores: [...new Set([...strings(row.colores_variante), ...strings(row.colores_producto)].map(normalizar))],
     acabados: strings(row.acabados_producto).map(normalizar),
    descripcion: row.descripcion,
    imagen: row.imagen,
  };
}

/**
 * Una sustitución de globo debe conservar la función física del tamaño.
 * Ser "el más cercano disponible" no basta: R-12→R-24 duplica el diámetro
 * y convirtió una columna corriente en 29 paquetes de globos gigantes.
 */
function sustitucionAdmisible(pedido: number, disponible: number): boolean {
  if (pedido === disponible) return true;
  const pedidoIndex = DIAMETROS_ESTANDAR.indexOf(pedido as (typeof DIAMETROS_ESTANDAR)[number]);
  const disponibleIndex = DIAMETROS_ESTANDAR.indexOf(disponible as (typeof DIAMETROS_ESTANDAR)[number]);
  if (pedidoIndex < 0 || disponibleIndex < 0 || Math.abs(pedidoIndex - disponibleIndex) !== 1) return false;
  return Math.max(pedido, disponible) / Math.min(pedido, disponible) <= 1.5;
}

function costoPaquetes(candidato: Candidato, unidades: number, merma = 0): number {
  const unidadesConMerma = Math.ceil(Math.max(0, unidades) * (1 + merma));
  return Math.ceil(unidadesConMerma / candidato.unidadesPaquete) * candidato.precio;
}

function elegir(candidatos: Candidato[], pulgadas: number, color: string | undefined, unidades: number, exacto = false): Candidato | null {
  const opciones = candidatosCompatibles(candidatos, pulgadas, color).filter((candidato) => !exacto || candidato.diamPulg === pulgadas);
  return opciones.slice().sort((a, b) => costoPaquetes(a, unidades) - costoPaquetes(b, unidades) || a.variantId.localeCompare(b.variantId))[0] ?? null;
}

function candidatosCompatibles(candidatos: Candidato[], pulgadas: number, color: string | undefined): Candidato[] {
  const redondos = candidatos.filter((candidato) =>
    candidato.forma === "redondo" &&
    candidato.diamPulg != null &&
    sustitucionAdmisible(pulgadas, candidato.diamPulg),
  );
  if (!redondos.length) return [];
  const conColor = color
    ? redondos.filter((candidato) => candidato.colores.length > 0 && candidato.colores.includes(normalizar(color)))
    : redondos;
  if (color && conColor.length === 0) return [];
  const distanciaMinima = Math.min(...conColor.map((candidato) => Math.abs(candidato.diamPulg! - pulgadas)));
  return conColor.filter((candidato) => Math.abs(candidato.diamPulg! - pulgadas) === distanciaMinima);
}

function unicosPor<T>(items: T[], clave: (item: T) => string): T[] {
  const vistas = new Set<string>();
  return items.filter((item) => {
    const key = clave(item);
    if (vistas.has(key)) return false;
    vistas.add(key);
    return true;
  });
}

function lineaDesdeCandidato(estructuraId: string, candidato: Candidato, unidades: number, color: string | undefined, pedidoPulgadas?: number): LineaMaterial {
  const sustitucion = pedidoPulgadas != null && candidato.diamPulg != null && candidato.diamPulg !== pedidoPulgadas
    ? {
        pedido: `R-${pedidoPulgadas}`,
        entregado: candidato.codigoTamano ?? `R-${candidato.diamPulg}`,
        motivo: `La whitelist no tiene R-${pedidoPulgadas}; se usó el diámetro más cercano disponible para ${color ?? "el producto"}.`,
      }
    : null;
  return {
    estructura_id: estructuraId,
    product_id: candidato.productId,
    variant_id: candidato.variantId,
    sku: candidato.sku,
    titulo: candidato.titulo,
    color: color ?? candidato.colores[0] ?? null,
    tamano_codigo: candidato.codigoTamano,
    diam_pulg: candidato.diamPulg,
    diam_cm: candidato.diamPulg == null ? null : Math.round(candidato.diamPulg * 2.54 * 10) / 10,
    forma: candidato.forma,
    acabado: candidato.acabados[0] ?? null,
    unidades,
    imagen: candidato.imagen,
    sustitucion,
  };
}

function repartirUnidades(total: number, materiales: MaterialPlan[]): number[] {
  const cuotas = materiales.map((material) => total * material.participacion);
  const unidades = cuotas.map(Math.floor);
  let faltan = total - unidades.reduce((sum, value) => sum + value, 0);
  const orden = cuotas.map((cuota, index) => ({ index, resto: cuota - unidades[index]! })).sort((a, b) => b.resto - a.resto || a.index - b.index);
  for (const item of orden) {
    if (faltan <= 0) break;
    unidades[item.index]! += 1;
    faltan -= 1;
  }
  return unidades;
}

function mezclaReal(lineas: LineaMaterial[]): EstructuraResuelta["mezcla_real"] {
  const total = lineas.reduce((sum, linea) => sum + linea.unidades, 0);
  const grupos = new Map<string, { diam_pulg: number; forma: string | null; unidades: number }>();
  for (const linea of lineas) {
    if (linea.diam_pulg == null) continue;
    const key = `${linea.forma ?? ""}:${linea.diam_pulg}`;
    const previo = grupos.get(key);
    grupos.set(key, { diam_pulg: linea.diam_pulg, forma: linea.forma, unidades: (previo?.unidades ?? 0) + linea.unidades });
  }
  return [...grupos.values()].sort((a, b) => b.unidades - a.unidades || b.diam_pulg - a.diam_pulg).map((linea) => ({ ...linea, pct: total ? Number(((linea.unidades / total) * 100).toFixed(2)) : 0 }));
}

function reoptimizarPresentaciones(
  estructuras: EstructuraResuelta[],
  candidatosPorProducto: Map<string, Candidato[]>,
  whitelist: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, number> {
  const grupos = new Map<string, LineaMaterial[]>();
  for (const estructura of estructuras) for (const linea of estructura.lineas) {
    if (linea.diam_pulg == null) continue;
     const key = `${linea.product_id}|${normalizar(linea.color ?? "")}|${linea.forma ?? ""}|${linea.diam_pulg}`;
    grupos.set(key, [...(grupos.get(key) ?? []), linea]);
  }
  const paquetes = new Map<string, number>();
  const optimizaciones = new Map<string, {
    lineas: LineaMaterial[];
    compras: Array<{ variantId: string; capacidad: number }>;
    candidatos: Map<string, Candidato>;
  }>();
  for (const lineas of grupos.values()) {
    const primera = lineas[0]!;
    const permitidas = whitelist.get(primera.product_id) ?? new Set<string>();
    const opciones = (candidatosPorProducto.get(primera.product_id) ?? [])
       .filter((candidato) => permitidas.has(candidato.variantId) && candidato.diamPulg === primera.diam_pulg && candidato.forma === primera.forma && (!primera.color || candidato.colores.includes(normalizar(primera.color))));
    const total = lineas.reduce((sum, linea) => sum + linea.unidades, 0);
    const cobertura = optimizarCobertura(total, opciones.map((candidato) => ({ variantId: candidato.variantId, unidadesPaquete: candidato.unidadesPaquete, precio: candidato.precio })));
    if (!cobertura) continue;
    for (const compra of cobertura.compras) paquetes.set(compra.variantId, (paquetes.get(compra.variantId) ?? 0) + compra.paquetes);
     optimizaciones.set(`${primera.product_id}|${normalizar(primera.color ?? "")}|${primera.forma ?? ""}|${primera.diam_pulg}`, {
      lineas,
      compras: cobertura.compras.map((compra) => ({ variantId: compra.variantId, capacidad: compra.capacidad })),
      candidatos: new Map((candidatosPorProducto.get(primera.product_id) ?? []).map((candidato) => [candidato.variantId, candidato])),
    });
  }

  // Una necesidad puede repartirse entre X50 y X12. No mutamos una línea en
  // sitio porque eso perdería la primera parte al sobrescribirla con la
  // segunda; se reconstruyen líneas físicas, conservando la trazabilidad de
  // la estructura y de cualquier sustitución admisible.
  for (const estructura of estructuras) {
    const lineasNuevas: LineaMaterial[] = [];
    for (const linea of estructura.lineas) {
      if (linea.diam_pulg == null) {
        lineasNuevas.push(linea);
        continue;
      }
       const optimizacion = optimizaciones.get(`${linea.product_id}|${normalizar(linea.color ?? "")}|${linea.forma ?? ""}|${linea.diam_pulg}`);
      if (!optimizacion) {
        lineasNuevas.push(linea);
        continue;
      }
      let restantes = linea.unidades;
      for (const compra of optimizacion.compras) {
        const asignadas = Math.min(restantes, compra.capacidad);
        if (asignadas <= 0) continue;
        const candidato = optimizacion.candidatos.get(compra.variantId);
        if (!candidato) continue;
        const nueva = lineaDesdeCandidato(linea.estructura_id, candidato, asignadas, linea.color ?? undefined, linea.diam_pulg);
        nueva.sustitucion = linea.sustitucion;
        lineasNuevas.push(nueva);
        compra.capacidad -= asignadas;
        restantes -= asignadas;
        if (restantes <= 0) break;
      }
      if (restantes > 0) lineasNuevas.push({ ...linea, unidades: restantes });
    }
    estructura.lineas = lineasNuevas;
    estructura.total_unidades = lineasNuevas.reduce((sum, linea) => sum + linea.unidades, 0);
    estructura.mezcla_real = mezclaReal(lineasNuevas);
  }
  return paquetes;
}

function calcularAlternativas(
  plan: PlanDecoracion,
  estructuras: EstructuraResuelta[],
  comprasActuales: CompraConsolidada[],
  candidatosPorProducto: Map<string, Candidato[]>,
  whitelist: ReadonlyMap<string, ReadonlySet<string>>,
  totalActual: number,
): PlanResuelto["alternativas"] {
  const necesidades = estructuras.flatMap((estructura) => estructura.lineas)
    .filter((linea) => linea.diam_pulg != null)
    .reduce((grupos, linea) => {
      const clave = `${normalizar(linea.color ?? "")}|${linea.forma ?? ""}|${linea.diam_pulg}`;
      grupos.set(clave, { color: linea.color, forma: linea.forma, diamPulg: linea.diam_pulg!, acabado: linea.acabado, unidades: (grupos.get(clave)?.unidades ?? 0) + linea.unidades });
      return grupos;
    }, new Map<string, { color: string | null; forma: string | null; diamPulg: number; acabado: string | null; unidades: number }>());

  if (necesidades.size === 0) return [];
  const costoNoGeometrico = comprasActuales.filter((compra) => compra.diam_pulg == null).reduce((sum, compra) => sum + compra.subtotal, 0);
  const perfiles = [...candidatosPorProducto.entries()].flatMap(([productId, candidatos]) => {
    const permitidas = whitelist.get(productId) ?? new Set<string>();
    const seleccionables = candidatos.filter((candidato) => permitidas.has(candidato.variantId));
    const compras: Array<{ variantId: string; paquetes: number; titulo: string }> = [];
    let total = costoNoGeometrico;
    for (const necesidad of necesidades.values()) {
      const opciones = seleccionables.filter((candidato) => candidato.forma === (necesidad.forma ?? "redondo")
        && candidato.diamPulg === necesidad.diamPulg
        && (!necesidad.color || candidato.colores.includes(normalizar(necesidad.color)))
        && (!necesidad.acabado || candidato.acabados.includes(normalizar(necesidad.acabado))));
      const cobertura = optimizarCobertura(necesidad.unidades, opciones.map((opcion) => ({ variantId: opcion.variantId, unidadesPaquete: opcion.unidadesPaquete, precio: opcion.precio })));
      if (!cobertura) return [];
      total += cobertura.costo;
      for (const compra of cobertura.compras) {
        const candidato = opciones.find((opcion) => opcion.variantId === compra.variantId);
        if (candidato) compras.push({ variantId: compra.variantId, paquetes: compra.paquetes, titulo: candidato.titulo.split(" — ")[0] ?? candidato.titulo });
      }
    }
    return [{ productId, total, compras }];
  }).sort((a, b) => a.total - b.total || a.productId.localeCompare(b.productId));

  const vistos = new Set<string>();
  return perfiles.slice(0, 3).filter((perfil) => {
    if (vistos.has(perfil.productId)) return false;
    vistos.add(perfil.productId);
    return true;
  }).map((perfil, index) => ({
    familia_id: perfil.productId,
    titulo: [...new Set(perfil.compras.map((compra) => compra.titulo))].join(" + ") || perfil.productId,
    total_cop: perfil.total,
    ahorro_cop: Math.max(0, totalActual - perfil.total),
    etiqueta: index === 0 ? "economica" as const : index === 1 ? "equilibrada" as const : "premium" as const,
  }));
}

/**
 * `allowlistLora` es la cobertura real del dataset del modo LoRA activo. Sin
 * ella, la rama geométrica elegía cualquier variante del producto por costo o
 * por sustitución de diámetro (`elegir`/`sustitucionAdmisible`) porque el SQL
 * trae todas las variantes de `idsProducto`. Eso producía planes con tamaños
 * que el modelo nunca vio —p. ej. R-24 de un producto entrenado solo en
 * R-5/R-9/R-12/R-18— que después `/api/generate` rechazaba con
 * LORA_DATASET_ALLOWLIST_REJECTED. Filtrar aquí convierte ese rechazo tardío
 * en `sin_cobertura` visible al armar el plan, que es donde se puede corregir.
 */
export async function resolverPlan(
  pool: Pool,
  planEntrada: PlanDecoracion,
  whitelist: ReadonlyMap<string, ReadonlySet<string>>,
  allowlistLora?: CatalogAllowlist | null,
): Promise<PlanResuelto> {
  const plan = completarMedidas(planEntrada);
  const idsProducto = plan.estructuras.flatMap((estructura) => estructura.materiales.map((material) => material.product_id));
  const idsVariante = plan.estructuras.flatMap((estructura) => estructura.materiales.map((material) => material.variant_id).filter((id): id is string => Boolean(id)));
  const idsWhitelistVariante = [...new Set([...whitelist.values()].flatMap((ids) => [...ids]))];
  const { rows } = idsProducto.length || idsVariante.length || idsWhitelistVariante.length
    ? await pool.query<FilaCatalogoPlan>(
        `SELECT v.product_id, v.variant_id, v.sku,
                p.title AS producto_titulo, v.title AS variante_titulo,
                v.price AS precio, NULLIF(to_jsonb(v)->>'unidades_paq', '')::integer AS unidades_paq,
                v.available AS disponible, p.available AS producto_disponible,
                 v.codigo_tamano, v.forma, v.diam_pulg,
                  COALESCE(p.derived->'colors', '[]'::jsonb) AS colores_producto,
                  COALESCE(v.derived_colors, ARRAY[]::text[]) AS colores_variante,
                  COALESCE(p.derived->'finishes', '[]'::jsonb) AS acabados_producto,
                  p.description_text AS descripcion,
                 COALESCE(NULLIF(BTRIM(v.image_url), ''), NULLIF(BTRIM(p.image_urls[1]), '')) AS imagen
           FROM catalog_variants v
           JOIN catalog_products p ON p.product_id = v.product_id
           WHERE (v.product_id = ANY($1::text[]) OR v.variant_id = ANY($2::text[]) OR v.variant_id = ANY($3::text[]))
             AND p.status = 'ACTIVE'`,
         [idsProducto, idsVariante, idsWhitelistVariante],
      )
    : { rows: [] as FilaCatalogoPlan[] };
  // Se filtra por `variantIds` y no por `productIds`: que un producto esté en
  // el dataset no implica que todos sus tamaños se hayan fotografiado, y es
  // justo esa diferencia la que rompía la generación.
  const variantesPermitidasLora = allowlistLora ? new Set(allowlistLora.variantIds) : null;
  const candidatosPorProducto = new Map<string, Candidato[]>();
  const candidatoPorVariante = new Map<string, Candidato>();
  for (const row of rows) {
    const candidato = aCandidato(row);
    if (!candidato) continue;
    if (variantesPermitidasLora && !variantesPermitidasLora.has(candidato.variantId)) continue;
    if (!candidatosPorProducto.has(candidato.productId)) candidatosPorProducto.set(candidato.productId, []);
    candidatosPorProducto.get(candidato.productId)!.push(candidato);
    candidatoPorVariante.set(candidato.variantId, candidato);
  }

  const sustituciones: PlanResuelto["sustituciones"] = [];
  const sinCobertura: PlanResuelto["sin_cobertura"] = [];
  const advertencias: string[] = [];
  const estructuras: EstructuraResuelta[] = [];
  for (const estructura of plan.estructuras) {
    const geometrica = GEOMETRICOS.has(estructura.tipo);
    const lineas: LineaMaterial[] = [];
    let ejeM: number | null = null;
    const faltantesAntes = sinCobertura.length;
    if (geometrica) {
      const geometria = calcularDespieceEstructura({
        tipo: estructura.tipo as Parameters<typeof calcularDespieceEstructura>[0]["tipo"],
        medidas: {
          anchoM: estructura.medidas.ancho_m,
          altoM: estructura.medidas.alto_m,
          largoM: estructura.medidas.largo_m,
        },
        repeticiones: estructura.repeticiones,
        densidad: estructura.densidad,
        mezcla: estructura.mezcla,
        tamanos: plan.restricciones?.tamanos.filter((item) => item.polaridad === "obligatorio").map((item) => Number(item.valor.replace(/^R-/i, ""))).filter(Number.isFinite),
        materiales: estructura.materiales.map((material) => ({ color: material.color, participacion: material.participacion })),
      });
      ejeM = geometria.ejeM;
      const candidatos = candidatosPorProducto;
      for (const despiece of geometria.despiece) {
        if (despiece.cantidad <= 0) continue;
        const materialId = estructura.materiales.find((material) => normalizar(material.color ?? "") === normalizar(despiece.color ?? ""))?.product_id ?? estructura.materiales[0]!.product_id;
        // Algunos modelos confunden product_id con variant_id porque ambos
        // aparecen juntos en los resultados RAG. Recuperar por variante y
        // canonicalizar al producto permite resolver la selección sin abrir la
        // whitelist a variantes que no salieron en este turno.
        const productoCanonico = candidatos.has(materialId) ? materialId : candidatoPorVariante.get(materialId)?.productId ?? materialId;
        const permitidasProducto = whitelist.get(productoCanonico) ?? whitelist.get(materialId) ?? new Set<string>();
        const opciones = (candidatos.get(productoCanonico) ?? []).filter((candidato) => permitidasProducto.has(candidato.variantId));
        const tamanosExplicitos = plan.restricciones?.tamanos.filter((item) => item.polaridad === "obligatorio") ?? [];
        const material = estructura.materiales.find((item) => normalizar(item.color ?? "") === normalizar(despiece.color ?? ""));
        const opcionesConAcabado = material?.acabado
          ? opciones.filter((candidato) => candidato.acabados.includes(normalizar(material.acabado!)))
          : opciones;
        const elegidoBase = elegir(opcionesConAcabado, despiece.pulgadas, despiece.color, despiece.cantidad, tamanosExplicitos.length > 0);
        const override = elegidoBase
          ? estructura.variant_overrides?.find((item) => item.objetivo_variant_id === elegidoBase.variantId)
          : undefined;
        const elegido = override ? candidatoPorVariante.get(override.variant_id) ?? null : elegidoBase;
        if (!elegido) {
          sinCobertura.push({ estructura_id: estructura.estructura_id, product_id: materialId, tamano: despiece.tamano });
          continue;
        }
        const linea = lineaDesdeCandidato(estructura.estructura_id, elegido, despiece.cantidad, override?.color ?? despiece.color, despiece.pulgadas);
        lineas.push(linea);
        if (linea.sustitucion) sustituciones.push({ estructura_id: estructura.estructura_id, ...linea.sustitucion });
      }
    } else {
      const unidades = repartirUnidades(estructura.unidades_declaradas ?? 0, estructura.materiales);
      for (const [index, material] of estructura.materiales.entries()) {
        if ((unidades[index] ?? 0) <= 0) continue;
        const permitido = whitelist.get(material.product_id)?.has(material.variant_id ?? "") ?? false;
        const elegido = material.variant_id && permitido ? candidatoPorVariante.get(material.variant_id) : null;
        if (!elegido) {
          sinCobertura.push({ estructura_id: estructura.estructura_id, product_id: material.product_id, tamano: material.variant_id ?? "variant_id inválido" });
          continue;
        }
        lineas.push(lineaDesdeCandidato(estructura.estructura_id, elegido, unidades[index]!, material.color));
      }
    }
    const totalUnidades = lineas.reduce((sum, linea) => sum + linea.unidades, 0);
    if (sinCobertura.length > faltantesAntes) advertencias.push(`estructura_sin_cobertura:${estructura.estructura_id}`);
    estructuras.push({
      estructura_id: estructura.estructura_id,
      nombre: estructura.nombre,
      tipo: estructura.tipo,
      ubicacion: estructura.ubicacion,
      repeticiones: estructura.repeticiones,
      eje_m: ejeM,
      total_unidades: totalUnidades,
      lineas,
      mezcla_real: mezclaReal(lineas),
      supuestos: plan.supuestos.filter((supuesto) => supuesto.includes(`para ${estructura.tipo}`)),
    });
  }

  const optimizerEnabled = featureEnabled("PLAN_COST_OPTIMIZER_V2");
  const paquetesOptimos = optimizerEnabled
    ? reoptimizarPresentaciones(estructuras, candidatosPorProducto, whitelist)
    : new Map<string, number>();
  const comprasPorVariante = new Map<string, CompraConsolidada>();
  for (const estructura of estructuras) {
    for (const linea of estructura.lineas) {
      const previa = comprasPorVariante.get(linea.variant_id);
      if (previa) {
        previa.unidades_necesarias += linea.unidades;
        if (!previa.estructuras.includes(estructura.estructura_id)) previa.estructuras.push(estructura.estructura_id);
      } else {
        const candidato = candidatoPorVariante.get(linea.variant_id);
        if (!candidato) continue;
        comprasPorVariante.set(linea.variant_id, {
          variant_id: linea.variant_id,
          product_id: linea.product_id,
          sku: linea.sku,
          titulo: linea.titulo,
          tamano_codigo: linea.tamano_codigo,
          diam_pulg: linea.diam_pulg,
          color: linea.color,
          unidades_necesarias: linea.unidades,
          design_quantity: linea.unidades,
          waste_reserve: 0,
          required_quantity: linea.unidades,
          unidades_con_merma: 0,
          unidades_paquete: candidato.unidadesPaquete,
          paquetes: 0,
          purchase_quantity: 0,
          used: linea.unidades,
          leftover_inventory: 0,
          consumption_cost: 0,
          purchase_cost: 0,
          additional_package_for_waste: false,
          sobrante: 0,
          precio_paquete: candidato.precio,
          subtotal: 0,
          estructuras: [estructura.estructura_id],
          imagen: candidato.imagen,
        });
      }
    }
  }
  const compras = [...comprasPorVariante.values()].sort((a, b) => a.variant_id.localeCompare(b.variant_id));
  for (const compra of compras) {
    // Primero se compran solo los paquetes necesarios para cubrir el diseño.
    // La reserva se distribuye después usando los sobrantes naturales.
    compra.unidades_con_merma = compra.unidades_necesarias;
    compra.paquetes = paquetesOptimos.get(compra.variant_id) ?? Math.max(1, Math.ceil(compra.unidades_con_merma / compra.unidades_paquete));
    compra.subtotal = compra.paquetes * compra.precio_paquete;
    compra.purchase_quantity = compra.paquetes * compra.unidades_paquete;
    compra.purchase_cost = compra.subtotal;
    compra.sobrante = compra.purchase_quantity - compra.unidades_necesarias;
    if (compra.unidades_necesarias > 0 && compra.sobrante / compra.unidades_necesarias > 0.4) advertencias.push(`sobrante_alto:${compra.variant_id}`);
  }
  const reserva = distribuirReservaProyecto(
    compras.map((compra) => ({
      id: compra.variant_id,
      designQuantity: compra.unidades_necesarias,
      purchaseQuantity: compra.purchase_quantity,
      compatibilityKey: compra.diam_pulg == null ? `non-balloon:${compra.variant_id}` : `R-${compra.diam_pulg}|${normalizar(compra.color ?? "")}`,
      eligible: compra.diam_pulg != null,
    })),
    MERMA,
  );
  for (const compra of compras) {
    compra.design_quantity = compra.unidades_necesarias;
    compra.waste_reserve = reserva.allocations.get(compra.variant_id) ?? 0;
    compra.required_quantity = compra.design_quantity + compra.waste_reserve;
    compra.unidades_con_merma = compra.required_quantity;
    compra.used = compra.design_quantity;
    compra.leftover_inventory = Math.max(0, compra.purchase_quantity - compra.required_quantity);
    compra.consumption_cost = compra.purchase_quantity > 0
      ? Math.round(compra.purchase_cost * compra.required_quantity / compra.purchase_quantity)
      : 0;
    compra.additional_package_for_waste = false;
  }
  if (reserva.uncoveredWasteReserve > 0) advertencias.push(`reserva_merma_no_cubierta:${reserva.uncoveredWasteReserve}`);
  const globosPorTamano: Record<string, number> = {};
  for (const compra of compras) if (compra.tamano_codigo) globosPorTamano[compra.tamano_codigo] = (globosPorTamano[compra.tamano_codigo] ?? 0) + compra.unidades_necesarias;
  const sustitucionesUnicas = unicosPor(sustituciones, (item) =>
    `${item.estructura_id}|${item.pedido}|${item.entregado}|${item.motivo}`,
  );
  const sinCoberturaUnica = unicosPor(sinCobertura, (item) =>
    `${item.estructura_id}|${item.product_id}|${item.tamano}`,
  );
  const totalCop = compras.reduce((sum, compra) => sum + compra.subtotal, 0);
  const costoPaquetesSinConsolidar = estructuras.flatMap((estructura) => estructura.lineas)
    .filter((linea) => linea.diam_pulg != null)
    .reduce((sum, linea) => {
      const candidato = candidatosPorProducto.get(linea.product_id)?.find((item) => item.variantId === linea.variant_id);
      return candidato ? sum + costoPaquetes(candidato, linea.unidades) : sum;
    }, 0);
  const costoPaquetesConsolidado = compras
    .filter((compra) => compra.diam_pulg != null)
    .reduce((sum, compra) => sum + compra.subtotal, 0);
  const ahorroPaquetesCop = Math.max(0, costoPaquetesSinConsolidar - costoPaquetesConsolidado);
  const costoIngenuoConMerma = estructuras.flatMap((estructura) => estructura.lineas)
    .filter((linea) => linea.diam_pulg != null)
    .reduce((sum, linea) => {
      const candidato = candidatosPorProducto.get(linea.product_id)?.find((item) => item.variantId === linea.variant_id);
      return candidato ? sum + costoPaquetes(candidato, linea.unidades, MERMA) : sum;
    }, 0);
  const ahorroMermaCop = Math.max(0, costoIngenuoConMerma - costoPaquetesSinConsolidar);
  const consumptionCost = compras.reduce((sum, compra) => sum + compra.consumption_cost, 0);
  const techoCop = plan.restricciones?.presupuesto?.techo_cop;
  const alternativas = optimizerEnabled
    ? calcularAlternativas(plan, estructuras, compras, candidatosPorProducto, whitelist, totalCop)
    : [];
  const snapshot = {
    estructuras: estructuras.map((estructura) => ({
      estructura_id: estructura.estructura_id,
      repeticiones: estructura.repeticiones,
      total_unidades: estructura.total_unidades,
       lineas: estructura.lineas.map((linea) => ({ variant_id: linea.variant_id, unidades: linea.unidades, color: linea.color, acabado: linea.acabado, forma: linea.forma, diam_pulg: linea.diam_pulg })),
    })),
    compras: compras.map((compra) => ({ variant_id: compra.variant_id, unidades_paquete: compra.unidades_paquete, paquetes: compra.paquetes, precio_paquete: compra.precio_paquete, subtotal: compra.subtotal, sobrante: compra.sobrante })),
    layout: cajasDeEstructuras(plan.estructuras),
    total_cop: totalCop,
    ahorro_paquetes_cop: ahorroPaquetesCop,
    target_waste_reserve: reserva.targetWasteReserve,
    covered_waste_reserve: reserva.coveredWasteReserve,
  };
  const mermaLog = [
    "MERMA / PACKAGE OPTIMIZATION",
    `Total design balloons: ${compras.filter((compra) => compra.diam_pulg != null).reduce((sum, compra) => sum + compra.design_quantity, 0)}`,
    `Target waste reserve: ${reserva.targetWasteReserve}`,
    `Natural package surplus: ${reserva.naturalSurplus}`,
    `Usable waste coverage: ${reserva.coveredWasteReserve}`,
    `Additional packages required for waste: ${compras.filter((compra) => compra.additional_package_for_waste).reduce((sum, compra) => sum + compra.paquetes, 0)}`,
    ...compras.map((compra) => `${compra.titulo}: design=${compra.design_quantity}, required=${compra.required_quantity}, package=${compra.unidades_paquete}, packages=${compra.paquetes}, purchased=${compra.purchase_quantity}, natural surplus=${compra.sobrante}, waste reserve=${compra.waste_reserve}, leftover inventory=${compra.leftover_inventory}`),
  ].join("\n");
  return {
    plan,
    plan_hash: planHashResuelto(plan, snapshot),
    estructuras,
    compras,
    totales: {
      globos_por_tamano: globosPorTamano,
      total_unidades: estructuras.reduce((sum, estructura) => sum + estructura.total_unidades, 0),
      total_cop: totalCop,
      design_quantity: compras.reduce((sum, compra) => sum + compra.design_quantity, 0),
      target_waste_reserve: reserva.targetWasteReserve,
      covered_waste_reserve: reserva.coveredWasteReserve,
      uncovered_waste_reserve: reserva.uncoveredWasteReserve,
      natural_package_surplus: reserva.naturalSurplus,
      purchase_cost: totalCop,
      consumption_cost: consumptionCost,
      waste_only_savings_cop: ahorroMermaCop,
      additional_waste_packages: compras.filter((compra) => compra.additional_package_for_waste).reduce((sum, compra) => sum + compra.paquetes, 0),
      ahorro_paquetes_cop: ahorroPaquetesCop,
      incluye_iva: process.env.PRECIO_INCLUYE_IVA !== "false",
      merma_porcentaje: MERMA * 100,
    },
    sustituciones: sustitucionesUnicas,
    sin_cobertura: sinCoberturaUnica,
    advertencias: [...new Set(advertencias)],
    comercial: {
      estado: techoCop == null ? "APROBACION_REQUERIDA" : totalCop > techoCop ? "PRESUPUESTO_EXCEDIDO" : "VERIFICADO",
      ...(techoCop == null ? {} : { techo_cop: techoCop, procedencia: plan.restricciones?.presupuesto?.procedencia }),
      delta_cop: techoCop == null ? 0 : Math.max(0, totalCop - techoCop),
    },
    alternativas,
    merma_log: mermaLog,
  };
}
