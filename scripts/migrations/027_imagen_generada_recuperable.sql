-- Imagen de /api/generate recuperable por su id de solicitud (cabecera x-solicitud-imagen), para que un corte de red
-- en el móvil no obligue a pagar otra imagen (producción 2026-10-07, guiada-20261007-071126-x7w4dx).
-- DDL aditiva e idempotente: la misma que crea el código la primera vez que la usa
-- (src/lib/generacion/imagen-recuperable.ts, DDL_IMAGEN_RECUPERABLE), así que aplicarla antes o después del
-- despliegue da lo mismo. Guarda la imagen ya aligerada (JPEG, ~200-400 KB) unas horas; no guarda prompts,
-- mensajes, claves ni datos del cliente.
--
-- rollback: DROP TABLE IF EXISTS imagen_generada_recuperable;
-- El rollback solo pierde las imágenes de las últimas horas; el código sigue funcionando sin la tabla (la
-- vuelve a crear al primer uso).

CREATE TABLE IF NOT EXISTS imagen_generada_recuperable (
  solicitud_id UUID PRIMARY KEY,
  plan_hash TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('en_curso', 'lista', 'fallida')),
  mime TEXT,
  datos BYTEA,
  aviso_no_cotizado TEXT,
  creada TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizada TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira TIMESTAMPTZ NOT NULL DEFAULT now() + interval '6 hours'
);
CREATE INDEX IF NOT EXISTS imagen_generada_recuperable_expira_idx ON imagen_generada_recuperable (expira);
