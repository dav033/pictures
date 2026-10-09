/**
 * Comprueba contra la API real que Gemini ACEPTA el esquema de la lectura de fotos (`esquemaLecturaParaGemini`): una sola llamada
 * con una imagen de 64 px y el tope de salida más bajo, de modo que cuesta una fracción de centavo (tope `--tope-usd`, 0,01 por
 * omisión). No mide la calidad de la lectura: solo que la API no responda «invalid argument» por el tamaño o la complejidad del
 * esquema. Pagado: solo con `--pagar`.
 *
 *   npx tsx --conditions=react-server scripts/exp/verificar-esquema-gemini.ts --pagar
 */
import { existsSync } from "node:fs";
import { ThinkingLevel } from "@google/genai";
import sharp from "sharp";
import { getGeminiClient, MODELO_CHAT } from "../../src/lib/gemini";
import { costeFlashUsd } from "../../src/lib/globos3d/leer-foto-ia";
import { PROPOSITO_LECTURA_FOTO, esquemaLecturaParaGemini } from "../../src/lib/globos3d/leer-foto-ia";

for (const archivo of [".env.local", ".env"]) if (existsSync(archivo)) process.loadEnvFile(archivo);

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const tope = Number(arg("--tope-usd") ?? 0.01);
const TOKENS_SALIDA = 600;

async function main() {
  const esquema = esquemaLecturaParaGemini();
  const bytes = Buffer.byteLength(JSON.stringify(esquema));
  console.log(`esquema: ${bytes} B`);
  if (!process.argv.includes("--pagar")) throw new Error("Sin --pagar no se llama a la IA.");
  const cliente = getGeminiClient(PROPOSITO_LECTURA_FOTO);
  if (!cliente) throw new Error("La IA no está configurada.");
  const foto = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#d8c8a8" } }).jpeg().toBuffer();
  const inicio = Date.now();
  const r = await cliente.models.generateContent({
    model: MODELO_CHAT,
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: foto.toString("base64") } }, { text: "Describe la imagen con el JSON pedido (es un cuadro de color liso: una sola pieza «otro»)." }] }],
    config: { systemInstruction: "Lees fotos de decoración con globos.", responseMimeType: "application/json", responseJsonSchema: esquema, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, maxOutputTokens: TOKENS_SALIDA, temperature: 0.3 },
  });
  const uso = { entrada: r.usageMetadata?.promptTokenCount ?? 0, salida: r.usageMetadata?.candidatesTokenCount ?? 0, pensamiento: r.usageMetadata?.thoughtsTokenCount ?? 0 };
  const coste = costeFlashUsd(uso);
  const texto = (r.candidates?.[0]?.content?.parts ?? []).filter((p) => typeof p.text === "string" && p.thought !== true).map((p) => p.text).join("");
  console.log(`ACEPTADO en ${Date.now() - inicio} ms · tokens ${JSON.stringify(uso)} · US$${coste} · finishReason ${r.candidates?.[0]?.finishReason}`);
  console.log(`respuesta: ${texto.slice(0, 300)}`);
  if (coste > tope) console.warn(`OJO: costó más que el tope ${tope}.`);
}

main().catch((e) => { console.error("RECHAZADO O FALLÓ:", e instanceof Error ? e.message.slice(0, 600) : e); process.exit(1); });
