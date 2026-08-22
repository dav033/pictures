# Rollback y recuperación — RAG v2

El rollback primero retira tráfico del RAG, después identifica el snapshot exacto y finalmente restaura datos o esquema desde una copia verificable. No se usa `docker compose down -v` como recuperación.

## 1. Cuándo bloquear

En staging o en el entorno que atiende tráfico, establecer `RAG_ENABLED=false` y detener nuevas importaciones ante:

- fuente stale, parcial, truncada o con SHA no aprobado;
- caída de productos/variantes fuera del guard;
- precio, stock, SKU, forma, diámetro o color atribuidos a otra variante;
- ID/precio/variante fuera de whitelist;
- SKU ambiguo que se selecciona sin aclaración;
- búsqueda no-key que depende de Gemini/vector;
- benchmark, E2E, build o health con exit code distinto de cero;
- migración o índice no verificable;
- manifest que no coincide con la DB publicada.

No activar vector, `--allow-partial` ni una nueva importación para ocultar un fallo.

## 2. Contención inmediata

1. Cambiar `RAG_ENABLED=false` y retirar tráfico si aplica.
2. Detener `rag:sync`, `import-cdn-catalog.ts`, `import-order-aggregates.ts` y `generate-embeddings.ts`.
3. Conservar contenedor y volumen; no ejecutar `down -v`.
4. Capturar solo metadatos:

```sql
SELECT source_snapshot_id, source_kind, source_sha256, status,
       fetched_at, published_at, published_products,
       published_variants, rejected_records, rejection_reason
  FROM rag_source_snapshots
 ORDER BY fetched_at DESC;

SELECT source_snapshot_id, COUNT(*) AS products
  FROM catalog_products_staging
 GROUP BY source_snapshot_id
 ORDER BY source_snapshot_id;

SELECT source_snapshot_id, COUNT(*) AS variants
  FROM catalog_variants_staging
 GROUP BY source_snapshot_id
 ORDER BY source_snapshot_id;
```

5. Guardar deployment/commit, snapshot ID/SHA, flags, versión de taxonomía, modelo/dimensión opcional y manifest. No guardar cuerpos RAW ni IDs de cliente.

## 3. Falla antes de `published`

`persistStagedCatalog` ejecuta staging, upserts, purga stale y auditoría en una transacción. Si el importador termina `[FAIL]`, verificar que el snapshot anterior sigue publicado:

```sql
SELECT source_snapshot_id, status, published_at,
       published_products, published_variants, rejected_records
  FROM rag_source_snapshots
 WHERE source_kind = 'products_catalog'
 ORDER BY fetched_at DESC;

SELECT COUNT(*) AS products FROM catalog_products;
SELECT COUNT(*) AS variants FROM catalog_variants;
```

Si los conteos publicados cambiaron pese al error, detener el servicio y pasar al backup; no ejecutar otro importador encima.

## 4. Snapshot publicado incorrecto

La implementación actual no tiene `promote(snapshot_id)` independiente. El rollback de datos se hace por una de estas rutas, en este orden:

1. Restaurar backup de Postgres tomado antes de la publicación y verificar su SHA/manifest.
2. Si el cuerpo exacto está disponible, ejecutar de nuevo `import-cdn-catalog.ts` con la misma fuente aprobada y confirmar que el SHA coincide.
3. Volver a importar demanda con el manifest del snapshot correspondiente; no mezclar demanda de un snapshot de órdenes con otro catálogo.

Ejemplo de reimportación controlada:

```bash
$env:RAG_ENABLED = "false"
npm run rag:migrate
npx tsx scripts/import-cdn-catalog.ts --manifest data/manifests/rag-products-source.json
npx tsx scripts/import-order-aggregates.ts --manifest data/manifests/rag-order-demand.json
docker compose exec -T postgres psql -U rag -d rag -c "ANALYZE catalog_products; ANALYZE catalog_variants; ANALYZE catalog_embeddings; ANALYZE rag_order_demand_aggregates;"
npm run rag:stack-check
npm run rag:e2e-v2
```

No llamar a una nueva descarga “rollback” si el SHA no coincide con el snapshot aprobado.

El rollback target aprobado es `RAG_ENABLED=false` más reimportación exacta de estos SHA: productos `13a9033d8c72f30fa60f75c825358c21537fd869bf0e666d659d7be047f0ce42` y órdenes `d4f5dd037656209f25b018274877333bd134560df5f055168410ffeaac58b414`. El RAG ya no depende de IDs ni metadata SQLite. `010_variant_package_units.sql` conserva `3518` unidades conocidas y `74` desconocidas como `NULL`; un desconocido no se convierte en una unidad inventada.

## 5. Esquema e índices

`scripts/migrate.ts` aplica las migraciones aún no registradas y no implementa `down`. Antes de revertir esquema, hacer backup, registrar `schema_migrations` y probar la recuperación en una copia. No editar tablas activas a mano para “arreglar” un gate.

Para una regresión atribuida exclusivamente a índices 009, identificar primero el nombre exacto en `pg_indexes`, tomar backup de metadatos y retirar solo los índices de esa migración mediante una ventana controlada. No eliminar extensiones compartidas ni índices base de FTS/SKU sin aprobación del mismo release. Reaplicar la migración y ejecutar `stack-check`, `bench-retrieval-v2.ts --no-key` y E2E antes de reactivar tráfico.

## 6. Stale, parcial o inconsistente

No publicar si:

- el SHA cambia entre validación y publicación;
- `fetched_at` excede la ventana de frescura aprobada;
- el guard `--max-drop-ratio` se dispara;
- el contrato o content-type falla;
- hay demasiados rechazos o faltan columnas/índices obligatorios;
- no existe backup/manifest de recuperación.

`--allow-partial` requiere un incidente con conteos, motivo y aprobación. Si la transacción falla, reintentar solo después de verificar que el snapshot anterior sigue intacto.

## 7. Recuperación y promoción

1. Restaurar DB o reimportar el SHA aprobado.
2. Ejecutar `npm run rag:migrate` y comprobar extensiones/índices.
3. Ejecutar `npm run rag:stack-check`, lint, tsc y build.
4. Ejecutar `ANALYZE` y después `npx tsx scripts/bench-rag-v2.ts --no-key --repeat 2` y `npm run rag:e2e-v2`.
5. Para la comprobación opcional con key, usar `npx tsx --conditions=react-server scripts/eval-e2e-rag-v2.ts --with-gemini`.
6. Verificar que el E2E no reporta variantes fuera de whitelist, precios inventados, SKU ambiguo auto-seleccionado ni IDs inválidos.
7. Actualizar `release-manifest.json` con snapshot, SHA, hashes de artefactos, gates y rollback target.
8. Mantener `RAG_ENABLED=false` durante recuperación; activar `RAG_ENABLED=true` sólo después de todos los gates obligatorios PASS y observar métricas.

Gemini/vector se registra como `SKIPPED_OPTIONAL` si no hay key, pgvector o embeddings completos. Nunca habilitarlo como paso de recuperación automática.

## 8. Retención después del rollback

Conservar el snapshot fallido, manifest, logs agregados, backup y snapshot recuperado hasta cerrar el incidente. Al purgar, hacerlo por snapshot ID en una transacción, con backup y verificación de ausencia de claves `customer`, `order`, `line_item`, payloads crudos o secretos. Mantener el volumen Docker mientras sea la única copia recuperable.

## 9. Checklist de cierre

- [ ] Tráfico RAG bloqueado durante diagnóstico.
- [ ] Causa, snapshot ID/SHA y backup registrados.
- [ ] No se expusieron cuerpos RAW, secretos ni IDs de cliente.
- [ ] Conteos publicados/staging/demanda comparados.
- [ ] `schema_migrations`, extensiones e índices revisados.
- [ ] No-key search y E2E PASS; opcionales etiquetadas.
- [ ] El manifest apunta al snapshot recuperado y contiene rollback target.
- [ ] `RAG_ENABLED=true` solo después de todos los gates obligatorios.
