import { strict as assert } from "node:assert";
import { respuestaPrecioPlan, SELECTOR_PRECIO_TOTAL } from "@/components/guiado/precio-chat";

// Probador (2026-10-06): «y cuánto me sale todo?» → «Aquí tienes el cálculo detallado…» sin el total. Sin coste.
const personal = respuestaPrecioPlan({ cotizacion: { total: 132656, incluyeIva: true } }, "personal");
assert.match(personal, /\$\s?132\.656/, `el total del plan va en la respuesta: ${personal}`);
assert.match(personal, /con IVA/);
assert.doesNotMatch(personal, /Aquí tienes/);
// En el negocio el precio depende de su mano de obra y su ganancia: se le dice dónde está, sin una cifra distinta a la de la tarjeta.
const negocio = respuestaPrecioPlan({ cotizacion: { total: 132656, incluyeIva: true } }, "negocio");
assert.doesNotMatch(negocio, /132/);
assert.match(negocio, /resaltado/);
assert.match(respuestaPrecioPlan({}, "personal"), /proveedor/, "sin precio, ofrece el proveedor (no inventa)");
assert.equal(SELECTOR_PRECIO_TOTAL, "[data-precio-total]");
console.log("test-precio-chat-guiado: el total del plan se dice en el chat");
