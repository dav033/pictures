import "server-only";
import { getDb } from "@/lib/db";
import { MERMA } from "@/lib/cotizacion/motor";
import type { LineaDespiece } from "@/lib/medidas/geometria";

export type LineaResuelta = {
  productId: string;
  variantId: string;
  /** Paquetes cerrados (no unidades sueltas) — mismo contrato que `SeleccionSolicitada.cantidad` en validar.ts. */
  cantidad: number;
  diamPulgPedido: number;
  diamPulgEntregado: number;
  /** No-null cuando el diámetro exacto del despiece no existía en este producto y se usó el más cercano disponible — nunca se sustituye en silencio (decisión del plan §3). */
  sustitucion: { pedido: string; entregado: string; motivo: string } | null;
};

export type ResultadoResolverTamanos = {
  lineas: LineaResuelta[];
  /** Líneas del despiece que este producto no puede cubrir en NINGUNA variante (no tiene globo redondo en absoluto). */
  sinCobertura: LineaDespiece[];
};

type FilaVarianteRedonda = {
  id: string;
  diam_pulg: number;
  disponible: number;
  precio: number;
  unidades_paq: number;
};

/**
 * Traduce un despiece geométrico (plan de tamaños F3, "mezcla de diseñador")
 * a variantes reales de UN producto/color ya elegido por el LLM — el LLM
 * decide QUÉ producto y color usar; este resolver decide CUÁNTO de cada
 * tamaño, en paquetes cerrados.
 *
 * Corre contra el catálogo SQLite (shopify_variante), no Postgres: es la
 * misma fuente que ya usa `mejorVarianteParaTamano`/`aProducto` para
 * resolver la cotización final — `unidades_paq` (paquete real) solo vive
 * ahí, Postgres nunca lo decodificó (plan F1 solo llevó forma/diámetro).
 * `product_id` es el mismo id de Shopify en ambas bases, así que el
 * `productId` que ya pasó la whitelist de Postgres es válido aquí tal cual.
 *
 * Fallback por cercanía (decisión de producto): si este producto no tiene el
 * diámetro exacto de una línea del despiece, se usa el disponible más
 * cercano y se marca en `sustitucion` — el LLM está obligado a decírselo al
 * cliente (nunca sustitución silenciosa). Mismo criterio de desempate que
 * `mejorVarianteParaTamano`: disponible primero, luego menor precio unitario.
 */
export function resolverVariantesPorDespiece(productId: string, despiece: LineaDespiece[]): ResultadoResolverTamanos {
  const filas = getDb()
    .prepare(
      `SELECT id, diam_pulg, disponible, precio, unidades_paq
       FROM shopify_variante
       WHERE producto_id = ? AND forma = 'redondo' AND diam_pulg IS NOT NULL AND precio > 0`,
    )
    .all(productId) as unknown as FilaVarianteRedonda[];

  if (filas.length === 0) {
    return { lineas: [], sinCobertura: despiece };
  }

  const disponibles = filas.filter((f) => f.disponible);
  const candidatos = disponibles.length > 0 ? disponibles : filas;

  const lineas: LineaResuelta[] = [];

  for (const linea of despiece) {
    let mejor = candidatos[0];
    let mejorDist = Math.abs(mejor.diam_pulg - linea.pulgadas);
    for (const candidato of candidatos.slice(1)) {
      const dist = Math.abs(candidato.diam_pulg - linea.pulgadas);
      const mejorPrecioUnit = mejor.precio / Math.max(1, mejor.unidades_paq);
      const candidatoPrecioUnit = candidato.precio / Math.max(1, candidato.unidades_paq);
      if (dist < mejorDist || (dist === mejorDist && candidatoPrecioUnit < mejorPrecioUnit)) {
        mejor = candidato;
        mejorDist = dist;
      }
    }

    const unidadesPaquete = Math.max(1, mejor.unidades_paq);
    const unidadesNecesarias = Math.ceil(linea.cantidad * (1 + MERMA));
    const paquetes = Math.max(1, Math.ceil(unidadesNecesarias / unidadesPaquete));

    lineas.push({
      productId,
      variantId: mejor.id,
      cantidad: paquetes,
      diamPulgPedido: linea.pulgadas,
      diamPulgEntregado: mejor.diam_pulg,
      sustitucion:
        mejorDist > 0
          ? {
              pedido: `R-${linea.pulgadas}`,
              entregado: `R-${mejor.diam_pulg}`,
              motivo: `Este producto no tiene R-${linea.pulgadas} disponible; se usó el diámetro más cercano.`,
            }
          : null,
    });
  }

  return { lineas, sinCobertura: [] };
}
