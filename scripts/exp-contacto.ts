import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

/**
 * Arma una hoja de contacto etiquetada a partir de los PNG de una tanda.
 *
 * Existe para poder juzgar 18 imágenes en grilla en vez de una por una: cuando
 * lo que se mide es una TASA de fallo, verlas juntas y con la etiqueta al lado
 * es lo que evita que el criterio se vaya corriendo entre imagen e imagen.
 *
 *   npx tsx scripts/exp-contacto.ts --dir reports/lora-debug/step2 --patron P-lora08- --cols 3
 */

const arg = (nombre: string, porDefecto: string): string => {
  const i = process.argv.indexOf(`--${nombre}`);
  return (i >= 0 ? process.argv[i + 1] : undefined) ?? porDefecto;
};

const ANCHO_MINIATURA = 512;
const ALTO_ETIQUETA = 30;

async function main(): Promise<void> {
  const dir = path.resolve(process.cwd(), arg("dir", "reports/lora-debug/step2"));
  const patron = arg("patron", "");
  const columnas = Number(arg("cols", "3"));

  const archivos = fs
    .readdirSync(dir)
    .filter((nombre) => nombre.endsWith(".png") && nombre.includes(patron) && !nombre.startsWith("contacto-"))
    .sort();
  if (!archivos.length) throw new Error(`Sin PNG que coincidan con "${patron}" en ${dir}`);

  const miniaturas = await Promise.all(
    archivos.map(async (nombre) => {
      const buffer = await sharp(path.join(dir, nombre)).resize({ width: ANCHO_MINIATURA }).png().toBuffer();
      const { height } = await sharp(buffer).metadata();
      return { nombre, buffer, alto: height ?? ANCHO_MINIATURA };
    }),
  );

  const altoMiniatura = Math.max(...miniaturas.map((m) => m.alto));
  const altoCelda = altoMiniatura + ALTO_ETIQUETA;
  const filas = Math.ceil(miniaturas.length / columnas);

  const capas = miniaturas.flatMap((miniatura, indice) => {
    const x = (indice % columnas) * ANCHO_MINIATURA;
    const y = Math.floor(indice / columnas) * altoCelda;
    const etiqueta = miniatura.nombre.replace(/\.png$/, "");
    const svg = Buffer.from(
      `<svg width="${ANCHO_MINIATURA}" height="${ALTO_ETIQUETA}">` +
        `<rect width="100%" height="100%" fill="#111"/>` +
        `<text x="8" y="21" font-family="monospace" font-size="17" fill="#fff">${etiqueta}</text>` +
        `</svg>`,
    );
    return [
      { input: miniatura.buffer, left: x, top: y },
      { input: svg, left: x, top: y + altoMiniatura },
    ];
  });

  const salida = path.join(dir, `contacto-${patron || "todo"}.png`);
  await sharp({
    create: {
      width: ANCHO_MINIATURA * columnas,
      height: altoCelda * filas,
      channels: 3,
      background: "#111",
    },
  })
    .composite(capas)
    .png()
    .toFile(salida);

  console.log(`${miniaturas.length} imagenes -> ${path.relative(process.cwd(), salida)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
