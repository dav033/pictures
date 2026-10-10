/**
 * Puntuación de color del experimento Kontext: ΔE CIE76 (el repo solo exporta CIE76) entre cada color pedido y el centroide k-means más
 * cercano de los píxeles de la decoración. La decoración se aísla en la propia imagen, no con la máscara de la captura (Kontext reencuadra:
 * sus columnas salen rectas y la captura las trae inclinadas): se descarta la pared con un modelo aprendido de la imagen (su color en cada
 * columna y cómo cambia al bajar), se limita a la zona donde la captura tiene globos, con holgura, y a lo que está sobre el rodapié. El suelo,
 * sus vetas y las sombras de las piezas se parecen demasiado al dorado y falsearían el color. Es la misma regla para todas las variantes.
 */
import sharp from "sharp";
import { labDeRgb, type Lab } from "../../src/lib/rag/catalog/similitud-color";

export type ColorPedido = { nombre: string; hex: string };
export type Centro = { hex: string; parte: number };
export type Puntuacion = {
  pixeles: number;
  media: number;
  porColor: Array<{ color: string; hex: string; dE: number }>;
  /** Los grupos de color hallados en la decoración, de mayor a menor, con su parte de los píxeles. */
  centros: Centro[];
};

const LADO = 512;
const GRUPOS = 8;
/** Un grupo con menos de esta parte de los píxeles (brillos, bordes, sombras) no cuenta como «el color» de nada. */
const PARTE_MINIMA = 0.02;
const MAX_PIXELES = 20_000;

type Imagen = { datos: Buffer; canales: number };
const dE76 = (x: Lab, y: Lab) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);

const labEn = (imagen: Imagen, i: number): Lab => labDeRgb(imagen.datos[i * imagen.canales]!, imagen.datos[i * imagen.canales + 1]!, imagen.datos[i * imagen.canales + 2]!);

const hexDeLab = ([l, a, b]: Lab): string => {
  const fy = (l + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const [x, y, z] = [0.95047 * inv(fx), inv(fy), 1.08883 * inv(fz)];
  const lineal = [3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z, 0.0557 * x - 0.204 * y + 1.057 * z];
  return `#${lineal.map((c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
};

const labDeHex = (hex: string): Lab => labDeRgb(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));

async function cargar(ruta: string): Promise<Imagen> {
  const { data, info } = await sharp(ruta).removeAlpha().resize(LADO, LADO, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  return { datos: data, canales: info.channels };
}

const porcentaje = (p: number, tramo: number) => Math.floor(p * LADO) + tramo;

/** Cuánto puede alejarse un píxel del color que se espera en la pared (la luz la oscurece de lado a lado y de arriba abajo). */
const UMBRAL_PARED = 7;
/** Hasta qué fila se puntúa: el rodapié de las imágenes cae entre el 70 y el 76 % de la altura, y más abajo solo hay suelo y sombras. */
const FILA_RODAPIE = Math.floor(LADO * 0.68);

const mediana = (valores: number[]) => [...valores].sort((p, q) => p - q)[Math.floor(valores.length / 2)]!;
const medianaLab = (labs: readonly Lab[]): Lab => [mediana(labs.map((l) => l[0])), mediana(labs.map((l) => l[1])), mediana(labs.map((l) => l[2]))];

/**
 * El color de la pared esperado en cada píxel: el de su columna en la franja de arriba (sobre las piezas no hay globos) más lo que la
 * pared cambia al bajar, que se mide en la franja central entre las dos piezas.
 */
function modeloDePared(imagen: Imagen): (x: number, y: number) => Lab {
  const y0 = porcentaje(0.02, 0), y1 = porcentaje(0.08, 0);
  const porColumna = Array.from({ length: LADO }, (_, x) => {
    const lab: Lab[] = [];
    for (let xx = Math.max(0, x - 6); xx <= Math.min(LADO - 1, x + 6); xx++) for (let y = y0; y < y1; y++) lab.push(labEn(imagen, y * LADO + xx));
    return medianaLab(lab);
  });
  const centro = (y: number): Lab => {
    const lab: Lab[] = [];
    for (let x = porcentaje(0.42, 0); x < porcentaje(0.58, 0); x++) lab.push(labEn(imagen, y * LADO + x));
    return medianaLab(lab);
  };
  const arriba = medianaLab(Array.from({ length: y1 - y0 }, (_, k) => centro(y0 + k)));
  const porFila = Array.from({ length: LADO }, (_, y) => centro(Math.min(y, FILA_RODAPIE)));
  return (x, y) => [0, 1, 2].map((c) => porColumna[x]![c]! + porFila[y]![c]! - arriba[c]!) as [number, number, number];
}

const esPared = (lab: Lab, x: number, y: number, pared: (x: number, y: number) => Lab) => dE76(lab, pared(x, y)) <= UMBRAL_PARED;

type Caja = { x0: number; y0: number; x1: number; y1: number };

/** Dónde tiene globos la captura: una caja por mitad (izquierda y derecha), ensanchada, porque Kontext no calca la silueta. */
function zonasDeLaCaptura(captura: Imagen): Caja[] {
  const pared = modeloDePared(captura);
  const cajas = [0, 1].map(() => ({ x0: LADO, y0: LADO, x1: 0, y1: 0 }));
  for (let y = 0; y <= FILA_RODAPIE; y++) {
    for (let x = 0; x < LADO; x++) {
      if (esPared(labEn(captura, y * LADO + x), x, y, pared)) continue;
      const caja = cajas[x < LADO / 2 ? 0 : 1]!;
      caja.x0 = Math.min(caja.x0, x); caja.x1 = Math.max(caja.x1, x); caja.y0 = Math.min(caja.y0, y); caja.y1 = Math.max(caja.y1, y);
    }
  }
  const holguraX = Math.round(LADO * 0.1), holguraArriba = Math.round(LADO * 0.14);
  return cajas.filter((c) => c.x1 > c.x0).map((c) => ({ x0: Math.max(0, c.x0 - holguraX), x1: Math.min(LADO - 1, c.x1 + holguraX), y0: Math.max(0, c.y0 - holguraArriba), y1: FILA_RODAPIE }));
}

/** Qué píxeles (1) de la imagen son decoración: dentro de las zonas, sobre el rodapié y que no sean pared. */
function mascaraDeDecoracion(imagen: Imagen, zonas: readonly Caja[]): Uint8Array {
  const pared = modeloDePared(imagen);
  const mascara = new Uint8Array(LADO * LADO);
  for (const z of zonas) {
    for (let y = z.y0; y <= Math.min(z.y1, FILA_RODAPIE); y++) {
      for (let x = z.x0; x <= z.x1; x++) if (!esPared(labEn(imagen, y * LADO + x), x, y, pared)) mascara[y * LADO + x] = 1;
    }
  }
  return mascara;
}

function pixelesDeDecoracion(imagen: Imagen, mascara: Uint8Array): Lab[] {
  const todos: Lab[] = [];
  for (let i = 0; i < mascara.length; i++) if (mascara[i]) todos.push(labEn(imagen, i));
  const paso = Math.max(1, Math.floor(todos.length / MAX_PIXELES));
  return todos.filter((_, k) => k % paso === 0);
}

/** La imagen con lo que NO cuenta como decoración atenuado, para revisar a ojo qué se puntuó. */
export async function imagenDeMascara(rutaImagen: string, rutaCaptura: string, salida: string): Promise<void> {
  const imagen = await cargar(rutaImagen);
  const mascara = mascaraDeDecoracion(imagen, zonasDeLaCaptura(await cargar(rutaCaptura)));
  const rgba = Buffer.alloc(LADO * LADO * 4);
  for (let i = 0; i < mascara.length; i++) {
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = mascara[i] ? imagen.datos[i * imagen.canales + c]! : 255;
    rgba[i * 4 + 3] = 255;
  }
  await sharp(rgba, { raw: { width: LADO, height: LADO, channels: 4 } }).png().toFile(salida);
}

/** k-means con arranque determinista: el primer centro es el punto más cercano a la media y cada siguiente el más alejado de los ya elegidos. */
function agrupar(puntos: readonly Lab[], k: number, iteraciones = 30): Array<{ centro: Lab; cuenta: number }> {
  const media: Lab = [0, 1, 2].map((c) => puntos.reduce((suma, p) => suma + p[c]!, 0) / puntos.length) as [number, number, number];
  let centros: Lab[] = [puntos.reduce((mejor, p) => (dE76(p, media) < dE76(mejor, media) ? p : mejor))];
  while (centros.length < k) centros.push(puntos.reduce((lejos, p) => (Math.min(...centros.map((c) => dE76(p, c))) > Math.min(...centros.map((c) => dE76(lejos, c))) ? p : lejos)));
  let cuentas: number[] = centros.map(() => 0);
  for (let it = 0; it < iteraciones; it++) {
    const suma = centros.map(() => [0, 0, 0, 0] as [number, number, number, number]);
    for (const p of puntos) {
      let mejor = 0, d = Infinity;
      centros.forEach((c, i) => { const dd = dE76(p, c); if (dd < d) { d = dd; mejor = i; } });
      const s = suma[mejor]!;
      s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3] += 1;
    }
    centros = suma.map((s, i) => (s[3] ? ([s[0] / s[3], s[1] / s[3], s[2] / s[3]] as Lab) : centros[i]!));
    cuentas = suma.map((s) => s[3]);
  }
  return centros.map((centro, i) => ({ centro, cuenta: cuentas[i]! })).sort((a, b) => b.cuenta - a.cuenta);
}

/** Puntúa `rutaImagen` contra los colores pedidos; `rutaCaptura` fija dónde está la decoración. */
export async function puntuarImagen(rutaImagen: string, rutaCaptura: string, pedidos: readonly ColorPedido[]): Promise<Puntuacion> {
  const imagen = await cargar(rutaImagen);
  const puntos = pixelesDeDecoracion(imagen, mascaraDeDecoracion(imagen, zonasDeLaCaptura(await cargar(rutaCaptura))));
  if (puntos.length < GRUPOS * 10) throw new Error("Casi no quedan píxeles de decoración que puntuar.");
  const grupos = agrupar(puntos, GRUPOS);
  const relevantes = grupos.filter((g) => g.cuenta / puntos.length >= PARTE_MINIMA);
  const porColor = pedidos.map((c) => ({ color: c.nombre, hex: c.hex, dE: Number(Math.min(...relevantes.map((g) => dE76(labDeHex(c.hex), g.centro))).toFixed(1)) }));
  return {
    pixeles: puntos.length,
    media: Number((porColor.reduce((s, x) => s + x.dE, 0) / porColor.length).toFixed(1)),
    porColor,
    centros: grupos.map((g) => ({ hex: hexDeLab(g.centro), parte: Number((g.cuenta / puntos.length).toFixed(2)) })),
  };
}
