-- REQ-002: la búsqueda por foto de la biblioteca del taller embebe una imagen (gemini-embedding-2, multimodal).
-- Esa llamada se registra con la capacidad nueva `embedding_imagen`; sin esta migración el CHECK de `ai_call_log` la
-- rechazaría y la telemetría se perdería en silencio. Aditiva e idempotente (migrate.ts re-ejecuta cada .sql).
-- Orden de despliegue: aplicar ANTES del código que escribe `embedding_imagen`.
--
-- rollback: ALTER TABLE ai_call_log DROP CONSTRAINT ai_call_log_capacidad_check;
-- y volver a crearlo sin 'embedding_imagen' (antes borrar o recapacitar las filas que ya la usan, o el ADD falla).

ALTER TABLE ai_call_log DROP CONSTRAINT IF EXISTS ai_call_log_capacidad_check;
ALTER TABLE ai_call_log ADD CONSTRAINT ai_call_log_capacidad_check CHECK (capacidad IN (
  'chat_turno', 'parser_intencion', 'embedding_consulta', 'embedding_documento', 'embedding_imagen',
  'qa_visual', 'imagen_generacion', 'imagen_generacion_correctiva',
  'analisis_referencia_inventario', 'analisis_referencia_auditoria',
  'happie_recomendacion', 'happie_conversacion', 'rerank_candidatos'
));
