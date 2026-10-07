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
import { WidgetGuiadoSchema } from "@/lib/ia/guiado/widgets";
import { avisosPlanDeIdea } from "@/lib/plan/avisos-plan-idea";
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

  // Verificador 127: si el plan de la idea NO sale exacto, el cliente se entera (antes la ruta devolvía `avisos: []`).
  const exacta = avisosPlanDeIdea({ globosIdea: 87, globosDeIdeaEnPlan: 87, nuevas: ["EST_01", "EST_02"], sustituciones: [], sinCobertura: [], sinTallasDeIdea: false });
  assert.deepEqual(exacta, { exacto: true, avisos: [] }, "exacta: nada que decir");
  const ajustada = avisosPlanDeIdea({
    globosIdea: 87, globosDeIdeaEnPlan: 85, nuevas: ["EST_02", "EST_03"],
    sustituciones: [
      { estructura_id: "EST_02", pedido: "R-36", entregado: "R-24" },
      { estructura_id: "EST_03", pedido: "R-36", entregado: "R-24" },
      { estructura_id: "EST_03", pedido: "R-5", entregado: "R-9" },
      { estructura_id: "EST_01", pedido: "R-18", entregado: "R-12" },
    ],
    sinCobertura: [{ estructura_id: "EST_01", tamano: "R-260" }],
    sinTallasDeIdea: false,
  });
  assert.equal(ajustada.exacto, false);
  assert.deepEqual(ajustada.avisos, [
    "Ajustamos 2 tamaños que no había: 36″ por 24″ y 5″ por 9″.",
    "La idea lleva 87 globos; en tu plan salen 85.",
  ], "solo lo de las piezas de la idea, en palabras de cliente (la pieza que ya estaba no cuenta)");
  assert.deepEqual(avisosPlanDeIdea({ globosIdea: 40, globosDeIdeaEnPlan: 40, nuevas: ["EST_04"], sustituciones: [], sinCobertura: [{ estructura_id: "EST_04", tamano: "R-36" }], sinTallasDeIdea: true }).avisos, [
    "No hay globos de 36″ disponibles ahora; la idea va sin ellos.",
    "Para no cambiar las piezas que ya tenías, la idea se armó con otros tamaños.",
  ]);
  assert.deepEqual(avisosPlanDeIdea({ globosIdea: 10, globosDeIdeaEnPlan: 10, nuevas: ["EST_01"], sustituciones: [{ estructura_id: "EST_01", pedido: "gris", entregado: "plateado" }], sinCobertura: [], sinTallasDeIdea: false }).avisos, ["Cambiamos un color que no había: gris por plateado."]);

  // El cliente lee `exacto` y `avisos`; un plan exacto no dice nada y un aviso raro no tumba el plan.
  const idea07 = ideas["deco-real-07-eb12910e210c94b6184d025127acce95"]!;
  const resuelto07 = (JSON.parse(readFileSync(path.join(ANALISIS, idea07.archivo), "utf8")) as { plan_resuelto: Record<string, unknown> }).plan_resuelto;
  const planValido = { ...resuelto07, approval_token: "prueba" };
  const responder = (extra: Record<string, unknown>): typeof fetch => async () => new Response(JSON.stringify({ plan: planValido, cotizacion: null, nuevas: ["EST_01_COLUMNA_ASIMETRICA"], globosIdea: 87, ...extra }), { status: 200 });
  const conAvisos = await pedirPlanDeIdea("deco-real-07", null, new AbortController().signal, responder({ exacto: false, avisos: ajustada.avisos }));
  assert.ok(conAvisos.ok);
  assert.equal(conAvisos.ok && conAvisos.exacto, false);
  assert.deepEqual(conAvisos.ok ? conAvisos.avisos : null, ajustada.avisos);
  const sinAvisos = await pedirPlanDeIdea("deco-real-07", null, new AbortController().signal, responder({ exacto: true, avisos: ["no se muestra"] }));
  assert.deepEqual(sinAvisos.ok ? [sinAvisos.exacto, sinAvisos.avisos] : null, [true, []], "exacto: sin línea");
  const antiguo = await pedirPlanDeIdea("deco-real-07", null, new AbortController().signal, responder({}));
  assert.deepEqual(antiguo.ok ? [antiguo.exacto, antiguo.avisos] : null, [null, []], "un servidor anterior (sin `exacto`) sigue funcionando");
  const raro = await pedirPlanDeIdea("deco-real-07", null, new AbortController().signal, responder({ exacto: false, avisos: [3, "", "x".repeat(400), "Ajustamos un tamaño que no había: 36″ por 24″."] }));
  assert.deepEqual(raro.ok ? raro.avisos : null, ["Ajustamos un tamaño que no había: 36″ por 24″."], "un aviso raro se ignora; el plan se coloca igual");
  // La tarjeta guarda los avisos con la idea agregada (el widget se restaura de la sesión con este esquema).
  const widget = WidgetGuiadoSchema.safeParse({ tipo: "plan", plan: planValido, agregada: { titulo: "Dos columnas rosa, lila y dorado", total: 85, avisos: ajustada.avisos } });
  assert.equal(widget.success, true, widget.success ? "" : JSON.stringify(widget.error.issues.slice(0, 3)));

  console.log(`test-plan-exacto-idea: OK — ${Object.keys(ideas).length} ideas compran todo con su lista; tope de 8 piezas; cliente sin excepciones; avisos si no sale exacto`);
}

main().catch((error: unknown) => { console.error(error); process.exit(1); });
