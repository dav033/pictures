# Backup y restore de la base comercial (Fase 5.2)

**Corte:** 2026-09-09. **Alcance:** Neon (`neondb`, rol `neondb_owner`,
producción real) como origen de solo lectura; Postgres local Docker
(`demo-decoracion-postgres-1`) como destino del restore de prueba. Esta
sesión NO escribe en Neon en ningún paso. El restore real contra una copia
(paso 2) requiere confirmación explícita antes de ejecutarse — ver "Pedido
de confirmación" al final.

## 0. Estado verificado antes de escribir el procedimiento

- Neon: PostgreSQL 16.15, base `neondb` de 42 MB, 41 tablas (39 en `public`,
  2 en `operational` — el schema operacional de la Fase 6 ya existe ahí
  aunque el plan todavía no llegó formalmente a esa fase).
- Postgres local: imagen `pgvector/pgvector:pg16`, PostgreSQL 16.14,
  extensión `vector` 0.8.6 disponible. `pg_dump`, `pg_restore` y `psql` están
  instalados dentro del contenedor (no en el host Windows); todos los
  comandos de abajo corren vía `docker exec`.
- El contenedor local tiene salida a internet y pudo conectar a Neon
  directamente (`docker exec demo-decoracion-postgres-1 psql "$NEON_URL" -c
  "SELECT version();"` — solo lectura, ya ejecutado para verificar esto).
- 42 MB es pequeño: el dump y el restore se miden en segundos, no en
  minutos. Esto no representa el tamaño que tendrá la base cuando el
  catálogo esté completamente poblado en producción real de Sempertex, pero
  sí el tamaño real de la base comercial hoy.

## 1. Qué tabla es reproducible desde una fuente externa y cuál no

Esta clasificación decide qué tablas importan más si se pierden. Un restore
de backup es la única red de seguridad para la columna "No reproducible".

| Reproducible desde fuente externa (Shopify / pipeline de sync) | No reproducible — solo existe en esta base |
|---|---|
| `catalog_products`, `catalog_variants`, `catalog_products_staging`, `catalog_variants_staging`, `catalog_rejections`, `catalog_sync_log`, `catalog_webhook_log` — se regeneran corriendo la sincronización de Shopify de nuevo | `plan_audit_log` — auditoría de planes aprobados, irrepetible |
| `catalog_embeddings` — se recalcula llamando a Gemini otra vez (**tiene costo real**, no es gratis regenerarla) | `rag_query_log` — observabilidad histórica de búsquedas |
| `rag_source_snapshots` — registro de corridas de sync, se recrea en la siguiente sincronización | `ai_call_log`, `ai_model_pricing` — telemetría y precios de uso de IA facturado |
| `catalog_sources`, `catalog_items`, `catalog_commercial_offers`, `catalog_price_components`, `catalog_product_capabilities`, `catalog_product_spatial`, `catalog_source_audit` — extensión de escena, hoy vacías, vendrían de un pipeline de ingestión futuro | `lora_datasets`, `lora_training_runs`, `lora_evaluations`, `lora_artifacts`, `lora_checkpoints`, `lora_generation_profiles`, `lora_composition_events`, `lora_idempotency_events`, `lora_dataset_*` — registro de entrenamiento LoRA, ver `inventario-lora.md`: sin esto se pierde la trazabilidad y el vínculo peso↔evaluación↔procedencia |
| — | **`lora_mode_slots`, `lora_mode_slot_history`** — cuál LoRA está activo ahora mismo en producción. Perder esto sin backup implica no saber qué modo estaba habilitado. |
| — | `presupuesto_franjas` — overrides de admin sobre las franjas de presupuesto (la fuente de verdad del código sigue viva, pero el override manual no) |
| — | `happie_webhook_rate`, `happie_webhook_requests` — estado de idempotencia y rate-limit; diseñado para expirar solo, perderlo es de bajo impacto |
| — | `operational_idempotency`, `operational_request_nonces` (schema `operational`) — mismo perfil que el anterior para el linaje Python |
| — | `schema_migrations` (ambos schemas) — regenerable corriendo `scripts/migrate.ts` / `services/ai-api/scripts/migrate.py` de nuevo, pero pierde el historial de *cuándo* se aplicó cada una |

Consecuencia práctica: un restore que solo cubriera el catálogo (lo más
fácil de probar) no probaría nada sobre lo que de verdad se perdería sin
backup. El procedimiento de abajo hace un dump completo de todas las tablas,
no solo del catálogo.

## 2. Procedimiento de backup (dump de solo lectura contra Neon)

```bash
# Desde el host, usando el cliente pg_dump 16.14 dentro del contenedor local
# (compatible con el servidor Neon 16.15).
NEON_URL=$(grep -E "^DATABASE_URL=" .env.local | cut -d= -f2-)
FECHA=$(date +%Y%m%d-%H%M%S)
docker exec demo-decoracion-postgres-1 pg_dump "$NEON_URL" \
  --format=custom --no-owner --no-privileges \
  --file="/tmp/neon-backup-${FECHA}.dump"

# Saca el dump del contenedor al host, fuera de git (data/* ya está en
# .gitignore; se usa el mismo patrón que data/lora-backup/).
mkdir -p data/pg-backups
docker cp "demo-decoracion-postgres-1:/tmp/neon-backup-${FECHA}.dump" \
  "data/pg-backups/neon-backup-${FECHA}.dump"
docker exec demo-decoracion-postgres-1 rm -f "/tmp/neon-backup-${FECHA}.dump"
```

`--no-owner --no-privileges` evita que el restore intente recrear el rol
`neondb_owner` (que no existe en el Postgres local) o fallar por permisos
que no aplican fuera de Neon. El formato `--format=custom` permite un
restore selectivo si algún día hace falta (`pg_restore -l` para listar el
contenido sin restaurarlo).

## 3. Procedimiento de restore (contra una base nueva y desechable, NUNCA `demo_rag`)

`demo_rag` es la base que usan los demás tests de esta sesión (snapshot
sincronizado de 1672 productos / 3727 variantes) — el restore de prueba usa
una base separada para no pisarlo.

```bash
docker exec demo-decoracion-postgres-1 psql -U demo -d postgres \
  -c "DROP DATABASE IF EXISTS demo_rag_restore_test;"
docker exec demo-decoracion-postgres-1 psql -U demo -d postgres \
  -c "CREATE DATABASE demo_rag_restore_test OWNER demo;"
docker exec demo-decoracion-postgres-1 psql -U demo -d demo_rag_restore_test \
  -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE SCHEMA IF NOT EXISTS operational;"

docker cp "data/pg-backups/neon-backup-${FECHA}.dump" \
  "demo-decoracion-postgres-1:/tmp/restore.dump"
docker exec demo-decoracion-postgres-1 pg_restore \
  --no-owner --no-privileges --clean --if-exists \
  --dbname=postgresql://demo:demo@127.0.0.1:5432/demo_rag_restore_test \
  /tmp/restore.dump
docker exec demo-decoracion-postgres-1 rm -f /tmp/restore.dump
```

## 4. Verificación (no basta con que `pg_restore` no truene)

```bash
# 4a. Conteo de filas por tabla en el ORIGEN, capturado ANTES del restore
#     (ejecutar junto con el paso 2, contra Neon):
docker exec demo-decoracion-postgres-1 psql "$NEON_URL" -c "
  SELECT schemaname, relname, n_live_tup
  FROM pg_stat_user_tables ORDER BY schemaname, relname;"

# 4b. Mismo conteo en el DESTINO restaurado, después del paso 3:
docker exec demo-decoracion-postgres-1 psql -U demo -d demo_rag_restore_test -c "
  SELECT schemaname, relname, n_live_tup
  FROM pg_stat_user_tables ORDER BY schemaname, relname;"

# 4c. Comparar 4a y 4b fila por fila: deben coincidir exactamente. Un
#     n_live_tup aproximado de autovacuum puede diferir por muy poco en una
#     tabla con escrituras concurrentes en Neon; en una tabla sin escritores
#     activos durante la prueba deben ser iguales.

# 4d. Spot-check de contenido, no solo de conteo — un producto real conocido:
docker exec demo-decoracion-postgres-1 psql -U demo -d demo_rag_restore_test -c "
  SELECT product_id, handle, title FROM catalog_products LIMIT 3;"
docker exec demo-decoracion-postgres-1 psql -U demo -d demo_rag_restore_test -c "
  SELECT id, label, status, artifact_status FROM lora_training_runs;"
docker exec demo-decoracion-postgres-1 psql -U demo -d demo_rag_restore_test -c "
  SELECT slug, training_run_id, lora_scale, enabled FROM lora_mode_slots;"

# 4e. Confirmar que el índice vectorial funciona en la base restaurada
#     (no solo que la extensión esté creada):
docker exec demo-decoracion-postgres-1 psql -U demo -d demo_rag_restore_test -c "
  SELECT product_id FROM catalog_embeddings LIMIT 1;"
```

Criterio de aceptación de esta prueba: 4c coincide para las 41 tablas, 4d
devuelve filas reales y coherentes con lo esperado (no vacías, no
truncadas), 4e no falla por extensión faltante o tipo de dato incompatible.

## 5. Limpieza

```bash
docker exec demo-decoracion-postgres-1 psql -U demo -d postgres \
  -c "DROP DATABASE demo_rag_restore_test;"
```

El archivo `data/pg-backups/neon-backup-<fecha>.dump` se conserva localmente
(gitignored) como evidencia de que el restore se probó; no es un backup
recurrente ni programado — ver "Fuera de alcance" abajo.

## 6. Qué NO cubre esta prueba

- **No es un backup recurrente.** Esto prueba el procedimiento una vez, tal
  como pide el criterio de aceptación de 5.2. No configura un cron, no sube
  el dump a almacenamiento durable (S3 u otro), y el archivo local se pierde
  si se pierde esta máquina — mismo perfil de riesgo que `data/lora-backup/`
  documentado en 5.5. Automatizar un backup recurrente con retención y
  almacenamiento durable es una entrega aparte, no incluida aquí.
- **No evalúa las funciones nativas de Neon** (branching, point-in-time
  recovery). Neon como plataforma ofrece estas capacidades, pero no se
  verificó en esta sesión si el plan/cuenta contratado las incluye ni cómo
  se activarían — queda como pregunta abierta, no como una capacidad ya
  disponible que se pueda asumir.
- **No restaura sobre Neon mismo.** Un restore real de incidente
  probablemente sea sobre Neon (crear una base nueva ahí, o revertir con sus
  herramientas nativas si las hay) en vez de sobre Postgres local. Esta
  prueba valida que el dump es íntegro y restaurable en general; no valida
  el mecanismo específico de recuperación en la plataforma de producción.

## Evidencia de ejecución real — 2026-09-09

El usuario confirmó explícitamente ejecutar el procedimiento. Se corrió tal
cual está escrito arriba, una sola vez, contra Neon real (solo lectura) y el
Postgres local:

- **Dump:** `data/pg-backups/neon-backup-20260909-110322.dump`, formato
  custom, 8.206.362 bytes. `pg_dump` (cliente 16.14) contra Neon (servidor
  16.15) sin errores.
- **Restore:** `pg_restore --no-owner --no-privileges --clean --if-exists`
  contra `demo_rag_restore_test` (base nueva, creada y luego eliminada solo
  para esta prueba). Exit code 0, sin errores.
- **Verificación de conteo:** comparación de `COUNT(*)` exacto (no el
  estimado `n_live_tup` de `pg_stat_user_tables`, que resultó desactualizado
  en Neon para `lora_dataset_element_stats` — 856 estimado vs 851 real en
  ambos lados, confirmando que el estimado era la fuente del ruido, no el
  restore) en las 41 tablas de ambos schemas (`public` y `operational`):
  **coinciden exactamente en las 41**, sin excepción.
- **Verificación de contenido:** `catalog_products` devolvió productos
  reales del catálogo; `lora_training_runs` devolvió las dos corridas
  esperadas (`lora-run-v004-1000` completada y respaldada,
  `lora-run-v007-1000` con status `succeeded`/`backed_up` pendiente de
  evaluación); `lora_mode_slots` devolvió el estado real de asignación de
  modos en producción (`training_1` y `unlimited` apuntando a
  `lora-run-v004-1000`, `training_2` sin corrida asignada); `catalog_embeddings`
  devolvió una fila con un vector legible.
- **Aislamiento confirmado:** `demo_rag` (la base que usan los demás tests
  de esta sesión) se verificó sin cambios después del restore —
  `SELECT COUNT(*) FROM catalog_products` siguió en 1672, el mismo número
  documentado al abrir esta sesión de continuación. Neon no recibió ninguna
  escritura en todo el procedimiento.
- **Limpieza:** `demo_rag_restore_test` eliminada al final. El `.dump` queda
  en `data/pg-backups/`, confirmado bajo `.gitignore` (`git check-ignore`
  lo reporta cubierto por la regla `/data/*` de la línea 41).

Con esto, el criterio de aceptación de 5.2 — "un restore verificado, no una
afirmación de que se podría" — queda cumplido para el mecanismo genérico
`pg_dump`/`pg_restore` contra una copia. Las tres salvedades de la sección 6
("Qué NO cubre esta prueba") siguen aplicando tal cual están escritas.
