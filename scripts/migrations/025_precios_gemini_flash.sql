-- Plan A §A0.1 tarea 4: precio fechado de gemini-3.6-flash para estimar costo.
-- Datos, no DDL. Idempotente por la clave única (proveedor, modelo, vigente_desde, tipo_unidad).
-- Fuente verificada el 2026-09-15: https://ai.google.dev/gemini-api/docs/pricing
-- (página "Last updated 2026-09-15 UTC"), nivel pago estándar, no batch. USD por millón de tokens:
--   hasta 2026-12-31: entrada 0.75, salida (incluye pensamiento) 3.75, caché 0.075;
--   desde 2027-01-01: entrada 1.50, salida 7.50, caché 0.15.
-- El almacenamiento de caché por hora no se modela en esta tabla.
-- gemini-3.1-flash-image no se carga: la página da precio por imagen según resolución
-- (1K US$0.067, 2K US$0.101) y producción usa ambas, pero la clave única solo admite
-- un precio 'generacion' por modelo y fecha; el precio por tokens no publica caché.
-- Ver REVISION-HUMANA.md.
--
-- rollback: DELETE FROM ai_model_pricing WHERE proveedor = 'gemini' AND modelo = 'gemini-3.6-flash' AND vigente_desde IN ('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z') AND tipo_unidad = 'millon_tokens' AND NOT EXISTS (SELECT 1 FROM ai_call_log WHERE ai_call_log.pricing_id = ai_model_pricing.id);
-- Si alguna fila de ai_call_log ya referencia estos precios, el rollback no las borra (ON DELETE RESTRICT).

INSERT INTO ai_model_pricing
  (proveedor, modelo, vigente_desde, vigente_hasta, tipo_unidad, precio_entrada, precio_salida, precio_cacheado, moneda, fuente)
VALUES
  ('gemini', 'gemini-3.6-flash', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'millon_tokens', 0.75, 3.75, 0.075, 'USD',
   'https://ai.google.dev/gemini-api/docs/pricing (consultada 2026-09-15; estándar, no batch; vigente_desde 2026-01-01 es convención: la página no publica el inicio)'),
  ('gemini', 'gemini-3.6-flash', '2027-01-01T00:00:00Z', NULL, 'millon_tokens', 1.50, 7.50, 0.15, 'USD',
   'https://ai.google.dev/gemini-api/docs/pricing (consultada 2026-09-15; estándar, no batch; cambio anunciado desde 2027-01-01)')
ON CONFLICT (proveedor, modelo, vigente_desde, tipo_unidad) DO NOTHING;
