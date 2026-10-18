import type * as THREE from "three";
import type { Calidad } from "./materiales-visor";
import type { ExportadoresEscena, MetadatosExportacionGlb } from "./tipos-exportacion-escena";
import { renderizarPngActual } from "./exportar-escena-png";

type DependenciasExportacion = {
  renderer: THREE.WebGLRenderer;
  escena: THREE.Scene;
  camara: THREE.PerspectiveCamera;
  contenido: THREE.Group;
  sala: THREE.Group;
  ayudas: ReadonlyArray<THREE.Object3D>;
  usarCalidad: (calidad: Calidad) => void;
  dibujar: () => void;
  esperarRotulos: () => Promise<void>;
};

/** Reúne los exportadores del visor para mantenerlos fuera de la implementación del render y del editor. */
export function crearExportadoresEscena({ renderer, escena, camara, contenido, sala, ayudas, usarCalidad, dibujar, esperarRotulos }: DependenciasExportacion): ExportadoresEscena {
  async function exportarPng(): Promise<Blob> {
    await esperarRotulos();
    usarCalidad("alta");
    try {
      return await renderizarPngActual(renderer, escena, camara, ayudas);
    } finally {
      usarCalidad("editor");
      dibujar();
    }
  }

  async function exportarGlb(metadatos: MetadatosExportacionGlb): Promise<Blob> {
    await esperarRotulos();
    usarCalidad("alta");
    try {
      const { serializarEscenaGlb } = await import("./exportar-escena-glb");
      return await serializarEscenaGlb(contenido, sala, metadatos);
    } finally {
      usarCalidad("editor");
      dibujar();
    }
  }

  return { exportarPng, exportarGlb };
}
