-- Fase 6, capitulo 10.4/10.5 del plan maestro: linaje operacional propio,
-- separado del linaje comercial (Next, schema public). Copia exacta del DDL
-- de scripts/migrations/020_operational_idempotency.sql del repo Next,
-- unicamente calificada al schema `operational` en vez de `public`, para
-- que el usuario del servicio Python pueda tener permisos acotados a
-- operational.* sin poder leer public.catalog_* ni ninguna tabla comercial.
-- La app (app/postgres_store.py) no califica el schema en sus queries: se
-- apoya en que el rol de conexion tenga `search_path = operational, public`
-- (ver GRANT/ALTER ROLE en el runbook de despliegue, no en esta migracion).
--
-- rollback: DROP TABLE operational.operational_request_nonces; DROP TABLE
-- operational.operational_idempotency; DROP SCHEMA operational;
-- No hay tabla comercial implicada. Pierde el registro de idempotencia en
-- vuelo del backend Python; no ejecutar mientras haya operaciones sin
-- respuesta terminal.

CREATE SCHEMA IF NOT EXISTS operational;

CREATE TABLE IF NOT EXISTS operational.operational_idempotency (
  scope                 TEXT NOT NULL,
  idempotency_key       TEXT NOT NULL,
  body_sha256           TEXT NOT NULL,
  request_id            UUID NOT NULL,
  correlation_id        UUID NOT NULL,
  state                 TEXT NOT NULL DEFAULT 'in_progress',
  response_body         JSONB,
  response_status       INTEGER,
  response_content_type TEXT,
  expires_at            TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, idempotency_key),
  CONSTRAINT operational_idempotency_scope_check
    CHECK (scope <> '' AND length(scope) <= 120),
  CONSTRAINT operational_idempotency_key_check
    CHECK (idempotency_key <> '' AND length(idempotency_key) <= 200),
  CONSTRAINT operational_idempotency_hash_check
    CHECK (body_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT operational_idempotency_state_check
    CHECK (state IN ('in_progress', 'completed', 'failed')),
  CONSTRAINT operational_idempotency_status_check
    CHECK (response_status IS NULL OR response_status BETWEEN 200 AND 599),
  CONSTRAINT operational_idempotency_content_type_check
    CHECK (response_content_type IS NULL OR response_content_type IN ('application/json', 'application/problem+json')),
  CONSTRAINT operational_idempotency_response_check
    CHECK (
      (state = 'in_progress' AND response_body IS NULL AND response_status IS NULL AND response_content_type IS NULL)
      OR
      (state IN ('completed', 'failed') AND response_body IS NOT NULL AND response_status IS NOT NULL AND response_content_type IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS ix_operational_idempotency_expiry
  ON operational.operational_idempotency (expires_at, state);

CREATE INDEX IF NOT EXISTS ix_operational_idempotency_request
  ON operational.operational_idempotency (request_id);

CREATE INDEX IF NOT EXISTS ix_operational_idempotency_correlation
  ON operational.operational_idempotency (correlation_id);

-- Replay protection for internal signed requests. Expired nonce rows may be
-- reused only after the bounded replay window has elapsed.
CREATE TABLE IF NOT EXISTS operational.operational_request_nonces (
  namespace   TEXT NOT NULL,
  nonce       UUID NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, nonce),
  CONSTRAINT operational_request_nonces_namespace_check
    CHECK (namespace <> '' AND length(namespace) <= 120 AND namespace ~ '^[a-zA-Z0-9._:/-]+$')
);

CREATE INDEX IF NOT EXISTS ix_operational_request_nonces_namespace_nonce_expires
  ON operational.operational_request_nonces (namespace, nonce, expires_at);

CREATE INDEX IF NOT EXISTS ix_operational_request_nonces_expiry
  ON operational.operational_request_nonces (expires_at);
