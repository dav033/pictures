import * as THREE from "three";
import type { Sala } from "@/lib/globos3d/escena";
import type { Encuadre } from "@/lib/globos3d/encuadre-foto";
import type { VistaCamara } from "./escena-globos";
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

/** Lo más que se acerca la persona a la escena desde «ver desde la foto» (m), y cuántas veces la distancia de la foto se aleja. */
const ACERCAR_MINIMO_M = 0.3;
const ALEJAR_VECES = 3;

/**
 * La misma cámara de la foto como vista del visor (`ponerVistaCamara`): su posición, el punto al que mira a la distancia en que `altoCm` llena el
 * cuadro y los límites de acercar y alejar. Así, al modelar una foto, la escena se ve desde el mismo ángulo que la foto y desde ahí se puede orbitar.
 */
export function vistaDeFoto(encuadre: Encuadre, sala: Pick<Sala, "fondoCm">): VistaCamara {
  const camara = camaraDeFoto(encuadre, sala);
  const c = camaraNumerica(encuadre, sala);
  const distancia = (encuadre.altoCm / 2 / c.tangente) * CM;
  const adelante = camara.getWorldDirection(new THREE.Vector3());
  const { x, y, z } = camara.position;
  return {
    posicion: { x, y, z }, objetivo: { x: x + adelante.x * distancia, y: y + adelante.y * distancia, z: z + adelante.z * distancia },
    near: camara.near, far: camara.far, minDistancia: ACERCAR_MINIMO_M, maxDistancia: distancia * ALEJAR_VECES,
  };
}
