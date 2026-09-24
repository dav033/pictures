import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const DEFAULT_INPUT = "C:\\Users\\david\\Downloads\\SEMPERTEX-TRAINING";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

// Encontrados por revisión visual manual de las 48 imágenes — la resolución sola no los
// detecta. Ruta relativa a --input, con "/" como separador. Categorías usadas como prefijo
// del motivo (antes de ":"): sempertex_watermark, other_brand_watermark,
// color_swatch_catalog_card_not_a_scene, isolated_product_cutout_not_installed_scene,
// identifiable_bystanders_privacy_risk, off_theme_for_base, retail_shelf_display.
const MANUAL_EXCLUDE: Record<string, string> = {
  "BASE/295d263a8f1b58f68904e7a47c825348.jpg": "sempertex_watermark:texto_sempertex_en_empaque_de_producto",
  "BASE/6c667a7d8c294902175819c0f83670e2.jpg": "sempertex_watermark:isotipo_trebol_esquina_superior",
  "BASE/7ff5f249a49ca0cdf918f608db3110d2.jpg": "sempertex_watermark:texto_sempertex_inferior",
  "BASE/9c247a0fe21c2dbac5d8058c42f12e7c.jpg": "other_brand_watermark:logo_inflate_creations_esquina_inferior",
  "BASE/DESAYUNO_SORPRESA_-_SURPRISE_BREAKFAST.webp": "isolated_product_cutout_not_installed_scene",
  "BASE/baf3c8b506ac57fde8adf01ceb2dc07b.jpg": "off_theme_for_base:pertenece_a_acento_amor_amistad",
  "BASE/Innoballoons_6_e6cf6a65-7bce-450a-b994-c3f423f0e3b9_520x500.webp": "other_brand_watermark:producto_de_otra_marca_innoballoons",
  // Confirmado en sempertex.com/blogs/idea-de-fiesta/mesa-aya-showroom-2026: es la escena
  // oficial "Mesa Amor y Amistad Showroom 2026", no una repisa de producto.
  "BASE/MESA_SHOWROOM.webp": "off_theme_for_base:pertenece_a_acento_amor_amistad",
  "BASE/Reflex/images.jpg": "sempertex_watermark:logo_completo",
  "BASE/Reflex/images (1).jpg": "sempertex_watermark:texto_sempertex_inferior",
  "BASE/Reflex/images (2).jpg": "color_swatch_catalog_card_not_a_scene",
  "BASE/Reflex/images (3).jpg": "color_swatch_catalog_card_not_a_scene",
  "BASE/Reflex/images (6).jpg": "other_brand_watermark:logo_happy_gift_esquina",
  "BASE/Showroom_FC_Silk-FC_mariposas_encantadas.webp": "sempertex_watermark:texto_en_bolsas_de_producto",
  "BASE/Showroom_dia_del_padre.webp": "sempertex_watermark:logo_completo_inferior_derecha",
  "BASE/e82c66915a9535cc0b0bacbda24dd049.jpg": "isolated_product_cutout_not_installed_scene",
  "BASE/e831ec6cf127baff1a9670c9e558b06f.jpg": "sempertex_watermark:logo_completo_inferior",
  "BASE/ebb10ee6ac86e421868978b7638cc739.jpg": "sempertex_watermark:isotipo_trebol_esquina",
  "BASE/f7a0bebf54f459a96706b26be76f59ab.jpg": "isolated_product_cutout_not_installed_scene",
  "BASE/fashion/34d992713baddf04ee7a44ac41516282.jpg": "color_swatch_catalog_card_not_a_scene",
  "BASE/fashion/Decoracion-con-globo-R9-azul-rey.jpg": "identifiable_bystanders_privacy_risk:pareja_reconocible_mas_logo_slescun",
  "BASE/fashion/images.jpg": "color_swatch_catalog_card_not_a_scene",
  "BASE/fashion/images (1).jpg": "color_swatch_catalog_card_not_a_scene",
  "BASE/pastel dusk/images.jpg": "sempertex_watermark:texto_sempertex_y_handle_instagram",
  "BASE/pastel dusk/images (1).jpg": "sempertex_watermark:texto_sempertex_y_swatch",
  "BASE/pastel dusk/images (3).jpg": "sempertex_watermark:texto_sempertex_y_handle_instagram",
  "BASE/pastel mate/D_Q_NP_858838-MLA110800562234_052026-O.webp": "identifiable_bystanders_privacy_risk:grupo_de_personas_reconocibles",
  // Encontrados en la revisión visual de las imágenes ya aprobadas de los temas descargados
  // de sempertex.com/blogs/idea-de-fiesta — mismo isotipo de trébol en la esquina superior
  // derecha que ya se excluía en BASE.
  "halloween/halloween-embrujado.png": "sempertex_watermark:isotipo_trebol_esquina_superior",
  "halloween/halloween-tonos-pasteles.png": "sempertex_watermark:isotipo_trebol_esquina_superior",
  "navidad/decoracion-feliz-ano-nuevo.png": "sempertex_watermark:isotipo_trebol_esquina_superior",
  "navidad/decoracion-navidad-blanca.png": "sempertex_watermark:isotipo_trebol_esquina_superior",
  "navidad/decoracion-navidad-dorada-y-roja.png": "sempertex_watermark:isotipo_trebol_esquina_superior",
  "navidad/decoracion-navidad-dorada.png": "sempertex_watermark:isotipo_trebol_esquina_superior",
  "amor_amistad/mesa-aya-showroom-2026.jpg": "sempertex_watermark:isotipo_trebol_esquina_superior",
  // Revisión visual del lote cumpleanos/pinterest-boards (tablero de terceros, no oficial
  // de Sempertex) — el lote boda/pinterest-boards se descartó completo por bajísima
  // relevancia (~85% sin ni un globo) y ya no existe en disco.
  "cumpleanos/pinterest-boards/17e6f3d8ea7816937e08618b5145ad2c.jpg": "other_brand_watermark:logo_efavormart",
  "cumpleanos/pinterest-boards/302ac638c371ceeb5da453e42f3cce86.jpg": "other_brand_watermark:logo_soon_story",
  "cumpleanos/pinterest-boards/a4c9025add13205b2d6f7c1ddb4ea2e6.jpg": "other_brand_watermark:logo_balonir_co_il",
  "cumpleanos/pinterest-boards/6029c747b32685a1b6939c9a71bbb2f8.jpg": "isolated_product_cutout_not_installed_scene",
  "cumpleanos/pinterest-boards/604a943407bea5ee5cfb19b5efdd876c.jpg": "other_brand_watermark:logo_gentoo_homes_contenido_no_relacionado",
  "cumpleanos/pinterest-boards/752bab85043ee76a526bed89e87d4c25.jpg": "isolated_product_cutout_not_installed_scene",
};

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function slugify(value: string): string {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const slug = normalized.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "image";
}

async function filesRecursively(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await filesRecursively(full));
    else if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

type ManifestRecord = {
  id: string;
  theme: string;
  relative_path: string;
  sha256: string;
  width: number | null;
  height: number | null;
  bytes: number;
  status: "approved" | "quarantine";
  reasons: string[];
  sanitized_path: string | null;
};

async function main(): Promise<void> {
  const input = path.resolve(argument("--input", DEFAULT_INPUT));
  const sanitizedRoot = path.resolve(argument("--output", "data/sanitized/sempertex-training-v002"));
  const manifestPath = path.resolve(argument("--manifest", "data/manifests/sempertex-training-v002-manifest.jsonl"));
  const targetWidth = Number(argument("--width", "1024"));
  const targetHeight = Number(argument("--height", "1024"));
  const minSide = Number(argument("--min-side", "1024"));
  // "cover" recorta al centro para llenar el lienzo exacto (mismo tamaño para todas, sin barras).
  // "inside" conserva la imagen completa dentro del lienzo, puede dejar franjas si la proporción no calza.
  const fit = argument("--fit", "cover") as "cover" | "inside" | "contain";

  const files = await filesRecursively(input);
  const seenHash = new Map<string, string>();
  const records: ManifestRecord[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const relative = path.relative(input, file).replaceAll("\\", "/");
    const theme = relative.split("/")[0] ?? "unknown";
    const bytes = await readFile(file);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const reasons: string[] = [];

    const manualReason = MANUAL_EXCLUDE[relative];
    if (manualReason) reasons.push(`manual_exclude:${manualReason}`);

    if (seenHash.has(sha256)) reasons.push(`duplicate_of:${seenHash.get(sha256)}`);
    else seenHash.set(sha256, relative);

    let width: number | null = null;
    let height: number | null = null;
    try {
      const meta = await sharp(bytes).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
      if (!width || !height) reasons.push("unreadable_dimensions");
      else if (Math.min(width, height) < minSide) reasons.push(`min_side_below_${minSide}`);
    } catch {
      reasons.push("corrupt_or_unsupported_image");
    }

    const status: ManifestRecord["status"] = reasons.length ? "quarantine" : "approved";
    let sanitizedPath: string | null = null;

    if (status === "approved") {
      const themeDir = path.join(sanitizedRoot, theme);
      await mkdir(themeDir, { recursive: true });
      const stem = slugify(path.basename(relative, path.extname(relative)));
      const outFile = path.join(themeDir, `${stem}.png`);
      const outLicense = path.join(themeDir, `${stem}.png.license.json`);

      // rotate() sin argumentos aplica la orientación EXIF y luego el re-encode a PNG
      // descarta el resto de metadata (sharp no preserva metadata salvo que se pida con withMetadata()).
      await sharp(bytes)
        .rotate()
        .resize(targetWidth, targetHeight, { fit, position: "centre" })
        .png({ compressionLevel: 6 })
        .toFile(outFile);
      await writeFile(
        outLicense,
        `${JSON.stringify(
          {
            source: "unverified_download",
            approval: "pending_human_confirmation",
            note: "Procedencia sin confirmar (nombre de archivo tipo descarga de buscador de imágenes). No incluir en un ZIP de entrenamiento hasta confirmar fuente/derechos.",
            original_relative_path: relative,
            original_sha256: sha256,
            sanitized_file: path.basename(outFile),
            original_width: width,
            original_height: height,
            resized_to: { width: targetWidth, height: targetHeight, fit },
            metadata_removed: true,
          },
          null,
          2,
        )}\n`,
        "utf-8",
      );
      sanitizedPath = path.relative(process.cwd(), outFile).replaceAll("\\", "/");
    }

    records.push({
      id: `img-${String(index + 1).padStart(4, "0")}`,
      theme,
      relative_path: relative,
      sha256,
      width,
      height,
      bytes: bytes.length,
      status,
      reasons,
      sanitized_path: sanitizedPath,
    });
  }

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""),
    "utf-8",
  );

  const byTheme = new Map<string, { approved: number; quarantine: number }>();
  for (const record of records) {
    const entry = byTheme.get(record.theme) ?? { approved: 0, quarantine: 0 };
    entry[record.status] += 1;
    byTheme.set(record.theme, entry);
  }

  console.log(
    JSON.stringify(
      {
        input,
        sanitizedRoot,
        manifestPath,
        outputSize: { width: targetWidth, height: targetHeight, fit },
        totalFiles: records.length,
        approved: records.filter((record) => record.status === "approved").length,
        quarantine: records.filter((record) => record.status === "quarantine").length,
        minSide,
        byTheme: Object.fromEntries(byTheme),
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
