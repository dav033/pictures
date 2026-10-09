import * as THREE from "three";
import type { Sala } from "@/lib/globos3d/escena";
import type { Encuadre } from "@/lib/globos3d/encuadre-foto";
import { FOV_FOTO_GRADOS, PROFUNDIDAD_DE_LA_FOTO_CM } from "@/lib/globos3d/proyeccion-foto";

/**
 * La cámara que mira la escena armada de una foto desde donde estaba la cámara de la foto (REQ-001 paso 9): de frente a
 * la pared del fondo, a la altura del centro de la imagen y a la distancia en que `altoCm` (los cm de alto de la foto a la
 * distancia de la decoración) llena el alto del cuadro, con la proporción de la foto. Sin estado y sin el visor: la misma
 * escena y encuadre dan siempre la misma cámara. Unidades del visor: metros (los cm de la escena × 0,01).
 */

const CM = 0.01;
const FOV_GRADOS = FOV_FOTO_GRADOS;

export function camaraDeFoto(encuadre: Encuadre, sala: Pick<Sala, "fondoCm">): THREE.PerspectiveCamera {
  const distancia = encuadre.altoCm / 2 / Math.tan(THREE.MathUtils.degToRad(FOV_GRADOS / 2));
  const planoZ = -sala.fondoCm / 2 + PROFUNDIDAD_DE_LA_FOTO_CM;
  const camara = new THREE.PerspectiveCamera(FOV_GRADOS, encuadre.aspecto, distancia * CM / 100, distancia * CM * 20);
  camara.position.set(0, encuadre.centroYCm * CM, (planoZ + distancia) * CM);
  camara.lookAt(0, encuadre.centroYCm * CM, planoZ * CM);
  camara.updateMatrixWorld();
  camara.updateProjectionMatrix();
  return camara;
}
