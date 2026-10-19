/**
 * W5: los llamadores que hablaban con Gemini directo (lectura de la foto 3D, detección de globos, fondos y racimos, parser
 * de intención, intérprete de módulos, resumen del feedback, traducción de la revisión) ahora piden su cliente al registro
 * (`clienteGenerativoDe`) para correr en Claude cuando está activo en local. Con Gemini (producción) la petición REST que
 * sale tiene que ser BYTE A BYTE la de antes: esta prueba la intercepta con un `fetch` de mentira (sin red ni coste) y
 * compara su sha256 con la foto dorada sacada del código de main (b4433bc9), en `dorado/peticiones-gemini-directas.json`.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-peticiones-gemini-directas.ts
 *   ... --escribir   (solo si el cambio de la petición es lo que se quería: se revisa el diff del JSON)
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const RUTA = new URL("./dorado/peticiones-gemini-directas.json", import.meta.url);
const ESCRIBIR = process.argv.includes("--escribir");

for (const variable of ["IA_PROVEEDOR", "ANTHROPIC_API_KEY", "VERCEL", "INTENT_PARSER_PYTHON_ENABLED"]) Reflect.deleteProperty(process.env, variable);
process.env.GEMINI_API_KEY = "clave-de-prueba-sin-red";

type Foto = Record<string, { sha256: string[]; bytes: number[] }>;
const capturas: Array<{ url: string; cuerpo: string }> = [];
let respuestaTexto = "{}";
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  if (!url.includes("generativelanguage.googleapis.com")) throw new Error(`Red no permitida en la prueba: ${url}`);
  capturas.push({ url: url.replace(/key=[^&]+/, "key=…"), cuerpo: String(init?.body) });
  const cuerpo = { candidates: [{ content: { role: "model", parts: [{ text: respuestaTexto }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 10 } };
  return new Response(JSON.stringify(cuerpo), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const sha = (texto: string) => createHash("sha256").update(texto).digest("hex");
const fotos: Foto = {};
async function capturar(sitio: string, respuesta: string, accion: () => Promise<unknown>): Promise<void> {
  capturas.length = 0;
  respuestaTexto = respuesta;
  await accion().catch(() => undefined);
  assert.ok(capturas.length > 0, `${sitio}: no salió ninguna petición a Gemini`);
  assert.ok(capturas.every((c) => c.url.includes(":generateContent")), `${sitio}: ${capturas.map((c) => c.url).join(", ")}`);
  const ordenadas = capturas.map((c) => c.cuerpo).sort();
  fotos[sitio] = { sha256: ordenadas.map(sha), bytes: ordenadas.map((c) => Buffer.byteLength(c)) };
}

async function main() {
  const { leerFotoConIA } = await import("@/lib/globos3d/leer-foto-ia");
  const { detectarGlobos, descartarRacimos, PROPOSITO_DETECCION_GLOBOS } = await import("@/lib/globos3d/detectar-globos-ia");
  const { interpretarConsulta } = await import("@/lib/ia/inari/parse");
  const { interpretarPedido } = await import("@/lib/modulos-estudio/interpretar-ia");
  const { resumirConGemini } = await import("@/lib/feedback-ia/resumen-gemini");
  const { getGeminiClient } = await import("@/lib/gemini");

  const jpeg = await sharp({ create: { width: 480, height: 360, channels: 3, background: { r: 210, g: 60, b: 120 } } }).jpeg({ quality: 85 }).toBuffer();
  const foto = { bytes: new Uint8Array(jpeg), mime: "image/jpeg" };

  // «{}» no cumple el esquema: la lectura se reintenta con el error a la vista (dos peticiones, las dos se comparan).
  await capturar("lectura_foto_escena", "{}", () => leerFotoConIA(foto, { superficie: "prueba" }));
  await capturar("deteccion_globos_y_fondos", "[]", () => detectarGlobos(foto, { superficie: "prueba" }));
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const pequenos = [100, 160, 220, 280, 340, 400].map((x) => ({ box_2d: [300, x, 340, x + 40] as [number, number, number, number], color: "rojo" }));
  await capturar("deteccion_racimos", "[]", () => descartarRacimos(getGeminiClient(PROPOSITO_DETECCION_GLOBOS)!, { data, width: info.width, height: info.height, channels: info.channels as 3 }, [...pequenos, { box_2d: [100, 500, 700, 900], color: "dorado" }], { superficie: "prueba" }));
  await capturar("parser_intencion", "{}", () => interpretarConsulta("algo bonito para una fiesta", { superficie: "prueba" }));
  await capturar("modulos_interpretar", "{}", () => interpretarPedido("dúo de reflex rojo con azul mate"));
  await capturar("feedback_ia_resumen", "Resumen de prueba.", () => resumirConGemini({ totalTurnos: 3, totalCalificados: 2, promedio: 6.5, metricas: { deshechos: 1, porMotivo: [], porProducto: [], porHerramienta: [], frases: [], peores: [] } } as unknown as Parameters<typeof resumirConGemini>[0], 30));

  if (ESCRIBIR) {
    writeFileSync(RUTA, `${JSON.stringify(fotos, null, 2)}\n`);
    console.log(`foto escrita: ${Object.keys(fotos).length} sitios`);
    return;
  }
  const dorada = JSON.parse(readFileSync(RUTA, "utf8")) as Foto;
  let pruebas = 0;
  for (const [sitio, esperado] of Object.entries(dorada)) {
    assert.deepEqual(fotos[sitio], esperado, `${sitio}: la petición a Gemini cambió (bytes ${JSON.stringify(fotos[sitio]?.bytes)} vs ${JSON.stringify(esperado.bytes)})`);
    pruebas += 1;
    console.log(`  ✓ ${sitio}: ${esperado.sha256.length} petición(es) idénticas`);
  }
  assert.deepEqual(Object.keys(fotos).sort(), Object.keys(dorada).sort());

  // La traducción de la revisión era un callback dentro de /api/generate (sin forma de llamarlo suelto): se compara con la
  // misma llamada armada con los parámetros literales de b4433bc9.
  const { MODELO_CHAT } = await import("@/lib/gemini");
  const { traducirRevisionConModelo } = await import("@/lib/ia/kagutsuchi/traducir-revision-modelo");
  await capturar("traduccion_antes", "make the arch gold", () => getGeminiClient("traduccion_revision")!.models.generateContent({
    model: MODELO_CHAT,
    contents: [{ role: "user", parts: [{ text: "haz el arco dorado" }] }],
    config: {
      systemInstruction: "Translate the user's requested image edit into concise English. Preserve exact object, color, and action details. Return only the translation; do not add instructions or commentary.",
    },
  }));
  let traducida: string | undefined;
  await capturar("traduccion_ahora", "make the arch gold", async () => { traducida = await traducirRevisionConModelo("haz el arco dorado"); });
  assert.deepEqual(fotos.traduccion_ahora, fotos.traduccion_antes, "traducción de la revisión: la petición cambió");
  assert.equal(traducida, "make the arch gold");
  pruebas += 1;
  console.log("  ✓ traduccion_revision: la misma petición que el callback de antes");
  console.log(`\ntest-peticiones-gemini-directas: ${pruebas} sitios idénticos`);
}

void main()
  .catch((error: unknown) => { console.error(error); process.exitCode = 1; })
  .finally(() => { globalThis.fetch = fetchOriginal; });
