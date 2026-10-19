import type { MesaGuardada } from "./mobiliario-conjunto-tipos";
import type { Punto2 } from "./trenza";

/**
 * El **contorno de la tapa** de cada tipo de mesa visto desde arriba, en el marco de la mesa: `x` a lo ancho y `y` = z de la
 * mesa (+ hacia el frente). Un polígono cerrado y antihorario (se mira con x a la derecha, y arriba), centrado en su caja.
 * De él salen la tapa y el faldón, los puestos de las sillas (por su perímetro real) y la superficie donde se apoya lo de encima.
 */

export type Contorno = {
  puntos: Punto2[];
  /** Aristas (la i va de `puntos[i]` a `puntos[i+1]`) donde no se sienta nadie: el lado plano de una media luna. */
  traseras: ReadonlySet<number>;
};

const PASOS_CURVA = 72;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Área con signo del polígono (positiva si es antihorario). */
export function areaFirmada(p: readonly Punto2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]!; a += p[i]!.x * q.y - q.x * p[i]!.y; }
  return a / 2;
}

/** Centro de la caja del contorno y lo lleva al origen. */
function centrado(puntos: Punto2[]): Punto2[] {
  const xs = puntos.map((p) => p.x), ys = puntos.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return puntos.map((p) => ({ x: r1(p.x - cx), y: r1(p.y - cy) }));
}

/** Elipse de semiejes `a` (x) y `b` (y), que arranca en el frente (+y) para que repartir sillas arranque simétrico. */
export function elipse(a: number, b: number, pasos = PASOS_CURVA): Punto2[] {
  return Array.from({ length: pasos }, (_, i) => { const t = Math.PI / 2 + (i / pasos) * Math.PI * 2; return { x: r1(Math.cos(t) * a), y: r1(Math.sin(t) * b) }; });
}

const rectangulo = (w: number, d: number): Punto2[] => [{ x: -w / 2, y: -d / 2 }, { x: w / 2, y: -d / 2 }, { x: w / 2, y: d / 2 }, { x: -w / 2, y: d / 2 }];

/** Media luna: medio círculo de diámetro `diametro` con la curva al frente (+y) y el lado plano atrás. */
function mediaLuna(diametro: number): Contorno {
  const r = diametro / 2;
  const arco = Array.from({ length: PASOS_CURVA / 2 + 1 }, (_, i) => { const t = (i / (PASOS_CURVA / 2)) * Math.PI; return { x: Math.cos(t) * r, y: Math.sin(t) * r }; });
  const puntos = centrado(arco);
  // El plano es la arista que cierra el polígono (del último punto al primero).
  return { puntos, traseras: new Set([puntos.length - 1]) };
}

/** Serpentina: una banda de ancho `ancho` con la línea del centro en S (dos arcos de 25° que giran al revés) y `largo` de recorrido. */
function serpentina(largo: number, ancho: number): Punto2[] {
  const giro = (25 * Math.PI) / 180, radio = largo / (2 * giro), pasos = 24;
  const centro: Array<{ x: number; y: number; rumbo: number }> = [{ x: 0, y: 0, rumbo: 0 }];
  let { x, y, rumbo } = centro[0]!;
  const ds = (radio * giro) / pasos;
  for (let tramo = 0; tramo < 2; tramo++) {
    for (let i = 0; i < pasos; i++) {
      rumbo += (tramo === 0 ? 1 : -1) * (giro / pasos);
      x += Math.cos(rumbo) * ds; y += Math.sin(rumbo) * ds;
      centro.push({ x, y, rumbo });
    }
  }
  const lado = (c: { x: number; y: number; rumbo: number }, k: number): Punto2 => ({ x: c.x - Math.sin(c.rumbo) * k, y: c.y + Math.cos(c.rumbo) * k });
  // Antihorario: el borde de abajo hacia delante y el de arriba de vuelta.
  return centrado([...centro.map((c) => lado(c, -ancho / 2)), ...[...centro].reverse().map((c) => lado(c, ancho / 2))]);
}

/** Banquete en U: tres mesas juntas, la base atrás y los dos brazos hacia el frente; el grosor de cada una es el de una mesa de banquete (hasta 70 cm). */
function enU(w: number, d: number): Punto2[] {
  const t = Math.min(70, w / 4, d / 3);
  return [
    { x: -w / 2, y: -d / 2 }, { x: w / 2, y: -d / 2 }, { x: w / 2, y: d / 2 }, { x: w / 2 - t, y: d / 2 },
    { x: w / 2 - t, y: -d / 2 + t }, { x: -w / 2 + t, y: -d / 2 + t }, { x: -w / 2 + t, y: d / 2 }, { x: -w / 2, y: d / 2 },
  ];
}

/** El contorno de la tapa de una mesa (antihorario, centrado en su caja). */
export function contornoDeMesa(m: MesaGuardada): Contorno {
  const sin = (puntos: Punto2[]): Contorno => ({ puntos, traseras: new Set() });
  switch (m.tipo) {
    case "redonda": case "coctel": return sin(elipse(m.anchoCm / 2, m.anchoCm / 2));
    case "ovalada": return sin(elipse(m.anchoCm / 2, m.fondoCm / 2));
    case "cuadrada": return sin(rectangulo(m.anchoCm, m.anchoCm));
    case "rectangular": return sin(rectangulo(m.anchoCm, m.fondoCm));
    case "media_luna": return mediaLuna(m.anchoCm);
    case "serpentina": return sin(serpentina(m.anchoCm, m.fondoCm));
    case "u": return sin(enU(m.anchoCm, m.fondoCm));
  }
}

/** La normal hacia afuera de la arista `i` de un polígono antihorario. */
export function normalDeArista(p: readonly Punto2[], i: number): Punto2 {
  const a = p[i]!, b = p[(i + 1) % p.length]!;
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  return { x: dy / l, y: -dx / l };
}

/** El contorno corrido `d` cm hacia afuera (o hacia adentro, si es negativo): cada vértice por la bisectriz de sus dos aristas. */
export function desplazarContorno(p: readonly Punto2[], d: number): Punto2[] {
  return p.map((q, i) => {
    const n0 = normalDeArista(p, (i - 1 + p.length) % p.length), n1 = normalDeArista(p, i);
    const bx = n0.x + n1.x, by = n0.y + n1.y, bl = Math.hypot(bx, by) || 1;
    const b = { x: bx / bl, y: by / bl };
    const k = d / Math.max(0.5, b.x * n1.x + b.y * n1.y);
    return { x: r1(q.x + b.x * k), y: r1(q.y + b.y * k) };
  });
}

/** ¿Está el punto (x, y) dentro del polígono (con `margen` cm de tolerancia hacia afuera)? */
export function dentroDelContorno(p: readonly Punto2[], x: number, y: number, margen = 0): boolean {
  let dentro = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i]!, b = p[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  if (dentro || margen <= 0) return dentro;
  return distanciaAlContorno(p, x, y) <= margen;
}

/** Distancia (cm) del punto al borde del polígono. */
export function distanciaAlContorno(p: readonly Punto2[], x: number, y: number): number {
  let mejor = Infinity;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!;
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
    mejor = Math.min(mejor, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)));
  }
  return mejor;
}
