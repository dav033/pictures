import assert from "node:assert/strict";

// QA visual se ejecuta solo por solicitud explícita de la UI o por el flag
// operativo del servidor. No hay aliases heredados ni una segunda semántica.

const CLAVES = ["IMAGE_QA_ENABLED", "GEMINI_API_KEY"] as const;
const originales = Object.fromEntries(CLAVES.map((k) => [k, process.env[k]])) as Record<(typeof CLAVES)[number], string | undefined>;

function set(valores: Partial<Record<(typeof CLAVES)[number], string | undefined>>) {
  for (const clave of CLAVES) {
    const valor = clave in valores ? valores[clave] : undefined;
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
}

async function featureEnabled(name: "IMAGE_QA_ENABLED"): Promise<boolean> {
  // Import dinámico: el módulo no lee env vars a nivel de módulo, solo dentro
  // de la función, así que un solo import re-testeado con distintos
  // process.env sigue siendo válido.
  const mod = await import("../src/lib/ia/feature-flags");
  return mod.featureEnabled(name);
}

async function main() {
  set({ IMAGE_QA_ENABLED: "false" });
  assert.equal(await featureEnabled("IMAGE_QA_ENABLED"), false, "IMAGE_QA_ENABLED=false desactiva el QA");

  set({ IMAGE_QA_ENABLED: "true" });
  assert.equal(await featureEnabled("IMAGE_QA_ENABLED"), true, "IMAGE_QA_ENABLED=true activa el QA");

  set({});
  assert.equal(await featureEnabled("IMAGE_QA_ENABLED"), false, "sin flag, queda deshabilitado aunque exista GEMINI_API_KEY");

  set(originales);
  console.log("Feature flags (IMAGE_QA_ENABLED): OK");
}

main().catch((error) => {
  set(originales);
  console.error(error);
  process.exitCode = 1;
});
