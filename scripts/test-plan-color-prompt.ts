import assert from "node:assert/strict";
import type { Pool } from "pg";
import { resolverPlan } from "@/lib/plan/resolver";
import { PlanDecoracionSchema } from "@/lib/plan/tipos";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { planBlueprint } from "@/app/api/generate/route";
import { buildApprovedSceneSpec, type SceneSpec } from "@/lib/ia/scene-spec";
import { cajasDeEstructuras } from "@/lib/plan/ubicaciones";
import { estimateFromPlan } from "@/lib/materiales/estimacion";

/**
 * La proporción de color por estructura tiene que llegar al prompt de imagen.
 *
 * Antes `planBlueprint` agregaba por variante (color × TAMAÑO), así que un
 * mismo color salía partido en trozos, `resolved_colors` seguía el orden de
 * las líneas del despiece (el acento podía ir primero) y `composition` se
 * cortaba con `slice(0, 240)` a mitad de fragmento.
 *
 * Determinista y sin red: PlanDecoracion -> resolverPlan (pool simulado) ->
 * planBlueprint -> SceneSpec.
 * Run: npx tsx --conditions=react-server scripts/test-plan-color-prompt.ts
 */

const PRODUCTOS = [
  { productId: "P-BLANCO", color: "blanco", acabado: "fashion" },
  { productId: "P-DORADO", color: "dorado", acabado: "reflex" },
  { productId: "P-ROSADO", color: "rosado", acabado: "fashion" },
];
const TAMANOS = [
  { codigo: "R-5", diam: 5 },
  { codigo: "R-9", diam: 9 },
  { codigo: "R-12", diam: 12 },
  { codigo: "R-18", diam: 18 },
  { codigo: "R-24", diam: 24 },
];

const rows = PRODUCTOS.flatMap((producto) => TAMANOS.map((tamano) => ({
  product_id: producto.productId,
  variant_id: `V-${producto.productId}-${tamano.codigo}`,
  sku: `SKU-${producto.productId}-${tamano.codigo}`,
  producto_titulo: `Globo ${producto.color}`,
  variante_titulo: tamano.codigo,
  precio: 10000,
  unidades_paq: 50,
  disponible: true,
  producto_disponible: true,
  codigo_tamano: tamano.codigo,
  forma: "redondo",
  diam_pulg: tamano.diam,
  colores_producto: [producto.color],
  colores_variante: [producto.color],
  acabado: producto.acabado,
  descripcion: `Globo látex ${producto.color} ${tamano.codigo}.`,
})));
// Pool simulado con la misma forma que scripts/test-generate-qa-plan.ts: el resolver solo lee `rows`.
const pool = { query: async () => ({ rows }) } as unknown as Pool;
const whitelist = new Map<string, ReadonlySet<string>>(
  PRODUCTOS.map((producto) => [producto.productId, new Set(rows.filter((row) => row.product_id === producto.productId).map((row) => row.variant_id))] as const),
);

type Material = { product_id: string; color: string; participacion: number; rol_material: string };

async function planResuelto(planId: string, estructuras: unknown[]): Promise<PlanResuelto> {
  const declarado = PlanDecoracionSchema.parse({
    plan_version: "1.0",
    plan_id: planId,
    concepto: { titulo: "Prueba de color", descripcion: "Mezcla de color por estructura.", paleta: ["blanco", "dorado", "rosado"] },
    espacio: { tipo: "salón", fuente: "supuesto" },
    estructuras,
    supuestos: [],
  });
  const resuelto = await resolverPlan(pool, declarado, whitelist);
  assert.equal(resuelto.sin_cobertura.length, 0, `el plan debe resolver sin huecos: ${JSON.stringify(resuelto.sin_cobertura)}`);
  return resuelto;
}

function escenaDe(plan: PlanResuelto): SceneSpec {
  const blueprint = planBlueprint(plan);
  return buildApprovedSceneSpec({
    blueprint,
    aspectRatio: "3:2",
    targetBoxes: Object.fromEntries(Object.entries(cajasDeEstructuras(plan.plan.estructuras)).map(([id, layout]) => [id, layout.bbox])),
    catalogProducts: Object.fromEntries(blueprint.elements.map((element) => [element.element_id, (element.model_decision?.bill_of_materials ?? []).map((linea) => ({
      id: linea.catalog_product_id,
      name: linea.catalog_product_id,
      description: "",
      category: "balloon",
      colors: [rows.find((row) => row.variant_id === linea.catalog_product_id)!.colores_variante[0]!],
      share: linea.share,
      role: linea.role,
    }))])),
    materialEstimate: estimateFromPlan(plan),
    generationMode: "text_to_image",
    createdBy: "server_default",
    planHash: plan.plan_hash,
    catalogOnly: true,
  });
}

const materiales: Material[] = [
  { product_id: "P-BLANCO", color: "blanco", participacion: 0.6, rol_material: "principal" },
  { product_id: "P-DORADO", color: "dorado", participacion: 0.25, rol_material: "secundario" },
  { product_id: "P-ROSADO", color: "rosado", participacion: 0.15, rol_material: "acento" },
];

async function main(): Promise<void> {
  // 1. Arco de tres materiales y cinco tamaños: la mezcla por color no se
  //    parte por tamaño y el color dominante encabeza.
  const plan = await planResuelto("11111111-1111-4111-8111-111111111111", [
    { estructura_id: "EST_01_ARCO", nombre: "Arco principal", tipo: "arco", rol_escena: "focal", ubicacion: "arco_central", medidas: { ancho_m: 2.4, alto_m: 2.2 }, repeticiones: 1, densidad: "media", mezcla: "organica_fina", materiales, porque: "Pieza principal." },
  ]);
  const blueprint = planBlueprint(plan);
  const arco = blueprint.elements[0]!;
  const unidadesPorColor = new Map<string, number>();
  for (const linea of plan.estructuras[0]!.lineas) {
    if (!linea.color) continue;
    unidadesPorColor.set(linea.color, (unidadesPorColor.get(linea.color) ?? 0) + linea.unidades);
  }
  const esperado = [...unidadesPorColor.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color);
  assert.deepEqual(arco.appearance.resolved_colors, esperado, `resolved_colors va por unidades instaladas: ${JSON.stringify([...unidadesPorColor])}`);
  assert.equal(arco.appearance.resolved_colors[0], "blanco", "el principal (0,6) encabeza, no el acento");
  assert.deepEqual(arco.appearance.observed_colors, arco.appearance.resolved_colors);

  const composicion = arco.appearance.composition;
  // Un fragmento por color, con su rol, sin repetir ninguno y sin cortes a medias.
  assert.ok(composicion.length <= 180, `la composición cabe en un identity_constraint: ${composicion.length}`);
  assert.doesNotMatch(composicion, /more$/, `no se pierde ningún color: ${composicion}`);
  const fragmentos = composicion.split("; ");
  assert.equal(fragmentos.length, 3, composicion);
  for (const color of ["blanco", "dorado", "rosado"]) {
    assert.equal(composicion.split(`(${color})`).length - 1, 1, `${color} aparece exactamente una vez: ${composicion}`);
  }
  assert.match(fragmentos[0]!, /^\d+% principal \(blanco\)$/, composicion);
  assert.match(fragmentos[1]!, /^\d+% secundario \(dorado\)$/, composicion);
  assert.match(fragmentos[2]!, /^\d+% acento \(rosado\)$/, composicion);
  const suma = fragmentos.reduce((total, fragmento) => total + Number(/^(\d+)%/.exec(fragmento)![1]), 0);
  assert.equal(suma, 100, composicion);
  // El bill_of_materials sigue siendo por variante: de ahí salen las compras.
  assert.ok((arco.model_decision?.bill_of_materials?.length ?? 0) > 3, "el BOM conserva una línea por variante");
  console.log("[PASS] planBlueprint: la mezcla de color se agrega por color y producto, ordenada por unidades instaladas");

  // 2. El SceneSpec conserva ese orden en resolved_colors (antes lo rehacía
  //    con el orden del bill_of_materials, es decir el de las variantes).
  const escena = escenaDe(plan);
  assert.deepEqual(escena.elements[0]!.resolved_colors, esperado, "el scene spec conserva el orden de dominancia del elemento");
  console.log("[PASS] buildApprovedSceneSpec: resolved_colors multi-material conserva el orden del elemento");

  // 3. Manda la dominancia, no el orden en que el plan declaró los
  //    materiales: aquí el acento va declarado primero y las líneas del
  //    despiece lo listan primero, pero el prompt nombra antes al dominante.
  const acentoPrimero = await planResuelto("22222222-2222-4222-8222-222222222222", [
    { estructura_id: "EST_01_ARCO", nombre: "Arco principal", tipo: "arco", rol_escena: "focal", ubicacion: "arco_central", medidas: { ancho_m: 2.4, alto_m: 2.2 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales: [
      { product_id: "P-DORADO", color: "dorado", participacion: 0.2, rol_material: "acento" },
      { product_id: "P-BLANCO", color: "blanco", participacion: 0.8, rol_material: "principal" },
    ], porque: "Blanco dominante con acento dorado." },
  ]);
  assert.equal([...new Set(acentoPrimero.estructuras[0]!.lineas.map((linea) => linea.color))][0], "dorado", "el despiece sí lista primero el acento");
  const arcoDosColores = planBlueprint(acentoPrimero).elements[0]!;
  assert.deepEqual(arcoDosColores.appearance.resolved_colors, ["blanco", "dorado"]);
  assert.match(arcoDosColores.appearance.composition, /^80% principal \(blanco\); 20% acento \(dorado\)$/, arcoDosColores.appearance.composition);
  assert.deepEqual(escenaDe(acentoPrimero).elements[0]!.resolved_colors, ["blanco", "dorado"]);
  console.log("[PASS] planBlueprint: 80/20 se lee como 80/20 y el dominante encabeza aunque el acento se declare primero");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
