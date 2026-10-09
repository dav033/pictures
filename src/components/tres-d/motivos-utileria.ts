import * as THREE from "three";
import type { MotivoEscenografia, SolidoEscenografia } from "@/lib/globos3d/escenografia";

/**
 * Lo impreso en la utilería de fiesta (calavera, murciélago, calabaza, fantasma, araña, telaraña, sombrero de bruja,
 * texto, lunares, rayas, estrellas): se dibuja en un lienzo 2D y se pega como calcomanía sobre la cara del sólido
 * (delante o arriba), un pelo por fuera. Las texturas se guardan por dibujo, tinta y fondo: un banderín de 12
 * banderines usa 3 o 4, no 12.
 */
const CM = 0.01;
const LADO = 256;
const TEXTURAS = new Map<string, THREE.CanvasTexture>();

const PATRONES = new Set(["lunares", "rayas", "estrellas"]);

/** Tinta por defecto: oscura sobre fondo claro y blanca sobre oscuro. */
function tintaPara(fondo: string): string {
  const c = new THREE.Color(fondo);
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b > 0.55 ? "#1a1414" : "#ffffff";
}

type Pincel = CanvasRenderingContext2D;

function circulo(p: Pincel, x: number, y: number, r: number) { p.beginPath(); p.arc(x, y, r, 0, Math.PI * 2); p.fill(); }

/** Agujeros (ojos, boca): se borra el dibujo y asoma el color del sólido. */
function agujero(p: Pincel, dibujar: () => void) {
  p.save();
  p.globalCompositeOperation = "destination-out";
  dibujar();
  p.restore();
}

function calavera(p: Pincel, s: number, tinta: string) {
  p.fillStyle = tinta;
  circulo(p, s * 0.5, s * 0.42, s * 0.3);
  p.fillRect(s * 0.33, s * 0.55, s * 0.34, s * 0.22);
  agujero(p, () => {
    circulo(p, s * 0.39, s * 0.44, s * 0.075);
    circulo(p, s * 0.61, s * 0.44, s * 0.075);
    p.beginPath(); p.moveTo(s * 0.5, s * 0.52); p.lineTo(s * 0.46, s * 0.6); p.lineTo(s * 0.54, s * 0.6); p.closePath(); p.fill();
    for (const x of [0.4, 0.47, 0.53, 0.6]) p.fillRect(s * (x - 0.012), s * 0.68, s * 0.024, s * 0.09);
  });
}

function murcielago(p: Pincel, s: number, tinta: string) {
  p.fillStyle = tinta;
  p.beginPath();
  p.moveTo(s * 0.5, s * 0.36);
  p.quadraticCurveTo(s * 0.62, s * 0.3, s * 0.95, s * 0.36);
  p.quadraticCurveTo(s * 0.86, s * 0.48, s * 0.88, s * 0.62);
  p.quadraticCurveTo(s * 0.8, s * 0.55, s * 0.72, s * 0.62);
  p.quadraticCurveTo(s * 0.66, s * 0.55, s * 0.58, s * 0.66);
  p.lineTo(s * 0.5, s * 0.6);
  p.lineTo(s * 0.42, s * 0.66);
  p.quadraticCurveTo(s * 0.34, s * 0.55, s * 0.28, s * 0.62);
  p.quadraticCurveTo(s * 0.2, s * 0.55, s * 0.12, s * 0.62);
  p.quadraticCurveTo(s * 0.14, s * 0.48, s * 0.05, s * 0.36);
  p.quadraticCurveTo(s * 0.38, s * 0.3, s * 0.5, s * 0.36);
  p.fill();
  // Cabeza con orejas.
  circulo(p, s * 0.5, s * 0.4, s * 0.075);
  p.beginPath(); p.moveTo(s * 0.44, s * 0.36); p.lineTo(s * 0.45, s * 0.26); p.lineTo(s * 0.49, s * 0.34); p.fill();
  p.beginPath(); p.moveTo(s * 0.56, s * 0.36); p.lineTo(s * 0.55, s * 0.26); p.lineTo(s * 0.51, s * 0.34); p.fill();
}

function caraCalabaza(p: Pincel, s: number) {
  p.beginPath(); p.moveTo(s * 0.33, s * 0.5); p.lineTo(s * 0.43, s * 0.5); p.lineTo(s * 0.38, s * 0.4); p.closePath(); p.fill();
  p.beginPath(); p.moveTo(s * 0.57, s * 0.5); p.lineTo(s * 0.67, s * 0.5); p.lineTo(s * 0.62, s * 0.4); p.closePath(); p.fill();
  p.beginPath();
  p.moveTo(s * 0.28, s * 0.6);
  p.quadraticCurveTo(s * 0.5, s * 0.82, s * 0.72, s * 0.6);
  p.lineTo(s * 0.64, s * 0.64); p.lineTo(s * 0.6, s * 0.6); p.lineTo(s * 0.55, s * 0.66); p.lineTo(s * 0.5, s * 0.61);
  p.lineTo(s * 0.45, s * 0.66); p.lineTo(s * 0.4, s * 0.6); p.lineTo(s * 0.36, s * 0.64);
  p.closePath(); p.fill();
}

/** Calabaza entera (naranja, tallo verde, cara oscura) o, con tinta propia, solo la cara (sobre algo ya naranja). */
function calabaza(p: Pincel, s: number, tinta: string | null) {
  if (tinta) { p.fillStyle = tinta; caraCalabaza(p, s); return; }
  p.fillStyle = "#3f7a2a";
  p.fillRect(s * 0.47, s * 0.16, s * 0.07, s * 0.12);
  p.fillStyle = "#f07a1a";
  p.beginPath(); p.ellipse(s * 0.5, s * 0.55, s * 0.36, s * 0.3, 0, 0, Math.PI * 2); p.fill();
  p.strokeStyle = "#c95e10"; p.lineWidth = s * 0.012;
  for (const k of [-0.16, 0, 0.16]) { p.beginPath(); p.ellipse(s * (0.5 + k * 0.6), s * 0.55, s * 0.08, s * 0.29, 0, 0, Math.PI * 2); p.stroke(); }
  p.fillStyle = "#2a1a10";
  caraCalabaza(p, s);
}

function fantasma(p: Pincel, s: number, tinta: string) {
  p.fillStyle = tinta === "#1a1414" ? "#ffffff" : tinta;
  p.beginPath();
  p.moveTo(s * 0.26, s * 0.85);
  p.lineTo(s * 0.26, s * 0.42);
  p.bezierCurveTo(s * 0.26, s * 0.08, s * 0.74, s * 0.08, s * 0.74, s * 0.42);
  p.lineTo(s * 0.74, s * 0.85);
  for (let i = 0; i < 4; i++) { const x0 = 0.74 - i * 0.12; p.quadraticCurveTo(s * (x0 - 0.03), s * 0.77, s * (x0 - 0.06), s * 0.85); p.quadraticCurveTo(s * (x0 - 0.09), s * 0.93, s * (x0 - 0.12), s * 0.85); }
  p.closePath(); p.fill();
  p.strokeStyle = "rgba(0,0,0,.35)"; p.lineWidth = s * 0.012; p.stroke();
  p.fillStyle = "#1a1414";
  p.beginPath(); p.ellipse(s * 0.42, s * 0.4, s * 0.035, s * 0.055, 0, 0, Math.PI * 2); p.fill();
  p.beginPath(); p.ellipse(s * 0.58, s * 0.4, s * 0.035, s * 0.055, 0, 0, Math.PI * 2); p.fill();
  p.beginPath(); p.ellipse(s * 0.5, s * 0.55, s * 0.045, s * 0.06, 0, 0, Math.PI * 2); p.fill();
}

function arana(p: Pincel, s: number, tinta: string) {
  p.strokeStyle = tinta; p.fillStyle = tinta; p.lineWidth = s * 0.03; p.lineCap = "round";
  for (const lado of [-1, 1]) for (let k = 0; k < 4; k++) {
    const y = s * (0.45 + k * 0.07);
    p.beginPath(); p.moveTo(s * 0.5, s * 0.52); p.lineTo(s * (0.5 + lado * 0.22), y - s * 0.12); p.lineTo(s * (0.5 + lado * (0.34 + k * 0.02)), y + s * 0.08); p.stroke();
  }
  circulo(p, s * 0.5, s * 0.56, s * 0.13);
  circulo(p, s * 0.5, s * 0.38, s * 0.08);
  p.beginPath(); p.moveTo(s * 0.5, s * 0.05); p.lineTo(s * 0.5, s * 0.3); p.lineWidth = s * 0.01; p.stroke();
}

function telarana(p: Pincel, s: number, tinta: string) {
  p.strokeStyle = tinta; p.lineWidth = s * 0.014;
  const c = s * 0.5, R = s * 0.46, n = 8;
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; p.beginPath(); p.moveTo(c, c); p.lineTo(c + R * Math.cos(a), c + R * Math.sin(a)); p.stroke(); }
  for (let k = 1; k <= 4; k++) {
    const r = (R * k) / 4.3;
    p.beginPath();
    for (let i = 0; i <= n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      if (i === 0) p.moveTo(c + r * Math.cos(a0), c + r * Math.sin(a0));
      const am = (a0 + a1) / 2;
      if (i < n) p.quadraticCurveTo(c + r * 0.82 * Math.cos(am), c + r * 0.82 * Math.sin(am), c + r * Math.cos(a1), c + r * Math.sin(a1));
    }
    p.stroke();
  }
}

function sombreroBruja(p: Pincel, s: number, tinta: string) {
  p.fillStyle = tinta;
  p.beginPath(); p.ellipse(s * 0.5, s * 0.78, s * 0.42, s * 0.08, 0, 0, Math.PI * 2); p.fill();
  p.beginPath(); p.moveTo(s * 0.3, s * 0.78); p.quadraticCurveTo(s * 0.45, s * 0.4, s * 0.62, s * 0.12); p.quadraticCurveTo(s * 0.6, s * 0.45, s * 0.7, s * 0.78); p.closePath(); p.fill();
  p.fillStyle = "#7c3fa0";
  p.fillRect(s * 0.32, s * 0.68, s * 0.37, s * 0.06);
}

/** Texto en mayúsculas, en una o dos líneas, del tamaño que quepa. */
function texto(p: Pincel, ancho: number, alto: number, contenido: string, tinta: string) {
  const palabras = contenido.toUpperCase().split(/\s+/).filter(Boolean);
  const lineas = palabras.length > 1 && contenido.length > 8 ? [palabras.slice(0, Math.ceil(palabras.length / 2)).join(" "), palabras.slice(Math.ceil(palabras.length / 2)).join(" ")] : [palabras.join(" ")];
  let tam = alto / (lineas.length * 1.15);
  p.font = `900 ${tam}px "Arial Black", Arial, sans-serif`;
  const mas = Math.max(...lineas.map((l) => p.measureText(l).width));
  if (mas > ancho * 0.94) { tam *= (ancho * 0.94) / mas; p.font = `900 ${tam}px "Arial Black", Arial, sans-serif`; }
  p.fillStyle = tinta;
  p.textAlign = "center";
  p.textBaseline = "middle";
  p.strokeStyle = tinta === "#ffffff" ? "rgba(0,0,0,.35)" : "rgba(255,255,255,.25)";
  p.lineWidth = tam * 0.06;
  lineas.forEach((l, i) => {
    const y = alto / 2 + (i - (lineas.length - 1) / 2) * tam * 1.1;
    p.strokeText(l, ancho / 2, y);
    p.fillText(l, ancho / 2, y);
  });
}

/** Letrero de neón: el texto tal cual, en cursiva, con un tubo claro al centro y un resplandor del color alrededor. */
function textoNeon(p: Pincel, ancho: number, alto: number, contenido: string, tinta: string) {
  const palabras = contenido.trim().split(/\s+/).filter(Boolean);
  const lineas = palabras.length > 1 && contenido.length > 10 ? [palabras.slice(0, Math.ceil(palabras.length / 2)).join(" "), palabras.slice(Math.ceil(palabras.length / 2)).join(" ")] : [palabras.join(" ")];
  const fuente = (t: number) => `italic 400 ${t}px "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive`;
  let tam = alto / (lineas.length * 1.35);
  p.font = fuente(tam);
  const mas = Math.max(...lineas.map((l) => p.measureText(l).width));
  if (mas > ancho * 0.9) { tam *= (ancho * 0.9) / mas; p.font = fuente(tam); }
  p.textAlign = "center";
  p.textBaseline = "middle";
  p.lineJoin = "round";
  const pintar = (estilo: string, grosor: number, brillo: number) => {
    p.strokeStyle = estilo;
    p.fillStyle = estilo;
    p.lineWidth = grosor;
    p.shadowColor = tinta;
    p.shadowBlur = brillo;
    lineas.forEach((l, i) => { const y = alto / 2 + (i - (lineas.length - 1) / 2) * tam * 1.25; p.strokeText(l, ancho / 2, y); });
  };
  pintar(tinta, tam * 0.1, tam * 0.5);
  pintar(tinta, tam * 0.1, tam * 0.2);
  pintar("#ffffff", tam * 0.035, 0);
  p.shadowBlur = 0;
}

function patron(p: Pincel, ancho: number, alto: number, dibujo: string, tinta: string) {
  p.fillStyle = tinta;
  if (dibujo === "lunares") {
    const paso = Math.min(ancho, alto) / 6;
    for (let f = 0; f * paso < alto + paso; f++) for (let c = 0; c * paso < ancho + paso; c++) circulo(p, c * paso + (f % 2) * paso / 2, f * paso, paso * 0.2);
  } else if (dibujo === "rayas") {
    const paso = Math.min(ancho, alto) / 5;
    p.save(); p.translate(ancho / 2, alto / 2); p.rotate(-Math.PI / 4);
    for (let x = -ancho * 1.5; x < ancho * 1.5; x += paso) p.fillRect(x, -alto * 1.5, paso * 0.45, alto * 3);
    p.restore();
  } else {
    const paso = Math.min(ancho, alto) / 4;
    for (let f = 0; f * paso < alto + paso; f++) for (let c = 0; c * paso < ancho + paso; c++) {
      const x = c * paso + (f % 2) * paso / 2, y = f * paso, r = paso * 0.22;
      p.beginPath();
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.45 : r; p.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); }
      p.closePath(); p.fill();
    }
  }
}

/** La textura de un motivo sobre un fondo de `fondo` (para elegir la tinta), en un lienzo de proporción `proporcion` (ancho/alto). */
function texturaMotivo(m: MotivoEscenografia, fondo: string, proporcion: number): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const tinta = m.hex ?? tintaPara(fondo);
  const ancho = proporcion >= 1 ? LADO : Math.round(LADO * proporcion), alto = proporcion >= 1 ? Math.round(LADO / proporcion) : LADO;
  const clave = `${m.dibujo}|${m.estilo ?? ""}|${m.texto ?? ""}|${tinta}|${m.hex ? "propia" : ""}|${ancho}x${alto}`;
  const guardada = TEXTURAS.get(clave);
  if (guardada) return guardada;
  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;
  const p = lienzo.getContext("2d");
  if (!p) return null;
  if (m.dibujo === "texto") (m.estilo === "neon" ? textoNeon : texto)(p, ancho, alto, m.texto ?? "", tinta);
  else if (PATRONES.has(m.dibujo)) patron(p, ancho, alto, m.dibujo, tinta);
  else {
    const s = Math.min(ancho, alto);
    p.translate((ancho - s) / 2, (alto - s) / 2);
    if (m.dibujo === "calavera") calavera(p, s, tinta);
    else if (m.dibujo === "murcielago") murcielago(p, s, tinta);
    else if (m.dibujo === "calabaza") calabaza(p, s, m.hex ?? null);
    else if (m.dibujo === "fantasma") fantasma(p, s, tinta);
    else if (m.dibujo === "arana") arana(p, s, tinta);
    else if (m.dibujo === "telarana") telarana(p, s, tinta);
    else sombreroBruja(p, s, tinta);
  }
  const textura = new THREE.CanvasTexture(lienzo);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.anisotropy = 4;
  TEXTURAS.set(clave, textura);
  return textura;
}

/**
 * La calcomanía del motivo de un sólido, en el espacio de su malla (m): un plano (o un disco en la tapa de un
 * cilindro) un pelo por fuera de la cara, del tamaño que cabe en ella por `escala`. null si no lleva motivo.
 */
export function calcoMotivo(s: SolidoEscenografia): THREE.Object3D | null {
  const m = s.motivo;
  if (!m) return null;
  const escala = m.escala ?? 1;
  const cara = m.cara ?? (s.forma === "cilindro" && s.altoCm < 3 ? "arriba" : "frente");
  const patronOTexto = m.dibujo === "texto" || PATRONES.has(m.dibujo);
  const PELO = 0.04;
  // Ancho, alto (cm) del calco y dónde va su centro (cm, en el marco del sólido), y si mira arriba.
  let ancho: number, alto: number, centro: THREE.Vector3, arriba = false, disco = false;
  if (s.forma === "caja") {
    if (cara === "arriba") { ancho = s.tamano.x; alto = s.tamano.z; centro = new THREE.Vector3(0, s.tamano.y / 2 + PELO, 0); arriba = true; }
    else { ancho = s.tamano.x; alto = s.tamano.y; centro = new THREE.Vector3(0, 0, s.tamano.z / 2 + PELO); }
    ancho *= 0.88; alto *= 0.88;
  } else if (s.forma === "cilindro") {
    if (cara === "arriba") { ancho = alto = s.radioArribaCm * 2 * 0.97; centro = new THREE.Vector3(0, s.altoCm + PELO, 0); arriba = true; disco = true; }
    else {
      const rMedio = (s.radioCm + s.radioArribaCm) / 2;
      ancho = rMedio * 1.25; alto = Math.min(s.altoCm * 0.8, ancho * 1.1);
      centro = new THREE.Vector3(0, s.altoCm * 0.5, rMedio + PELO + 0.05);
    }
  } else {
    const xs = s.contorno.map((p) => p.x), ys = s.contorno.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    // Un banderín triangular: lo impreso va en su parte ancha (el centroide), del tamaño de su círculo inscrito.
    if (patronOTexto) { ancho = w * 0.66; alto = h * 0.4; } else { ancho = alto = Math.min(w, h) * 0.6; }
    centro = new THREE.Vector3(cx, cy, s.grosorCm + PELO);
  }
  if (!patronOTexto && !disco) { const lado = Math.min(ancho, alto); ancho = lado; alto = lado; }
  ancho *= escala; alto *= escala;
  const mapa = texturaMotivo(m, s.hex, disco ? 1 : ancho / alto);
  if (!mapa) return null;
  const geometria = disco ? new THREE.CircleGeometry((ancho / 2) * CM, 40) : new THREE.PlaneGeometry(ancho * CM, alto * CM);
  const material = new THREE.MeshStandardMaterial({ map: mapa, transparent: true, alphaTest: 0.04, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  // El visor libera el mapa de los materiales estándar al vaciar: las texturas guardadas se vuelven a subir solas.
  const malla = new THREE.Mesh(geometria, material);
  if (arriba) malla.rotation.x = -Math.PI / 2;
  malla.position.copy(centro.multiplyScalar(CM));
  return malla;
}
