// Congela el catálogo público de Sempertex (tienda en línea, precios B2C) en `src/lib/shopify/datos/catalogo-publico.json`.
// Es lo que /catalogo muestra en Vercel: allí la base SQLite vive en /tmp y cada instancia arranca vacía, así que el catálogo
// viaja con el código (ver `catalogo-vigente.ts`). Se corre antes de desplegar cuando cambian precios o disponibilidad.
// Hace las mismas descargas que `POST /api/shopify/sync` (products.json + inventario del CDN); no toca ninguna base.
//
// Uso: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/catalogo/generar-snapshot-publico.ts

import { writeFileSync } from "node:fs";
import { descargarCatalogoCanonico } from "../../src/lib/shopify/descargar-catalogo";
import { VERSION_SNAPSHOT_CATALOGO, type SnapshotCatalogo } from "../../src/lib/shopify/snapshot-esquema";

const DESTINO = new URL("../../src/lib/shopify/datos/catalogo-publico.json", import.meta.url);

async function main(): Promise<void> {
  const productos = await descargarCatalogoCanonico();
  if (productos.length === 0) throw new Error("La tienda no devolvió productos cotizables: no se escribe un snapshot vacío.");
  const snapshot: SnapshotCatalogo = {
    version: VERSION_SNAPSHOT_CATALOGO,
    generadoEn: new Date().toISOString(),
    productos,
  };
  writeFileSync(DESTINO, JSON.stringify(snapshot));
  const variantes = productos.reduce((n, p) => n + p.variantes.length, 0);
  console.log(`Snapshot del catálogo público: ${productos.length} productos, ${variantes} variantes → ${DESTINO.pathname}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
