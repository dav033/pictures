import assert from "node:assert/strict";
import { buildImagePrompt, buildLoraImagePrompt } from "../src/lib/ia/build-image-prompt";
import type { SceneSpec } from "../src/lib/ia/scene-spec";
import {
  buildPositiveEnvironmentCues,
  buildVisualContext,
  buildVisualSceneLock,
} from "../src/lib/ia/visual-context";

const christmasNight = buildVisualContext({
  brief: {},
  userRequest: "fiesta de navidad en un jardin de noche",
});

assert.equal(christmasNight.eventType, "Navidad");
assert.equal(christmasNight.venue, "jardín");
assert.equal(christmasNight.venueKind, "outdoor");
assert.equal(christmasNight.timeOfDay, "noche");
assert.equal(christmasNight.lightingKind, "night");
assert.match(buildVisualSceneLock(christmasNight), /fiesta de navidad en un jardin de noche/i);
assert.match(buildPositiveEnvironmentCues(christmasNight).join(" "), /outdoor garden/i);
assert.match(buildPositiveEnvironmentCues(christmasNight).join(" "), /dark sky/i);

const hotelDay = buildVisualContext({
  userRequest: "boda en un salón de hotel de día",
});
assert.equal(hotelDay.venueKind, "indoor");
assert.equal(hotelDay.lightingKind, "day");

const beachSunset = buildVisualContext({
  userRequest: "cumpleaños en la playa al atardecer",
});
assert.equal(beachSunset.venueKind, "outdoor");
assert.equal(beachSunset.lightingKind, "sunset");

const sceneSpec = {
  elements: [
    {
      name: "arco orgánico de globos navideños",
      category: "balloon_arch",
      quantity: { min: 1, max: 1 },
      resolved_colors: ["rojo", "verde", "dorado"],
      target_bbox: { x: 0.2, y: 0.15, width: 0.6, height: 0.7 },
    },
  ],
} as unknown as SceneSpec;

const loraPrompt = buildLoraImagePrompt({ sceneSpec, visualContext: christmasNight });
assert.match(loraPrompt, /fiesta de navidad en un jardin de noche/i);
assert.match(loraPrompt, /Venue: jardín/i);
assert.match(loraPrompt, /Time of day: noche/i);
assert.match(loraPrompt, /outdoor garden/i);
assert.ok(loraPrompt.length <= 3_500);

const imageSceneSpec = {
  schema_version: "1.0",
  generation_mode: "text_to_image",
  canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
  venue: { preserve: [], protected_regions: [], editable_regions: [] },
  elements: [{
    element_id: "CATALOG_01",
    name: "guirnalda orgánica de globos rojos",
    category: "balloon_structure",
    source_type: "catalog_backed",
    required: true,
    quantity: { mode: "exact", min: 12, max: 12 },
    target_bbox: { x: 0.15, y: 0.12, width: 0.7, height: 0.7 },
    depth_layer: 10,
    resolved_colors: ["rojo"],
    identity_constraints: ["Required final arrangement/shape for this element: guirnalda orgánica de globos rojos."],
    relationships: [],
  }],
  positive_prompt: { required_elements: ["guirnalda orgánica de globos rojos"], composition: ["one focal installation"], venue_preservation: [], photorealistic_integration: [] },
  negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
  metadata: { created_by: "server_default" },
} as unknown as SceneSpec;
const imagePrompt = buildImagePrompt({ sceneSpec: imageSceneSpec, visualContext: buildVisualContext({ userRequest: "cumpleaños con globos rojos" }) });
assert.match(imagePrompt, /decoration itself must be the main subject/i);
assert.match(imagePrompt, /No generic table, empty table, chairs, dining setup/i);
assert.match(imagePrompt, /neutral real indoor celebration corner/i);
assert.match(imagePrompt, /one intentional installation around a focal center/i);

const outdoorPrompt = buildImagePrompt({
  sceneSpec: imageSceneSpec,
  visualContext: buildVisualContext({ userRequest: "cumpleaños en un jardín con globos rojos" }),
});
assert.match(outdoorPrompt, /outdoor garden setting with visible vegetation/i);
assert.match(outdoorPrompt, /recognizable outdoor place/i);
assert.match(outdoorPrompt, /named outdoor venue with recognizable ground/i);
assert.doesNotMatch(outdoorPrompt, /neutral real indoor celebration corner/i);
assert.doesNotMatch(outdoorPrompt, /generic garden\/forest\/park background/i);

console.log("Visual prompt regressions: OK");
