/**
 * Triptico foto | referencia Claude | Gemini para comparar la fidelidad de una foto (REQ-001). Las tres imagenes se
 * escalan al mismo alto y se pegan en un PNG. La foto vive fuera del repo; el PNG se escribe donde diga `--salida`.
 *
 *   npx tsx scripts/exp/triptico-foto.ts --foto <foto> --claude <captura.png> --gemini <captura.png> --salida <triptico.png>
 */
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const ALTO = 800;

async function escalada(ruta: string): Promise<Buffer> {
  return sharp(ruta).resize({ height: ALTO }).flatten({ background: "#ffffff" }).png().toBuffer();
}

async function main() {
  const rutas = [arg("--foto"), arg("--claude"), arg("--gemini")];
  const salida = arg("--salida");
  if (!salida || rutas.some((r) => !r)) throw new Error("Faltan --foto, --claude, --gemini o --salida");
  const trozos = await Promise.all((rutas as string[]).map(escalada));
  const anchos = await Promise.all(trozos.map(async (t) => (await sharp(t).metadata()).width ?? 0));
  const separacion = 12;
  let x = 0;
  const capas = trozos.map((input, i) => {
    const capa = { input, left: x, top: 0 };
    x += anchos[i] + separacion;
    return capa;
  });
  const lienzo = sharp({ create: { width: x - separacion, height: ALTO, channels: 3, background: "#202020" } });
  writeFileSync(salida, await lienzo.composite(capas).png().toBuffer());
  console.log(`triptico: ${salida}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
