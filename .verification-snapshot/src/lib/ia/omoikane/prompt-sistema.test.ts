import assert from "node:assert/strict";
import test from "node:test";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/referencia/reference-blueprint";
import { BLOQUE_ESTIMAR_CONTEO, construirSistema } from "./prompt-sistema";

test("prompt aclara escala por foto, cajas cortadas y estimaciones provisionales", () => {
  const blueprint = ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: [{ image_id: "REF_01", approved_roles: ["element_reference"], aspect_ratio: 1 }],
    elements: [],
    composition: { focal_point: "arco", density: "moderate", symmetry: "symmetric", negative_space: [] },
    palette: { observed: [], priority: [] },
    unresolved_decisions: [],
  });

  const prompt = construirSistema({ ragEnabled: true, referenceBlueprint: blueprint });

  assert.match(prompt, /escala uniforme por foto/);
  assert.match(prompt, /cortada por cualquier borde/);
  assert.match(prompt, /no lo uses como grosor/);
  assert.match(prompt, /esa misma foto/);
  assert.match(BLOQUE_ESTIMAR_CONTEO, /total estimado como provisional/);
});
