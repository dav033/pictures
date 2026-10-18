import * as THREE from "three";

export const LADO_MAYOR_EXPORTACION_PNG = 3000;

export function dimensionesExportacionPng(ancho: number, alto: number): { ancho: number; alto: number } {
  if (!Number.isFinite(ancho) || !Number.isFinite(alto) || ancho <= 0 || alto <= 0) {
    throw new Error("El visor todavía no tiene tamaño para exportar.");
  }
  const escala = LADO_MAYOR_EXPORTACION_PNG / Math.max(ancho, alto);
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) };
}

function convertirEnBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolver, rechazar) => {
    canvas.toBlob((blob) => blob ? resolver(blob) : rechazar(new Error("El navegador no pudo crear el PNG.")), "image/png");
  });
}

/** Renderiza la vista y la cámara actuales; la cuadrícula, selección y previsualizaciones son ayudas de edición. */
export async function renderizarPngActual(
  renderer: THREE.WebGLRenderer,
  escena: THREE.Scene,
  camara: THREE.PerspectiveCamera,
  ayudas: ReadonlyArray<THREE.Object3D>,
): Promise<Blob> {
  const tamanoOriginal = renderer.getSize(new THREE.Vector2());
  const pixelRatioOriginal = renderer.getPixelRatio();
  const necesitaSombraOriginal = renderer.shadowMap.needsUpdate;
  const visiblesOriginales = ayudas.map((ayuda) => ayuda.visible);
  const dimensiones = dimensionesExportacionPng(tamanoOriginal.x, tamanoOriginal.y);
  let salida: HTMLCanvasElement | null = null;

  try {
    ayudas.forEach((ayuda) => { ayuda.visible = false; });
    renderer.setPixelRatio(1);
    renderer.setSize(dimensiones.ancho, dimensiones.alto, false);
    const camaraExportada = camara.clone();
    camaraExportada.aspect = dimensiones.ancho / dimensiones.alto;
    camaraExportada.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate = true;
    escena.updateMatrixWorld(true);
    renderer.render(escena, camaraExportada);

    salida = document.createElement("canvas");
    salida.width = dimensiones.ancho;
    salida.height = dimensiones.alto;
    const contexto = salida.getContext("2d");
    if (!contexto) throw new Error("El navegador no pudo preparar el lienzo del PNG.");
    contexto.drawImage(renderer.domElement, 0, 0, dimensiones.ancho, dimensiones.alto);
  } finally {
    ayudas.forEach((ayuda, indice) => { ayuda.visible = visiblesOriginales[indice] ?? true; });
    renderer.setPixelRatio(pixelRatioOriginal);
    renderer.setSize(tamanoOriginal.x, tamanoOriginal.y, false);
    renderer.shadowMap.needsUpdate = necesitaSombraOriginal;
  }

  if (!salida) throw new Error("No se pudo preparar el PNG de la escena.");
  try {
    const blob = await convertirEnBlob(salida);
    if (blob.size === 0) throw new Error("El navegador generó un PNG vacío.");
    return blob;
  } finally {
    salida.width = 0;
    salida.height = 0;
  }
}
