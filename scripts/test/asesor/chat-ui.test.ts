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
  const assistantText = readFileSync("src/components/asesor/AssistantText.tsx", "utf8");
  assert.match(assistantText, /plainChatText\(content\)/);
  assert.match(chatView, /<AssistantText id=\{message\.id\} content=\{message\.content\}/);
  assert.match(chatView, /<AssistantText id=\{conversation\.streamingId \?\? "streaming"\} content=\{conversation\.streamingText\}/);
});

test("the animated start-time picker appears only on the server's start-time step", () => {
  assert.equal(asksOnlyForStartTime({ complete: false, completed: 7, required: 10, missing: ["startTime", "contactName", "contactPhoneOrEmail"], step: "start_time" }), true);
  assert.equal(asksOnlyForStartTime({ complete: false, completed: 8, required: 10, missing: ["startTime", "date"], step: "event" }), false);
  assert.equal(asksOnlyForStartTime({ complete: false, completed: 9, required: 10, missing: ["contactName"], step: "contact" }), false);
  assert.equal(asksOnlyForStartTime({ complete: false, completed: 9, required: 10, missing: ["startTime"] }), false, "no step: older server");
  assert.equal(asksOnlyForStartTime(null), false);
  assert.match(chatView, /<StartTimePicker/);
});

test("replies type out smoothly and what hangs off a reply waits for it to finish", async () => {
  const { advanceReveal, revealSpeed, revealedSlice, MIN_CHARS_PER_SECOND, MAX_CHARS_PER_SECOND } = await import("../../../src/components/asesor/reveal");
  assert.equal(revealSpeed(0), MIN_CHARS_PER_SECOND, "a short reply is typed at a readable pace");
  assert.equal(revealSpeed(100_000), MAX_CHARS_PER_SECOND, "a long backlog never types faster than the cap");
  assert.ok(revealSpeed(500) > revealSpeed(50), "it speeds up when it falls behind");
  const frames = Array.from({ length: 600 }, () => 16);
  let position = 0;
  for (const dt of frames) position = advanceReveal(position, 400, dt);
  assert.equal(position, 400, "a 400-character reply is fully shown well within 10 s of frames");
  const step = advanceReveal(0, 400, 16);
  assert.ok(step > 0 && step < 20, "one frame reveals a few characters, not the whole reply");
  assert.equal(advanceReveal(400, 400, 16), 400);
  assert.equal(advanceReveal(10, 400, -50), 10, "time never runs backwards");
  assert.equal(revealedSlice("Hola 😀 mundo", 6), "Hola 😀", "an emoji is never cut in half");
  assert.equal(revealedSlice("Hola", 99), "Hola");
  const settledGate = (source: string, marker: RegExp) => assert.match(source, marker);
  settledGate(chatView, /idle && settled && progress\?\.ask && <QuickReplies/);
  settledGate(chatView, /idle && settled && progress\?\.step === "contact"/);
  settledGate(chatView, /idle && settled && asksOnlyForStartTime/);
  settledGate(chatView, /conversation\.summary && settled && <SummaryCard/);
  settledGate(chatView, /!revealing\.has\(message\.id\)\) && <ChangeNotes|!revealing\.has\(message\.id\) && <ChangeNotes/);
  const hook = readFileSync("src/components/asesor/use-revealed-text.ts", "utf8");
  assert.match(hook, /prefers-reduced-motion: reduce/, "reduced motion gets the whole text at once");
});

test("a voice note shows as a WhatsApp-style bubble at once, with the transcript filling in under it", async () => {
  const { waveformFromLevels, placeholderWaveform, clock, WAVEFORM_BARS } = await import("../../../src/components/asesor/waveform");
  const quiet = waveformFromLevels([0.02, 0.03, 0.02, 0.04]);
  assert.equal(quiet.length, WAVEFORM_BARS);
  assert.ok(quiet.every((height) => height >= 0.12 && height <= 1), "heights stay in range even for a quiet recording");
  assert.ok(Math.max(...quiet) < 0.3, "background noise is not blown up into a loud-looking note");
  assert.equal(Math.max(...waveformFromLevels([0.1, 0.5, 0.3, 0.2])), 1, "speech is scaled so its loudest bar fills the height");
  const loud = waveformFromLevels([0, 0, 1, 1, 0, 0, 1, 0.5]);
  assert.ok(loud[WAVEFORM_BARS - 1] <= loud.reduce((a, b) => Math.max(a, b), 0));
  assert.equal(waveformFromLevels([]).length, WAVEFORM_BARS, "no samples: a placeholder shape");
  assert.deepEqual(placeholderWaveform("abc"), placeholderWaveform("abc"), "a restored note always draws the same bars");
  assert.notDeepEqual(placeholderWaveform("abc"), placeholderWaveform("abd"));
  assert.equal(clock(7), "0:07"); assert.equal(clock(65.4), "1:05"); assert.equal(clock(-3), "0:00");
  const bubble = readFileSync("src/components/asesor/VoiceNoteBubble.tsx", "utf8");
  assert.match(bubble, /aria-label=\{playing \? "Pausar nota de voz" : "Escuchar nota de voz"\}/);
  assert.match(bubble, /state === "transcribing"[\s\S]*Transcribiendo/);
  assert.match(bubble, /state === "failed"[\s\S]*Descartar nota de voz/);
  assert.match(chatView, /<VoiceNoteBubble message=\{message\}/);
  assert.match(chatView, /conversation\.voicePending \|\| /, "the composer waits while the transcript is pending");
  assert.match(hook, /state: "transcribing"/);
  assert.match(hook, /URL\.revokeObjectURL/, "recordings are released when they leave the screen");
  const button = readFileSync("src/components/asesor/VoiceNoteButton.tsx", "utf8");
  assert.match(button, /onRecorded\(\{ turnId: id, url: URL\.createObjectURL\(audio\)/, "the recording is reported before the upload starts");
});

test("recording shows a live waveform, names the microphone in use and lets the customer pick another", () => {
  const button = readFileSync("src/components/asesor/VoiceNoteButton.tsx", "utf8");
  const dictation = readFileSync("src/components/voz/useDictado.ts", "utf8");
  assert.match(button, /<LiveWaveform levels=\{history\}/);
  assert.match(button, /No se detecta sonido en tu micrófono/);
  assert.match(button, /enumerateDevices/);
  assert.match(button, /SILENCE_PEAK/);
  assert.match(dictation, /deviceId: \{ exact: elegido \}/, "the chosen microphone is requested by id");
  assert.match(dictation, /OverconstrainedError/, "a microphone that no longer exists falls back to the default one");
  assert.match(dictation, /addEventListener\("ended"/, "a track the browser cuts is reported instead of sending an empty recording");
  assert.match(dictation, /microfono_cortado/);
});

test("photos offer the keep chips and the venue photo asks where the decoration goes", () => {
  const notes = readFileSync("src/components/asesor/PhotoNotes.tsx", "utf8");
  assert.match(notes, /KEEP_OPTIONS\.map/);
  assert.match(notes, /¿Qué es lo más importante de conservar de esta referencia\?/);
  assert.match(notes, /keepReplyMessage\(photoNumber, picked\)/);
  assert.match(chatView, /<PhotoNotes photo=\{photo\} photoNumber=\{photoNumbers\.get\(photo\.id\) \?\? 1\}/);
  const base = readFileSync("src/lib/asesor/prompts/base.ts", "utf8");
  assert.match(base, /foto del lugar, pregunta en qué parte irá la decoración/);
  assert.match(base, /decorationPlacement/);
});
