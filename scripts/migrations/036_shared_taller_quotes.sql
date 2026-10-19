-- rollback: disable both quote gates and retain this table; drop only after an approved export and retention decision.
CREATE TABLE IF NOT EXISTS taller_quote_shares (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL CHECK (schema_version = 1),
  scene_name varchar(120) NOT NULL CHECK (length(btrim(scene_name)) > 0),
  scene_revision_hash char(64) NOT NULL CHECK (scene_revision_hash ~ '^[0-9a-f]{64}$'),
  valid_until date NOT NULL,
  currency char(3) NOT NULL CHECK (currency = 'COP'),
  total_cop bigint NOT NULL CHECK (total_cop >= 0),
  still_mime_type varchar(16) NOT NULL CHECK (still_mime_type = 'image/jpeg'),
  still_bytes bytea NOT NULL CHECK (octet_length(still_bytes) BETWEEN 4 AND 524288),
  status varchar(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'changes_requested')),
  customer_name varchar(100),
  customer_comment varchar(2000),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT taller_quote_shares_response_consistent CHECK (
    (status = 'pending' AND customer_name IS NULL AND customer_comment IS NULL AND responded_at IS NULL)
    OR (status = 'approved' AND customer_name IS NOT NULL AND customer_comment IS NULL AND responded_at IS NOT NULL)
    OR (status = 'changes_requested' AND customer_name IS NOT NULL AND customer_comment IS NOT NULL
      AND length(btrim(customer_comment)) > 0 AND responded_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS taller_quote_shares_scene_revision_created
  ON taller_quote_shares (scene_revision_hash, created_at DESC);
