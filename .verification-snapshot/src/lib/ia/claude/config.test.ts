import assert from "node:assert/strict";
import test from "node:test";
import { ErrorIA } from "@sempertex/agente-core";
import { claudeLocalPermitido, configClaudeLocal, MODELO_CLAUDE_CLI_POR_DEFECTO, MODELO_CLAUDE_POR_DEFECTO } from "./config";
import { costeClaudeUsd } from "./precios";

const LOCAL = { NODE_ENV: "development", IA_PROVEEDOR: "claude", ANTHROPIC_API_KEY: "sk-ant-prueba-no-real" } as const;

test("Claude solo se permite en local, con IA_PROVEEDOR=claude y la llave", () => {
  assert.equal(claudeLocalPermitido(LOCAL), true);
  assert.equal(claudeLocalPermitido({ ...LOCAL, NODE_ENV: undefined }), false, "sin NODE_ENV no se supone local: un script lo pone explícito");
  assert.equal(claudeLocalPermitido({ ...LOCAL, NODE_ENV: "test" }), false, "solo development");
  assert.equal(claudeLocalPermitido({ ...LOCAL, VERCEL: "1" }), false, "nunca en Vercel");
  assert.equal(claudeLocalPermitido({ ...LOCAL, NODE_ENV: "production" }), false, "nunca con NODE_ENV=production (VPS, next start local)");
  assert.equal(claudeLocalPermitido({ ...LOCAL, IA_PROVEEDOR: "gemini" }), false, "hace falta pedirlo explícitamente");
  assert.equal(claudeLocalPermitido({ ...LOCAL, IA_PROVEEDOR: undefined }), false);
  assert.equal(claudeLocalPermitido({ ...LOCAL, ANTHROPIC_API_KEY: "  " }), false, "sin llave no hay proveedor");
});

test("la configuración: Haiku 5.5 y esfuerzo medium por defecto; IA_LOCAL_ESFUERZO y el apagado del razonamiento", () => {
  assert.deepEqual(configClaudeLocal(LOCAL), { transporte: "api", apiKey: LOCAL.ANTHROPIC_API_KEY, modelo: MODELO_CLAUDE_POR_DEFECTO, esfuerzo: "medium", pensamiento: true, maxTokens: 16_000 });
  assert.equal(MODELO_CLAUDE_POR_DEFECTO, "claude-haiku-5-5");
  assert.equal(configClaudeLocal({ ...LOCAL, IA_LOCAL_ESFUERZO: "high" }).esfuerzo, "high");
  assert.equal(configClaudeLocal({ ...LOCAL, IA_LOCAL_ESFUERZO: "" }).esfuerzo, "medium", "vacía = por defecto");
  assert.equal(configClaudeLocal({ ...LOCAL, IA_LOCAL_PENSAMIENTO: "off" }).pensamiento, false);
  assert.equal(configClaudeLocal({ ...LOCAL, ANTHROPIC_CHAT_MODEL: "claude-haiku-4-5" }).modelo, "claude-haiku-4-5");
});

const CLI = { NODE_ENV: "development", IA_PROVEEDOR: "claude", IA_CLAUDE_TRANSPORTE: "cli" } as const;

test("transporte cli: sin llave, el mismo candado de local, el alias haiku y esfuerzo low por defecto", () => {
  assert.equal(claudeLocalPermitido(CLI), true, "sin ANTHROPIC_API_KEY");
  for (const fuera of [{ ...CLI, NODE_ENV: "production" }, { ...CLI, VERCEL: "1" }, { ...CLI, NODE_ENV: undefined }, { ...CLI, NODE_ENV: "test" }, { ...CLI, IA_PROVEEDOR: "gemini" }]) {
    assert.equal(claudeLocalPermitido(fuera), false, JSON.stringify(fuera));
    assert.throws(() => configClaudeLocal(fuera), (error: unknown) => error instanceof ErrorIA && error.causa === "sin_llave" && !error.reintentable);
  }
  assert.deepEqual(configClaudeLocal(CLI), { transporte: "cli", modelo: MODELO_CLAUDE_CLI_POR_DEFECTO, esfuerzo: "low", pensamiento: true, maxTokens: 16_000 });
  assert.equal(configClaudeLocal({ ...CLI, IA_LOCAL_ESFUERZO: "medium" }).esfuerzo, "medium", "IA_LOCAL_ESFUERZO lo cambia");
  assert.equal(configClaudeLocal(LOCAL).esfuerzo, "medium", "con la API sigue medium por defecto");
  assert.equal(MODELO_CLAUDE_CLI_POR_DEFECTO, "haiku");
  assert.equal(configClaudeLocal({ ...CLI, IA_CLAUDE_TRANSPORTE: " CLI " }).transporte, "cli", "sin distinguir mayúsculas ni espacios");
  assert.equal(configClaudeLocal({ ...CLI, ANTHROPIC_API_KEY: "sk-ant-prueba-no-real" }).transporte, "cli", "con llave y cli explícito gana cli");
  assert.equal(configClaudeLocal({ ...CLI, IA_LOCAL_ESFUERZO: "low" }).esfuerzo, "low");
  assert.equal(configClaudeLocal({ ...LOCAL, IA_CLAUDE_TRANSPORTE: "" }).transporte, "api", "vacía = api");
  assert.throws(() => configClaudeLocal({ ...LOCAL, IA_CLAUDE_TRANSPORTE: "ssh" }), (error: unknown) => error instanceof ErrorIA && /IA_CLAUDE_TRANSPORTE/.test(error.message));
});

test("fuera de local o con una variable inválida lanza ErrorIA sin filtrar valores", () => {
  for (const entorno of [{ ...LOCAL, VERCEL: "1" }, { ...LOCAL, NODE_ENV: "production" }, { ...LOCAL, NODE_ENV: undefined }]) {
    assert.throws(() => configClaudeLocal(entorno), (error: unknown) => error instanceof ErrorIA && error.proveedor === "claude" && !error.reintentable);
  }
  assert.throws(() => configClaudeLocal({ ...LOCAL, IA_LOCAL_ESFUERZO: "maximo-secreto" }),
    (error: unknown) => error instanceof ErrorIA && /IA_LOCAL_ESFUERZO/.test(error.message) && !error.message.includes("maximo-secreto") && !error.message.includes(LOCAL.ANTHROPIC_API_KEY));
});

test("precio de Haiku 5.5 (US$/MTok): 0,10 entrada, 0,50 salida, 0,125 escritura y 0,01 lectura de caché; 5x pasando 100 000 tokens de prompt", () => {
  const normal = costeClaudeUsd("claude-haiku-5-5", { input_tokens: 50_000, output_tokens: 50_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
  assert.ok(Math.abs(normal! - 0.03) < 1e-15, String(normal));
  const conCache = costeClaudeUsd("claude-haiku-5-5", { input_tokens: 10_000, output_tokens: 2_000, cache_creation_input_tokens: 40_000, cache_read_input_tokens: 40_000 });
  assert.ok(Math.abs(conCache! - (10_000 * 0.10 + 40_000 * 0.125 + 40_000 * 0.01 + 2_000 * 0.50) / 1e6) < 1e-15);
  const largo = costeClaudeUsd("claude-haiku-5-5", { input_tokens: 60_000, output_tokens: 1_000, cache_read_input_tokens: 50_000 });
  assert.ok(Math.abs(largo! - (60_000 * 0.50 + 50_000 * 0.05 + 1_000 * 2.50) / 1e6) < 1e-15, "el prompt pasa de 100 000: toda la petición con la tarifa larga");
  assert.equal(costeClaudeUsd("modelo-sin-precio", { input_tokens: 1, output_tokens: 1 }), undefined);
});
