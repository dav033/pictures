-- Marks customer turns that arrived as a transcribed voice note (web today, WhatsApp later); existing rows stay text.
-- rollback: ALTER TABLE messages DROP COLUMN input_mode;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS input_mode TEXT NOT NULL DEFAULT 'text'
  CHECK (input_mode IN ('text', 'voice'));
