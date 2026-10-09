-- REQ-011: caché de renders con IA de los módulos del estudio (dúo … sexteto). Una fila por clave canónica
-- (`<versión del pipeline>:<tipo>:<tamaño>:<colores canónicos>`); la imagen vive en el almacén de objetos (Garage, S3)
-- en `objeto_key`. La clave primaria es lo que garantiza una sola generación por combinación: el servicio reserva la
-- clave con un INSERT ... ON CONFLICT DO NOTHING (estado 'pendiente') y solo marca 'lista' DESPUÉS de guardar el objeto.
-- Aditivo e idempotente (migrate.ts re-ejecuta cada .sql).
--
-- rollback: DROP TABLE modulos_renders;
-- Pierde el índice de renders guardados (las imágenes siguen en el almacén bajo `modulos/`); se pueden volver a generar.

CREATE TABLE IF NOT EXISTS modulos_renders (
  clave            TEXT PRIMARY KEY,
  tipo             TEXT NOT NULL CHECK (tipo IN ('pareja', 'trio', 'cuarteto', 'quinteto', 'sexteto')),
  formato_id       TEXT NOT NULL,
  -- Un código Sempertex por globo, en la forma canónica (reducida por las simetrías del módulo).
  colores          JSONB NOT NULL,
  version_pipeline TEXT NOT NULL,
  estado           TEXT NOT NULL CHECK (estado IN ('pendiente', 'lista')),
  objeto_key       TEXT,
  mime             TEXT,
  coste_usd        NUMERIC(8, 4),
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completado_en    TIMESTAMPTZ,
  -- Ficha de la reserva vigente: solo quien la tiene completa o libera la fila (una reserva tomada por caducada no se pisa).
  dueno            TEXT,
  -- Nunca una fila lista sin imagen, ni una pendiente con imagen.
  CONSTRAINT modulos_renders_objeto_coherente CHECK ((estado = 'lista') = (objeto_key IS NOT NULL))
);

-- Galería (US-4): listas por tipo y versión, las más nuevas primero.
CREATE INDEX IF NOT EXISTS ix_modulos_renders_galeria ON modulos_renders (tipo, version_pipeline, completado_en DESC) WHERE estado = 'lista';
