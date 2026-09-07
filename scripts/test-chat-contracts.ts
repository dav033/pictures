import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ChatRequestV1Schema,
  ChatSseEventV1Schema,
  ChatTranscriptV1Schema,
  ErrorEnvelopeV1Schema,
  parseChatRequestV1,
} from "../src/lib/ia/contracts/chat-v1";

const requestId = randomUUID();
function fixture(name: string): unknown {
  const filename = path.join(process.cwd(), "contracts", "chat", "v1", "fixtures", name);
  return JSON.parse(readFileSync(filename, "utf8")) as unknown;
}

const request = ChatRequestV1Schema.parse(fixture("request-basic.json"));
assert.equal(request.schema_version, "chat.v1");

const legacyRequest = parseChatRequestV1({
  messages: [{ role: "user", content: "Payload actual sin versión." }],
});
assert.equal(legacyRequest.schema_version, "chat.v1");

const transcript = ChatTranscriptV1Schema.parse(fixture("transcript-tool-calling.json"));
assert.equal(transcript.messages.length, 3);

const textEvent = ChatSseEventV1Schema.parse(fixture("sse-text.json"));
assert.equal(textEvent.type, "texto");

const finishEvent = ChatSseEventV1Schema.parse({
  schema_version: "chat.sse.v1",
  type: "fin",
  request_id: requestId,
  correlation_id: requestId,
  reply: "Listo.",
  brief: {},
  proveedor: "gemini",
  modelo: "gemini-test",
  plan: null,
});
assert.equal(finishEvent.type, "fin");

const errorEvent = ChatSseEventV1Schema.parse({
  schema_version: "chat.sse.v1",
  type: "error",
  request_id: requestId,
  correlation_id: requestId,
  error: "Tiempo agotado.",
  code: "AI_TIMEOUT",
  retryable: true,
});
assert.equal(errorEvent.type, "error");

const error = ErrorEnvelopeV1Schema.parse(fixture("error-timeout.json"));
assert.equal(error.code, "AI_TIMEOUT");

assert.throws(() => ChatRequestV1Schema.parse({ schema_version: "chat.v1", messages: [], brief: {} }));
assert.throws(() => parseChatRequestV1({ schema_version: "chat.v0", messages: [], brief: {} }));
assert.throws(() => ChatSseEventV1Schema.parse({ schema_version: "chat.sse.v1", type: "evento_desconocido", request_id: requestId }));

console.log("Chat contracts: OK");
