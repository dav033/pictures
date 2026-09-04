// Auditoría de APTITUD TÉCNICA de las fotos que van a entrenar. Complementa a
// auditar-tamanos-captions.ts, que solo mira el texto: acá se miran los píxeles.
//
// El requisito duro viene de la documentación del trainer de fal.ai: "Minimum 1024x1024px,
// higher resolutions preferred", sin artefactos de compresión. Una foto por debajo de ese
// umbral no se rechaza necesariamente, pero se reescala hacia arriba y aporta detalle inventado
// -- justo lo contrario de lo que se busca al enseñar un estilo.
//
// Chequeos:
//   1. resolución: lado corto < 1024 (bloqueante) o < 768 (grave).
//   2. relación de aspecto extrema: recortes muy alargados pierden la escena.
//   3. peso por megapíxel: un JPEG muy comprimido delata artefactos.
//   4. duplicados ENTRE órdenes distintas (el audit anterior solo miraba dentro de una misma).
//
// Uso: npx tsx scripts/auditar-calidad-imagenes.ts [--todas]
//      Por defecto solo audita las fotos con aptoParaEntrenamiento=true, que son las que
//      realmente se van a exportar. Con --todas mira el corpus completo.

import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";

const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";
const TODAS = process.argv.includes("--todas");

const MINIMO_FAL = 1024;
const MINIMO_GRAVE = 768;

type Foto = {
  orden: string;
  archivo: string;
  ancho: number;
  alto: number;
  ladoCorto: number;
  aspecto: number;
  bytesPorMegapixel: number;
  hash: string;
  categoria: string;
};

async function main() {
  const carpetas = (await readdir(RUTA_ORDENES, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const fotos: Foto[] = [];
  let saltadas = 0;

  for (const carpeta of carpetas) {
    const dir = path.join(RUTA_ORDENES, carpeta);
    const archivos = (await readdir(dir)).filter((f) => /^foto-\d+\.(jpe?g|png|webp)$/i.test(f)).sort();

    for (const archivo of archivos) {
      const indice = archivo.match(/^foto-(\d+)\./)![1];
      let categoria = "";
      if (!TODAS) {
        try {
          const fb = JSON.parse(await readFile(path.join(dir, `feedback-${indice}.json`), "utf-8"));
          if (fb.aptoParaEntrenamiento !== true) continue;
          categoria = fb.categoria ?? "";
        } catch {
          continue;
        }
      }

      const ruta = path.join(dir, archivo);
      try {
        const buf = await readFile(ruta);
        const meta = await sharp(buf).metadata();
        const ancho = meta.width ?? 0;
        const alto = meta.height ?? 0;
        if (!ancho || !alto) {
          saltadas += 1;
          continue;
        }
        const { size } = await stat(ruta);
        fotos.push({
          orden: carpeta,
          archivo,
          ancho,
          alto,
          ladoCorto: Math.min(ancho, alto),
          aspecto: Math.max(ancho, alto) / Math.min(ancho, alto),
          bytesPorMegapixel: size / ((ancho * alto) / 1_000_000),
          hash: createHash("sha256").update(buf).digest("hex"),
          categoria,
        });
      } catch {
        saltadas += 1;
      }
    }
  }

  const bajoFal = fotos.filter((f) => f.ladoCorto < MINIMO_FAL);
  const graves = fotos.filter((f) => f.ladoCorto < MINIMO_GRAVE);
  const aspectoRaro = fotos.filter((f) => f.aspecto > 2.2);
  // 60 KB/MP, no 180. Un primer umbral en 180 marcaba 131 de 140 fotos, que es lo mismo que no
  // marcar nada: un JPEG sano de cámara de teléfono vive entre 90 y 200 KB/MP. Los artefactos
  // visibles (bloques, banding) empiezan bastante más abajo.
  const comprimidas = fotos.filter((f) => f.bytesPorMegapixel < 60_000);

  const porHash = new Map<string, Foto[]>();
  for (const f of fotos) porHash.set(f.hash, [...(porHash.get(f.hash) ?? []), f]);
  const duplicados = [...porHash.values()].filter((v) => v.length > 1);

  console.log(`Fotos auditadas: ${fotos.length}${TODAS ? " (corpus completo)" : " (solo aptoParaEntrenamiento=true)"}`);
  if (saltadas) console.log(`Ilegibles / saltadas: ${saltadas}`);

  console.log(`\n--- resolución ---`);
  console.log(`  lado corto < ${MINIMO_FAL}px (mínimo de fal.ai): ${bajoFal.length} (${((bajoFal.length / fotos.length) * 100).toFixed(0)}%)`);
  console.log(`  lado corto < ${MINIMO_GRAVE}px (grave):          ${graves.length}`);
  const ordenadas = [...fotos].sort((a, b) => a.ladoCorto - b.ladoCorto);
  const mediana = ordenadas[Math.floor(ordenadas.length / 2)];
  console.log(`  lado corto mediano: ${mediana?.ladoCorto}px   mínimo: ${ordenadas[0]?.ladoCorto}px   máximo: ${ordenadas.at(-1)?.ladoCorto}px`);
  for (const f of graves.slice(0, 12)) console.log(`    ${f.orden}/${f.archivo}  ${f.ancho}x${f.alto}`);
  if (graves.length > 12) console.log(`    (+${graves.length - 12} más)`);

  console.log(`\n--- relación de aspecto > 2.2:1 ---  ${aspectoRaro.length}`);
  for (const f of aspectoRaro.slice(0, 8)) console.log(`    ${f.orden}/${f.archivo}  ${f.ancho}x${f.alto}  (${f.aspecto.toFixed(1)}:1)`);

  console.log(`\n--- compresión sospechosa (<60 KB por megapíxel) ---  ${comprimidas.length}`);
  for (const f of comprimidas.slice(0, 8)) {
    console.log(`    ${f.orden}/${f.archivo}  ${Math.round(f.bytesPorMegapixel / 1000)} KB/MP`);
  }

  console.log(`\n--- fotos idénticas entre órdenes distintas ---  ${duplicados.length} grupos`);
  for (const grupo of duplicados) {
    console.log(`    ${grupo.map((f) => `${f.orden}/${f.archivo}`).join("  ==  ")}`);
  }

  if (!TODAS) {
    const porCategoria = new Map<string, number>();
    for (const f of fotos) porCategoria.set(f.categoria, (porCategoria.get(f.categoria) ?? 0) + 1);
    console.log(`\n--- reparto por categoría (solo aptas) ---`);
    console.log(`  ${"categoría".padEnd(16)} ${"aptas".padStart(6)} ${"≥1024px".padStart(8)} ${"se caen".padStart(8)}`);
    for (const [c, n] of [...porCategoria].sort((a, b) => b[1] - a[1])) {
      const enCategoria = fotos.filter((f) => f.categoria === c);
      const sobreviven = enCategoria.filter((f) => f.ladoCorto >= MINIMO_FAL).length;
      console.log(`  ${(c || "(sin categoría)").padEnd(16)} ${String(n).padStart(6)} ${String(sobreviven).padStart(8)} ${String(n - sobreviven).padStart(8)}`);
    }
    const totalSobrevive = fotos.filter((f) => f.ladoCorto >= MINIMO_FAL).length;
    console.log(`  ${"TOTAL".padEnd(16)} ${String(fotos.length).padStart(6)} ${String(totalSobrevive).padStart(8)} ${String(fotos.length - totalSobrevive).padStart(8)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
