/**
 * `/api/plan-editar` con los modos del CRUD por chat de la guiada (`agregar_pieza`, `editar_pieza`): el cuerpo que
 * arma la vista (`agregarPiezaEnServidor`, `editarPiezaEnServidor`) entra en la unión del cuerpo y llega a la
 * comprobación de la aprobación (un token roto → 409, sin tocar Python); un cuerpo mal formado → 400. Sin red, sin
 * base de datos y sin coste: `globalThis.fetch` falla si alguien intenta llegar a Python.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-crud-plan-chat-ruta.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.PYTHON_BACKEND_URL = "http://python.test";
process.env.INTERNAL_HMAC_SECRET = "local-only-secret-0123456789abcdef";
process.env.DATABASE_URL = "postgresql://demo:demo@127.0.0.1:5432/demo_rag";
process.env.PLAN_APPROVAL_SECRET = "local-crud-chat-secret-20261007";
delete process.env.APP_PASSWORD;

type Json = Record<string, unknown>;

async function main(): Promise<void> {
  const { POST: editar } = await import("../../src/app/api/plan-editar/route");
  const { agregarPiezaEnServidor, editarPiezaEnServidor } = await import("../../src/components/guiado/ajuste/edicion-chat-guiada");
  const { PlanGuiadoSchema } = await import("../../src/lib/ia/contracts/asistente-guiado-v1");
  const base = PlanGuiadoSchema.parse({ ...(JSON.parse(readFileSync("scripts/test/fixtures/plan-guiado-columnas-repetidas.json", "utf8")) as Json), approval_token: "token-roto" });

  // Lo que manda la vista, capturado sin red.
  const cuerpos: Json[] = [];
  const capturar: typeof fetch = async (_entrada, init) => {
    cuerpos.push(JSON.parse(String(init?.body)) as Json);
    return new Response(JSON.stringify({ error: "capturado" }), { status: 418 });
  };
  await agregarPiezaEnServidor(base, { estructura: "guirnalda", ubicacion: "centro", colores: [], globos: [] }, capturar).catch(() => undefined);
  await agregarPiezaEnServidor(base, { estructura: "guirnalda", ubicacion: "arriba", medidas: { largo_m: 3 }, colores: ["blanco"], globos: [{ productId: "8634000000200", color: "dorado", variantIds: ["rd12", "rd5"], nombre: "Reflex Dorado" }] }, capturar).catch(() => undefined);
  await editarPiezaEnServidor(base, { estructuraId: "EST_02_COLUMNA", ubicacion: "centro" }, capturar).catch(() => undefined);
  await editarPiezaEnServidor(base, { estructuraId: "EST_02_COLUMNA", nombre: "Torre rosa" }, capturar).catch(() => undefined);
  assert.equal(cuerpos.length, 4);
  assert.deepEqual(Object.keys(cuerpos[0]!).sort(), ["base", "estructura", "modo", "ubicacion"]);
  assert.deepEqual(cuerpos[1]!.globos, [{ color: "dorado", product_id: "8634000000200", variant_ids: ["rd12", "rd5"] }]);

  globalThis.fetch = (async () => { throw new Error("un token roto no debe llegar a Python"); }) as typeof fetch;
  const pedir = async (cuerpo: Json): Promise<{ status: number; cuerpo: Json }> => {
    const respuesta = await editar(new Request("http://127.0.0.1/api/plan-editar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }));
    return { status: respuesta.status, cuerpo: (await respuesta.json()) as Json };
  };
  for (const cuerpo of cuerpos) {
    const respuesta = await pedir(cuerpo);
    assert.notEqual(respuesta.status, 400, `el cuerpo de la vista entra en la unión: ${JSON.stringify(respuesta.cuerpo).slice(0, 300)}`);
    assert.equal(respuesta.status, 409, `llega a la comprobación de la aprobación: ${JSON.stringify(respuesta.cuerpo).slice(0, 300)}`);
  }
  for (const malo of [
    { ...cuerpos[0]!, estructura: "bouquet" },
    { ...cuerpos[0]!, ubicacion: "volando" },
    { ...cuerpos[0]!, medidas: { largo_m: 40 } },
    { ...cuerpos[0]!, extra: true },
    { modo: "editar_pieza", base: cuerpos[2]!.base, estructura_id: "EST_02_COLUMNA" },
    { ...cuerpos[2]!, estructura_id: "columna" },
  ]) {
    assert.equal((await pedir(malo)).status, 400, JSON.stringify(malo).slice(0, 60));
  }
  console.log("crud-plan-chat-ruta: OK");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
