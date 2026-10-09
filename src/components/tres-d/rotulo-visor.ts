import * as THREE from "three";
import type { SolidoEscenografia } from "@/lib/globos3d/escenografia";
import { cajaDeTinta, contornosDeMascara, type Mascara } from "@/lib/globos3d/rotulo-contornos";
import { caraDe, colocarRotulo, GROSOR_ACRILICO_CM, GROSOR_VINILO_CM, lineasDeRotulo } from "@/lib/globos3d/rotulos";
import { colorDeLatex } from "./materiales-visor";

/**
 * **El rótulo de un sólido en el visor**: el texto en cursiva como letras recortadas de verdad (un vinilo de 0,8 mm o acrílico de
 * 6 mm), con las letras unidas como las de la letra manuscrita. El texto se dibuja en un lienzo con una fuente cursiva del sistema,
 * se saca el contorno de la tinta (`rotulo-contornos.ts`) y se extruye. La geometría es de proporción 1 (alto 1, profundidad 1): cada
 * rótulo la escala a su tamaño, así que un mismo texto cuesta una sola geometría en todo el visor aunque salga en varios sólidos.
 *
 * Todo es de ESTE visor (regla D-017): la geometría de cada texto y los materiales (el espejo lleva el entorno de su contexto
 * WebGL) viven en la fábrica y `liberar()` los suelta con el visor; nunca hay cachés de módulo con recursos de la GPU.
 */

const CM = 0.01;
/** Cuántos textos distintos se guardan por visor: al escribir un nombre letra por letra pasan por aquí todos los intermedios; al llegar al tope sale el que lleva más tiempo sin usarse. */
const MAXIMO_TEXTOS = 48;
const LETRA_PX = 150;
const FUENTE = (px: number) => `italic 400 ${px}px "Segoe Script", "Brush Script MT", "Snell Roundhand", "Apple Chancery", cursive`;

/** Convierte un texto en la máscara de su tinta (recortada a ella), o null si no hay dónde dibujarlo (sin lienzo). */
export type Rasterizador = (texto: string) => Mascara | null;

/** El texto dibujado con la fuente cursiva del navegador: tinta = píxeles con opacidad. Las letras se engrosan un poco (el recorte de acrílico no tiene pelos). */
export const rasterizarTexto: Rasterizador = (texto) => {
  if (typeof document === "undefined") return null;
  const lineas = lineasDeRotulo(texto);
  const medidor = document.createElement("canvas").getContext("2d");
  if (!medidor || !lineas.length) return null;
  medidor.font = FUENTE(LETRA_PX);
  const ancho = Math.ceil(Math.max(...lineas.map((l) => medidor.measureText(l).width)) + LETRA_PX * 1.2);
  const paso = LETRA_PX * 1.3;
  const alto = Math.ceil(paso * lineas.length + LETRA_PX * 0.8);
  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;
  const p = lienzo.getContext("2d", { willReadFrequently: true });
  if (!p) return null;
  p.font = FUENTE(LETRA_PX);
  p.textAlign = "center";
  p.textBaseline = "middle";
  p.lineJoin = "round";
  p.fillStyle = "#000";
  p.strokeStyle = "#000";
  p.lineWidth = LETRA_PX * 0.035;
  lineas.forEach((l, i) => { const y = LETRA_PX * 0.4 + paso * (i + 0.5); p.strokeText(l, ancho / 2, y); p.fillText(l, ancho / 2, y); });
  const rgba = p.getImageData(0, 0, ancho, alto).data;
  const datos = new Uint8Array(ancho * alto);
  for (let i = 0; i < datos.length; i++) datos[i] = rgba[i * 4 + 3]! > 110 ? 1 : 0;
  return recortada({ datos, ancho, alto });
};

/** La máscara recortada a su tinta (null si no tiene). */
function recortada(m: Mascara): Mascara | null {
  const caja = cajaDeTinta(m);
  if (!caja) return null;
  const ancho = caja.x1 - caja.x0, alto = caja.y1 - caja.y0;
  const datos = new Uint8Array(ancho * alto);
  for (let y = 0; y < alto; y++) datos.set(m.datos.subarray((caja.y0 + y) * m.ancho + caja.x0, (caja.y0 + y) * m.ancho + caja.x1), y * ancho);
  return { datos, ancho, alto };
}

type TextoListo = { geometria: THREE.BufferGeometry; aspecto: number };

/** La geometría de unas letras de alto 1, centradas en x e y y de profundidad 1 (de z = 0 a z = 1). */
function geometriaDeMascara(m: Mascara): TextoListo | null {
  const contornos = contornosDeMascara(m);
  if (!contornos.length) return null;
  const punto = (p: { x: number; y: number }) => new THREE.Vector2((p.x - m.ancho / 2) / m.alto, (m.alto / 2 - p.y) / m.alto);
  const formas = contornos.map((c) => {
    const forma = new THREE.Shape(c.externo.map(punto));
    for (const hueco of c.huecos) forma.holes.push(new THREE.Path(hueco.map(punto)));
    return forma;
  });
  return { geometria: new THREE.ExtrudeGeometry(formas, { depth: 1, bevelEnabled: false, curveSegments: 1 }), aspecto: m.ancho / m.alto };
}

export type RotulosVisor = {
  /** Las letras de un sólido (hijas de su malla, en su marco); null si no lleva rótulo o no se pudo dibujar el texto. */
  malla: (s: SolidoEscenografia) => THREE.Mesh | null;
  /** Suelta las geometrías y los materiales de este visor. */
  liberar: () => void;
};

/** Los rótulos de UN visor: `entorno` es el reflejo de ese visor y `rasterizar` convierte un texto en su tinta (el lienzo del navegador por defecto). */
export function crearRotulosVisor(entorno: () => THREE.Texture, rasterizar: Rasterizador = rasterizarTexto): RotulosVisor {
  const textos = new Map<string, TextoListo>();
  const materiales = new Map<string, THREE.Material>();

  const textoListo = (texto: string): TextoListo | null => {
    const guardado = textos.get(texto);
    if (guardado) { textos.delete(texto); textos.set(texto, guardado); return guardado; }
    const mascara = rasterizar(texto);
    const hecho = mascara ? geometriaDeMascara(mascara) : null;
    if (!hecho) return null;
    hecho.geometria.userData.compartido = true;
    textos.set(texto, hecho);
    if (textos.size > MAXIMO_TEXTOS) {
      // Se suelta de la GPU y deja de ser compartida: si una pieza viva aún la usa, se vuelve a subir al dibujar y la libera esa pieza al vaciarse.
      const [viejo, geometria] = textos.entries().next().value!;
      textos.delete(viejo);
      geometria.geometria.userData.compartido = false;
      geometria.geometria.dispose();
    }
    return hecho;
  };

  const material = (acabado: "vinilo" | "acrilico_espejo" | "acrilico_mate", hex: string): THREE.Material => {
    const clave = `${acabado}|${hex}`;
    let m = materiales.get(clave);
    if (!m) {
      // El espejo se ve brillante desde cualquier lado: refleja el estudio con más fuerza y trae un resplandor propio mínimo (sin él, de frente refleja lo oscuro de la sala).
      if (acabado === "acrilico_espejo") { const c = colorDeLatex("metal", hex); m = new THREE.MeshStandardMaterial({ color: c, metalness: 1, roughness: 0.1, envMap: entorno(), envMapIntensity: 2.6, emissive: c, emissiveIntensity: 0.22 }); }
      else if (acabado === "acrilico_mate") m = new THREE.MeshStandardMaterial({ color: hex, metalness: 0.05, roughness: 0.4 });
      else m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      m.userData.compartido = true;
      materiales.set(clave, m);
    }
    return m;
  };

  return {
    malla(s) {
      const r = s.rotulo, cara = s.forma === "cilindro" ? null : caraDe(s);
      if (!r || !cara) return null;
      const texto = textoListo(r.texto);
      if (!texto) return null;
      const colocado = colocarRotulo(cara, r, texto.aspecto);
      const vinilo = r.acabado === "vinilo";
      const objeto = new THREE.Mesh(texto.geometria, material(r.acabado, r.color));
      objeto.scale.set(colocado.altoCm * CM, colocado.altoCm * CM, (vinilo ? GROSOR_VINILO_CM : GROSOR_ACRILICO_CM) * CM);
      objeto.position.set(colocado.xCm * CM, colocado.yCm * CM, (colocado.zCm + (vinilo ? 0.02 : 0)) * CM);
      objeto.castShadow = !vinilo;
      objeto.receiveShadow = true;
      return objeto;
    },
    liberar() {
      for (const t of textos.values()) t.geometria.dispose();
      for (const m of materiales.values()) m.dispose();
      textos.clear();
      materiales.clear();
    },
  };
}
