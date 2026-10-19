/**
 * Plazos y coste de la IA con Claude por Claude Code (`IA_CLAUDE_TRANSPORTE=cli`, solo local). Sin red ni coste:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-plazos-ia.ts
 * - en producción (y en Vercel, sin NODE_ENV, con la API o con Gemini) cada plazo queda en su número de siempre, el
 *   navegador no pide nada y `/api/ia/salud` no cambia;
 * - con cli en local, los plazos que esperan a la IA se estiran ×4;
 * - toda fila de Anthropic en ai_call_log por cli va como `cli:<modelo>` y sin coste; los costes estimados son 0.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { EventoTelemetria } from "@sempertex/agente-core";
import { FACTOR_PLAZO_CLI, factorPlazoIA, plazoIA } from "../../src/lib/ia/claude/config";
import { DEADLINE_MAX_MS } from "../../src/lib/ia/contracts/operational-v1";
import { cargarFactorPlazoCliente, factorPlazoCliente } from "../../src/lib/ia/plazo-cliente";
import { crearDeadlineIA } from "../../src/lib/ia/plazo-servidor";
import { conProveedorDeEmpresa } from "../../src/lib/ia/nucleo/telemetria-llamadas";
import { costeUsoUsd } from "../../src/lib/globos3d/leer-foto-ia";

let pruebas = 0;
const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const RAIZ = path.resolve(__dirname, "..", "..");
const fuente = (archivo: string) => readFileSync(path.join(RAIZ, archivo), "utf8");

const CLI = { NODE_ENV: "development", IA_PROVEEDOR: "claude", IA_CLAUDE_TRANSPORTE: "cli" };
const FUERA_DE_CLI = [
  ["producción (VPS, next start)", { ...CLI, NODE_ENV: "production" }],
  ["Vercel", { ...CLI, VERCEL: "1" }],
  ["sin NODE_ENV", { ...CLI, NODE_ENV: undefined }],
  ["local con la API", { NODE_ENV: "development", IA_PROVEEDOR: "claude", ANTHROPIC_API_KEY: "sk-ant-no-real" }],
  ["local con Gemini", { NODE_ENV: "development", IA_PROVEEDOR: "gemini", IA_CLAUDE_TRANSPORTE: "cli" }],
] as const;

/** Los plazos de hoy, tal como están en el código (producción los usa sin tocar). */
const PLAZOS = [
  { archivo: "src/app/api/asistente-guiado/route.ts", constante: "const DEADLINE_TURNO_MS = 60_000;", uso: "crearDeadlineIA(request.signal, DEADLINE_TURNO_MS)", ms: 60_000 },
  { archivo: "src/lib/ia/contracts/operational-v1.ts", constante: "export const DEADLINE_DEFAULT_MS = 75_000;", uso: null, ms: 75_000 },
  { archivo: "src/lib/ia/contracts/operational-v1.ts", constante: "export const DEADLINE_MAX_MS = 110_000;", uso: null, ms: 110_000 },
  { archivo: "src/app/api/chat/route.ts", constante: "crearDeadlineIA(request.signal, contextoOperativo.deadline_ms)", uso: null, ms: 110_000 },
  { archivo: "src/lib/feedback-ia/resumen-gemini.ts", constante: "const TIEMPO_MAXIMO_MS = 40_000;", uso: "AbortSignal.timeout(plazoIA(TIEMPO_MAXIMO_MS))", ms: 40_000 },
  { archivo: "src/app/page.tsx", constante: "const LIMITE_INACTIVIDAD_CHAT_MS = 90_000;", uso: "LIMITE_INACTIVIDAD_CHAT_MS * factorPlazoCliente()", ms: 90_000 },
  { archivo: "src/app/page.tsx", constante: "const LIMITE_ESPERA_ANALISIS_MS = 45_000;", uso: "LIMITE_ESPERA_ANALISIS_MS * factorPlazoCliente()", ms: 45_000 },
  { archivo: "src/components/guiado/VistaGuiada.tsx", constante: "const LIMITE_FOTO_MS = 100_000;", uso: "LIMITE_FOTO_MS * factorPlazoCliente()", ms: 100_000 },
  { archivo: "src/components/guiado/VistaGuiada.tsx", constante: "const LIMITE_TURNO_MS = 75_000;", uso: "LIMITE_TURNO_MS * factorPlazoCliente()", ms: 75_000 },
  { archivo: "src/components/guiado/VistaGuiada.tsx", constante: "const LIMITE_PLAN_MS = 75_000;", uso: "LIMITE_PLAN_MS * factorPlazoCliente()", ms: 75_000 },
] as const;

const evento = (proveedor: EventoTelemetria["proveedor"], modelo: string): EventoTelemetria => ({ proveedor, modelo, flujo: "armador_decoracion", capacidad: "chat_turno", ms: 1, resultado: "ok", cuando: new Date(0).toISOString() });

async function main() {
  console.log("Plazos del servidor");
  await prueba("los plazos siguen en el código con sus números de hoy, y cada uso pasa por el factor", () => {
    for (const plazo of PLAZOS) {
      assert.ok(fuente(plazo.archivo).includes(plazo.constante), `${plazo.archivo}: ${plazo.constante}`);
      if (plazo.uso) assert.ok(fuente(plazo.archivo).includes(plazo.uso), `${plazo.archivo}: ${plazo.uso}`);
    }
  });
  for (const [nombre, entorno] of FUERA_DE_CLI) {
    await prueba(`${nombre}: factor 1, cada plazo idéntico`, () => {
      assert.equal(factorPlazoIA(entorno), 1);
      for (const plazo of PLAZOS) assert.equal(plazoIA(plazo.ms, entorno), plazo.ms);
    });
  }
  await prueba("Claude por Claude Code en local: ×4", () => {
    assert.equal(FACTOR_PLAZO_CLI, 4);
    assert.equal(factorPlazoIA(CLI), 4);
    assert.equal(plazoIA(60_000, CLI), 240_000);
    assert.equal(plazoIA(75_000, CLI), 300_000);
  });
  await prueba("el plazo que de verdad ponen las rutas (crearDeadlineIA): el de siempre fuera de cli, ×4 con su tope también ×4 en cli", () => {
    const padre = new AbortController().signal;
    const vence = (ms: number, entorno: Readonly<Record<string, string | undefined>>) => {
      const antes = Date.now();
      const plazo = crearDeadlineIA(padre, ms, entorno);
      plazo.dispose();
      return plazo.deadlineAt - antes;
    };
    const cerca = (real: number, esperado: number) => assert.ok(real >= esperado - 50 && real <= esperado + 50, `${real} ≠ ${esperado}`);
    for (const [, entorno] of FUERA_DE_CLI) {
      cerca(vence(60_000, entorno), 60_000);
      cerca(vence(75_000, entorno), 75_000);
      cerca(vence(500_000, entorno), DEADLINE_MAX_MS);
    }
    cerca(vence(60_000, CLI), 240_000);
    cerca(vence(75_000, CLI), 300_000);
    cerca(vence(DEADLINE_MAX_MS, CLI), 440_000);
    cerca(vence(10_000_000, CLI), 440_000);
  });

  console.log("Plazos del navegador");
  const NODE_ENV = process.env.NODE_ENV;
  let pedidos = 0;
  const salud = (cuerpo: unknown) => async () => { pedidos += 1; return new Response(JSON.stringify(cuerpo), { status: 200 }); };
  await prueba("bundle de producción: no pide nada y el factor es 1", async () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    await cargarFactorPlazoCliente(salud({ factorPlazo: 4 }));
    assert.equal(pedidos, 0);
    assert.equal(factorPlazoCliente(), 1);
  });
  await prueba("next dev: lo lee una vez de /api/ia/salud", async () => {
    Object.assign(process.env, { NODE_ENV: "development" });
    await cargarFactorPlazoCliente(salud({ factorPlazo: 4 }));
    await cargarFactorPlazoCliente(salud({ factorPlazo: 9 }));
    assert.equal(pedidos, 1);
    assert.equal(factorPlazoCliente(), 4);
  });
  if (NODE_ENV === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Object.assign(process.env, { NODE_ENV });
  await prueba("/api/ia/salud manda factorPlazo solo cuando es mayor que 1", () => {
    assert.ok(fuente("src/app/api/ia/salud/route.ts").includes("...(factorPlazo > 1 ? { factorPlazo } : {})"));
  });

  console.log("Coste y ai_call_log");
  await prueba("ai_call_log con cli: las filas de Anthropic van como cli:<modelo> y sin coste (una vez, aunque se repita)", async () => {
    const guardados: EventoTelemetria[] = [];
    const persistencia = conProveedorDeEmpresa({ guardar: async (e) => { guardados.push(e); } }, CLI);
    await persistencia.guardar({ ...evento("claude", "claude-haiku-5-5"), pricingId: 7, costeEstimado: 0.01, moneda: "USD" });
    await persistencia.guardar(evento("anthropic", "cli:haiku"));
    await persistencia.guardar(evento("gemini", "gemini-3.6-flash"));
    assert.deepEqual(guardados.map((e) => [e.proveedor, e.modelo, e.costeEstimado, e.pricingId]), [["anthropic", "cli:claude-haiku-5-5", undefined, undefined], ["anthropic", "cli:haiku", undefined, undefined], ["gemini", "gemini-3.6-flash", undefined, undefined]]);
  });
  await prueba("ai_call_log fuera de cli (producción, API): las filas quedan como siempre", async () => {
    for (const [, entorno] of FUERA_DE_CLI) {
      const guardados: EventoTelemetria[] = [];
      const persistencia = conProveedorDeEmpresa({ guardar: async (e) => { guardados.push(e); } }, entorno);
      await persistencia.guardar(evento("claude", "claude-haiku-5-5"));
      assert.deepEqual(guardados.map((e) => [e.proveedor, e.modelo]), [["anthropic", "claude-haiku-5-5"]]);
    }
  });
  await prueba("costeUsoUsd: 0 por cli; sin el transporte, «haiku» se habría cotizado con precios de Gemini", () => {
    const uso = { entrada: 20_000, salida: 10_000, pensamiento: 0 };
    assert.equal(costeUsoUsd(uso, "haiku", "cli"), 0);
    assert.ok(costeUsoUsd(uso, "haiku") > 0);
  });

  console.log(`\ntest-plazos-ia: ${pruebas} pruebas ok`);
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
