import assert from "node:assert/strict";
import test from "node:test";
import { bytesDeBase64 } from "@sempertex/agente-core";
import { resultadoTelemetria } from "./telemetria-llamadas";

test("cuenta bytes base64 sin guardar contenido", () => {
  assert.equal(bytesDeBase64("YQ=="), 1);
  assert.equal(bytesDeBase64("YWI="), 2);
  assert.equal(bytesDeBase64("YWJj"), 3);
  assert.equal(bytesDeBase64(""), 0);
  assert.equal(bytesDeBase64(" YW\nJj "), 3);
});

test("clasifica cancelación y timeout sin copiar mensajes", () => {
  assert.equal(resultadoTelemetria(new DOMException("secreto", "AbortError")), "cancelado");
  assert.equal(resultadoTelemetria(new DOMException("secreto", "TimeoutError")), "timeout");
  assert.equal(resultadoTelemetria(new Error("secreto")), "error");
});
