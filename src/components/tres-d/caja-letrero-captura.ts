import * as THREE from "three";
import type { CajaLetreroFotoV1 } from "@/lib/globos3d/render-imagen-contrato-v1";

type PuntoProyectado = { x: number; y: number; z: number };
type TransformacionCaptura = {
  ladoFuente: number;
  escala: number;
  desplazamientoX: number;
  desplazamientoY: number;
  anchoSalida: number;
  altoSalida: number;
};

const acotar = (valor: number, minimo: number, maximo: number): number => Math.max(minimo, Math.min(maximo, valor));

/** Projects the text meshes marked by the 3D sign renderer while the capture camera is active. */
export function proyectarLetreros(contenido: THREE.Object3D, camara: THREE.Camera): PuntoProyectado[][] {
  const salida: PuntoProyectado[][] = [];
  contenido.updateMatrixWorld(true);
  camara.updateMatrixWorld(true);
  contenido.traverseVisible((objeto) => {
    if (objeto.userData.rotulo !== true) return;
    const caja = new THREE.Box3().setFromObject(objeto);
    if (caja.isEmpty()) return;
    const { min, max } = caja;
    const esquinas: Array<[number, number, number]> = [
      [min.x, min.y, min.z], [min.x, min.y, max.z], [min.x, max.y, min.z], [min.x, max.y, max.z],
      [max.x, min.y, min.z], [max.x, min.y, max.z], [max.x, max.y, min.z], [max.x, max.y, max.z],
    ];
    salida.push(esquinas.map(([x, y, z]) => {
      const punto = new THREE.Vector3(x, y, z).project(camara);
      return { x: punto.x, y: punto.y, z: punto.z };
    }));
  });
  return salida;
}

/** Converts the visible corners of a projected 3D sign into the final cropped capture coordinates. */
export function cajaLetreroEnCaptura(
  puntos: readonly PuntoProyectado[],
  transformacion: TransformacionCaptura,
): CajaLetreroFotoV1 | null {
  const visibles = puntos.filter((punto) =>
    Number.isFinite(punto.x) && Number.isFinite(punto.y) && Number.isFinite(punto.z)
    && punto.z >= -1 && punto.z <= 1,
  );
  if (visibles.length !== puntos.length || transformacion.escala <= 0 || transformacion.anchoSalida <= 0 || transformacion.altoSalida <= 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const punto of visibles) {
    const x = acotar((punto.x + 1) * transformacion.ladoFuente / 2, 0, transformacion.ladoFuente);
    const y = acotar((1 - punto.y) * transformacion.ladoFuente / 2, 0, transformacion.ladoFuente);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (maxX <= minX || maxY <= minY) return null;

  const margen = Math.max(1, Math.ceil(Math.min(maxX - minX, maxY - minY) * 0.08));
  minX = acotar(minX - margen, 0, transformacion.ladoFuente);
  maxX = acotar(maxX + margen, 0, transformacion.ladoFuente);
  minY = acotar(minY - margen, 0, transformacion.ladoFuente);
  maxY = acotar(maxY + margen, 0, transformacion.ladoFuente);

  const left = transformacion.desplazamientoX + minX * transformacion.escala;
  const right = transformacion.desplazamientoX + maxX * transformacion.escala;
  const top = transformacion.desplazamientoY + minY * transformacion.escala;
  const bottom = transformacion.desplazamientoY + maxY * transformacion.escala;
  const x = acotar(left, 0, transformacion.anchoSalida);
  const y = acotar(top, 0, transformacion.altoSalida);
  const x2 = acotar(right, 0, transformacion.anchoSalida);
  const y2 = acotar(bottom, 0, transformacion.altoSalida);
  if (x2 <= x || y2 <= y) return null;

  return {
    x: x / transformacion.anchoSalida,
    y: y / transformacion.altoSalida,
    ancho: (x2 - x) / transformacion.anchoSalida,
    alto: (y2 - y) / transformacion.altoSalida,
  };
}
