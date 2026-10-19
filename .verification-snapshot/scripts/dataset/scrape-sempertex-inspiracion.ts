import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Recorre la galería pública "Ideas de Fiesta" de sempertex.com (sitio server-rendered,
// sin login) por cada tema objetivo del plan v002 y descarga la imagen principal de cada
// artículo a resolución completa (confirmado: el <img> del hero sirve el archivo original,
// no una miniatura — ej. MESA_SHOWROOM.jpg se sirve a 5679x3786).

const OUTPUT_ROOT = "C:\\Users\\david\\Downloads\\SEMPERTEX-TRAINING";
const BASE_URL = "https://sempertex.com";
const CONCURRENCY = 5;
const REQUEST_DELAY_MS = 150; // cortesía con el servidor de Sempertex, no es scraping agresivo

// theme (nombre de carpeta local, igual a los del plan v002) -> tag real del sitio
const THEMES: Record<string, string> = {
  halloween: "halloween",
  navidad: "navidad",
  boda: "aniversario-y-boda",
  cumpleanos: "cumpleanos",
  amor_amistad: "amor",
};

type ArticleRecord = {
  theme: string;
  tag: string;
  slug: string;
  articleUrl: string;
  title: string | null;
  imageUrl: string | null;
  localPath: string | null;
  status: "downloaded" | "no_hero_image" | "fetch_failed" | "already_exists";
  error: string | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function articleSlugsForTag(tag: string): Promise<string[]> {
  const slugs = new Set<string>();
  for (let pageNumber = 1; pageNumber <= 20; pageNumber += 1) {
    const url = `${BASE_URL}/blogs/idea-de-fiesta/tagged/${tag}/?page=${pageNumber}`;
    let html: string;
    try {
      html = await fetchText(url);
    } catch {
      break;
    }
    if (/404 No encontrado/.test(html) && pageNumber > 1) break;
    const matches = [...html.matchAll(/href="\/blogs\/idea-de-fiesta\/([a-z0-9-]+)"/g)]
      .map((match) => match[1])
      .filter((slug) => slug !== "tagged");
    const before = slugs.size;
    for (const slug of matches) slugs.add(slug);
    if (slugs.size === before && pageNumber > 1) break; // página sin artículos nuevos: se acabó la paginación
    await sleep(REQUEST_DELAY_MS);
  }
  return [...slugs];
}

function extensionFromUrl(url: string, contentType: string | null): string {
  const fromType = contentType?.split(";")[0].trim().toLowerCase();
  const byType: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
  if (fromType && byType[fromType]) return byType[fromType];
  const match = new URL(url).pathname.toLowerCase().match(/\.(jpe?g|png|webp)$/);
  return match ? (match[1] === "jpeg" ? ".jpg" : `.${match[1]}`) : ".jpg";
}

async function processArticle(theme: string, tag: string, slug: string, existing: Set<string>): Promise<ArticleRecord> {
  const articleUrl = `${BASE_URL}/blogs/idea-de-fiesta/${slug}`;
  const base: Omit<ArticleRecord, "status" | "error" | "imageUrl" | "localPath"> = { theme, tag, slug, articleUrl, title: null };
  try {
    const html = await fetchText(articleUrl);
    const heroMatch = html.match(/<div class="article_image mb20">\s*<img src="([^"]+)" alt="([^"]*)"/);
    if (!heroMatch) return { ...base, imageUrl: null, localPath: null, status: "no_hero_image", error: null };

    const imageUrl = heroMatch[1].startsWith("//") ? `https:${heroMatch[1]}` : heroMatch[1];
    const title = heroMatch[2] || null;
    const themeDir = path.join(OUTPUT_ROOT, theme);
    await mkdir(themeDir, { recursive: true });

    if (existing.has(slug)) {
      return { ...base, title, imageUrl, localPath: null, status: "already_exists", error: null };
    }

    const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
    if (!imageResponse.ok) throw new Error(`HTTP ${imageResponse.status} al bajar imagen`);
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    const ext = extensionFromUrl(imageUrl, imageResponse.headers.get("content-type"));
    const fileName = `${slug}${ext}`;
    const filePath = path.join(themeDir, fileName);
    await writeFile(filePath, buffer);
    await writeFile(
      path.join(themeDir, `${slug}.source.json`),
      `${JSON.stringify(
        {
          source: "sempertex.com — blog oficial Ideas de Fiesta",
          theme,
          tag,
          slug,
          title,
          articleUrl,
          imageUrl,
          sha256: createHash("sha256").update(buffer).digest("hex"),
          fetchedAt: new Date().toISOString(),
          approval: "pending_human_confirmation",
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    return { ...base, title, imageUrl, localPath: path.relative(OUTPUT_ROOT, filePath).replaceAll("\\", "/"), status: "downloaded", error: null };
  } catch (error) {
    return { ...base, imageUrl: null, localPath: null, status: "fetch_failed", error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const results: ArticleRecord[] = [];

  for (const [theme, tag] of Object.entries(THEMES)) {
    const themeDir = path.join(OUTPUT_ROOT, theme);
    await mkdir(themeDir, { recursive: true });
    const existingFiles = await readdir(themeDir).catch(() => [] as string[]);
    const existingSlugs = new Set(existingFiles.filter((name) => !name.endsWith(".source.json")).map((name) => name.replace(/\.[a-z]+$/, "")));

    const slugs = await articleSlugsForTag(tag);
    console.log(`[${theme}] tag="${tag}": ${slugs.length} artículos encontrados`);

    let cursor = 0;
    async function worker(): Promise<void> {
      while (cursor < slugs.length) {
        const index = cursor;
        cursor += 1;
        const record = await processArticle(theme, tag, slugs[index], existingSlugs);
        results.push(record);
        await sleep(REQUEST_DELAY_MS);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  }

  const manifestPath = path.resolve("data/manifests/sempertex-inspiracion-scrape.jsonl");
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, results.map((record) => JSON.stringify(record)).join("\n") + (results.length ? "\n" : ""), "utf-8");

  const byTheme = new Map<string, Record<string, number>>();
  for (const record of results) {
    const entry = byTheme.get(record.theme) ?? {};
    entry[record.status] = (entry[record.status] ?? 0) + 1;
    byTheme.set(record.theme, entry);
  }
  console.log(JSON.stringify({ total: results.length, manifestPath, byTheme: Object.fromEntries(byTheme) }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
