import { getAsesorPool, type AsesorDb } from "./db";

export type MessageRole = "user" | "assistant" | "system";

export type PhotoKind = "inspiration" | "venue";
export type PhotoPreference = "like" | "dislike" | "neutral";
export type AttachmentInput = { id: string; mimeType: string; data: Buffer; kind?: PhotoKind; confirmed?: boolean | null; preference?: PhotoPreference };
/** How a customer turn arrived: typed, or a voice note transcribed to text (any channel). */
export type MessageInputMode = "text" | "voice";
export type MessageInput = { id: string; role: MessageRole; content: string; attachments?: AttachmentInput[]; inputMode?: MessageInputMode };
export type StoredAttachment = { id: string; mimeType: string; byteSize: number; data: Buffer; kind?: PhotoKind; confirmed?: boolean | null; preference?: PhotoPreference };
export type StoredMessage = { id: string; role: MessageRole; content: string; attachments: StoredAttachment[]; inputMode?: MessageInputMode };
export type StoredBrief = { conversationId: string; version: number; state: unknown };
export type StoredConversation = { id: string; accountId: string | null; title: string | null; updatedAt: string };
export type AdminConversationRow = StoredConversation & { lastAssistantMessage: string | null; latestBrief: StoredBrief | null };

/**
 * Every method rejects when the database fails; nothing here swallows an error or returns a success
 * value that was not confirmed by the database.
 */
export function createAsesorRepository(db: AsesorDb = getAsesorPool()) {
  return {
    async upsertAccount(externalId: string, displayName?: string): Promise<{ id: string }> {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO accounts (external_id, display_name) VALUES ($1, $2)
         ON CONFLICT (external_id) DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, accounts.display_name)
         RETURNING id`,
        [externalId, displayName ?? null],
      );
      return { id: rows[0].id };
    },

    /** `inserted` is false when the conversation id already existed (nothing is overwritten). */
    async createConversation(id: string, accountId?: string, title?: string): Promise<{ inserted: boolean }> {
      const result = await db.query(
        `INSERT INTO conversations (id, account_id, title) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
        [id, accountId ?? null, title ?? null],
      );
      return { inserted: (result.rowCount ?? 0) > 0 };
    },

    async getConversation(id: string): Promise<StoredConversation | null> {
      const { rows } = await db.query<{ id: string; account_id: string | null; title: string | null; updated_at: Date | string }>(
        `SELECT id, account_id, title, updated_at FROM conversations WHERE id = $1`, [id],
      );
      const row = rows[0];
      return row ? { id: row.id, accountId: row.account_id, title: row.title, updatedAt: String(row.updated_at) } : null;
    },

    async listConversations(accountId: string): Promise<StoredConversation[]> {
      const { rows } = await db.query<{ id: string; account_id: string | null; title: string | null; updated_at: Date | string }>(
        `SELECT id, account_id, title, updated_at FROM conversations WHERE account_id = $1 ORDER BY updated_at DESC`, [accountId],
      );
      return rows.map((row) => ({ id: row.id, accountId: row.account_id, title: row.title, updatedAt: String(row.updated_at) }));
    },

    /** Reads customer conversations and their latest persisted advisor response/state for the admin monitor. */
    async listAdminConversations(): Promise<AdminConversationRow[]> {
      const { rows } = await db.query<{
        id: string;
        account_id: string | null;
        title: string | null;
        updated_at: Date | string;
        last_assistant_message: string | null;
        brief_version: number | null;
        brief_state: unknown;
      }>(
        `SELECT c.id, c.account_id, c.title, c.updated_at,
                assistant.content AS last_assistant_message,
                brief.version AS brief_version, brief.state AS brief_state
           FROM conversations c
           JOIN accounts a ON a.id = c.account_id AND a.external_id = 'advisor:user'
           LEFT JOIN LATERAL (
             SELECT content FROM messages WHERE conversation_id = c.id AND role = 'assistant'
             ORDER BY seq DESC LIMIT 1
           ) assistant ON true
           LEFT JOIN LATERAL (
             SELECT version, state FROM briefs WHERE conversation_id = c.id
             ORDER BY version DESC LIMIT 1
           ) brief ON true
          ORDER BY c.updated_at DESC`,
      );
      return rows.map((row) => ({
        id: row.id,
        accountId: row.account_id,
        title: row.title,
        updatedAt: String(row.updated_at),
        lastAssistantMessage: row.last_assistant_message,
        latestBrief: row.brief_version === null ? null : {
          conversationId: row.id,
          version: row.brief_version,
          state: row.brief_state,
        },
      }));
    },

    async getAdminConversation(id: string): Promise<AdminConversationRow | null> {
      const { rows } = await db.query<{
        id: string;
        account_id: string | null;
        title: string | null;
        updated_at: Date | string;
        last_assistant_message: string | null;
        brief_version: number | null;
        brief_state: unknown;
      }>(
        `SELECT c.id, c.account_id, c.title, c.updated_at,
                assistant.content AS last_assistant_message,
                brief.version AS brief_version, brief.state AS brief_state
           FROM conversations c
           JOIN accounts a ON a.id = c.account_id AND a.external_id = 'advisor:user'
           LEFT JOIN LATERAL (
             SELECT content FROM messages WHERE conversation_id = c.id AND role = 'assistant'
             ORDER BY seq DESC LIMIT 1
           ) assistant ON true
           LEFT JOIN LATERAL (
             SELECT version, state FROM briefs WHERE conversation_id = c.id
             ORDER BY version DESC LIMIT 1
           ) brief ON true
          WHERE c.id = $1`,
        [id],
      );
      const row = rows[0];
      return row ? {
        id: row.id,
        accountId: row.account_id,
        title: row.title,
        updatedAt: String(row.updated_at),
        lastAssistantMessage: row.last_assistant_message,
        latestBrief: row.brief_version === null ? null : {
          conversationId: row.id,
          version: row.brief_version,
          state: row.brief_state,
        },
      } : null;
    },

    /** Atomic message + attachments insert. A repeated message id inserts nothing and returns false. */
    async appendMessage(conversationId: string, message: MessageInput): Promise<{ inserted: boolean }> {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `INSERT INTO messages (id, conversation_id, role, content, input_mode) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
          [message.id, conversationId, message.role, message.content, message.inputMode ?? "text"],
        );
        const inserted = (result.rowCount ?? 0) > 0;
        if (inserted) {
          for (const attachment of message.attachments ?? []) {
            await client.query(
              `INSERT INTO attachments (id, message_id, mime_type, byte_size, data, photo_kind, confirmed, preference) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (id) DO NOTHING`,
              [attachment.id, message.id, attachment.mimeType, attachment.data.length, attachment.data, attachment.kind ?? "inspiration", attachment.confirmed ?? null, attachment.preference ?? "neutral"],
            );
          }
          await client.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [conversationId]);
        }
        await client.query("COMMIT");
        return { inserted };
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The original failure is the one worth surfacing.
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async listMessages(conversationId: string): Promise<StoredMessage[]> {
      const { rows } = await db.query<{ id: string; role: MessageRole; content: string; input_mode: MessageInputMode }>(
        `SELECT id, role, content, input_mode FROM messages WHERE conversation_id = $1 ORDER BY seq`,
        [conversationId],
      );
      const { rows: files } = await db.query<{
        id: string;
        message_id: string;
        mime_type: string;
        byte_size: number;
        data: Buffer;
        photo_kind: PhotoKind;
        confirmed: boolean | null;
        preference: PhotoPreference;
      }>(
        `SELECT a.id, a.message_id, a.mime_type, a.byte_size, a.data, a.photo_kind, a.confirmed, a.preference
           FROM attachments a JOIN messages m ON m.id = a.message_id
          WHERE m.conversation_id = $1 ORDER BY m.seq, a.created_at, a.id`,
        [conversationId],
      );
      return rows.map(({ input_mode: inputMode, ...row }) => ({
        ...row,
        ...(inputMode === "voice" ? { inputMode } : {}),
        attachments: files
          .filter((file) => file.message_id === row.id)
          .map((file) => ({ id: file.id, mimeType: file.mime_type, byteSize: file.byte_size, data: file.data, kind: file.photo_kind ?? "inspiration", confirmed: file.confirmed ?? null, preference: file.preference ?? "neutral" })),
      }));
    },

    async getAttachment(id: string): Promise<(StoredAttachment & { conversationId: string; accountId: string | null }) | null> {
      const { rows } = await db.query<{ id: string; mime_type: string; byte_size: number; data: Buffer; photo_kind: PhotoKind; confirmed: boolean | null; preference: PhotoPreference; conversation_id: string; account_id: string | null }>(
        `SELECT a.id, a.mime_type, a.byte_size, a.data, a.photo_kind, a.confirmed, a.preference, m.conversation_id, c.account_id
           FROM attachments a JOIN messages m ON m.id = a.message_id JOIN conversations c ON c.id = m.conversation_id
          WHERE a.id = $1`, [id],
      );
      const row = rows[0];
      return row ? { id: row.id, mimeType: row.mime_type, byteSize: row.byte_size, data: row.data, kind: row.photo_kind ?? "inspiration", confirmed: row.confirmed ?? null, preference: row.preference ?? "neutral", conversationId: row.conversation_id, accountId: row.account_id } : null;
    },

    async updatePhotoFeedback(conversationId: string, attachmentId: string, confirmed: boolean, preference: PhotoPreference): Promise<boolean> {
      const result = await db.query(
        `UPDATE attachments a SET confirmed = $3, preference = $4
          FROM messages m WHERE a.id = $2 AND a.message_id = m.id AND m.conversation_id = $1`,
        [conversationId, attachmentId, confirmed, preference],
      );
      return (result.rowCount ?? 0) === 1;
    },

    /** Appends a new brief version (1, 2, ...). Concurrent writers collide on the key and one fails loudly. */
    async saveBrief(conversationId: string, state: unknown): Promise<{ version: number }> {
      const { rows } = await db.query<{ version: number }>(
        `INSERT INTO briefs (conversation_id, version, state)
         SELECT $1, COALESCE(MAX(version), 0) + 1, $2::jsonb FROM briefs WHERE conversation_id = $1
         RETURNING version`,
        [conversationId, JSON.stringify(state)],
      );
      return { version: rows[0].version };
    },

    /** Serialize read/modify/write so concurrent tabs merge against the last committed state. */
    async mutateBrief(conversationId: string, mutate: (state: unknown, version: number) => unknown): Promise<{ version: number; state: unknown }> {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [conversationId]);
        const { rows } = await client.query<{ version: number; state: unknown }>(
          `SELECT version, state FROM briefs WHERE conversation_id = $1 ORDER BY version DESC LIMIT 1`, [conversationId],
        );
        const previous = rows[0];
        const state = mutate(previous?.state ?? null, previous?.version ?? 0);
        if (previous && JSON.stringify(state) === JSON.stringify(previous.state)) {
          await client.query("COMMIT");
          return { version: previous.version, state };
        }
        const { rows: inserted } = await client.query<{ version: number }>(
          `INSERT INTO briefs (conversation_id, version, state) VALUES ($1, $2, $3::jsonb) RETURNING version`,
          [conversationId, (previous?.version ?? 0) + 1, JSON.stringify(state)],
        );
        await client.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [conversationId]);
        await client.query("COMMIT");
        return { version: inserted[0].version, state };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async latestBrief(conversationId: string): Promise<StoredBrief | null> {
      const { rows } = await db.query<{ conversation_id: string; version: number; state: unknown }>(
        `SELECT conversation_id, version, state FROM briefs WHERE conversation_id = $1 ORDER BY version DESC LIMIT 1`,
        [conversationId],
      );
      const row = rows[0];
      return row ? { conversationId: row.conversation_id, version: row.version, state: row.state } : null;
    },
  };
}

export type AsesorRepository = ReturnType<typeof createAsesorRepository>;
