-- Tamaño/forma como dato de primera clase por variante (PLAN_TAMANOS_GLOBO.md
-- F1). Hoy `catalog_variants.options` guarda option1 crudo ("R-12") sin
-- decodificar y sin índice — el retrieval no puede filtrar ni ordenar por
-- diámetro. Estas columnas espejan exactamente lo que `decodificarTamano()`
-- (src/lib/shopify/derivar.ts) ya calcula para el catálogo SQLite —
-- mismo derivado, misma fuente de verdad, ahora también disponible donde
-- corre el retrieval real (Postgres).

-- rollback: DROP INDEX ix_catalog_variants_forma_diam; ALTER TABLE catalog_variants
-- DROP COLUMN alto_cm; ALTER TABLE catalog_variants DROP COLUMN largo_pulg;
-- ALTER TABLE catalog_variants DROP COLUMN ancho_cm; ALTER TABLE catalog_variants DROP COLUMN diam_pulg;
-- ALTER TABLE catalog_variants DROP COLUMN forma; ALTER TABLE catalog_variants DROP COLUMN codigo_tamano;
-- Pierde los datos decodificados de tamaño/forma y su índice; exportar antes y
-- no ejecutar mientras el retrieval o escritores activos los utilicen.

ALTER TABLE catalog_variants ADD COLUMN IF NOT EXISTS codigo_tamano TEXT;
ALTER TABLE catalog_variants ADD COLUMN IF NOT EXISTS forma         TEXT;
ALTER TABLE catalog_variants ADD COLUMN IF NOT EXISTS diam_pulg     NUMERIC;
ALTER TABLE catalog_variants ADD COLUMN IF NOT EXISTS largo_pulg    NUMERIC;
ALTER TABLE catalog_variants ADD COLUMN IF NOT EXISTS ancho_cm      NUMERIC;
ALTER TABLE catalog_variants ADD COLUMN IF NOT EXISTS alto_cm       NUMERIC;

-- El resolver de tamaños (F3) busca "variantes redondas de este producto,
-- ordenadas por cercanía a un diámetro objetivo" una vez por línea de
-- despiece — sin índice recorre secuencialmente cada vez.
CREATE INDEX IF NOT EXISTS ix_catalog_variants_forma_diam
  ON catalog_variants (product_id, forma, diam_pulg);
