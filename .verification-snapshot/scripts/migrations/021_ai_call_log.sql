-- Fase 1.5: taxonomía y telemetría durable de llamadas de IA.
-- DDL aditiva e idempotente. No contiene prompts, conversaciones, imágenes,
-- base64, claves, firmas ni DSN; solo metadatos acotados.
--
-- rollback: DROP TABLE ai_call_log; DROP TABLE ai_model_pricing;
-- El rollback pierde el histórico de consumo y sus precios auditables. Exportar
-- ambas tablas antes; no ejecutarlo mientras haya escritores activos.

CREATE TABLE IF NOT EXISTS ai_model_pricing (
  id               BIGSERIAL PRIMARY KEY,
  proveedor        TEXT NOT NULL,
  modelo           TEXT NOT NULL,
  vigente_desde    TIMESTAMPTZ NOT NULL,
  vigente_hasta    TIMESTAMPTZ,
  tipo_unidad      TEXT NOT NULL DEFAULT 'millon_tokens',
  precio_entrada   NUMERIC(20, 10),
  precio_salida    NUMERIC(20, 10),
  precio_cacheado  NUMERIC(20, 10),
  precio_unidad    NUMERIC(20, 10),
  moneda           CHAR(3) NOT NULL,
  fuente           TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_model_pricing_proveedor_check
    CHECK (proveedor IN ('gemini', 'fal')),
  CONSTRAINT ai_model_pricing_modelo_check
    CHECK (modelo <> '' AND length(modelo) <= 200),
  CONSTRAINT ai_model_pricing_vigencia_check
    CHECK (vigente_hasta IS NULL OR vigente_hasta > vigente_desde),
  CONSTRAINT ai_model_pricing_tipo_unidad_check
    CHECK (tipo_unidad IN ('millon_tokens', 'generacion', 'segundo', 'corrida')),
  CONSTRAINT ai_model_pricing_precios_check CHECK (
    (tipo_unidad = 'millon_tokens'
      AND precio_entrada IS NOT NULL AND precio_entrada >= 0
      AND precio_salida IS NOT NULL AND precio_salida >= 0
      AND precio_cacheado IS NOT NULL AND precio_cacheado >= 0
      AND precio_unidad IS NULL)
    OR
    (tipo_unidad <> 'millon_tokens'
      AND precio_unidad IS NOT NULL AND precio_unidad >= 0
      AND precio_entrada IS NULL AND precio_salida IS NULL AND precio_cacheado IS NULL)
  ),
  CONSTRAINT ai_model_pricing_moneda_check
    CHECK (moneda ~ '^[A-Z]{3}$'),
  CONSTRAINT ai_model_pricing_fuente_check
    CHECK (fuente <> '' AND length(fuente) <= 1000),
  UNIQUE (proveedor, modelo, vigente_desde, tipo_unidad)
);

CREATE TABLE IF NOT EXISTS ai_call_log (
  id                           BIGSERIAL PRIMARY KEY,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  flujo                        TEXT NOT NULL,
  capacidad                    TEXT NOT NULL,
  request_id                   UUID,
  correlation_id               UUID,
  proveedor                    TEXT NOT NULL,
  modelo                       TEXT NOT NULL,
  superficie                   TEXT,
  vuelta                       SMALLINT,
  herramienta                  TEXT,
  thinking_level               TEXT,
  prompt_version               TEXT,
  tokens_entrada               BIGINT,
  tokens_salida                BIGINT,
  tokens_pensamiento           BIGINT,
  tokens_cacheados             BIGINT,
  tokens_prompt_herramientas   BIGINT,
  bytes_imagen_entrada         BIGINT,
  intento                      SMALLINT,
  proveedor_request_id         TEXT,
  unidades_facturadas          NUMERIC(20, 6),
  ms                           INTEGER NOT NULL,
  resultado                    TEXT NOT NULL,
  pricing_id                   BIGINT REFERENCES ai_model_pricing(id) ON DELETE RESTRICT,
  coste_estimado               NUMERIC(20, 10),
  moneda                       CHAR(3),
  coste_es_estimado            BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT ai_call_log_flujo_check CHECK (flujo IN (
    'armador_decoracion', 'generador_imagen', 'analisis_referencia',
    'happie_paquetes', 'happie_conversacion', 'entrenamiento_lora',
    'indexacion_catalogo', 'evaluacion'
  )),
  CONSTRAINT ai_call_log_capacidad_check CHECK (capacidad IN (
    'chat_turno', 'parser_intencion', 'embedding_consulta', 'embedding_documento',
    'qa_visual', 'imagen_generacion', 'imagen_generacion_correctiva',
    'analisis_referencia_inventario', 'analisis_referencia_auditoria',
    'happie_recomendacion', 'happie_conversacion', 'rerank_candidatos'
  )),
  CONSTRAINT ai_call_log_proveedor_check CHECK (proveedor IN ('gemini', 'fal')),
  CONSTRAINT ai_call_log_modelo_check CHECK (modelo <> '' AND length(modelo) <= 200),
  CONSTRAINT ai_call_log_superficie_check CHECK (superficie IS NULL OR length(superficie) <= 200),
  CONSTRAINT ai_call_log_vuelta_check CHECK (vuelta IS NULL OR vuelta BETWEEN 0 AND 99),
  CONSTRAINT ai_call_log_intento_check CHECK (intento IS NULL OR intento BETWEEN 1 AND 99),
  CONSTRAINT ai_call_log_thinking_check
    CHECK (thinking_level IS NULL OR thinking_level IN ('minimal', 'low', 'medium', 'high', 'default')),
  CONSTRAINT ai_call_log_tokens_check CHECK (
    COALESCE(tokens_entrada, 0) >= 0 AND COALESCE(tokens_salida, 0) >= 0
    AND COALESCE(tokens_pensamiento, 0) >= 0 AND COALESCE(tokens_cacheados, 0) >= 0
    AND COALESCE(tokens_prompt_herramientas, 0) >= 0
    AND COALESCE(bytes_imagen_entrada, 0) >= 0
  ),
  CONSTRAINT ai_call_log_unidades_check
    CHECK (unidades_facturadas IS NULL OR unidades_facturadas >= 0),
  CONSTRAINT ai_call_log_ms_check CHECK (ms >= 0),
  CONSTRAINT ai_call_log_resultado_check
    CHECK (resultado IN ('ok', 'error', 'timeout', 'cancelado')),
  CONSTRAINT ai_call_log_coste_check CHECK (
    (coste_estimado IS NULL AND moneda IS NULL)
    OR (coste_estimado >= 0 AND moneda ~ '^[A-Z]{3}$' AND pricing_id IS NOT NULL AND coste_es_estimado)
  )
);

CREATE INDEX IF NOT EXISTS ix_ai_call_log_request ON ai_call_log (request_id);
CREATE INDEX IF NOT EXISTS ix_ai_call_log_correlation ON ai_call_log (correlation_id);
CREATE INDEX IF NOT EXISTS ix_ai_call_log_flujo_created ON ai_call_log (flujo, created_at);
CREATE INDEX IF NOT EXISTS ix_ai_call_log_capacidad_created ON ai_call_log (capacidad, created_at);
CREATE INDEX IF NOT EXISTS ix_ai_call_log_proveedor_modelo_created
  ON ai_call_log (proveedor, modelo, created_at);
