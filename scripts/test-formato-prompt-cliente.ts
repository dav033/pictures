import assert from "node:assert/strict";
import { LORA_PROMPT_FORMATS } from "@/lib/ia/kagutsuchi/lora-prompt-format";
import {
  ETIQUETA_FORMATO_PROMPT,
  esSeleccionFormatoPrompt,
  FORMATO_PROMPT_AUTOMATICO,
  OPCIONES_FORMATO_PROMPT,
  promptFormatParaGenerar,
} from "@/lib/lora/formato-prompt-cliente";

/**
 * Selector del formato del prompt LoRA (iteración 3b, punto F). Contrato con
 * /api/generate: sin `promptFormat` el servidor resuelve por trigger; texto,
 * json y ambos explícitos siempre ganan.
 */

assert.equal(OPCIONES_FORMATO_PROMPT[0], FORMATO_PROMPT_AUTOMATICO, "Automático es la primera opción");
assert.deepEqual(OPCIONES_FORMATO_PROMPT.slice(1), [...LORA_PROMPT_FORMATS], "se mantienen Texto, JSON y Ambos");
assert.ok(Object.values(ETIQUETA_FORMATO_PROMPT).every((etiqueta) => !/experimental/i.test(etiqueta)));
console.log("[PASS] opciones: Automático, Texto, JSON y Ambos, sin 'experimental'");

assert.equal(promptFormatParaGenerar(FORMATO_PROMPT_AUTOMATICO, true), undefined, "Automático no envía promptFormat");
for (const formato of LORA_PROMPT_FORMATS) assert.equal(promptFormatParaGenerar(formato, true), formato, `${formato} se envía explícito`);
for (const seleccion of OPCIONES_FORMATO_PROMPT) assert.equal(promptFormatParaGenerar(seleccion, false), undefined, "sin LoRA no se envía formato");
assert.equal(JSON.stringify({ promptFormat: promptFormatParaGenerar(FORMATO_PROMPT_AUTOMATICO, true) }), "{}", "la clave desaparece del body JSON");
console.log("[PASS] promptFormat para /api/generate");

assert.equal(esSeleccionFormatoPrompt("json"), true);
assert.equal(esSeleccionFormatoPrompt("automatico"), true);
assert.equal(esSeleccionFormatoPrompt("yaml"), false);
console.log("[PASS] valores del selector validados");

console.log("\n3 casos OK (formato del prompt LoRA en el cliente)");
