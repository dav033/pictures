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

  // 4. Regla acotada de variant_id/unidades_declaradas: las estructuras con
  //    geometría no llevan cantidades, Bouquet/Figura y las piezas de catálogo sí.
  const { ESTRUCTURAS_OFICIALES, EJEMPLO_UNIDADES_DECLARADAS } = await import("../src/lib/plan/estructuras-oficiales");
  const { HERRAMIENTAS_PLAN } = await import("../src/lib/ia/herramientas");
  const { perfilCreatividad } = await import("../src/lib/ia/creatividad");
  assert.doesNotMatch(modoPlan, /Nunca mandes tamaños de globo, cantidades de globos/);
  assert.match(modoPlan, /estructuras con geometría \(arco, semiarco, guirnalda, columna, pared, centro de mesa\) no mandes variant_id, tamaños de globo ni cantidades/);
  assert.match(modoPlan, /Bouquet y Figura \(que se arman con tipo kit\), y también kit, backdrop y accesorio, necesitan variant_id en cada material y unidades_declaradas/);
  // El mínimo tiene un solo dueño: la tabla de estructuras oficiales.
  const esperado = Object.values(ESTRUCTURAS_OFICIALES)
    .flatMap((estructura) => estructura.unidadesMinimasPorInstancia === undefined
      ? []
      : [`${estructura.nombre} con repeticiones 2 → unidades_declaradas ${estructura.unidadesMinimasPorInstancia * 2} o más (${estructura.unidadesMinimasPorInstancia} por pieza)`])
    .join("; ");
  assert.equal(EJEMPLO_UNIDADES_DECLARADAS, esperado);
  assert.ok(modoPlan.includes(esperado), "el prompt usa el ejemplo derivado de la tabla");
  const estructuraPlan = (HERRAMIENTAS_PLAN[0]!.esquema as { properties: { estructuras: { items: { properties: Record<string, { description?: string }> } } } }).properties.estructuras.items.properties;
  assert.ok(String(estructuraPlan.unidades_declaradas!.description).includes(esperado), String(estructuraPlan.unidades_declaradas!.description));
  assert.doesNotMatch(HERRAMIENTAS_PLAN[0]!.descripcion, /No mandes tamaños, cantidades de globos ni precios/);
  assert.match(perfilCreatividad(5).instruccionDiseno ?? "", /no inventes precios \(las cantidades de las estructuras con geometría las calcula el sistema/);
  ok("regla acotada: geometría sin cantidades, Bouquet/Figura con unidades_declaradas del mínimo de la tabla");

  console.log(`\n${casos} casos OK (prompt del modo diseño)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
