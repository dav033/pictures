import assert from "node:assert/strict";
import { test } from "node:test";
import { GET as listAdmin } from "@/app/api/asesor/admin/conversations/route";
import { GET as getAdminDetail } from "@/app/api/asesor/admin/conversations/[id]/route";
import { createAdvisorSessionToken, ASESOR_SESSION_COOKIE } from "@/lib/asesor/auth";
import { getAdminConversationDetail, getAdminPageAccess, listAdminConversationSnapshots } from "@/lib/asesor/admin";
import { ADMIN_MONITOR_REFRESH_MS, adminPollFailed, adminPollSucceeded } from "@/lib/asesor/admin-poll-state";
import type { AdminConversationRow, StoredMessage } from "@/lib/asesor/repository";

const SESSION_SECRET = "admin-monitor-test-session-secret-at-least-32-bytes";
const requiredBrief = {
  eventKind: "birthday",
  eventName: "Cumpleaños de Ana",
  date: "2026-11-14",
  startTime: "18:00",
  endTime: "22:00",
  guestCount: 40,
  venueType: "salón",
  city: "Bogotá",
  address: "Calle 10 # 20-30",
  contactName: "Ana Pérez",
  contactPhone: "+573001234567",
  honoreeName: "Ana",
  organiserPriority: "simple",
  theme: "Jardín",
  style: "Natural",
  budget: 2_000_000,
  currency: "COP",
};

function storedConversation(state: unknown = { brief: requiredBrief, summary: null, approval: null }): AdminConversationRow {
  return {
    id: "user-conversation-1",
    accountId: "customer-account",
    title: "Cumpleaños de Ana",
    updatedAt: "2026-10-20T12:00:00.000Z",
    lastAssistantMessage: "¿Qué colores prefieres? Puedo ayudarte con eso.",
    latestBrief: { conversationId: "user-conversation-1", version: 3, state },
  };
}

function withCookie(token: string | null): Request {
  return new Request("https://example.test/api/asesor/admin/conversations", {
    headers: token ? { cookie: `${ASESOR_SESSION_COOKIE}=${token}` } : undefined,
  });
}

test("admin list projects persisted status, server progress and the last advisor question", async () => {
  const approvedState = {
    brief: requiredBrief,
    summary: { version: 4, briefVersion: 3, text: "Brief aprobado: cumpleaños en Bogotá." },
    approval: { summaryVersion: 4, confirmedAt: "2026-10-20T11:59:00.000Z" },
  };
  const rows = [storedConversation(approvedState), storedConversation({ brief: requiredBrief, summary: null, approval: null })];
  const snapshots = await listAdminConversationSnapshots({ listAdminConversations: async () => rows });
  assert.equal(snapshots[0].status, "approved");
  assert.equal(snapshots[0].progress.complete, true);
  assert.equal(snapshots[0].progress.completed, snapshots[0].progress.required);
  assert.equal(snapshots[0].lastQuestion, "¿Qué colores prefieres?");
  assert.equal(snapshots[1].status, "in_progress");
});

test("admin detail reads transcript and approved brief while returning attachment references only", async () => {
  const row = storedConversation({
    brief: requiredBrief,
    summary: { version: 4, briefVersion: 3, text: "Brief aprobado: cumpleaños en Bogotá." },
    approval: { summaryVersion: 4, confirmedAt: "2026-10-20T11:59:00.000Z" },
  });
  const messages: StoredMessage[] = [{
    id: "message-1", role: "user", content: "Adjunto una referencia.",
    attachments: [{ id: "attachment-1", mimeType: "image/jpeg", byteSize: 512, data: Buffer.from([1, 2, 3]) }],
  }];
  const detail = await getAdminConversationDetail({
    getAdminConversation: async (id) => id === row.id ? row : null,
    listMessages: async () => messages,
  }, row.id);
  assert.ok(detail);
  assert.equal(detail.transcript[0].content, "Adjunto una referencia.");
  assert.deepEqual(detail.transcript[0].attachments, [{ id: "attachment-1", mimeType: "image/jpeg", byteSize: 512 }]);
  assert.equal("data" in detail.transcript[0].attachments[0], false);
  assert.equal(detail.approvedBrief?.text, "Brief aprobado: cumpleaños en Bogotá.");
  assert.equal(await getAdminConversationDetail({ getAdminConversation: async () => null, listMessages: async () => [] }, "other-account-id"), null);
});

test("admin pages distinguish anonymous and user sessions from the admin role", () => {
  process.env.ASESOR_SESSION_SECRET = SESSION_SECRET;
  const userToken = createAdvisorSessionToken("user");
  const adminToken = createAdvisorSessionToken("admin");
  assert.equal(getAdminPageAccess(undefined), "anonymous");
  assert.equal(getAdminPageAccess(userToken ?? undefined), "forbidden");
  assert.equal(getAdminPageAccess(adminToken ?? undefined), "admin");
});

test("admin APIs reject anonymous and user sessions before looking up any conversation id", async () => {
  process.env.ASESOR_SESSION_SECRET = SESSION_SECRET;
  const userToken = createAdvisorSessionToken("user");
  assert.ok(userToken);
  for (const request of [withCookie(null), withCookie(userToken)]) {
    const expectedStatus = request.headers.has("cookie") ? 403 : 401;
    assert.equal((await listAdmin(request)).status, expectedStatus);
    assert.equal((await getAdminDetail(request, { params: Promise.resolve({ id: "another-users-id" }) })).status, expectedStatus);
  }
});

test("polling runs every five seconds and a failure preserves the displayed snapshot", () => {
  assert.equal(ADMIN_MONITOR_REFRESH_MS, 5_000);
  const visibleSnapshot = [
    { id: "c1", title: "Evento", updatedAt: "2026-10-20T12:00:00.000Z", status: "in_progress" as const,
      progress: { complete: false, completed: 1, required: 10, missing: ["date"] }, lastQuestion: "¿Qué fecha tendrá?" },
  ];
  const successful = adminPollSucceeded({ snapshot: null, error: false }, visibleSnapshot);
  const failed = adminPollFailed(successful);
  assert.equal(failed.error, true);
  assert.strictEqual(failed.snapshot, visibleSnapshot);
});
