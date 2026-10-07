import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { decoracionesSempertex, proveedoresSempertex, bibliotecaVisible } from "@/lib/biblioteca-sempertex/biblioteca";
import { DecoracionSempertexSchema } from "@/lib/biblioteca-sempertex/esquemas";
import { getRagPool } from "@/lib/rag/db";
import { ESTRUCTURAS_OFICIALES_IDS } from "@/lib/plan/estructuras-oficiales";

const ejemplos = decoracionesSempertex.filter((decoracion) => decoracion.origen === "ejemplo");
const reales = decoracionesSempertex.filter((decoracion) => decoracion.origen === "referencia_real");
// Curadas a mano sobre fotos oficiales de Sempertex (deco-real-21…31): cada material dice de dónde sale su cantidad.
const esCurada = (decoracion: (typeof reales)[number]) => decoracion.materiales.every((material) => material.origenCantidad !== undefined);
const curadas = reales.filter(esCurada);
assert.equal(decoracionesSempertex.length, 46);
assert.equal(curadas.length, 11, "11 decoraciones curadas de las fotos de Sempertex");
assert.equal(proveedoresSempertex.length, 13);
assert.ok(["Bogotá", "Medellín", "Cali", "Barranquilla"].every((ciudad) => proveedoresSempertex.filter((proveedor) => proveedor.zona.ciudad === ciudad && (proveedor.tipo === "decorador_happia" || proveedor.tipo === "mbp")).length === 2));
assert.equal(ejemplos.length, 15);
assert.equal(reales.length, 31);
assert.ok(ejemplos.every((decoracion) => decoracion.id.startsWith("ej-") && decoracion.aviso === "DATO DE EJEMPLO — no es real"));
assert.ok(ejemplos.every((decoracion) => decoracion.materiales.length > 0 && (decoracion.fotos[0]?.url.startsWith("https://cdn.shopify.com/") || decoracion.fotos[0]?.url.startsWith("/biblioteca-sempertex/kits/")) && decoracion.fotos[0]?.fuente.includes("Foto real del E-Decor")));
assert.ok(reales.every((decoracion) => decoracion.id.startsWith("deco-real-") && decoracion.materiales.length > 0 && decoracion.origen === "referencia_real"));
for (const decoracion of reales) {
  const foto = decoracion.fotos[0];
  assert.ok(foto?.url.startsWith("/biblioteca-sempertex/referencias/"), `${decoracion.id}: foto local`);
  assert.equal(foto?.licencia, "referencia_web_sin_licencia", `${decoracion.id}: licencia declarada`);
  assert.ok(foto?.fuente && foto.fuente.length > 0, `${decoracion.id}: archivo de origen`);
  assert.ok(existsSync(path.join(process.cwd(), "public", foto!.url.slice(1))), `${decoracion.id}: foto local existente`);
  assert.ok(decoracion.piezas.length > 0 && decoracion.piezas.every((pieza) => ESTRUCTURAS_OFICIALES_IDS.includes(pieza.estructura)), `${decoracion.id}: piezas oficiales`);
  assert.equal(decoracion.fotoRepresentativa, true, `${decoracion.id}: foto representativa`);
  if (esCurada(decoracion)) {
    // Curadas: globos de cualquier forma (redondos, para modelar, eslabón, corazón, metalizados) e impresos si la foto los muestra.
    assert.ok(decoracion.materiales.every((material) => /^\d+$/.test(material.variantId) && material.cantidad > 0 && /^B2b .+ — .+ · [^·]+$/.test(material.nota ?? "")), `${decoracion.id}: variantes con nota del catálogo`);
    // Lo que resolvió Python se respeta: la cantidad es la del plan guardado (o la supera, si se le suma lo contado en la foto).
    const planes = new Map<string, Map<string, number>>();
    for (const material of decoracion.materiales.filter((item) => item.origenCantidad !== "estimado_foto")) {
      const ruta = /\[(data\/biblioteca-real\/analisis\/nueva-sempertex-\d{2}\.plan\.json)\]/.exec(material.detalleCantidad ?? "")?.[1];
      assert.ok(ruta, `${decoracion.id}: ${material.variantId} cita su plan de Python`);
      if (!planes.has(ruta)) {
        const plan = JSON.parse(readFileSync(path.join(process.cwd(), ruta), "utf8")) as { estado?: string; snapshot?: string; plan_resuelto?: { compras?: Array<{ variant_id?: string; unidades_necesarias?: number }> } };
        assert.equal(plan.estado, "resuelto", `${decoracion.id}: plan Python guardado`);
        assert.ok(plan.snapshot?.startsWith("products_catalog:"), `${decoracion.id}: snapshot guardado`);
        planes.set(ruta, new Map((plan.plan_resuelto?.compras ?? []).map((compra) => [String(compra.variant_id), Number(compra.unidades_necesarias)])));
      }
      const dePython = planes.get(ruta)!.get(material.variantId);
      assert.ok(dePython !== undefined && dePython > 0, `${decoracion.id}: ${material.variantId} está en el plan de Python`);
      if (material.origenCantidad === "plan_python") assert.equal(material.cantidad, dePython, `${decoracion.id}: ${material.variantId} respeta la cantidad de Python`);
      else assert.ok(material.cantidad > dePython, `${decoracion.id}: ${material.variantId} suma la foto a la cantidad de Python`);
    }
    continue;
  }
  assert.ok(decoracion.materiales.every((material) => material.variantId.length > 0 && material.cantidad > 0 && /R-12/i.test(material.nota ?? "")), `${decoracion.id}: variantes y cantidades R-12`);
  const plan = JSON.parse(readFileSync(path.join(process.cwd(), "data", "biblioteca-real", "analisis", `${decoracion.id.replace(/^deco-/, "")}.plan.json`), "utf8")) as { estado?: string; snapshot?: string; lista_materiales?: { lineas?: unknown[]; total?: number } };
  assert.equal(plan.estado, "resuelto", `${decoracion.id}: plan Python guardado`);
  assert.ok(plan.snapshot?.startsWith("products_catalog:"), `${decoracion.id}: snapshot guardado`);
  assert.ok((plan.lista_materiales?.lineas?.length ?? 0) > 0 && Number(plan.lista_materiales?.total) > 0, `${decoracion.id}: plan.lista_materiales cotizado`);
}
assert.ok(decoracionesSempertex.every((decoracion) => decoracion.pasos.length >= 4 && decoracion.pasos.length <= 6));
assert.ok(proveedoresSempertex.every((proveedor) => proveedor.origen === "ejemplo" && proveedor.id.startsWith("ej-prov-") && proveedor.contacto === null && new URL(proveedor.url).hostname === "example.com"));
assert.ok(bibliotecaVisible().every((decoracion) => decoracion.origen === "ejemplo" || decoracion.id.startsWith("deco-")));
assert.equal(DecoracionSempertexSchema.safeParse({ ...decoracionesSempertex[0], id: "deco-incorrecto" }).success, false);
assert.equal(DecoracionSempertexSchema.safeParse({ ...decoracionesSempertex[0], materiales: [{ variantId: "x", sku: null, cantidad: 1, precio: 100 }] }).success, false);
// Una cantidad contada en la foto no se presenta como exacta: lo dice en su detalle.
assert.equal(DecoracionSempertexSchema.safeParse({ ...curadas[0], materiales: [{ variantId: "1", sku: null, cantidad: 3, origenCantidad: "estimado_foto", detalleCantidad: "tres pétalos" }] }).success, false);
assert.equal(DecoracionSempertexSchema.safeParse({ ...curadas[0], materiales: [{ variantId: "1", sku: null, cantidad: 3, origenCantidad: "estimado_foto", detalleCantidad: "estimado a partir de la foto: tres pétalos" }] }).success, true);
const variantIds = [...new Set(decoracionesSempertex.flatMap((decoracion) => decoracion.materiales.map((material) => material.variantId)))];
async function verificarSnapshot(): Promise<void> {
if (!process.env.DATABASE_URL) {
  console.warn("[AVISO] test-biblioteca-sempertex: DATABASE_URL ausente; se omite comprobación de variantes en snapshot vigente.");
} else {
  const pool = getRagPool();
  let variantIdsEnSnapshot: string[] | null = null;
  let handlesEnSnapshot: string[] | null = null;
  try {
    const resultado = await pool.query<{ variant_id: string }>(
      `WITH snapshot AS (
         SELECT source_snapshot_id FROM rag_source_snapshots
          WHERE source_kind = 'products_catalog' AND status = 'published'
          ORDER BY published_at DESC NULLS LAST, fetched_at DESC LIMIT 1
       )
       SELECT v.variant_id FROM catalog_variants v
       JOIN catalog_products p ON p.product_id = v.product_id
       JOIN snapshot s ON s.source_snapshot_id = v.source_snapshot_id
        WHERE p.source_snapshot_id = s.source_snapshot_id
          AND p.status = 'ACTIVE' AND p.available = TRUE
          AND v.available = TRUE AND v.currency = 'COP' AND v.price > 0
          AND NULLIF(to_jsonb(v)->>'unidades_paq', '')::integer > 0
          AND v.variant_id = ANY($1::text[])`,
      [variantIds],
    );
    variantIdsEnSnapshot = resultado.rows.map((row) => row.variant_id);
    const handles = [...new Set(decoracionesSempertex.flatMap((decoracion) => decoracion.shopifyHandle ? [decoracion.shopifyHandle] : []))];
    const kits = await pool.query<{ handle: string }>(
      `WITH snapshot AS (
         SELECT source_snapshot_id FROM rag_source_snapshots
          WHERE source_kind = 'products_catalog' AND status = 'published'
          ORDER BY published_at DESC NULLS LAST, fetched_at DESC LIMIT 1
       )
       SELECT p.handle FROM catalog_products p JOIN snapshot s ON s.source_snapshot_id = p.source_snapshot_id
        WHERE p.handle = ANY($1::text[]) AND p.status = 'ACTIVE' AND p.available = TRUE
          AND p.product_type = 'E-DECORS'`,
      [handles],
    );
    handlesEnSnapshot = kits.rows.map((row) => row.handle);
  } catch (error) {
    console.warn(`[AVISO] test-biblioteca-sempertex: base de datos no disponible; se omite comprobación del snapshot (${error instanceof Error ? error.message : "error de conexión"}).`);
  } finally {
    await pool.end();
  }
  if (variantIdsEnSnapshot !== null) {
    assert.deepEqual(variantIdsEnSnapshot.sort(), [...variantIds].sort(), "Toda variante debe estar disponible y tener precio en el snapshot vigente.");
    const handles = [...new Set(decoracionesSempertex.flatMap((decoracion) => decoracion.shopifyHandle ? [decoracion.shopifyHandle] : []))];
    assert.deepEqual(handlesEnSnapshot?.sort(), handles.sort(), "Todo kit enlazado debe existir y estar activo en el snapshot vigente.");
    console.log(`test-biblioteca-sempertex: ${variantIds.length} variantes verificadas en snapshot vigente.`);
  }
}
console.log("test-biblioteca-sempertex: comprobaciones de contratos correctas");
}

void verificarSnapshot();
