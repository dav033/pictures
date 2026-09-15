/**
 * Iteración 4 (revisión): al recargar, la conversación guardada en
 * sessionStorage conserva una miniatura liviana de las fotos de cada turno
 * (mensaje del cliente y recortes por pieza de la propuesta), con un tope de
 * imágenes y de tamaño para no romper el límite del almacenamiento.
 * Determinista, sin navegador. Run: npx tsx scripts/test-persistencia-adjuntos.ts
 */
import assert from "node:assert/strict";
import {
  aligerarAdjuntos,
  claveImagen,
  imagenesSinMiniatura,
  MAX_CARACTERES_MINIATURA,
  MAX_IMAGENES_GUARDADAS,
  type AdjuntosTurno,
} from "../src/lib/estado/persistencia-adjuntos";

type Mensaje = { id: string; adjuntos?: AdjuntosTurno };

const foto = (semilla: string) => ({ base64: `${semilla.repeat(400)}FIN${semilla}`, mime: "image/jpeg" });
const miniatura = (semilla: string) => `data:image/jpeg;base64,MINI${semilla}`;

const referencia = foto("r");
const espacio = foto("e");
const mensajes: Mensaje[] = [
  { id: "cliente", adjuntos: { referencias: [{ id: "REF_01", ...referencia }], fotoEspacio: espacio } },
  { id: "propuesta", adjuntos: { referencias: [{ id: "REF_01", ...referencia }], fotoEspacio: espacio } },
  { id: "texto" },
];

// Sin miniaturas todavía: no se guarda ningún base64 pesado.
const sinMiniaturas = aligerarAdjuntos(mensajes, new Map());
assert.equal(sinMiniaturas[0]!.adjuntos, undefined, "sin miniatura lista, el turno se guarda sin fotos");
assert.equal(JSON.stringify(sinMiniaturas).includes(referencia.base64), false, "nunca el base64 original");
assert.deepEqual(imagenesSinMiniatura(mensajes, new Map()).map(claveImagen).sort(), [claveImagen(espacio), claveImagen(referencia)].sort(), "pide cada foto una sola vez");

// Con miniaturas: se guardan con el mismo id REF_01 para que los recortes sigan enlazados.
const miniaturas = new Map([[claveImagen(referencia), miniatura("r")], [claveImagen(espacio), miniatura("e")]]);
const livianos = aligerarAdjuntos(mensajes, miniaturas);
assert.deepEqual(livianos[1]!.adjuntos, { referencias: [{ id: "REF_01", base64: miniatura("r"), mime: "image/jpeg" }], fotoEspacio: { base64: miniatura("e"), mime: "image/jpeg" } });
assert.equal(livianos[2]!.adjuntos, undefined);
assert.deepEqual(imagenesSinMiniatura(mensajes, miniaturas), []);

// Un mensaje ya restaurado (miniatura como data URL) se vuelve a guardar tal cual.
const restaurados = aligerarAdjuntos(livianos, new Map());
assert.deepEqual(restaurados, livianos, "recargar dos veces no pierde las miniaturas");
assert.deepEqual(imagenesSinMiniatura(livianos, new Map()), []);

// Tope de imágenes: se conservan las más recientes.
const muchos: Mensaje[] = Array.from({ length: MAX_IMAGENES_GUARDADAS + 3 }, (_, indice) => ({ id: `m${indice}`, adjuntos: { referencias: [{ id: "REF_01", ...foto(`x${indice}`) }] } }));
const todasLasMiniaturas = new Map(muchos.map((mensaje, indice) => [claveImagen(mensaje.adjuntos!.referencias[0]!), miniatura(`x${indice}`)]));
const recortados = aligerarAdjuntos(muchos, todasLasMiniaturas);
assert.equal(recortados.filter((mensaje) => mensaje.adjuntos).length, MAX_IMAGENES_GUARDADAS);
assert.equal(recortados.at(-1)!.adjuntos !== undefined && recortados[0]!.adjuntos === undefined, true, "se guardan las fotos de los turnos más recientes");
assert.equal(imagenesSinMiniatura(muchos, new Map()).length, MAX_IMAGENES_GUARDADAS, "no se generan miniaturas que no se guardarían");

// Una miniatura demasiado grande no se guarda.
const enorme = new Map([[claveImagen(referencia), `data:image/jpeg;base64,${"A".repeat(MAX_CARACTERES_MINIATURA + 1)}`]]);
assert.equal(aligerarAdjuntos([mensajes[0]!], enorme)[0]!.adjuntos?.referencias.length ?? 0, 0);
console.log("[PASS] persistencia de adjuntos: miniaturas livianas, ids estables y topes de tamaño");
