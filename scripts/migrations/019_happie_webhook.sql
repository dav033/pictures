CREATE TABLE IF NOT EXISTS happie_webhook_rate (
  scope TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  hits INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS happie_webhook_requests (
  scope TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  owner UUID NOT NULL,
  lease_until TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status INTEGER,
  response JSONB,
  PRIMARY KEY (scope, key_hash)
);
CREATE INDEX IF NOT EXISTS happie_webhook_requests_expiry ON happie_webhook_requests (expires_at);
