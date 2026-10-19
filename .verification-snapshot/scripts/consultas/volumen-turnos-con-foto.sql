-- Plan A §A0.1 tarea 6: volumen semanal de turnos y de turnos con foto.
-- Solo lectura. Correr en una transacción READ ONLY:
--   BEGIN READ ONLY; \i scripts/consultas/volumen-turnos-con-foto.sql; ROLLBACK;
-- Parámetro: reemplazar el intervalo de la CTE `ventana` (por defecto 12 semanas).
--
-- Unidades (verificadas en el código, 2026-09-15):
-- * Turno de chat = un request_id distinto en ai_call_log con flujo
--   'armador_decoracion' y superficie '/api/chat'. La ruta crea un request_id por
--   petición HTTP (src/app/api/chat/route.ts).
-- * Análisis de foto = un request_id distinto con capacidad
--   'analisis_referencia_inventario' (una fila por intento; se cuenta la petición).
-- * Conversación con referencia = request_id distinto en plan_audit_log con
--   tiene_referencia = true. Ahí request_id es el ragRequestId, que identifica
--   la conversación y no el turno. Solo existe desde la migración 024; antes es NULL.
--
-- Criterio de exclusión de tráfico y su límite:
-- * Se incluyen solo las superficies de la UI ('/api/chat', '/api/references/analyze').
--   Esto excluye webhooks, scripts internos ('interno') y evaluaciones (flujo 'evaluacion').
-- * NO se puede excluir el tráfico E2E ni el local: los smoke usan UUID aleatorios
--   sin marca, y un servidor local con .env.local escribe en la misma base. Hasta
--   que exista una marca de tráfico (decisión en REVISION-HUMANA.md), las cifras
--   son una cota superior del tráfico real.

WITH ventana AS (
  SELECT now() - interval '12 weeks' AS desde
),
turnos AS (
  SELECT date_trunc('week', created_at) AS semana, COUNT(DISTINCT request_id) AS turnos_chat
  FROM ai_call_log, ventana
  WHERE created_at >= ventana.desde
    AND flujo = 'armador_decoracion'
    AND superficie = '/api/chat'
    AND request_id IS NOT NULL
  GROUP BY 1
),
analisis AS (
  SELECT date_trunc('week', created_at) AS semana,
         COUNT(DISTINCT request_id) AS analisis_foto,
         COUNT(DISTINCT request_id) FILTER (WHERE resultado = 'ok') AS analisis_foto_ok
  FROM ai_call_log, ventana
  WHERE created_at >= ventana.desde
    AND capacidad = 'analisis_referencia_inventario'
    AND superficie = '/api/references/analyze'
    AND request_id IS NOT NULL
  GROUP BY 1
),
conversaciones AS (
  SELECT date_trunc('week', created_at) AS semana,
         COUNT(DISTINCT request_id) FILTER (WHERE tiene_referencia IS TRUE) AS conversaciones_con_referencia,
         COUNT(DISTINCT request_id) FILTER (WHERE tiene_foto_espacio IS TRUE) AS conversaciones_con_foto_espacio,
         COUNT(DISTINCT request_id) FILTER (WHERE tiene_referencia IS NOT NULL) AS conversaciones_con_hechos
  FROM plan_audit_log, ventana
  WHERE created_at >= ventana.desde
    AND superficie = '/api/chat'
  GROUP BY 1
)
SELECT
  semanas.semana::date AS semana,
  COALESCE(turnos.turnos_chat, 0) AS turnos_chat,
  COALESCE(analisis.analisis_foto, 0) AS analisis_foto,
  COALESCE(analisis.analisis_foto_ok, 0) AS analisis_foto_ok,
  COALESCE(conversaciones.conversaciones_con_referencia, 0) AS conversaciones_con_referencia,
  COALESCE(conversaciones.conversaciones_con_foto_espacio, 0) AS conversaciones_con_foto_espacio,
  COALESCE(conversaciones.conversaciones_con_hechos, 0) AS conversaciones_con_hechos
FROM (
  SELECT semana FROM turnos
  UNION SELECT semana FROM analisis
  UNION SELECT semana FROM conversaciones
) AS semanas
LEFT JOIN turnos USING (semana)
LEFT JOIN analisis USING (semana)
LEFT JOIN conversaciones USING (semana)
ORDER BY semanas.semana;
