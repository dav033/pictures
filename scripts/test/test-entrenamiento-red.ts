/**
 * Arnés de entrenamiento (W4): la guarda de red de cada transporte (api, seco, cli). Sin red ni coste:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-entrenamiento-red.ts
 */
import assert from "node:assert/strict";
import { instalarGuardaRed } from "../entrenamiento/lib-red";

const URL_ANTHROPIC = "https://api.anthropic.com/v1/messages";
const CUERPO_SECO = JSON.stringify({ model: "claude-haiku-5-5", tools: [{ name: "consulta" }] });
const peticion = (extra: RequestInit = {}): RequestInit => ({ method: "POST", body: CUERPO_SECO, ...extra });

async function rechaza(promesa: Promise<unknown>, patron: RegExp): Promise<void> {
  await assert.rejects(promesa, (error: unknown) => patron.test(`${(error as Error).name}: ${(error as Error).message}`));
}

async function main(): Promise<void> {
  let pruebas = 0;
  const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
  const original = globalThis.fetch;

  console.log("Guarda de red del arnés (W4):");

  await prueba("en seco responde lo grabado, con el uso simulado, y cuenta cada llamada servida", async () => {
    const red = instalarGuardaRed("seco");
    try {
      red.ajustar({ uso: { input_tokens: 10, output_tokens: 5 } });
      const respuesta = await fetch(URL_ANTHROPIC, peticion());
      const dato = (await respuesta.json()) as { usage: { input_tokens: number } };
      assert.equal(dato.usage.input_tokens, 10);
      assert.equal(red.servidas(), 1);
    } finally {
      red.restaurar();
    }
    assert.equal(globalThis.fetch, original, "restaurar devuelve el fetch original");
  });

  await prueba("en seco rechaza una petición con la señal ya abortada y no la sirve", async () => {
    const red = instalarGuardaRed("seco");
    try {
      const controlador = new AbortController();
      controlador.abort();
      await rechaza(fetch(URL_ANTHROPIC, peticion({ signal: controlador.signal })), /AbortError/);
      await rechaza(fetch(new Request(URL_ANTHROPIC, peticion({ signal: controlador.signal }))), /AbortError/);
      assert.equal(red.servidas(), 0);
      await fetch(URL_ANTHROPIC, peticion({ signal: new AbortController().signal }));
      assert.equal(red.servidas(), 1, "una señal viva sí se sirve");
    } finally {
      red.restaurar();
    }
  });

  await prueba("la pasada detenida (tope, llamadas) no deja salir ni responder ninguna petición más, en seco y en api", async () => {
    for (const transporte of ["seco", "api"] as const) {
      let motivo: string | null = null;
      const red = instalarGuardaRed(transporte, { parado: () => motivo });
      try {
        if (transporte === "seco") {
          await fetch(URL_ANTHROPIC, peticion());
          assert.equal(red.servidas(), 1);
        }
        motivo = "Tope de gasto de la pasada superado";
        await rechaza(fetch(URL_ANTHROPIC, peticion()), /pasada detenida.*Tope de gasto/);
        assert.equal(red.servidas(), transporte === "seco" ? 1 : 0, `${transporte}: nada nuevo tras el paro`);
      } finally {
        red.restaurar();
      }
    }
  });

  await prueba("solo deja pasar a api.anthropic.com; cualquier otro host se bloquea, y con cli no sale nada", async () => {
    for (const transporte of ["seco", "api", "cli"] as const) {
      const red = instalarGuardaRed(transporte);
      try {
        await rechaza(fetch("https://generativelanguage.googleapis.com/v1/models", peticion()), /Guarda de red.*generativelanguage/);
        await rechaza(fetch("https://queue.fal.run/x", peticion()), /Guarda de red.*queue\.fal\.run/);
        assert.equal(red.servidas(), 0);
      } finally {
        red.restaurar();
      }
    }
    const red = instalarGuardaRed("cli");
    try {
      await rechaza(fetch(URL_ANTHROPIC, peticion()), /Guarda de red.*api\.anthropic\.com/);
    } finally {
      red.restaurar();
    }
  });

  await prueba("una llamada de seco puede fallar a propósito (HTTP 500) para probar la contabilidad de fallos", async () => {
    const red = instalarGuardaRed("seco", { fallarLlamada: 2 });
    try {
      assert.equal((await fetch(URL_ANTHROPIC, peticion())).status, 200);
      assert.equal((await fetch(URL_ANTHROPIC, peticion())).status, 500);
      assert.equal((await fetch(URL_ANTHROPIC, peticion())).status, 200);
    } finally {
      red.restaurar();
    }
  });

  console.log(`\n${pruebas} pruebas de la guarda de red: OK`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
