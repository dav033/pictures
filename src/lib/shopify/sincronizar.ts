import "server-only";
import { getDb } from "@/lib/db";
import { descargarCatalogoCanonico } from "./descargar-catalogo";
import { persistirCatalogo } from "./persistir-catalogo";

export type ResultadoSync = {
  productos: number;
  variantes: number;
  inventarioCruzado: number;
};

/**
 * Pipeline completo. Todo el fetch + procesamiento pasa por memoria ANTES de
 * tocar la base de datos: si products.json o el CDN fallan a mitad de
 * camino, el catálogo anterior sigue intacto — nunca se deja el demo sin
 * catálogo por un fallo de red a medias.
 */
export async function sincronizarCatalogo(): Promise<ResultadoSync> {
  const iniciadoEn = new Date().toISOString();
  const db = getDb();

  try {
    const canonicos = await descargarCatalogoCanonico();

    persistirCatalogo(db, canonicos, new Date().toISOString());

    const variantes = canonicos.reduce((n, p) => n + p.variantes.length, 0);
    const inventarioCruzado = canonicos.reduce(
      (n, p) => n + p.variantes.filter((v) => v.inventarioFuente === "cdn").length,
      0,
    );

    db.prepare(
      `INSERT INTO shopify_sync (iniciado_en, terminado_en, productos, variantes, inventario_cruzado, error)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    ).run(iniciadoEn, new Date().toISOString(), canonicos.length, variantes, inventarioCruzado);

    return { productos: canonicos.length, variantes, inventarioCruzado };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    db.prepare(
      `INSERT INTO shopify_sync (iniciado_en, terminado_en, productos, variantes, inventario_cruzado, error)
       VALUES (?, ?, NULL, NULL, NULL, ?)`,
    ).run(iniciadoEn, new Date().toISOString(), mensaje);
    throw error;
  }
}
