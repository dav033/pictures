import assert from "node:assert/strict";
import { buildLoraEditPrompt, LORA_EDIT_PROMPT_MAX_LENGTH, referenciasParaLoraEdit } from "../../src/lib/ia/kagutsuchi/sempertex-lora";
import { findLoraPromptLanguageLeaks, findLoraPromptProductLeaks } from "../../src/lib/ia/kagutsuchi/lora-prompt-preflight";
import { descripcionProductoParaImagen, nombreProductoParaImagen } from "../../src/lib/ia/uzume/producto-para-imagen";
import { LORA_JSON_PROMPT_MAX_LENGTH } from "../../src/lib/ia/kagutsuchi/lora-caption-compiler";
import type { ImageInput } from "../../src/lib/ia/nucleo/tipos";

/** Cableado FLUX `/edit`: referencias admitidas y prioridad de las imágenes base. */

const img = (role: ImageInput["role"], priority: number, id: string): ImageInput => ({ id, role, priority, base64: "AA==", mime: "image/jpeg", descripcion: id, allowed_use: "x" } as ImageInput);
const productos = [img("catalog_product_reference", 3, "P1"), img("catalog_product_reference", 3, "P2")];

assert.deepEqual(referenciasParaLoraEdit(productos), [], "product photos alone keep the text-to-image endpoint");
const conEspacio = referenciasParaLoraEdit([...productos, img("venue_base", 1, "VENUE_01")]);
assert.deepEqual(conEspacio.map((i) => i.id), ["VENUE_01"], "a venue photo switches to /edit and is the only pixel base");
const muchas = referenciasParaLoraEdit([img("composition_reference", 4, "R2"), img("previous_generated_result", 0, "PREV"), img("composition_reference", 2, "R1"), ...productos, img("venue_base", 1, "V")]);
assert.deepEqual(muchas.map((i) => i.id), ["PREV", "V"], "a revision keeps the previous result as primary base and venue as context");
// Una foto de referencia como base de `/edit` volvía casi igual, con otros tonos.
// Las referencias siguen como texto; solo venue o resultado previo son base.
assert.deepEqual(referenciasParaLoraEdit([img("composition_reference", 2, "R1"), ...productos]), [], "a reference photo alone keeps text-to-image");
assert.deepEqual(
  referenciasParaLoraEdit([img("composition_reference", 2, "R1"), img("previous_generated_result", 0, "PREV"), ...productos]).map((i) => i.id),
  ["PREV"],
  "a revision edits the previous result, never the reference",
);
assert.equal(referenciasParaLoraEdit([img("previous_generated_result", 0, "PREV")]).length, 1);
const revisionConVenue = referenciasParaLoraEdit([img("venue_base", 1, "V"), img("previous_generated_result", 0, "PREV")]);
assert.deepEqual(revisionConVenue.map((i) => i.id), ["PREV", "V"], "el resultado previo es base; venue aporta solo contexto");
console.log("[PASS] cableado FLUX /edit: venue y revisión siempre usan su imagen base prioritaria");

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
assert.ok(findLoraPromptProductLeaks("Remove B2B-20019949 from the image.").length > 0, "el preflight detecta identificadores comerciales en el texto final");
assert.ok(promptEdit.startsWith(CAPTION), "el caption compilado sigue primero");
assert.match(promptEdit, /INPUT IMAGES/);
assert.match(promptEdit, /PRIMARY VENUE @image1/);
assert.match(promptEdit, /Input image 1 \(@image1\): venue base/);
assert.match(promptEdit, /Input image 2 \(@image2\): product identity only/);
const promptRevisionConVenue = buildLoraEditPrompt(CAPTION, revisionConVenue);
assert.match(promptRevisionConVenue, /PRIMARY BASE @image1/);
assert.match(promptRevisionConVenue, /Input image 1 \(@image1\): previous result/);
assert.match(promptRevisionConVenue, /Input image 2 \(@image2\): venue context only/);
assert.match(promptRevisionConVenue, /venue image is context only and never replaces this base/);
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
