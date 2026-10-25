import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { plainChatText } from "../../../src/components/asesor/chat-text";
import { ADVISOR_CONVERSATION_STORAGE_KEY, parseAdvisorSnapshot, parseCreatedConversation } from "../../../src/components/asesor/conversation-contract";

const protectedPage = readFileSync("src/app/asesor/(protected)/page.tsx", "utf8");
const chatView = readFileSync("src/components/asesor/ChatView.tsx", "utf8");
const composer = readFileSync("src/components/asesor/Composer.tsx", "utf8");
const hook = readFileSync("src/components/asesor/useConversation.ts", "utf8");
const createRoute = readFileSync("src/app/api/asesor/conversations/route.ts", "utf8");
const restoreRoute = readFileSync("src/app/api/asesor/conversations/[id]/route.ts", "utf8");

test("advisor page places privacy and test notices before the welcome question", () => {
  assert.match(protectedPage, /<ChatView\s*\/>/);
  const privacy = chatView.indexOf("aria-label=\"Privacidad\"");
  const preview = chatView.indexOf("aria-label=\"Versión de prueba\"");
  const transcript = chatView.indexOf("{visibleMessages.map");
  assert.ok(privacy >= 0 && preview > privacy && transcript > preview);
  assert.match(chatView, /¿Qué celebración estás planeando/);
  assert.match(chatView, /para quién es/);
  assert.match(chatView, /min-h-dvh/);
  assert.match(chatView, /safe-area-inset-bottom/);
  assert.match(composer, /<textarea/);
});

test("server snapshots restore messages, progress, and the current brief version", () => {
  const snapshot = parseAdvisorSnapshot({
    conversation: { id: "conv-1" },
    messages: [{ id: "turn-1", role: "user", content: "Una fiesta" }, { id: "turn-1:assistant", role: "assistant", content: "¡Claro!" }],
    state: { directionOffers: [], standardPackage: null, summary: null, approval: null },
    progress: { complete: false, completed: 2, required: 5, missing: ["date"] },
    briefVersion: 4,
  });
  assert.equal(snapshot?.conversationId, "conv-1");
  assert.equal(snapshot?.messages.length, 2);
  assert.equal(snapshot?.messages.at(-1)?.content, "¡Claro!");
  assert.deepEqual(snapshot?.progress, { complete: false, completed: 2, required: 5, missing: ["date"] });
  assert.equal(snapshot?.briefVersion, 4);
  assert.equal(parseAdvisorSnapshot({ conversation: { id: "conv-1" }, messages: [], progress: {}, briefVersion: 0 }), null);
  assert.equal(parseCreatedConversation({ conversation: { id: "conv-2" }, state: { directionOffers: [], standardPackage: null, summary: null, approval: null }, progress: { complete: false, completed: 0, required: 5, missing: [] }, briefVersion: 1 })?.conversationId, "conv-2");
});

test("only the conversation ID is stored locally and restore/create use authenticated server routes", () => {
  assert.equal(ADVISOR_CONVERSATION_STORAGE_KEY, "asesor.conversationId");
  assert.match(hook, /localStorage\.getItem\(ADVISOR_CONVERSATION_STORAGE_KEY\)/);
  assert.match(hook, /localStorage\.setItem\(ADVISOR_CONVERSATION_STORAGE_KEY, created\.conversationId\)/);
  assert.doesNotMatch(hook, /localStorage\.setItem\([^,]+,\s*(?:JSON\.stringify\(messages|draft|progress|briefVersion)/);
  assert.match(hook, /fetch\(`\/api\/asesor\/conversations\/\$\{encodeURIComponent\(storedId\)\}`/);
  assert.match(hook, /setMessages\(snapshot\.messages\)/);
  assert.match(hook, /lastMessage\?\.role === "user"/);
  assert.match(hook, /setPendingTurn\(\{ id: lastMessage\.id, content: lastMessage\.content \}\)/);
  assert.match(createRoute, /calculateBriefProgress\(state\.brief\)/);
  assert.match(restoreRoute, /calculateBriefProgress\(state\.brief\)/);
  assert.match(restoreRoute, /briefVersion: brief\?\.version/);
});

test("retry reuses the pending turn ID and failed conversation IDs have a recovery action", () => {
  assert.match(hook, /turnId: turn\.id/);
  assert.match(hook, /const retry = useCallback\(\(\) => \{ if \(pendingTurn\) void sendTurn\(pendingTurn\); \}/);
  assert.match(hook, /current\.filter\(\(message\) => message\.id !== event\.messageId\)/);
  assert.match(chatView, /conversation\.status === "invalid"/);
  assert.match(chatView, /Empezar una conversación nueva/);
});

test("Composer exposes camera/gallery upload, advisor dictation, and sourced direction/package cards", () => {
  assert.match(composer, /capabilities\.voice && onVoiceText/);
  assert.match(composer, /<BotonVoz/);
  assert.match(composer, /card\.kind === "direction" \? "Dirección" : "Paquete"/);
  assert.match(composer, /capture="environment"/);
  assert.match(composer, /Elegir foto de la galería/);
  assert.match(composer, /card\.imageUrl/);
  assert.match(hook, /fetch\("\/api\/asesor\/photos"/);
  assert.match(hook, /const capabilities: ComposerCapabilities = \{ photo: true, voice: true \}/);
  assert.match(chatView, /Resumen para revisar/);
  assert.match(chatView, /Ver resumen aprobado/);
  assert.match(chatView, /onVoiceText=\{setDraft\}/);
});

test("advisor replies render as plain text: Markdown emphasis and list markers are not shown raw", () => {
  const raw = "Para armar la propuesta:\n\n* **Nombre del cumpleañero/a**\n- **Fecha y hora de inicio**\n## Detalles\nUn 5*3 y snake_case quedan igual.";
  assert.equal(plainChatText(raw), "Para armar la propuesta:\n\n• Nombre del cumpleañero/a\n• Fecha y hora de inicio\nDetalles\nUn 5*3 y snake_case quedan igual.");
  assert.match(chatView, /plainChatText\(message\.content\)/);
  assert.match(chatView, /plainChatText\(conversation\.streamingText\)/);
});
