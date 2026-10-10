import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { crearLucesDeSala, crearOpticaVisor } from "./sala-ambiente";

const montar = () => {
  const escena = new THREE.Scene();
  const sol = new THREE.DirectionalLight(0xffffff, 1.4);
  const ambiente = new THREE.AmbientLight(0xffffff, 0.08);
  return { escena, sol, ambiente, luces: crearLucesDeSala(escena, sol, ambiente) };
};

test("una sala con ambiente deja el sol cálido, y la luz neutra no lo pisa", () => {
  const { sol, luces } = montar();
  luces.aplicar(true);
  luces.reemplazar(null);
  assert.equal(sol.color.getHex(), 0xffeedc);
  assert.equal(sol.intensity, 1.25);
});

test("una luz elegida pisa el sol y la luz de ambiente, y al quitarla vuelve la sala", () => {
  const { sol, ambiente, luces } = montar();
  luces.aplicar(true);
  luces.reemplazar({ colorSol: "#8f6bff", intensidadSol: 0.9, colorAmbiente: "#6a4cff", intensidadAmbiente: 0.03 });
  assert.equal(sol.color.getHex(), 0x8f6bff);
  assert.equal(ambiente.intensity, 0.03);
  luces.reemplazar(null);
  assert.equal(sol.color.getHex(), 0xffeedc);
  assert.equal(ambiente.intensity, 0.08);
});

test("al mostrar la sala de nuevo, la luz elegida se vuelve a pintar", () => {
  const { sol, luces } = montar();
  luces.reemplazar({ colorSol: "#ffd9a8", intensidadSol: 1.4, colorAmbiente: "#ffe9c9", intensidadAmbiente: 0.12 });
  luces.aplicar(false);
  assert.equal(sol.color.getHex(), 0xffd9a8);
  assert.equal(sol.intensity, 1.4);
});

const opticaDePrueba = (alCambiar: () => void = () => undefined) => {
  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const reemplazos: unknown[] = [];
  const optica = crearOpticaVisor(escena, camara, { reemplazar: (luz) => { reemplazos.push(luz); } }, alCambiar);
  return { escena, camara, optica, reemplazos };
};

test("después de una captura se pide un cuadro nuevo, con la óptica del usuario ya puesta", () => {
  let pedidos = 0;
  let fovAlPedir = 0;
  const { camara, optica } = opticaDePrueba(() => { pedidos++; fovAlPedir = camara.fov; });
  optica.aplicar({ luz: null, intensidadEntorno: 0.12, fovGrados: 18 });
  const antes = pedidos;
  optica.enOpticaNeutra(() => undefined)();
  assert.ok(pedidos > antes, "no se pidió el cuadro");
  assert.equal(fovAlPedir, 18);
});

test("con una luz elegida el relleno cálido se apaga y toma el color de esa luz", () => {
  const { luces, escena } = montar();
  luces.aplicar(true);
  const relleno = escena.children.find((o): o is THREE.HemisphereLight => o instanceof THREE.HemisphereLight)!;
  assert.ok(relleno.intensity > 0.2);
  luces.reemplazar({ colorSol: "#8f6bff", intensidadSol: 0.9, colorAmbiente: "#6a4cff", intensidadAmbiente: 0.03 });
  assert.ok(relleno.intensity < 0.1);
  assert.equal(relleno.color.getHex(), 0x6a4cff);
  luces.reemplazar(null);
  assert.ok(relleno.intensity > 0.2);
});

test("una captura sale con la óptica neutra y al terminar vuelve la del usuario", () => {
  const { camara, optica, escena } = opticaDePrueba();
  optica.aplicar({ luz: { colorSol: "#8f6bff", intensidadSol: 0.9, colorAmbiente: "#6a4cff", intensidadAmbiente: 0.03 }, intensidadEntorno: 0.12, fovGrados: 18 });
  let fovDentro = 0;
  let entornoDentro = 0;
  optica.enOpticaNeutra(() => { fovDentro = camara.fov; entornoDentro = escena.environmentIntensity; })();
  assert.equal(fovDentro, 35);
  assert.equal(entornoDentro, 0.55);
  assert.equal(camara.fov, 18);
  assert.equal(escena.environmentIntensity, 0.12);
});

test("aplicar una óptica dice si cambió el campo de visión, para encuadrar de nuevo solo entonces", () => {
  const { optica } = opticaDePrueba();
  const normal = { luz: null, intensidadEntorno: 0.55, fovGrados: 35 };
  assert.equal(optica.aplicar({ ...normal, luz: null }), false);
  assert.equal(optica.aplicar({ ...normal, fovGrados: 55 }), true);
});
