import assert from "node:assert/strict";
import { test } from "node:test";
import { historialAContents } from "../src/gemini/chat";
import type { ImagenAdjunta, Mensaje } from "../src/tipos";

// Base64 corto pero real (no depende de tamaño para el assert de "se envió o no").
const IMAGEN_BASE64 = Buffer.from("contenido-de-prueba-no-real").toString("base64");

function historialConImagen(): { historial: Mensaje[]; imagen: ImagenAdjunta } {
  const imagen: ImagenAdjunta = { base64: IMAGEN_BASE64, mime: "image/jpeg", id: "ESPACIO_BASE" };
  const historial: Mensaje[] = [
    { rol: "usuario", texto: "hola, aquí está mi espacio", imagenes: [imagen] },
  ];
  return { historial, imagen };
}

test("Fase 3.1: la primera vuelta envía inlineData y cuenta sus bytes", () => {
  const { historial } = historialConImagen();
  const vistas = new WeakSet();

  const { contents, bytesImagenEnviados } = historialAContents(historial, vistas);

  const parts = contents[0]?.parts ?? [];
  assert.ok(parts.some((p) => "inlineData" in p), "la primera vuelta debe incluir inlineData");
  assert.ok(parts.some((p) => "text" in p && p.text?.includes("[IMAGEN_ID=ESPACIO_BASE]")), "conserva el marcador textual");
  assert.ok(bytesImagenEnviados > 0, "reporta bytes reales transmitidos");
});

test("Fase 3.1: una vuelta posterior con el mismo historial NO reenvía la imagen ya vista", () => {
  const { historial } = historialConImagen();
  const vistas = new WeakSet();

  historialAContents(historial, vistas); // vuelta 1

  // Simula el crecimiento del historial dentro del mismo loop (ejecutar.ts
  // empuja mensajes de asistente/herramienta, pero el mensaje de usuario con
  // la imagen es EL MISMO objeto en el mismo índice).
  historial.push({ rol: "asistente", llamadas: [{ nombre: "buscar_catalogo_rag", args: {} }] });
  historial.push({ rol: "herramienta", nombre: "buscar_catalogo_rag", resultado: {} });

  const { contents, bytesImagenEnviados } = historialAContents(historial, vistas); // vuelta 2

  const parts = contents[0]?.parts ?? [];
  assert.ok(!parts.some((p) => "inlineData" in p), "la segunda vuelta NO debe reenviar el base64");
  assert.ok(parts.some((p) => "text" in p && p.text?.includes("[IMAGEN_ID=ESPACIO_BASE]")), "el modelo sigue viendo la referencia textual");
  assert.equal(bytesImagenEnviados, 0, "no se cuentan bytes de una imagen ya transmitida");
});

test("Fase 3.1: una imagen nueva en una vuelta posterior sí se envía", () => {
  const { historial, imagen } = historialConImagen();
  const vistas = new WeakSet();
  historialAContents(historial, vistas); // vuelta 1: ESPACIO_BASE ya visto

  const imagenNueva: ImagenAdjunta = { base64: IMAGEN_BASE64, mime: "image/jpeg", id: "ESTILO_01" };
  historial.push({ rol: "usuario", texto: "y esta es otra referencia", imagenes: [imagenNueva] });

  const { contents, bytesImagenEnviados } = historialAContents(historial, vistas);

  const partesNuevoMensaje = contents[1]?.parts ?? [];
  assert.ok(partesNuevoMensaje.some((p) => "inlineData" in p), "una imagen nunca vista sí se envía");
  assert.ok(bytesImagenEnviados > 0, "cuenta los bytes de la imagen nueva, no de la ya vista");
  assert.notEqual(imagen.id, imagenNueva.id);
});
