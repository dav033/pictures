-- Structured first look of a photo (style, colours, elements) and what the customer wants to keep from it.
-- rollback: ALTER TABLE attachments DROP COLUMN keep, DROP COLUMN reading;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS reading JSONB;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS keep TEXT[] NOT NULL DEFAULT '{}';
