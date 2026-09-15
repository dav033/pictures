import assert from "node:assert/strict";
import { loraEditApagado, referenciasParaLoraEdit } from "../src/lib/ia/sempertex-lora";
import type { ImageInput } from "../src/lib/ia/tipos";

/** LoRA /edit wiring (user decision 2026-09-15): which requests go to /edit and the off switch. */

const img = (role: ImageInput["role"], priority: number, id: string): ImageInput => ({ id, role, priority, base64: "AA==", mime: "image/jpeg", descripcion: id, allowed_use: "x" } as ImageInput);
const productos = [img("catalog_product_reference", 3, "P1"), img("catalog_product_reference", 3, "P2")];

assert.deepEqual(referenciasParaLoraEdit(productos, undefined), [], "product photos alone keep the validated text-to-image endpoint");
const conEspacio = referenciasParaLoraEdit([...productos, img("venue_base", 1, "VENUE_01")], undefined);
assert.deepEqual(conEspacio.map((i) => i.id), ["VENUE_01", "P1", "P2"], "a venue photo switches to /edit, venue first");
const muchas = referenciasParaLoraEdit([img("composition_reference", 4, "R2"), img("previous_generated_result", 0, "PREV"), img("composition_reference", 2, "R1"), ...productos, img("venue_base", 1, "V")], undefined);
assert.deepEqual(muchas.map((i) => i.id), ["PREV", "V", "R1", "P1"], "at most 4 images, by priority");
assert.equal(referenciasParaLoraEdit([img("composition_reference", 2, "R1")], "true").length, 1, "SEMPERTEX_LORA_EDIT=true behaves like the default");
assert.deepEqual(referenciasParaLoraEdit([img("venue_base", 1, "V")], "false"), [], "SEMPERTEX_LORA_EDIT=false switches /edit off");
assert.equal(loraEditApagado("false"), true);
assert.equal(loraEditApagado(undefined), false);
assert.equal(loraEditApagado("true"), false);
console.log("[PASS] cableado LoRA /edit");
