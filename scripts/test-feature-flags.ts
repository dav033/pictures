import assert from "node:assert/strict";

// Fase 5.3: IMAGE_INSTANCE_QA solía tener dos implementaciones independientes
// (feature-flags.ts e image-qa.ts) que podían discrepar sobre si el QA visual
// de un plan aprobado realmente iba a correr. Este test fija las tres
// combinaciones de precedencia contra la ÚNICA fuente de verdad ahora vigente.

const CLAVES = ["IMAGE_INSTANCE_QA", "IMAGE_QA_VISION", "GEMINI_API_KEY"] as const;
const originales = Object.fromEntries(CLAVES.map((k) => [k, process.env[k]])) as Record<(typeof CLAVES)[number], string | undefined>;

function set(valores: Partial<Record<(typeof CLAVES)[number], string | undefined>>) {
  for (const clave of CLAVES) {
    const valor = clave in valores ? valores[clave] : undefined;
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
}

async function featureEnabled(name: "IMAGE_INSTANCE_QA"): Promise<boolean> {
  // Import dinámico: el módulo no lee env vars a nivel de módulo, solo dentro
  // de la función, así que un solo import re-testeado con distintos
  // process.env sigue siendo válido.
  const mod = await import("../src/lib/ia/feature-flags");
  return mod.featureEnabled(name);
}

async function main() {
  set({ IMAGE_INSTANCE_QA: "false" });
  assert.equal(await featureEnabled("IMAGE_INSTANCE_QA"), false, "IMAGE_INSTANCE_QA explícito manda, sin importar lo demás");

  set({ IMAGE_INSTANCE_QA: "true", IMAGE_QA_VISION: "false" });
  assert.equal(await featureEnabled("IMAGE_INSTANCE_QA"), true, "IMAGE_INSTANCE_QA explícito manda sobre el legado IMAGE_QA_VISION");

  set({ IMAGE_QA_VISION: "false", GEMINI_API_KEY: "x" });
  assert.equal(await featureEnabled("IMAGE_INSTANCE_QA"), false, "sin IMAGE_INSTANCE_QA, el legado IMAGE_QA_VISION=false gana sobre tener API key");

  set({ IMAGE_QA_VISION: "true", GEMINI_API_KEY: undefined });
  assert.equal(await featureEnabled("IMAGE_INSTANCE_QA"), true, "sin IMAGE_INSTANCE_QA, el legado IMAGE_QA_VISION=true habilita aunque no haya API key");

  set({ GEMINI_API_KEY: "x" });
  assert.equal(await featureEnabled("IMAGE_INSTANCE_QA"), true, "sin ningún flag, cae a si hay GEMINI_API_KEY configurada");

  set({});
  assert.equal(await featureEnabled("IMAGE_INSTANCE_QA"), false, "sin ningún flag ni API key, queda deshabilitado");

  set(originales);
  console.log("Feature flags (IMAGE_INSTANCE_QA): OK");
}

main().catch((error) => {
  set(originales);
  console.error(error);
  process.exitCode = 1;
});
