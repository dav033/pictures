/**
 * La guía de estructura (ADR-0033) por el camino de Python de Kagutsuchi
 * (`FLUX_GENERATION_PYTHON_ENABLED=true`, que se lee al cargar el módulo: por
 * eso este archivo aparte fija el entorno antes de importar). Python ya acepta
 * `mode: "edit"` con hasta cuatro `image_data_urls` bajo el tope de 11 MB de la
 * ruta, así que no cambia: aquí se comprueba lo que TypeScript le manda.
 *
 * - Sin guía: el cuerpo de la operación es byte a byte el de 90da1ef
 *   (`scripts/fixtures/guia-estructura/peticiones-base.json`, `python`).
 * - Con guía: `mode: "edit"` e `image_data_urls[0]` = guía, la carta después.
 * - El filtro arreglado vale igual por este camino.
 *
 * Determinista y sin red. Run: npx tsx --conditions=react-server scripts/test/test-guia-estructura-python.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CAPTION_DE_PRUEBA, capturarPeticion, casosBase, FLUX_DE_PRUEBA, type PeticionCapturada } from "../lib/capturar-peticion-flux";

process.env.FLUX_GENERATION_PYTHON_ENABLED = "true";
process.env.PYTHON_BACKEND_URL = "http://python.test";
process.env.INTERNAL_HMAC_SECRET = "local-only-secret-0123456789abcdef";

const BASE = JSON.parse(readFileSync(path.join("scripts", "fixtures", "guia-estructura", "peticiones-base.json"), "utf8")) as { python: Record<string, PeticionCapturada> };

async function main(): Promise<void> {
  const { configurarPersistenciaTelemetria } = await import("@sempertex/agente-core");
  const { generarConSempertexFlux, NOTA_GUIA_ESTRUCTURA } = await import("@/lib/ia/kagutsuchi/flux");
  const { prepararGuiaEstructura } = await import("@/lib/ia/kagutsuchi/rasterizar-guia");
  const { casoArcoPatron } = await import("../lib/escenas-guia-estructura");
  configurarPersistenciaTelemetria(undefined);
  const opciones = { loras: [FLUX_DE_PRUEBA], seed: 101, guidanceScale: 3.5 };

  for (const [nombre, inputs] of Object.entries(casosBase())) {
    const esperado = BASE.python[nombre];
    assert.ok(esperado, `la instantánea no tiene ${nombre}`);
    const capturada = await capturarPeticion(generarConSempertexFlux, CAPTION_DE_PRUEBA, "3:2", inputs, opciones);
    assert.equal(capturada.destino, "/internal/v1/ia/lora-generate");
    assert.equal(JSON.stringify(capturada.cuerpo), JSON.stringify(esperado.cuerpo), `${nombre}: la operación cambió respecto a 90da1ef`);
  }
  console.log("[PASS] Python sin guía: la operación es byte a byte la de 90da1ef");

  const guia = (await prepararGuiaEstructura(casoArcoPatron().plan, "3:2"))!;
  const conGuia = await capturarPeticion(generarConSempertexFlux, CAPTION_DE_PRUEBA, "3:2", [], { ...opciones, imagenesEdit: guia.imagenes });
  const cuerpo = conGuia.cuerpo as { mode: string; prompt: string; image_data_urls: string[] };
  assert.equal(cuerpo.mode, "edit");
  assert.deepEqual(cuerpo.image_data_urls, guia.imagenes.map((imagen) => `data:image/png;base64,${imagen.base64}`), "image_data_urls[0] es la guía");
  assert.ok(cuerpo.prompt.startsWith(`eventdecor_style_v3, ${NOTA_GUIA_ESTRUCTURA}`));
  const referencias = casosBase()["referencias-hibrido"]!;
  const elegidas = await capturarPeticion(generarConSempertexFlux, CAPTION_DE_PRUEBA, "3:2", [], { ...opciones, imagenesEdit: referencias });
  assert.equal((elegidas.cuerpo as { mode: string }).mode, "edit", "las referencias elegidas llegan también por Python");
  console.log("[PASS] Python con guía: mode edit, image_data_urls[0] = guía y la carta después");
}

main().catch((error: unknown) => {
  console.error("[FAIL] guía de estructura por Python", error);
  process.exitCode = 1;
});
