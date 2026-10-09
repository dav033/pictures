/**
 * Junta, sin coste, cada imagen de `render-boda.ts` con la captura 3D que la originó (la captura a la izquierda, el resultado a la derecha, con
 * su rótulo) y arma una hoja comparativa con todas. Salida en la misma carpeta: `<id>-s<semilla>-junto-a-captura.jpg` y `hoja-comparativa.jpg`.
 *
 * Uso: npx tsx scripts/exp/hoja-boda.ts <carpeta>
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const CARPETA = process.argv[2];
if (!CARPETA) throw new Error("Falta la carpeta.");
const ALTO = 640;

const NOMBRES: Readonly<Record<string, string>> = {
  a: "a) FLUX.2 /edit, texto de antes (prohibia mesas)", b: "b) FLUX.2 /edit, texto nuevo", c: "c) FLUX.1 i2i strength 0,55",
  d: "d) FLUX.1 + ControlNet canny+depth 0,7", e: "e) FLUX.1 i2i strength 0,40", f: "f) FLUX.1 i2i strength 0,70",
};

const rotulo = (texto: string, ancho: number) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="34"><rect width="100%" height="100%" fill="#111" fill-opacity="0.78"/><text x="10" y="23" font-family="Arial" font-size="18" fill="#fff">${texto.replace(/&/g, "y").replace(/</g, "")}</text></svg>`);

async function celda(archivo: string, texto: string): Promise<Buffer> {
  const base = sharp(archivo).resize({ height: ALTO });
  const { data, info } = await base.jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
  return sharp(data).composite([{ input: rotulo(texto, info.width), top: 0, left: 0 }]).jpeg({ quality: 90 }).toBuffer();
}

async function main() {
  const captura = join(CARPETA, "captura-3d-escena.jpg");
  if (!existsSync(captura)) throw new Error("Falta captura-3d-escena.jpg.");
  const imagenes = readdirSync(CARPETA).filter((f) => /^[a-f]-s\d+\.png$/.test(f)).sort();
  const izquierda = await celda(captura, "Captura 3D del taller (la entrada)");
  const celdas: Buffer[] = [izquierda];
  for (const f of imagenes) {
    const id = f[0]!;
    const derecha = await celda(join(CARPETA, f), `${NOMBRES[id] ?? id} · ${f}`);
    celdas.push(derecha);
    const a = await sharp(izquierda).metadata(), b = await sharp(derecha).metadata();
    const junto = await sharp({ create: { width: (a.width ?? 0) + (b.width ?? 0) + 8, height: ALTO, channels: 3, background: "#ffffff" } })
      .composite([{ input: izquierda, left: 0, top: 0 }, { input: derecha, left: (a.width ?? 0) + 8, top: 0 }]).jpeg({ quality: 90 }).toBuffer();
    writeFileSync(join(CARPETA, f.replace(".png", "-junto-a-captura.jpg")), junto);
    console.log(`${f.replace(".png", "-junto-a-captura.jpg")}`);
  }
  // La hoja: 2 columnas.
  const metas = await Promise.all(celdas.map((c) => sharp(c).metadata()));
  const ancho = Math.max(...metas.map((m) => m.width ?? 0));
  const columnas = 2, filas = Math.ceil(celdas.length / columnas);
  const hoja = await sharp({ create: { width: columnas * ancho + (columnas - 1) * 8, height: filas * ALTO + (filas - 1) * 8, channels: 3, background: "#ffffff" } })
    .composite(celdas.map((c, i) => ({ input: c, left: (i % columnas) * (ancho + 8), top: Math.floor(i / columnas) * (ALTO + 8) }))).jpeg({ quality: 88 }).toBuffer();
  writeFileSync(join(CARPETA, "hoja-comparativa.jpg"), hoja);
  console.log("hoja-comparativa.jpg", readFileSync(join(CARPETA, "hoja-comparativa.jpg")).length, "bytes");
}

main().catch((error) => { console.error(error); process.exit(1); });
