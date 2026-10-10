/**
 * CUS-02: el total de la tarjeta del plan guiado y el de la cotización («¿cuánto cuesta?») de una misma idea de la
 * biblioteca salen del mismo cálculo. Cinco ideas, con el motor 3D y el precio de Python sustituido por el doble del cruce
 * (`pythonDoble`, el mismo de test-motor-guiada-precio.ts): sin red, sin base, sin IA.
 * - la tarjeta (sobre del motor: `cotizacion.total` y `plan.totales.total_cop`) = total de `cotizarBom` del mismo plan;
 * - el carrusel (`cotizarIdeaConMotor`) da ese mismo total y la misma reserva del 8 %.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-motor-guiada-tarjeta-total.ts
 */
import assert from "node:assert/strict";
import { CotizacionPlanGuiadoSchema, PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { cotizarIdeaConMotor } from "../../src/lib/guiada-motor/cotizar-idea";
import { armarDesdeEspec, cotizarBom, crosswalkIncluido, especDesdeIdeaGuardada, sobreDelMotor } from "../../src/lib/globos3d/motor/v1";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";
import { todosLosCasos } from "../lib/casos-motor-guiada";
import { pythonDoble } from "../lib/python-doble-precio";

const cruce = crosswalkIncluido();
const dependencias = () => {
  const doble = pythonDoble(cruce);
  return { crosswalk: async () => cruce, cotizarLista: doble.cotizarLista };
};

async function main(): Promise<void> {
  const ideas = todosLosCasos().filter((c) => c.id.startsWith("idea-")).map((c) => c.id.replace(/^idea-/, ""));
  const elegidas = ideas.filter((id) => {
    const guardado = planGuardadoDeIdea(id);
    return guardado !== null && armarDesdeEspec(especDesdeIdeaGuardada(guardado.plan, id).espec).noRepresentable.length === 0;
  }).slice(0, 5);
  assert.equal(elegidas.length, 5, "hay cinco ideas de la biblioteca que el motor arma");

  for (const id of elegidas) {
    const guardado = planGuardadoDeIdea(id);
    assert.ok(guardado, id);
    const espec = especDesdeIdeaGuardada(guardado.plan, id).espec;
    const resultado = armarDesdeEspec(espec);
    const cotizada = await cotizarBom(resultado.bom, dependencias());
    assert.ok(cotizada.ok, `${id}: ${JSON.stringify(cotizada)}`);
    if (!cotizada.ok) continue;

    const sobre = sobreDelMotor({ espec, resultado, cotizacion: cotizada, concepto: { titulo: `Idea ${id}`.slice(0, 160), descripcion: "Plan de prueba" }, requestId: "11111111-1111-4111-8111-111111111111" });
    assert.ok(sobre.ok, `${id}: ${sobre.ok ? "" : sobre.motivo}`);
    if (!sobre.ok) continue;
    const plan = PlanGuiadoSchema.parse(sobre.plan);
    const tarjeta = CotizacionPlanGuiadoSchema.parse(sobre.cotizacion);
    const totalesDelPlan = (plan as unknown as { totales: { total_cop: number } }).totales.total_cop;
    assert.equal(tarjeta.total, cotizada.total, `${id}: la tarjeta cuesta lo que cotizó el motor`);
    assert.equal(totalesDelPlan, cotizada.total, `${id}: totales.total_cop del plan`);

    const carrusel = await cotizarIdeaConMotor(id, { ...dependencias(), planGuardado: planGuardadoDeIdea });
    assert.ok(carrusel.ok, `${id}: ${JSON.stringify(carrusel)}`);
    if (!carrusel.ok) continue;
    assert.equal(carrusel.cotizacion.total, tarjeta.total, `${id}: el carrusel y la tarjeta dan el mismo total`);
    assert.equal(carrusel.cotizacion.mermaPorcentaje, tarjeta.mermaPorcentaje);
    console.log(`  ✓ ${id}: ${tarjeta.total.toLocaleString("es-CO")} COP en tarjeta, carrusel y cotización`);
  }
  console.log("\n5 ideas: tarjeta = cotización = carrusel");
}

main().catch((error) => { console.error(error); process.exit(1); });
