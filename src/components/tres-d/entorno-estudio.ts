import * as THREE from "three";

/**
 * Entorno de estudio para los materiales que reflejan (cromados, metales, foil, lentejuelas, piso con brillo): una sala
 * cálida y oscura con pocas fuentes de luz fuertes (una caja de luz arriba, una ventana, las luces del techo) y un piso de
 * madera ámbar. Un espejo no refleja «una sala blanca»: refleja zonas oscuras y manchas de luz, y eso es lo que le da
 * volumen. El dorado sale ámbar saturado con reflejos marrones y la plata, gris con contraste, no blanca.
 *
 * Se hornea una vez con PMREM; el látex mate sigue con su entorno suave (`RoomEnvironment`) para que no se lave.
 */

type Rect = { ancho: number; alto: number; posicion: [number, number, number]; mira?: [number, number, number]; color: number; fuerza: number };

/** Un rectángulo que emite luz (valores > 1: el entorno se hornea en coma flotante). */
function luz(r: Rect): THREE.Mesh {
  const malla = new THREE.Mesh(new THREE.PlaneGeometry(r.ancho, r.alto), new THREE.MeshBasicMaterial({ color: new THREE.Color(r.color).multiplyScalar(r.fuerza), side: THREE.DoubleSide, toneMapped: false }));
  malla.position.set(...r.posicion);
  malla.lookAt(...(r.mira ?? [0, 0, 0]));
  return malla;
}

function superficie(ancho: number, alto: number, color: number, posicion: [number, number, number], giro: [number, number, number]): THREE.Mesh {
  const malla = new THREE.Mesh(new THREE.PlaneGeometry(ancho, alto), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false }));
  malla.position.set(...posicion);
  malla.rotation.set(...giro);
  return malla;
}

/** Degradado vertical (pared que se aclara hacia arriba) como textura del cuarto. */
function texturaCuarto(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const lienzo = document.createElement("canvas");
  lienzo.width = 4;
  lienzo.height = 256;
  const pincel = lienzo.getContext("2d");
  if (!pincel) return null;
  const degradado = pincel.createLinearGradient(0, 0, 0, 256);
  degradado.addColorStop(0, "#f1eeea");
  degradado.addColorStop(0.45, "#bdb9b3");
  degradado.addColorStop(0.7, "#6a6762");
  degradado.addColorStop(1, "#98908a");
  pincel.fillStyle = degradado;
  pincel.fillRect(0, 0, 4, 256);
  const textura = new THREE.CanvasTexture(lienzo);
  textura.colorSpace = THREE.SRGBColorSpace;
  return textura;
}

/** Escena de la que se hornea el entorno (metros; el espectador en el origen, a ~1,2 m del piso). */
export function escenaEstudio(): THREE.Scene {
  const escena = new THREE.Scene();
  const cuarto = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 6, 24, 1, true), new THREE.MeshBasicMaterial({ map: texturaCuarto(), side: THREE.BackSide, toneMapped: false }));
  cuarto.position.y = 1.2;
  escena.add(cuarto);
  // Piso de madera ámbar y techo cálido.
  escena.add(superficie(14, 14, 0xa39d96, [0, -1.2, 0], [-Math.PI / 2, 0, 0]));
  escena.add(superficie(14, 14, 0xe8e5e0, [0, 2.4, 0], [Math.PI / 2, 0, 0]));
  // Caja de luz grande arriba y delante (la luz principal) y otra suave a un lado.
  escena.add(luz({ ancho: 5, alto: 3, posicion: [-1.5, 2.3, 2.5], color: 0xfff4e6, fuerza: 7 }));
  escena.add(luz({ ancho: 1.2, alto: 3.5, posicion: [-6, 0.6, 1], color: 0xfff0dc, fuerza: 4 }));
  // Ventana alta y clara a la derecha y luces del techo (puntos brillantes que dan los destellos).
  escena.add(luz({ ancho: 3.5, alto: 2.6, posicion: [6, 1.2, -1.5], color: 0xdbe8ff, fuerza: 5.5 }));
  for (const [x, z] of [[-2, -2], [2, -2], [-2, 1.5], [2, 1.5], [0, -4], [0, 4]] as const) escena.add(luz({ ancho: 0.3, alto: 0.3, posicion: [x, 2.35, z], color: 0xfff1d8, fuerza: 14 }));
  return escena;
}

/** El entorno de estudio ya horneado (el llamador lo libera). */
export function crearEntornoEstudio(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const escena = escenaEstudio();
  const textura = pmrem.fromScene(escena, 0.03).texture;
  escena.traverse((hijo) => {
    if (!(hijo instanceof THREE.Mesh)) return;
    hijo.geometry.dispose();
    const m = hijo.material as THREE.MeshBasicMaterial;
    m.map?.dispose();
    m.dispose();
  });
  pmrem.dispose();
  return textura;
}
