/**
 * Offline checks for what the arch editor (ADR-0035, step 1) asks of the Next routes. Transport and policy only:
 * the arch itself is Python's (`services/ai-api/tests/test_plan_edicion_armado_arco.py`,
 * `test_plan_armado_arco.py`). `globalThis.fetch` is stubbed; there is no network and no database query.
 *
 * - `/api/plan-editar` accepts the `armado_arco` action inside its body union: a valid one reaches the signed
 *   approval check (409 with a tampered token), a malformed one is a deliberate 400.
 * - An edit that leaves the piece without catalog coverage is refused before it is signed
 *   (`faltaCoberturaPorElArmado`): only what THIS armado left uncovered counts.
 * - `/api/plan-armado-arco` caps the previews in flight: the next one is a 429 with a sentence and `Retry-After`,
 *   and a slot is freed when each one ends, whatever happened to it.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-plan-editar-arco-ruta.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.PYTHON_BACKEND_URL = "http://python.test";
process.env.INTERNAL_HMAC_SECRET = "local-only-secret-0123456789abcdef";
process.env.DATABASE_URL = "postgresql://demo:demo@127.0.0.1:5432/demo_rag";
process.env.PLAN_APPROVAL_SECRET = "local-editar-arco-ruta-secret-20261002";
delete process.env.APP_PASSWORD;

type Json = Record<string, unknown>;

const leer = (ruta: string): Json => JSON.parse(readFileSync(join(process.cwd(), ruta), "utf8")) as Json;
const VISTA = leer("scripts/fixtures/arco-ui/vista-arco.json") as { peticion: { estructura_id: string; armado_arco: Json; colores: string[] } };
const PLAN_RESUELTO = leer("scripts/fixtures/patron-color-ui/plan-con-patrones.json");
const ARCO = VISTA.peticion.estructura_id;
const ARMADO = VISTA.peticion.armado_arco;

let casos = 0;
async function caso(nombre: string, prueba: () => void | Promise<void>): Promise<void> {
  try {
    await prueba();
  } catch (error) {
    console.error(`[FAIL] ${nombre}`);
    throw error;
  }
  casos += 1;
  console.log(`[PASS] ${nombre}`);
}

async function main(): Promise<void> {
  const { POST: editar } = await import("../../src/app/api/plan-editar/route");
  const { POST: dibujar } = await import("../../src/app/api/plan-armado-arco/route");
  const { faltaCoberturaPorElArmado } = await import("../../src/lib/plan/aplicar-edicion");
  type PlanResuelto = Parameters<typeof faltaCoberturaPorElArmado>[1];
  const resuelto = PLAN_RESUELTO as unknown as PlanResuelto;

  const pedirEditar = async (edicion: unknown): Promise<{ status: number; cuerpo: Json }> => {
    const respuesta = await editar(new Request("http://127.0.0.1/api/plan-editar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modo: "aplicar", base: PLAN_RESUELTO, edicion }),
    }));
    return { status: respuesta.status, cuerpo: (await respuesta.json()) as Json };
  };

  await caso("/api/plan-editar: la acción armado_arco está en la unión del cuerpo y llega a la comprobación de la aprobación", async () => {
    globalThis.fetch = (async () => { throw new Error("una edición con el token roto no debe llegar a Python"); }) as typeof fetch;
    const valida = await pedirEditar({ accion: "armado_arco", estructura_id: ARCO, armado_arco: ARMADO });
    assert.equal(valida.status, 409, JSON.stringify(valida.cuerpo).slice(0, 200));
    assert.match(String(valida.cuerpo.error), /aprobación base expiró/);
    const quitar = await pedirEditar({ accion: "armado_arco", estructura_id: ARCO, armado_arco: null });
    assert.equal(quitar.status, 409, "quitar el armado (null) también es una edición válida");
    for (const mala of [
      { accion: "armado_arco", estructura_id: ARCO, armado_arco: { ...ARMADO, patron: "inventado" } },
      { accion: "armado_arco", estructura_id: ARCO, armado_arco: { ...ARMADO, campo_nuevo: 1 } },
      { accion: "armado_arco", estructura_id: ARCO },
      { accion: "armado_arco", estructura_id: ARCO, armado_arco: ARMADO, extra: true },
    ]) {
      assert.equal((await pedirEditar(mala)).status, 400, JSON.stringify(mala).slice(0, 80));
    }
  });

  await caso("sin cobertura de catálogo por el armado nuevo: se rechaza con la frase, y lo que ya faltaba antes no cuenta", () => {
    const edicion = { accion: "armado_arco" as const, estructura_id: ARCO, armado_arco: ARMADO as never };
    const faltan = (sinCobertura: PlanResuelto["sin_cobertura"]): PlanResuelto => ({ ...resuelto, sin_cobertura: sinCobertura });
    const nueva = { estructura_id: ARCO, product_id: "prod-azul", tamano: "R-36" };
    const antes = faltan([]);
    assert.equal(faltaCoberturaPorElArmado(edicion, antes, antes), null, "todo cubierto: nada que decir");
    const frase = faltaCoberturaPorElArmado(edicion, antes, faltan([nueva]));
    assert.ok(frase && frase.includes("R-36") && frase.includes("Elige otro tamaño de globo"), frase ?? "sin frase");
    assert.equal(faltaCoberturaPorElArmado(edicion, faltan([nueva]), faltan([nueva])), null, "ya faltaba antes: no es culpa de este armado");
    assert.equal(faltaCoberturaPorElArmado(edicion, antes, faltan([{ ...nueva, estructura_id: "EST_09_OTRA" }])), null, "lo que falta en otra pieza no se le achaca a este arco");
    assert.equal(faltaCoberturaPorElArmado({ ...edicion, armado_arco: null }, antes, faltan([nueva])), null, "quitar el armado no se rechaza por cobertura");
    assert.equal(faltaCoberturaPorElArmado({ accion: "mezcla", estructura_id: ARCO, mezcla: "clasica" }, antes, faltan([nueva])), null, "solo las ediciones de armado de arco");
  });

  await caso("/api/plan-armado-arco: tope de dibujos en vuelo, 429 con frase y Retry-After, y el cupo se libera al terminar", async () => {
    const liberar: Array<() => void> = [];
    let llamadas = 0;
    globalThis.fetch = (async () => {
      llamadas += 1;
      await new Promise<void>((listo) => liberar.push(listo));
      return new Response(JSON.stringify({ code: "PYTHON_UNAVAILABLE" }), { status: 503, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const cuerpo = { plan: (PLAN_RESUELTO as { plan: unknown }).plan, estructura_id: ARCO, armado_arco: ARMADO, colores: VISTA.peticion.colores };
    const nueva = () => dibujar(new Request("http://127.0.0.1/api/plan-armado-arco", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }));
    const enVuelo = Array.from({ length: 4 }, nueva);
    for (let intento = 0; intento < 200 && llamadas < 4; intento += 1) await new Promise((listo) => setTimeout(listo, 5));
    assert.equal(llamadas, 4, "las cuatro primeras llegan a Python");
    const quinta = await nueva();
    assert.equal(quinta.status, 429);
    assert.equal(quinta.headers.get("Retry-After"), "1");
    const datos = (await quinta.json()) as Json;
    assert.match(String(datos.error), /demasiados dibujos del arco en curso/);
    assert.equal(llamadas, 4, "la quinta ni siquiera llega a Python");
    liberar.forEach((soltar) => soltar());
    const terminadas = await Promise.all(enVuelo);
    assert.ok(terminadas.every((r) => r.status !== 429), "las que estaban dentro terminan, aunque sea con error de Python");
    // El cupo vuelve aunque hayan fallado: la siguiente ya no es 429.
    const siguiente = nueva();
    for (let intento = 0; intento < 200 && llamadas < 5; intento += 1) await new Promise((listo) => setTimeout(listo, 5));
    liberar.forEach((soltar) => soltar());
    assert.notEqual((await siguiente).status, 429, "se liberó el cupo de cada dibujo que terminó");
  });

  console.log(`\n${casos} casos en verde`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
