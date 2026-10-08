import * as THREE from "three";

/**
 * La cámara de los renders estándar de la biblioteca (REQ-002: incrustaciones de imagen, foto ↔ render). Sin estado y sin
 * el visor: dada la caja de lo dibujado y una vista, deja una cámara que encuadra todo igual para cada tipo de item.
 *
 * - `frente`: de frente y apenas desde arriba (paredes, guirnaldas, escenas: así se fotografía una decoración).
 * - `tres-cuartos`: girada y desde arriba (columnas, arcos y piezas libres, para que se vea el volumen).
 */
export type VistaEstandar = "frente" | "tres-cuartos";

export const VISTAS_ESTANDAR: readonly VistaEstandar[] = ["frente", "tres-cuartos"];

/** Giro alrededor de la vertical y elevación (grados) de cada vista. */
const ANGULOS: Readonly<Record<VistaEstandar, { giro: number; elevacion: number }>> = {
  frente: { giro: 0, elevacion: 12 },
  "tres-cuartos": { giro: 35, elevacion: 15 },
};

/** Cuánto del cuadro ocupa, como mucho, lo dibujado (0,74 de la caja; lo dibujado ocupa ~70 %). */
export const OCUPACION_ESTANDAR = 0.74;
const FOV_GRADOS = 35;
const ITERACIONES = 10;
/** La cámara nunca queda más cerca que esto (en radios de la caja): una pieza larga que apunta a la cámara no la atraviesa. */
const DISTANCIA_MINIMA_RADIOS = 1.6;

const esquinasDe = (caja: THREE.Box3): THREE.Vector3[] => {
  const { min, max } = caja;
  return [min.x, max.x].flatMap((x) => [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) => new THREE.Vector3(x, y, z))));
};

/**
 * Crea la cámara cuadrada que encuadra `caja` desde `vista`: centrada y a la distancia justa para que lo dibujado ocupe
 * `OCUPACION_ESTANDAR` del cuadro. Determinista: la misma caja y vista dan siempre la misma cámara.
 */
export function camaraEstandar(caja: THREE.Box3, vista: VistaEstandar): THREE.PerspectiveCamera {
  const { giro, elevacion } = ANGULOS[vista];
  const g = THREE.MathUtils.degToRad(giro), e = THREE.MathUtils.degToRad(elevacion);
  const direccion = new THREE.Vector3(Math.sin(g) * Math.cos(e), Math.sin(e), Math.cos(g) * Math.cos(e));
  const derecha = new THREE.Vector3(0, 1, 0).cross(direccion).normalize();
  const arriba = direccion.clone().cross(derecha).normalize();
  const tangente = Math.tan(THREE.MathUtils.degToRad(FOV_GRADOS / 2));
  const esquinas = esquinasDe(caja);
  const objetivo = caja.getCenter(new THREE.Vector3());
  const radio = Math.max(caja.getSize(new THREE.Vector3()).length() / 2, 0.05);
  let distancia = radio * 3;

  // Perspectiva: centrar en pantalla y ajustar la distancia dependen una de otra; unas vueltas bastan.
  for (let i = 0; i < ITERACIONES; i++) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of esquinas) {
      const v = c.clone().sub(objetivo);
      const profundidad = Math.max(distancia - v.dot(direccion), 1e-3);
      const x = v.dot(derecha) / (profundidad * tangente), y = v.dot(arriba) / (profundidad * tangente);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    objetivo.addScaledVector(derecha, ((minX + maxX) / 2) * distancia * tangente).addScaledVector(arriba, ((minY + maxY) / 2) * distancia * tangente);
    const medio = Math.max(maxX - minX, maxY - minY) / 2;
    distancia = Math.max(distancia * (Math.max(medio, 1e-3) / OCUPACION_ESTANDAR), radio * DISTANCIA_MINIMA_RADIOS);
  }

  const camara = new THREE.PerspectiveCamera(FOV_GRADOS, 1, distancia / 100, distancia * 20);
  camara.position.copy(objetivo).addScaledVector(direccion, distancia);
  camara.lookAt(objetivo);
  camara.updateMatrixWorld();
  camara.updateProjectionMatrix();
  return camara;
}
