import { strict as assert } from "node:assert";
import { planListoParaAccion, rutaOpcionIdea } from "@/components/guiado/opcion-idea";
import { respuestaPrecioPlan } from "@/components/guiado/precio-chat";

// REQ-015 T4: los chips enlatados de una idea elegida no pasan por el modelo (/api/chat).
const sinPlan = { hayIdea: true, hayPlan: false, ideaEnElPlan: false };
assert.equal(rutaOpcionIdea("costear", sinPlan), "plan-exacto-de-idea");
assert.equal(rutaOpcionIdea("aprender", sinPlan), "plan-exacto-de-idea");
assert.equal(rutaOpcionIdea("costear", { hayIdea: true, hayPlan: true, ideaEnElPlan: true }), "accion-plan");
assert.equal(rutaOpcionIdea("costear", { hayIdea: false, hayPlan: true, ideaEnElPlan: false }), "accion-plan");
assert.equal(rutaOpcionIdea("costear", { hayIdea: true, hayPlan: true, ideaEnElPlan: false }), "chat", "un plan ajeno a la idea elegida no se presenta como el de la idea");
assert.equal(rutaOpcionIdea("costear", { hayIdea: false, hayPlan: false, ideaEnElPlan: false }), "chat", "sin idea ni plan sigue el camino de siempre");
assert.equal(rutaOpcionIdea("comprar", sinPlan), "chat");
assert.equal(rutaOpcionIdea("contratar", sinPlan), "chat");
const pendiente = { planPrevio: null, ideaId: "i1" };
assert.equal(planListoParaAccion(pendiente, null, []), false);
assert.equal(planListoParaAccion(pendiente, "p", ["otra"]), false, "un plan que no trae la idea no dispara la acción");
assert.equal(planListoParaAccion({ planPrevio: "p", ideaId: "i1" }, "p", ["i1"]), false);
assert.equal(planListoParaAccion(pendiente, "p", ["i1"]), true);

// El precio que dice el chat es el cotizacion.total del plan guardado de la idea, el mismo de la tarjeta.
assert.match(respuestaPrecioPlan({ cotizacion: { total: 132656, incluyeIva: true } }, "personal"), /132\.656/);
console.log("test-opcion-idea-guiada: los chips de la idea usan el plan guardado, sin modelo");
