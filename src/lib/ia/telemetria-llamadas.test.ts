import assert from "node:assert/strict";
import test from "node:test";
import { bytesBase64, resultadoTelemetria } from "./telemetria-llamadas";

test("cuenta bytes base64 sin guardar contenido", () => {
  assert.equal(bytesBase64("YQ=="), 1);
  assert.equal(bytesBase64("YWI="), 2);
  assert.equal(bytesBase64("YWJj"), 3);
});

test("clasifica cancelación y timeout sin copiar mensajes", () => {
  assert.equal(resultadoTelemetria(new DOMException("secreto", "AbortError")), "cancelado");
  assert.equal(resultadoTelemetria(new DOMException("secreto", "TimeoutError")), "timeout");
  assert.equal(resultadoTelemetria(new Error("secreto")), "error");
});
