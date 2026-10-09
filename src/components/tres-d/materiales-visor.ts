import * as THREE from "three";
import type { SolidoEscenografia } from "@/lib/globos3d/escenografia";
import { materialFoil } from "./impresos-visor";
import { ejePanel, materialTableroLentejuelas } from "./lentejuelas-instanciadas";

/**
 * Las fábricas de materiales del visor: el látex por familia Sempertex y la escenografía por acabado. Son funciones
 * puras: lo que refleja (cromado, metal, foil, lentejuelas) llega SIEMPRE como parámetro `entorno`, el del visor que
 * las llama. Un entorno es un recurso de un contexto WebGL: nunca se guarda en una variable de módulo (otro visor lo
 * pisaría o lo liberaría y los materiales nuevos saldrían negros).
 */

/**
 * Calidad del dibujo: «editor» para trabajar (perfiles y vueltas más bajos, cristal sin la pasada de transmisión, que
 * vuelve a dibujar toda la escena) y «alta» para la captura que va a la IA y la vista de un globo suelto.
 */
export type Calidad = "editor" | "alta";

/** Azar determinista (cada pared o textura siempre igual entre recargas). */
function azar(semilla: number): () => number {
  let x = (semilla * 2654435761) >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
}

/**
 * El color con que se pinta un globo. En el cromado (Reflex) y el metal, el color es lo que el espejo REFLEJA: el hex
 * de la tabla es el tono promedio de la foto del globo (con sus reflejos oscuros), y multiplicado por el reflejo de la
 * sala quedaba casi negro (el Reflex Azul 940 #417693 salía negro; el dorado, que es claro, no). Se aclara hasta una
 * luminosidad mínima conservando el tono y la saturación.
 */
export function colorDeLatex(familia: string, hex: string): THREE.Color {
  const color = new THREE.Color(hex);
  const minimo = familia === "reflex" ? 0.62 : familia === "metal" ? 0.5 : 0;
  if (!minimo) return color;
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  if (hsl.l < minimo) color.setHSL(hsl.h, Math.min(1, hsl.s * (familia === "reflex" ? 1.5 : 1.1)), minimo);
  return color;
}

/** Material de látex según la familia Sempertex. */
export function materialDe(familia: string, hex: string, calidad: Calidad, entorno: THREE.Texture): THREE.MeshPhysicalMaterial {
  const color = colorDeLatex(familia, hex);
  switch (familia) {
    case "reflex":
      // El entorno de la escena va atenuado (el látex mate se lavaba); el cromado necesita reflejar más para verse plateado y no negro.
      return new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, envMap: entorno, envMapIntensity: 1.3 });
    case "metal":
      // Metalizado satinado: más metal y más reflejo que el látex, pero con el brillo difuso (no es espejo como el Reflex).
      return new THREE.MeshPhysicalMaterial({ color, metalness: 0.75, roughness: 0.34, clearcoat: 0.35, clearcoatRoughness: 0.3, envMap: entorno, envMapIntensity: 1.4 });
    case "silk":
    case "satin":
      return new THREE.MeshPhysicalMaterial({ color, metalness: 0.15, roughness: 0.32, sheen: 1, sheenColor: new THREE.Color("#ffffff"), sheenRoughness: 0.4, iridescence: 0.35, iridescenceIOR: 1.3, clearcoat: 0.7, clearcoatRoughness: 0.2 });
    case "cristal":
      // En el editor, transparente con brillo: la transmisión obliga a dibujar la escena dos veces en cada cuadro.
      if (calidad === "editor") return new THREE.MeshPhysicalMaterial({ color, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.42, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.02 });
      return new THREE.MeshPhysicalMaterial({ color, metalness: 0, roughness: 0.04, transmission: 0.92, thickness: 0.004, ior: 1.42, transparent: true, clearcoat: 1, clearcoatRoughness: 0.02 });
    case "neon":
      return new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, clearcoat: 0.3, emissive: color, emissiveIntensity: 0.18 });
    case "papel":
      // No es látex: papel o cartulina mate, visible por las dos caras.
      return new THREE.MeshPhysicalMaterial({ color, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
    case "pastelMate":
    case "pastelDusk":
      return new THREE.MeshPhysicalMaterial({ color, roughness: 0.68, clearcoat: 0.15, clearcoatRoughness: 0.6 });
    default:
      // Fashion: látex mate con el brillo suave de la superficie estirada.
      return new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.45 });
  }
}

/** Textura de lentejuelas: discos oscuros con brillos al azar (cada uno refleja distinto). Una casilla = 12 cm. */
function texturaLentejuelas(hex: string): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const lienzo = document.createElement("canvas");
  lienzo.width = 128;
  lienzo.height = 128;
  const pincel = lienzo.getContext("2d");
  if (!pincel) return null;
  const base = new THREE.Color(hex);
  pincel.fillStyle = `#${base.clone().multiplyScalar(0.55).getHexString()}`;
  pincel.fillRect(0, 0, 128, 128);
  const r = azar(17);
  const lado = 128 / 6;
  for (let fila = 0; fila < 7; fila++) for (let col = 0; col < 7; col++) {
    const brillo = 0.7 + r() * 1.4;
    pincel.fillStyle = `#${base.clone().multiplyScalar(brillo).addScalar(r() < 0.12 ? 0.25 : 0).getHexString()}`;
    pincel.beginPath();
    pincel.arc(col * lado + (fila % 2) * lado / 2, fila * lado, lado * 0.47, 0, Math.PI * 2);
    pincel.fill();
  }
  const textura = new THREE.CanvasTexture(lienzo);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.wrapS = THREE.RepeatWrapping;
  textura.wrapT = THREE.RepeatWrapping;
  return textura;
}

export function materialEscenografia(s: SolidoEscenografia, entorno: THREE.Texture): THREE.Material {
  const color = new THREE.Color(s.hex);
  switch (s.acabado) {
    case "lentejuelas": {
      // Un panel plano (pared, tapete) lleva lentejuelas sueltas por instancias sobre un tablero oscuro.
      if (s.forma === "caja" && ejePanel(s.tamano) !== null) return materialTableroLentejuelas(s.hex);
      const mapa = texturaLentejuelas(s.hex);
      if (mapa && s.forma === "caja") mapa.repeat.set(Math.max(1, s.tamano.x / 12), Math.max(1, s.tamano.y / 12));
      return new THREE.MeshStandardMaterial({ color: 0xffffff, map: mapa, metalness: 0.7, roughness: 0.3, envMap: entorno, envMapIntensity: 1.2 });
    }
    case "brillante": return new THREE.MeshPhysicalMaterial({ color, roughness: 0.22, clearcoat: 0.9, clearcoatRoughness: 0.15 });
    case "satinado": return new THREE.MeshPhysicalMaterial({ color, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.35 });
    case "tela": return new THREE.MeshPhysicalMaterial({ color, roughness: 0.95, sheen: 0.6, sheenColor: color.clone().lerp(new THREE.Color(0xffffff), 0.3), sheenRoughness: 0.7 });
    case "madera": return new THREE.MeshStandardMaterial({ color, roughness: 0.72 });
    // Utilería de fiesta: el metal de los cubiertos y bandejas metalizadas, y la llama de una vela (se ve encendida).
    case "metal": return new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.25, envMap: entorno, envMapIntensity: 1 });
    case "llama": return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, roughness: 0.6 });
    // Globo metalizado: papel metalizado espejo o satinado.
    case "foil": return materialFoil(s.hex, false, entorno);
    case "foil_mate": return materialFoil(s.hex, true, entorno);
    default: return new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  }
}
