import assert from "node:assert/strict";
import type { Pool } from "pg";
import { resolverPlan } from "../src/lib/plan/resolver";
import { PlanDecoracionSchema, type PlanDecoracion } from "../src/lib/plan/tipos";

const rows = [
  ...[5, 9, 12, 18, 24].map((diam) => ({ product_id: "P-GLOBOS", variant_id: `V-R-${diam}`, sku: `SKU-R-${diam}`, producto_titulo: "Globo rojo", variante_titulo: `R-${diam}`, precio: diam === 24 ? 21479 : 10000, unidades_paq: diam === 24 ? 3 : 50, disponible: true, producto_disponible: true, codigo_tamano: `R-${diam}`, forma: "redondo", diam_pulg: diam, colores_producto: ["rojo"], colores_variante: ["rojo"], descripcion: "Globo látex rojo.", imagen: diam === 12 ? "https://cdn.example.test/r-12.jpg" : null })),
  { product_id: "P-GLOBOS", variant_id: "V-R-18-X6", sku: "SKU-R-18-X6", producto_titulo: "Globo rojo", variante_titulo: "R-18 / PAQUETE X 6", precio: 4000, unidades_paq: 6, disponible: true, producto_disponible: true, codigo_tamano: "R-18", forma: "redondo", diam_pulg: 18, colores_producto: ["rojo"], colores_variante: ["rojo"], descripcion: "Globo látex rojo R-18." },
  { product_id: "P-BACK", variant_id: "V-BACK", sku: "SKU-BACK", producto_titulo: "Telón", variante_titulo: "Dorado", precio: 30000, unidades_paq: 1, disponible: true, producto_disponible: true, codigo_tamano: null, forma: null, diam_pulg: null, colores_producto: ["dorado"], colores_variante: ["dorado"], descripcion: "Telón de fondo." },
  { product_id: "P-BLUE", variant_id: "V-BLUE-R-12", sku: "SKU-BLUE-R-12", producto_titulo: "Globo azul", variante_titulo: "R-12", precio: 10000, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["azul"], colores_variante: ["azul"], descripcion: "Globo látex azul R-12." },
];
const pool = { query: async () => ({ rows }) } as unknown as Pool;
const whitelist = new Map<string, ReadonlySet<string>>([
  ["P-GLOBOS", new Set(rows.filter((row) => row.product_id === "P-GLOBOS").map((row) => row.variant_id))],
  ["P-BACK", new Set(["V-BACK"])],
]);
const estructura = (id: string, ubicacion: "arco_central" | "lateral_izquierdo" | "lateral_derecho" | "piso_frontal", rol_escena: "focal" | "soporte") => ({
  estructura_id: id,
  nombre: id === "EST_01_COLUMNA" ? "Columna focal" : "Columna lateral",
  tipo: "columna" as const,
  rol_escena,
  ubicacion,
  medidas: { alto_m: 1.4 },
  repeticiones: 1,
  densidad: "media" as const,
  mezcla: "clasica" as const,
  materiales: [{ product_id: "P-GLOBOS", color: "rojo", participacion: 1, rol_material: "principal" as const }],
  porque: "Da altura y enmarca el foco.",
});
const plan: PlanDecoracion = PlanDecoracionSchema.parse({
  plan_version: "1.0",
  plan_id: "22222222-2222-4222-8222-222222222222",
  concepto: { titulo: "Rojo moderno", descripcion: "Columnas rojas para fotos.", paleta: ["rojo"] },
  espacio: { tipo: "salón", fuente: "supuesto" },
  estructuras: [estructura("EST_01_COLUMNA", "lateral_izquierdo", "focal"), estructura("EST_02_COLUMNA", "lateral_derecho", "soporte"), estructura("EST_03_COLUMNA", "piso_frontal", "soporte")],
  supuestos: [],
});
async function main(): Promise<void> {
  const resultado = await resolverPlan(pool, plan, whitelist);
  assert.equal(resultado.sin_cobertura.length, 0);
  assert.equal(resultado.compras.length, 1, "las tres estructuras deben consolidar la variante R-12");
  const compra = resultado.compras[0]!;
  assert.equal(compra.unidades_con_merma, compra.required_quantity);
  assert.equal(compra.design_quantity, compra.unidades_necesarias);
  assert.equal(compra.paquetes, Math.ceil(compra.unidades_necesarias / 50));
  assert.ok(compra.paquetes < resultado.estructuras.length, "la compra consolidada debe ahorrar paquetes frente a uno por estructura");
  assert.equal(compra.purchase_quantity, compra.paquetes * 50);
  assert.equal(compra.leftover_inventory, compra.purchase_quantity - compra.required_quantity);
  assert.equal(compra.sobrante, compra.purchase_quantity - compra.unidades_necesarias);
  assert.match(resultado.merma_log, /MERMA \/ PACKAGE OPTIMIZATION/);
  assert.match(resultado.merma_log, /Target waste reserve:/);
  assert.equal(resultado.totales.purchase_cost, resultado.totales.total_cop);
  assert.ok(resultado.totales.consumption_cost <= resultado.totales.purchase_cost);
  assert.equal(compra.imagen, "https://cdn.example.test/r-12.jpg", "la compra conserva la imagen resuelta del catálogo");
  assert.equal(resultado.estructuras[0]?.lineas.find((linea) => linea.variant_id === "V-R-12")?.imagen, "https://cdn.example.test/r-12.jpg", "cada estructura conserva la imagen de sus elementos de catálogo");

  const baseArco = { ...estructura("EST_01_ARCO", "arco_central", "focal"), tipo: "arco" as const, medidas: { ancho_m: 3, alto_m: 2.4 }, mezcla: "organica_fina" as const };
  const reemplazoDeUnaLinea = await resolverPlan(pool, PlanDecoracionSchema.parse({
    ...plan,
    plan_id: "12121212-1212-4121-8121-121212121212",
    estructuras: [{
      ...baseArco,
      variant_overrides: [{ objetivo_variant_id: "V-R-12", product_id: "P-BLUE", variant_id: "V-BLUE-R-12", color: "azul" }],
    }],
  }), new Map([
    ...whitelist,
    ["P-BLUE", new Set(["V-BLUE-R-12"])],
  ]));
  assert.equal(reemplazoDeUnaLinea.sin_cobertura.length, 0, "un reemplazo de linea no debe eliminar la cobertura de los otros tamanos");
  assert.equal(reemplazoDeUnaLinea.estructuras[0]?.lineas.find((linea) => linea.tamano_codigo === "R-12")?.variant_id, "V-BLUE-R-12", "el override debe cambiar solo la variante objetivo");
  assert.ok(reemplazoDeUnaLinea.estructuras[0]?.lineas.some((linea) => linea.variant_id === "V-R-9"), "los otros tamanos deben conservar su variante original");

  const sustitucion = await resolverPlan(pool, PlanDecoracionSchema.parse({
    ...plan,
    plan_id: "33333333-3333-4333-8333-333333333333",
    estructuras: [{
      ...baseArco,
      materiales: [
        { product_id: "P-GLOBOS", color: "rojo", participacion: 0.5, rol_material: "principal" },
        { product_id: "P-GLOBOS", color: "rojo", participacion: 0.5, rol_material: "secundario" },
      ],
    }],
  }), new Map([["P-GLOBOS", new Set(["V-R-12"])]]));
  assert.deepEqual(sustitucion.sustituciones.map((item) => item.pedido).sort(), ["R-18", "R-9"], "las sustituciones admisibles se deben consolidar");
  assert.deepEqual(sustitucion.sin_cobertura.map((item) => item.tamano), ["R-5", "R-24"], "los extremos R-5/R-24 no se sustituyen por R-12 y las faltas no se duplican por material");
  assert.ok(sustitucion.estructuras[0]!.lineas.every((linea) => linea.variant_id === "V-R-12"));

  const r12NoEsR24 = await resolverPlan(pool, PlanDecoracionSchema.parse({
    ...plan,
    plan_id: "88888888-8888-4888-8888-888888888888",
    estructuras: [{ ...baseArco, mezcla: "clasica" }],
  }), new Map([["P-GLOBOS", new Set(["V-R-24"])]]));
  assert.deepEqual(r12NoEsR24.sin_cobertura.map((item) => item.tamano), ["R-12"]);
  assert.equal(r12NoEsR24.compras.length, 0, "R-12→R-24 no puede producir una compra inflada");
  assert.equal(r12NoEsR24.totales.total_cop, 0);

  const presentationOptimizada = await resolverPlan(pool, PlanDecoracionSchema.parse({
    ...plan,
    plan_id: "66666666-6666-4666-8666-666666666666",
    estructuras: [{ ...estructura("EST_01_COLUMNA", "lateral_izquierdo", "focal"), medidas: { alto_m: 2.4 }, mezcla: "organica_gruesa" }],
  }), whitelist);
  const compraR18 = presentationOptimizada.compras.find((compra) => compra.tamano_codigo === "R-18");
  assert.equal(compraR18?.variant_id, "V-R-18-X6", "debe preferir el costo total de paquetes, no el precio unitario");
  assert.equal(compraR18?.paquetes, 2);
  assert.ok(presentationOptimizada.compras.every((compra) => compra.unidades_necesarias > 0), "no se debe cobrar paquetes para celdas de cantidad cero");

  const noMermaEnDecoracion = await resolverPlan(pool, PlanDecoracionSchema.parse({
    ...plan,
    plan_id: "77777777-7777-4777-8777-777777777777",
    estructuras: [{
      estructura_id: "EST_01_ACCESORIO",
      nombre: "Cortina",
      tipo: "accesorio" as const,
      rol_escena: "focal" as const,
      ubicacion: "fondo_pared" as const,
      medidas: {},
      repeticiones: 1,
      densidad: "sencilla" as const,
      mezcla: "clasica" as const,
      materiales: [{ product_id: "P-BACK", variant_id: "V-BACK", participacion: 1, rol_material: "principal" as const }],
      unidades_declaradas: 1,
      porque: "Una pieza de fondo.",
    }],
  }), whitelist);
  assert.equal(noMermaEnDecoracion.compras[0]?.unidades_necesarias, 1);
  assert.equal(noMermaEnDecoracion.compras[0]?.unidades_con_merma, 1);
  assert.equal(noMermaEnDecoracion.compras[0]?.paquetes, 1);

  const modeloConfundeIds = await resolverPlan(pool, PlanDecoracionSchema.parse({ ...plan, plan_id: "55555555-5555-4555-8555-555555555555", estructuras: [{ ...estructura("EST_01_ARCO", "arco_central", "focal"), tipo: "arco", medidas: { ancho_m: 3, alto_m: 2.4 }, mezcla: "clasica", materiales: [{ ...estructura("EST_01_ARCO", "arco_central", "focal").materiales[0], product_id: "V-R-12" }] }] }), new Map([["P-GLOBOS", new Set(["V-R-12"])]]));
  assert.equal(modeloConfundeIds.sin_cobertura.length, 0, "un variant_id confundido como product_id no debe dejar el plan en cero");
  assert.ok(modeloConfundeIds.estructuras[0]!.lineas.length > 0);
  assert.ok(modeloConfundeIds.estructuras[0]!.lineas.every((linea) => linea.variant_id === "V-R-12"));

  const sinCobertura = await resolverPlan(pool, PlanDecoracionSchema.parse({ ...plan, plan_id: "44444444-4444-4444-8444-444444444444", estructuras: [{ ...estructura("EST_01_ARCO", "arco_central", "focal"), tipo: "arco", medidas: { ancho_m: 3, alto_m: 2.4 }, mezcla: "organica_fina" }] }), new Map([["P-GLOBOS", new Set<string>()]]));
  assert.ok(sinCobertura.sin_cobertura.length > 0);
  assert.notEqual(sinCobertura.plan_hash, (await resolverPlan(pool, sinCobertura.plan, new Map([["P-GLOBOS", new Set(["V-R-12"])]]))).plan_hash, "un snapshot sin cobertura no comparte hash con una compra resuelta");
  console.log(`[PASS] resolver de plan — ${compra.unidades_necesarias} unidades consolidadas en ${compra.paquetes} paquetes; sustituciones y cobertura declaradas`);
}

main().catch((error) => { console.error("[FAIL] resolver de plan", error); process.exitCode = 1; });
