/**
 * Geometría de cada globo, sin three.js: perfiles para tornear (r, y) en centímetros, con el nudo abajo en y = 0.
 *
 * - Redondo: gota de látex, apenas más alta que ancha (×1,08), con la cintura que baja al cuello y el nudo.
 * - Link-O-Loon: óvalo más alargado (×1,35) con el cuello abajo y la cola del conector arriba.
 * - Corazón: contorno plano que el visor extruye con biselado redondo.
 * - Tubito y Link-O-Loon 660: el visor los arma como cápsula a lo largo de una curva.
 */
export type PuntoPerfil = { r: number; y: number };

const PASOS = 48;

/** Radio del nudo (cm) de un globo de ese diámetro. */
export function nudoCm(diametroCm: number): number {
  return Math.max(0.35, diametroCm * 0.035);
}

/** Cuerpo ovalado de ancho `diametro` y alto `diametro × alargue`, más el cuello cónico y el nudo. */
function perfilCuerpo(diametro: number, alargue: number, cuello: number): PuntoPerfil[] {
  const radio = diametro / 2;
  const alto = diametro * alargue;
  const puntos: PuntoPerfil[] = [];
  // Nudo: un aro pequeño en la base.
  const nudo = nudoCm(diametro);
  puntos.push({ r: 0, y: 0 }, { r: nudo, y: nudo * 0.4 }, { r: nudo * 1.1, y: nudo * 1.2 }, { r: nudo * 0.6, y: nudo * 2 });
  // Cuello: sube estrecho y se abre hasta tocar el cuerpo.
  const baseCuerpo = nudo * 2 + cuello;
  puntos.push({ r: nudo * 0.7, y: nudo * 2 + cuello * 0.5 });
  // Cuerpo: elipse con la parte de abajo un poco más puntiaguda (la gota del látex).
  for (let i = 0; i <= PASOS; i++) {
    const t = i / PASOS; // 0 abajo, 1 arriba
    const angulo = -Math.PI / 2 + t * Math.PI;
    const ancho = Math.cos(angulo);
    const gota = t < 0.5 ? Math.pow(ancho, 1.25) : ancho;
    // Arriba el perfil cierra exactamente en el eje (cos(π/2) no da 0 en coma flotante).
    const r = i === PASOS ? 0 : Math.max(0, radio * gota);
    const y = baseCuerpo + (alto / 2) * (1 + Math.sin(angulo));
    if (i === 0 && r < nudo * 0.7) continue;
    puntos.push({ r, y });
  }
  return puntos;
}

/** `cuelloExtraCm`: cuánto se estira el cuello (en un módulo, para que el nudo siga amarrado al centro). */
export function perfilRedondo(diametroCm: number, cuelloExtraCm = 0): PuntoPerfil[] {
  return perfilCuerpo(diametroCm, 1.08, diametroCm * 0.08 + cuelloExtraCm);
}

/** Link-O-Loon: cuerpo alargado, cuello abajo y, arriba, la cola del conector (un tubo corto que se angosta). */
export function perfilLink(diametroCm: number, cuelloExtraCm = 0): PuntoPerfil[] {
  const cuerpo = perfilCuerpo(diametroCm, 1.35, diametroCm * 0.06 + cuelloExtraCm);
  const tope = cuerpo[cuerpo.length - 1]!.y;
  const cola = Math.max(0.3, diametroCm * 0.05);
  const largoCola = diametroCm * 0.32;
  return [
    ...cuerpo.slice(0, -1),
    { r: cola * 1.4, y: tope - diametroCm * 0.01 },
    { r: cola, y: tope + largoCola * 0.3 },
    { r: cola * 0.9, y: tope + largoCola },
    { r: cola * 1.5, y: tope + largoCola + cola },
    { r: 0, y: tope + largoCola + cola * 1.6 },
  ];
}

/** Contorno del corazón (x, y) en cm, centrado, con `anchoCm` de ancho total. */
export function contornoCorazon(anchoCm: number): Array<{ x: number; y: number }> {
  const puntos: Array<{ x: number; y: number }> = [];
  const pasos = 96;
  for (let i = 0; i < pasos; i++) {
    const t = (i / pasos) * Math.PI * 2;
    // Curva clásica del corazón, escalada a 32 de ancho.
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    puntos.push({ x: (x / 32) * anchoCm, y: (y / 32) * anchoCm });
  }
  return puntos;
}

/**
 * Distancia (cm) del nudo al centro del cuerpo: es lo que separa los cuerpos del centro de un módulo. Sale
 * del mismo perfil que se dibuja (el punto más ancho del cuerpo).
 */
export function centroCuerpo(tipo: "redondo" | "link", diametroCm: number): number {
  const perfil = tipo === "link" ? perfilLink(diametroCm) : perfilRedondo(diametroCm);
  let mejor = perfil[0]!;
  for (const punto of perfil) if (punto.r > mejor.r) mejor = punto;
  return mejor.y;
}

/** Alto total del perfil (cm): para encuadrar la cámara y alinear la fila de tamaños. */
export function altoPerfil(perfil: readonly PuntoPerfil[]): number {
  return perfil.reduce((max, punto) => Math.max(max, punto.y), 0);
}

/** Ancho máximo del perfil (cm). */
export function anchoPerfil(perfil: readonly PuntoPerfil[]): number {
  return 2 * perfil.reduce((max, punto) => Math.max(max, punto.r), 0);
}
