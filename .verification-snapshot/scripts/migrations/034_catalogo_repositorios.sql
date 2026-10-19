-- REQ-013 fase 2: partición lógica de la biblioteca del taller por repositorio de catálogo (sempertex, mobiliario,
-- escenografia, terceros/<slug>). Aditiva e idempotente: migrate.ts puede re-ejecutarla sin cambiar nada.
-- Todas las filas existentes vienen de la biblioteca de fábrica o de dueños → 'sempertex' (regla R2 del SPEC).
-- `ADD COLUMN … DEFAULT <constante>` solo toca el catálogo en PG ≥ 11 (no reescribe la tabla). No cambia la clave
-- primaria, ni el hash de las fichas, ni los embeddings: nada se vuelve a embeber.
-- Orden de despliegue: esta migración va a Neon ANTES que el código que filtra por `repositorio`. Si el código llega
-- antes, la búsqueda detecta la columna faltante (42703), avisa y busca como hoy (sin el filtro), sin caer a memoria.
--
-- rollback: (después de revertir el código que filtra y escribe la columna; PRIMERO desactivar lo que no es de Sempertex,
-- que sin la columna volvería a valer como Sempertex y aparecería en la búsqueda)
--   UPDATE taller_items SET activo = FALSE, actualizado = now() WHERE repositorio <> 'sempertex';
--   DROP INDEX IF EXISTS ix_taller_items_repositorio;
--   ALTER TABLE taller_items DROP CONSTRAINT IF EXISTS taller_items_repositorio_check;
--   ALTER TABLE taller_items DROP COLUMN IF EXISTS repositorio;
--   DELETE FROM schema_migrations WHERE filename = '034_catalogo_repositorios.sql';

-- migrate.ts corre cada archivo en su transacción: si la tabla está tomada (un indexado en curso), falla en 3 s en vez de
-- dejar en cola las búsquedas detrás del bloqueo de ALTER TABLE.
SET LOCAL lock_timeout = '3s';

ALTER TABLE taller_items ADD COLUMN IF NOT EXISTS repositorio TEXT NOT NULL DEFAULT 'sempertex';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'taller_items_repositorio_check') THEN
    ALTER TABLE taller_items ADD CONSTRAINT taller_items_repositorio_check
      CHECK (repositorio ~ '^(sempertex|mobiliario|escenografia|terceros/[a-z0-9][a-z0-9-]{1,23})$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_taller_items_repositorio ON taller_items (repositorio, activo, tipo);

-- Estadísticas de la columna nueva ya, sin esperar al autovacuum (ADD COLUMN con DEFAULT no toca filas y no lo dispara): sin
-- ellas el planificador estima que `repositorio = ANY('{sempertex}')` deja ~0,5 % de las filas cuando deja el 100 %, y eso
-- cambia el plan de la rama vectorial (HNSW aproximado ↔ orden exacto) y con él los resultados. Solo toca estadísticas.
ANALYZE taller_items;
