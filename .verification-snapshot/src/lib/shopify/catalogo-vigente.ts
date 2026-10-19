import "server-only";
import { getDb } from "@/lib/db";
import { persistirCatalogo } from "./persistir-catalogo";
import { leerSnapshotCatalogo, type SnapshotCatalogo } from "./snapshot-esquema";

/**
 * El catálogo público que ven /catalogo, su ficha y `/api/catalogo/piezas`. En Vercel la base SQLite vive en /tmp y cada
 * instancia arranca vacía, y nada la llena (no hay cron ni nadie llama a `/api/shopify/sync`): la página decía «0 productos».
 * Por eso, una instancia con `shopify_producto` vacía se siembra una vez con el snapshot que viaja con el código
 * (`datos/catalogo-publico.json`, de `scripts/catalogo/generar-snapshot-publico.ts`): sin red ni Neon en el arranque en frío.
 *
 * Por qué no Neon: sus tablas `catalog_*` son el catálogo B2B (handles `b2b-`, precios mayoristas, otros ids de producto), y
 * esta página dice «precios B2C» y enlaza a la tienda pública. Por qué no sincronizar en vivo: cada arranque en frío llamaría
 * a Shopify y la tienda limita las peticiones.
 *
 * Una base que ya tiene catálogo (un sync en vivo, el disco del PC o del VPS) no se toca.
 */

let sembrando: Promise<void> | null = null;

function hayCatalogo(): boolean {
  return getDb().prepare("SELECT 1 AS hay FROM shopify_producto LIMIT 1").get() !== undefined;
}

async function cargarSnapshot(): Promise<SnapshotCatalogo> {
  // Import dinámico: solo la instancia que arranca vacía paga los 5 MB del snapshot.
  const { default: datos } = await import("./datos/catalogo-publico.json");
  return leerSnapshotCatalogo(datos);
}

async function sembrarDesdeSnapshot(): Promise<void> {
  const snapshot = await cargarSnapshot();
  // Mientras se cargaba el snapshot pudo terminar un sync en vivo: lo más reciente no se pisa.
  if (hayCatalogo()) return;
  const db = getDb();
  persistirCatalogo(db, snapshot.productos, snapshot.generadoEn);
  const variantes = snapshot.productos.reduce((n, p) => n + p.variantes.length, 0);
  const inventarioCruzado = snapshot.productos.reduce((n, p) => n + p.variantes.filter((v) => v.inventarioFuente === "cdn").length, 0);
  db.prepare(
    `INSERT INTO shopify_sync (iniciado_en, terminado_en, productos, variantes, inventario_cruzado, error)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run(snapshot.generadoEn, snapshot.generadoEn, snapshot.productos.length, variantes, inventarioCruzado);
}

/** Deja el catálogo listo en esta instancia. Llamadas a la vez comparten una sola siembra; si falla, la siguiente reintenta. */
export function asegurarCatalogo(): Promise<void> {
  if (hayCatalogo()) return Promise.resolve();
  sembrando ??= sembrarDesdeSnapshot().finally(() => {
    sembrando = null;
  });
  return sembrando;
}
