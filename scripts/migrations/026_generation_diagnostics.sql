-- Plan A §0.5: metadatos mínimos para reconstruir por qué una generación salió mal.
-- rollback: ALTER TABLE plan_audit_log DROP COLUMN IF EXISTS diagnostico_generacion;
-- El rollback elimina el diagnóstico de las generaciones; exportarlo antes si ya
-- contiene filas nuevas y detener los escritores antes de revertir.

ALTER TABLE plan_audit_log ADD COLUMN IF NOT EXISTS diagnostico_generacion JSONB;
