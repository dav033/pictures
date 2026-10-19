/**
 * Prueba en vivo (pagada, ≈ US$0,002 por foto) de la revisión de cajas grandes con detecciones ya guardadas:
 *   npx tsx --conditions=react-server scripts/exp/probar-racimos.ts <foto> <detecciones.json>
 */
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { getGeminiClient } from "@/lib/gemini";
import { descartarRacimos, PROPOSITO_DETECCION_GLOBOS } from "@/lib/globos3d/detectar-globos-ia";
import { cajasSospechosas } from "@/lib/globos3d/racimos-detectados";
import type { GloboDetectado } from "@/lib/globos3d/medir-con-detecciones";

async function main() {
  const [foto, archivo] = process.argv.slice(2);
  if (!foto || !archivo) throw new Error("uso: probar-racimos.ts <foto> <detecciones.json>");
  const d = JSON.parse(readFileSync(archivo, "utf8")) as { globos?: GloboDetectado[] } | GloboDetectado[];
  const globos = Array.isArray(d) ? d : d.globos ?? [];
  const cliente = getGeminiClient(PROPOSITO_DETECCION_GLOBOS);
  if (!cliente) throw new Error("sin GEMINI_API_KEY");
  const { data, info } = await sharp(readFileSync(foto)).rotate().raw().toBuffer({ resolveWithObject: true });
  const sospechosas = cajasSospechosas(globos);
  console.log("sospechosas:", sospechosas.map((i) => `${globos[i]!.color} ${JSON.stringify(globos[i]!.box_2d)}`));
  const r = await descartarRacimos(cliente, { data, width: info.width, height: info.height, channels: info.channels }, globos, { superficie: "exp:racimos" });
  const quitadas = globos.filter((g) => !r.globos.includes(g));
  console.log(`quitadas ${quitadas.length}:`, quitadas.map((g) => `${g.color} ${JSON.stringify(g.box_2d)}`), "uso", r.uso);
}
void main();
