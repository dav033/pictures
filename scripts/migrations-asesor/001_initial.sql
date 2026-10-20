-- Advisor (asesor) schema. Applied by scripts/migrate-asesor.ts with its own ledger table
-- (asesor_schema_migrations), never the Neon `schema_migrations`. Tables are unqualified on purpose:
-- the runner can target a disposable schema through search_path.
-- rollback: not reversible; drop the advisor tables (briefs, attachments, messages, conversations, accounts) from a backup.

CREATE TABLE IF NOT EXISTS accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  title      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_account_idx ON conversations (account_id);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq             BIGINT GENERATED ALWAYS AS IDENTITY,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_seq_idx ON messages (conversation_id, seq);

CREATE TABLE IF NOT EXISTS attachments (
  id         TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  mime_type  TEXT NOT NULL,
  byte_size  INTEGER NOT NULL CHECK (byte_size >= 0),
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_message_idx ON attachments (message_id);

CREATE TABLE IF NOT EXISTS briefs (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL CHECK (version >= 1),
  state           JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, version)
);
