import * as THREE from "three";
import type { Sala } from "@/lib/globos3d/escena";
import type { Encuadre } from "@/lib/globos3d/encuadre-foto";
import { camaraNumerica, ejesDeCamara, FOV_FOTO_GRADOS } from "@/lib/globos3d/proyeccion-foto";

/**
 * La cámara que mira la escena armada de una foto desde donde estaba la cámara de la foto (REQ-001 paso 9): la de
 * `camaraNumerica` (a la altura de la mano, inclinada hacia el centro de la imagen, a la distancia en que `altoCm` llena
 * el cuadro), con la proporción de la foto. Sin estado y sin el visor: la misma escena y encuadre dan siempre la misma
 * cámara. Unidades del visor: metros (los cm de la escena × 0,01).
 */

const CM = 0.01;

export function camaraDeFoto(encuadre: Encuadre, sala: Pick<Sala, "fondoCm">): THREE.PerspectiveCamera {
  const c = camaraNumerica(encuadre, sala);
  const distancia = encuadre.altoCm / 2 / c.tangente;
  const { adelante } = ejesDeCamara(c);
  const camara = new THREE.PerspectiveCamera(FOV_FOTO_GRADOS, encuadre.aspecto, distancia * CM / 100, distancia * CM * 20);
  camara.position.set(c.x * CM, c.y * CM, c.z * CM);
  camara.lookAt((c.x + adelante.x * distancia) * CM, (c.y + adelante.y * distancia) * CM, (c.z + adelante.z * distancia) * CM);
  camara.updateMatrixWorld();
  camara.updateProjectionMatrix();
  return camara;
}
