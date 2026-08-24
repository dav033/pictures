import assert from "node:assert/strict";
import type { ChatPort, PeticionChat, TurnoChat } from "@/lib/ia/tipos";
import { analizarReferenciasV2, type ReferenceCatalogItem } from "@/lib/ia/analizar-referencias-v2";

/**
 * R3 — modo perceptual: con el plan de decoración activo, el análisis de
 * referencia nunca debe poder emitir un catalog_product_id, sin importar lo
 * que el modelo intente devolver. Este test simula un modelo "malicioso" (o
 * simplemente desactualizado) que intenta colar un id de catálogo de todas
 * formas, y verifica que el blueprint resultante lo descarta siempre.
 */

function mockChat(respuestas: Record<string, unknown>[]): ChatPort {
  let turno = 0;
  return {
    id: "gemini",
    modelo: "mock-model",
    async turno(_p: PeticionChat): Promise<TurnoChat> {
      const args = respuestas[turno] ?? respuestas[respuestas.length - 1];
      turno += 1;
      return {
        texto: "",
        llamadas: [{ nombre: turno === 1 ? "return_reference_inventory" : "return_reference_audit", args }],
        uso: { entrada: 0, salida: 0 },
        modelo: "mock-model",
      };
    },
    async *turnoStream() {
      throw new Error("not used in this test");
    },
  };
}

const referencia = { id: "REF_01", mime: "image/png", base64: "AAAA", descripcion: "test" };

const catalogoTentador: ReferenceCatalogItem[] = [
  { id: "var-real-1", nombre: "Cortina metalizada dorada", categoria: "cortina", colores: ["dorado"], descripcion: "cortina" },
];

// El modelo intenta devolver un catalog_product_id igual — no debería importar.
const inventoryConIdColado = {
  images: [{
    image_id: "REF_01",
    suggested_roles: ["composition_reference"],
    elements: [{
      name: "cortina de fondo dorada",
      category: "curtain",
      scene_role: "backdrop",
      detection_confidence: 0.9,
      visible_evidence: "cortina metalizada al fondo",
      reference_bbox: { x: 0.1, y: 0.1, width: 0.6, height: 0.7 },
      composition: "cortina uniforme dorada",
      model_decision: {
        action: "include",
        catalog_product_id: "var-real-1",
        match_type: "exact",
        reason: "coincide con cortina dorada",
        adaptation: "usar tal cual",
        bill_of_materials: [{ catalog_product_id: "var-real-1", role: "principal", share: 1 }],
      },
    }],
    composition: { focal_point: "cortina", density: "moderate", symmetry: "symmetric" },
    palette: { observed: ["dorado"] },
  }],
};

const auditVacio = { images: [{ image_id: "REF_01", elements: [] }] };

async function run() {
  const chat = mockChat([inventoryConIdColado, auditVacio]);
  const result = await analizarReferenciasV2(chat, [referencia], catalogoTentador, "perceptual");
  const [element] = result.blueprint.elements;
  assert.ok(element, "debe detectar el elemento de la cortina");
  assert.equal(element.source_type, "reference_only", "modo perceptual nunca es catalog_backed");
  assert.equal(element.model_decision?.catalog_product_id, undefined, "nunca debe colarse un catalog_product_id");
  assert.equal(element.model_decision?.match_type, "none", "match_type siempre none en modo perceptual");
  assert.equal(element.model_decision?.bill_of_materials, undefined, "bill_of_materials nunca sale en modo perceptual");
  assert.equal(element.approved, true, "sigue marcando include=true por relevancia visual");

  // Sanity check: el mismo modelo, en modo legacy, sí debe emparejar.
  const chatLegacy = mockChat([inventoryConIdColado, auditVacio]);
  const legacy = await analizarReferenciasV2(chatLegacy, [referencia], catalogoTentador, "legacy");
  const [legacyElement] = legacy.blueprint.elements;
  assert.equal(legacyElement.source_type, "catalog_backed", "modo legacy sigue emparejando contra catálogo");
  assert.equal(legacyElement.model_decision?.catalog_product_id, "var-real-1");

  console.log("[PASS] modo perceptual (R3) — nunca emite catalog_product_id ni bill_of_materials");
}

run().catch((error) => {
  console.error("[FAIL]", error);
  process.exitCode = 1;
});
