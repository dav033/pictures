import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { obtenerInventarioCdnRag, obtenerProductosPublicosRag } from "../src/lib/rag/catalog/fetch-shopify";
import { mapaInventarioCDN, normalizarProducto } from "../src/lib/rag/catalog/normalize";
import { upsertProducto } from "../src/lib/rag/catalog/persist";
import type { CatalogRejection } from "../src/lib/rag/catalog/schemas";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

const SNAPSHOT_PATH = path.join(process.cwd(), "data", "raw", "shopify-products.snapshot.json");

async function persistirRechazo(pool: Pool, r: CatalogRejection): Promise<void> {
  await pool.query(
    `INSERT INTO catalog_rejections (source_id, reason, raw_payload) VALUES ($1, $2, $3)`,
    [r.source_id, r.reason, JSON.stringify(r.raw_payload)],
  );
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada.");
  const pool = new Pool({ connectionString: url });
  const iniciadoEn = new Date().toISOString();

  try {
    console.log("Descargando catálogo público de Shopify...");
    const [crudos, inventarioCrudo] = await Promise.all([
      obtenerProductosPublicosRag(),
      obtenerInventarioCdnRag(),
    ]);
    mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
    writeFileSync(
      SNAPSHOT_PATH,
      JSON.stringify({ productos: crudos, inventario: inventarioCrudo }, null, 2),
      "utf-8",
    );
    console.log(`Snapshot RAW guardado en ${SNAPSHOT_PATH} (${crudos.length} productos crudos).`);

    const inventario = mapaInventarioCDN(inventarioCrudo);

    let normalizados = 0;
    let variantesTotal = 0;
    let rechazados = 0;
    const motivosRechazo = new Map<string, number>();
    const handlesVistos = new Set<string>();
    const idsVistos = new Set<string>();
    let duplicados = 0;
    let sinImagenes = 0;
    let eliminados = 0;
    let purgaOmitidaPorCaidaFuerte = false;

    await pool.query("BEGIN");
    try {
      await pool.query("DELETE FROM catalog_rejections");

      for (const raw of crudos) {
        const resultado = normalizarProducto(raw, inventario);

        if (!resultado.ok) {
          rechazados++;
          motivosRechazo.set(
            resultado.rechazo.reason,
            (motivosRechazo.get(resultado.rechazo.reason) ?? 0) + 1,
          );
          await persistirRechazo(pool, resultado.rechazo);
          continue;
        }

        const { producto, variantes } = resultado;

        if (idsVistos.has(producto.product_id) || handlesVistos.has(producto.handle)) {
          duplicados++;
          await persistirRechazo(pool, {
            source_id: producto.product_id,
            reason: "duplicado (product_id o handle repetido)",
            raw_payload: raw,
          });
          continue;
        }
        idsVistos.add(producto.product_id);
        handlesVistos.add(producto.handle);

        if (producto.image_urls.length === 0) sinImagenes++;

        await upsertProducto(pool, producto, variantes);
        normalizados++;
        variantesTotal += variantes.length;
      }

      // Shopify es la fuente de verdad (G-03): lo que ya no está en el RAW no
      // puede seguir vivo en la DB o el retrieval devolvería productos
      // deslistados. Solo se purga si de verdad llegó catálogo — así un fetch
      // vacío por fallo de red nunca borra el catálogo entero (mismo criterio
      // que el sync SQLite existente). El CASCADE limpia variantes y embeddings.
      //
      // El guard de "normalizados > 0" solo cubre el caso extremo (cero
      // productos). No cubre un fetch PARCIAL pero no-vacío — ej. Shopify
      // devolviendo solo una categoría por un filtro roto de su lado — que
      // igual pasaría ese guard y purgaría productos válidos que simplemente
      // no vinieron en esa corrida. Se compara contra el último sync
      // exitoso: una caída de más de la mitad es señal de fetch parcial, no
      // de catálogo real reducido a la mitad de un día para otro.
      const { rows: ultimoSync } = await pool.query<{ normalized_products: number }>(
        `SELECT normalized_products FROM catalog_sync_log
         WHERE error IS NULL AND normalized_products IS NOT NULL
         ORDER BY started_at DESC LIMIT 1`,
      );
      const normalizadosAnterior = ultimoSync[0]?.normalized_products ?? 0;
      purgaOmitidaPorCaidaFuerte = normalizadosAnterior > 0 && normalizados < normalizadosAnterior * 0.5;

      if (normalizados > 0 && !purgaOmitidaPorCaidaFuerte) {
        const purga = await pool.query(
          "DELETE FROM catalog_products WHERE NOT (product_id = ANY($1::text[]))",
          [[...idsVistos]],
        );
        eliminados = purga.rowCount ?? 0;
      }

      await pool.query(
        `INSERT INTO catalog_sync_log
           (started_at, finished_at, raw_products, normalized_products, normalized_variants, rejected_products, error)
         VALUES ($1, now(), $2, $3, $4, $5, NULL)`,
        [iniciadoEn, crudos.length, normalizados, variantesTotal, rechazados + duplicados],
      );

      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }

    console.log("\n--- Estadísticas Fase 2 ---");
    console.log(`raw_products: ${crudos.length}`);
    console.log(`normalized_products: ${normalizados}`);
    console.log(`normalized_variants: ${variantesTotal}`);
    console.log(`rejected_products: ${rechazados + duplicados}`);
    console.log(`duplicates: ${duplicados}`);
    console.log(`products_without_images: ${sinImagenes}`);
    console.log(`deleted_stale_products: ${eliminados}`);
    if (purgaOmitidaPorCaidaFuerte) {
      console.error(
        `[FAIL] normalized_products (${normalizados}) cayó a menos de la mitad del último sync exitoso — purga OMITIDA por seguridad. Probablemente un fetch parcial de Shopify, no un catálogo real reducido. Revisa el snapshot en ${SNAPSHOT_PATH} antes de reintentar.`,
      );
    }
    console.log("motivos de rechazo:");
    for (const [motivo, n] of motivosRechazo) console.log(`  - ${motivo}: ${n}`);

    // Los criterios se MIDEN contra la DB ya escrita, no se declaran: un PASS
    // hardcodeado no es evidencia de nada (plan: "STOP + auditar datos").
    const verificaciones: { criterio: string; sql: string }[] = [
      {
        criterio: "ningún producto sin product_id",
        sql: "SELECT COUNT(*)::int AS n FROM catalog_products WHERE product_id IS NULL OR product_id = ''",
      },
      {
        criterio: "ningún variant sin variant_id",
        sql: "SELECT COUNT(*)::int AS n FROM catalog_variants WHERE variant_id IS NULL OR variant_id = ''",
      },
      {
        criterio: "price idéntico al de source_payload (Shopify)",
        sql: "SELECT COUNT(*)::int AS n FROM catalog_variants WHERE (source_payload->>'price')::numeric <> price",
      },
      {
        criterio: "search_text presente en todo producto",
        sql: "SELECT COUNT(*)::int AS n FROM catalog_products WHERE search_text IS NULL OR search_text = ''",
      },
      {
        criterio: "embedding_source_hash presente en todo producto",
        sql: "SELECT COUNT(*)::int AS n FROM catalog_products WHERE embedding_source_hash IS NULL OR embedding_source_hash = ''",
      },
      {
        criterio: "cada rechazo tiene razón",
        sql: "SELECT COUNT(*)::int AS n FROM catalog_rejections WHERE reason IS NULL OR reason = ''",
      },
      {
        criterio: "ningún variant huérfano",
        sql: `SELECT COUNT(*)::int AS n FROM catalog_variants v
              LEFT JOIN catalog_products p ON p.product_id = v.product_id
              WHERE p.product_id IS NULL`,
      },
    ];

    console.log("\n--- Criterios de aceptación (medidos) ---");
    let algunFallo = normalizados === 0 || purgaOmitidaPorCaidaFuerte;
    console.log(`[${normalizados > 0 ? "PASS" : "FAIL"}] al menos un producto normalizado`);

    for (const { criterio, sql } of verificaciones) {
      const { rows } = await pool.query<{ n: number }>(sql);
      const violaciones = rows[0].n;
      if (violaciones !== 0) algunFallo = true;
      console.log(`[${violaciones === 0 ? "PASS" : "FAIL"}] ${criterio}${violaciones === 0 ? "" : ` — ${violaciones} violación(es)`}`);
    }

    if (algunFallo) {
      console.error("\n[FAIL] Fase 2 NO cumple sus criterios de aceptación. No continuar a Fase 3.");
      process.exitCode = 1;
    } else {
      console.log("\n[PASS] Fase 2 cumple sus criterios de aceptación.");
    }
  } catch (error) {
    await pool.query(
      `INSERT INTO catalog_sync_log (started_at, finished_at, error) VALUES ($1, now(), $2)`,
      [iniciadoEn, error instanceof Error ? error.message : String(error)],
    );
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[FAIL] importación falló:", error);
  process.exitCode = 1;
});
