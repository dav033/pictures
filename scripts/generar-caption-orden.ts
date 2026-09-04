// Fase 2 (parte 2): dado un número de orden con foto(s) + desglose.json ya en su carpeta,
// genera caption-N.json para cada foto. La IA determina sola, en la misma pasada, qué
// productos de la orden se ven de verdad en cada foto (no todos los de una orden se instalan
// donde se tomó la foto) -- ver src/lib/ordenes/generarCaption.ts, compartido con la ruta de
// "Recaption" del panel de admin para no duplicar el prompt/schema en dos lugares.
// También guarda ese juicio como feedback-N.json (fuente "ia_automatica"), visible y
// corregible a mano después desde el modal de Feedback del admin si algo salió mal.

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { generarCaption } from "../src/lib/ordenes/generarCaption";
import type { Desglose } from "../src/lib/ordenes/tipos";

const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";

/** Una orden puede tener más de una reseña con foto (ej. #9018: dos productos distintos
 * reseñados por separado) -- crear-carpeta-orden.ts ya descarga foto-1, foto-2, etc. para
 * esos casos. Este script debe generarle caption a CADA foto, no solo a la primera. */
async function fotosDeLaOrden(carpeta: string): Promise<Array<{ archivo: string; indice: number }>> {
  const archivos = await readdir(carpeta).catch(() => [] as string[]);
  return archivos
    .map((archivo) => {
      const m = archivo.match(/^foto-(\d+)\.(jpg|jpeg|png|webp)$/i);
      return m ? { archivo, indice: Number(m[1]) } : null;
    })
    .filter((x): x is { archivo: string; indice: number } => x !== null)
    .sort((a, b) => a.indice - b.indice);
}

async function generarParaFoto(
  numeroOrden: string,
  carpeta: string,
  foto: { archivo: string; indice: number },
  desglose: Desglose,
): Promise<{ indice: number; estado: string }> {
  try {
    const resultado = generarCaption(numeroOrden, foto.archivo, path.join(carpeta, foto.archivo), desglose, null);
    await writeFile(path.join(carpeta, `caption-${foto.indice}.json`), JSON.stringify(resultado.caption, null, 2), "utf-8");
    await writeFile(path.join(carpeta, `feedback-${foto.indice}.json`), JSON.stringify(resultado.feedback, null, 2), "utf-8");
    return { indice: foto.indice, estado: "ok" };
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return { indice: foto.indice, estado: "error_generando_caption" };
  }
}

async function procesarOrden(numeroOrden: string, forzar: boolean): Promise<void> {
  const carpeta = path.join(RUTA_ORDENES, numeroOrden);
  const rutaDesglose = path.join(carpeta, "desglose.json");

  let desglose: Desglose;
  try {
    desglose = JSON.parse(await readFile(rutaDesglose, "utf-8"));
  } catch {
    console.log(JSON.stringify({ orden: numeroOrden, estado: "sin_desglose", nota: "Corré primero: npm run ordenes:desglose -- " + numeroOrden }));
    return;
  }

  const fotos = await fotosDeLaOrden(carpeta);
  if (fotos.length === 0) {
    console.log(JSON.stringify({ orden: numeroOrden, estado: "sin_foto" }));
    return;
  }

  const yaTieneCaption = async (indice: number) => {
    try {
      await readFile(path.join(carpeta, `caption-${indice}.json`), "utf-8");
      return true;
    } catch {
      return false;
    }
  };

  const resultados = [];
  for (const foto of fotos) {
    if (!forzar && (await yaTieneCaption(foto.indice))) {
      resultados.push({ indice: foto.indice, estado: "ya_existia" });
      continue;
    }
    resultados.push(await generarParaFoto(numeroOrden, carpeta, foto, desglose));
  }

  console.log(JSON.stringify({ orden: numeroOrden, estado: "ok", fotos: resultados }, null, 2));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const forzar = argv.includes("--force");
  const ordenes = argv.filter((a) => a !== "--force").map((n) => n.replace(/^#/, "").trim());
  if (ordenes.length === 0) {
    console.error("Uso: tsx scripts/generar-caption-orden.ts <numero_de_orden> [otro_numero ...] [--force]");
    process.exit(1);
  }
  for (const orden of ordenes) {
    await procesarOrden(orden, forzar);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
