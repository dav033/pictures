import assert from "node:assert/strict";
import { responderConsultaIdea } from "@/lib/ia/guiado/consulta-plan-chat";

/**
 * Juez 2026-10-11, D1: con una idea elegida y sin plan, «¿cuántos globos lleva?» recibía la pregunta de negocio o uso
 * personal. La respuesta sale de la idea (`detalles-ideas.json`), con las mismas cifras de la tarjeta, sin modelo.
 *
 *   npx tsx --conditions=react-server scripts/test/test-consulta-idea-guiada.ts
 */

const DINO = "deco-real-04-71mp5umakml-ac-uf894-1000-ql80";
const COLUMNAS = "deco-real-07-eb12910e210c94b6184d025127acce95";
const MIXTA = "deco-real-03-63ba2a23-cda3-4af6-af27-bb1746751288-1";

const cuantos = responderConsultaIdea("¿cuántos globos lleva?", DINO);
assert.ok(cuantos, "la pregunta directa se responde por regla");
assert.match(cuantos.texto, /aprox\.?\s+101 globos/, "la cifra de la tarjeta, dicha como aproximada");
assert.match(cuantos.texto, /plan/i, "avisa que el número final es el del plan");
assert.doesNotMatch(cuantos.texto, /negocio|uso personal/i, "no es la pregunta de uso");

assert.ok(responderConsultaIdea("cuantos globos tiene esta decoracion", DINO), "sin signos ni tildes");
assert.match(responderConsultaIdea("¿de qué colores es?", DINO)?.texto ?? "", /Reflex|Fashion|Chrome|Sempertex|\(\d+/, "colores con sus globos");
assert.match(responderConsultaIdea("¿cuánto mide?", DINO)?.texto ?? "", /2,46/, "medidas de la pieza");

const total = responderConsultaIdea("¿cuántos globos lleva en total?", COLUMNAS);
assert.match(total?.texto ?? "", /aprox\.?\s+87 globos/);
const pieza = responderConsultaIdea("¿cuántos globos lleva la columna derecha?", COLUMNAS);
assert.match(pieza?.texto ?? "", /48/);
assert.doesNotMatch(pieza?.texto ?? "", /87/);
assert.match(responderConsultaIdea("¿qué lleva?", MIXTA)?.texto ?? "", /Bouquet|bouquet/);

// Lo que no es una pregunta sobre la idea sigue su camino.
for (const texto of ["¿cuánto cuesta?", "hazla más grande", "me gusta", "es para mi negocio", "¿qué colores me recomiendas?", "", "¿qué hay de unicornios?", "¿qué hay para una boda?", "¿qué hay?", "¿cuántos globos necesito para un arco de 3 m?", "¿cuántos globos lleva un arco?", "¿cuántos globos lleva si la hago de 3 metros?", "¿cuántos globos lleva la segunda?", "¿qué colores tiene la de frozen?", "¿qué tamaño de globos uso?", "¿qué medidas tiene mi salón?"]) {
  assert.equal(responderConsultaIdea(texto, DINO), null, texto);
}
assert.equal(responderConsultaIdea("¿cuántos globos lleva?", "deco-no-existe"), null, "idea desconocida: no inventa");

// El servidor lo decide antes del modelo: sin llave ni proveedor, la respuesta llega igual (si llamara al modelo, fallaría).
async function turno(content: string, estadoGuiado: object): Promise<string> {
  const { POST } = await import("@/app/api/asistente-guiado/route");
  const respuesta = await POST(new Request("http://localhost/api/asistente-guiado", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ schema_version: "asistente-guiado.v1", messages: [{ role: "user", content }], brief: { evento: "cumpleaños", edad: 7, tematica: "dinosaurios" }, estadoGuiado }),
  }));
  return respuesta.text();
}
void (async () => {
  const sse = await turno("¿cuántos globos lleva?", { decoracionId: DINO });
  assert.match(sse, /event: fin/);
  assert.match(sse, /aprox\. 101 globos/);
  assert.doesNotMatch(sse, /negocio/i);
  assert.match(sse, /"opciones":\["contratar","costear"/, "la idea elegida conserva sus botones");
  const eleccion = await turno("me quedo con la segunda, ¿qué colores tiene?", { decoracionId: DINO, ideasMostradas: [{ id: DINO, titulo: "Semiarco selvático de dinosaurios" }, { id: COLUMNAS, titulo: "Dos columnas rosa, lila y dorado" }] }).catch(() => "");
  assert.doesNotMatch(eleccion, /"proveedor":"reglas"/, "elegir otra idea no lo responde la regla de la idea anterior");
  console.log("test-consulta-idea-guiada: ok");
})();
