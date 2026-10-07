import assert from "node:assert/strict";
import { adaptarAnalisisReferencia } from "@/lib/ia/guiado/adaptar-analisis-referencia";

const elemento = (id: string, tipo: string, x: number, color: string) => ({
  element_id: id, source_image_id: "REF_01", name: id, category: "balloon_structure", scene_role: "midground",
  detection_confidence: 0.9, visible_evidence: "pieza de globos", reference_bbox: { x, y: 0.1, width: 0.2, height: 0.7 },
  depth_layer: 1, include_policy: "include", approved: true, source_type: "reference_only",
  quantity: { mode: "exact", min: 1, max: 1 }, quantity_semantics: "physical_instances",
  visual_semantics: { structure_type: tipo, placement: "piso_frontal", design_role: "focal", repetition_group: id, density: "media" },
  appearance: { observed_colors: [color], resolved_colors: [color], color_policy: "match_reference", material: "globos", shape: "orgánica", composition: "mixta" },
  relationships: [], uncertainties: [],
});
const raw = {
  blueprint: {
    schema_version: "2.0", source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
    elements: [elemento("arco", "arco", 0.1, "rosado"), elemento("columna", "columna", 0.6, "plata"), elemento("columna-2", "columna", 0.35, "blanco"), { ...elemento("mueble", "columna", 0.8, "rojo"), category: "furniture" }],
    composition: { focal_point: "globos", density: "moderate", symmetry: "unknown", negative_space: [] },
    palette: { observed: ["rosado", "plata", "blanco"], priority: ["rosado", "plata", "blanco"] }, unresolved_decisions: [],
  },
};

const referencia = adaptarAnalisisReferencia(raw);
assert.ok(referencia);
assert.equal(referencia.frase, "Veo un arco y dos columnas en rosa, plata y blanco. ¿Te armo el plan con estas piezas?");
assert.equal(referencia.piezas.length, 3);
assert.deepEqual(referencia.piezas[1], { x: 0.6, y: 0.1, ancho: 0.2, alto: 0.7 });
assert.deepEqual(referencia.colores.map((color) => color.nombre), ["Rosa", "Plata", "Blanco"]);
assert.equal(adaptarAnalisisReferencia({ blueprint: {} }), null);
console.log("test-adaptar-analisis-referencia-guiada: frase breve, piezas de globos, contornos y colores de cliente");

// El analizador suele nombrar en inglés (y a veces solo en observed_colors): igual deben salir la frase y los puntos.
const enIngles = adaptarAnalisisReferencia({ blueprint: { ...raw.blueprint, elements: [{ ...elemento("arco", "arco", 0.1, "chrome pink"), appearance: { ...elemento("arco", "arco", 0.1, "x").appearance, observed_colors: ["chrome pink", "gold", "navy blue"], resolved_colors: [] } }] } });
assert.ok(enIngles);
// El acabado que la lectura escribió se dice en la frase; los colores del brief van sin acabado.
assert.equal(enIngles.frase, "Veo un arco en rosa cromado, dorado y azul. ¿Te armo el plan con estas piezas?");
assert.deepEqual(enIngles.colores.map((color) => color.nombre), ["Rosa", "Dorado", "Azul"]);
console.log("test-adaptar-analisis-referencia-guiada: colores en inglés → palabras de cliente");

// La foto del dueño (2026-10-06): dos columnas rosa, plata, blanco y transparentes con confeti. La guiada decía
// «rosa y plata» (o «rosa, plata y blanco»): su diccionario no tenía el transparente, el gris ni los acabados.
const conFinura = (id: string, x: number, colores: string[]) => ({ ...elemento(id, "columna", x, "x"), appearance: { ...elemento(id, "columna", x, "x").appearance, observed_colors: colores, resolved_colors: [] } });
const dueno = adaptarAnalisisReferencia({ blueprint: { ...raw.blueprint, elements: [
  conFinura("izq", 0.05, ["matte pastel pink", "chrome silver", "pearl white", "clear with silver confetti"]),
  conFinura("der", 0.6, ["chrome silver", "matte pastel pink", "pearl white", "pearl light grey"]),
] } });
assert.ok(dueno);
assert.equal(dueno.frase, "Veo dos columnas en rosa pastel, plata cromado, blanco perlado, transparente con confeti y gris perlado. ¿Te armo el plan con estas piezas?");
assert.deepEqual(dueno.colores.map((color) => color.nombre), ["Rosa", "Plata", "Blanco", "Transparente", "Gris"]);
// Los colores que el diccionario viejo perdía: vino, oro rosa, durazno, crema, beige, menta, coral.
const otros = adaptarAnalisisReferencia({ blueprint: { ...raw.blueprint, elements: [conFinura("marco", 0.2, ["matte burgundy", "metallic rose gold", "matte peach", "matte cream", "matte sand", "matte pastel mint", "coral orange"])] } });
assert.ok(otros);
assert.deepEqual(otros.colores.map((color) => color.nombre), ["Vino", "Oro rosa", "Coral", "Crema", "Beige", "Menta"]);
console.log("test-adaptar-analisis-referencia-guiada: transparente con confeti, gris, vino y acabados llegan a la frase y al brief");
