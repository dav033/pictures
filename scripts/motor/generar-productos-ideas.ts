import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PlanesIdeasArchivoSchema } from "../../src/lib/plan/plan-de-idea";

/**
 * Regenera `src/lib/globos3d/motor/datos/productos-ideas.json`: de cada variante que usan las ideas de la biblioteca,
 * el título del producto, su color, su acabado y su talla, leídos del plan resuelto de cada idea
 * (`data/biblioteca-real/analisis/*.plan.json`). El plan guardado de una idea trae solo `product_id`/`variant_id`;
 * el motor 3D necesita el título («Fashion Azul Rey») para saber qué tono compra (`colores-espec.ts`).
 *
 *   npx tsx scripts/motor/generar-productos-ideas.ts           # escribe el archivo (sin red, sin coste)
 *   npx tsx scripts/motor/generar-productos-ideas.ts --check   # solo compara; sale con 1 si está desfasado
 */
const RAIZ = path.resolve(__dirname, "..", "..");
const RUTA_PLANES = path.join(RAIZ, "src", "lib", "biblioteca-sempertex", "planes-ideas.json");
const RUTA_ANALISIS = path.join(RAIZ, "data", "biblioteca-real", "analisis");
export const RUTA_PRODUCTOS_IDEAS = path.join(RAIZ, "src", "lib", "globos3d", "motor", "datos", "productos-ideas.json");

type LineaResuelta = { variant_id: string; product_id: string; titulo: string; color: string | null; acabado: string | null; tamano_codigo: string | null };

async function lineasDe(archivo: string): Promise<LineaResuelta[]> {
  const ruta = path.join(RUTA_ANALISIS, archivo);
  if (!existsSync(ruta)) throw new Error(`Falta ${ruta}`);
  const analisis = JSON.parse(await readFile(ruta, "utf8")) as { plan_resuelto?: { estructuras?: Array<{ lineas?: LineaResuelta[] }> } };
  return (analisis.plan_resuelto?.estructuras ?? []).flatMap((e) => e.lineas ?? []);
}

async function construir(): Promise<string> {
  const planes = PlanesIdeasArchivoSchema.parse(JSON.parse(await readFile(RUTA_PLANES, "utf8")));
  const variantes: Record<string, { productId: string; titulo: string; color: string | null; acabado: string | null; tamano: string | null }> = {};
  for (const idea of Object.values(planes.ideas)) {
    for (const linea of await lineasDe(idea.archivo)) {
      variantes[linea.variant_id] = {
        productId: linea.product_id,
        titulo: linea.titulo.split(" — ")[0]!.trim(),
        color: linea.color,
        acabado: linea.acabado,
        tamano: linea.tamano_codigo,
      };
    }
  }
  const ordenadas = Object.fromEntries(Object.entries(variantes).sort(([a], [b]) => (a < b ? -1 : 1)));
  return `${JSON.stringify({ version: 1, snapshot: Object.values(planes.ideas)[0]!.snapshot, variantes: ordenadas }, null, 1)}\n`;
}

async function main(): Promise<void> {
  const esperado = await construir();
  if (process.argv.includes("--check")) {
    const actual = existsSync(RUTA_PRODUCTOS_IDEAS) ? (await readFile(RUTA_PRODUCTOS_IDEAS, "utf8")).replace(/\r\n/g, "\n") : null;
    if (actual !== esperado) { console.error("productos-ideas.json está desfasado: corre scripts/motor/generar-productos-ideas.ts"); process.exit(1); }
    console.log("productos-ideas.json al día");
    return;
  }
  await writeFile(RUTA_PRODUCTOS_IDEAS, esperado, "utf8");
  console.log(`escrito ${path.relative(RAIZ, RUTA_PRODUCTOS_IDEAS)}`);
}

void main();
