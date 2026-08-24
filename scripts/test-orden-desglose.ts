import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/app/page.tsx", "utf8");
const generateRoute = readFileSync("src/app/api/generate/route.ts", "utf8");
assert.ok(page.includes('plan: datos.plan'));
assert.ok(page.includes('if (datos.plan) setPlanAprobadoHash(null);'));
assert.ok(page.includes('if (seleccionIA.length > 0 && !datos.plan)'));
assert.ok(page.includes("function aprobarPlan(plan: PlanResuelto)"));
assert.ok(page.includes('if (!planActual)'));
assert.ok(page.includes('aprobarPlan(planActual);'));
assert.ok(page.includes('<TarjetaPlanDecoracion plan={m.plan} aprobado={planAprobadoHash === m.plan.plan_hash}'));
const planCard = readFileSync("src/components/TarjetaPlanDecoracion.tsx", "utf8");
assert.ok(planCard.includes('scrollIntoView({ behavior: "smooth", block: "nearest" })'), "opening inline plan editing must reveal the editor");
assert.ok(generateRoute.includes("estructura.materiales.map((material) => material.variant_id)"), "generation must whitelist declarative material variants before hashing");
assert.ok(page.indexOf('function aprobarPlan(plan: PlanResuelto)') > page.indexOf('if (seleccionIA.length > 0 && !datos.plan)'));
console.log("[PASS] orden del desglose — el plan se muestra antes y la generación requiere aprobación explícita");
