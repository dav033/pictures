// Fase 1 del pipeline de dataset por orden: dado un número de orden, crea su carpeta en
// RUTA_ORDENES y descarga ahí la(s) foto(s) real(es) de la decoración armada que subió el
// cliente en su reseña (Revie) — nunca la foto de stock del producto. La Fase 2 (rellenar
// caption + desglose de materiales a partir de la orden real en Shopify) es un script aparte
// que corre después sobre las carpetas que ya tengan imagen.
//
// Requiere que data/manifests/revie-reviews-index.json ya exista — generarlo/actualizarlo
// con `npm run ordenes:index` (scripts/revie-build-index.ts) antes de usar este script.

import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";
const INDEX_PATH = path.resolve("data/manifests/revie-reviews-index.json");

type IndiceOrden = Record<string, { fotos: string[]; cliente: string | null; producto: string | null }>;

function extensionDeUrl(url: string): string {
  const match = new URL(url).pathname.toLowerCase().match(/\.(jpe?g|png|webp)$/);
  return match ? (match[1] === "jpeg" ? ".jpg" : `.${match[1]}`) : ".jpg";
}

async function descargarImagen(url: string, destino: string): Promise<void> {
  const respuesta = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status} al descargar ${url}`);
  const buffer = Buffer.from(await respuesta.arrayBuffer());
  await writeFile(destino, buffer);
}

async function main(): Promise<void> {
  const numeroOrden = process.argv[2]?.replace(/^#/, "").trim();
  if (!numeroOrden || !/^\d+$/.test(numeroOrden)) {
    console.error("Uso: tsx scripts/crear-carpeta-orden.ts <numero_de_orden>");
    process.exitCode = 1;
    return;
  }

  let indice: IndiceOrden;
  try {
    indice = JSON.parse(await readFile(INDEX_PATH, "utf-8")) as IndiceOrden;
  } catch {
    console.error(`No se encontró el índice en ${INDEX_PATH}. Corré primero: npm run ordenes:index`);
    process.exitCode = 1;
    return;
  }

  const entrada = indice[numeroOrden];
  if (!entrada || entrada.fotos.length === 0) {
    console.log(
      JSON.stringify(
        {
          orden: numeroOrden,
          estado: "sin_foto_de_resena",
          nota: "Esta orden no tiene reseña con foto en el índice actual. Puede que aún no haya reseña, o que el índice esté desactualizado (correr npm run ordenes:index).",
        },
        null,
        2,
      ),
    );
    return;
  }

  const carpetaOrden = path.join(RUTA_ORDENES, numeroOrden);
  await mkdir(carpetaOrden, { recursive: true });

  const existentes = new Set(await readdir(carpetaOrden).catch(() => [] as string[]));
  const descargadas: string[] = [];
  const yaExistian: string[] = [];

  for (const [indiceFoto, url] of entrada.fotos.entries()) {
    const nombre = `foto-${indiceFoto + 1}${extensionDeUrl(url)}`;
    if (existentes.has(nombre)) {
      yaExistian.push(nombre);
      continue;
    }
    await descargarImagen(url, path.join(carpetaOrden, nombre));
    descargadas.push(nombre);
  }

  console.log(
    JSON.stringify(
      {
        orden: numeroOrden,
        estado: "ok",
        carpeta: carpetaOrden,
        cliente: entrada.cliente,
        producto: entrada.producto,
        fotosDescargadas: descargadas,
        fotosYaExistian: yaExistian,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
