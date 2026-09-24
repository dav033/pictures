import assert from "node:assert/strict";
import test from "node:test";
import { MAX_REFERENCIAS_ETAPA1, referenciasParaEtapa1Hibrida } from "./referencias-etapa1";
import type { ImageInput } from "../nucleo/tipos";

const entrada = (role: ImageInput["role"], priority: number, id: string = role): ImageInput =>
  ({ id, mime: "image/jpeg", base64: "", descripcion: id, role, priority, allowed_use: "" }) as ImageInput;

test("la referencia de composicion entra: es el punto de la fase 4", () => {
  const salida = referenciasParaEtapa1Hibrida([entrada("composition_reference", 2)]);
  assert.deepEqual(salida.map((i) => i.role), ["composition_reference"]);
});

test("el venue NUNCA entra a la etapa 1", () => {
  // Si el LoRA ve el venue, lo dibuja, y la etapa 2 se queda sin trabajo —
  // ademas de que FLUX.2 puede copiarle el fondo.
  const salida = referenciasParaEtapa1Hibrida([entrada("venue_base", 1), entrada("composition_reference", 2)]);
  assert.deepEqual(salida.map((i) => i.role), ["composition_reference"]);
});

test("ni el resultado previo ni la foto de producto ni la paleta", () => {
  const salida = referenciasParaEtapa1Hibrida([
    entrada("previous_generated_result", 1),
    entrada("catalog_product_reference", 2),
    entrada("palette_reference", 3),
    entrada("style_reference", 4),
  ]);
  assert.deepEqual(salida, []);
});

test("ordena por prioridad y corta en el techo", () => {
  const salida = referenciasParaEtapa1Hibrida([
    entrada("composition_reference", 5, "c"),
    entrada("element_reference", 1, "a"),
    entrada("composition_reference", 3, "b"),
  ]);
  assert.equal(salida.length, MAX_REFERENCIAS_ETAPA1);
  assert.deepEqual(salida.map((i) => i.id), ["a", "b"]);
});

test("sin referencias devuelve vacio, que es el comportamiento de hoy", () => {
  assert.deepEqual(referenciasParaEtapa1Hibrida([]), []);
  assert.deepEqual(referenciasParaEtapa1Hibrida([entrada("venue_base", 1)]), []);
});
