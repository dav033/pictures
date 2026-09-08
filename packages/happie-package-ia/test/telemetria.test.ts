import assert from "node:assert/strict";
import test from "node:test";
import { registrarTelemetriaSeguro } from "../src/recomendador";

test("un fallo del consumidor de telemetría no rompe Happie", () => {
  assert.doesNotThrow(() => registrarTelemetriaSeguro(() => {
    throw new Error("store unavailable");
  }, { modelo: "fake", ms: 1, resultado: "ok" }));
});
