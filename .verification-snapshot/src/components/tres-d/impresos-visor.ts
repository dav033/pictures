import * as THREE from "three";
import { contornoCorazon, type PuntoPerfil } from "@/lib/globos3d/geometria";
import type { Punto2 } from "@/lib/globos3d/trenza";
import { claveImpreso, type CapaCara, type CapaIcono, type CapaImpreso, type CapaPatron, type CapaTexto, type ImpresoGlobo, type MotivoPatron } from "@/lib/globos3d/estampados";

/**
 * El visor de lo impreso y de los metalizados (ver `lib/globos3d/estampados.ts` y `metalizados.ts`):
 *
 * - **Impreso sobre un globo redondo**: una cáscara del mismo perfil torneado, un pelo por fuera del látex, con una
 *   textura equirectangular (longitud × latitud medidas desde el centro del cuerpo) que solo pinta la tinta. Lo de
 *   frente (texto, cara, ícono) se dibuja primero «visto de frente» (proyección equidistante, 1° de arco = lo mismo en
 *   todas direcciones) y se reproyecta píxel a píxel, así una cara o un letrero no se estiran; los patrones se reparten
 *   por filas de latitud con menos motivos cerca de los polos.
 * - **Impreso sobre un corazón** (C-12): una calcomanía plana con la silueta del corazón en su cara (y en la de atrás).
 * - **Metalizado**: el contorno inflado como almohada (alto según la distancia al borde, con canto redondo y arrugas
 *   suaves cerca del borde), espejo o satinado.
 * Las texturas y las geometrías se guardan por clave: un ramo de 9 globos iguales dibuja una sola textura.
 */
const CM = 0.01;
/** Píxeles por grado de arco en las texturas del globo: 1024 px por vuelta. */
const K = 1024 / 360;
const ANCHO = 1024, ALTO = 512, FRENTE = 512;

type Pincel = CanvasRenderingContext2D;

// ----------------------------------------------------------------------------------------------------------
// Azar fijo (cada impreso siempre igual)
// ----------------------------------------------------------------------------------------------------------

function azar(semilla: number): () => number {
  let x = (semilla * 2654435761) >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
}

function lienzo(ancho: number, alto: number): { c: HTMLCanvasElement; p: Pincel } | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = ancho; c.height = alto;
  const p = c.getContext("2d", { willReadFrequently: true });
  return p ? { c, p } : null;
}

// ----------------------------------------------------------------------------------------------------------
// Motivos (centrados en 0,0; `s` = lado en px)
// ----------------------------------------------------------------------------------------------------------

function corazonCamino(p: Pincel, s: number) {
  const r = s / 2;
  p.beginPath();
  p.moveTo(0, r * 0.75);
  p.bezierCurveTo(-r * 1.1, -r * 0.05, -r * 0.55, -r * 0.95, 0, -r * 0.4);
  p.bezierCurveTo(r * 0.55, -r * 0.95, r * 1.1, -r * 0.05, 0, r * 0.75);
  p.closePath();
}

function estrellaCamino(p: Pincel, s: number, puntas = 5, interior = 0.45) {
  const r = s / 2;
  p.beginPath();
  for (let i = 0; i < puntas * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / puntas, k = i % 2 ? r * interior : r;
    if (i === 0) p.moveTo(k * Math.cos(a), k * Math.sin(a)); else p.lineTo(k * Math.cos(a), k * Math.sin(a));
  }
  p.closePath();
}

function destelloCamino(p: Pincel, s: number) {
  const r = s / 2, c = r * 0.18;
  p.beginPath();
  p.moveTo(0, -r); p.quadraticCurveTo(c, -c, r, 0); p.quadraticCurveTo(c, c, 0, r); p.quadraticCurveTo(-c, c, -r, 0); p.quadraticCurveTo(-c, -c, 0, -r);
  p.closePath();
}

function bigoteCamino(p: Pincel, s: number) {
  const r = s / 2;
  p.beginPath();
  p.moveTo(0, -r * 0.12);
  p.bezierCurveTo(r * 0.3, -r * 0.45, r * 0.7, -r * 0.2, r * 0.82, -r * 0.42);
  p.bezierCurveTo(r * 1.05, -r * 0.05, r * 0.6, r * 0.3, r * 0.25, r * 0.12);
  p.quadraticCurveTo(r * 0.1, r * 0.05, 0, r * 0.16);
  p.quadraticCurveTo(-r * 0.1, r * 0.05, -r * 0.25, r * 0.12);
  p.bezierCurveTo(-r * 0.6, r * 0.3, -r * 1.05, -r * 0.05, -r * 0.82, -r * 0.42);
  p.bezierCurveTo(-r * 0.7, -r * 0.2, -r * 0.3, -r * 0.45, 0, -r * 0.12);
  p.closePath();
}

function corbatinCamino(p: Pincel, s: number) {
  const r = s / 2;
  p.beginPath();
  p.moveTo(-r * 0.12, -r * 0.1); p.lineTo(-r * 0.9, -r * 0.45); p.quadraticCurveTo(-r, 0, -r * 0.9, r * 0.45); p.lineTo(-r * 0.12, r * 0.1);
  p.lineTo(r * 0.12, r * 0.1); p.lineTo(r * 0.9, r * 0.45); p.quadraticCurveTo(r, 0, r * 0.9, -r * 0.45); p.lineTo(r * 0.12, -r * 0.1);
  p.closePath();
}

function palomaCamino(p: Pincel, s: number) {
  const r = s / 2;
  p.beginPath();
  p.moveTo(-r * 0.9, r * 0.1);
  p.quadraticCurveTo(-r * 0.4, r * 0.35, r * 0.1, r * 0.25);
  p.quadraticCurveTo(r * 0.55, r * 0.2, r * 0.75, -r * 0.05);
  p.lineTo(r * 0.95, -r * 0.05); p.lineTo(r * 0.75, -r * 0.2);
  p.quadraticCurveTo(r * 0.55, -r * 0.35, r * 0.35, -r * 0.1);
  p.quadraticCurveTo(r * 0.1, -r * 0.95, -r * 0.45, -r * 0.8);
  p.quadraticCurveTo(-r * 0.05, -r * 0.4, -r * 0.1, -r * 0.05);
  p.quadraticCurveTo(-r * 0.5, -r * 0.1, -r * 0.9, r * 0.1);
  p.closePath();
}

function hojaCamino(p: Pincel, s: number) {
  const r = s / 2;
  p.beginPath();
  p.moveTo(0, r); p.quadraticCurveTo(r * 0.75, 0, 0, -r); p.quadraticCurveTo(-r * 0.75, 0, 0, r);
  p.closePath();
}

function florCamino(p: Pincel, s: number, petalos = 5) {
  const r = s / 2;
  p.beginPath();
  for (let i = 0; i < petalos; i++) {
    const a = (i * 2 * Math.PI) / petalos;
    p.moveTo(0, 0);
    p.ellipse(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.48, r * 0.3, a, 0, Math.PI * 2);
  }
}

function mariposaCamino(p: Pincel, s: number) {
  const r = s / 2;
  p.beginPath();
  p.ellipse(-r * 0.42, -r * 0.3, r * 0.42, r * 0.34, -0.5, 0, Math.PI * 2);
  p.ellipse(r * 0.42, -r * 0.3, r * 0.42, r * 0.34, 0.5, 0, Math.PI * 2);
  p.ellipse(-r * 0.3, r * 0.32, r * 0.28, r * 0.24, 0.6, 0, Math.PI * 2);
  p.ellipse(r * 0.3, r * 0.32, r * 0.28, r * 0.24, -0.6, 0, Math.PI * 2);
}

function diamanteCamino(p: Pincel, s: number) {
  const r = s / 2;
  p.beginPath();
  p.moveTo(-r * 0.8, -r * 0.25); p.lineTo(-r * 0.45, -r * 0.65); p.lineTo(r * 0.45, -r * 0.65); p.lineTo(r * 0.8, -r * 0.25); p.lineTo(0, r * 0.8);
  p.closePath();
}

/** Un motivo del patrón, centrado en (0,0), de lado `s` px. */
function motivo(p: Pincel, m: MotivoPatron, s: number, tinta: string, r: () => number) {
  p.fillStyle = tinta;
  p.strokeStyle = tinta;
  p.lineCap = "round";
  p.lineJoin = "round";
  switch (m) {
    case "corazon": corazonCamino(p, s); p.fill(); break;
    case "estrella": estrellaCamino(p, s); p.fill(); break;
    case "punto": p.beginPath(); p.arc(0, 0, s / 2, 0, Math.PI * 2); p.fill(); break;
    case "destello": destelloCamino(p, s); p.fill(); p.beginPath(); p.arc(s * 0.55, s * 0.4, s * 0.06, 0, Math.PI * 2); p.arc(-s * 0.5, -s * 0.45, s * 0.05, 0, Math.PI * 2); p.fill(); break;
    case "diamante":
      destelloCamino(p, s * 0.8); p.fill();
      p.lineWidth = Math.max(1, s * 0.04);
      p.beginPath(); p.arc(s * 0.55, s * 0.1, s * 0.18, Math.PI * 0.8, Math.PI * 2.2); p.stroke();
      p.beginPath(); p.arc(-s * 0.5, s * 0.5, s * 0.05, 0, Math.PI * 2); p.fill();
      break;
    case "bigote": bigoteCamino(p, s); p.fill(); break;
    case "corbatin": corbatinCamino(p, s * 0.8); p.fill(); break;
    case "paloma": palomaCamino(p, s); p.fill(); break;
    case "hoja":
      p.rotate(r() * Math.PI * 2);
      hojaCamino(p, s); p.fill();
      p.globalCompositeOperation = "destination-out"; p.lineWidth = Math.max(1, s * 0.05);
      p.beginPath(); p.moveTo(0, s * 0.45); p.lineTo(0, -s * 0.45);
      for (let k = -2; k <= 2; k++) { p.moveTo(0, k * s * 0.15); p.lineTo(s * 0.22, k * s * 0.15 - s * 0.12); p.moveTo(0, k * s * 0.15); p.lineTo(-s * 0.22, k * s * 0.15 - s * 0.12); }
      p.stroke(); p.globalCompositeOperation = "source-over";
      break;
    case "flor": florCamino(p, s); p.fill(); break;
    case "mariposa": mariposaCamino(p, s); p.fill(); break;
    case "copo":
      p.lineWidth = Math.max(1, s * 0.07);
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3, c = Math.cos(a), sn = Math.sin(a);
        p.beginPath(); p.moveTo(0, 0); p.lineTo(c * s * 0.5, sn * s * 0.5);
        p.moveTo(c * s * 0.3, sn * s * 0.3); p.lineTo(c * s * 0.3 + Math.cos(a + 0.7) * s * 0.13, sn * s * 0.3 + Math.sin(a + 0.7) * s * 0.13);
        p.moveTo(c * s * 0.3, sn * s * 0.3); p.lineTo(c * s * 0.3 + Math.cos(a - 0.7) * s * 0.13, sn * s * 0.3 + Math.sin(a - 0.7) * s * 0.13);
        p.stroke();
      }
      break;
    case "telarana": {
      p.lineWidth = Math.max(1, s * 0.025);
      const radios = 8, R = s / 2;
      p.beginPath();
      for (let k = 0; k < radios; k++) { const a = (k * 2 * Math.PI) / radios; p.moveTo(0, 0); p.lineTo(Math.cos(a) * R, Math.sin(a) * R); }
      for (const f of [0.3, 0.55, 0.8]) {
        for (let k = 0; k <= radios; k++) {
          const a0 = (k * 2 * Math.PI) / radios, a1 = ((k + 1) * 2 * Math.PI) / radios, am = (a0 + a1) / 2;
          if (k === 0) p.moveTo(Math.cos(a0) * R * f, Math.sin(a0) * R * f);
          p.quadraticCurveTo(Math.cos(am) * R * f * 0.85, Math.sin(am) * R * f * 0.85, Math.cos(a1) * R * f, Math.sin(a1) * R * f);
        }
      }
      p.stroke();
      break;
    }
    case "arana":
      p.lineWidth = Math.max(1, s * 0.06);
      p.beginPath();
      for (let k = 0; k < 4; k++) for (const lado of [-1, 1]) {
        const y = (k - 1.5) * s * 0.12;
        p.moveTo(0, y); p.quadraticCurveTo(lado * s * 0.3, y - s * 0.2, lado * s * 0.45, y + s * 0.12);
      }
      p.stroke();
      p.beginPath(); p.ellipse(0, s * 0.06, s * 0.16, s * 0.2, 0, 0, Math.PI * 2); p.arc(0, -s * 0.16, s * 0.1, 0, Math.PI * 2); p.fill();
      break;
    case "confeti": {
      // Varias piezas pequeñas de confeti (círculos y tiras).
      for (let k = 0; k < 4; k++) {
        const x = (r() - 0.5) * s, y = (r() - 0.5) * s, t = s * (0.12 + r() * 0.1);
        p.beginPath(); p.arc(x, y, t / 2, 0, Math.PI * 2); p.fill();
      }
      break;
    }
    case "interrogacion":
      p.font = `900 ${Math.round(s)}px "Arial Black", Impact, sans-serif`;
      p.textAlign = "center"; p.textBaseline = "middle";
      p.rotate((r() - 0.5) * 0.8);
      p.fillText("?", 0, 0);
      break;
    case "nota":
      p.beginPath(); p.ellipse(-s * 0.15, s * 0.3, s * 0.18, s * 0.13, -0.4, 0, Math.PI * 2); p.fill();
      p.lineWidth = Math.max(1, s * 0.07); p.beginPath(); p.moveTo(s * 0.02, s * 0.28); p.lineTo(s * 0.02, -s * 0.45); p.quadraticCurveTo(s * 0.3, -s * 0.3, s * 0.32, -s * 0.05); p.stroke();
      break;
    // Los de relleno (graffiti, mármol, terrazo, animal, splash, balón) se pintan aparte, sobre toda la superficie.
    default: break;
  }
}

/** Motivos que pintan toda la superficie (no por filas). */
const DE_RELLENO = new Set<MotivoPatron>(["graffiti", "marmol", "terrazo", "animal", "splash", "balon"]);

/** Relleno en el equirectangular (x = longitud, y = latitud), dando la vuelta al borde. */
function relleno(p: Pincel, c: CapaPatron, r: () => number) {
  const tintas = c.tintas.map((t) => t.hex);
  const tinta = (k: number) => tintas[k % tintas.length]!;
  const s = c.tamanoGrados * K;
  const repetidoX = (dibujar: (dx: number) => void) => { for (const dx of [-ANCHO, 0, ANCHO]) dibujar(dx); };
  switch (c.motivo) {
    case "graffiti": {
      // Brillo en bandas onduladas: muchos puntitos (el «graffiti» de Sempertex es escarchado en remolinos).
      const bandas = Math.max(3, Math.round(c.porVuelta / 2));
      for (let b = 0; b < bandas; b++) {
        const y0 = ALTO * (0.15 + (0.7 * b) / Math.max(1, bandas - 1)), fase = r() * Math.PI * 2, amp = ALTO * (0.05 + r() * 0.06);
        const grosor = s * (0.6 + r() * 0.6);
        for (let k = 0; k < 900; k++) {
          const x = r() * ANCHO, y = y0 + Math.sin((x / ANCHO) * Math.PI * 2 * 2 + fase) * amp + (r() - 0.5) * grosor;
          const lat = Math.abs(90 - (y / ALTO) * 180);
          if (lat > 80) continue;
          p.fillStyle = tinta(k);
          p.globalAlpha = 0.55 + r() * 0.45;
          const t = 1 + r() * 2.2;
          p.fillRect(x, y, t * (1 / Math.max(0.2, Math.cos((lat * Math.PI) / 180))), t);
        }
      }
      p.globalAlpha = 1;
      break;
    }
    case "marmol": {
      p.lineCap = "round";
      for (let k = 0; k < c.porVuelta * 2; k++) {
        p.strokeStyle = tinta(k);
        p.globalAlpha = 0.5 + r() * 0.4;
        p.lineWidth = s * (0.05 + r() * 0.12);
        let x = r() * ANCHO, y = ALTO * (0.15 + r() * 0.7);
        p.beginPath(); p.moveTo(x, y);
        for (let i = 0; i < 14; i++) { x += s * (0.4 + r() * 0.6); y += (r() - 0.5) * s * 0.8; p.lineTo(x, y); }
        p.stroke();
      }
      p.globalAlpha = 1;
      break;
    }
    case "terrazo":
    case "splash": {
      const n = c.porVuelta * 7;
      for (let k = 0; k < n; k++) {
        const x = r() * ANCHO, y = ALTO * (0.08 + r() * 0.84);
        const lat = 90 - (y / ALTO) * 180, estira = 1 / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
        const t = s * (0.25 + r() * 0.55);
        p.fillStyle = tinta(k);
        repetidoX((dx) => {
          p.save(); p.translate(x + dx, y); p.scale(estira, 1); p.rotate(r() * Math.PI);
          p.beginPath();
          const lados = c.motivo === "splash" ? 9 : 5;
          for (let i = 0; i < lados; i++) {
            const a = (i / lados) * Math.PI * 2, rr = (t / 2) * (c.motivo === "splash" ? (i % 2 ? 0.5 : 1) : 0.6 + r() * 0.4);
            if (i === 0) p.moveTo(rr * Math.cos(a), rr * Math.sin(a)); else p.lineTo(rr * Math.cos(a), rr * Math.sin(a));
          }
          p.closePath(); p.fill(); p.restore();
        });
      }
      break;
    }
    case "animal": {
      // Manchas de jirafa / leopardo: anillos irregulares.
      const n = c.porVuelta * 6;
      for (let k = 0; k < n; k++) {
        const x = r() * ANCHO, y = ALTO * (0.08 + r() * 0.84);
        const lat = 90 - (y / ALTO) * 180, estira = 1 / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
        const t = s * (0.35 + r() * 0.4);
        p.fillStyle = tinta(k);
        p.save(); p.translate(x, y); p.scale(estira, 1);
        p.beginPath();
        for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2, rr = (t / 2) * (0.7 + r() * 0.3); if (i === 0) p.moveTo(rr * Math.cos(a), rr * Math.sin(a)); else p.lineTo(rr * Math.cos(a), rr * Math.sin(a)); }
        p.closePath(); p.fill(); p.restore();
      }
      break;
    }
    default: break; // El balón se pinta píxel a píxel (ver `pintarBalon`).
  }
}

/** Los 12 vértices del icosaedro (centros de los pentágonos del balón). */
const ICOSAEDRO: ReadonlyArray<readonly [number, number, number]> = (() => {
  const f = (1 + Math.sqrt(5)) / 2;
  const v: Array<[number, number, number]> = [];
  for (const a of [-1, 1]) for (const b of [-f, f]) v.push([0, a, b], [a, b, 0], [b, 0, a]);
  return v.map(([x, y, z]) => { const n = Math.hypot(x, y, z); return [x / n, y / n, z / n] as const; });
})();

function pintarBalon(datos: Uint8ClampedArray, hex: string, tamanoGrados: number) {
  const color = new THREE.Color(hex);
  const R = (tamanoGrados * Math.PI) / 180 / 2;
  for (let y = 0; y < ALTO; y++) {
    const lat = Math.PI / 2 - (y / ALTO) * Math.PI;
    for (let x = 0; x < ANCHO; x++) {
      const lon = (x / ANCHO) * Math.PI * 2 - Math.PI;
      const d = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)] as const;
      let mejor = -2, v = ICOSAEDRO[0]!;
      for (const c of ICOSAEDRO) { const p = c[0] * d[0] + c[1] * d[1] + c[2] * d[2]; if (p > mejor) { mejor = p; v = c; } }
      const ang = Math.acos(Math.min(1, mejor));
      if (ang > R * 1.05) continue;
      // Pentágono en el plano tangente: radio según el ángulo alrededor del vértice.
      const ref = Math.abs(v[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const e1 = [ref[1]! * v[2] - ref[2]! * v[1], ref[2]! * v[0] - ref[0]! * v[2], ref[0]! * v[1] - ref[1]! * v[0]];
      const n1 = Math.hypot(e1[0]!, e1[1]!, e1[2]!);
      const u = [e1[0]! / n1, e1[1]! / n1, e1[2]! / n1];
      const w = [v[1] * u[2]! - v[2] * u[1]!, v[2] * u[0]! - v[0] * u[2]!, v[0] * u[1]! - v[1] * u[0]!];
      const th = Math.atan2(d[0] * w[0]! + d[1] * w[1]! + d[2] * w[2]!, d[0] * u[0]! + d[1] * u[1]! + d[2] * u[2]!);
      const sector = (2 * Math.PI) / 5;
      const m = ((th % sector) + sector) % sector - sector / 2;
      if (ang > (R * Math.cos(Math.PI / 5)) / Math.cos(m)) continue;
      const i = (y * ANCHO + x) * 4;
      datos[i] = Math.round(color.r * 255); datos[i + 1] = Math.round(color.g * 255); datos[i + 2] = Math.round(color.b * 255); datos[i + 3] = 255;
    }
  }
}

/** Patrón por filas de latitud: menos motivos cerca de los polos, cada uno ensanchado para que en el globo se vea redondo. */
function patronPorFilas(p: Pincel, c: CapaPatron) {
  const r = azar(c.semilla ?? 7);
  const s = c.tamanoGrados * K;
  const paso = Math.max(c.tamanoGrados * 1.25, 360 / c.porVuelta * 0.85);
  let fila = 0;
  for (let lat = -62; lat <= 78; lat += paso, fila++) {
    const cos = Math.cos((lat * Math.PI) / 180);
    const n = Math.max(1, Math.round(c.porVuelta * cos));
    const y = (90 - lat) / 180 * ALTO;
    for (let i = 0; i < n; i++) {
      const lon = ((i + (fila % 2) * 0.5 + (r() - 0.5) * 0.35) / n) * 360;
      const x = (lon / 360) * ANCHO;
      const tinta = c.tintas[(i + fila) % c.tintas.length]!.hex;
      const giro = c.motivo === "corazon" || c.motivo === "estrella" || c.motivo === "bigote" ? (r() - 0.5) * 0.7 : 0;
      const escala = 0.75 + r() * 0.5;
      for (const dx of [-ANCHO, 0, ANCHO]) {
        p.save();
        p.translate(x + dx, y + (r() - 0.5) * s * 0.3);
        p.scale(1 / Math.max(0.2, cos), 1);
        p.rotate(giro);
        motivo(p, c.motivo, s * escala, tinta, azar(i * 31 + fila * 7 + 1));
        p.restore();
      }
    }
  }
}

// ----------------------------------------------------------------------------------------------------------
// Lo de frente: texto, cara, ícono (en un lienzo «visto de frente», k px por grado)
// ----------------------------------------------------------------------------------------------------------

const FUENTE: Readonly<Record<CapaTexto["letra"], (px: number) => string>> = {
  redonda: (px) => `bold ${px}px "Arial Rounded MT Bold", "Nunito", "Segoe UI", system-ui, sans-serif`,
  manuscrita: (px) => `italic bold ${px}px "Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive`,
  bloque: (px) => `900 ${px}px "Arial Black", Impact, "Segoe UI Black", sans-serif`,
};

function texto(p: Pincel, c: CapaTexto, cx: number, cy: number, k: number, limiteGrados = 170) {
  const lineas = c.texto.split("\n");
  let px = Math.round(c.altoGrados * k * 1.9);
  const anchoMax = Math.min(c.anchoMaxGrados ?? 125, limiteGrados) * k;
  p.font = FUENTE[c.letra](px);
  const mayor = Math.max(...lineas.map((l) => p.measureText(l).width));
  if (mayor > anchoMax) { px = Math.max(6, Math.floor((px * anchoMax) / mayor)); p.font = FUENTE[c.letra](px); }
  p.textAlign = "center"; p.textBaseline = "middle";
  p.lineJoin = "round";
  const alto = px * 1.05;
  const y0 = cy - (c.dyGrados ?? 0) * k - ((lineas.length - 1) * alto) / 2;
  const arco = ((c.arcoGrados ?? 0) * Math.PI) / 180;
  const pintar = (t: string, x: number, y: number) => {
    if (c.borde) { p.strokeStyle = c.borde.hex; p.lineWidth = Math.max(2, px * 0.18); p.strokeText(t, x, y); }
    p.fillStyle = c.tinta.hex; p.fillText(t, x, y);
  };
  lineas.forEach((l, i) => {
    const y = y0 + i * alto;
    if (Math.abs(arco) < 1e-3) { pintar(l, cx, y); return; }
    // Renglón curvo: cada letra sobre un arco (arco > 0: arco iris, el centro más alto que las puntas).
    const ancho = p.measureText(l).width;
    const R = ancho / Math.abs(arco), signo = Math.sign(arco);
    let s = -ancho / 2;
    for (const ch of l) {
      const w = p.measureText(ch).width, th = (s + w / 2) / R;
      p.save();
      p.translate(cx + R * Math.sin(th), y + signo * R * (1 - Math.cos(th)));
      p.rotate(signo * th);
      pintar(ch, 0, 0);
      p.restore();
      s += w;
    }
  });
}

function cara(p: Pincel, c: CapaCara, cx: number, cy0: number, k: number) {
  const w = (c.anchoGrados ?? 80) * k;
  const cy = cy0 - (c.dyGrados ?? 0) * k;
  const tinta = c.tinta.hex;
  p.fillStyle = tinta; p.strokeStyle = tinta; p.lineCap = "round"; p.lineJoin = "round";
  p.lineWidth = Math.max(2, w * 0.05);
  const ojoY = cy - w * 0.12, ojoX = w * 0.2, ro = w * 0.075;
  const ojo = (x: number) => { p.beginPath(); p.ellipse(x, ojoY, ro * 0.8, ro * 1.1, 0, 0, Math.PI * 2); p.fill(); };
  const ojoCerrado = (x: number, arriba: boolean) => { p.beginPath(); p.arc(x, ojoY + (arriba ? ro * 0.4 : -ro * 0.4), ro, arriba ? Math.PI * 1.1 : Math.PI * 0.1, arriba ? Math.PI * 1.9 : Math.PI * 0.9); p.stroke(); };
  const sonrisa = (ancho: number, curva: number) => { p.beginPath(); p.moveTo(cx - ancho, cy + w * 0.12); p.quadraticCurveTo(cx, cy + w * 0.12 + curva, cx + ancho, cy + w * 0.12); p.stroke(); };
  if (c.mejillas) { p.save(); p.fillStyle = c.mejillas.hex; p.globalAlpha = 0.75; for (const s of [-1, 1]) { p.beginPath(); p.ellipse(cx + s * w * 0.33, cy + w * 0.06, w * 0.08, w * 0.05, 0, 0, Math.PI * 2); p.fill(); } p.restore(); }
  switch (c.expresion) {
    case "feliz": ojo(cx - ojoX); ojo(cx + ojoX); sonrisa(w * 0.22, w * 0.18); break;
    case "risa": {
      ojoCerrado(cx - ojoX, true); ojoCerrado(cx + ojoX, true);
      p.beginPath(); p.moveTo(cx - w * 0.24, cy + w * 0.08); p.quadraticCurveTo(cx, cy + w * 0.42, cx + w * 0.24, cy + w * 0.08); p.closePath(); p.fill();
      break;
    }
    case "guino": ojo(cx - ojoX); ojoCerrado(cx + ojoX, true); sonrisa(w * 0.22, w * 0.16); break;
    case "sorpresa": for (const s of [-1, 1]) { p.beginPath(); p.arc(cx + s * ojoX, ojoY, ro * 1.1, 0, Math.PI * 2); p.fill(); } p.beginPath(); p.ellipse(cx, cy + w * 0.18, w * 0.08, w * 0.1, 0, 0, Math.PI * 2); p.fill(); break;
    case "enamorado": {
      p.save(); p.fillStyle = "#e0263c";
      for (const s of [-1, 1]) { p.save(); p.translate(cx + s * ojoX, ojoY); corazonCamino(p, ro * 2.6); p.fill(); p.restore(); }
      p.restore(); sonrisa(w * 0.2, w * 0.16); break;
    }
    case "bravo":
      ojo(cx - ojoX); ojo(cx + ojoX);
      for (const s of [-1, 1]) { p.beginPath(); p.moveTo(cx + s * w * 0.3, ojoY - ro * 2.2); p.lineTo(cx + s * w * 0.1, ojoY - ro * 1.2); p.stroke(); }
      sonrisa(w * 0.16, -w * 0.1); break;
    case "triste": ojo(cx - ojoX); ojo(cx + ojoX); sonrisa(w * 0.16, -w * 0.12); break;
    case "dormido": ojoCerrado(cx - ojoX, false); ojoCerrado(cx + ojoX, false); p.beginPath(); p.arc(cx, cy + w * 0.17, w * 0.04, 0, Math.PI * 2); p.stroke(); break;
    case "lengua":
      ojo(cx - ojoX); ojo(cx + ojoX); sonrisa(w * 0.22, w * 0.14);
      p.save(); p.fillStyle = "#e5607a"; p.beginPath(); p.ellipse(cx + w * 0.05, cy + w * 0.22, w * 0.07, w * 0.09, 0, 0, Math.PI * 2); p.fill(); p.restore();
      break;
    case "monstruo": {
      // Un ojo grande (contorno y pupila) y una boca ancha con dos colmillos calados (los «monstruos» de la tienda).
      p.beginPath(); p.arc(cx, ojoY - w * 0.04, w * 0.17, 0, Math.PI * 2); p.stroke();
      p.beginPath(); p.arc(cx + w * 0.03, ojoY - w * 0.03, w * 0.07, 0, Math.PI * 2); p.fill();
      p.beginPath(); p.moveTo(cx - w * 0.3, cy + w * 0.14); p.quadraticCurveTo(cx, cy + w * 0.45, cx + w * 0.3, cy + w * 0.14); p.closePath(); p.fill();
      p.save(); p.globalCompositeOperation = "destination-out";
      for (const s of [-1, 1]) { p.beginPath(); p.moveTo(cx + s * w * 0.17, cy + w * 0.17); p.lineTo(cx + s * w * 0.08, cy + w * 0.17); p.lineTo(cx + s * w * 0.125, cy + w * 0.27); p.closePath(); p.fill(); }
      p.restore();
      break;
    }
  }
}

function icono(p: Pincel, c: CapaIcono, cx0: number, cy0: number, k: number) {
  const s = (c.tamanoGrados ?? 50) * k;
  const cx = cx0 + (c.dxGrados ?? 0) * k, cy = cy0 - (c.dyGrados ?? 0) * k;
  const t2 = c.tinta2?.hex ?? "#ffffff";
  p.save();
  p.translate(cx, cy);
  p.fillStyle = c.tinta.hex; p.strokeStyle = c.tinta.hex; p.lineCap = "round"; p.lineJoin = "round"; p.lineWidth = Math.max(2, s * 0.06);
  switch (c.icono) {
    case "corazon": corazonCamino(p, s); p.fill(); break;
    case "estrella": estrellaCamino(p, s); p.fill(); break;
    case "diamante": diamanteCamino(p, s); p.fill(); break;
    case "paloma": palomaCamino(p, s); p.fill(); break;
    case "bigote": bigoteCamino(p, s); p.fill(); break;
    case "corbatin": corbatinCamino(p, s); p.fill(); break;
    case "mariposa": mariposaCamino(p, s); p.fill(); break;
    case "flor": florCamino(p, s); p.fill(); p.fillStyle = t2; p.beginPath(); p.arc(0, 0, s * 0.14, 0, Math.PI * 2); p.fill(); break;
    case "interrogacion": p.font = `900 ${Math.round(s)}px "Arial Black", Impact, sans-serif`; p.textAlign = "center"; p.textBaseline = "middle"; p.fillText("?", 0, 0); break;
    case "balon":
      p.beginPath(); p.arc(0, 0, s / 2, 0, Math.PI * 2); p.stroke();
      estrellaCamino(p, s * 0.36, 5, 0.81); p.fill();
      break;
    case "birrete":
      p.beginPath(); p.moveTo(-s / 2, -s * 0.05); p.lineTo(0, -s * 0.3); p.lineTo(s / 2, -s * 0.05); p.lineTo(0, s * 0.2); p.closePath(); p.fill();
      p.fillRect(-s * 0.25, s * 0.05, s * 0.5, s * 0.22);
      p.beginPath(); p.moveTo(s * 0.35, 0); p.lineTo(s * 0.38, s * 0.35); p.stroke();
      break;
    case "corona":
      p.beginPath(); p.moveTo(-s / 2, s * 0.3); p.lineTo(-s / 2, -s * 0.25); p.lineTo(-s / 4, s * 0.02); p.lineTo(0, -s * 0.35); p.lineTo(s / 4, s * 0.02); p.lineTo(s / 2, -s * 0.25); p.lineTo(s / 2, s * 0.3); p.closePath(); p.fill();
      break;
    case "arbol":
      p.beginPath(); p.moveTo(0, -s / 2); p.lineTo(s * 0.35, s * 0.25); p.lineTo(-s * 0.35, s * 0.25); p.closePath(); p.fill();
      p.fillStyle = t2; p.fillRect(-s * 0.06, s * 0.25, s * 0.12, s * 0.2);
      break;
    case "calabaza":
      p.beginPath(); p.ellipse(0, s * 0.05, s * 0.45, s * 0.36, 0, 0, Math.PI * 2); p.fill();
      p.fillStyle = t2; p.fillRect(-s * 0.05, -s * 0.42, s * 0.1, s * 0.14);
      break;
    case "copa":
      p.beginPath(); p.moveTo(-s * 0.25, -s * 0.45); p.lineTo(s * 0.25, -s * 0.45); p.lineTo(s * 0.05, -s * 0.05); p.lineTo(s * 0.05, s * 0.35); p.lineTo(s * 0.2, s * 0.45); p.lineTo(-s * 0.2, s * 0.45); p.lineTo(-s * 0.05, s * 0.35); p.lineTo(-s * 0.05, -s * 0.05); p.closePath(); p.fill();
      break;
    case "regalo":
      p.fillRect(-s * 0.4, -s * 0.15, s * 0.8, s * 0.6);
      p.fillStyle = t2; p.fillRect(-s * 0.06, -s * 0.15, s * 0.12, s * 0.6); p.fillRect(-s * 0.4, s * 0.05, s * 0.8, s * 0.1);
      p.beginPath(); p.ellipse(-s * 0.12, -s * 0.25, s * 0.12, s * 0.07, 0.4, 0, Math.PI * 2); p.ellipse(s * 0.12, -s * 0.25, s * 0.12, s * 0.07, -0.4, 0, Math.PI * 2); p.fill();
      break;
    case "pastel":
      p.fillRect(-s * 0.4, -s * 0.05, s * 0.8, s * 0.45);
      p.fillStyle = t2; p.fillRect(-s * 0.4, s * 0.1, s * 0.8, s * 0.07);
      p.fillStyle = c.tinta.hex; p.fillRect(-s * 0.03, -s * 0.35, s * 0.06, s * 0.28);
      break;
    case "sombrero":
      p.beginPath(); p.moveTo(-s * 0.3, s * 0.4); p.lineTo(0, -s * 0.45); p.lineTo(s * 0.3, s * 0.4); p.closePath(); p.fill();
      break;
    case "biberon":
      p.fillRect(-s * 0.16, -s * 0.15, s * 0.32, s * 0.6);
      p.beginPath(); p.ellipse(0, -s * 0.3, s * 0.1, s * 0.15, 0, 0, Math.PI * 2); p.fill();
      break;
  }
  p.restore();
}

function frente(p: Pincel, capas: readonly CapaImpreso[], cx: number, cy: number, k: number, limiteGrados = 170) {
  for (const c of capas) {
    if (c.tipo === "texto") texto(p, c, cx, cy, k, limiteGrados);
    else if (c.tipo === "cara") cara(p, c, cx, cy, k);
    else if (c.tipo === "icono") icono(p, c, cx, cy, k);
  }
}

// ----------------------------------------------------------------------------------------------------------
// Texturas (guardadas por clave)
// ----------------------------------------------------------------------------------------------------------

const TEXTURAS = new Map<string, THREE.CanvasTexture>();

function guardar(clave: string, c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  TEXTURAS.set(clave, t);
  if (TEXTURAS.size > 60) { const primera = TEXTURAS.keys().next().value; if (primera !== undefined) TEXTURAS.delete(primera); }
  return t;
}

/** La textura equirectangular de un impreso para un globo redondo (fondo transparente: solo la tinta). */
function texturaGlobo(i: ImpresoGlobo): THREE.CanvasTexture | null {
  const clave = `globo|${claveImpreso(i)}`;
  const guardada = TEXTURAS.get(clave);
  if (guardada) return guardada;
  const base = lienzo(ANCHO, ALTO);
  if (!base) return null;
  const { c, p } = base;
  // 1. Patrones (por filas o de relleno).
  for (const capa of i.capas) {
    if (capa.tipo !== "patron") continue;
    if (DE_RELLENO.has(capa.motivo)) relleno(p, capa, azar(capa.semilla ?? 11));
    else patronPorFilas(p, capa);
  }
  const imagen = p.getImageData(0, 0, ANCHO, ALTO);
  const datos = imagen.data;
  for (const capa of i.capas) if (capa.tipo === "patron" && capa.motivo === "balon") pintarBalon(datos, capa.tintas[0]?.hex ?? "#111111", capa.tamanoGrados);
  // 2. Lo de frente, dibujado visto de frente y reproyectado sobre la esfera en cada repetición.
  const deFrente = i.capas.filter((x) => x.tipo !== "patron");
  if (deFrente.length) {
    const f = lienzo(FRENTE, FRENTE);
    if (f) {
      // Con 3 repeticiones cada una tiene 120° de vuelta: el renglón no puede pasar de ~110°.
      frente(f.p, deFrente, FRENTE / 2, FRENTE / 2, K, (360 / i.repetir) - 10);
      const src = f.p.getImageData(0, 0, FRENTE, FRENTE).data;
      const corte = Math.min(88, 180 / i.repetir) * (Math.PI / 180);
      const muestra = (u: number, v: number, canal: number) => {
        const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
        const at = (x: number, y: number) => (x < 0 || y < 0 || x >= FRENTE || y >= FRENTE ? 0 : src[(y * FRENTE + x) * 4 + canal]!);
        return at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
      };
      for (let y = 0; y < ALTO; y++) {
        const lat = Math.PI / 2 - ((y + 0.5) / ALTO) * Math.PI;
        const cl = Math.cos(lat), sl = Math.sin(lat);
        for (let x = 0; x < ANCHO; x++) {
          const lon0 = ((x + 0.5) / ANCHO) * Math.PI * 2 - Math.PI;
          for (let k = 0; k < i.repetir; k++) {
            const lon = lon0 - (k * 2 * Math.PI) / i.repetir;
            const dx = cl * Math.sin(lon), dz = cl * Math.cos(lon);
            const ang = Math.acos(Math.max(-1, Math.min(1, dz)));
            if (ang > corte) continue;
            const sa = Math.sin(ang) || 1;
            const radio = ((ang * 180) / Math.PI) * K;
            const u = FRENTE / 2 + (radio * dx) / sa, v = FRENTE / 2 - (radio * sl) / sa;
            const a = muestra(u, v, 3) / 255;
            if (a < 0.02) continue;
            const j = (y * ANCHO + x) * 4, da = datos[j + 3]! / 255;
            const sale = a + da * (1 - a);
            for (let canal = 0; canal < 3; canal++) datos[j + canal] = Math.round((muestra(u, v, canal) * a + datos[j + canal]! * da * (1 - a)) / Math.max(1e-6, sale));
            datos[j + 3] = Math.round(sale * 255);
          }
        }
      }
    }
  }
  p.putImageData(imagen, 0, 0);
  return guardar(clave, c);
}

/** La textura plana de un impreso para la cara de un corazón (de lado `FRENTE`, el corazón de lado a lado). */
function texturaCorazon(i: ImpresoGlobo): THREE.CanvasTexture | null {
  const clave = `corazon|${claveImpreso(i)}`;
  const guardada = TEXTURAS.get(clave);
  if (guardada) return guardada;
  const base = lienzo(FRENTE, FRENTE);
  if (!base) return null;
  const { c, p } = base;
  // Un corazón C-12 de ~28 cm: se toma como un globo de su ancho (1° ≈ π·ancho/360), así el impreso queda a escala.
  const k = (FRENTE * Math.PI) / 360;
  for (const capa of i.capas) {
    if (capa.tipo !== "patron" || DE_RELLENO.has(capa.motivo)) continue;
    const r = azar(capa.semilla ?? 7), s = capa.tamanoGrados * k, paso = (FRENTE / Math.max(2, capa.porVuelta / 2)) * 0.9;
    let fila = 0;
    for (let y = paso / 2; y < FRENTE; y += paso, fila++) for (let x = (fila % 2) * paso / 2; x < FRENTE + paso; x += paso) {
      p.save(); p.translate(x + (r() - 0.5) * paso * 0.3, y + (r() - 0.5) * paso * 0.3); p.rotate((r() - 0.5) * 0.6);
      motivo(p, capa.motivo, s * (0.8 + r() * 0.4), capa.tintas[(fila + Math.round(x)) % capa.tintas.length]!.hex, azar(fila * 13 + Math.round(x)));
      p.restore();
    }
  }
  frente(p, i.capas.filter((x) => x.tipo !== "patron"), FRENTE / 2, FRENTE * 0.47, k);
  return guardar(clave, c);
}

// ----------------------------------------------------------------------------------------------------------
// Mallas del impreso
// ----------------------------------------------------------------------------------------------------------

function materialTinta(mapa: THREE.Texture, metalica: boolean, entorno: THREE.Texture | null): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: mapa, transparent: false, alphaTest: 0.45, roughness: metalica ? 0.25 : 0.5, metalness: metalica ? 0.85 : 0,
    clearcoat: 0.35, clearcoatRoughness: 0.4, envMap: metalica ? entorno : null, envMapIntensity: 1.1,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

const esMetalica = (i: ImpresoGlobo) => i.capas.some((c) => (c.tipo === "patron" ? c.tintas.some((t) => t.metalica) : c.tinta.metalica));

/**
 * La cáscara impresa de un globo redondo, en el marco del globo (Y = eje, Z = frente): el perfil torneado un pelo más
 * ancho, con u = longitud y v = latitud medidas desde el centro del cuerpo (`centroYCm`). Girada media vuelta para
 * que el centro de la textura quede hacia +Z.
 */
export function cascaraImpresa(perfil: readonly PuntoPerfil[], centroYCm: number, i: ImpresoGlobo, entorno: THREE.Texture | null): THREE.Mesh | null {
  const mapa = texturaGlobo(i);
  if (!mapa) return null;
  const pelo = 1.004;
  const geometria = new THREE.LatheGeometry(perfil.map((q) => new THREE.Vector2(q.r * CM * pelo + 0.0002, q.y * CM)), 72);
  const pos = geometria.attributes.position!, uv = geometria.attributes.uv!;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
    const lat = Math.atan2(y - centroYCm * CM, Math.hypot(x, z));
    uv.setY(k, 0.5 + lat / Math.PI);
  }
  uv.needsUpdate = true;
  const malla = new THREE.Mesh(geometria, materialTinta(mapa, esMetalica(i), entorno));
  malla.rotation.y = Math.PI;
  return malla;
}

/**
 * La calcomanía impresa de un corazón (C-12) en sus dos caras: la silueta del corazón algo más chica, pegada a la cara
 * plana de la malla del corazón (`malla`, la que arma el visor) un pelo por fuera.
 */
export function calcoCorazon(malla: THREE.Mesh, anchoCm: number, i: ImpresoGlobo, entorno: THREE.Texture | null): THREE.Object3D | null {
  const mapa = texturaCorazon(i);
  if (!mapa) return null;
  malla.geometry.computeBoundingBox();
  const caja = malla.geometry.boundingBox;
  if (!caja) return null;
  const contorno = contornoCorazon(anchoCm * CM);
  const xs = contorno.map((q) => q.x), ys = contorno.map((q) => q.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const escala = 0.9;
  const forma = new THREE.Shape(contorno.map((q) => new THREE.Vector2((q.x - cx) * escala, (q.y - cy) * escala)));
  const geometria = new THREE.ShapeGeometry(forma, 24);
  // uv de la caja del corazón (la textura es cuadrada: el corazón de lado a lado).
  const lado = anchoCm * CM * escala;
  const pos = geometria.attributes.position!, uv = geometria.attributes.uv!;
  for (let k = 0; k < pos.count; k++) uv.setXY(k, 0.5 + pos.getX(k) / lado, 0.5 + pos.getY(k) / lado);
  const material = materialTinta(mapa, esMetalica(i), entorno);
  const grupo = new THREE.Group();
  const delante = new THREE.Mesh(geometria, material);
  delante.position.z = caja.max.z + 0.0004;
  grupo.add(delante);
  if (i.repetir > 1) {
    const detras = new THREE.Mesh(geometria.clone(), material.clone());
    detras.rotation.y = Math.PI;
    detras.position.z = caja.min.z - 0.0004;
    grupo.add(detras);
  }
  return grupo;
}

// ----------------------------------------------------------------------------------------------------------
// Metalizados: el contorno inflado como almohada
// ----------------------------------------------------------------------------------------------------------

const cacheFoil = new Map<string, { posiciones: Float32Array; indices: Uint32Array }>();

function distSeg(x: number, y: number, a: Punto2, b: Punto2): number {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const t = l < 1e-12 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l));
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
}

function dentro(x: number, y: number, poli: readonly Punto2[]): boolean {
  let d = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const a = poli[i]!, b = poli[j]!;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) d = !d;
  }
  return d;
}

/**
 * La geometría de un globo metalizado (m), con el contorno en el plano XY (cm) y el grosor de z = 0 a z = `grosorCm`:
 * cada cara sube desde el borde con un canto redondo (cuarto de círculo) hasta una meseta casi plana, y cerca del borde
 * lleva arrugas suaves (el foil no se estira como el látex). Malla de cuadrados que marchan sobre la distancia al borde.
 */
export function geometriaFoil(contorno: readonly Punto2[], huecos: readonly (readonly Punto2[])[], grosorCm: number): THREE.BufferGeometry {
  const clave = `${grosorCm}|${JSON.stringify(contorno)}|${JSON.stringify(huecos)}`;
  let datos = cacheFoil.get(clave);
  if (!datos) {
    const lazos = [contorno, ...huecos];
    const xs = contorno.map((q) => q.x), ys = contorno.map((q) => q.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const h = Math.max(maxX - minX, maxY - minY) / 96;
    const x0 = minX - h * 1.5, y0 = minY - h * 1.5;
    const nx = Math.ceil((maxX - minX) / h) + 4, ny = Math.ceil((maxY - minY) / h) + 4;
    const campo = new Float64Array(nx * ny);
    let maxD = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * h, y = y0 + j * h;
      let d = Infinity;
      for (const l of lazos) for (let k = 0; k < l.length; k++) d = Math.min(d, distSeg(x, y, l[k]!, l[(k + 1) % l.length]!));
      const adentro = dentro(x, y, contorno) && !huecos.some((hh) => dentro(x, y, hh));
      const v = adentro ? Math.max(d, 1e-6) : -Math.max(d, 1e-6);
      campo[j * nx + i] = v;
      if (v > maxD) maxD = v;
    }
    const H = grosorCm / 2;
    const R = Math.max(0.5, Math.min(maxD * 0.92, H * 1.35));
    const alto = (x: number, y: number, d: number): number => {
      if (d <= 0) return 0;
      const s = Math.min(1, d / R);
      const domo = 0.9 + 0.1 * Math.min(1, d / Math.max(maxD, 1e-6));
      const arruga = Math.sin(Math.PI * s) * (Math.sin(0.62 * x + 1.4 * Math.sin(0.37 * y)) * Math.cos(0.55 * y - 0.21 * x)) * 0.16;
      return H * (Math.sqrt(1 - (1 - s) * (1 - s)) * domo + arruga * (1 - s * 0.5));
    };
    const vertices: number[] = [];
    const indice = new Map<string, number>();
    const vertice = (clave2: string, x: number, y: number, d: number): number => {
      let k = indice.get(clave2);
      if (k === undefined) { k = vertices.length / 3; vertices.push(x, y, alto(x, y, d)); indice.set(clave2, k); }
      return k;
    };
    const valor = (i: number, j: number) => campo[j * nx + i]!;
    const esquina = (i: number, j: number) => vertice(`c${i},${j}`, x0 + i * h, y0 + j * h, valor(i, j));
    const corte = (tipo: "h" | "v", i: number, j: number) => {
      const [a, b] = tipo === "h" ? [valor(i, j), valor(i + 1, j)] : [valor(i, j), valor(i, j + 1)];
      const t = a / (a - b);
      return tipo === "h" ? vertice(`h${i},${j}`, x0 + (i + t) * h, y0 + j * h, 0) : vertice(`v${i},${j}`, x0 + i * h, y0 + (j + t) * h, 0);
    };
    const caras: number[] = [];
    const poligono = (p: number[]) => { for (let k = 1; k + 1 < p.length; k++) caras.push(p[0]!, p[k]!, p[k + 1]!); };
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const d = [valor(i, j) > 0, valor(i + 1, j) > 0, valor(i + 1, j + 1) > 0, valor(i, j + 1) > 0];
      if (!d.some(Boolean)) continue;
      if (d.every(Boolean)) { poligono([esquina(i, j), esquina(i + 1, j), esquina(i + 1, j + 1), esquina(i, j + 1)]); continue; }
      const silla = d[0] === d[2] && d[1] === d[3] && d[0] !== d[1];
      const centro = (valor(i, j) + valor(i + 1, j) + valor(i + 1, j + 1) + valor(i, j + 1)) / 4 > 0;
      if (silla && !centro) {
        if (d[0]) { poligono([esquina(i, j), corte("h", i, j), corte("v", i, j)]); poligono([esquina(i + 1, j + 1), corte("h", i, j + 1), corte("v", i + 1, j)]); }
        else { poligono([esquina(i + 1, j), corte("v", i + 1, j), corte("h", i, j)]); poligono([esquina(i, j + 1), corte("v", i, j), corte("h", i, j + 1)]); }
        continue;
      }
      // Recorrido antihorario de la celda: esquina, arista, esquina…
      const p: number[] = [];
      const pasos: Array<[boolean, () => number, boolean, () => number]> = [
        [d[0]!, () => esquina(i, j), d[0] !== d[1], () => corte("h", i, j)],
        [d[1]!, () => esquina(i + 1, j), d[1] !== d[2], () => corte("v", i + 1, j)],
        [d[2]!, () => esquina(i + 1, j + 1), d[2] !== d[3], () => corte("h", i, j + 1)],
        [d[3]!, () => esquina(i, j + 1), d[3] !== d[0], () => corte("v", i, j)],
      ];
      for (const [conEsquina, e, conCorte, c] of pasos) { if (conEsquina) p.push(e()); if (conCorte) p.push(c()); }
      poligono(p);
    }
    // Cara de delante (z = mitad + alto) y de atrás (z = mitad − alto, caras al revés).
    const n = vertices.length / 3;
    const posiciones = new Float32Array(n * 6);
    for (let k = 0; k < n; k++) {
      const x = vertices[k * 3]! * CM, y = vertices[k * 3 + 1]! * CM, a = vertices[k * 3 + 2]! * CM, m = H * CM;
      posiciones.set([x, y, m + a], k * 3);
      posiciones.set([x, y, m - a * 0.92], (n + k) * 3);
    }
    const indices = new Uint32Array(caras.length * 2);
    indices.set(caras, 0);
    for (let k = 0; k < caras.length; k += 3) { indices[caras.length + k] = caras[k]! + n; indices[caras.length + k + 1] = caras[k + 2]! + n; indices[caras.length + k + 2] = caras[k + 1]! + n; }
    datos = { posiciones, indices };
    cacheFoil.set(clave, datos);
    if (cacheFoil.size > 80) { const primera = cacheFoil.keys().next().value; if (primera !== undefined) cacheFoil.delete(primera); }
  }
  const geometria = new THREE.BufferGeometry();
  geometria.setAttribute("position", new THREE.BufferAttribute(datos.posiciones, 3));
  geometria.setIndex(new THREE.BufferAttribute(datos.indices, 1));
  geometria.computeVertexNormals();
  return geometria;
}

/** El material del foil: espejo (`foil`) o satinado (`foil_mate`), con su propio entorno para que brille. */
export function materialFoil(hex: string, mate: boolean, entorno: THREE.Texture | null): THREE.MeshPhysicalMaterial {
  const color = new THREE.Color(hex);
  const oscuro = color.r + color.g + color.b < 0.4;
  return mate
    ? new THREE.MeshPhysicalMaterial({ color, metalness: oscuro ? 0.35 : 0.7, roughness: oscuro ? 0.5 : 0.36, clearcoat: 0.4, clearcoatRoughness: 0.35, envMap: entorno, envMapIntensity: 1, side: THREE.DoubleSide })
    : new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: 0.16, clearcoat: 0.8, clearcoatRoughness: 0.08, envMap: entorno, envMapIntensity: 1.3, side: THREE.DoubleSide });
}
