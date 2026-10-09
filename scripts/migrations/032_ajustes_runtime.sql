-- REQ-007 (fase 0): ajustes de ejecución que se cambian sin desplegar. El primero es `guiada_motor` (3d|python): con qué
-- motor se crea un plan nuevo de la guiada (D-024); la app lo lee con un caché de 30 s y, sin fila, usa la variable de
-- entorno GUIADA_MOTOR y por último python. Aditiva e idempotente (migrate.ts registra cada archivo en schema_migrations y lo aplica una sola vez): solo crea la tabla.
-- No inserta ninguna fila: sin fila manda la variable de entorno. Para activar el 3D en producción:
--   INSERT INTO ajustes_runtime (clave, valor, actualizado_por) VALUES ('guiada_motor', '3d', 'dueño')
--   ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now(), actualizado_por = EXCLUDED.actualizado_por;
-- Para volver a Python al instante: valor 'python' (o DELETE de la fila).
--
-- rollback: DROP TABLE ajustes_runtime;
-- La app tolera que la tabla no exista (vuelve a la variable de entorno), así que el rollback no rompe nada.

CREATE TABLE IF NOT EXISTS ajustes_runtime (
  clave           TEXT PRIMARY KEY,
  valor           TEXT NOT NULL,
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_por TEXT
);
