import * as THREE from "three";

/**
 * Pared de lentejuelas («shimmer wall»): una cuadrícula de lentejuelas cuadradas de ~3,5 cm colgadas de un tablero, cada
 * una un poco inclinada al azar, con material metálico que refleja el entorno de estudio. Como cada una apunta a otro
 * lado, refleja una zona distinta (luz o sombra) y la pared centellea con brillos de todos los niveles, como las de
 * verdad. Una sola llamada de dibujo (instancias): ~4 500 lentejuelas en una pared de 2,4 × 2,4 m.
 */

const CM = 0.01;
/** Lado de la cuadrícula (cm): la lentejuela mide un 90 % y el resto es la rendija oscura. */
const PASO_CM = 3.6;
/** Tope de lentejuelas por pared: más allá se agrandan para que un tapete enorme no pese. */
const MAX_LENTEJUELAS = 7000;
/** Inclinación máxima de cada una (rad): ±~13°. */
const INCLINACION = 0.23;
/** Hasta este grueso (cm) una caja es un panel (pared, tapete) y lleva lentejuelas; más gruesa, es un bloque y se queda con textura. */
export const GRUESO_MAXIMO_PANEL_CM = 6;

type Medidas = { x: number; y: number; z: number };

/** El eje más delgado de la caja (0 = x, 1 = y, 2 = z) si la caja es un panel plano; `null` si es un bloque. */
export function ejePanel(t: Medidas): 0 | 1 | 2 | null {
  const v = [t.x, t.y, t.z] as const;
  const eje = v[0] <= v[1] && v[0] <= v[2] ? 0 : v[1] <= v[2] ? 1 : 2;
  const [a, b] = [0, 1, 2].filter((k) => k !== eje).map((k) => v[k]!);
  return v[eje]! <= GRUESO_MAXIMO_PANEL_CM && a! >= 20 && b! >= 20 ? eje : null;
}

const BLANCO = new THREE.Color(0xffffff);

/** Azar determinista (cada pared siempre igual entre recargas). */
function azar(semilla: number): () => number {
  let x = (semilla * 2654435761) >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
}

/** El color de las lentejuelas: el del panel, aclarado hasta que no se vea sucio (el espejo multiplica el reflejo). */
function colorLentejuela(hex: string): THREE.Color {
  const color = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  return color.setHSL(hsl.h, Math.min(1, hsl.s * 0.92), Math.max(hsl.l, 0.68));
}

/** El tablero de detrás: oscuro y cálido, es lo que se ve por las rendijas. */
export function materialTableroLentejuelas(hex: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(hex).multiplyScalar(0.28), roughness: 0.6, metalness: 0.35 });
}

/**
 * Las lentejuelas de una caja plana, en el marco de la caja (centrada en el origen, medidas en cm), sobre su cara
 * delgada de +eje. `entorno`: el mapa que reflejan.
 */
export function lentejuelasDePanel(tamano: Medidas, eje: 0 | 1 | 2, hex: string, entorno: THREE.Texture): THREE.InstancedMesh {
  const [su, sv] = eje === 2 ? [tamano.x, tamano.y] : eje === 1 ? [tamano.x, tamano.z] : [tamano.z, tamano.y];
  const grueso = [tamano.x, tamano.y, tamano.z][eje]!;
  const paso = Math.max(PASO_CM, Math.sqrt((su * sv) / MAX_LENTEJUELAS));
  const nu = Math.max(1, Math.floor(su / paso)), nv = Math.max(1, Math.floor(sv / paso));
  const lado = paso * 0.9 * CM;
  const geometria = new THREE.PlaneGeometry(lado, lado);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.22, envMap: entorno, envMapIntensity: 1.7 });
  const malla = new THREE.InstancedMesh(geometria, material, nu * nv);
  malla.receiveShadow = true;
  // Las lentejuelas no se eligen ni reciben lo que se suelta encima (4 500 instancias por clic y normales inclinadas): el tablero sí.
  malla.raycast = () => undefined;

  // De +Z (el plano) a la normal de la cara.
  const base = new THREE.Quaternion().setFromEuler(eje === 2 ? new THREE.Euler(0, 0, 0) : eje === 1 ? new THREE.Euler(-Math.PI / 2, 0, 0) : new THREE.Euler(0, Math.PI / 2, 0));
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(base);
  // Un poco por delante del tablero: las esquinas inclinadas no lo atraviesan.
  // (la esquina más baja de una lentejuela inclinada en los dos ejes cae lado × sen(inclinación)).
  const delante = (grueso / 2 + paso * 0.9 * Math.sin(INCLINACION) * 1.05 + 0.05) * CM;
  const r = azar(Math.round(su * 7 + sv * 13 + nu));
  const claro = colorLentejuela(hex);
  const q = new THREE.Quaternion(), inclinada = new THREE.Quaternion(), euler = new THREE.Euler();
  const posicion = new THREE.Vector3(), uno = new THREE.Vector3(1, 1, 1), matriz = new THREE.Matrix4(), color = new THREE.Color();
  let k = 0;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const px = (i - (nu - 1) / 2) * paso * CM, py = (j - (nv - 1) / 2) * paso * CM;
    posicion.set(px, py, 0).applyQuaternion(base).addScaledVector(normal, delante);
    // Inclinación al azar (más en una que en otra) y un giro suave en su plano.
    euler.set((r() - 0.5) * 2 * INCLINACION, (r() - 0.5) * 2 * INCLINACION, (r() - 0.5) * 0.12);
    inclinada.setFromEuler(euler);
    q.copy(base).multiply(inclinada);
    malla.setMatrixAt(k, matriz.compose(posicion, q, uno));
    // Cada lentejuela, un poco más clara u oscura; unas pocas, casi blancas (las que atrapan la luz).
    const brillo = 0.8 + r() * 0.5;
    color.copy(claro).multiplyScalar(brillo);
    if (r() < 0.07) color.lerp(BLANCO, 0.5);
    malla.setColorAt(k, color);
    k++;
  }
  malla.instanceMatrix.needsUpdate = true;
  if (malla.instanceColor) malla.instanceColor.needsUpdate = true;
  malla.computeBoundingSphere();
  return malla;
}
