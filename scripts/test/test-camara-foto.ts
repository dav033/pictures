/**
 * La cámara de la foto inclinada: la de three.js (`camaraDeFoto`, la de la captura) y la numérica (`proyectar`, la del
 * refinado y la profundidad del piso) ven lo mismo, y la inclinación tiene tope (un encuadre cercano inclinaba 37° y la
 * captura ya no calzaba con lo colocado de frente).
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-camara-foto.ts
 */
import assert from "node:assert/strict";
import * as THREE from "three";
import { camaraDeFoto, vistaDeFoto } from "@/components/tres-d/camara-foto";
import type { Encuadre } from "@/lib/globos3d/encuadre-foto";
import { camaraNumerica, INCLINACION_MAXIMA_GRADOS, proyectar } from "@/lib/globos3d/proyeccion-foto";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const sala = { fondoCm: 500 };
const inclinada: Encuadre = { aspecto: 0.75, altoCm: 380, centroYCm: 38, camaraYCm: 140 };

prueba("three.js y la cámara numérica proyectan igual con la cámara inclinada", () => {
  const t = camaraDeFoto(inclinada, sala), c = camaraNumerica(inclinada, sala);
  assert.ok(c.inclinacion > 0.05, `inclinada: ${c.inclinacion}`);
  for (const p of [{ x: 0, y: 0, z: -200 }, { x: 80, y: 150, z: -210 }, { x: -60, y: 10, z: 40 }, { x: 30, y: 90, z: -120 }]) {
    const n = proyectar(c, p)!;
    const v = new THREE.Vector3(p.x * 0.01, p.y * 0.01, p.z * 0.01).project(t);
    // three.js: x de −1 a 1 a lo ancho; la numérica, en mitades del alto (x va de −aspecto a aspecto).
    assert.ok(Math.abs(v.x * inclinada.aspecto - n.x) < 1e-6 && Math.abs(v.y - n.y) < 1e-6, `${JSON.stringify(p)}: three (${v.x * inclinada.aspecto}, ${v.y}) vs (${n.x}, ${n.y})`);
  }
});

prueba("el centro de la imagen sobre el plano de la decoración cae en el centro del cuadro", () => {
  const c = camaraNumerica(inclinada, sala);
  const p = proyectar(c, { x: 0, y: inclinada.centroYCm, z: -sala.fondoCm / 2 + 40 })!;
  assert.ok(Math.abs(p.x) < 1e-9 && Math.abs(p.y) < 1e-9, JSON.stringify(p));
});

prueba("la inclinación tiene tope, sin saltos, y sin camaraYCm la cámara va de frente como antes", () => {
  const cerca = camaraNumerica({ aspecto: 1, altoCm: 100, centroYCm: 20, camaraYCm: 140 }, sala);
  assert.ok(Math.abs((cerca.inclinacion * 180) / Math.PI - INCLINACION_MAXIMA_GRADOS) < 1e-9, `${(cerca.inclinacion * 180) / Math.PI}°`);
  let antes = 0;
  for (let alto = 60; alto <= 1500; alto += 20) {
    const g = (camaraNumerica({ aspecto: 1, altoCm: alto, centroYCm: 10, camaraYCm: 140 }, sala).inclinacion * 180) / Math.PI;
    assert.ok(g <= INCLINACION_MAXIMA_GRADOS + 1e-9 && (alto === 60 || g <= antes + 1e-9), `alto ${alto}: ${g}° (antes ${antes}°)`);
    antes = g;
  }
  assert.equal(camaraNumerica({ aspecto: 1, altoCm: 300, centroYCm: 80 }, sala).inclinacion, 0);
});

prueba("«ver desde la foto»: la vista del visor es la cámara de la foto (misma posición, mira al centro de la imagen) y se puede orbitar desde ahí", () => {
  const camara = camaraDeFoto(inclinada, sala), v = vistaDeFoto(inclinada, sala);
  assert.deepEqual(v.posicion, { x: camara.position.x, y: camara.position.y, z: camara.position.z });
  // El objetivo cae sobre el eje óptico de la cámara y, mirado desde ella, en el centro del cuadro.
  const centro = new THREE.Vector3(v.objetivo.x, v.objetivo.y, v.objetivo.z).project(camara);
  assert.ok(Math.abs(centro.x) < 1e-6 && Math.abs(centro.y) < 1e-6, `${centro.x}, ${centro.y}`);
  const distancia = Math.hypot(v.objetivo.x - v.posicion.x, v.objetivo.y - v.posicion.y, v.objetivo.z - v.posicion.z);
  assert.ok(v.minDistancia < distancia && v.maxDistancia > distancia, `${v.minDistancia} < ${distancia} < ${v.maxDistancia}`);
  assert.equal(v.near, camara.near);
  assert.equal(v.far, camara.far);
});

console.log(`test-camara-foto: ${pruebas} pruebas ok`);
