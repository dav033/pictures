-- REQ-010: calificación de cada acción de la IA (Taller 3D y chat del cliente) con el estado completo del turno, para
-- ver los huecos de la IA. Aditiva e idempotente (migrate.ts re-ejecuta cada .sql): solo crea tablas e índices nuevos.
-- Las imágenes antes/después NO van aquí: viven en el almacén S3 dedicado (bucket decoracion-feedback) y la fila solo
-- guarda su clave. Las escenas sí van aquí (jsonb acotado) porque se comparan y se diferencian en el panel.
-- `solicitud_id` es el `x-request-id` del turno de la IA (el que devuelve conRegistro) y `conversacion_id` el
-- `x-conversacion-id`: con ellos el panel une la fila con `ai_call_log` (request_id/correlation_id) y con la
-- auditoría JSONL de la conversación. No son UUID garantizados (sanearIdSolicitud acepta [a-zA-Z0-9_-]), por eso TEXT.
--
-- rollback: DROP TABLE ai_feedback_analisis; DROP TABLE ai_feedback;
-- Pierde todas las calificaciones y los análisis (exportar antes desde el panel: CSV/JSON). Las imágenes quedan
-- huérfanas en el bucket y se borran con el rollback del almacén (docker compose down -v en /opt/almacen-decoracion).

CREATE TABLE IF NOT EXISTS ai_feedback (
  id                BIGSERIAL PRIMARY KEY,
  turno_id          TEXT NOT NULL,
  producto          TEXT NOT NULL,
  usuario_id        TEXT NOT NULL,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL hasta que la persona califica: el turno se registra al terminar la IA, antes de la calificación.
  calificacion      SMALLINT,
  motivos           TEXT[] NOT NULL DEFAULT '{}',
  comentario        TEXT,
  -- La persona deshizo el turno o corrigió a la IA (abre el «por qué» solo; señal fuerte en el análisis).
  deshecho          BOOLEAN NOT NULL DEFAULT FALSE,
  pedido            TEXT,
  respuesta         TEXT,
  solicitud_id      TEXT,
  conversacion_id   TEXT,
  -- Herramientas que el turno llamó (derivadas de los pasos): sirven para el promedio por herramienta.
  herramientas      TEXT[] NOT NULL DEFAULT '{}',
  -- Pasos y llamadas a herramientas copiados de la auditoría al registrar el turno (la auditoría rota; esto no).
  pasos             JSONB,
  modelo            TEXT,
  coste_usd         NUMERIC(12, 6),
  latencia_ms       INTEGER,
  version_app       TEXT,
  escena_antes      JSONB,
  escena_despues    JSONB,
  diferencia        JSONB,
  imagen_antes      TEXT,
  imagen_despues    TEXT,
  CONSTRAINT ai_feedback_turno_unico UNIQUE (producto, turno_id),
  CONSTRAINT ai_feedback_producto_check CHECK (producto IN ('taller', 'cliente')),
  CONSTRAINT ai_feedback_turno_check CHECK (turno_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT ai_feedback_calificacion_check CHECK (calificacion IS NULL OR calificacion BETWEEN 1 AND 10),
  CONSTRAINT ai_feedback_motivos_check CHECK (cardinality(motivos) <= 10),
  CONSTRAINT ai_feedback_comentario_check CHECK (comentario IS NULL OR length(comentario) <= 2000),
  CONSTRAINT ai_feedback_textos_check CHECK (
    (pedido IS NULL OR length(pedido) <= 4000) AND (respuesta IS NULL OR length(respuesta) <= 8000)
  ),
  CONSTRAINT ai_feedback_escenas_check CHECK (
    (escena_antes IS NULL OR octet_length(escena_antes::text) <= 600000)
    AND (escena_despues IS NULL OR octet_length(escena_despues::text) <= 600000)
    AND (diferencia IS NULL OR octet_length(diferencia::text) <= 200000)
    AND (pasos IS NULL OR octet_length(pasos::text) <= 200000)
  )
);

-- «Peor primero»: las calificadas por nota ascendente y, a igual nota, las más recientes.
CREATE INDEX IF NOT EXISTS ix_ai_feedback_peor_primero ON ai_feedback (calificacion ASC, creado_en DESC) WHERE calificacion IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ai_feedback_producto_fecha ON ai_feedback (producto, creado_en DESC);
CREATE INDEX IF NOT EXISTS ix_ai_feedback_fecha ON ai_feedback (creado_en DESC);
CREATE INDEX IF NOT EXISTS ix_ai_feedback_motivos ON ai_feedback USING GIN (motivos);
CREATE INDEX IF NOT EXISTS ix_ai_feedback_solicitud ON ai_feedback (solicitud_id) WHERE solicitud_id IS NOT NULL;

-- Resúmenes periódicos de los huecos recurrentes (cron o a pedido); el último se muestra arriba del panel.
CREATE TABLE IF NOT EXISTS ai_feedback_analisis (
  id                BIGSERIAL PRIMARY KEY,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  origen            TEXT NOT NULL,
  desde             TIMESTAMPTZ NOT NULL,
  hasta             TIMESTAMPTZ NOT NULL,
  dias              SMALLINT NOT NULL,
  total_turnos      INTEGER NOT NULL,
  total_calificados INTEGER NOT NULL,
  promedio          NUMERIC(4, 2),
  -- Conteos por motivo y producto, promedio por herramienta, frases frecuentes y peores ejemplos.
  metricas          JSONB NOT NULL,
  -- Resumen redactado por Gemini Flash (opcional, con coste acotado); NULL si no se pidió o falló.
  resumen           TEXT,
  resumen_modelo    TEXT,
  resumen_coste_usd NUMERIC(12, 6),
  CONSTRAINT ai_feedback_analisis_origen_check CHECK (origen IN ('cron', 'manual', 'script')),
  CONSTRAINT ai_feedback_analisis_rango_check CHECK (hasta > desde AND dias BETWEEN 1 AND 365),
  CONSTRAINT ai_feedback_analisis_resumen_check CHECK (resumen IS NULL OR length(resumen) <= 8000)
);

CREATE INDEX IF NOT EXISTS ix_ai_feedback_analisis_fecha ON ai_feedback_analisis (creado_en DESC);
