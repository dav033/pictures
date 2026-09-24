import assert from "node:assert/strict";
import { ErrorIA, type ChatPort, type PeticionChat, type TurnoChat } from "@/lib/ia/tipos";
import { analizarReferenciasV2, type ReferenceCatalogItem } from "@/lib/ia/amaterasu/analizar-referencias-v2";

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

  // Regresión (I11): el semiarco derecho de la referencia volvió como
  // "lighting" porque su evidencia decía "confetti-filled ... fairy lights"
  // ("filled" contenía "led") y desapareció del plan.
  const semiarcoConLuces = {
    images: [{
      image_id: "REF_01",
      elements: [
        {
          name: "Right Organic Balloon Half-Arch", category: "lighting", scene_role: "midground", detection_confidence: 0.95,
          visible_evidence: "chrome blue, white and clear confetti-filled balloons wrapped in warm fairy lights, curled ribbons",
          reference_bbox: { x: 0.38, y: 0.09, width: 0.55, height: 0.83 },
          structure: { structure_type: "half_arch", horizontal_position: "right", relative_height: "tall", curves_toward: "left", top_overhang: "strong", outline: "asymmetric", density: "dense" },
          composition_relevance: "essential", model_decision: { action: "include" },
        },
        {
          name: "Left balloon column", category: "balloon_structure", scene_role: "midground", detection_confidence: 0.95,
          visible_evidence: "curled balloons", reference_bbox: { x: 0.02, y: 0.31, width: 0.32, height: 0.6 },
          structure: { structure_type: "half_arch", horizontal_position: "left", relative_height: "short", curves_toward: "right", top_overhang: "slight", outline: "symmetric", density: "dense" },
          composition_relevance: "essential", model_decision: { action: "include" },
        },
        {
          name: "Warm fairy string lights", category: "lighting", scene_role: "lighting", detection_confidence: 0.9,
          visible_evidence: "LED string lights on the floor", reference_bbox: { x: 0.01, y: 0.87, width: 0.98, height: 0.12 },
          composition_relevance: "supporting", model_decision: { action: "include" },
        },
      ],
    }],
  };
  const conLuces = await analizarReferenciasV2(mockChat([semiarcoConLuces, auditVacio]), [{ ...referencia, base64: "BBBB" }], [], "perceptual");
  const [derecho, izquierdo, luces] = conLuces.blueprint.elements;
  assert.equal(derecho?.category, "balloon_structure", "una estructura de globos con luces sigue siendo estructura de globos");
  assert.equal(derecho?.visual_semantics?.structure_type, "semiarco");
  assert.equal(izquierdo?.visual_semantics?.structure_type, "columna", "la pieza izquierda apenas inclinada es columna");
  assert.equal(luces?.category, "lighting");
  console.log("[PASS] estructuras de globos con luces no se degradan a iluminación");

  // Regresión: una bolsa de papel junto al semiarco volvió como estructura de
  // globos (sin `structure`) y el plan habría tenido que construirla.
  const bolsas = {
    images: [{
      image_id: "REF_01",
      elements: [
        { name: "Le Sac en Papier Bag with Plants", category: "balloon_structure", detection_confidence: 0.92, visible_evidence: "kraft paper bag with plants in front of the balloon arch", reference_bbox: { x: 0.38, y: 0.65, width: 0.13, height: 0.22 }, model_decision: { action: "include" } },
        { name: "Small paper box with plant", category: "prop", detection_confidence: 0.88, visible_evidence: "small box next to the balloons", reference_bbox: { x: 0.46, y: 0.76, width: 0.12, height: 0.12 }, model_decision: { action: "include" } },
      ],
    }],
  };
  const conBolsas = await analizarReferenciasV2(mockChat([bolsas, auditVacio]), [{ ...referencia, base64: "EEEE" }], [], "perceptual");
  assert.deepEqual(conBolsas.blueprint.elements.map((element) => element.category), ["other", "other"], "los accesorios junto a los globos no son estructuras de globos");
  console.log("[PASS] accesorios junto a los globos no se vuelven estructuras de globos");

  // Regresión: Gemini devolvió texto malformado en vez de la herramienta y la
  // ruta respondió 400 "Recarga la página". Un reintento acotado lo absorbe.
  let llamadas = 0;
  const chatMalformado: ChatPort = {
    ...mockChat([inventoryConIdColado, auditVacio]),
    async turno(): Promise<TurnoChat> {
      llamadas += 1;
      if (llamadas === 1) return { texto: '{"images": [ :=default_ }', llamadas: [], uso: { entrada: 0, salida: 0 }, modelo: "mock-model" };
      const args = llamadas === 2 ? inventoryConIdColado : auditVacio;
      return { texto: "", llamadas: [{ nombre: llamadas === 2 ? "return_reference_inventory" : "return_reference_audit", args }], uso: { entrada: 0, salida: 0 }, modelo: "mock-model" };
    },
  };
  const recuperado = await analizarReferenciasV2(chatMalformado, [{ ...referencia, base64: "CCCC" }], [], "perceptual");
  assert.equal(llamadas, 3, "un reintento del inventario y una auditoría");
  assert.equal(recuperado.blueprint.elements.length, 1);
  const siempreMalformado: ChatPort = {
    ...mockChat([inventoryConIdColado]),
    async turno(): Promise<TurnoChat> {
      return { texto: "not json", llamadas: [], uso: { entrada: 0, salida: 0 }, modelo: "mock-model" };
    },
  };
  await assert.rejects(
    analizarReferenciasV2(siempreMalformado, [{ ...referencia, base64: "DDDD" }], [], "perceptual"),
    (error: unknown) => error instanceof ErrorIA && error.reintentable && error.causa === "desconocido",
    "dos respuestas malformadas son un fallo reintentable del proveedor, no un error del cliente",
  );
  console.log("[PASS] salida malformada del análisis: un reintento y luego error reintentable del proveedor");
}

run().catch((error) => {
  console.error("[FAIL]", error);
  process.exitCode = 1;
});
