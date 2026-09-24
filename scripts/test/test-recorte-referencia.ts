import assert from "node:assert/strict";
import { estiloRecorte, imagenDeReferencia, posicionCentrada } from "@/components/referencia/recorte";

/**
 * Recorte real de cada pieza de la foto de referencia (maqueta Main de la
 * iteración 4): la tarjeta de propuesta muestra la zona `reference_bbox` de la
 * foto del cliente sin deformarla y sin pedir nada al servidor.
 */

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`[PASS] ${nombre}`);
}

function numero(valor: string): number {
  return Number(valor.replace("%", "")) / 100;
}

/** Region of the photo (normalized) that a frame shows with the given style. */
function regionVisible(estilo: NonNullable<ReturnType<typeof estiloRecorte>>) {
  const ancho = 1 / numero(estilo.width);
  const alto = 1 / numero(estilo.height);
  return { x: -numero(estilo.left) * ancho, y: -numero(estilo.top) * alto, width: ancho, height: alto };
}

{
  // Semiarco izquierdo de una foto 1200×800 en un marco vertical 112×164.
  const natural = { ancho: 1200, alto: 800 };
  const caja = { x: 0.02, y: 0.05, width: 0.34, height: 0.9 };
  const estilo = estiloRecorte(caja, natural, 112 / 164, 0);
  assert.ok(estilo, "la pieza cabe en la foto");
  const region = regionVisible(estilo);
  const aspectoPx = (region.width * natural.ancho) / (region.height * natural.alto);
  assert.ok(Math.abs(aspectoPx - 112 / 164) < 0.002, `sin deformar: aspecto ${aspectoPx}`);
  assert.ok(region.x <= caja.x + 1e-3 && region.x + region.width >= caja.x + caja.width - 1e-3, "cubre todo el ancho de la pieza");
  assert.ok(region.y <= caja.y + 1e-3 && region.y + region.height >= caja.y + caja.height - 1e-3, "cubre todo el alto de la pieza");
  assert.ok(region.x >= -1e-3 && region.y >= -1e-3 && region.x + region.width <= 1 + 1e-3 && region.y + region.height <= 1 + 1e-3, "no sale de la foto");
  ok("recorte vertical sin deformar y dentro de la foto");
}

{
  // Pieza pegada al borde derecho: el recorte se desplaza para no mostrar vacío.
  const estilo = estiloRecorte({ x: 0.9, y: 0.4, width: 0.1, height: 0.2 }, { ancho: 1000, alto: 1000 }, 1);
  assert.ok(estilo);
  const region = regionVisible(estilo);
  assert.ok(Math.abs(region.x + region.width - 1) < 1e-3, "se apoya en el borde derecho");
  ok("pieza en el borde se desplaza hacia dentro");
}

{
  // Una pieza que ocupa toda la altura no se puede llevar a un marco horizontal sin salir de la foto.
  assert.equal(estiloRecorte({ x: 0, y: 0, width: 0.2, height: 1 }, { ancho: 800, alto: 1200 }, 3), null);
  assert.equal(estiloRecorte({ x: 0, y: 0, width: 0.2, height: 0.2 }, { ancho: 0, alto: 0 }, 1), null, "sin tamaño natural no hay recorte");
  assert.equal(posicionCentrada({ x: 0.1, y: 0.2, width: 0.2, height: 0.4 }), "20% 40%");
  ok("sin recorte posible se usa cover centrado en la pieza");
}

{
  const imagenes = [{ base64: "a", mime: "image/jpeg" }, { base64: "b", mime: "image/png" }];
  assert.equal(imagenDeReferencia(imagenes, "REF_02")?.base64, "b", "REF_02 es la segunda foto adjunta");
  assert.equal(imagenDeReferencia(imagenes, "REF_03"), undefined);
  assert.equal(imagenDeReferencia([{ id: "REF_02", base64: "x", mime: "image/jpeg" }, { id: "REF_01", base64: "y", mime: "image/jpeg" }], "REF_01")?.base64, "y", "un id explícito manda");
  ok("cada elemento encuentra su foto por REF_NN");
}

console.log(`\n${casos} casos OK (recorte de piezas de la referencia)`);
