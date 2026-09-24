import assert from "node:assert/strict";
import { buildLoraEditPrompt, loraEditApagado, LORA_EDIT_PROMPT_MAX_LENGTH, referenciasParaLoraEdit } from "../../src/lib/ia/kagutsuchi/sempertex-lora";
import { findLoraPromptLanguageLeaks, findLoraPromptProductLeaks } from "../../src/lib/ia/kagutsuchi/lora-prompt-preflight";
import { descripcionProductoParaImagen, nombreProductoParaImagen } from "../../src/lib/ia/uzume/producto-para-imagen";
import { LORA_JSON_PROMPT_MAX_LENGTH, LORA_PROMPT_MAX_LENGTH } from "../../src/lib/ia/kagutsuchi/lora-caption-compiler";
import { GEMINI_COMPOSITION_HARD_LOCK, inputsParaComposicionGemini, LORA_PRESENTATION_INSTRUCTION, promptPresentacionLora } from "../../src/lib/ia/uzume/lora-gemini-composition";
import type { ImageInput } from "../../src/lib/ia/nucleo/tipos";

/** LoRA /edit wiring (user decision 2026-09-15): which requests go to /edit and the off switch. */

const img = (role: ImageInput["role"], priority: number, id: string): ImageInput => ({ id, role, priority, base64: "AA==", mime: "image/jpeg", descripcion: id, allowed_use: "x" } as ImageInput);
const productos = [img("catalog_product_reference", 3, "P1"), img("catalog_product_reference", 3, "P2")];

assert.deepEqual(referenciasParaLoraEdit(productos, undefined), [], "product photos alone keep the validated text-to-image endpoint");
const conEspacio = referenciasParaLoraEdit([...productos, img("venue_base", 1, "VENUE_01")], undefined);
assert.deepEqual(conEspacio.map((i) => i.id), ["VENUE_01"], "a venue photo switches to /edit and is the only pixel base");
const muchas = referenciasParaLoraEdit([img("composition_reference", 4, "R2"), img("previous_generated_result", 0, "PREV"), img("composition_reference", 2, "R1"), ...productos, img("venue_base", 1, "V")], undefined);
assert.deepEqual(muchas.map((i) => i.id), ["V"], "venue edit excludes every competing background");
assert.equal(referenciasParaLoraEdit([img("composition_reference", 2, "R1")], "true").length, 1, "SEMPERTEX_LORA_EDIT=true behaves like the default");
assert.deepEqual(referenciasParaLoraEdit([img("venue_base", 1, "V")], "false"), [], "SEMPERTEX_LORA_EDIT=false switches /edit off");
assert.equal(loraEditApagado("false"), true);
assert.equal(loraEditApagado(undefined), false);
assert.equal(loraEditApagado("true"), false);
console.log("[PASS] cableado LoRA /edit");

/*
 * El prompt que de verdad recibe fal.
 *
 * La guía anterior (`IMAGE n (role, id): <descripcion>. USE ONLY: …`) metía los
 * ids internos, el nombre comercial con su "PAQUETE X N" y texto en español en
 * el prompt final, y ninguno de los preflights lo veía: todos corren sobre el
 * caption, no sobre lo que se manda al proveedor.
 */
const CAPTION = "eventdecor_style_v3, an organic balloon garland arch of round latex balloons in white as the central focal piece.";
const referenciasSucias: ImageInput[] = [
  { ...img("venue_base", 1, "VENUE_01"), descripcion: "Foto del salón del cliente. Preservar cámara y arquitectura.", allowed_use: "solo el espacio" },
  { ...img("catalog_product_reference", 3, "CATALOG_01"), descripcion: "GLOBO LATEX REDONDO REFLEX DORADO — R-12 / PAQUETE X 50. Cotización: 3 paquete(s) de 50 unidades.", allowed_use: "identidad del producto, nunca los paquetes" },
];
const promptEdit = buildLoraEditPrompt(CAPTION, referenciasSucias);
assert.doesNotMatch(promptEdit, /CATALOG_|VENUE_|EST_\d|paquete|Cotizaci|package|PAQUETE X/i, promptEdit);
assert.deepEqual(findLoraPromptLanguageLeaks(promptEdit), [], promptEdit);
assert.deepEqual(findLoraPromptProductLeaks(promptEdit), [], promptEdit);
assert.ok(promptEdit.startsWith(CAPTION), "el caption compilado sigue primero");
assert.match(promptEdit, /INPUT IMAGES/);
assert.match(promptEdit, /PRIMARY VENUE @image1/);
assert.match(promptEdit, /Input image 1 \(@image1\): venue base/);
assert.match(promptEdit, /Input image 2 \(@image2\): product identity only/);
// Sin imágenes de entrada el prompt no cambia: el camino texto a imagen validado queda igual.
assert.equal(buildLoraEditPrompt(CAPTION, []), CAPTION);
// Cada imagen queda etiquetada por posición: el proveedor necesita distinguir
// el espacio de la referencia visual aunque compartan el mismo tipo de rol.
const dosProductos = buildLoraEditPrompt(CAPTION, [referenciasSucias[1]!, { ...referenciasSucias[1]!, id: "CATALOG_02" }]);
assert.equal((dosProductos.match(/Input image \d+ \(@image\d+\): product identity only/g) ?? []).length, 2, dosProductos);
// Cabe sin recorte incluso con los cuatro roles que activan /edit.
const cuatroRoles = buildLoraEditPrompt("x".repeat(LORA_JSON_PROMPT_MAX_LENGTH), [
  img("venue_base", 1, "V"),
  img("composition_reference", 2, "R1"),
  img("catalog_product_reference", 3, "P1"),
  img("previous_generated_result", 0, "PREV"),
]);
assert.ok(cuatroRoles.length <= LORA_EDIT_PROMPT_MAX_LENGTH, `el peor caso cabe en el límite documentado: ${cuatroRoles.length} > ${LORA_EDIT_PROMPT_MAX_LENGTH}`);
console.log("[PASS] buildLoraEditPrompt: frases fijas en inglés, sin ids ni datos comerciales, dentro del límite de /edit");

// Con venue real, LoRA presenta decoración aislada y Gemini recibe únicamente
// espacio + resultado LoRA: ninguna referencia ambientada puede reemplazar fondo.
const presentacion = promptPresentacionLora(CAPTION);
// Fase 3.2: el cierre es la cláusula declarativa que §5b midió (aislamiento 7
// contra 4 del bloque de prohibiciones), no una lista de negaciones en un
// registro que el corpus nunca usa.
assert.match(presentacion, /set against a plain white studio backdrop, no floor visible\.$/);
assert.doesNotMatch(presentacion, /No backdrop, drapes, furniture/, "el bloque de prohibiciones ya no va en la etapa 1");
// Es una subordinada: no puede quedar «supports., set against».
assert.doesNotMatch(presentacion, /\.,/, presentacion);
// Las tres frases que llevaba el bloque no se perdieron, se mudaron a donde
// pueden actuar: la asimetría al compilador, el rosa y los props a la etapa 2.
assert.match(GEMINI_COMPOSITION_HARD_LOCK, /soft pastel pink, never saturated hot pink/);
assert.match(GEMINI_COMPOSITION_HARD_LOCK, /drapes, tables, chairs, flowers, plants, pedestals and props/);
const presentacionEnLimite = promptPresentacionLora("x".repeat(LORA_PROMPT_MAX_LENGTH - LORA_PRESENTATION_INSTRUCTION.length));
assert.equal(presentacionEnLimite.length, LORA_PROMPT_MAX_LENGTH);
const composicionGemini = inputsParaComposicionGemini(referenciasSucias[0]!, { base64: "DECORACION", mime: "image/png" });
assert.deepEqual(composicionGemini.map((imagen) => imagen.role), ["venue_base", "element_reference"]);
assert.equal(composicionGemini[1]!.id, "LORA_DECORATION");
assert.match(composicionGemini[0]!.allowed_use, /Preserve its architecture/);
assert.match(composicionGemini[1]!.allowed_use, /Never transfer white studio background/);
assert.match(GEMINI_COMPOSITION_HARD_LOCK, /Ignore its white studio background/);
assert.match(GEMINI_COMPOSITION_HARD_LOCK, /Do not invent, retain or add/);
assert.match(GEMINI_COMPOSITION_HARD_LOCK, /never turn them into matching straight towers/);
console.log("[PASS] pipeline híbrido: LoRA presenta decoración aislada, Gemini la compone sobre venue");

/*
 * Descripción de la foto de producto para el modelo de imagen: sin la nota de
 * paquetes cotizados y sin el sufijo de variante, que arrastra el empaque.
 */
const producto = { nombre: "GLOBO LATEX REDONDO REFLEX DORADO — R-12 / PAQUETE X 50", descripcion: "Globo de látex redondo con acabado reflex" };
assert.equal(nombreProductoParaImagen(producto), "GLOBO LATEX REDONDO REFLEX DORADO");
assert.equal(nombreProductoParaImagen({ ...producto, catalogProductTitle: "Globo Látex Redondo Reflex Dorado" }), "Globo Látex Redondo Reflex Dorado");
assert.equal(nombreProductoParaImagen({ nombre: "Kit Guirnalda Fiesta Deluxe", descripcion: "" }), "Kit Guirnalda Fiesta Deluxe", "un nombre sin sufijo de variante no se toca");
const descripcion = descripcionProductoParaImagen(producto, 118);
assert.doesNotMatch(descripcion, /paquete|PAQUETE|Cotizaci|R-12/i, descripcion);
assert.match(descripcion, /Installed design quantity in this scene: 118 unit\(s\)\./, descripcion);
assert.doesNotMatch(descripcionProductoParaImagen(producto), /Installed design quantity/, "sin unidades instaladas no se inventa una cantidad");
console.log("[PASS] descripción de foto de producto sin paquetes ni sufijo de variante");
