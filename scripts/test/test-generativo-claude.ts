/**
 * W5: con Claude activo en local, los llamadores de una sola pasada (lectura de la foto 3D, detección de globos y fondos,
 * parser de intención, intérprete de módulos, resumen del feedback, traducción de la revisión) hablan con Claude y no con
 * Gemini. Sin red ni coste (un `fetch` de mentira para api.anthropic.com; cualquier llamada a Gemini hace fallar):
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-generativo-claude.ts
 * Comprueba la traducción de `comoClienteGemini`: imagen como bloque de imagen, esquema JSON como herramienta forzada
 * (envuelto si no es objeto) sin razonamiento ni temperatura, texto libre con razonamiento, el reintento de la lectura
 * como turno del asistente, y las filas de telemetría con proveedor anthropic.
 */
import assert from "node:assert/strict";
import sharp from "sharp";
import type { CuerpoMensajes } from "../../src/lib/ia/claude/tipos";

Object.assign(process.env, { NODE_ENV: "development", IA_PROVEEDOR: "claude", ANTHROPIC_API_KEY: "sk-ant-prueba-no-real", GEMINI_API_KEY: "clave-gemini-de-prueba" });
for (const variable of ["VERCEL", "INTENT_PARSER_PYTHON_ENABLED", "IA_LOCAL_ESFUERZO", "IA_LOCAL_PENSAMIENTO", "ANTHROPIC_CHAT_MODEL"]) Reflect.deleteProperty(process.env, variable);

type Respuesta = { herramienta?: unknown; texto?: string };
const peticiones: CuerpoMensajes[] = [];
const aGemini: string[] = [];
let responder: (cuerpo: CuerpoMensajes) => Respuesta = () => ({ texto: "" });
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  if (!url.startsWith("https://api.anthropic.com/")) {
    aGemini.push(url);
    throw new Error(`no debía salir de Claude: ${url}`);
  }
  const cuerpo = JSON.parse(String(init?.body)) as CuerpoMensajes;
  peticiones.push(cuerpo);
  const r = responder(cuerpo);
  const forzada = cuerpo.tool_choice?.type === "tool" ? cuerpo.tool_choice.name : null;
  const content = forzada && r.herramienta !== undefined ? [{ type: "tool_use", id: `toolu_${peticiones.length}`, name: forzada, input: r.herramienta }] : [{ type: "text", text: r.texto ?? "" }];
  const mensaje = { id: `msg_${peticiones.length}`, type: "message", role: "assistant", model: "claude-haiku-5-5", content, stop_reason: forzada ? "tool_use" : "end_turn", usage: { input_tokens: 1200, output_tokens: 80 } };
  return new Response(JSON.stringify(mensaje), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

let pruebas = 0;
const prueba = async (nombre: string, fn: () => Promise<void>) => {
  peticiones.length = 0;
  aGemini.length = 0;
  await fn();
  assert.deepEqual(aGemini, [], "ninguna llamada a Gemini");
  pruebas += 1;
  console.log(`  ✓ ${nombre}`);
};
const esquemaForzado = (cuerpo: CuerpoMensajes) => {
  assert.equal(cuerpo.tool_choice?.type, "tool");
  assert.deepEqual(cuerpo.thinking, { type: "disabled" }, "herramienta forzada sin razonamiento");
  assert.equal(cuerpo.tools?.length, 1);
  return cuerpo.tools![0]!.input_schema;
};

async function main() {
  const { configurarPersistenciaTelemetria, ultimosEventos } = await import("@sempertex/agente-core");
  const { leerFotoConIA, ErrorLecturaFoto } = await import("@/lib/globos3d/leer-foto-ia");
  const { detectarGlobos } = await import("@/lib/globos3d/detectar-globos-ia");
  const { interpretarConsulta } = await import("@/lib/ia/inari/parse");
  const { interpretarPedido } = await import("@/lib/modulos-estudio/interpretar-ia");
  const { resumirConGemini } = await import("@/lib/feedback-ia/resumen-gemini");
  const { traducirRevisionConModelo } = await import("@/lib/ia/kagutsuchi/traducir-revision-modelo");
  configurarPersistenciaTelemetria(undefined);

  const jpeg = await sharp({ create: { width: 480, height: 360, channels: 3, background: { r: 210, g: 60, b: 120 } } }).jpeg({ quality: 85 }).toBuffer();
  const foto = { bytes: new Uint8Array(jpeg), mime: "image/jpeg" };

  await prueba("lectura de la foto 3D: la foto como bloque de imagen, el esquema como herramienta forzada y el reintento como turno del asistente", async () => {
    responder = () => ({ herramienta: { piezas: "no es una lista" } });
    await assert.rejects(leerFotoConIA(foto, { superficie: "prueba" }), (error: unknown) => error instanceof ErrorLecturaFoto);
    assert.equal(peticiones.length, 2, "la lectura inválida se reintenta una vez, como con Gemini");
    const [primera, segunda] = peticiones as [CuerpoMensajes, CuerpoMensajes];
    assert.equal(primera.messages.length, 1);
    assert.deepEqual(primera.messages[0]!.content.map((b) => b.type), ["image", "text"]);
    assert.equal((primera.messages[0]!.content[0] as { source: { media_type: string; data: string } }).source.data, Buffer.from(jpeg).toString("base64"));
    assert.equal(esquemaForzado(primera).type, "object");
    assert.ok(primera.system?.[0]?.text.length, "el prompt de la lectura va como sistema");
    assert.equal("temperature" in primera, false);
    assert.equal(primera.max_tokens, 12_000);
    assert.deepEqual(segunda.messages.map((m) => m.role), ["user", "assistant", "user"]);
    assert.match(String((segunda.messages[2]!.content[0] as { text: string }).text), /no cumple el esquema/);
    const filas = ultimosEventos().slice(0, 2);
    assert.ok(filas.every((f) => f.proveedor === "anthropic" && f.modelo === "claude-haiku-5-5" && f.thinkingLevel === "medium"), JSON.stringify(filas.map((f) => [f.proveedor, f.modelo])));
  });

  await prueba("detección de globos y fondos: lista JSON envuelta en «resultado» y desenvuelta al volver; coste con precios de Claude", async () => {
    responder = (cuerpo) => ({ herramienta: { resultado: (cuerpo.tools![0]!.input_schema as { properties: { resultado: { items: { properties: Record<string, unknown> } } } }).properties.resultado.items.properties.color ? [{ box_2d: [400, 400, 600, 600], color: "rojo" }] : [] } });
    const deteccion = await detectarGlobos(foto, { superficie: "prueba" });
    assert.equal(peticiones.length, 10, "9 trozos y los fondos");
    for (const cuerpo of peticiones) {
      const esquema = esquemaForzado(cuerpo);
      assert.deepEqual(esquema.required, ["resultado"]);
      assert.equal((esquema.properties as { resultado: { type: string } }).resultado.type, "array");
      assert.equal(cuerpo.messages[0]!.content[0]!.type, "image");
    }
    assert.ok(deteccion.globos.length > 0, "las cajas de Claude llegan a la detección");
    assert.ok(deteccion.costeEstimadoUsd < 0.01);
  });

  await prueba("parser de intención: la consulta ambigua va a Claude (el Python, que solo habla con Gemini, se salta)", async () => {
    responder = () => ({ herramienta: {} });
    await interpretarConsulta("algo bonito para una fiesta", { superficie: "prueba" });
    assert.equal(peticiones.length, 1);
    assert.equal(esquemaForzado(peticiones[0]!).type, "object");
    assert.equal(ultimosEventos()[0]!.proveedor, "anthropic");
  });

  await prueba("intérprete de módulos: el pedido va a Claude con su esquema; una salida inválida sigue siendo «invalida»", async () => {
    responder = () => ({ herramienta: { cosa: 1 } });
    await assert.rejects(interpretarPedido("dúo de reflex rojo con azul mate"), (error: unknown) => (error as { causa?: string }).causa === "invalida");
    assert.equal(peticiones.length, 1);
    assert.equal(peticiones[0]!.max_tokens, 800);
    esquemaForzado(peticiones[0]!);
  });

  await prueba("resumen del feedback: texto libre con razonamiento adaptativo y el modelo de Claude en el resultado", async () => {
    responder = () => ({ texto: "Tres huecos: colores, tamaños y honestidad." });
    const resumen = await resumirConGemini({ totalTurnos: 3, totalCalificados: 2, promedio: 6.5, metricas: { deshechos: 1, porMotivo: [], porProducto: [], porHerramienta: [], frases: [], peores: [] } } as unknown as Parameters<typeof resumirConGemini>[0], 30);
    assert.equal(resumen?.modelo, "claude-haiku-5-5");
    assert.equal(resumen?.texto, "Tres huecos: colores, tamaños y honestidad.");
    assert.ok(resumen!.costeUsd < 0.001, `coste con precios de Claude: ${resumen!.costeUsd}`);
    assert.equal(peticiones[0]!.tools, undefined);
    assert.deepEqual(peticiones[0]!.thinking, { type: "adaptive" });
    assert.equal(peticiones[0]!.max_tokens, 1800);
  });

  await prueba("traducción de la revisión: el sistema en inglés y el texto del usuario", async () => {
    responder = () => ({ texto: "make the arch gold" });
    assert.equal(await traducirRevisionConModelo("haz el arco dorado"), "make the arch gold");
    assert.match(peticiones[0]!.system![0]!.text, /^Translate the user's requested image edit/);
    assert.deepEqual(peticiones[0]!.messages, [{ role: "user", content: [{ type: "text", text: "haz el arco dorado" }] }]);
  });

  await prueba("parámetros de Gemini que no se traducen (tools, toolConfig, responseModalities, responseSchema, otros) lanzan antes de llamar", async () => {
    const { comoClienteGemini } = await import("@/lib/ia/claude/como-gemini");
    const { crearClienteAnthropic } = await import("@/lib/ia/claude/cliente");
    const generativo = comoClienteGemini(crearClienteAnthropic({ apiKey: "x" }), { apiKey: "x", modelo: "claude-haiku-5-5", esfuerzo: "medium", pensamiento: true, maxTokens: 16_000 });
    const base = { model: "claude-haiku-5-5", contents: [{ role: "user", parts: [{ text: "hola" }] }] };
    for (const config of [{ tools: [{ functionDeclarations: [] }] }, { toolConfig: {} }, { responseModalities: ["IMAGE"] }, { responseSchema: { type: "OBJECT" } }, { topP: 0.5 }, { responseMimeType: "text/x.enum" }]) {
      await assert.rejects(generativo.models.generateContent({ ...base, config } as Parameters<typeof generativo.models.generateContent>[0]), /Claude local no traduce/, JSON.stringify(config));
    }
    assert.equal(peticiones.length, 0, "no salió ninguna petición");
    responder = () => ({ texto: "ok" });
    assert.equal((await generativo.models.generateContent({ ...base, config: { temperature: 0.2, thinkingConfig: {}, maxOutputTokens: 100, responseMimeType: "text/plain" } })).text, "ok", "lo admitido sí pasa");
  });

  console.log(`\ntest-generativo-claude: ${pruebas} pruebas ok`);
}

void main()
  .catch((error: unknown) => { console.error(error); process.exitCode = 1; })
  .finally(() => { globalThis.fetch = fetchOriginal; });
