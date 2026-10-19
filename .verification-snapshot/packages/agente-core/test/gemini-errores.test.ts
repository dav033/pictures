import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "@google/genai";
import { categorizarError, PREFIJO_IMAGEN_RECHAZADA } from "../src/gemini/chat";
import { ErrorIA } from "../src/tipos";

const RECHAZO_IMAGEN = JSON.stringify({ error: { code: 400, message: "Unable to process input image. Please retry or report in https://developers.generativeai.google/guide/troubleshooting", status: "INVALID_ARGUMENT" } });

test("hallazgo #5: un 400 INVALID_ARGUMENT sobre una petición con imagen es un rechazo de imagen no reintentable", () => {
  const error = categorizarError(new ApiError({ message: RECHAZO_IMAGEN, status: 400 }), true);
  assert.ok(error instanceof ErrorIA);
  assert.equal(error.reintentable, false);
  assert.ok(error.message.startsWith(`${PREFIJO_IMAGEN_RECHAZADA}: `), error.message);
});

test("un 400 genérico con imagen también es rechazo de imagen; sin imagen sigue siendo desconocido reintentable", () => {
  const generico = new ApiError({ message: "Request contains an invalid argument.", status: 400 });
  assert.equal(categorizarError(generico, true).reintentable, false);
  const sinImagen = categorizarError(generico, false);
  assert.equal(sinImagen.reintentable, true);
  assert.equal(sinImagen.causa, "desconocido");
  assert.ok(!sinImagen.message.startsWith(PREFIJO_IMAGEN_RECHAZADA));
});

test("un 400 por herramientas o thought_signature no se atribuye a la imagen", () => {
  const herramientas = categorizarError(new ApiError({ message: "Invalid JSON payload: tools[0].function_declarations[0].parameters schema", status: 400 }), true);
  assert.ok(!herramientas.message.startsWith(PREFIJO_IMAGEN_RECHAZADA));
  assert.equal(herramientas.reintentable, true);
  const firma = categorizarError(new ApiError({ message: "missing thought_signature INVALID_ARGUMENT", status: 400 }), true);
  assert.ok(!firma.message.startsWith(PREFIJO_IMAGEN_RECHAZADA));
});

test("errores realmente desconocidos y 5xx siguen siendo reintentables", () => {
  assert.equal(categorizarError(new Error("socket hang up"), true).reintentable, true);
  assert.equal(categorizarError(new ApiError({ message: "internal", status: 500 }), true).reintentable, true);
  assert.equal(categorizarError(new ApiError({ message: "quota exceeded", status: 429 }), true).causa, "cuota");
});
