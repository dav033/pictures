import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const taller = readFileSync(new URL("./Taller3D.tsx", import.meta.url), "utf8");
const escena = readFileSync(new URL("./escena-globos.ts", import.meta.url), "utf8");

test("el cleanup del taller libera el visor y reinicia el estado de encuadre pendiente", () => {
  const efectoVisor = taller.match(/\/\/ El visor se crea una vez[\s\S]*?\n  \}, \[\]\);/)?.[0];
  assert.ok(efectoVisor, "existe el efecto que crea y destruye el visor");
  const cleanup = efectoVisor.match(/return \(\) => \{([\s\S]*?)\n    \};/)?.[1];
  assert.ok(cleanup, "el efecto declara cleanup");
  assert.match(cleanup, /setVisor\(null\)/, "el estado del visor vuelve a null");
  assert.match(cleanup, /encuadradoRef\.current = null/, "se permite encuadrar el visor nuevo");
  assert.match(cleanup, /vistaFotoPendiente\.current = null/, "no se conserva una vista de foto pendiente");
});

test("crearEscena posiciona la cámara lejos del objetivo antes de encuadrar", () => {
  const crear = escena.match(/export function crearEscena\([\s\S]*?\n\}/)?.[0];
  assert.ok(crear, "existe crearEscena");
  assert.match(crear, /const camara = new THREE\.PerspectiveCamera\([\s\S]*?\n\s*camara\.position\.set\(0\.35, 0\.25, 1\);[\s\S]*?const controles = new OrbitControls\(camara, lienzo\);/);
});
