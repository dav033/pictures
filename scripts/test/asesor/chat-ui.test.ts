import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { plainChatText } from "../../../src/components/asesor/chat-text";
import { asksOnlyForStartTime } from "../../../src/components/asesor/start-time";
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
  assert.match(chatView, /Cuéntame sobre la celebración que tienes en mente/);
  assert.match(chatView, /qué celebran y para quién es/);
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
  assert.match(createRoute, /calculateStateProgress\(state\)/);
  assert.match(restoreRoute, /calculateStateProgress\(state\)/);
  assert.match(restoreRoute, /briefVersion: brief\?\.version/);
});

test("retry reuses the pending turn ID and failed conversation IDs have a recovery action", () => {
  assert.match(hook, /turnId: turn\.id/);
  assert.match(hook, /const retry = useCallback\(\(\) => \{ if \(pendingTurn\) void sendTurn\(pendingTurn\); \}/);
  assert.match(hook, /current\.filter\(\(message\) => message\.id !== event\.messageId\)/);
  assert.match(chatView, /conversation\.status === "invalid"/);
  assert.match(chatView, /Empezar una conversación nueva/);
});

test("Composer exposes camera/gallery upload and advisor dictation; offers render in the transcript", () => {
  assert.match(composer, /capabilities\.voice && onVoiceText/);
  assert.match(composer, /<BotonVoz/);
  assert.match(composer, /voiceNote && !value\.trim\(\)/);
  assert.match(composer, /<VoiceNoteButton/);
  assert.match(composer, /capture="environment"/);
  assert.match(composer, /Elegir foto de la galería/);
  assert.match(chatView, /aria-label="Opciones para continuar"/);
  assert.match(chatView, /<DirectionCards/);
  assert.match(chatView, /<PackageCard/);
  assert.match(hook, /fetch\("\/api\/asesor\/photos"/);
  assert.match(hook, /const capabilities: ComposerCapabilities = \{ photo: true, voice: true \}/);
  assert.match(chatView, /<SummaryCard/);
  assert.match(chatView, /onVoiceText=\{setDraft\}/);
  assert.match(chatView, /ADVISOR_DIRECTIONS_ENABLED \? conversation\.cards\.filter/);
  assert.match(chatView, /onNote: conversation\.submitVoiceNote/);
  assert.match(hook, /const submitVoiceNote = useCallback\(\(turnId: string, text: string\)/);
});

test("advisor replies render as plain text: Markdown emphasis and list markers are not shown raw", () => {
  const raw = "Para armar la propuesta:\n\n* **Nombre del cumpleañero/a**\n- **Fecha y hora de inicio**\n## Detalles\nUn 5*3 y snake_case quedan igual.";
  assert.equal(plainChatText(raw), "Para armar la propuesta:\n\n• Nombre del cumpleañero/a\n• Fecha y hora de inicio\nDetalles\nUn 5*3 y snake_case quedan igual.");
  assert.match(chatView, /plainChatText\(message\.content\)/);
  assert.match(chatView, /plainChatText\(conversation\.streamingText\)/);
});

test("the animated start-time picker appears only on the server's start-time step", () => {
  assert.equal(asksOnlyForStartTime({ complete: false, completed: 7, required: 10, missing: ["startTime", "contactName", "contactPhoneOrEmail"], step: "start_time" }), true);
  assert.equal(asksOnlyForStartTime({ complete: false, completed: 8, required: 10, missing: ["startTime", "date"], step: "event" }), false);
  assert.equal(asksOnlyForStartTime({ complete: false, completed: 9, required: 10, missing: ["contactName"], step: "contact" }), false);
  assert.equal(asksOnlyForStartTime({ complete: false, completed: 9, required: 10, missing: ["startTime"] }), false, "no step: older server");
  assert.equal(asksOnlyForStartTime(null), false);
  assert.match(chatView, /<StartTimePicker/);
});
