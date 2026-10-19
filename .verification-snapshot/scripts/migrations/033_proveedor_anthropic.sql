-- W5: Claude (Haiku 5.5) como proveedor de IA SOLO en local. Sus llamadas dejan la misma fila de ai_call_log que las de
-- Gemini, con proveedor 'anthropic' (el ChatPort se llama 'claude' en el registro; agente-core lo guarda como la empresa
-- que cobra). Sin esta migración el CHECK de proveedor rechaza esas filas y la telemetría las pierde en silencio
-- (registrarLlamadaIA nunca lanza). Aditiva e idempotente: amplía dos CHECK (no invalida ninguna fila existente) y
-- carga el precio fechado de claude-haiku-5-5.
--
-- Precio verificado el 2026-10-09: https://platform.claude.com/docs/en/models/haiku-5-5/overview (tabla de precios),
-- USD por millón de tokens, prompts de hasta 100 000 tokens: entrada 0.10, salida (incluye razonamiento) 0.50,
-- lectura de caché 0.01. No caben en esta tabla: la escritura de caché de 5 min (0.125) y la tarifa de prompts de más de
-- 100 000 tokens (0.50 / 2.50 / lectura 0.05); el estimado exacto por llamada (con las dos) queda en el registro de la
-- conversación (respuesta_ia.costeEstimadoUsd, src/lib/ia/claude/precios.ts).
--
-- rollback: DELETE FROM ai_model_pricing WHERE proveedor = 'anthropic' AND modelo = 'claude-haiku-5-5' AND vigente_desde = '2026-10-07T00:00:00Z' AND tipo_unidad = 'millon_tokens' AND NOT EXISTS (SELECT 1 FROM ai_call_log WHERE ai_call_log.pricing_id = ai_model_pricing.id);
--   y, solo si no quedan filas de anthropic (DELETE FROM ai_call_log WHERE proveedor = 'anthropic' las borra):
--   ALTER TABLE ai_call_log DROP CONSTRAINT ai_call_log_proveedor_check, ADD CONSTRAINT ai_call_log_proveedor_check CHECK (proveedor IN ('gemini', 'fal'));
--   ALTER TABLE ai_model_pricing DROP CONSTRAINT ai_model_pricing_proveedor_check, ADD CONSTRAINT ai_model_pricing_proveedor_check CHECK (proveedor IN ('gemini', 'fal'));

ALTER TABLE ai_call_log DROP CONSTRAINT IF EXISTS ai_call_log_proveedor_check;
ALTER TABLE ai_call_log ADD CONSTRAINT ai_call_log_proveedor_check CHECK (proveedor IN ('gemini', 'fal', 'anthropic'));

ALTER TABLE ai_model_pricing DROP CONSTRAINT IF EXISTS ai_model_pricing_proveedor_check;
ALTER TABLE ai_model_pricing ADD CONSTRAINT ai_model_pricing_proveedor_check CHECK (proveedor IN ('gemini', 'fal', 'anthropic'));

INSERT INTO ai_model_pricing
  (proveedor, modelo, vigente_desde, vigente_hasta, tipo_unidad, precio_entrada, precio_salida, precio_cacheado, moneda, fuente)
VALUES
  ('anthropic', 'claude-haiku-5-5', '2026-10-07T00:00:00Z', NULL, 'millon_tokens', 0.10, 0.50, 0.01, 'USD',
   'https://platform.claude.com/docs/en/models/haiku-5-5/overview (consultada 2026-10-09; prompts de hasta 100 000 tokens; vigente_desde = lanzamiento del modelo; escritura de caché 0.125 no modelada)')
ON CONFLICT (proveedor, modelo, vigente_desde, tipo_unidad) DO NOTHING;
