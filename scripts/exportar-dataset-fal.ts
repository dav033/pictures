// Empaqueta una categoría del dataset en el ZIP que espera el trainer de fal.ai: estructura
// plana, una imagen por caption, mismo nombre base (`foto.jpg` + `foto.txt`). Es el mismo formato
// que ya usaba scripts/package-fal-final-dataset.py para el dataset de producto.
//
// Qué hace además de comprimir:
//
//   1. PRE-VUELO. Corre las reglas de auditoría de texto sobre lo que va a exportar y ABORTA si
//      encuentra algo. Exportar es el último punto donde un defecto se puede atajar barato: una
//      vez que el ZIP se sube y se pagan los pasos, el error ya costó dinero.
//   2. Aplana el canal alfa sobre blanco. Hay 7 PNG de producto recortado entre las aptas; un
//      alfa en el set de entrenamiento se maneja distinto según el trainer y es una fuente de
//      sorpresas. Se resuelve acá, explícitamente.
//   3. Renombra a `{orden}-{indice}` para garantizar nombres únicos: casi todas las fotos del
//      dataset se llaman `foto-1.jpg` y colisionarían en un ZIP plano.
//   4. Escribe un manifiesto JSON con qué entró, de dónde salió y qué se le hizo a cada imagen.
//
// Sobre el CAPTION: por defecto exporta SOLO el campo `caption`, no
// `proporcion_relativa_descripcion`. Esa es la decisión pre-registrada del chequeo visual v001
// (banda amarillo, 16,7% de error en las descripciones de proporción). `--incluir-proporcion` la
// anula, pero entonces conviene arreglar primero las 7 fotos con ratio calculado.
//
// Uso:
//   npx tsx scripts/exportar-dataset-fal.ts --trigger=eventdecor_style_v2
//   npx tsx scripts/exportar-dataset-fal.ts --categoria=general --dry-run

import { readFile, writeFile, readdir, mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import sharp from "sharp";
import { analizarComparacion } from "./lib/comparacion-tamanos";

const ejecutar = promisify(execFile);
const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";

function arg(nombre: string, defecto: string): string {
  const m = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return m ? m.split("=").slice(1).join("=") : defecto;
}

const CATEGORIA = arg("categoria", "general");
const TRIGGER = arg("trigger", "");
const SALIDA = arg("salida", path.join("data", "staging", `sempertex-${CATEGORIA}-fal.zip`));
const MIN_LADO = Number(arg("min-lado", "0"));
const INCLUIR_PROPORCION = process.argv.includes("--incluir-proporcion");
const DRY_RUN = process.argv.includes("--dry-run");

const META_COMENTARIO = /\b(?:confirmed|purchased|not listed in the order|the order)\b/i;

type Entrada = {
  orden: string;
  indice: number;
  nombre: string;
  origen: string;
  texto: string;
  ancho: number;
  alto: number;
  transformaciones: string[];
};

async function main() {
  const carpetas = (await readdir(RUTA_ORDENES, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();

  const entradas: Entrada[] = [];
  const problemas: string[] = [];

  for (const carpeta of carpetas) {
    const dir = path.join(RUTA_ORDENES, carpeta);
    const archivos = await readdir(dir).catch(() => [] as string[]);

    for (const a of archivos.filter((f) => /^feedback-\d+\.json$/.test(f))) {
      const indice = Number(a.match(/\d+/)![0]);
      let fb: { aptoParaEntrenamiento?: boolean; categoria?: string };
      try {
        fb = JSON.parse(await readFile(path.join(dir, a), "utf-8"));
      } catch { continue; }
      if (fb.aptoParaEntrenamiento !== true || fb.categoria !== CATEGORIA) continue;

      let caption: { caption?: string; proporcion_relativa_descripcion?: string } | null = null;
      try {
        caption = JSON.parse(await readFile(path.join(dir, `caption-${indice}.json`), "utf-8"));
      } catch {
        problemas.push(`${carpeta}/foto-${indice}: no tiene caption-${indice}.json`);
        continue;
      }

      const base = (caption!.caption ?? "").trim();
      if (!base) {
        problemas.push(`${carpeta}/foto-${indice}: el caption está vacío`);
        continue;
      }

      let origen = "";
      for (const ext of ["jpg", "jpeg", "png", "webp"]) {
        const p = path.join(dir, `foto-${indice}.${ext}`);
        try { await readFile(p); origen = p; break; } catch { /* siguiente */ }
      }
      if (!origen) {
        problemas.push(`${carpeta}/foto-${indice}: falta el archivo de imagen`);
        continue;
      }

      let texto = base;
      if (INCLUIR_PROPORCION && caption!.proporcion_relativa_descripcion) {
        texto = `${texto} ${caption!.proporcion_relativa_descripcion.trim()}`;
      }
      if (TRIGGER) {
        // Reemplaza SOLO el primer token, que es donde vive el disparador por convención del
        // pipeline ("eventdecor_style_v1, an organic balloon arch...").
        texto = texto.replace(/^[^,]+,/, `${TRIGGER},`);
      }

      // --- pre-vuelo de texto ---
      if (META_COMENTARIO.test(texto)) {
        problemas.push(`${carpeta}/foto-${indice}: el texto habla del pedido en vez de la imagen`);
      }
      let lineas: Array<{ producto: string; variante?: string | null }> = [];
      let esPedidoReal = false;
      try {
        const d = JSON.parse(await readFile(path.join(dir, "desglose.json"), "utf-8"));
        lineas = d.lineas ?? [];
        esPedidoReal = Boolean(d.cliente);
      } catch { /* sin desglose */ }
      for (const h of analizarComparacion(texto, lineas, { desgloseEnumeraTodo: esPedidoReal })) {
        problemas.push(`${carpeta}/foto-${indice}: [${h.regla}] ${h.detalle}`);
      }

      const meta = await sharp(await readFile(origen)).metadata();
      entradas.push({
        orden: carpeta,
        indice,
        nombre: `${carpeta}-${indice}`,
        origen,
        texto,
        ancho: meta.width ?? 0,
        alto: meta.height ?? 0,
        transformaciones: [],
      });
    }
  }

  console.log(`categoría "${CATEGORIA}": ${entradas.length} fotos aptas`);
  console.log(`caption exportado: ${INCLUIR_PROPORCION ? "caption + proporcion_relativa_descripcion" : "solo el campo `caption`"}`);
  console.log(`trigger: ${TRIGGER ? `reescrito a "${TRIGGER}"` : "se deja el que ya tiene el caption"}`);

  if (problemas.length > 0) {
    console.error(`\nPRE-VUELO FALLIDO -- ${problemas.length} problemas. No se exporta nada:`);
    for (const p of problemas.slice(0, 30)) console.error(`  ${p}`);
    if (problemas.length > 30) console.error(`  (+${problemas.length - 30} más)`);
    console.error(`\nArreglalos y volvé a correr. Exportar es el último punto barato para atajarlos.`);
    process.exit(1);
  }
  console.log(`pre-vuelo de texto: OK`);

  const bajos = entradas.filter((e) => Math.min(e.ancho, e.alto) < 1024);
  console.log(`resolución: ${entradas.length - bajos.length} de ${entradas.length} llegan a 1024px de lado corto` + (MIN_LADO ? `; se reescalarán ${entradas.filter((e) => Math.min(e.ancho, e.alto) < MIN_LADO).length} hasta ${MIN_LADO}px` : `; NO se reescala (fal las ajusta al vuelo)`));

  if (DRY_RUN) {
    console.log(`\nDRY-RUN: no se escribió nada.`);
    return;
  }

  const staging = path.join(path.dirname(SALIDA), `.staging-${CATEGORIA}`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  for (const e of entradas) {
    const buf = await readFile(e.origen);
    const meta = await sharp(buf).metadata();
    let img = sharp(buf);
    let recodificar = false;

    if (meta.hasAlpha) {
      img = img.flatten({ background: "#ffffff" });
      e.transformaciones.push("alfa aplanado sobre blanco");
      recodificar = true;
    }
    if (MIN_LADO && Math.min(e.ancho, e.alto) < MIN_LADO) {
      const escala = MIN_LADO / Math.min(e.ancho, e.alto);
      img = img.resize(Math.round(e.ancho * escala), Math.round(e.alto * escala), { kernel: "lanczos3" });
      e.transformaciones.push(`reescalada a lado corto ${MIN_LADO}px`);
      recodificar = true;
    }

    const destino = path.join(staging, `${e.nombre}.jpg`);
    if (recodificar) {
      await writeFile(destino, await img.jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer());
    } else if (meta.format === "jpeg") {
      // Sin transformación y ya es JPEG: se copian los bytes tal cual, sin recomprimir.
      await writeFile(destino, buf);
      e.transformaciones.push("copiada sin recomprimir");
    } else {
      await writeFile(destino, await img.jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer());
      e.transformaciones.push(`convertida de ${meta.format} a jpeg`);
    }
    await writeFile(path.join(staging, `${e.nombre}.txt`), `${e.texto}\n`, "utf-8");
  }

  await mkdir(path.dirname(SALIDA), { recursive: true });
  await rm(SALIDA, { force: true });
  await ejecutar("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${path.resolve(staging)}\\*' -DestinationPath '${path.resolve(SALIDA)}' -CompressionLevel Optimal`]);
  await rm(staging, { recursive: true, force: true });

  const manifiesto = path.join("data", "processed", `export-${CATEGORIA}-${new Date().toISOString().slice(0, 10)}.json`);
  await writeFile(manifiesto, `${JSON.stringify({
    generado: new Date().toISOString(),
    categoria: CATEGORIA,
    zip: path.resolve(SALIDA),
    fotos: entradas.length,
    incluyeProporcion: INCLUIR_PROPORCION,
    trigger: TRIGGER || "(sin cambio)",
    entradas: entradas.map((e) => ({ orden: e.orden, indice: e.indice, nombre: e.nombre, px: `${e.ancho}x${e.alto}`, transformaciones: e.transformaciones, texto: e.texto })),
  }, null, 2)}\n`, "utf-8");

  console.log(`\nZIP:        ${path.resolve(SALIDA)}`);
  console.log(`manifiesto: ${path.resolve(manifiesto)}`);
  console.log(`contenido:  ${entradas.length} imágenes + ${entradas.length} .txt`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
