/**
 * La referencia Sempertex medida en la foto decide qué globo se compra (2026-10-04).
 *
 * Caso real: dos columnas orgánicas de rosa pastel, lila satinado, plata cromada y transparentes. El
 * análisis midió Satín Rosado 409, Pastel Mate Rosado 609, Reflex Plata 981, Satín Lila 450 y Cristal
 * Transparente 390, y el plan compró Reflex Fucsia, Reflex Plata y Fashion Lila.
 */
import assert from "node:assert/strict";
import type { AnalisisColorSempertex } from "../../src/lib/plan/analisis-color";
import type { DisponibilidadProducto } from "../../src/lib/plan/cobertura-materiales";
import type { PlanDecoracion } from "../../src/lib/plan/tipos";
import type { ReferenceBlueprintV2 } from "../../src/lib/ia/referencia/reference-blueprint";
import { aplicarReferenciasMedidas, busquedasDeReferencias, colorDeReferencia, conReferenciasMedidas, familiaDeTitulo, referenciasDePieza } from "../../src/lib/plan/referencias-medidas";
import { serializeReferenceBlueprint } from "../../src/lib/ia/omoikane/prompt-sistema";
import { coloresDominantesReferencia } from "../../src/lib/plan/colores-referencia";

// 1. La familia de un producto, leída de su título; los impresos y surtidos no son una referencia.
const titulos: Array<[string, string | null]> = [
  ["B2b Globo Latex Redondo Satin Rosado", "satin"],
  ["B2b Globo Latex Redondo Pastel Mate Rosado", "pastelMate"],
  ["B2b Globo Latex Redondo Pastel Dusk Lavanda", "pastelDusk"],
  ["B2b Globo Latex Redondo Reflex Fucsia", "reflex"],
  ["B2b Globo Latex Redondo Cristal Pastel Lila", "cristal"],
  ["B2b Globo Latex Redondo Fashion Transparente", "fashion"],
  ["B2b Globo Latex Redondo Neon Fucsia", "neon"],
  ["B2b Globo Latex Redondo Infinity® Coquette Cristal Transparente", null],
  ["B2b Globo Latex Redondo 2 Caras Mis 15 Años Reflex Fucsia", null],
  ["B2b Globo Latex Redondo Duo Plata", null],
];
for (const [titulo, familia] of titulos) assert.equal(familiaDeTitulo(titulo), familia, titulo);
assert.equal(colorDeReferencia("Plata"), "plateado");
assert.equal(colorDeReferencia("Cristal Transparente"), "transparente");
console.log("[PASS] familiaDeTitulo: las nueve familias de la lámina y ningún globo impreso");

// 2. Del análisis de color al blueprint.
const cruce = (codigo: string, nombreCompleto: string, extra: Partial<AnalisisColorSempertex["piezas"][number]["colores"][number]["cruce"]> = {}) => ({
  hex: "#cccccc", porNombre: false, neutro: false, ambigua: false, sinReferencia: false, familias: ["satin"],
  candidatas: [{ codigo, nombre: nombreCompleto, nombreCompleto, nombreEn: "x", pms: null, acabado: "x", hexGlobo: "#cccccc", deltaE: 1, distancia: 1, tono: 1, razonCroma: 1 }],
  ...extra,
});
const analisis: AnalisisColorSempertex = {
  version: "analisis-color-sempertex.v1",
  piezas: [{
    elementId: "REF_01_E01", tipo: "columna", croquis: { forma: "columna", parteDeLaCaja: 0.5 }, pixeles: { medidos: 1000, deLaCaja: 2000 }, avisos: [],
    colores: [
      { hex: "#eea5be", parte: 0.3, pixeles: 300, cruce: cruce("409", "Satín Rosado") },
      { hex: "#a7a8aa", parte: 0.25, pixeles: 250, cruce: cruce("981", "Reflex Plata", { familias: ["reflex", "metal"] }) },
      { hex: "#e6cfd6", parte: 0.2, pixeles: 200, cruce: cruce("609", "Pastel Mate Rosado", { familias: [], porNombre: false }) },
      { hex: "#b595ca", parte: 0.15, pixeles: 150, cruce: cruce("450", "Satín Lila") },
      { hex: "#e8f0f2", parte: 0.06, pixeles: 60, cruce: cruce("390", "Cristal Transparente") },
      { hex: "#222222", parte: 0.04, pixeles: 40, cruce: cruce("080", "Fashion Negro", { sinReferencia: true }) },
    ],
  }],
};
const referencias = referenciasDePieza(analisis.piezas[0]!);
assert.deepEqual(referencias.map((r) => r.codigo), ["409", "981", "609", "450", "390"], "sin lo que no es un globo, de mayor a menor");
assert.equal(referencias.find((r) => r.codigo === "609")!.familia_fiable, false, "sin acabado dicho, la familia no es fiable");
assert.equal(referencias.find((r) => r.codigo === "409")!.familia, "satin");
const blueprint = {
  schema_version: "2.0", source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
  elements: [{
    element_id: "REF_01_E01", source_image_id: "REF_01", name: "Columna orgánica", category: "balloon_structure", scene_role: "midground", detection_confidence: 0.9, visible_evidence: "columna", reference_bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 }, depth_layer: 10, include_policy: "include", approved: true, source_type: "reference_only", quantity: { mode: "exact", min: 2, max: 2 },
    appearance: { observed_colors: ["pastel pink", "chrome silver", "pearl lilac"], resolved_colors: ["rosado", "plateado", "lila"], color_policy: "match_reference", material: "latex", shape: "columna", composition: "single uniform material" },
    relationships: [], uncertainties: [],
  }],
  composition: { focal_point: "mesa", density: "dense", symmetry: "symmetric", negative_space: [] },
  palette: { observed: [], priority: [] }, unresolved_decisions: [],
} as unknown as ReferenceBlueprintV2;
const conMedidas = conReferenciasMedidas(blueprint, analisis);
assert.equal(conMedidas.elements[0]!.appearance.referencias_medidas?.length, 5);
assert.equal(conReferenciasMedidas(blueprint, null), blueprint, "sin análisis, el mismo blueprint");
const prompt = serializeReferenceBlueprint(conMedidas);
assert.match(prompt, /GLOBOS REALES MEDIDOS EN LA FOTO/);
assert.match(prompt, /Satín Rosado \(~30%\) → busca "globo latex redondo Satín Rosado"/);
assert.match(prompt, /Pastel Mate Rosado \(~20%, familia aproximada\)/);
assert.doesNotMatch(prompt, /Cristal Transparente/, "por debajo del 8 % es ruido y no se pide");
console.log("[PASS] el blueprint y el prompt del chat llevan los globos reales medidos, con su búsqueda exacta");

// 3. Al confirmar: el plan del caso real se corrige con los productos exactos del turno.
const producto = (titulo: string, colores: string[], acabados: string[]): DisponibilidadProducto => ({ titulo, categoria: "globo_latex", colores, coloresVariante: colores, mezclas: ["organica_fina", "clasica"], acabados });
const disponibilidad = new Map<string, DisponibilidadProducto>([
  ["p-reflex-fucsia", producto("B2b Globo Latex Redondo Reflex Fucsia", ["fucsia"], ["reflex"])],
  ["p-reflex-plata", producto("B2b Globo Latex Redondo Reflex Plata", ["plateado"], ["reflex"])],
  ["p-fashion-lila", producto("B2b Globo Latex Redondo Fashion Lila", ["lila"], ["fashion"])],
  ["p-coquette", producto("B2b Globo Latex Redondo Infinity® Coquette Cristal Transparente", ["transparente"], ["fashion"])],
  ["p-satin-rosado", producto("B2b Globo Latex Redondo Satin Rosado", ["rosado"], ["satin"])],
  ["p-pastel-rosado", producto("B2b Globo Latex Redondo Pastel Mate Rosado", ["rosado"], ["mate"])],
  ["p-satin-lila", producto("B2b Globo Latex Redondo Satin Lila", ["lila"], ["satin"])],
]);
const material = (product_id: string, color: string, acabado: string, participacion: number) => ({ product_id, color, acabado, participacion, rol_material: "principal" });
const plan = {
  estructuras: [{
    estructura_id: "EST_01", nombre: "Columna orgánica", tipo: "columna", mezcla: "organica_fina", referencia_element_id: "REF_01_E01",
    materiales: [material("p-reflex-fucsia", "fucsia", "reflex", 0.4), material("p-reflex-plata", "plateado", "reflex", 0.3), material("p-fashion-lila", "lila", "fashion", 0.3)],
  }],
} as unknown as PlanDecoracion;
const { plan: corregido, ajustes } = aplicarReferenciasMedidas(plan, conMedidas, disponibilidad);
const comprados = corregido.estructuras[0]!.materiales.map((m) => `${m.product_id}:${m.color}:${m.acabado ?? "-"}`);
assert.equal(comprados[1], "p-reflex-plata:plateado:reflex", "la plata cromada ya era la referencia");
assert.equal(comprados[2], "p-satin-lila:lila:satin", "el mismo color en la familia medida");
assert.match(comprados[0]!, /^p-(satin|pastel)-rosado:rosado:/, `el fucsia que la foto no tiene pasa al rosado medido: ${comprados[0]}`);
assert.equal(ajustes.length, 2);
assert.ok(!comprados.some((c) => c.startsWith("p-coquette")), "un globo impreso nunca reemplaza a una referencia");
console.log("[PASS] confirmar: Reflex Fucsia → rosado medido, Fashion Lila → Satin Lila, la plata se queda");

// 4. Sin el producto en el turno, el servidor sabe qué buscar; sin referencias, no hace nada.
const sinExactos = new Map([...disponibilidad].filter(([id]) => !["p-satin-rosado", "p-pastel-rosado", "p-satin-lila"].includes(id)));
const busquedas = busquedasDeReferencias(plan, conMedidas, sinExactos);
assert.deepEqual(busquedas, ["globo latex redondo satin rosado", "globo latex redondo pastel mate rosado", "globo latex redondo satin lila"]);
assert.deepEqual(aplicarReferenciasMedidas(plan, conMedidas, sinExactos).ajustes, [], "sin el producto exacto, el material se queda (nunca se quita)");
assert.deepEqual(busquedasDeReferencias(plan, blueprint, disponibilidad), [], "sin referencias medidas no se busca nada");
console.log("[PASS] el servidor busca el producto exacto que le falta al turno, y no toca lo que no puede reemplazar");

// 5. Un color que el analizador nombró no lo quita la medición (un vino que los píxeles leen como negro).
{
  const conVino = structuredClone(conMedidas);
  conVino.elements[0]!.appearance.observed_colors = ["burgundy", "chrome silver"];
  conVino.elements[0]!.appearance.referencias_medidas = [{ codigo: "981", familia: "reflex", nombre: "Plata", nombre_completo: "Reflex Plata", parte: 0.6, familia_fiable: true }, { codigo: "980", familia: "reflex", nombre: "Negro", nombre_completo: "Reflex Negro", parte: 0.3, familia_fiable: false }];
  const vino = new Map([...disponibilidad, ["p-fashion-vino", producto("B2b Globo Latex Redondo Fashion Burdeos", ["burdeos"], ["fashion"])], ["p-reflex-negro", producto("B2b Globo Latex Redondo Reflex Negro", ["negro"], ["reflex"])]]);
  const planVino = { estructuras: [{ ...plan.estructuras[0]!, materiales: [material("p-fashion-vino", "burdeos", "fashion", 0.5), material("p-reflex-plata", "plateado", "reflex", 0.5)] }] } as unknown as PlanDecoracion;
  const resultado = aplicarReferenciasMedidas(planVino, conVino, vino);
  assert.equal(resultado.plan.estructuras[0]!.materiales[0]!.product_id, "p-fashion-vino", "el vino que el analizador vio se queda");
  console.log("[PASS] un color que el analizador nombró no lo reemplaza la medición");
}

// 5a. Un transparente no lo quita la medición: los píxeles no ven un globo transparente, así que su falta entre
// las referencias medidas no dice nada (2026-10-04: las burbujas de una columna rosa y plata salían rosadas).
{
  const conBurbujas = new Map([...disponibilidad, ["p-fashion-transparente", producto("B2b Globo Latex Redondo Fashion Transparente", ["transparente"], ["fashion"])]]);
  const planBurbujas = { estructuras: [{ ...plan.estructuras[0]!, materiales: [...plan.estructuras[0]!.materiales, material("p-fashion-transparente", "transparente", "fashion", 0.1)] }] } as unknown as PlanDecoracion;
  const resultado = aplicarReferenciasMedidas(planBurbujas, conMedidas, conBurbujas);
  const burbuja = resultado.plan.estructuras[0]!.materiales[3]!;
  assert.equal(burbuja.product_id, "p-fashion-transparente", `el transparente se queda aunque la foto no lo mida: ${burbuja.product_id}`);
  assert.ok(!resultado.ajustes.some((ajuste) => "product_id" in ajuste && ajuste.product_id === "p-fashion-transparente"));
  console.log("[PASS] un transparente que los píxeles no ven no lo reemplaza la medición");
}

// 5b. La dominancia medida en píxeles ordena, pero no inventa tonos ni borra lo que el analizador vio.
{
  const columnaIzquierda = coloresDominantesReferencia({ observed_colors: ["light pink", "chrome silver", "clear"], measured_colors: [{ color: "blanco", share: 0.6 }, { color: "rosado", share: 0.4 }] });
  assert.ok(columnaIzquierda.includes("plateado"), `la plata cromada que los píxeles leen como blanco se queda: ${columnaIzquierda}`);
  const columnaDerecha = coloresDominantesReferencia({ observed_colors: ["light pink", "chrome silver"], measured_colors: [{ color: "lila", share: 0.7 }, { color: "rosado", share: 0.3 }] });
  assert.ok(!columnaDerecha.includes("lila"), `la luz morada no se compra: ${columnaDerecha}`);
  assert.equal(columnaDerecha[0], "rosado", "lo medido que el analizador también vio va primero");
  console.log("[PASS] dominancia: la luz no añade lila y el cromado nombrado no se pierde");
}

// 6. La foto real de ejemplo 01 (salón con luz morada): ningún lila sale de la luz.
void (async () => {
  const { readFileSync } = await import("node:fs");
  const { ANALISIS_EJEMPLOS } = await import("../../src/lib/ia/amaterasu/analisis-ejemplos");
  const { medirColoresSempertex } = await import("../../src/lib/ia/amaterasu/color-sempertex");
  const real = ANALISIS_EJEMPLOS.ejemplos.find((ejemplo) => ejemplo.id === "ejemplo-01")!.resultado.blueprint;
  const foto = readFileSync("public/referencias-ejemplo/ejemplo-01.jpg").toString("base64");
  const medido = await medirColoresSempertex(real, [{ id: real.source_images[0]!.image_id, base64: foto, mime: "image/jpeg", descripcion: "" } as never]);
  const crudo = medido.piezas.flatMap((pieza) => referenciasDePieza(pieza)).map((r) => colorDeReferencia(r.nombre));
  assert.ok(crudo.includes("lila"), "los píxeles sí leen la luz morada como lila (si esto cambia, revisar la regla)");
  const finales = conReferenciasMedidas(real, medido).elements.flatMap((elemento) => elemento.appearance.referencias_medidas ?? []);
  assert.ok(finales.length > 0);
  assert.ok(!finales.some((r) => colorDeReferencia(r.nombre) === "lila"), `ningún lila: ${finales.map((r) => r.nombre_completo).join(", ")}`);
  assert.ok(finales.some((r) => r.codigo === "981" && r.familia_fiable), "Reflex Plata, familia segura por «chrome silver»");
  assert.ok(finales.some((r) => colorDeReferencia(r.nombre) === "rosado"));
  console.log("[PASS] foto de ejemplo 01: la luz morada no se compra como lila; plata cromada y rosado sí");
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
