import { connection } from "next/server";
import { estadoSync } from "@/lib/shopify/consultas";
import { sincronizarCatalogo } from "@/lib/shopify/sincronizar";

/**
 * MVP síncrono: la ingesta completa (≈7 páginas de products.json + 5 MB de
 * inventario del CDN) tarda unos segundos, así que el POST espera a que
 * termine y devuelve los conteos — sin barra de progreso ni snapshots
 * versionados (eso es la evolución natural de este endpoint si el catálogo
 * crece mucho o el sync se agenda solo).
 */
export async function POST() {
  try {
    const resultado = await sincronizarCatalogo();
    return Response.json({ ok: true, ...resultado });
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "Error desconocido";
    return Response.json({ ok: false, error: detalle }, { status: 502 });
  }
}

export async function GET() {
  await connection();
  return Response.json(estadoSync());
}
