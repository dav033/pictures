import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { ReferencePlanCard } from "@/components/references/ReferencePlanCard";
import { analizarReferenciasV2 } from "@/lib/ia/analizar-referencias-v2";
import type { ChatPort, PeticionChat, TurnoChat } from "@/lib/ia/tipos";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/reference-blueprint";
import { construirCoberturaReferencia } from "@/lib/plan/desglose";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { ALCANCE_POR_CATEGORIA_REFERENCIA } from "@/lib/rag/taxonomy/alcance-referencia";

/**
 * Fixture integrado de selección de referencia.
 *
 * Usa la foto real `src/descarga.jpg` como payload de selección, pero mockea
 * únicamente la respuesta del proveedor visual. Así prueba frontera archivo
 * seleccionado → blueprint → cobertura → grupos de UI, sin depender de una
 * llave externa ni del selector filechooser del navegador.
 */

const fixturePath = resolve(process.cwd(), "src/descarga.jpg");
const fixtureBase64 = readFileSync(fixturePath).toString("base64");
const reference = {
  id: "REF_01",
  mime: "image/jpeg",
  base64: fixtureBase64,
  descripcion: "src/descarga.jpg",
};

const inventory = {
  images: [{
    image_id: "REF_01",
    suggested_roles: ["composition_reference", "element_reference", "palette_reference"],
    elements: [
      {
        name: "guirnalda orgánica de globos",
        category: "balloon_structure",
        scene_role: "midground",
        detection_confidence: 0.98,
        visible_evidence: "Arco y columnas de globos ocupan el perímetro superior y los laterales.",
        reference_bbox: { x: 0.02, y: 0.04, width: 0.96, height: 0.86 },
        observed_colors: ["azul", "morado", "blanco", "plateado", "negro"],
        material: "globos de látex y metalizados",
        shape: "guirnalda orgánica con columnas laterales",
        composition: "Globos agrupados en un arco superior y dos apoyos laterales con acentos metalizados.",
        model_decision: { action: "include", match_type: "none", reason: "estructura visual principal", adaptation: "Construir con globos del catálogo." },
      },
      {
        // Important regression: rear curtain also has string lights.
        name: "cortina negra con luces de cadena",
        category: "curtain",
        scene_role: "backdrop",
        detection_confidence: 0.95,
        visible_evidence: "Tela negra cubre el fondo central detrás de los globos.",
        reference_bbox: { x: 0.18, y: 0.28, width: 0.64, height: 0.63 },
        observed_colors: ["negro"],
        material: "tela",
        shape: "superficie vertical plisada",
        composition: "Una superficie negra uniforme ocupa el fondo central.",
        model_decision: { action: "include", match_type: "none", reason: "superficie posterior visible", adaptation: "Emular como plano vertical de globos si se aprueba." },
      },
      {
        name: "luces de cadena",
        category: "lighting",
        scene_role: "lighting",
        detection_confidence: 0.9,
        visible_evidence: "Puntos de luz independientes atraviesan la cortina del fondo.",
        reference_bbox: { x: 0.25, y: 0.38, width: 0.5, height: 0.45 },
        observed_colors: ["blanco cálido"],
        material: "luz eléctrica",
        shape: "hileras verticales",
        composition: "Luces puntuales distribuidas sobre la superficie negra.",
        model_decision: { action: "include", match_type: "none", reason: "iluminación visible", adaptation: "Se declara fuera del catálogo." },
      },
      {
        // `text` exercises alias normalization to signage.
        name: "letrero Happy Birthday",
        category: "text",
        scene_role: "accent",
        detection_confidence: 0.88,
        visible_evidence: "Globo grande con texto Happy Birthday en el lateral izquierdo.",
        reference_bbox: { x: 0.08, y: 0.45, width: 0.28, height: 0.26 },
        observed_colors: ["plateado"],
        material: "globo metalizado impreso",
        shape: "esfera con mensaje",
        composition: "Mensaje legible en un globo plateado destacado.",
        model_decision: { action: "include", match_type: "none", reason: "mensaje decorativo visible", adaptation: "Emular con globo de letras o banderola." },
      },
    ],
    composition: { focal_point: "guirnalda sobre cortina negra", density: "dense", symmetry: "asymmetric" },
    palette: { observed: ["azul", "morado", "blanco", "plateado", "negro"] },
  }],
};

const audit = { images: [{ image_id: "REF_01", elements: [] }] };

function collectText(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(" ");
  if (React.isValidElement(node)) return collectText((node.props as { children?: unknown }).children);
  return "";
}

function mockChat(): ChatPort {
  let turn = 0;
  return {
    id: "gemini",
    modelo: "fixture-reference-model",
    async turno(params: PeticionChat): Promise<TurnoChat> {
      const mensaje = params.historial[0];
      const attached = mensaje && "imagenes" in mensaje ? mensaje.imagenes?.[0] : undefined;
      assert.equal(attached?.base64, fixtureBase64, "la selección debe enviar src/descarga.jpg completo");
      const args = turn++ === 0 ? inventory : audit;
      return {
        texto: "",
        llamadas: [{ nombre: turn === 1 ? "return_reference_inventory" : "return_reference_audit", args }],
        uso: { entrada: 0, salida: 0 },
        modelo: "fixture-reference-model",
      };
    },
    async *turnoStream() {
      throw new Error("not used in fixture test");
    },
  };
}

function planFor(blueprint: ReturnType<typeof ReferenceBlueprintV2Schema.parse>): PlanResuelto {
  const garland = blueprint.elements.find((element) => element.category === "balloon_structure")!;
  const curtain = blueprint.elements.find((element) => ["curtain", "backdrop"].includes(element.category))!;
  const lighting = blueprint.elements.find((element) => element.category === "lighting")!;
  const signage = blueprint.elements.find((element) => element.category === "signage")!;
  const plan = {
    estructuras: [{
      estructura_id: "EST_01_GARLAND",
      nombre: "Guirnalda principal",
      referencia_element_id: garland.element_id,
      lineas: [{ variant_id: "V-GLOBOS", titulo: "Globo latex", unidades: 80 }],
    }],
    referencia_omitida: [
      { element_id: curtain.element_id, motivo: "La tela no se vende como tal; se propone plano vertical de globos.", motivo_tipo: "emulacion_propuesta", propuesta: "Plano vertical de globos en la paleta observada." },
      { element_id: lighting.element_id, motivo: "El catálogo no vende iluminación.", motivo_tipo: "fuera_de_catalogo" },
      { element_id: signage.element_id, motivo: "No se fabrica rotulación personalizada; se ofrece una reinterpretación.", motivo_tipo: "emulacion_propuesta", propuesta: "Globo de letras o banderola del catálogo." },
    ],
  };
  return { plan, estructuras: plan.estructuras } as unknown as PlanResuelto;
}

async function run() {
  const result = await analizarReferenciasV2(mockChat(), [reference], [], "perceptual");
  const blueprint = ReferenceBlueprintV2Schema.parse(result.blueprint);
  assert.equal(blueprint.source_images[0]?.image_id, "REF_01");
  assert.equal(blueprint.elements.length, 4, "fixture debe conservar cuatro elementos relevantes");

  const garland = blueprint.elements.find((element) => element.name.includes("guirnalda"));
  const curtain = blueprint.elements.find((element) => element.name.includes("cortina"));
  const lighting = blueprint.elements.find((element) => element.category === "lighting");
  const signage = blueprint.elements.find((element) => element.name.includes("Birthday"));
  assert.equal(garland?.category, "balloon_structure", "garland debe normalizarse a estructura de globos");
  assert.ok(["curtain", "backdrop"].includes(curtain?.category ?? ""), "cortina debe conservar capa trasera");
  assert.equal(curtain?.scene_role, "backdrop", "cortina debe quedar en backdrop aunque mencione luces");
  assert.equal(lighting?.category, "lighting", "luces deben ser iluminación independiente");
  assert.equal(lighting?.scene_role, "lighting", "luces deben conservar rol lighting aunque estén sobre fondo");
  assert.equal(signage?.category, "signage", "mensaje debe normalizarse a signage");

  assert.equal(ALCANCE_POR_CATEGORIA_REFERENCIA.balloon_structure.alcance, "cubierto");
  assert.equal(ALCANCE_POR_CATEGORIA_REFERENCIA.curtain.alcance, "emulable");
  assert.equal(ALCANCE_POR_CATEGORIA_REFERENCIA.backdrop.alcance, "emulable");
  assert.equal(ALCANCE_POR_CATEGORIA_REFERENCIA.lighting.alcance, "fuera_de_catalogo");
  assert.equal(ALCANCE_POR_CATEGORIA_REFERENCIA.signage.alcance, "emulable");

  const plan = planFor(blueprint);
  const cobertura = construirCoberturaReferencia(blueprint, plan);
  const estados = new Map(cobertura.elementos.map((element) => [element.categoria, element.estado]));
  assert.equal(estados.get("balloon_structure"), "incluido");
  assert.equal(estados.get("curtain"), "emulable_pendiente");
  assert.equal(estados.get("lighting"), "fuera_de_catalogo");
  assert.equal(estados.get("signage"), "emulable_pendiente");

  // Call client component directly under the RSC-compatible test runtime and
  // walk its element tree. This validates rendered copy/groups without
  // requiring a browser filechooser or a react-dom renderer under
  // `--conditions=react-server`.
  const panelText = collectText(ReferencePlanCard({ blueprint, plan }));
  assert.match(panelText, /Lo que voy a armar/);
  assert.match(panelText, /Puedo emularlo con globos/);
  assert.match(panelText, /Fuera de mi catálogo/);
  assert.doesNotMatch(panelText, /Pendiente de decisión/, "grupo vacío no debe aparecer como pendiente");
  assert.match(panelText, /guirnalda orgánica de globos/);
  assert.match(panelText, /cortina negra con luces/);
  assert.match(panelText, /luces de cadena/);
  assert.match(panelText, /letrero Happy Birthday/);
  assert.doesNotMatch(panelText, /sin producto equivalente/i, "UI no debe usar copy de equivalente exacto");

  console.log("[PASS] fixture src/descarga.jpg — selección, capas, alcance, cobertura y grupos UI");
}

run().catch((error) => {
  console.error("[FAIL]", error);
  process.exitCode = 1;
});
