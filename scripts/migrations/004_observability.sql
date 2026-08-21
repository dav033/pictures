-- Fase 6: trazabilidad (plan §6.1/§6.2). Sin esto no se puede responder
-- "¿por qué el chatbot recomendó este producto?" más que revisando logs de
-- consola de un servidor que ya se reinició. request_id conecta la búsqueda
-- con la selección que vino después en el mismo turno.

CREATE TABLE IF NOT EXISTS rag_query_log (
  id                     BIGSERIAL PRIMARY KEY,
  request_id             TEXT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  tipo                   TEXT NOT NULL, -- 'busqueda' | 'seleccion'
  mensaje                TEXT,
  intent                 JSONB,
  retrieved_product_ids  TEXT[],
  retrieval_scores       JSONB,
  selected_product_ids   TEXT[],
  rejected               JSONB,
  status                 TEXT,
  latency_parse_ms       INTEGER,
  latency_retrieval_ms   INTEGER,
  latency_total_ms       INTEGER,
  error                  TEXT
);

CREATE INDEX IF NOT EXISTS ix_rag_query_log_request ON rag_query_log(request_id);
CREATE INDEX IF NOT EXISTS ix_rag_query_log_created ON rag_query_log(created_at);
