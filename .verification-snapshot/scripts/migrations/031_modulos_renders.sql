-- REQ-011: caché de renders con IA de los módulos del estudio (dúo … sexteto). Una fila por clave canónica
-- (`<versión del pipeline>:<tipo>:<tamaño>:<colores canónicos>`); la imagen vive en el almacén de objetos (Garage, S3)
-- en `objeto_key`. La clave primaria es lo que garantiza una sola generación por combinación: el servicio reserva la
-- clave con un INSERT ... ON CONFLICT DO NOTHING (estado 'pendiente') y solo marca 'lista' DESPUÉS de guardar el objeto.
-- Aditivo e idempotente (migrate.ts re-ejecuta cada .sql).
--
-- También amplía el CHECK de flujos de `ai_call_log` con `modulos_estudio` (el intérprete de pedidos del estudio, Gemini texto);
-- sin eso la telemetría de esa llamada se rechazaría. Orden de despliegue: aplicar ANTES del código que la escribe.
--
-- rollback: DROP TABLE modulos_renders; y volver a crear ai_call_log_flujo_check sin 'modulos_estudio' (antes borrar o
-- reasignar las filas de ai_call_log con ese flujo, o el ADD falla).
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
  -- Quién y con qué base se hizo el render: sha256 de la captura 3D que mandó el cliente y huella de su cookie de sesión
  -- (nunca la cookie). Para auditar un render malo y descartarlo (DELETE de la ruta) sin adivinar de dónde vino.
  -- Huella (16 hex del sha256) del contenido de la imagen guardada: la versión de su URL; así preguntar si hay render no lee el objeto.
  huella_imagen    TEXT,
  captura_sha256   TEXT,
  sesion           TEXT,
  -- Nunca una fila lista sin imagen, ni una pendiente con imagen.
  CONSTRAINT modulos_renders_objeto_coherente CHECK ((estado = 'lista') = (objeto_key IS NOT NULL) AND (estado = 'lista') = (huella_imagen IS NOT NULL))
);

-- Galería (US-4): listas por tipo y versión, las más nuevas primero.
CREATE INDEX IF NOT EXISTS ix_modulos_renders_galeria ON modulos_renders (tipo, version_pipeline, completado_en DESC) WHERE estado = 'lista';

ALTER TABLE ai_call_log DROP CONSTRAINT IF EXISTS ai_call_log_flujo_check;
ALTER TABLE ai_call_log ADD CONSTRAINT ai_call_log_flujo_check CHECK (flujo IN (
  'armador_decoracion', 'generador_imagen', 'analisis_referencia',
  'happie_paquetes', 'happie_conversacion', 'entrenamiento_lora',
  'indexacion_catalogo', 'evaluacion', 'modulos_estudio'
));
