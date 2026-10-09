import * as THREE from "three";

/**
 * La sombra del sol de una sala grande (REQ-008: un salón de eventos de hasta 30 × 30 m). La luz nació con una caja de sombra de
 * ±5 m y 1024 px, que cubre una sala de hasta 12 × 10 m; en una más grande lo de afuera quedaba sin sombra y lo alto, cortado.
 * Las salas de siempre conservan exactamente esa luz; las grandes se cubren completas con un mapa de 2048 px.
 */

const POSICION_SOL = new THREE.Vector3(1.5, 3, 2);
const ANCHO_HABITUAL_M = 12;
const FONDO_HABITUAL_M = 10;
const RADIO_HABITUAL_M = 5;
const MAPA_HABITUAL = 1024;
const MAPA_GRANDE = 2048;
const SESGO_HABITUAL = 0.015;

/** Medidas (m) de la caja de sombra para una sala; `null` si la de siempre basta. */
export function cajaDeSombra(anchoM: number, fondoM: number, altoM: number): { radio: number; distancia: number; lejos: number; mapa: number } | null {
  if (anchoM <= ANCHO_HABITUAL_M && fondoM <= FONDO_HABITUAL_M) return null;
  const radio = Math.hypot(anchoM, fondoM) / 2 + 1 + altoM * 0.3;
  const distancia = radio * 2 + altoM;
  return { radio, distancia, lejos: distancia + radio * 2 + altoM, mapa: MAPA_GRANDE };
}

/** Deja la sombra del sol cubriendo la sala (o como siempre sin sala o con una sala habitual). */
export function ajustarSombraDelSol(sol: THREE.DirectionalLight, sala: { anchoM: number; fondoM: number; altoM: number } | null): void {
  const caja = sala ? cajaDeSombra(sala.anchoM, sala.fondoM, sala.altoM) : null;
  const radio = caja?.radio ?? RADIO_HABITUAL_M, mapa = caja?.mapa ?? MAPA_HABITUAL;
  const camara = sol.shadow.camera;
  const igual = camara.right === radio && sol.shadow.mapSize.x === mapa && camara.far === (caja?.lejos ?? 500);
  if (igual) return;
  sol.position.copy(POSICION_SOL).normalize().multiplyScalar(caja?.distancia ?? POSICION_SOL.length());
  camara.left = -radio; camara.right = radio; camara.top = radio; camara.bottom = -radio;
  camara.near = 0.5; camara.far = caja?.lejos ?? 500;
  camara.updateProjectionMatrix();
  if (sol.shadow.mapSize.x !== mapa) {
    sol.shadow.mapSize.set(mapa, mapa);
    sol.shadow.map?.dispose();
    sol.shadow.map = null;
  }
  sol.shadow.normalBias = caja ? Math.max(SESGO_HABITUAL, (2 * radio) / mapa * 1.5) : SESGO_HABITUAL;
}
