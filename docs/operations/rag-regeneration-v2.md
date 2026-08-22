# Runbook operativo — RAG v2

Este runbook opera el catálogo RAG reconstruido desde dos fuentes CDN fijadas. La ruta obligatoria es determinista y SQL; Gemini y vector son opcionales. Una ejecución no se promueve por “no haber lanzado excepciones”: cada gate debe tener `PASS` o `SKIPPED_OPTIONAL` explícito en `release-manifest.json`; cualquier `FAIL` detiene la promoción.

## 1. Fuentes, límites y seguridad

Fuentes aprobadas:

- `products_catalog.json`: `https://cdn.shopify.com/s/files/1/0983/2752/7703/files/products_catalog.json?v=1779763986`
- `order_data.json`: `https://cdn.shopify.com/s/files/1/0983/2752/7703/files/order_data.json?v=1779763985de`

El catálogo es autoridad para producto, variante, precio, estado, disponibilidad e inventario. Las órdenes solo producen `observed_demand` decaída; nunca son stock, pagos ni fulfillment.

No persistir ni imprimir cuerpos RAW, `customer.id`, order IDs, line-item IDs, credenciales ni API keys. Los manifests guardan únicamente URL, timestamp, content-type, bytes, SHA-256, versión de contrato y conteos agregados. Los IDs de Shopify del catálogo son artefactos restringidos, no datos de cliente.

La aplicación conserva dos corpus intencionalmente separados: SQLite legado tiene `1671` productos y `3724` variantes (`/catalogo` muestra `1456`), mientras PostgreSQL RAG tiene `1411` productos y `3592` variantes. No hay solapamiento exacto de IDs (`0` productos, `0` variantes). Por eso `/api/generate` no infiere la fuente: `productIds` resuelve en SQLite y `ragVariantIds` en PostgreSQL.

## 2. Flags de despliegue

```dotenv
DATABASE_URL=<valor local o secreto del entorno>
RAG_ENABLED=true
RAG_USE_VECTOR=true
RAG_USE_FULLTEXT=true
RAG_USE_TRIGRAM=true
```

El estado local validado es `RAG_ENABLED=true` con vector habilitado. Usar `RAG_ENABLED=false` sólo durante una reimportación controlada, diagnóstico o rollback, y reactivar el flag después de los gates del mismo snapshot. La ruta determinista no-key sigue siendo obligatoria; vector requiere key, pgvector, embeddings completos y evidencia de recall/latencia.

## 3. Bootstrap local

```bash
test -f .env.local || cp .env.example .env.local
docker compose up -d postgres
docker compose ps
npm run rag:migrate
npm run rag:stack-check
```

`rag:migrate` aplica las 10 migraciones, incluida `010_variant_package_units.sql`. Esta migración conserva `unidades_paq=NULL` cuando el título CDN no contiene evidencia parseable; en el snapshot aprobado hay `3518` variantes conocidas y `74` desconocidas. La ruta RAG usa los IDs y metadata de PostgreSQL, no depende de IDs ni proyecciones SQLite.

En PowerShell:

```powershell
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
docker compose up -d postgres
docker compose ps
npm run rag:migrate
npm run rag:stack-check
```

El compose publica Postgres en loopback. `docker compose down -v` destruye el volumen y no es un procedimiento de rollback.

## 4. Validar fuentes antes de publicar

Fixtures, sin red ni escritura:

```bash
npx tsx scripts/validate-source-snapshots.ts --offline --fixtures eval/fixtures
```

URLs fijadas por defecto, con timeout/reintentos, contrato Zod, SHA y conteos:

```bash
npx tsx scripts/validate-source-snapshots.ts --url
```

URLs explícitas (primero productos, luego órdenes):

```bash
npx tsx scripts/validate-source-snapshots.ts \
  --url "https://cdn.shopify.com/s/files/1/0983/2752/7703/files/products_catalog.json?v=1779763986" \
  --url "https://cdn.shopify.com/s/files/1/0983/2752/7703/files/order_data.json?v=1779763985de" \
  --manifest data/manifests/rag-source-validation.json
```

Un cambio de conteos en modo default es un bloqueo: revisar el corpus y actualizar el contrato con evidencia; no ocultarlo con `--allow-partial`.

## 5. Publicar catálogo por staging

Dry-run offline:

```bash
npx tsx scripts/import-cdn-catalog.ts \
  --offline \
  --fixture eval/fixtures/products_catalog.fixture.json \
  --dry-run \
  --manifest data/manifests/rag-products-source.json
```

Publicación validada:

```bash
npx tsx scripts/import-cdn-catalog.ts \
  --manifest data/manifests/rag-products-source.json
```

El importador descarga/valida en memoria, canoniza SKU/taxonomía/precio/disponibilidad, carga staging, aplica `--max-drop-ratio` (default `0.5`) y publica en una transacción. `--allow-partial` solo se permite con incidente documentado y revisión explícita de conteos.

Después, comprobar solo metadatos:

```sql
SELECT source_snapshot_id, source_kind, source_sha256, status,
       published_products, published_variants, rejected_records, fetched_at
  FROM rag_source_snapshots
 WHERE source_kind = 'products_catalog'
 ORDER BY fetched_at DESC;

SELECT COUNT(*) AS products,
       COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active_products
  FROM catalog_products;

SELECT COUNT(*) AS variants,
       COUNT(*) FILTER (WHERE available) AS available_variants
  FROM catalog_variants;
```

## 6. Importar demanda sin PII

Dry-run completamente offline:

```bash
npx tsx scripts/import-order-aggregates.ts \
  --offline \
  --fixture eval/fixtures/order_data.fixture.json \
  --catalog-fixture eval/fixtures/products_catalog.fixture.json \
  --dry-run \
  --manifest data/manifests/rag-order-demand.json
```

Publicación contra el catálogo ACTIVE ya publicado:

```bash
npx tsx scripts/import-order-aggregates.ts \
  --manifest data/manifests/rag-order-demand.json
```

El agregado guarda variante/producto, SKU canónico, `observed_demand`, conteo, unidades, fechas, half-life y peso decaído. El mismo SHA reemplaza sus filas de forma idempotente y elimina filas stale de ese snapshot. Los snapshots históricos no se suman automáticamente como si fueran pedidos nuevos: antes de promover una nueva fuente se debe revisar la política de snapshot activo y el estado del manifest.

## 7. Health, build y evaluación

Después de cualquier reimportación, actualizar estadísticas antes de medir retrieval:

```powershell
docker compose exec -T postgres psql -U rag -d rag -c "ANALYZE catalog_products; ANALYZE catalog_variants; ANALYZE catalog_embeddings; ANALYZE rag_order_demand_aggregates;"
```

Health base sin key:

```bash
npm run rag:stack-check
```

`npm run rag:health` además prueba un embedding real y por eso requiere `GEMINI_API_KEY`; con la key disponible, la corrida validada terminó `PASS` junto con PostgreSQL, pgvector y embeddings de 768 dimensiones. Si falta, su fallo es opcional y no invalida `stack-check` ni el E2E no-key.

Build y tipos:

```bash
npm run lint
npx tsc -p tsconfig.json --noEmit --pretty false
npm run build
npm run rag:test-generation-resolver
```

Retrieval no-key:

```bash
npx tsx scripts/bench-retrieval-v2.ts --no-key
```

E2E determinista. El baseline medido y versionado debe venir de `--baseline`, `RAG_E2E_BASELINE_P95_MS`, `release-manifest.json` o `reports/rag-baseline-v2.md`; siempre se aplica además el límite absoluto de 2.100 ms. No usar el límite absoluto como baseline medido salvo bootstrap explícito:

```bash
npm run rag:e2e-v2
```

Con Gemini, únicamente cuando la key ya está configurada en el entorno y el release lo permite:

```bash
npm run rag:e2e-v2:gemini
```

En PowerShell, el comando no-key es `npm run rag:e2e-v2` y el comando Gemini carga `.env.local` y usa explícitamente `--conditions=react-server` para cargar módulos server-only. El E2E comprueba parser 3/3, SKU original/canónico/conversacional, SKU ambiguo como aclaración, inexistente sin fallback semántico, filtros same-variant de precio/stock/forma/diámetro/color, corazón, whitelist, selección, precio/subtotal desde PG, unidades de paquete, presupuesto, health y estados opcionales. Una variante fuera de whitelist, precio inventado o ID inexistente termina con exit code distinto de cero.

Evidencia final de integración: `npm run rag:e2e-v2` terminó `PASS` con `0` fallos, p95 no-key `88.2 ms` y `2` skips opcionales; `npm run rag:e2e-v2:gemini` terminó `PASS` con `0` fallos, p95 `446.8 ms` y límite absoluto PASS. El gate de regresión contra baseline no-key fue `SKIPPED_OPTIONAL` porque los embeddings remotos no son comparables. `npm run rag:test-generation-resolver` terminó `PASS` tras recuperar Docker; cubre metadata PG, legado Shopify real, legado curado, orden mixto, IDs desconocidos, duplicados, payload runtime y frontera HTTP sin proveedor pagado. La resolución usa revalidación confiable (`ACTIVE`, disponible y precio `> 0`), no heurística ni fallback, conserva el orden legado→RAG y mantiene procedencia en multi-turn y cotizaciones editadas.

La generación validada en HTTP producción local (puerto `3010`) pasa por la frontera de catálogo: sin key, `/api/generate` con IDs PG o legados alcanza el error esperado `503 sin_llave`, no un `400` de validación; con Gemini disponible, una solicitud real PG respondió `200` con imagen presente. `/api/chat` real respondió `200` SSE con eventos `herramienta`, `texto` y `fin`, sin error. FAL no se utilizó; la ruta determinista obligatoria sí quedó verificada.

La corrida integrada de navegador también quedó en `PASS`: raíz/catálogo/búsqueda `globo corazón rojo` devolvió `28`, `forma=corazon` (Corazón) + `color=rojo` (rojo) devolvió `10`, y detalle → selección → frontera de generación terminó con `0` errores de consola y estado limpiado.

## 8. Promoción

La implementación actual publica durante `import-cdn-catalog.ts` dentro de `persistStagedCatalog`; no existe un comando independiente `promote(snapshot_id)`. Por ello una promoción operativa es una importación completa, validada e idempotente del SHA aprobado, no un cambio de puntero instantáneo. El release debe guardar:

- snapshot ID y SHA de productos y órdenes;
- conteos publicados/rechazados;
- versión de contrato y taxonomía;
- flags (`RAG_ENABLED`, `RAG_USE_VECTOR`, `RAG_USE_TRIGRAM`);
- resultado de build, health, benchmark y E2E;
- baseline p95 y ruta de rollback.

Con todos los gates obligatorios en `PASS`, se conserva `RAG_ENABLED=true` en el entorno local aprobado. La ausencia de key deja vector/Gemini como `SKIPPED_OPTIONAL`, nunca como PASS implícito.

## 9. Fetch stale, parcial o fallido

Bloquear publicación ante timeout/reintentos agotados, content-type incorrecto, contrato inválido, SHA no aprobado, caída fuera de `maxDropRatio`, exceso de rechazos, snapshot fuera de la ventana operativa o manifest inconsistente. El código valida timeout, reintentos, contrato, SHA y caída parcial; la edad máxima del snapshot se decide operacionalmente comparando `fetched_at` con la ventana aprobada antes de ejecutar el importador.

Si falla dentro de la transacción, Postgres conserva el catálogo anterior. Si alcanza `published`, seguir `docs/operations/rag-rollback-v2.md`; no reintentar con `--allow-partial` por reflejo.

## 10. Retención

Conservar manifests, hashes, snapshots aprobados, backups y staging necesario para recuperación. Antes de purgar staging, rechazos o demanda histórica: backup verificable, conteos comparados, auditoría de snapshots y comprobación de que no contiene customer/order/line-item IDs. No hacer DELETE ad-hoc ni purgar el volumen Docker.

## 11. Checklist de una corrida

- [ ] `.env.local` no está versionado y no se imprimen secretos.
- [ ] Postgres healthy y bind loopback.
- [ ] `npm run rag:migrate` PASS.
- [ ] Fixtures y URLs fijadas PASS, con SHA registrado.
- [ ] Importación staged/publicación PASS sin caída no autorizada.
- [ ] Demanda agregada PASS sin PII y replay-safe.
- [ ] `stack-check`, lint, tsc y build PASS.
- [ ] Benchmark no-key PASS por familia.
- [ ] E2E no-key PASS; `npm run rag:e2e-v2:gemini` PASS cuando haya key, o Gemini/vector `SKIPPED_OPTIONAL` explícito si no la hay.
- [ ] No quedan P0/P1 de whitelist, precio, disponibilidad o snapshot.
- [ ] Manifest versionado y rollback verificable.
- [ ] `RAG_ENABLED=true` sólo en el snapshot cuyos gates obligatorios están en `PASS`.
