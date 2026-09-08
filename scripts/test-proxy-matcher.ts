import assert from "node:assert/strict";
import { config } from "../src/proxy";

const matcher = new RegExp(`^${config.matcher[0]}$`);

for (const [path, shouldMatch] of [
  ["/api/rag/webhooks/shopify", false],
  ["/api/happie/webhook", false],
  ["/api/chat", true],
  ["/login", false],
  ["/api/login", false],
] as const) {
  assert.equal(matcher.test(path), shouldMatch, `resultado inesperado para ${path}`);
}

console.log("Proxy matcher: OK");
