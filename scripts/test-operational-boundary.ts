import assert from "node:assert/strict";
import {
  BackendSelectionV1Schema,
  InternalRequestSignatureV1Schema,
  OperationalContextV1Schema,
  decidirIdempotencia,
  firmarRequestInterna,
  seleccionarBackendMigracion,
  sha256Body,
  verificarRequestInterna,
} from "../src/lib/ia/contracts/operational-v1";

const secret = "0123456789abcdef0123456789abcdef";
const bodySha256 = sha256Body('{"ok":true}');
const firma = firmarRequestInterna({
  secret,
  method: "POST",
  path: "/internal/chat",
  bodySha256,
  scopes: ["chat.execute"],
  timestamp: 1_700_000_000,
  nonce: "00000000-0000-4000-8000-000000000001",
});

InternalRequestSignatureV1Schema.parse(firma);
assert.equal(verificarRequestInterna({
  secret,
  signature: firma,
  method: "POST",
  path: "/internal/chat",
  bodySha256,
  nowSeconds: 1_700_000_010,
  requiredScopes: ["chat.execute"],
}), true);
assert.equal(verificarRequestInterna({
  secret,
  signature: firma,
  method: "POST",
  path: "/internal/chat",
  bodySha256: sha256Body("alterado"),
  nowSeconds: 1_700_000_010,
}), false);
assert.equal(verificarRequestInterna({
  secret,
  signature: firma,
  method: "POST",
  path: "/internal/chat",
  bodySha256,
  nowSeconds: 1_700_000_400,
}), false);

assert.equal(decidirIdempotencia(undefined, bodySha256), "new");
assert.equal(decidirIdempotencia(bodySha256, bodySha256), "replay");
assert.equal(decidirIdempotencia(bodySha256, sha256Body("otro")), "conflict");

const contexto = OperationalContextV1Schema.parse({
  schema_version: "operational.v1",
  request_id: "00000000-0000-4000-8000-000000000002",
  correlation_id: "00000000-0000-4000-8000-000000000003",
  deadline_at: "2026-09-07T12:00:00.000Z",
  deadline_ms: 75_000,
  body_sha256: bodySha256,
  scopes: [],
});
assert.equal(contexto.deadline_ms, 75_000);
assert.deepEqual(seleccionarBackendMigracion({ PYTHON_BACKEND_ENABLED: "true" }), {
  schema_version: "operational.v1",
  backend: "python",
  kill_switch: false,
});
assert.deepEqual(seleccionarBackendMigracion({ PYTHON_BACKEND_ENABLED: "true", PYTHON_BACKEND_KILL_SWITCH: "true" }), {
  schema_version: "operational.v1",
  backend: "next",
  kill_switch: true,
});
assert.equal(BackendSelectionV1Schema.parse(seleccionarBackendMigracion()).backend, "next");

console.log("Operational boundary: OK");
