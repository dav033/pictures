import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { MetadatosExportacionGlb } from "./tipos-exportacion-escena";

/** Serializa solo la decoración y la sala; omite luces/ayudas del editor y conserva los lotes instanciados. */
export async function serializarEscenaGlb(
  contenido: THREE.Group,
  sala: THREE.Group,
  metadatos: MetadatosExportacionGlb,
): Promise<Blob> {
  if (!Number.isSafeInteger(metadatos.globos) || metadatos.globos < 0 || !Number.isSafeInteger(metadatos.piezas) || metadatos.piezas < 0) {
    throw new Error("El conteo de piezas de la escena no es válido.");
  }

  const raiz = new THREE.Group();
  raiz.name = metadatos.nombre || "Escena 3D";
  raiz.add(contenido.clone(true), sala.clone(true));
  const luces: THREE.Light[] = [];
  raiz.traverse((objeto) => {
    objeto.userData = {};
    if (objeto instanceof THREE.Light) luces.push(objeto);
  });
  luces.forEach((luz) => luz.parent?.remove(luz));
  raiz.userData = { nombreEscena: metadatos.nombre, cantidadGlobos: metadatos.globos, cantidadPiezas: metadatos.piezas };
  raiz.updateMatrixWorld(true);

  const salida = await new GLTFExporter().parseAsync(raiz, { binary: true, onlyVisible: true });
  if (!(salida instanceof ArrayBuffer)) throw new Error("El serializador no devolvió un archivo GLB.");
  return new Blob([salida], { type: "model/gltf-binary" });
}
