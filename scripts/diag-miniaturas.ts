import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

/**
 * Reduce los PNG de una tanda de experimento a JPEG pequeños para poder
 * revisarlos y para mandarlos a un juez en una sola llamada sin agotar el
 * presupuesto de entrada.
 *
 * Sin red ni llamadas pagadas.
 *   npx tsx scripts/diag-miniaturas.ts reports/lora-debug/registro-caption-v004
 */

const dir = process.argv[2];
if (!dir) throw new Error("Pasa el directorio de la tanda.");
const salida = path.join(dir, "mini");
fs.mkdirSync(salida, { recursive: true });

async function main(): Promise<void> {
  const archivos = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  for (const archivo of archivos) {
    const destino = path.join(salida, archivo.replace(/\.png$/, ".jpg"));
    await sharp(path.join(dir, archivo)).resize({ width: 512 }).jpeg({ quality: 78 }).toFile(destino);
    console.log(`${archivo} -> ${path.relative(process.cwd(), destino)} (${Math.round(fs.statSync(destino).size / 1024)} KB)`);
  }
}

void main();
