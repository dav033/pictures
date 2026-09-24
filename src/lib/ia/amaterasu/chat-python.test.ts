import assert from "node:assert/strict";
import test from "node:test";
import { PythonAdapterError, type PythonAdapterErrorCode } from "@/lib/ia/python-adapter";
import { ErrorIA } from "@/lib/ia/tipos";
import { errorIADeTransportePython as errorIADeAdaptador } from "@/lib/ia/error-ia-python";
import { crearChatTurnoPython } from "./chat-python";

const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000002";

test("turno() rechaza un historial que no es un único mensaje de usuario", async () => {
  const chat = crearChatTurnoPython({ requestId: REQUEST_ID, correlationId: CORRELATION_ID });
  await assert.rejects(
    () => chat.turno({ sistema: "sistema", historial: [], herramientas: [] }),
    /solo admite un PeticionChat con un único mensaje de usuario/,
  );
  await assert.rejects(
    () => chat.turno({
      sistema: "sistema",
      historial: [{ rol: "usuario", texto: "hola" }, { rol: "asistente", texto: "hola" }],
      herramientas: [],
    }),
    /solo admite un PeticionChat con un único mensaje de usuario/,
  );
});

test("turno() rechaza un tipo de imagen no admitido antes de llamar a Python", async () => {
  const chat = crearChatTurnoPython({ requestId: REQUEST_ID, correlationId: CORRELATION_ID });
  await assert.rejects(
    () => chat.turno({
      sistema: "sistema",
      historial: [{ rol: "usuario", texto: "hola", imagenes: [{ id: "REF_01", mime: "image/gif", base64: "aGVsbG8=" }] }],
      herramientas: [],
    }),
    /tipo de imagen no admitido/,
  );
});

test("turnoStream() no está implementado y lo dice explícitamente", () => {
  const chat = crearChatTurnoPython({ requestId: REQUEST_ID, correlationId: CORRELATION_ID });
  assert.throws(() => chat.turnoStream({ sistema: "s", historial: [], herramientas: [] }), /no implementa turnoStream/);
});

test("errorIADeAdaptador mapea los códigos de PythonAdapterError a la misma causa que el adaptador de Gemini", () => {
  const de = (code: PythonAdapterErrorCode) => errorIADeAdaptador(new PythonAdapterError({
    code,
    status: 502,
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
  }));

  assert.equal(de("PYTHON_BACKEND_NOT_CONFIGURED").causa, "sin_llave");
  assert.equal(de("PYTHON_AUTH_FAILED").causa, "sin_llave");
  assert.equal(de("PYTHON_SCOPE_DENIED").causa, "sin_llave");
  assert.equal(de("PYTHON_BACKEND_TIMEOUT").causa, "timeout");
  assert.equal(de("PYTHON_REQUEST_CANCELLED").causa, "timeout");
  assert.equal(de("PYTHON_UNAVAILABLE").causa, "desconocido");
  assert.equal(de("PYTHON_UNAVAILABLE").reintentable, true);
});

test("errorIADeAdaptador deja pasar un ErrorIA tal cual, sin reenvolverlo", () => {
  const original = new ErrorIA("filtrado", "gemini", "contenido filtrado", false);
  assert.equal(errorIADeAdaptador(original), original);
});
