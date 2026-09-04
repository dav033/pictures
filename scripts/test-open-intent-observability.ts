import assert from "node:assert/strict";
import { contarNivelesCandidatos, nivelesCandidatosVacios } from "../src/lib/rag/observability/types";

assert.deepEqual(nivelesCandidatosVacios(), { exact_event: 0, thematic: 0, adaptable: 0 });
assert.deepEqual(contarNivelesCandidatos([
  { matchLevel: "exact_event" },
  { matchLevel: "thematic" },
  {},
  { matchLevel: "adaptable" },
]), { exact_event: 1, thematic: 1, adaptable: 2 });

console.log("[PASS] contrato de observabilidad de intención abierta");
