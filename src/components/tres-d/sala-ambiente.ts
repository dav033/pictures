import * as THREE from "three";
import type { AmbienteSala } from "@/lib/globos3d/escena";

/**
 * Ambiente de la sala de una escena: piso de tablones de madera con brillo, luces empotradas en el techo y, si se pide,
 * una franja de ventana en la pared derecha. Todo con pocas mallas (una por cosa) y una textura pequeña, para que el
 * visor siga fluido en un teléfono. Sin luces reales extra: los discos del techo son solo emisivos.
 */

/** Lo que vale cada opción cuando la sala no la dice: nada (la sala neutra de siempre). El ambiente es opcional. */
export function ambienteDe(a: AmbienteSala | undefined): Required<AmbienteSala> {
  return { piso: a?.piso ?? "liso", luces: a?.luces ?? false, ventana: a?.ventana ?? false };
}

/** ¿Pide algo del ambiente? Si no, la luz y el piso son los neutros de siempre. */
export function ambienteActivo(a: AmbienteSala | undefined): boolean {
  const e = ambienteDe(a);
  return e.piso === "madera" || e.luces || e.ventana;
}

/** Azar determinista (el piso siempre sale igual). */
function azar(semilla: number): () => number {
  let x = (semilla * 2654435761) >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
}

/**
 * Tablones de ~12 cm de ancho, en tonos neutros (gris claro): cada uno con su variación, vetas finas y juntas escalonadas.
 * Cubre 1,2 × 1,2 m y se repite. El color de la madera lo pone el material (`color`), así una sola textura sirve para
 * cualquier tono de piso (arrastrar el selector de color no genera texturas nuevas).
 */
export function texturaTablones(anisotropia: number): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const L = 1024, filas = 10;
  const lienzo = document.createElement("canvas");
  lienzo.width = L;
  lienzo.height = L;
  const pincel = lienzo.getContext("2d");
  if (!pincel) return null;
  const r = azar(41);
  const alto = L / filas;
  const gris = (l: number) => { const v = Math.round(Math.min(1, Math.max(0, l)) * 255); return `rgb(${v},${v},${v})`; };
  for (let f = 0; f < filas; f++) {
    // Cada fila lleva uno o dos tablones, con la junta en un sitio distinto.
    const junta = Math.floor(L * (0.2 + r() * 0.6));
    for (const [x0, x1] of [[0, junta], [junta, L]] as const) {
      const dl = (r() - 0.5) * 0.08;
      pincel.fillStyle = gris(0.9 + dl);
      pincel.fillRect(x0, f * alto, x1 - x0, alto);
      // Vetas: líneas finas casi horizontales, algo más oscuras.
      for (let v = 0; v < 9; v++) {
        const y = f * alto + 3 + r() * (alto - 6);
        pincel.strokeStyle = gris(0.9 + dl - 0.1 - r() * 0.1);
        pincel.globalAlpha = 0.18 + r() * 0.2;
        pincel.lineWidth = 0.6 + r() * 1.2;
        pincel.beginPath();
        pincel.moveTo(x0, y);
        pincel.bezierCurveTo(x0 + (x1 - x0) * 0.3, y + (r() - 0.5) * 5, x0 + (x1 - x0) * 0.7, y + (r() - 0.5) * 5, x1, y + (r() - 0.5) * 3);
        pincel.stroke();
      }
      pincel.globalAlpha = 1;
    }
    // Rendijas entre tablones y en la junta.
    pincel.fillStyle = gris(0.62);
    pincel.globalAlpha = 0.5;
    pincel.fillRect(0, f * alto, L, 2);
    pincel.fillRect(junta - 1, f * alto, 2, alto);
    pincel.globalAlpha = 1;
  }
  const textura = new THREE.CanvasTexture(lienzo);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.wrapS = THREE.RepeatWrapping;
  textura.wrapT = THREE.RepeatWrapping;
  textura.anisotropy = anisotropia;
  textura.userData.compartido = true;
  return textura;
}

/** El piso: tablones (la textura se repite cada 1,2 m) del tono pedido, con el brillo del barniz. */
export function materialPiso(hex: string, madera: THREE.CanvasTexture | null, entorno: THREE.Texture, ancho: number, fondo: number): THREE.MeshStandardMaterial {
  if (!madera) return new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.92, metalness: 0 });
  madera.repeat.set(ancho / 1.2, fondo / 1.2);
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(hex).multiplyScalar(1.08), map: madera, roughness: 0.24, metalness: 0.05, envMap: entorno, envMapIntensity: 1.0 });
}

const LUZ_TECHO = new THREE.Color(1.0, 0.94, 0.8);

/** Luces empotradas del techo: discos que brillan con un aro oscuro, en filas (una sola malla por instancias). */
export function lucesDeTecho(ancho: number, fondo: number, alto: number): THREE.Group {
  const grupo = new THREE.Group();
  const nx = Math.max(2, Math.round(ancho / (1.6))), nz = Math.max(2, Math.round(fondo / 1.6));
  const total = Math.min(24, nx * nz);
  const disco = new THREE.InstancedMesh(new THREE.CircleGeometry(0.075, 20), new THREE.MeshBasicMaterial({ color: LUZ_TECHO, side: THREE.FrontSide }), total);
  const aro = new THREE.InstancedMesh(new THREE.RingGeometry(0.075, 0.1, 20), new THREE.MeshBasicMaterial({ color: 0x8f8a82, side: THREE.FrontSide }), total);
  const m = new THREE.Matrix4(), uno = new THREE.Vector3(1, 1, 1), posicion = new THREE.Vector3();
  const giro = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  let k = 0;
  for (let j = 0; j < nz && k < total; j++) for (let i = 0; i < nx && k < total; i++) {
    const x = (i - (nx - 1) / 2) * (ancho / nx), z = (j - (nz - 1) / 2) * (fondo / nz);
    m.compose(posicion.set(x, alto - 0.004, z), giro, uno);
    disco.setMatrixAt(k, m);
    m.setPosition(x, alto - 0.003, z);
    aro.setMatrixAt(k, m);
    k++;
  }
  disco.count = aro.count = k;
  for (const malla of [disco, aro]) { malla.raycast = () => undefined; malla.frustumCulled = false; }
  grupo.add(aro, disco);
  return grupo;
}

/** Textura de la ventana: cielo claro con un horizonte de edificios y los marcos. */
function texturaVentana(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const lienzo = document.createElement("canvas");
  lienzo.width = 512;
  lienzo.height = 256;
  const pincel = lienzo.getContext("2d");
  if (!pincel) return null;
  const cielo = pincel.createLinearGradient(0, 0, 0, 256);
  cielo.addColorStop(0, "#bcd6f5");
  cielo.addColorStop(1, "#f4f8ff");
  pincel.fillStyle = cielo;
  pincel.fillRect(0, 0, 512, 256);
  const r = azar(7);
  pincel.fillStyle = "#c9d3e0";
  for (let x = 0; x < 512; x += 28) pincel.fillRect(x, 190 - r() * 70, 24 + r() * 14, 90);
  pincel.fillStyle = "#3a352f";
  for (const x of [0, 170, 340, 508]) pincel.fillRect(x, 0, 4, 256);
  pincel.fillRect(0, 0, 512, 4);
  pincel.fillRect(0, 252, 512, 4);
  const textura = new THREE.CanvasTexture(lienzo);
  textura.colorSpace = THREE.SRGBColorSpace;
  return textura;
}

/** Franja de ventana en la pared derecha: un plano que emite luz (no ilumina, pero da el reflejo y la sensación de lugar). */
export function ventanaDerecha(ancho: number, fondo: number): THREE.Mesh {
  const largo = Math.min(fondo * 0.7, 3.4);
  const malla = new THREE.Mesh(new THREE.PlaneGeometry(largo, 1.5), new THREE.MeshBasicMaterial({ map: texturaVentana(), toneMapped: false, side: THREE.FrontSide }));
  malla.rotation.y = -Math.PI / 2;
  malla.position.set(ancho / 2 - 0.004, 1.35, -fondo * 0.1);
  malla.raycast = () => undefined;
  return malla;
}

/**
 * La luz de una sala con ambiente: la principal (`sol`) más cálida y suave y un relleno de cielo cálido; sin ambiente,
 * la luz neutra de siempre (que no cambia el color de nada, ni el de las miniaturas de la biblioteca).
 */
export function crearLucesDeSala(escena: THREE.Scene, sol: THREE.DirectionalLight) {
  const relleno = new THREE.HemisphereLight(0xfff3e2, 0xb89572, 0.3);
  relleno.visible = false;
  escena.add(relleno);
  return {
    aplicar(conAmbiente: boolean) {
      sol.color.set(conAmbiente ? 0xffeedc : 0xffffff);
      sol.intensity = conAmbiente ? 1.25 : 1.4;
      sol.shadow.radius = conAmbiente ? 4 : 1;
      relleno.visible = conAmbiente;
    },
    liberar() { escena.remove(relleno); relleno.dispose(); },
  };
}
