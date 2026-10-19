-- Plan A §A0.1: telemetría del análisis y hechos de la petición en la auditoría de planes.
-- DDL aditiva e idempotente (columnas nulables, sin reescritura de filas). No
-- contiene prompts, mensajes, imágenes, base64, claves ni DSN.
-- Orden de despliegue: aplicar ANTES del código que escribe finish_reason y
-- config_hash; deploy.yml no aplica migraciones y un INSERT con columnas
-- inexistentes haría que la telemetría se pierda en silencio.
--
-- rollback: ALTER TABLE ai_call_log DROP COLUMN IF EXISTS config_hash; ALTER TABLE ai_call_log DROP COLUMN IF EXISTS finish_reason; ALTER TABLE plan_audit_log DROP COLUMN IF EXISTS superficie; ALTER TABLE plan_audit_log DROP COLUMN IF EXISTS rechazos_turno; ALTER TABLE plan_audit_log DROP COLUMN IF EXISTS clase_rechazo; ALTER TABLE plan_audit_log DROP COLUMN IF EXISTS motor_imagen_previsto; ALTER TABLE plan_audit_log DROP COLUMN IF EXISTS lora_mode; ALTER TABLE plan_audit_log DROP COLUMN IF EXISTS tiene_foto_espacio; ALTER TABLE plan_audit_log DROP COLUMN IF EXISTS tiene_referencia;
-- El rollback pierde esos metadatos. Revertir antes el código que los escribe
-- (si no, sus INSERT fallan) y exportar las columnas si se quieren conservar.

ALTER TABLE ai_call_log ADD COLUMN IF NOT EXISTS finish_reason TEXT
  CONSTRAINT ai_call_log_finish_reason_check CHECK (finish_reason IS NULL OR finish_reason ~ '^[A-Z_]{1,64}$');
ALTER TABLE ai_call_log ADD COLUMN IF NOT EXISTS config_hash TEXT
  CONSTRAINT ai_call_log_config_hash_check CHECK (config_hash IS NULL OR config_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE plan_audit_log ADD COLUMN IF NOT EXISTS tiene_referencia BOOLEAN;
ALTER TABLE plan_audit_log ADD COLUMN IF NOT EXISTS tiene_foto_espacio BOOLEAN;
ALTER TABLE plan_audit_log ADD COLUMN IF NOT EXISTS lora_mode TEXT
  CONSTRAINT plan_audit_log_lora_mode_check CHECK (lora_mode IS NULL OR (lora_mode <> '' AND length(lora_mode) <= 64));
ALTER TABLE plan_audit_log ADD COLUMN IF NOT EXISTS motor_imagen_previsto TEXT
  CONSTRAINT plan_audit_log_motor_imagen_check CHECK (motor_imagen_previsto IS NULL OR (motor_imagen_previsto <> '' AND length(motor_imagen_previsto) <= 64));
ALTER TABLE plan_audit_log ADD COLUMN IF NOT EXISTS clase_rechazo TEXT
  CONSTRAINT plan_audit_log_clase_rechazo_check CHECK (clase_rechazo IS NULL OR (clase_rechazo <> '' AND length(clase_rechazo) <= 64));
ALTER TABLE plan_audit_log ADD COLUMN IF NOT EXISTS rechazos_turno SMALLINT
  CONSTRAINT plan_audit_log_rechazos_turno_check CHECK (rechazos_turno IS NULL OR rechazos_turno BETWEEN 0 AND 99);
ALTER TABLE plan_audit_log ADD COLUMN IF NOT EXISTS superficie TEXT
  CONSTRAINT plan_audit_log_superficie_check CHECK (superficie IS NULL OR length(superficie) <= 200);
