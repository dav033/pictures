import type * as THREE from "three";
import type { MedicionCamara } from "./medicion-visor";

/** Devuelve una lectura de cámara sin exponer los objetos mutables de Three.js. */
export function medirCamara(camara: THREE.PerspectiveCamera, controles: { target: THREE.Vector3 }): () => MedicionCamara {
  return () => ({
    posicion: { x: camara.position.x, y: camara.position.y, z: camara.position.z },
    objetivo: { x: controles.target.x, y: controles.target.y, z: controles.target.z },
    distancia: camara.position.distanceTo(controles.target),
  });
}
