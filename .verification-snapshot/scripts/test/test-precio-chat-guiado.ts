import { strict as assert } from "node:assert";
import { respuestaPrecioPlan, SELECTOR_PRECIO_TOTAL, textoMaterialesDesde } from "@/components/guiado/precio-chat";

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

// D3 (juez 2026-10-11): la tarjeta del plan dice «Materiales desde $X» con el MISMO total que la cotización y la respuesta del chat.
for (const total of [132656, 176591, 181975, 163038]) {
  const cotizacion = { total, incluyeIva: true };
  const desde = textoMaterialesDesde(cotizacion, "personal");
  const cifra = (texto: string | null) => texto?.match(/\$\s?[\d.]+/)?.[0].replace(/\s/g, "");
  assert.ok(desde, "con precio, la tarjeta lo dice");
  assert.equal(cifra(desde), cifra(respuestaPrecioPlan({ cotizacion }, "personal")), "tarjeta y respuesta del chat dicen la misma cifra");
  assert.match(desde, /^Materiales desde \$\s?[\d.]+ \(uso personal, con IVA\)$/);
}
assert.equal(textoMaterialesDesde(undefined, "personal"), null, "sin precio no se inventa uno");
assert.equal(textoMaterialesDesde({ total: 0 }, null), null);
assert.equal(textoMaterialesDesde({ total: 132656, incluyeIva: true }, "negocio"), null, "en el negocio no se dice una cifra personal");
assert.doesNotMatch(textoMaterialesDesde({ total: 132656, incluyeIva: false }, "personal") ?? "", /con IVA/);
console.log("test-precio-chat-guiado: el total del plan se dice en el chat");
