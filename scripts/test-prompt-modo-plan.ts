/**
 * W3 (docs/planes/propuestas-2026-09/plan-mejoras-color-distribucion-conteo.md):
 * el prompt y las herramientas del modo DISEÑO DE DECORACIÓN no pueden
 * contradecir lo que cotiza confirmar_plan_decoracion.
 *
 * Invariantes deterministas, sin red ni proveedores:
 * - en modo diseño no se expone ni se recomienda calcular_medidas, y las
 *   cantidades que se le dicen al cliente salen del último plan ok:true;
 * - fuera del modo diseño el flujo legacy conserva calcular_medidas y usar_despiece.
 *
 * Run: npx tsx --conditions=react-server scripts/test-prompt-modo-plan.ts
 */
import assert from "node:assert/strict";
import type { Pool } from "pg";

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

async function main(): Promise<void> {
  const { construirSistema } = await import("../src/lib/ia/prompt-sistema");
  const { crearEstadoConversacion, crearRegistroHerramientas, herramientasActivas } = await import("../src/lib/ia/registro-herramientas");

  const modoPlan = construirSistema({ ragEnabled: true, franjasEnabled: false, planEnabled: true });
  const modoLegacy = construirSistema({ ragEnabled: true, franjasEnabled: false, planEnabled: false });

  // 1. Modo diseño: sin calcular_medidas ni despiece por confirmar_seleccion_rag.
  assert.doesNotMatch(modoPlan, /calcular_medidas PRIMERO/);
  assert.doesNotMatch(modoPlan, /usar_despiece/);
  assert.match(modoPlan, /NO USES calcular_medidas/);
  assert.match(modoPlan, /total_unidades[\s\S]{0,200}ok:true de confirmar_plan_decoracion/);
  ok("modo diseño: el prompt no pide calcular_medidas y las cantidades salen del último plan ok:true");

  // 2. Flujo legacy intacto: ahí calcular_medidas sigue siendo el camino.
  assert.match(modoLegacy, /calcular_medidas PRIMERO/);
  assert.match(modoLegacy, /usar_despiece/);
  assert.match(modoLegacy, /calcular_medidas: úsala cuando una estructura necesite cantidades físicas/);
  assert.doesNotMatch(modoLegacy, /NO USES calcular_medidas/);
  ok("fuera del modo diseño el prompt conserva calcular_medidas y el despiece legacy");

  // 3. Herramientas expuestas por flags (el handler sigue registrado siempre).
  const nombres = (flags: { ragEnabled?: boolean; planEnabled?: boolean }) => herramientasActivas(flags).map((herramienta) => herramienta.nombre);
  assert.ok(!nombres({ ragEnabled: true, planEnabled: true }).includes("calcular_medidas"), nombres({ ragEnabled: true, planEnabled: true }).join(", "));
  assert.ok(nombres({ ragEnabled: true, planEnabled: true }).includes("confirmar_plan_decoracion"));
  assert.ok(nombres({ ragEnabled: true, planEnabled: false }).includes("calcular_medidas"));
  assert.ok(!nombres({ ragEnabled: true, planEnabled: false }).includes("confirmar_plan_decoracion"));
  assert.deepEqual(nombres({ ragEnabled: false, planEnabled: true }), []);
  const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
  const registro = crearRegistroHerramientas(crearEstadoConversacion({}, "un arco rojo"), { pool });
  assert.equal(typeof registro.calcular_medidas, "function", "el handler legacy sigue registrado");
  ok("herramientasActivas: sin calcular_medidas en modo diseño, con él en el flujo legacy");

  console.log(`\n${casos} casos OK (prompt del modo diseño)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
