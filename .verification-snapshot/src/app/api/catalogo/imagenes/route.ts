import { getRagPool } from "@/lib/rag/db";

type FilaImagen = { variant_id: string; imagen: string | null };

export async function GET(request: Request) {
  const variantIds = [...new Set(new URL(request.url).searchParams.getAll("variant_id").filter((id) => id.length > 0 && id.length <= 160))];
  if (variantIds.length === 0 || variantIds.length > 96) {
    return Response.json({ error: "Indica entre 1 y 96 variantes de catálogo." }, { status: 400 });
  }

  const { rows } = await getRagPool().query<FilaImagen>(
    `SELECT v.variant_id,
            COALESCE(NULLIF(BTRIM(v.image_url), ''), NULLIF(BTRIM(p.image_urls[1]), '')) AS imagen
       FROM catalog_variants v
       JOIN catalog_products p ON p.product_id = v.product_id
      WHERE v.variant_id = ANY($1::text[])
        AND p.status = 'ACTIVE'`,
    [variantIds],
  );
  const imagenes = Object.fromEntries(rows.flatMap((fila) => (fila.imagen ? [[fila.variant_id, fila.imagen] as const] : [])));
  return Response.json({ imagenes });
}
