/**
 * Lo que `test-plan-de-idea.ts` no cubre del plan exacto de una idea. Determinista, sin red y sin coste.
 * - Cada idea guardada compra con su lista de productos todo lo de su `.plan.json` (incluidas las de 24″ y 36″).
 * - No se suma una idea que pase de 8 piezas (va por el camino de siempre).
 * - El cliente (`pedirPlanDeIdea`) nunca lanza, no coloca un plan inválido y distingue «lo detuvo el cliente».
 *
 * Run: npx tsx scripts/test/test-plan-exacto-idea.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import planesRaw from "@/lib/biblioteca-sempertex/planes-ideas.json";
import { pedirPlanDeIdea } from "@/components/guiado/plan-exacto-idea";
import { PlanesIdeasArchivoSchema, planConIdea } from "@/lib/plan/plan-de-idea";
import { PlanDecoracionSchema } from "@/lib/plan/tipos";

const ANALISIS = path.resolve(__dirname, "..", "..", "data", "biblioteca-real", "analisis");
const { ideas } = PlanesIdeasArchivoSchema.parse(planesRaw);

async function main(): Promise<void> {
  for (const [id, guardado] of Object.entries(ideas)) {
    const archivo = JSON.parse(readFileSync(path.join(ANALISIS, guardado.archivo), "utf8")) as { plan_resuelto: { compras: Array<{ product_id: string; variant_id: string; unidades_necesarias: number }> } };
    const permitidas = new Map(guardado.allowlist.map((entrada) => [entrada.product_id, new Set(entrada.variant_ids)]));
    for (const compra of archivo.plan_resuelto.compras) assert.ok(permitidas.get(compra.product_id)?.has(compra.variant_id), `${id}: ${compra.variant_id} en la lista de productos`);
    assert.equal(guardado.globos, archivo.plan_resuelto.compras.reduce((suma, compra) => suma + compra.unidades_necesarias, 0), `${id}: globos`);
  }

  const columnasId = Object.keys(ideas).find((id) => id.startsWith("deco-real-08"))!;
  const base = planConIdea(ideas[columnasId]!.plan, null);
  assert.ok(base.ok);
  const llena = PlanDecoracionSchema.parse({ ...base.plan, estructuras: Array.from({ length: 7 }, (_, indice) => ({ ...base.plan.estructuras[0]!, estructura_id: `EST_0${indice + 1}_COLUMNA`, ubicacion: "entrada" })) });
  const tope = planConIdea(ideas[columnasId]!.plan, llena);
  assert.equal(tope.ok ? null : tope.motivo, "tope_piezas");

  const control = new AbortController();
  assert.deepEqual(
    await pedirPlanDeIdea("x", null, control.signal, async () => new Response(JSON.stringify({ error: "Esa idea no tiene plan guardado." }), { status: 404 })),
    { ok: false, motivo: "Esa idea no tiene plan guardado.", estado: 404, detenido: false },
  );
  let cuerpo = "";
  const rota = await pedirPlanDeIdea(columnasId, null, control.signal, async (_ruta, opciones) => { cuerpo = String(opciones?.body); return new Response(JSON.stringify({ plan: { x: 1 } }), { status: 200 }); });
  assert.equal(rota.ok, false, "un plan que no pasa el esquema no se coloca");
  assert.deepEqual(JSON.parse(cuerpo), { idea_id: columnasId }, "sin plan vigente no manda base");
  control.abort();
  const detenida = await pedirPlanDeIdea("x", null, control.signal, async () => { throw new DOMException("abortada", "AbortError"); });
  assert.equal(detenida.ok ? null : detenida.detenido, true);

  console.log(`test-plan-exacto-idea: OK — ${Object.keys(ideas).length} ideas compran todo con su lista; tope de 8 piezas; cliente sin excepciones`);
}

main().catch((error: unknown) => { console.error(error); process.exit(1); });
