-- REQ-002: índice buscable de la biblioteca del taller 3D (escenas, conjuntos, estructuras, decoraciones, utilería).
-- El código sigue siendo la fuente de los items de fábrica (propietario NULL); esta base es su ÍNDICE y, además,
-- guarda los items propios de cada dueño. Todo es aditivo e idempotente: migrate.ts re-ejecuta cada .sql.
-- Depende de 002 (configuración de búsqueda `spanish_unaccent`) y de pgvector (001).
-- Nota de numeración: el plan nombraba 027, pero 027_imagen_generada_recuperable.sql ya existe en main.

-- rollback: DROP TABLE taller_items_embeddings; DROP TABLE taller_items_partes; DROP TABLE taller_items;
-- DROP TABLE taller_taxonomia; DROP FUNCTION taller_texto_inmutable(text[]);
-- Pierde el índice y los items propios de los dueños (exportar antes; los de fábrica se regeneran con
-- scripts/taller/indexar-biblioteca.ts) y todos los embeddings (costo de recalcularlos).

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- array_to_string es STABLE, así que no sirve dentro de una columna generada (misma razón que unaccent en 002).
-- Este envoltorio es IMMUTABLE porque solo recibe text[] (sin tipos con salida dependiente de la configuración) y
-- convierte guiones y guiones bajos de los ids de taxonomía ("baby-shower") en espacios para que sean palabras.
CREATE OR REPLACE FUNCTION taller_texto_inmutable(valores text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$ SELECT translate(array_to_string(valores, ' '), '_-', '  ') $$;

CREATE TABLE IF NOT EXISTS taller_items (
  id             TEXT PRIMARY KEY,
  tipo           TEXT NOT NULL,
  nombre         TEXT NOT NULL,
  descripcion    TEXT NOT NULL DEFAULT '',
  fuente_tipo    TEXT,
  fuente_titulo  TEXT,
  fuente_url     TEXT,
  foto_url       TEXT,
  ocasiones      TEXT[] NOT NULL DEFAULT '{}',
  celebraciones  TEXT[] NOT NULL DEFAULT '{}',
  tematicas      TEXT[] NOT NULL DEFAULT '{}',
  tipos_pieza    TEXT[] NOT NULL DEFAULT '{}',
  formatos       TEXT[] NOT NULL DEFAULT '{}',
  colores        TEXT[] NOT NULL DEFAULT '{}',
  partes         TEXT[] NOT NULL DEFAULT '{}',
  productos      TEXT[] NOT NULL DEFAULT '{}',
  alto_cm        NUMERIC,
  ancho_cm       NUMERIC,
  fondo_cm       NUMERIC,
  globos         INTEGER NOT NULL DEFAULT 0,
  tubos          INTEGER NOT NULL DEFAULT 0,
  ficha          TEXT NOT NULL DEFAULT '',
  -- Pesos: nombre A, celebraciones y temáticas B, ficha C (la ficha es el texto largo que también se embebe).
  search_tsv     TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('spanish_unaccent', coalesce(nombre, '')), 'A')
    || setweight(to_tsvector('spanish_unaccent', taller_texto_inmutable(celebraciones || tematicas)), 'B')
    || setweight(to_tsvector('spanish_unaccent', coalesce(ficha, '')), 'C')
  ) STORED,
  hash           TEXT NOT NULL,
  -- NULL = de fábrica (lo regenera el indexador); un valor = item guardado por ese dueño.
  propietario    TEXT,
  activo         BOOLEAN NOT NULL DEFAULT TRUE,
  creado         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_taller_items_tsv ON taller_items USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS ix_taller_items_nombre_trgm ON taller_items USING GIN (nombre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_taller_items_ocasiones ON taller_items USING GIN (ocasiones);
CREATE INDEX IF NOT EXISTS ix_taller_items_celebraciones ON taller_items USING GIN (celebraciones);
CREATE INDEX IF NOT EXISTS ix_taller_items_tematicas ON taller_items USING GIN (tematicas);
CREATE INDEX IF NOT EXISTS ix_taller_items_tipos_pieza ON taller_items USING GIN (tipos_pieza);
CREATE INDEX IF NOT EXISTS ix_taller_items_formatos ON taller_items USING GIN (formatos);
CREATE INDEX IF NOT EXISTS ix_taller_items_colores ON taller_items USING GIN (colores);
CREATE INDEX IF NOT EXISTS ix_taller_items_partes ON taller_items USING GIN (partes);
CREATE INDEX IF NOT EXISTS ix_taller_items_productos ON taller_items USING GIN (productos);
CREATE INDEX IF NOT EXISTS ix_taller_items_tipo_activo ON taller_items (tipo, activo);
CREATE INDEX IF NOT EXISTS ix_taller_items_propietario ON taller_items (propietario) WHERE propietario IS NOT NULL;

-- Una línea por (parte, formato, código de color): "tiene LOL-660", "R-24 en 940". El indexador la reemplaza entera
-- cuando cambia el hash del item, así que la clave natural basta.
CREATE TABLE IF NOT EXISTS taller_items_partes (
  item_id     TEXT NOT NULL REFERENCES taller_items(id) ON DELETE CASCADE,
  parte       TEXT NOT NULL,
  formato_id  TEXT NOT NULL,
  codigo      TEXT NOT NULL DEFAULT '',
  cantidad    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, parte, formato_id, codigo)
);

CREATE INDEX IF NOT EXISTS ix_taller_items_partes_formato ON taller_items_partes (formato_id);
CREATE INDEX IF NOT EXISTS ix_taller_items_partes_parte ON taller_items_partes (parte);
CREATE INDEX IF NOT EXISTS ix_taller_items_partes_codigo ON taller_items_partes (codigo);

-- Un vector por (item, modalidad, modelo). gemini-embedding-2 es multimodal en UN espacio, así que una consulta de
-- texto también puede compararse con los vectores de imagen. hash_entrada = hash del texto o de la imagen embebida:
-- si no cambió, no se vuelve a pagar.
CREATE TABLE IF NOT EXISTS taller_items_embeddings (
  item_id       TEXT NOT NULL REFERENCES taller_items(id) ON DELETE CASCADE,
  modalidad     TEXT NOT NULL CHECK (modalidad IN ('texto', 'imagen_foto', 'imagen_render')),
  modelo        TEXT NOT NULL,
  dims          INTEGER NOT NULL DEFAULT 768 CHECK (dims = 768),
  vector        VECTOR(768) NOT NULL,
  hash_entrada  TEXT NOT NULL,
  creado        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, modalidad, modelo)
);

-- HNSW parcial por familia: con un solo índice, el filtro por modalidad se aplica DESPUÉS de recorrer el grafo y
-- una consulta de texto podría quedarse sin candidatos por culpa de las filas de imagen (y al revés). La consulta de
-- texto filtra `modalidad = 'texto'` y la de imagen `modalidad <> 'texto'` para que el planificador use cada índice.
CREATE INDEX IF NOT EXISTS ix_taller_items_embeddings_texto_hnsw
  ON taller_items_embeddings USING hnsw (vector vector_cosine_ops)
  WHERE modalidad = 'texto';
CREATE INDEX IF NOT EXISTS ix_taller_items_embeddings_imagen_hnsw
  ON taller_items_embeddings USING hnsw (vector vector_cosine_ops)
  WHERE modalidad <> 'texto';
CREATE INDEX IF NOT EXISTS ix_taller_items_embeddings_item ON taller_items_embeddings (item_id);

-- Taxonomía cerrada de celebraciones y temáticas (fuente: src/lib/taller/taxonomia-celebraciones.ts) con sinónimos
-- y faltas de ortografía para normalizar lo que escribe la gente.
CREATE TABLE IF NOT EXISTS taller_taxonomia (
  eje         TEXT NOT NULL CHECK (eje IN ('celebracion', 'tematica')),
  id          TEXT NOT NULL,
  nombre      TEXT NOT NULL,
  sinonimos   TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (eje, id)
);

CREATE INDEX IF NOT EXISTS ix_taller_taxonomia_nombre_trgm ON taller_taxonomia USING GIN (nombre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_taller_taxonomia_sinonimos ON taller_taxonomia USING GIN (sinonimos);
