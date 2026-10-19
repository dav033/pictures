import type { Pool } from "pg";
import { digitoDeFiguraNumero } from "@/lib/plan/numeros-pedidos";

type FilaNumero = { product_id: string; titulo: string; categoria: string | null };

const MAX_OPCIONES_POR_DIGITO = 4;

/**
 * Read-only lookup: which number figures of the active catalog pool exist for
 * each digit, in any color. "Los 40 … en dorado" found no "4" because the LoRA
 * dataset only has the 4 in latte (E2E 2026-09-15): the assistant said there
 * was no 4 instead of offering the one there is. Like `buscarGlobosPorColor`,
 * it only informs the model; it never adds a product to the turn whitelist.
 *
 * `variantIds` is the active LoRA dataset pool; `catalogSnapshotId` pins the
 * snapshot the turn searched.
 */
export async function buscarNumerosPorDigito(
  pool: Pick<Pool, "query">,
  digitos: readonly string[],
  opciones: { variantIds?: readonly string[] | null; catalogSnapshotId?: string | null } = {},
): Promise<Map<string, string[]>> {
  const resultado = new Map<string, string[]>();
  const buscados = [...new Set(digitos.filter((digito) => /^\d$/.test(digito)))];
  if (buscados.length === 0 || (opciones.variantIds && opciones.variantIds.length === 0)) return resultado;
  const { rows } = await pool.query<FilaNumero>(
    `SELECT DISTINCT p.product_id, p.title AS titulo, p.derived->>'category' AS categoria
       FROM catalog_products p
       JOIN catalog_variants v ON v.product_id = p.product_id
      WHERE p.status = 'ACTIVE'
        AND p.available = true
        AND v.available = true
        AND p.derived->>'category' IN ('globo_metalizado', 'globo_numero_letra')
        AND p.title ~* $1
        AND ($2::text[] IS NULL OR v.variant_id = ANY($2::text[]))
        AND ($3::text IS NULL OR (p.source_snapshot_id = $3 AND v.source_snapshot_id = $3))
      ORDER BY p.title
      LIMIT 100`,
    [`n[uú]mero\\s+[${buscados.join("")}]([^0-9]|$)`, opciones.variantIds ? [...opciones.variantIds] : null, opciones.catalogSnapshotId ?? null],
  );
  for (const fila of rows) {
    if (typeof fila.titulo !== "string") continue;
    const digito = digitoDeFiguraNumero({ titulo: fila.titulo, categoria: fila.categoria });
    if (!digito || !buscados.includes(digito)) continue;
    const lista = resultado.get(digito) ?? [];
    const titulo = fila.titulo.replace(/^B2b\s+/i, "");
    if (lista.length < MAX_OPCIONES_POR_DIGITO && !lista.includes(titulo)) lista.push(titulo);
    resultado.set(digito, lista);
  }
  return resultado;
}

/** Digits a search message asks for as number figures ("globo metalizado numero 4 dorado"). */
export function digitosBuscados(mensaje: string): string[] {
  const texto = mensaje.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return [...new Set([...texto.matchAll(/\bnumeros?\s+(\d)(?!\d)/g)].map((coincidencia) => coincidencia[1]!))];
}
