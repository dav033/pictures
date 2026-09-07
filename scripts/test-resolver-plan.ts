import assert from "node:assert/strict";
import type { Pool } from "pg";
import { cotizarPlan } from "../src/lib/cotizacion/motor";
import { resolverPlan } from "../src/lib/plan/resolver";
import { PlanDecoracion1_1Schema, PlanDecoracionSchema, type PlanDecoracion } from "../src/lib/plan/tipos";

const rows = [
  ...[5, 9, 12, 18, 24].map((diam) => ({ product_id: "P-GLOBOS", variant_id: `V-R-${diam}`, sku: `SKU-R-${diam}`, producto_titulo: "Globo rojo", variante_titulo: `R-${diam}`, precio: diam === 24 ? 21479 : 10000, unidades_paq: diam === 24 ? 3 : 50, disponible: true, producto_disponible: true, codigo_tamano: `R-${diam}`, forma: "redondo", diam_pulg: diam, colores_producto: ["rojo"], colores_variante: ["rojo"], descripcion: "Globo látex rojo.", imagen: diam === 12 ? "https://cdn.example.test/r-12.jpg" : null })),
  { product_id: "P-GLOBOS", variant_id: "V-R-18-X6", sku: "SKU-R-18-X6", producto_titulo: "Globo rojo", variante_titulo: "R-18 / PAQUETE X 6", precio: 4000, unidades_paq: 6, disponible: true, producto_disponible: true, codigo_tamano: "R-18", forma: "redondo", diam_pulg: 18, colores_producto: ["rojo"], colores_variante: ["rojo"], descripcion: "Globo látex rojo R-18." },
  { product_id: "P-BACK", variant_id: "V-BACK", sku: "SKU-BACK", producto_titulo: "Telón", variante_titulo: "Dorado", precio: 30000, unidades_paq: 1, disponible: true, producto_disponible: true, codigo_tamano: null, forma: null, diam_pulg: null, colores_producto: ["dorado"], colores_variante: ["dorado"], descripcion: "Telón de fondo." },
  { product_id: "P-BLUE", variant_id: "V-BLUE-R-12", sku: "SKU-BLUE-R-12", producto_titulo: "Globo azul", variante_titulo: "R-12", precio: 10000, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["azul"], colores_variante: ["azul"], descripcion: "Globo látex azul R-12." },
];
const rowsFase2 = [
  ...rows,
  { product_id: "P-GLOBOS", variant_id: "V-ESC-PATAS", sku: "SKU-ESC-PATAS", producto_titulo: "Globo modelable negro", variante_titulo: "Tubular", precio: 1500, unidades_paq: 10, disponible: true, producto_disponible: true, codigo_tamano: null, forma: "modelar", diam_pulg: null, colores_producto: ["negro"], colores_variante: ["negro"], descripcion: "Globo modelable tubular negro." },
  { product_id: "P-GLOBOS", variant_id: "V-ESC-OJO-BLANCO", sku: "SKU-ESC-OJO-BLANCO", producto_titulo: "Globo blanco", variante_titulo: "R-5", precio: 1000, unidades_paq: 10, disponible: true, producto_disponible: true, codigo_tamano: "R-5", forma: "redondo", diam_pulg: 5, colores_producto: ["blanco"], colores_variante: ["blanco"], descripcion: "Globo latex blanco R-5." },
  { product_id: "P-GLOBOS", variant_id: "V-ESC-OJO-NEGRO", sku: "SKU-ESC-OJO-NEGRO", producto_titulo: "Globo negro", variante_titulo: "R-5", precio: 1000, unidades_paq: 10, disponible: true, producto_disponible: true, codigo_tamano: "R-5", forma: "redondo", diam_pulg: 5, colores_producto: ["negro"], colores_variante: ["negro"], descripcion: "Globo latex negro R-5." },
  { product_id: "P-GLOBOS", variant_id: "V-R-12-NEGRO", sku: "SKU-R-12-NEGRO", producto_titulo: "Globo negro", variante_titulo: "R-12", precio: 10000, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["negro"], colores_variante: ["negro"], descripcion: "Globo latex negro R-12." },
  { product_id: "P-GLOBOS", variant_id: "V-ESC-PATAS-CORTAS", sku: "SKU-ESC-PATAS-CORTAS", producto_titulo: "Globo modelable negro", variante_titulo: "Tubular corto", precio: 2200, unidades_paq: 10, disponible: true, producto_disponible: true, codigo_tamano: null, forma: "modelar", diam_pulg: null, colores_producto: ["negro"], colores_variante: ["negro"], descripcion: "Globo modelable tubular negro corto." },
  { product_id: "P-PROP-CALABAZA", variant_id: "V-PROP-CALABAZA", sku: "SKU-PROP-CALABAZA", producto_titulo: "Calabaza decorativa", variante_titulo: "Naranja", precio: 7000, unidades_paq: 2, disponible: true, producto_disponible: true, codigo_tamano: null, forma: null, diam_pulg: null, colores_producto: ["naranja"], colores_variante: ["naranja"], descripcion: "Calabaza decorativa naranja de mesa." },
  { product_id: "P-PROP-CALABAZA", variant_id: "V-PROP-CALABAZA-GRANDE", sku: "SKU-PROP-CALABAZA-GRANDE", producto_titulo: "Calabaza decorativa", variante_titulo: "Naranja grande", precio: 9000, unidades_paq: 1, disponible: true, producto_disponible: true, codigo_tamano: null, forma: null, diam_pulg: null, colores_producto: ["naranja"], colores_variante: ["naranja"], descripcion: "Calabaza decorativa naranja grande de mesa." },
  { product_id: "P-PROP-MANTEL", variant_id: "V-PROP-MANTEL", sku: "SKU-PROP-MANTEL", sku_original: "SHOP-MANTEL-1", source_snapshot_id: "SNAP-FASE-2", source_variant_id: "SOURCE-MANTEL-1", inventory_quantity: 9, unidades_inferidas: false, producto_titulo: "Mantel", variante_titulo: "Negro", precio: 12000, unidades_paq: 1, disponible: true, producto_disponible: true, codigo_tamano: null, forma: null, diam_pulg: null, colores_producto: ["negro"], colores_variante: ["negro"], descripcion: "Mantel textil negro para mesa." },
  { product_id: "P-PROP-MANTEL", variant_id: "V-PROP-NO-RECUPERADO", sku: "SKU-PROP-NO-RECUPERADO", producto_titulo: "Mantel", variante_titulo: "Rojo no recuperado", precio: 12000, unidades_paq: 1, disponible: true, producto_disponible: true, codigo_tamano: null, forma: null, diam_pulg: null, colores_producto: ["rojo"], colores_variante: ["rojo"], descripcion: "Mantel textil rojo." },
];
const pool = { query: async () => ({ rows }) } as unknown as Pool;
const poolFase2 = { query: async () => ({ rows: rowsFase2 }) } as unknown as Pool;
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

  const planRica = PlanDecoracion1_1Schema.parse({
    plan_version: "1.1",
    plan_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    concepto: { titulo: "Halloween de entrada", descripcion: "Guirnalda en puerta, arana construida y props sobre mesa.", paleta: ["negro", "naranja"] },
    espacio: {
      tipo: "interior",
      fuente: "cliente",
      anclas: [
        { ancla_id: "ANC_PUERTA", tipo: "puerta", procedencia: "cliente", evidencia: "La puerta principal aparece en el brief." },
        { ancla_id: "ANC_MESA", tipo: "mesa", procedencia: "cliente", evidencia: "La mesa de entrada aparece en el brief." },
      ],
    },
    estructuras: [
      {
        estructura_id: "EST_01_GUIRNALDA",
        nombre: "Guirnalda de entrada",
        tipo: "guirnalda",
        rol_escena: "focal",
        ubicacion: "entrada",
        medidas: { largo_m: 1 },
        repeticiones: 1,
        densidad: "sencilla",
        mezcla: "clasica",
        materiales: [{ product_id: "P-GLOBOS", color: "negro", participacion: 1, rol_material: "principal" }],
        relaciones_fisicas: [{ relacion: "enmarcar", target: { kind: "ancla_espacio", id: "ANC_PUERTA" }, prioridad: "primaria" }],
        porque: "Enmarca la puerta real.",
      },
      {
        estructura_id: "EST_02_ARANA",
        nombre: "Arana de globos",
        tipo: "escultura",
        rol_escena: "focal",
        ubicacion: "zona_central",
        medidas: {},
        repeticiones: 2,
        densidad: "media",
        mezcla: "clasica",
        materiales: [
          { product_id: "P-GLOBOS", variant_id: "V-R-12-NEGRO", color: "negro", rol_material: "principal", unidades_por_instancia: 12, parte_ids: ["cuerpo"] },
          { product_id: "P-GLOBOS", variant_id: "V-ESC-PATAS", color: "negro", rol_material: "secundario", unidades_por_instancia: 8, parte_ids: ["patas"] },
          { product_id: "P-GLOBOS", variant_id: "V-ESC-OJO-BLANCO", color: "blanco", rol_material: "acento", unidades_por_instancia: 2, parte_ids: ["ojos"] },
          { product_id: "P-GLOBOS", variant_id: "V-ESC-OJO-NEGRO", color: "negro", rol_material: "acento", unidades_por_instancia: 2, parte_ids: ["ojos"] },
        ],
        escultura_visual: {
          categoria_sujeto: "animal",
          sujeto: "arana",
          descripcion_perceptual_en: "a black balloon spider with a round body, eight tubular legs and contrasting eyes",
          partes: [
            { parte_id: "cuerpo", funcion: "volumen_principal", descriptor_perceptual_en: "round black balloon body", variant_ids: ["V-R-12-NEGRO"] },
            { parte_id: "patas", funcion: "extremidad", descriptor_perceptual_en: "eight black tubular balloon legs", variant_ids: ["V-ESC-PATAS"] },
            { parte_id: "ojos", funcion: "detalle", descriptor_perceptual_en: "small white and black balloon eyes", variant_ids: ["V-ESC-OJO-BLANCO", "V-ESC-OJO-NEGRO"] },
          ],
        },
        relaciones_fisicas: [{ relacion: "montar_sobre", target: { kind: "elemento_plan", id: "EST_01_GUIRNALDA" }, prioridad: "primaria" }],
        porque: "Sujeto tematico con BOM verificable.",
      },
    ],
    props_catalogo: [
      { prop_id: "PROP_01_CALABAZAS", product_id: "P-PROP-CALABAZA", variant_id: "V-PROP-CALABAZA", unidades_declaradas: 3, rol_escena: "acento", ubicacion: "alrededor_mobiliario", relaciones_fisicas: [{ relacion: "apoyarse_en", target: { kind: "ancla_espacio", id: "ANC_MESA" }, prioridad: "primaria" }], porque: "Acento tematico sobre la mesa." },
      { prop_id: "PROP_02_MANTEL", product_id: "P-PROP-MANTEL", variant_id: "V-PROP-MANTEL", unidades_declaradas: 1, rol_escena: "soporte", ubicacion: "alrededor_mobiliario", relaciones_fisicas: [{ relacion: "montar_sobre", target: { kind: "ancla_espacio", id: "ANC_MESA" }, prioridad: "primaria" }], porque: "Cubre la mesa existente." },
    ],
    supuestos: [],
  });
  const whitelistRica = new Map<string, ReadonlySet<string>>([
    ["P-GLOBOS", new Set(["V-R-12-NEGRO", "V-ESC-PATAS", "V-ESC-OJO-BLANCO", "V-ESC-OJO-NEGRO"])],
    ["P-PROP-CALABAZA", new Set(["V-PROP-CALABAZA", "V-PROP-CALABAZA-GRANDE"])],
    ["P-PROP-MANTEL", new Set(["V-PROP-MANTEL"])],
  ]);
  const araña = await resolverPlan(poolFase2, planRica, whitelistRica);
  assert.equal(araña.plan.plan_version, "1.1");
  assert.equal(araña.sin_cobertura.length, 0, "la arana fixture debe tener cobertura completa");
  assert.equal(araña.props?.length, 2, "los props deben resolverse como elementos independientes");
  assert.equal(araña.estructuras.find((item) => item.tipo === "escultura")?.total_unidades, 48, "repeticiones multiplica todo BOM de escultura");
  assert.equal(araña.estructuras.find((item) => item.tipo === "escultura")?.lineas.find((linea) => linea.variant_id === "V-ESC-PATAS")?.unidades, 16);
  assert.equal(araña.compras.find((item) => item.variant_id === "V-PROP-CALABAZA")?.unidades_necesarias, 3);
  assert.equal(araña.compras.find((item) => item.variant_id === "V-PROP-CALABAZA")?.paquetes, 2);
  const mantel = araña.compras.find((item) => item.variant_id === "V-PROP-MANTEL");
  assert.equal(mantel?.subtotal, 12000);
  assert.equal(mantel?.required_quantity, 1, "los props no reciben merma de globos");
  assert.equal(mantel?.sku_original, "SHOP-MANTEL-1");
  assert.equal(mantel?.source_snapshot_id, "SNAP-FASE-2");
  assert.equal(araña.compras.find((item) => item.variant_id === "V-R-12-NEGRO")?.unidades_necesarias, 41, "una variante compartida se consolida entre guirnalda y escultura");
  assert.ok(araña.compras.find((item) => item.variant_id === "V-R-12-NEGRO")?.elementos_origen.some((origen) => origen.kind === "estructura" && origen.id === "EST_02_ARANA"), "compra compartida conserva origen de arana");
  assert.equal(araña.totales.total_cop, 41000, "COP sale de precio y paquetes del catalogo fixture");
  const cotizacionRica = cotizarPlan(araña);
  assert.equal(cotizacionRica.total, 41000);
  assert.equal(cotizacionRica.lineas.find((linea) => linea.id === "V-PROP-CALABAZA")?.productId, "P-PROP-CALABAZA");
  assert.ok(cotizacionRica.lineas.find((linea) => linea.id === "V-PROP-CALABAZA")?.elementosOrigen?.some((origen) => origen.kind === "prop" && origen.id === "PROP_01_CALABAZAS"));

  const conPataDistinta = PlanDecoracion1_1Schema.parse({
    ...planRica,
    plan_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    estructuras: planRica.estructuras.map((estructura) => estructura.tipo === "escultura"
      ? { ...estructura, materiales: estructura.materiales.map((material) => material.variant_id === "V-ESC-PATAS" ? { ...material, variant_id: "V-ESC-PATAS-CORTAS" } : material), escultura_visual: { ...estructura.escultura_visual!, partes: estructura.escultura_visual!.partes.map((parte) => parte.parte_id === "patas" ? { ...parte, variant_ids: ["V-ESC-PATAS-CORTAS"] } : parte) } }
      : estructura),
  });
  const arañaConPataDistinta = await resolverPlan(poolFase2, conPataDistinta, whitelistRica);
  assert.notEqual(arañaConPataDistinta.plan_hash, araña.plan_hash, "cambiar pata cambia hash");
  assert.notEqual(arañaConPataDistinta.totales.total_cop, araña.totales.total_cop, "cambiar pata cambia total");
  assert.notDeepEqual(arañaConPataDistinta.compras.map((item) => [item.variant_id, item.paquetes, item.subtotal]), araña.compras.map((item) => [item.variant_id, item.paquetes, item.subtotal]), "cambiar pata cambia compra");

  const conPropDistinto = PlanDecoracion1_1Schema.parse({
    ...planRica,
    plan_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    props_catalogo: planRica.props_catalogo.map((prop) => prop.prop_id === "PROP_01_CALABAZAS" ? { ...prop, variant_id: "V-PROP-CALABAZA-GRANDE" } : prop),
  });
  const arañaConPropDistinto = await resolverPlan(poolFase2, conPropDistinto, whitelistRica);
  assert.notEqual(arañaConPropDistinto.plan_hash, araña.plan_hash, "cambiar prop cambia hash");
  assert.notEqual(arañaConPropDistinto.totales.total_cop, araña.totales.total_cop, "cambiar prop cambia total");

  const propNoRecuperado = PlanDecoracion1_1Schema.parse({
    ...planRica,
    plan_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    props_catalogo: planRica.props_catalogo.map((prop) => prop.prop_id === "PROP_02_MANTEL" ? { ...prop, variant_id: "V-PROP-NO-RECUPERADO" } : prop),
  });
  const resultadoNoRecuperado = await resolverPlan(poolFase2, propNoRecuperado, whitelistRica);
  assert.ok(resultadoNoRecuperado.sin_cobertura.some((item) => item.estructura_id === "PROP_02_MANTEL"), "un prop no recuperado nunca debe aprobarse");
  assert.equal(resultadoNoRecuperado.compras.some((item) => item.variant_id === "V-PROP-NO-RECUPERADO"), false);

  const productoVarianteCruzados = PlanDecoracion1_1Schema.parse({
    ...planRica,
    plan_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    props_catalogo: planRica.props_catalogo.map((prop) => prop.prop_id === "PROP_02_MANTEL" ? { ...prop, product_id: "P-PROP-CALABAZA", variant_id: "V-PROP-MANTEL" } : prop),
  });
  const resultadoCruzado = await resolverPlan(poolFase2, productoVarianteCruzados, whitelistRica);
  assert.ok(resultadoCruzado.sin_cobertura.some((item) => item.estructura_id === "PROP_02_MANTEL"), "producto y variante cruzados deben fallar");
  console.log(`[PASS] resolver de plan — ${compra.unidades_necesarias} unidades consolidadas en ${compra.paquetes} paquetes; sustituciones y cobertura declaradas`);
}

main().catch((error) => { console.error("[FAIL] resolver de plan", error); process.exitCode = 1; });
