/**
 * La guía de escena por el camino de Python de Kagutsuchi (`FLUX_GENERATION_PYTHON_ENABLED=true`, que se lee al
 * cargar el módulo: por eso este archivo aparte fija el entorno antes de importar). Lo que TypeScript le manda a
 * Python con la guía: `mode: "edit"`, la guía como ÚNICA `image_data_urls`, ningún byte de la foto de referencia
 * y la nota después del caption.
 *
 * Determinista y sin red. Run: npx tsx --conditions=react-server scripts/test/test-guia-escena-python.ts
 */
import assert from "node:assert/strict";
import { CAPTION_DE_PRUEBA, capturarPeticion, imagenDePrueba, FLUX_DE_PRUEBA } from "../lib/capturar-peticion-flux";

process.env.FLUX_GENERATION_PYTHON_ENABLED = "true";
process.env.PYTHON_BACKEND_URL = "http://python.test";
process.env.INTERNAL_HMAC_SECRET = "local-only-secret-0123456789abcdef";

const FOTO_REFERENCIA = Buffer.from("FOTO-DEL-CLIENTE-NO-SALE-".repeat(40)).toString("base64");

async function main(): Promise<void> {
  const { configurarPersistenciaTelemetria } = await import("@sempertex/agente-core");
  const { generarConSempertexFlux, NOTA_GUIA_ESCENA } = await import("@/lib/ia/kagutsuchi/flux");
  configurarPersistenciaTelemetria(undefined);
  const guia = { id: "SCENE_GUIDE", role: "scene_guide" as const, base64: Buffer.from("PNG-DE-LA-GUIA").toString("base64"), mime: "image/png" };
  const referencia = imagenDePrueba("composition_reference", 2, "REF_01", FOTO_REFERENCIA);
  for (const loras of [[], [FLUX_DE_PRUEBA]]) {
    const capturada = await capturarPeticion(generarConSempertexFlux, CAPTION_DE_PRUEBA, "3:2", [referencia], { loras, seed: 3, imagenesEdit: [guia] });
    const cuerpo = capturada.cuerpo as { mode: string; prompt: string; image_data_urls: string[] };
    assert.equal(capturada.destino, "/internal/v1/ia/lora-generate");
    assert.equal(cuerpo.mode, "edit");
    assert.deepEqual(cuerpo.image_data_urls, [`data:image/png;base64,${guia.base64}`]);
    assert.ok(!JSON.stringify(cuerpo).includes(FOTO_REFERENCIA), "ningún byte de la foto de referencia sale hacia Python ni fal");
    assert.ok(cuerpo.prompt.endsWith(`\n\n${NOTA_GUIA_ESCENA}`));
    assert.ok(cuerpo.prompt.indexOf("organic balloon garland") < cuerpo.prompt.indexOf(NOTA_GUIA_ESCENA), "el caption va antes de la nota");
  }
  console.log("[PASS] Python con guía de escena: mode edit, la guía como única imagen, sin la foto y con la nota al final");
}

main().catch((error: unknown) => {
  console.error("[FAIL] guía de escena por Python", error);
  process.exitCode = 1;
});
