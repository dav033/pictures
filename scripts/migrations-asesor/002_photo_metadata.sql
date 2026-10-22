-- Adds durable photo role and first-look feedback without rewriting original BYTEA content.
-- rollback: ALTER TABLE attachments DROP COLUMN preference, DROP COLUMN confirmed, DROP COLUMN photo_kind;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS photo_kind TEXT NOT NULL DEFAULT 'inspiration'
  CHECK (photo_kind IN ('inspiration', 'venue'));
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS confirmed BOOLEAN;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS preference TEXT NOT NULL DEFAULT 'neutral'
  CHECK (preference IN ('like', 'dislike', 'neutral'));
