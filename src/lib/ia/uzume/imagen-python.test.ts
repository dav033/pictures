import assert from "node:assert/strict";
import test from "node:test";
import { PythonAdapterError, type PythonAdapterErrorCode } from "@/lib/ia/nucleo/python-adapter";
import { ErrorIA } from "@/lib/ia/nucleo/tipos";
import type { ImageInput, PeticionImagen } from "@/lib/ia/nucleo/tipos";
import { construirInput, errorIADeAdaptador } from "./imagen-python";

const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000002";

function peticion(inputs: ImageInput[]): PeticionImagen {
  return {
    prompt: "Un arco de globos dorados en la entrada.",
    inputs,
    aspecto: "3:2",
    calidad: "alta",
  };
}

test("construirInput antepone el prompt y etiqueta cada imagen con su rol", () => {
  const input: ImageInput = {
    id: "REF_01",
    mime: "image/jpeg",
    base64: "aGVsbG8=",
    descripcion: "foto del espacio real",
    role: "venue_base",
    priority: 1,
    allowed_use: "Venue identity: camera, crop, architecture, perspective, and light.",
  };
  const bloques = construirInput(peticion([input]));

  assert.equal(bloques.length, 3);
  assert.deepEqual(bloques[0], { type: "text", text: "Un arco de globos dorados en la entrada." });
  assert.equal(bloques[1]?.type, "text");
  assert.match((bloques[1] as { text: string }).text, /Reference image role: venue_base/);
  assert.match((bloques[1] as { text: string }).text, /Allowed use: Venue identity/);
  assert.match((bloques[1] as { text: string }).text, /foto del espacio real/);
  assert.deepEqual(bloques[2], { type: "image", data: "aGVsbG8=", mimeType: "image/jpeg" });
});

test("construirInput corta en 14 imagenes, igual que el camino directo", () => {
  const imagenes: ImageInput[] = Array.from({ length: 20 }, (_, index) => ({
    id: `REF_${index}`,
    mime: "image/png",
    base64: "aGVsbG8=",
    descripcion: "",
    role: "composition_reference",
    priority: index,
    allowed_use: "Composition reference only.",
  }));
  const bloques = construirInput(peticion(imagenes));
  // 1 prompt + 14*2 (etiqueta + imagen) = 29
  assert.equal(bloques.length, 29);
});

test("errorIADeAdaptador usa el domainCode de Python para elegir la causa", () => {
  const de = (domainCode: string | undefined) => errorIADeAdaptador(new PythonAdapterError({
    code: "PYTHON_INVALID_REQUEST",
    status: 502,
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    domainCode,
  }));

  assert.equal(de("image_generate_unavailable").causa, "sin_llave");
  assert.equal(de("image_generate_quota").causa, "cuota");
  assert.equal(de("image_generate_filtered").causa, "filtrado");
  assert.equal(de("image_generate_timeout").causa, "timeout");
  assert.equal(de("image_generate_provider_error").causa, "desconocido");
  assert.equal(de(undefined).causa, "desconocido");
});

test("errorIADeAdaptador cae al código de transporte cuando no hay domainCode", () => {
  const de = (code: PythonAdapterErrorCode) => errorIADeAdaptador(new PythonAdapterError({
    code,
    status: 502,
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
  }));

  assert.equal(de("PYTHON_BACKEND_NOT_CONFIGURED").causa, "sin_llave");
  assert.equal(de("PYTHON_BACKEND_TIMEOUT").causa, "timeout");
  assert.equal(de("PYTHON_UNAVAILABLE").causa, "desconocido");
});

test("errorIADeAdaptador deja pasar un ErrorIA tal cual, sin reenvolverlo", () => {
  const original = new ErrorIA("filtrado", "gemini", "contenido filtrado", false);
  assert.equal(errorIADeAdaptador(original), original);
});
