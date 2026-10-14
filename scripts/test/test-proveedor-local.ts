/**
 * W5 (T16): Claude solo existe en local y lo hace cumplir el código. Sin red ni coste:
 *   npx tsx --conditions=react-server scripts/test/test-proveedor-local.ts
 * - la matriz completa de entornos (VERCEL, NODE_ENV, IA_PROVEEDOR, llave, transporte): solo
 *   `!VERCEL && NODE_ENV=development && IA_PROVEEDOR=claude` resuelve Claude, y el resolver no lo entrega por ningún otro camino;
 * - modelo (IA_LOCAL_MODELO / ANTHROPIC_CHAT_MODEL, por defecto claude-haiku-5-5) y esfuerzo (low|medium|high, por defecto medium;
 *   un valor inválido lanza sin imprimir el valor);
 * - override del cuerpo, cookie y ajuste global: fuera de local no alcanzan a Claude, y las rutas que leen la cookie solo
 *   aceptan «gemini»; /api/escena-ia ni siquiera lee un proveedor del cuerpo.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ErrorIA } from "@sempertex/agente-core";
import { claudeLocalPermitido, configClaudeLocal, MODELO_CLAUDE_POR_DEFECTO } from "../../src/lib/ia/claude/config";
import { chatDe, chatLecturaFotoDe, proveedoresDisponibles, resolverProveedor } from "../../src/lib/ia/nucleo/registro";
import { destinoGenerativo } from "../../src/lib/ia/nucleo/cliente-generativo";
import { getClaudeClient } from "../../src/lib/claude";
import { modeloEscenaIADe } from "../../src/lib/globos3d/modelo-escena/crear-modelo";

let pruebas = 0;
const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const VARIABLES = ["NODE_ENV", "VERCEL", "IA_PROVEEDOR", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "IA_LOCAL_ESFUERZO", "IA_LOCAL_PENSAMIENTO", "ANTHROPIC_CHAT_MODEL", "IA_CLAUDE_TRANSPORTE"] as const;
type Variable = (typeof VARIABLES)[number];
const original = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]));
function entorno(valores: Partial<Record<Variable, string | undefined>>): void {
  for (const variable of VARIABLES) Reflect.deleteProperty(process.env, variable);
  Object.assign(process.env, Object.fromEntries(Object.entries(valores).filter(([, v]) => v !== undefined)));
}

const LOCAL = { NODE_ENV: "development", IA_PROVEEDOR: "claude", ANTHROPIC_API_KEY: "sk-ant-prueba-no-real", GEMINI_API_KEY: "clave-gemini-de-prueba" } as const;
const NODE_ENVS = [undefined, "development", "test", "production"] as const;
const PROVEEDORES = [undefined, "", "gemini", "claude", "CLAUDE"] as const;
const VERCELS = [undefined, "1"] as const;
const TRANSPORTES = [undefined, "api", "cli"] as const;
const LLAVES = [undefined, "  ", "sk-ant-prueba-no-real"] as const;
const leer = (archivo: string) => readFileSync(path.join(__dirname, "..", "..", archivo), "utf8");

async function main() {
  console.log("Matriz de entornos");
  await prueba("Claude se permite exactamente cuando !VERCEL && NODE_ENV=development && IA_PROVEEDOR=claude (con llave o transporte cli)", () => {
    let permitidos = 0;
    let total = 0;
    for (const nodeEnv of NODE_ENVS) for (const proveedor of PROVEEDORES) for (const vercel of VERCELS) for (const transporte of TRANSPORTES) for (const llave of LLAVES) {
      const valores: Partial<Record<Variable, string>> = { GEMINI_API_KEY: "g" };
      if (nodeEnv) valores.NODE_ENV = nodeEnv;
      if (proveedor !== undefined) valores.IA_PROVEEDOR = proveedor;
      if (vercel) valores.VERCEL = vercel;
      if (transporte) valores.IA_CLAUDE_TRANSPORTE = transporte;
      if (llave !== undefined) valores.ANTHROPIC_API_KEY = llave;
      const esperado = !vercel && nodeEnv === "development" && proveedor === "claude" && (transporte === "cli" || Boolean(llave?.trim()));
      entorno(valores);
      const etiqueta = JSON.stringify(valores);
      assert.equal(claudeLocalPermitido(), esperado, etiqueta);
      assert.equal(proveedoresDisponibles().includes("claude"), esperado, etiqueta);
      assert.equal(destinoGenerativo().proveedor, esperado ? "claude" : "gemini", etiqueta);
      assert.equal(resolverProveedor({ override: "claude", cookie: "claude" }) === "claude", esperado, etiqueta);
      assert.equal(getClaudeClient("prueba") !== null, esperado, etiqueta);
      assert.equal(modeloEscenaIADe("claude") !== null, esperado, etiqueta);
      if (esperado) permitidos += 1;
      total += 1;
    }
    assert.ok(permitidos > 0 && permitidos < total, `${permitidos} de ${total}`);
  });

  console.log("Caminos que intentan forzarlo");
  for (const [nombre, valores] of [
    ["producción (VPS / next start)", { ...LOCAL, NODE_ENV: "production" }],
    ["Vercel", { ...LOCAL, VERCEL: "1" }],
    ["Vercel en producción", { ...LOCAL, VERCEL: "1", NODE_ENV: "production" }],
    ["sin NODE_ENV", { ...LOCAL, NODE_ENV: undefined }],
    ["IA_PROVEEDOR=gemini", { ...LOCAL, IA_PROVEEDOR: "gemini" }],
  ] as const) {
    await prueba(`${nombre}: override del cuerpo, cookie, IA_PROVEEDOR y pedirlo a mano no devuelven Claude`, async () => {
      entorno(valores);
      assert.deepEqual(proveedoresDisponibles(), ["gemini"]);
      for (const pistas of [{}, { override: "claude" }, { cookie: "claude" }, { override: "claude", cookie: "claude" }]) assert.equal(resolverProveedor(pistas), "gemini");
      const sinLlave = (e: unknown) => e instanceof ErrorIA && e.proveedor === "claude" && e.causa === "sin_llave" && !e.reintentable && !e.message.includes("sk-ant-prueba-no-real");
      await assert.rejects(chatDe("claude"), sinLlave);
      await assert.rejects(chatLecturaFotoDe("claude"), sinLlave);
      assert.throws(() => configClaudeLocal(), sinLlave);
    });
  }
  await prueba("sin llave de Gemini, pedir Claude fuera de local falla cerrado (sin_llave), no cae en Claude", () => {
    entorno({ ...LOCAL, NODE_ENV: "production", GEMINI_API_KEY: undefined });
    assert.throws(() => resolverProveedor({ override: "claude" }), (e: unknown) => e instanceof ErrorIA && e.causa === "sin_llave");
  });

  console.log("Modelo y esfuerzo");
  await prueba("por defecto claude-haiku-5-5 con esfuerzo medium; ANTHROPIC_CHAT_MODEL e IA_LOCAL_ESFUERZO lo cambian", () => {
    entorno(LOCAL);
    const base = configClaudeLocal();
    assert.equal(MODELO_CLAUDE_POR_DEFECTO, "claude-haiku-5-5");
    assert.equal(base.modelo, "claude-haiku-5-5");
    assert.equal(base.esfuerzo, "medium");
    for (const esfuerzo of ["low", "medium", "high"] as const) {
      entorno({ ...LOCAL, IA_LOCAL_ESFUERZO: esfuerzo });
      assert.equal(configClaudeLocal().esfuerzo, esfuerzo);
    }
    entorno({ ...LOCAL, ANTHROPIC_CHAT_MODEL: "claude-haiku-4-5" });
    assert.equal(configClaudeLocal().modelo, "claude-haiku-4-5");
  });
  await prueba("un esfuerzo o un pensamiento inválido lanza un ErrorIA que nombra la variable y no el valor", () => {
    for (const [variable, valor] of [["IA_LOCAL_ESFUERZO", "extremo-secreto"], ["IA_LOCAL_PENSAMIENTO", "tal-vez"]] as const) {
      entorno({ ...LOCAL, [variable]: valor });
      assert.throws(() => configClaudeLocal(), (e: unknown) => e instanceof ErrorIA && !e.reintentable && e.message.includes(variable) && !e.message.includes(valor));
    }
  });

  console.log("Las rutas");
  await prueba("las rutas que leen la cookie solo aceptan «gemini»; /api/escena-ia no lee proveedor del cuerpo y usa el destino por entorno", () => {
    for (const ruta of ["src/app/api/generate/route.ts", "src/app/api/asistente-guiado/route.ts"]) {
      assert.match(leer(ruta), /ia_proveedor=\(gemini\)/, ruta);
    }
    const escena = leer("src/app/api/escena-ia/route.ts");
    assert.doesNotMatch(escena.slice(escena.indexOf("const CuerpoSchema"), escena.indexOf("const CuerpoSchema") + 700), /proveedor/);
    assert.match(escena, /modeloEscenaIADe\(destinoGenerativo\(\)\.proveedor\)/);
    assert.doesNotMatch(escena, /import[^;]*resolverProveedor/);
  });

  console.log(`\ntest-proveedor-local: ${pruebas} pruebas ok`);
}

void main()
  .catch((error: unknown) => { console.error(error); process.exitCode = 1; })
  .finally(() => {
    for (const [variable, valor] of Object.entries(original)) {
      if (valor === undefined) Reflect.deleteProperty(process.env, variable);
      else Object.assign(process.env, { [variable]: valor });
    }
  });
