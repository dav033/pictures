import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/app/page.tsx", "utf8");
// JSX props may be split across lines; compare markup with collapsed whitespace.
const pageCompacta = page.replace(/\s+/g, " ");
const generateRoute = readFileSync("src/app/api/generate/route.ts", "utf8");
const chatRoute = readFileSync("src/app/api/chat/route.ts", "utf8");
assert.ok(page.includes('plan: datos.plan'));
assert.ok(page.includes('referenceBlueprint: datos.referenceBlueprint'));
assert.ok(page.includes('anchorMessageId?: string'));
assert.ok(page.includes('if (datos.plan) setPlanAprobadoHash(null);'));
assert.ok(page.includes("function aprobarPlan(plan: PlanResuelto, messageId?: string)"));
// ADR-0023 paso 1: la única ruta a una imagen es aprobar la propuesta actual
// (o ajustar una ya aprobada). Se retiraron la generación desde la selección
// manual y la que la IA disparaba sola, que eran los dos caminos que llegaban
// a `/api/generate` sin plan y estimaban materiales en TypeScript.
assert.ok(!page.includes("if (seleccionIA.length > 0 && !datos.plan)"), "la IA no vuelve a disparar una imagen sin propuesta");
assert.ok(!page.includes("generarSinPropuesta"), "no vuelve a existir un botón de generar sin propuesta");
assert.ok(
  generateRoute.includes('if (!body.plan) throw new Error("APROBACION_REQUERIDA'),
  "/api/generate rechaza en cerrado una petición sin propuesta aprobada",
);
assert.ok(pageCompacta.includes('onAprobar={m.plan.plan_hash === planActual?.plan_hash ? () => aprobarPlan(m.plan!, m.id) : undefined}'), "only the current plan can be approved, anchored to its message");
assert.ok(page.includes('if (!planActual || !planActualAprobado || !ajuste.trim()) return;'), "an adjustment regenerates only over an approved plan");
assert.ok(chatRoute.includes('referenceBlueprint: r.referenceBlueprint'));
assert.ok(pageCompacta.includes('<TarjetaPlanDecoracion plan={m.plan} aprobado={planAprobadoHash === m.plan.plan_hash}'));
const planCard = readFileSync("src/components/TarjetaPlanDecoracion.tsx", "utf8");
assert.ok(planCard.includes('scrollIntoView({ behavior: "smooth", block: "nearest" })'), "opening inline plan editing must reveal the editor");
assert.ok(generateRoute.includes("estructura.materiales.map((material) => material.variant_id)"), "generation must whitelist declarative material variants before hashing");
console.log("[PASS] orden del desglose — el plan se muestra antes y la generación requiere aprobación explícita");
