// Utilidad de un solo uso para el clasificador externo de temas (proyecto aparte, fuera del
// repo). Extrae, de las órdenes reales en RUTA_ORDENES, los SKU efectivamente comprados y los
// cruza con el catálogo Shopify para producir un manifest.json que el clasificador HTML consume
// (imagen, colores/ocasiones ya derivados, y cuántas veces se referenció en el entrenamiento).
// No escribe nada en la base ni en las órdenes -- solo lee y exporta.
//
// Uso: npx tsx scripts/exportar-productos-referenciados.ts [ruta-salida.json]

import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const RUTA_ORDENES = process.env.ORDENES_DECORACION_DIR ?? "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";
// Abre el sqlite directo con node:sqlite en vez de importar src/lib/db.ts: ese módulo trae
// `import "server-only"`, que revienta fuera del build de Next -- este script de exportación es
// de solo lectura y no necesita nada más de esa capa.
const db = new DatabaseSync(path.join(process.cwd(), "data", "demo.sqlite"), { readOnly: true });

type LineaDesglose = { producto: string; variante: string | null; sku: string | null; cantidad: number; precioUnitario: number };
type Desglose = { orden: string; cliente: string | null; fecha: string | null; lineas: LineaDesglose[] };

type FilaCatalogoPorSku = {
  producto_id: string;
  titulo_limpio: string;
  imagen_principal: string | null;
  colores: string;
  ocasiones: string;
  categoria: string | null;
};

export type ProductoReferenciado = {
  sku: string;
  titulo: string;
  imagen: string | null;
  categoria: string | null;
  colores: string[];
  ocasiones: string[];
  vecesReferenciado: number;
  cantidadTotal: number;
};

function catalogoPorSku(sku: string): FilaCatalogoPorSku | undefined {
  return db
    .prepare(
      `SELECT p.id AS producto_id, p.titulo_limpio, p.imagen_principal, p.colores, p.ocasiones, p.categoria
       FROM shopify_variante v
       JOIN shopify_producto p ON p.id = v.producto_id
       WHERE v.sku = ?
       LIMIT 1`,
    )
    .get(sku) as FilaCatalogoPorSku | undefined;
}

async function extraer(): Promise<ProductoReferenciado[]> {
  const carpetas = (await readdir(RUTA_ORDENES, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const porSku = new Map<string, { vecesReferenciado: number; cantidadTotal: number }>();

  for (const numero of carpetas) {
    const rutaDesglose = path.join(RUTA_ORDENES, numero, "desglose.json");
    if (!existsSync(rutaDesglose)) continue;
    let desglose: Desglose;
    try {
      desglose = JSON.parse(await readFile(rutaDesglose, "utf-8"));
    } catch {
      continue;
    }
    for (const linea of desglose.lineas) {
      if (!linea.sku) continue;
      const existente = porSku.get(linea.sku);
      if (existente) {
        existente.vecesReferenciado += 1;
        existente.cantidadTotal += linea.cantidad;
      } else {
        porSku.set(linea.sku, { vecesReferenciado: 1, cantidadTotal: linea.cantidad });
      }
    }
  }

  const resultado: ProductoReferenciado[] = [];
  for (const [sku, conteo] of porSku) {
    const catalogo = catalogoPorSku(sku);
    if (!catalogo) continue; // fuera de alcance: no mapea a un producto real del catálogo
    resultado.push({
      sku,
      titulo: catalogo.titulo_limpio,
      imagen: catalogo.imagen_principal,
      categoria: catalogo.categoria,
      colores: JSON.parse(catalogo.colores || "[]"),
      ocasiones: JSON.parse(catalogo.ocasiones || "[]"),
      vecesReferenciado: conteo.vecesReferenciado,
      cantidadTotal: conteo.cantidadTotal,
    });
  }

  resultado.sort((a, b) => b.vecesReferenciado - a.vecesReferenciado);
  return resultado;
}

async function main(): Promise<void> {
  const rutaSalida = process.argv[2] ?? "productos-referenciados.json";
  const productos = await extraer();
  await writeFile(rutaSalida, JSON.stringify(productos, null, 2), "utf-8");
  console.log(`${productos.length} productos referenciados y mapeados al catálogo -> ${rutaSalida}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
