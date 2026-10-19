/**
 * W5 (T34): la lectura de la foto con Claude (solo local), sin red ni coste: `fetch` simulado para api.anthropic.com;
 * cualquier otra salida (Gemini) hace fallar.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-lectura-foto-claude.ts
 * Fixture guardado: `scripts/test/fixtures/foto-quince/lectura-claude.json` (lo que Claude devolvió de verdad; la foto
 * no se guarda porque tiene personas, así que la imagen es un JPEG sintético normalizado con `normalizarFotoA`).
 * - la foto sale como bloque de imagen JPEG (el de `normalizar-foto`) antes del pedido, en base64 exacto;
 * - el MISMO esquema de salida que con Gemini (`esquemaLecturaParaGemini`) va como herramienta forzada, sin
 *   temperatura ni razonamiento;
 * - la respuesta (argumentos de la herramienta) pasa por la misma validación y compila a escena;
 * - una lectura inválida se reintenta una vez con el error a la vista; el coste usa los precios de Haiku;
 * - fuera de local la lectura no llama a Claude.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import type { CuerpoMensajes } from "../../src/lib/ia/claude/tipos";

Object.assign(process.env, { NODE_ENV: "development", IA_PROVEEDOR: "claude", ANTHROPIC_API_KEY: "sk-ant-prueba-no-real", GEMINI_API_KEY: "clave-gemini-de-prueba" });
for (const variable of ["VERCEL", "IA_LOCAL_ESFUERZO", "IA_LOCAL_PENSAMIENTO", "ANTHROPIC_CHAT_MODEL", "IA_CLAUDE_TRANSPORTE"]) Reflect.deleteProperty(process.env, variable);

const peticiones: CuerpoMensajes[] = [];
const fuera: string[] = [];
let respuestas: unknown[] = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  if (!url.startsWith("https://api.anthropic.com/")) {
    fuera.push(url);
    throw new Error(`no debía salir de Claude: ${url}`);
  }
  const cuerpo = JSON.parse(String(init?.body)) as CuerpoMensajes;
  peticiones.push(cuerpo);
  const herramienta = respuestas[Math.min(peticiones.length - 1, respuestas.length - 1)];
  const nombre = cuerpo.tool_choice?.type === "tool" ? cuerpo.tool_choice.name : "";
  const mensaje = { id: `msg_${peticiones.length}`, type: "message", role: "assistant", model: "claude-haiku-5-5", content: [{ type: "tool_use", id: `toolu_${peticiones.length}`, name: nombre, input: herramienta }], stop_reason: "tool_use", usage: { input_tokens: 3000, output_tokens: 700 } };
  return new Response(JSON.stringify(mensaje), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

let pruebas = 0;
const prueba = async (nombre: string, fn: () => Promise<void>) => {
  peticiones.length = 0;
  fuera.length = 0;
  await fn();
  assert.deepEqual(fuera, [], "ninguna llamada a Gemini");
  pruebas += 1;
  console.log(`  ✓ ${nombre}`);
};

async function main() {
  const { configurarPersistenciaTelemetria } = await import("@sempertex/agente-core");
  const { leerFotoConIA, esquemaLecturaParaGemini, ErrorLecturaFoto } = await import("../../src/lib/globos3d/leer-foto-ia");
  const { normalizarFotoA } = await import("../../src/lib/taller/normalizar-foto");
  const { LecturaFotoSchema } = await import("../../src/lib/globos3d/lectura-foto");
  const { compilarLectura } = await import("../../src/lib/globos3d/compilar-lectura");
  const { costeClaudeUsd } = await import("../../src/lib/ia/claude/precios");
  configurarPersistenciaTelemetria(undefined);

  const fixture: unknown = JSON.parse(readFileSync("scripts/test/fixtures/foto-quince/lectura-claude.json", "utf8"));
  const esperada = LecturaFotoSchema.parse(fixture);
  const original = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 210, g: 60, b: 120 } } }).png().toBuffer();
  const jpeg = await normalizarFotoA(new Uint8Array(original), 512);
  assert.deepEqual([...jpeg.slice(0, 3)], [0xff, 0xd8, 0xff], "normalizar-foto entrega un JPEG");
  const foto = { bytes: jpeg, mime: "image/jpeg" };

  await prueba("la foto va como bloque de imagen JPEG antes del pedido y el esquema como herramienta forzada, el mismo que con Gemini", async () => {
    respuestas = [fixture];
    const resultado = await leerFotoConIA(foto, { superficie: "prueba" });
    assert.equal(peticiones.length, 1);
    const cuerpo = peticiones[0]!;
    assert.equal(cuerpo.model, "claude-haiku-5-5");
    assert.deepEqual(cuerpo.messages.map((m) => m.role), ["user"]);
    const bloques = cuerpo.messages[0]!.content;
    assert.deepEqual(bloques.map((b) => b.type), ["image", "text"]);
    assert.deepEqual(bloques[0], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(jpeg).toString("base64") } });
    assert.equal(cuerpo.tool_choice?.type, "tool");
    assert.deepEqual(cuerpo.thinking, { type: "disabled" }, "herramienta forzada sin razonamiento");
    assert.equal("temperature" in cuerpo, false);
    assert.equal(cuerpo.tools?.length, 1);
    const esquema = cuerpo.tools![0]!.input_schema as Record<string, unknown>;
    const deGemini = esquemaLecturaParaGemini();
    assert.deepEqual(esquema.required, deGemini.required, "las mismas propiedades obligatorias");
    assert.deepEqual(Object.keys(esquema.properties as object).sort(), Object.keys(deGemini.properties as object).sort(), "las mismas propiedades");
    assert.ok(cuerpo.system?.[0]?.text.length, "el prompt de la lectura va como sistema");
    assert.deepEqual(resultado.lectura, esperada, "la salida pasa por la misma validación");
    assert.equal(resultado.intentos, 1);
    assert.equal(resultado.modelo, "claude-haiku-5-5");
    const costeEsperado = costeClaudeUsd("claude-haiku-5-5", { input_tokens: 3000, output_tokens: 700 })!;
    assert.ok(resultado.costeEstimadoUsd > 0 && Math.abs(resultado.costeEstimadoUsd - costeEsperado) < 1e-4, `coste ${resultado.costeEstimadoUsd} vs ${costeEsperado}`);
    assert.ok(compilarLectura(resultado.lectura).escena.nodos.length > 0, "la lectura compila a una escena");
  });

  await prueba("una lectura que no cumple el esquema se reintenta una vez con el error a la vista; si la segunda sirve, se usa", async () => {
    respuestas = [{ piezas: "no es una lista" }, fixture];
    const resultado = await leerFotoConIA(foto, { superficie: "prueba" });
    assert.equal(peticiones.length, 2);
    assert.deepEqual(peticiones[1]!.messages.map((m) => m.role), ["user", "assistant", "user"]);
    assert.match(String((peticiones[1]!.messages[2]!.content[0] as { text: string }).text), /no cumple el esquema/);
    assert.equal(resultado.intentos, 2);
    assert.deepEqual(resultado.lectura, esperada);
  });

  await prueba("dos lecturas inválidas lanzan ErrorLecturaFoto (no se inventa una lectura)", async () => {
    respuestas = [{ piezas: "no es una lista" }];
    await assert.rejects(leerFotoConIA(foto, { superficie: "prueba" }), (e: unknown) => e instanceof ErrorLecturaFoto);
    assert.equal(peticiones.length, 2);
  });

  // Fuera de local la lectura va a Gemini: el fetch simulado la rechaza (sin red) y lo que se prueba es adónde intentó salir.
  peticiones.length = 0;
  fuera.length = 0;
  Object.assign(process.env, { NODE_ENV: "production" });
  try {
    respuestas = [fixture];
    await assert.rejects(leerFotoConIA(foto, { superficie: "prueba" }));
  } finally {
    Object.assign(process.env, { NODE_ENV: "development" });
  }
  assert.equal(peticiones.length, 0, "ninguna petición a Anthropic fuera de local");
  assert.ok(fuera.every((url) => url.includes("generativelanguage.googleapis.com")) && fuera.length > 0, `salió a ${fuera.join(", ")}`);
  pruebas += 1;
  console.log("  ✓ fuera de local (NODE_ENV=production) la lectura no llama a Claude: intenta Gemini");

  console.log(`\ntest-lectura-foto-claude: ${pruebas} pruebas ok`);
}

void main()
  .catch((error: unknown) => { console.error(error); process.exitCode = 1; })
  .finally(() => { globalThis.fetch = fetchOriginal; });
