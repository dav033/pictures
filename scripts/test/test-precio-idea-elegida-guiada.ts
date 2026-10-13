import { strict as assert } from "node:assert";
import { cancelarPrecioIdea, empezarPrecioIdea, resolverPrecioIdea, TEXTO_PRECIO_AL_ELEGIR, vistaPrecioIdea, type EstadoPrecioIdea } from "@/components/guiado/precio-idea-elegida";
import { resultadoPlanIdea } from "@/components/guiado/opcion-idea";
import { respuestaPrecioPlan, textoMaterialesDesde } from "@/components/guiado/precio-chat";

/**
 * REQ-015 T2b (D3): la tarjeta «Tu elección» dice «Materiales desde $X» con la MISMA cifra que la cotización del plan exacto de
 * la idea, o «Precio al elegir» si ese plan no está; nunca una cifra que pueda cambiar. Sin red: `npx tsx scripts/test/test-precio-idea-elegida-guiada.ts`.
 */

function cotizacion(total: number, incluyeIva = true) {
  return { lineas: [{ id: "l1", tamano: "R12", cantidadNecesaria: 10, disponible: true }], total, mermaPorcentaje: 5, incluyeIva, complementosSoportados: false as const };
}
const cifra = (texto: string) => texto.match(/\$\s?[\d.,]+/)?.[0];

// Ideas representativas: una figura con plan guardado (balón) y un arco; mismas cifras que la cotización del plan exacto.
for (const [ideaId, total] of [["deco-real-30-columna-balon-futbol", 187450], ["deco-arco-organico", 132656]] as const) {
  const cruda = cotizacion(total);
  const estado = resolverPrecioIdea(empezarPrecioIdea(ideaId, 1), { ideaId, sesion: 1, sesionVigente: 1, respuesta: { ok: true, cotizacion: cruda } });
  const vista = vistaPrecioIdea(estado, ideaId, "personal");
  assert.equal(vista.tipo, "precio");
  assert.equal(vista.tipo === "precio" ? vista.texto : "", textoMaterialesDesde(cruda, "personal"), "la tarjeta de la idea dice lo mismo que la del plan");
  assert.equal(cifra(vista.tipo === "precio" ? vista.texto : ""), cifra(respuestaPrecioPlan({ cotizacion: cruda }, "personal")), "y la misma cifra que el chat y la cotización");
  assert.equal(vistaPrecioIdea(estado, ideaId, null).tipo, "precio", "sin uso dicho se muestra el personal, como en el plan");
}

// Sin plan guardado (404/422) o con fallo (502/plazo): «Precio al elegir», sin cifra.
const sinPlan = "deco-sin-plan";
for (const intento of [{ ok: false as const, estado: 404, detenido: false }, { ok: false as const, estado: 422, detenido: false }, { ok: false as const, estado: 502, detenido: false }, { ok: false as const, estado: null, detenido: true }]) {
  assert.notEqual(resultadoPlanIdea(intento, true), "ok");
  const estado = resolverPrecioIdea(empezarPrecioIdea(sinPlan, 1), { ideaId: sinPlan, sesion: 1, sesionVigente: 1, respuesta: { ok: false } });
  assert.deepEqual(vistaPrecioIdea(estado, sinPlan, "personal"), { tipo: "al-elegir" });
}
assert.equal(TEXTO_PRECIO_AL_ELEGIR, "Precio al elegir");
// Respuesta sin cotización válida o con total 0: tampoco se inventa un número.
for (const cruda of [undefined, null, {}, cotizacion(0), { total: 1000 }]) {
  const estado = resolverPrecioIdea(empezarPrecioIdea("i", 1), { ideaId: "i", sesion: 1, sesionVigente: 1, respuesta: { ok: true, cotizacion: cruda } });
  assert.deepEqual(vistaPrecioIdea(estado, "i", "personal"), { tipo: "al-elegir" });
}

// Cargando mientras llega; nada para negocio ni para otra idea.
const cargando = empezarPrecioIdea("i", 1);
assert.deepEqual(vistaPrecioIdea(cargando, "i", "personal"), { tipo: "cargando" });
assert.deepEqual(vistaPrecioIdea(cargando, "otra", "personal"), { tipo: "ninguno" });
assert.deepEqual(vistaPrecioIdea(null, "i", "personal"), { tipo: "ninguno" });
const listoNegocio = resolverPrecioIdea(cargando, { ideaId: "i", sesion: 1, sesionVigente: 1, respuesta: { ok: true, cotizacion: cotizacion(50000) } });
assert.deepEqual(vistaPrecioIdea(listoNegocio, "i", "negocio"), { tipo: "ninguno" }, "para negocio no se dice una cifra personal");
assert.deepEqual(vistaPrecioIdea(cargando, "i", "negocio"), { tipo: "ninguno" });

// Resultado viejo: otra idea, otra conversación o ya resuelto no pisan el estado actual.
const otraIdea: EstadoPrecioIdea = empezarPrecioIdea("nueva", 1);
const resp = { ok: true as const, cotizacion: cotizacion(99999) };
assert.equal(resolverPrecioIdea(otraIdea, { ideaId: "vieja", sesion: 1, sesionVigente: 1, respuesta: resp }), otraIdea, "la respuesta de la idea anterior se descarta");
assert.equal(resolverPrecioIdea(otraIdea, { ideaId: "nueva", sesion: 0, sesionVigente: 1, respuesta: resp }), otraIdea, "la de otra conversación se descarta");
assert.equal(resolverPrecioIdea(empezarPrecioIdea("nueva", 0), { ideaId: "nueva", sesion: 0, sesionVigente: 1, respuesta: resp })?.fase, "cargando", "tras «Empezar de nuevo» no cuenta");
const listo = resolverPrecioIdea(otraIdea, { ideaId: "nueva", sesion: 1, sesionVigente: 1, respuesta: resp });
assert.equal(resolverPrecioIdea(listo, { ideaId: "nueva", sesion: 1, sesionVigente: 1, respuesta: { ok: false } }), listo, "una respuesta ya resuelta no se repite ni se pisa");
assert.equal(resolverPrecioIdea(null, { ideaId: "nueva", sesion: 1, sesionVigente: 1, respuesta: resp }), null);

// Cancelado sin respuesta (la idea dejó de ser la elegida): no queda «calculando» para siempre; otra idea no se toca.
assert.deepEqual(vistaPrecioIdea(cancelarPrecioIdea(empezarPrecioIdea("i", 1), "i"), "i", "personal"), { tipo: "al-elegir" });
assert.deepEqual(vistaPrecioIdea(cancelarPrecioIdea(empezarPrecioIdea("nueva", 1), "vieja"), "nueva", "personal"), { tipo: "cargando" });
assert.equal(cancelarPrecioIdea(listo, "nueva"), listo);

// Un pedido por elección: empezar no depende del render (puro, mismo estado por la misma entrada) y no hay otro camino que lo repita.
assert.deepEqual(empezarPrecioIdea("i", 2), empezarPrecioIdea("i", 2));
console.log("test-precio-idea-elegida-guiada: ok");
