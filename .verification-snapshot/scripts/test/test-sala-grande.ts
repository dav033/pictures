/**
 * Sala de salón de eventos (REQ-008): las medidas hasta 30 × 30 × 10 m valen en todas partes donde se validan, y las salas de
 * siempre no cambian. Sin coste: ninguna IA ni red.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-sala-grande.ts
 * - cambiar_sala acepta 3000 × 3000 × 1000 y rechaza más; la escena guardada y la que llega al servidor se validan igual;
 * - la sombra del sol cubre una sala grande y deja la de siempre (±5 m, 1024 px) en las de hasta 12 × 10 m;
 * - las luces del techo de un salón se reparten por todo el techo, y en una sala de siempre quedan como estaban;
 * - la cámara que encuadra un salón entero lo ve completo, con near y far que lo contienen.
 */
import assert from "node:assert/strict";
import * as THREE from "three";
import { camaraEstandar } from "../../src/components/tres-d/camara-estandar";
import { lucesDeTecho } from "../../src/components/tres-d/sala-ambiente";
import { ajustarSombraDelSol, cajaDeSombra } from "../../src/components/tres-d/sombra-sala";
import { SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { EscenaSchema } from "../../src/lib/globos3d/esquema-escena";
import { aplicarHerramienta, RANGOS } from "../../src/lib/globos3d/herramientas-escena";
import { SALA_MAXIMA_CM } from "../../src/lib/globos3d/limites-escena";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const vacia = (): Escena => ({ sala: { ...SALA_INICIAL }, nodos: [] });

prueba("cambiar_sala acepta un salón de 30 × 30 × 10 m y rechaza más", () => {
  const r = aplicarHerramienta(vacia(), "cambiar_sala", { ancho_cm: 3000, fondo_cm: 3000, alto_cm: 1000 });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (r.ok) assert.deepEqual([r.escena.sala.anchoCm, r.escena.sala.fondoCm, r.escena.sala.altoCm], [3000, 3000, 1000]);
  for (const mal of [{ ancho_cm: 3001 }, { fondo_cm: 3200 }, { alto_cm: 1001 }, { ancho_cm: 299 }]) assert.ok(!aplicarHerramienta(vacia(), "cambiar_sala", mal).ok, JSON.stringify(mal));
  assert.deepEqual(RANGOS.sala, { ancho_cm: [300, SALA_MAXIMA_CM.ancho], fondo_cm: [300, SALA_MAXIMA_CM.fondo], alto_cm: [240, SALA_MAXIMA_CM.alto] });
});

prueba("lo de siempre sigue: 12 × 10 × 6 m vale y la sala de partida no se tocó", () => {
  assert.ok(aplicarHerramienta(vacia(), "cambiar_sala", { ancho_cm: 1200, fondo_cm: 1000, alto_cm: 600 }).ok);
  assert.ok(SALA_INICIAL.anchoCm <= 1200 && SALA_INICIAL.fondoCm <= 1000 && SALA_INICIAL.altoCm <= 600);
});

prueba("la escena de un salón pasa la validación del servidor (y 3001 no)", () => {
  const e = { ...vacia(), sala: { ...SALA_INICIAL, anchoCm: 3000, fondoCm: 3000, altoCm: 1000 } };
  assert.ok(EscenaSchema.safeParse(e).success);
  assert.ok(!EscenaSchema.safeParse({ ...e, sala: { ...e.sala, anchoCm: 3001 } }).success);
});

prueba("la sombra del sol: las salas de siempre conservan su caja, las grandes se cubren completas", () => {
  assert.equal(cajaDeSombra(12, 10, 6), null);
  assert.equal(cajaDeSombra(6, 5, 3.2), null);
  const grande = cajaDeSombra(30, 30, 10)!;
  assert.ok(grande.radio >= Math.hypot(30, 30) / 2, "cubre la media diagonal");
  assert.ok(grande.distancia > grande.radio && grande.lejos > grande.distancia + grande.radio, "el plano lejano pasa el fondo de la sala");

  const sol = new THREE.DirectionalLight(0xffffff, 1);
  sol.position.set(1.5, 3, 2);
  sol.shadow.mapSize.set(1024, 1024);
  const antes = { pos: sol.position.clone(), derecha: sol.shadow.camera.right, lejos: sol.shadow.camera.far, mapa: sol.shadow.mapSize.x };
  ajustarSombraDelSol(sol, { anchoM: 6, fondoM: 5, altoM: 3.2 });
  assert.deepEqual([sol.shadow.camera.right, sol.shadow.camera.far, sol.shadow.mapSize.x], [antes.derecha, antes.lejos, antes.mapa]);
  assert.ok(sol.position.distanceTo(antes.pos) < 1e-9, "una sala de siempre no mueve el sol");
  ajustarSombraDelSol(sol, { anchoM: 30, fondoM: 30, altoM: 10 });
  assert.equal(sol.shadow.camera.right, grande.radio);
  assert.equal(sol.shadow.mapSize.x, 2048);
  const dir = sol.position.clone().normalize();
  assert.ok(dir.distanceTo(antes.pos.clone().normalize()) < 1e-9, "la misma dirección de luz");
  ajustarSombraDelSol(sol, null);
  assert.deepEqual([sol.shadow.camera.right, sol.shadow.camera.far, sol.shadow.mapSize.x], [antes.derecha, antes.lejos, antes.mapa]);
  assert.ok(sol.position.distanceTo(antes.pos) < 1e-9, "sin sala vuelve a la luz de siempre");
});

prueba("las luces del techo de un salón se reparten por todo el techo; en una sala de siempre quedan igual", () => {
  const posiciones = (g: THREE.Group) => {
    const malla = g.children[1] as THREE.InstancedMesh;
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    return Array.from({ length: malla.count }, (_, i) => { malla.getMatrixAt(i, m); return p.setFromMatrixPosition(m).clone(); });
  };
  const sala = posiciones(lucesDeTecho(6, 5, 3));
  assert.equal(sala.length, 12, "6 × 5 m: la cuadrícula de siempre (4 × 3)");
  assert.ok(Math.max(...sala.map((p) => p.z)) - Math.min(...sala.map((p) => p.z)) < 5);
  const salon = posiciones(lucesDeTecho(17, 26, 4.5));
  assert.equal(salon.length, 24);
  const z = salon.map((p) => p.z), x = salon.map((p) => p.x);
  assert.ok(Math.max(...z) - Math.min(...z) > 26 * 0.6, "cubren el fondo del salón");
  assert.ok(Math.max(...x) - Math.min(...x) > 17 * 0.4, "cubren el ancho del salón");
  for (const p of salon) assert.ok(Math.abs(p.x) <= 8.5 && Math.abs(p.z) <= 13, "dentro del techo");
});

prueba("la cámara que encuadra un salón de 30 × 30 × 10 m lo ve entero, con near y far que lo contienen", () => {
  const caja = new THREE.Box3(new THREE.Vector3(-15, 0, -15), new THREE.Vector3(15, 10, 15));
  for (const vista of ["frente", "tres-cuartos"] as const) {
    const cam = camaraEstandar(caja, vista);
    cam.updateMatrixWorld();
    const lejosDelAjuste = cam.position.distanceTo(caja.getCenter(new THREE.Vector3())) + caja.getSize(new THREE.Vector3()).length() / 2;
    assert.ok(cam.far > lejosDelAjuste, `${vista}: far ${cam.far.toFixed(1)} no alcanza ${lejosDelAjuste.toFixed(1)}`);
    assert.ok(cam.near > 0.05 && cam.far / cam.near <= 2000, `${vista}: near ${cam.near}, far ${cam.far}`);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    assert.ok(frustum.intersectsBox(caja));
    for (const x of [-15, 15]) for (const z of [-15, 15]) for (const y of [0, 10]) assert.ok(frustum.containsPoint(new THREE.Vector3(x, y, z)), `${vista}: la esquina ${x},${y},${z} queda fuera`);
  }
});

console.log(`\n${pruebas} pruebas pasaron`);
