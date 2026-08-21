-- La config 'spanish' de Postgres pliega acentos (el stemmer Snowball los
-- quita) pero NO la ñ: buscar "cumpleanos" devolvía 0 de 668 productos que
-- dicen "Cumpleaños". El FTS5 de SQLite que ya usa el proyecto sí lo maneja
-- (tokenize = "unicode61 remove_diacritics 2"), así que sin esto el retrieval
-- nuevo sería PEOR que el actual para una consulta que la gente escribe todo
-- el tiempo sin ñ.
--
-- unaccent() es STABLE, no IMMUTABLE, así que no se puede llamar directo en
-- una columna generada. La vía soportada es encadenarlo dentro de una text
-- search configuration: to_tsvector('config', texto) sí es IMMUTABLE cuando
-- la config va como constante.

CREATE EXTENSION IF NOT EXISTS unaccent;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'spanish_unaccent') THEN
    CREATE TEXT SEARCH CONFIGURATION spanish_unaccent (COPY = spanish);
    ALTER TEXT SEARCH CONFIGURATION spanish_unaccent
      ALTER MAPPING FOR hword, hword_part, word
      WITH unaccent, spanish_stem;
  END IF;
END
$$;

-- Guard de idempotencia: migrate.ts re-ejecuta todos los .sql en cada corrida,
-- y recrear la columna generada recalcula el tsvector de TODAS las filas. Solo
-- se hace si todavía apunta a la config vieja.
DO $$
DECLARE
  expresion TEXT;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid)
    INTO expresion
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE c.relname = 'catalog_products'
    AND a.attname = 'search_tsv'
    AND NOT a.attisdropped;

  IF expresion IS NULL OR expresion NOT LIKE '%spanish_unaccent%' THEN
    -- La columna es generada: se recalcula sola desde search_text, así que
    -- recrearla no pierde información.
    ALTER TABLE catalog_products DROP COLUMN IF EXISTS search_tsv;
    ALTER TABLE catalog_products
      ADD COLUMN search_tsv TSVECTOR
      GENERATED ALWAYS AS (to_tsvector('spanish_unaccent', coalesce(search_text, ''))) STORED;
    CREATE INDEX IF NOT EXISTS ix_catalog_products_tsv ON catalog_products USING GIN (search_tsv);
  END IF;
END
$$;
