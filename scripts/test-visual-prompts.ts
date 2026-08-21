import assert from "node:assert/strict";
import { buildLoraImagePrompt } from "../src/lib/ia/build-image-prompt";
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

console.log("Visual prompt regressions: OK");
