/**
 * Catálogo interno de estructuras oficiales: reconocimiento desde el plan y la
 * referencia, texto informativo para el cliente y descripción al LoRA.
 *
 * Run: npx tsx scripts/test-estructuras-oficiales.ts
 * Sin red, sin base de datos, sin llamadas pagas.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SceneSpec } from "../src/lib/ia/scene-spec";
import { TIPOS_ESTRUCTURA_1_0 } from "../src/lib/plan/composicion";
import { PlanDecoracionSchema } from "../src/lib/plan/tipos";
import { planHash } from "../src/lib/plan/hash";
import {
  ESTRUCTURAS_OFICIALES,
  ESTRUCTURAS_OFICIALES_IDS,
  GUIA_ESTRUCTURAS_OFICIALES,
  identificarEstructuraOficial,
  incoherenciasEstructuraOficial,
  resumenEstructuraParaCliente,
} from "../src/lib/plan/estructuras-oficiales";
import { parseDetectedStructure, referenceStructureSemantics, shapeDescription } from "../src/lib/ia/reference-structure";
import { compileLoraCaption } from "../src/lib/ia/lora-caption-compiler";
import { buildVisualContext } from "../src/lib/ia/visual-context";

let passed = 0;
function pass(name: string) {
  passed += 1;
  console.log(`  ok ${passed}. ${name}`);
}

// 1. Every official structure is buildable with the current Plan 1.0 contract.
for (const id of ESTRUCTURAS_OFICIALES_IDS) {
  const estructura = ESTRUCTURAS_OFICIALES[id];
  assert.equal(estructura.id, id);
  assert.ok((TIPOS_ESTRUCTURA_1_0 as readonly string[]).includes(estructura.tipoBase), `${id} needs a Plan 1.0 type`);
  assert.ok(GUIA_ESTRUCTURAS_OFICIALES.includes(`- ${estructura.nombre} (estructura_oficial ${id}):`), `${id} must be in the chat guide`);
}
assert.equal(ESTRUCTURAS_OFICIALES_IDS.length, 16);
pass("the 14 requested structures plus hoop and balloon ceiling exist, use Plan 1.0 types and are in the chat guide");

// 2. Recognition from what the chat writes in the plan.
const casos: Array<[Parameters<typeof identificarEstructuraOficial>[0], string | undefined]> = [
  [{ tipo: "arco", densidad: "media", nombre: "Arco principal" }, "arco"],
  [{ tipo: "arco", densidad: "media", nombre: "Arco asimétrico de entrada" }, "arco_asimetrico"],
  [{ tipo: "arco", densidad: "sencilla", nombre: "Arco" }, "arco_no_denso"],
  [{ tipo: "arco", densidad: "media", nombre: "Arco no denso" }, "arco_no_denso"],
  [{ tipo: "semiarco", densidad: "media", nombre: "Semiarco derecho" }, "semiarco"],
  [{ tipo: "semiarco", densidad: "lujosa", nombre: "Semiarco Asimétrico izquierdo" }, "semiarco_asimetrico"],
  [{ tipo: "columna", densidad: "media", nombre: "Columna" }, "columna"],
  [{ tipo: "columna", densidad: "media", nombre: "Columna asimetrica" }, "columna_asimetrica"],
  [{ tipo: "columna", densidad: "sencilla", nombre: "Columna lateral" }, "columna_no_densa"],
  [{ tipo: "pared", densidad: "lujosa", nombre: "Pared de globos" }, "pared_densa"],
  [{ tipo: "pared", densidad: "sencilla", nombre: "Pared de globos" }, "pared_no_densa"],
  [{ tipo: "pared", densidad: "media", nombre: "Pared de globos no densa" }, "pared_no_densa"],
  [{ tipo: "guirnalda", densidad: "media", nombre: "Guirnalda de mesa" }, "guirnalda"],
  [{ tipo: "centro_mesa", densidad: "media", nombre: "Centro de mesa" }, "centro_mesa"],
  [{ tipo: "kit", nombre: "Bouquet de globos" }, "bouquet"],
  [{ tipo: "kit", nombre: "Figura con globos de oso" }, "figura"],
  [{ tipo: "arco", densidad: "media", nombre: "Aro circular" }, "aro_circular"],
  [{ tipo: "guirnalda", densidad: "media", ubicacion: "techo", nombre: "Techo de globos" }, "techo_globos"],
  [{ tipo: "backdrop", nombre: "Cortina" }, undefined],
  [{ tipo: "accesorio", nombre: "Banderola" }, undefined],
];
for (const [estructura, esperado] of casos) {
  assert.equal(identificarEstructuraOficial(estructura)?.id, esperado, JSON.stringify(estructura));
}
pass("plan structures map to their official variant; non-balloon pieces are not forced into one");

// 3. Informative text for the customer never shows internal enums.
const resumen = resumenEstructuraParaCliente({ tipo: "semiarco", densidad: "media", ubicacion: "lateral_izquierdo", nombre: "Semiarco asimétrico izquierdo", altoM: 1.8 });
assert.equal(resumen, "Semiarco asimétrico · a la izquierda · 1,8 m de alto");
assert.doesNotMatch(resumen, /_|semiarco\b(?! asim)/);
pass("customer summary uses official names and plain locations");

// 4. Reference detection feeds the same catalog.
const detectada = parseDetectedStructure({ structure_type: "half_arch", horizontal_position: "left", relative_height: "short", curves_toward: "right", outline: "asymmetric", density: "airy" });
assert.ok(detectada);
assert.equal(shapeDescription(detectada), "short airy asymmetrical half-arch, on the left, curving toward the right, standing on the floor");
const semanticas = referenceStructureSemantics([{ elementId: "REF_01_E01", bbox: { x: 0, y: 0.2, width: 0.3, height: 0.7 }, structure: detectada }], "dense");
const semantica = semanticas.get("REF_01_E01")!;
assert.equal(semantica.density, "sencilla", "the element's own density wins over the image-wide density");
assert.equal(identificarEstructuraOficial({ tipo: semantica.structure_type, densidad: semantica.density, ubicacion: semantica.placement, nombre: shapeDescription(detectada) })?.id, "semiarco_asimetrico");
const bouquet = parseDetectedStructure({ structure_type: "bouquet", horizontal_position: "right" });
assert.ok(bouquet);
const bouquetSemantica = referenceStructureSemantics([{ elementId: "REF_01_E02", bbox: { x: 0.7, y: 0.4, width: 0.2, height: 0.4 }, structure: bouquet }], "moderate").get("REF_01_E02")!;
assert.equal(bouquetSemantica.structure_type, "kit");
assert.equal(identificarEstructuraOficial({ tipo: bouquetSemantica.structure_type, nombre: shapeDescription(bouquet) })?.id, "bouquet");
// Regression (I11): the short left piece of the same photo came back as half_arch
// in some runs and column in others. top_overhang decides the boundary.
const inclinada = parseDetectedStructure({ structure_type: "half_arch", horizontal_position: "left", relative_height: "short", curves_toward: "right", top_overhang: "slight", outline: "symmetric", density: "dense" });
assert.equal(inclinada?.type, "column");
assert.equal(inclinada?.outline, "asymmetric", "a leaning column is the official asymmetrical column");
assert.equal(inclinada?.curvesToward, "none");
const inclinadaSemantica = referenceStructureSemantics([{ elementId: "L", bbox: { x: 0, y: 0.3, width: 0.3, height: 0.6 }, structure: inclinada! }], "dense").get("L")!;
assert.equal(identificarEstructuraOficial({ tipo: inclinadaSemantica.structure_type, densidad: inclinadaSemantica.density, ubicacion: inclinadaSemantica.placement, nombre: shapeDescription(inclinada!) })?.id, "columna_asimetrica");
assert.equal(parseDetectedStructure({ structure_type: "column", top_overhang: "strong", curves_toward: "left" })?.type, "half_arch", "a strong sideways reach is a half-arch whatever the label");
assert.equal(parseDetectedStructure({ structure_type: "column", top_overhang: "none" })?.type, "column");
assert.equal(parseDetectedStructure({ structure_type: "half_arch", curves_toward: "left" })?.type, "half_arch", "without overhang the detected type is kept");
assert.equal(parseDetectedStructure({ structure_type: "garland", top_overhang: "strong" })?.type, "garland", "overhang only applies to vertical pieces");
pass("detected outline, density, bouquets and hoops resolve to official structures");

// 5. The LoRA prompt describes the official variant and never pairs different variants.
function element(id: string, name: string, type: "columna" | "arco" | "pared", placement: "lateral_izquierdo" | "lateral_derecho" | "arco_central" | "fondo_pared", role: "focal" | "soporte", density: "sencilla" | "media" | "lujosa"): SceneSpec["elements"][number] {
  return {
    element_id: id, name, category: "balloon_structure", source_type: "reference_only", required: true,
    quantity: { mode: "exact", min: 1, max: 1 }, target_bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 }, depth_layer: 10,
    resolved_colors: ["azul"], visual_semantics: { structure_type: type, placement, design_role: role, repetition_group: id, density },
    identity_constraints: [], relationships: [],
  } as SceneSpec["elements"][number];
}
function scene(elements: SceneSpec["elements"][number][]): SceneSpec {
  return {
    schema_version: "1.0", generation_mode: "text_to_image", canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
    venue: { preserve: [], protected_regions: [], editable_regions: [] }, elements,
    positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
    negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
    metadata: { created_by: "server_default", plan_hash: "plan-test" },
  } as SceneSpec;
}
const context = buildVisualContext({ userRequest: "cumpleaños en salón" });
const columnas = scene([
  element("ARCO", "Arco no denso", "arco", "arco_central", "focal", "sencilla"),
  element("COL_L", "Columna asimétrica izquierda", "columna", "lateral_izquierdo", "soporte", "media"),
  element("COL_R", "Columna derecha", "columna", "lateral_derecho", "soporte", "media"),
]);
const producto = compileLoraCaption({ sceneSpec: columnas, visualContext: context, dialect: "product_v007" });
assert.match(producto.prompt, /airy .*arch/);
assert.match(producto.prompt, /asymmetrical balloon column/);
assert.equal(producto.clauses.length, 3, "an asymmetrical column never pairs with a plain one");
const escena = compileLoraCaption({ sceneSpec: columnas, visualContext: context, dialect: "scene_v004" });
assert.match(escena.prompt, /an airy organic balloon garland arch/);
assert.match(escena.prompt, /an asymmetrical organic balloon column/);
assert.doesNotMatch(escena.prompt, /matching one another|one standing on the left and one on the right/);
const pared = compileLoraCaption({ sceneSpec: scene([element("PARED", "Pared de globos densa", "pared", "fondo_pared", "focal", "lujosa")]), visualContext: context, dialect: "scene_v004" });
assert.match(pared.prompt, /dense balloon wall installation in blue against the rear wall/);
pass("official variants reach both LoRA wordings and keep separate pieces separate");

// 6. Contract: `estructura_oficial` is declared, validated in Next and exported to Python.
{
  const fixture = JSON.parse(readFileSync(new URL("../contracts/domain/v1/fixtures/plan-resuelto-ok.json", import.meta.url), "utf8")) as { plan: { estructuras: Array<Record<string, unknown>> } };
  const conEstructura = (cambios: Record<string, unknown>) => ({ ...fixture.plan, estructuras: [{ ...fixture.plan.estructuras[0], ...cambios }] });
  const aceptado = PlanDecoracionSchema.parse(conEstructura({ estructura_oficial: "arco_asimetrico" }));
  assert.equal(aceptado.estructuras[0]!.estructura_oficial, "arco_asimetrico");
  assert.equal(identificarEstructuraOficial({ ...aceptado.estructuras[0]!, nombre: "Arco principal" })?.id, "arco_asimetrico", "the declared field wins over the name");
  assert.notEqual(planHash(aceptado), planHash(PlanDecoracionSchema.parse(fixture.plan)), "the official structure is part of the approved plan");
  for (const [cambios, campo] of [
    [{ estructura_oficial: "columna_asimetrica" }, "tipo"],
    [{ estructura_oficial: "arco_no_denso" }, "densidad"],
    [{ tipo: "guirnalda", medidas: { largo_m: 2 }, estructura_oficial: "techo_globos" }, "ubicacion"],
  ] as const) {
    const resultado = PlanDecoracionSchema.safeParse(conEstructura(cambios));
    assert.equal(resultado.success, false, JSON.stringify(cambios));
    assert.ok(!resultado.success && resultado.error.issues.some((issue) => issue.path.includes(campo)), `${JSON.stringify(cambios)} must fail on ${campo}`);
  }
  const exportado = readFileSync(new URL("../contracts/domain/v1/plan-decoracion.schema.json", import.meta.url), "utf8").replace(/\s+/g, "");
  const reglas = exportado.match(/"estructura_oficial":\{"const":"[a-z_]+"\}/g) ?? [];
  assert.equal(new Set(reglas).size, ESTRUCTURAS_OFICIALES_IDS.length, "the exported JSON Schema carries the coherence rule of every official structure for Python");
  assert.deepEqual(incoherenciasEstructuraOficial({ estructura_oficial: "pared_densa", tipo: "pared", densidad: "lujosa", ubicacion: "fondo_pared" }), []);

  const declarada = compileLoraCaption({
    sceneSpec: scene([element("EST_01_COLUMNA#1", "Columna izquierda", "columna", "lateral_izquierdo", "soporte", "media")]),
    visualContext: context,
    dialect: "scene_v004",
    officialStructures: new Map([["EST_01_COLUMNA", "columna_asimetrica"]]),
  });
  assert.match(declarada.prompt, /asymmetrical organic balloon column/, "repeated instances inherit the declared official structure");
  pass("estructura_oficial is validated in Next, exported for Python, bound to the plan hash and read by the compiler");
}

// 7. Balloon count per official variant: se fue con `calcularMedidas` (ADR-0023,
// paso 5). El conteo por variante oficial es una regla de geometría y su único
// dueño es Python: la banda estrechada del arco asimétrico y la igualdad del
// arco oficial con el arco base están en
// `services/ai-api/tests/test_plan.py::test_official_structure_is_accepted_and_bound_to_the_plan_hash`,
// y el eje del aro, el eje compartido del arco asimétrico y el volumen de la
// columna irregular quedan congelados en los vectores dorados 10 y 11.
// Lo que NO tiene equivalente en Python y se pierde aquí: los `supuestos`
// legibles por variante ("asimétrico…", "aro circular…"), que el resolutor
// Python no emite, y la caída de densidad de `columna_no_densa`, que ningún
// vector dorado usa.

console.log(`\nEstructuras oficiales: ${passed} checks OK`);
