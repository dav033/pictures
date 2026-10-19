-- Franjas de presupuesto (PLAN_RAG_FRANJAS_PRESUPUESTO.md §5.1). La fuente
-- de verdad de las 4 franjas y sus recetas vive en código
-- (src/lib/rag/presupuesto/franjas.ts) — esta tabla es un override opcional
-- para el admin: puede mover rangos y cuotas, nunca crear ni borrar una
-- franja ni cambiar los 5 roles.

-- rollback: DROP INDEX ix_catalog_variants_price_avail; ALTER TABLE rag_query_log
-- DROP COLUMN relajaciones; ALTER TABLE rag_query_log DROP COLUMN utilizacion;
-- ALTER TABLE rag_query_log DROP COLUMN canasta; ALTER TABLE rag_query_log DROP COLUMN plan_canasta;
-- ALTER TABLE rag_query_log DROP COLUMN franja; DROP TABLE presupuesto_franjas;
-- Pierde los overrides de franjas y la trazabilidad de planes/canastas; exportar
-- antes y no ejecutar mientras haya administradores o escritores activos.

CREATE TABLE IF NOT EXISTS presupuesto_franjas (
  slug            TEXT PRIMARY KEY,
  min_cop         NUMERIC NOT NULL,
  max_cop         NUMERIC,            -- NULL = sin techo (escena_completa)
  recetas         JSONB NOT NULL,     -- roles -> {min,max,tope_fraccion,categorias}
  utilizacion_min NUMERIC NOT NULL DEFAULT 0.75,
  activa          BOOLEAN NOT NULL DEFAULT TRUE,
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trazabilidad (§5.1): sin esto no se puede reconstruir "por qué esta
-- canasta y no otra" más allá de lo que ya guardaba rag_query_log.
ALTER TABLE rag_query_log ADD COLUMN IF NOT EXISTS franja TEXT;
ALTER TABLE rag_query_log ADD COLUMN IF NOT EXISTS plan_canasta JSONB;
ALTER TABLE rag_query_log ADD COLUMN IF NOT EXISTS canasta JSONB;
ALTER TABLE rag_query_log ADD COLUMN IF NOT EXISTS utilizacion NUMERIC;
ALTER TABLE rag_query_log ADD COLUMN IF NOT EXISTS relajaciones JSONB;

-- Banda de precio a nivel de variante (F2/F3): sin este índice, el EXISTS
-- por producto y el retrieval por rol recorren catalog_variants sin apoyo
-- para (product_id, available, price) — barato hoy (3.727 filas), pero es
-- la consulta que se repite una vez por rol en cada turno con franja activa.
CREATE INDEX IF NOT EXISTS ix_catalog_variants_price_avail
  ON catalog_variants (product_id, available, price);
