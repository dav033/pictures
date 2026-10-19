/**
 * Medida gratis de una imagen generada contra su guía de estructura
 * (ADR-0033): la silueta aproximada y la presencia de cada color. SOLO para
 * scripts de evaluación: el QA visual con reintento se retiró (ADR-0025) y
 * convertir esto en una puerta de producción lo decide una persona, con su ADR.
 *
 * Silueta. Sin segmentador: el fondo de cada fila se estima con la mediana de
 * sus bordes izquierdo y derecho (así una pared y un piso de distinto tono no
 * cuentan como estructura) y es estructura lo que se aleja de él más de
 * `LIMITES.fondo` en ΔE76. Las dos máscaras se recortan a su caja, se llevan a
 * la misma rejilla y se comparan (IoU alineada: forma, sin posición ni escala);
 * también sin alinear, en el encuadre entero, y la razón alto/ancho de cada
 * caja (un arco con patas o una guirnalda que se volvió arco sale más alto).
 * Aproximada: un globo del color del fondo o una pieza que toca el borde de la
 * foto engañan a la máscara.
 *
 * Color. Porta `fidelidad.ts` de `clasificador-decoraciones`: cada píxel
 * cromático de la estructura va al color pedido de tono más cercano; de cada
 * uno se mide el tono y el croma de su banda media de claridad (del 30 al 70 %:
 * sin reflejos ni sombras, nunca el promedio de la foto) y qué parte ocupa. Los
 * neutros (blanco, plata) no tienen tono que comparar: no se juzgan.
 *
 * Puro: entran píxeles RGB (los decodifica quien tiene la imagen).
 */

export type Pixeles = { ancho: number; alto: number; rgb: Uint8Array };
export type ObjetivoColor = { hex: string; nombre: string };

export const LIMITES = {
  /** ΔE76 al fondo de la fila por encima del cual un píxel es estructura. */
  fondo: 14,
  /** Ancho de la franja de cada borde con que se estima el fondo de la fila. */
  bordeRelativo: 0.03,
  /** Lado de la rejilla en que se comparan las siluetas alineadas. */
  rejilla: 64,
  tono: 8,
  croma: 0.6,
  presencia: 0.02,
  intrusos: 0.12,
  cromaMinima: 12,
  tonoAsignar: 22,
  pixelesMinimos: 500,
} as const;

type Lab = { l: number; a: number; b: number };

function lab(r: number, g: number, b: number): Lab {
  const lineal = (valor: number) => {
    const v = valor / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [rl, gl, bl] = [lineal(r), lineal(g), lineal(b)];
  const x = (0.4124 * rl + 0.3576 * gl + 0.1805 * bl) / 0.95047;
  const y = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  const z = (0.0193 * rl + 0.1192 * gl + 0.9505 * bl) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return { l: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}

function labHex(hex: string): Lab {
  return lab(Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16));
}

const croma = (valor: Lab) => Math.hypot(valor.a, valor.b);
const tono = (valor: Lab) => ((Math.atan2(valor.b, valor.a) * 180) / Math.PI + 360) % 360;
const deltaE = (uno: Lab, otro: Lab) => Math.hypot(uno.l - otro.l, uno.a - otro.a, uno.b - otro.b);

function distanciaTono(uno: number, otro: number): number {
  const d = Math.abs(uno - otro) % 360;
  return d > 180 ? 360 - d : d;
}

function mediana(valores: number[]): number {
  const orden = [...valores].sort((uno, otro) => uno - otro);
  return orden[Math.floor(orden.length / 2)] ?? 0;
}

/** 1 donde hay estructura: lo que se aleja del fondo de su fila. */
export function mascaraEstructura(imagen: Pixeles): Uint8Array {
  const { ancho, alto, rgb } = imagen;
  const borde = Math.max(1, Math.round(ancho * LIMITES.bordeRelativo));
  const mascara = new Uint8Array(ancho * alto);
  for (let y = 0; y < alto; y += 1) {
    const canales: [number[], number[], number[]] = [[], [], []];
    for (let x = 0; x < ancho; x += 1) {
      if (x >= borde && x < ancho - borde) continue;
      const i = (y * ancho + x) * 3;
      canales[0].push(rgb[i]!);
      canales[1].push(rgb[i + 1]!);
      canales[2].push(rgb[i + 2]!);
    }
    const fondo = lab(mediana(canales[0]), mediana(canales[1]), mediana(canales[2]));
    for (let x = 0; x < ancho; x += 1) {
      const i = (y * ancho + x) * 3;
      if (deltaE(lab(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!), fondo) > LIMITES.fondo) mascara[y * ancho + x] = 1;
    }
  }
  return mascara;
}

type Caja = { x0: number; y0: number; x1: number; y1: number };

function cajaDe(mascara: Uint8Array, ancho: number, alto: number): Caja | null {
  let caja: Caja | null = null;
  for (let y = 0; y < alto; y += 1) {
    for (let x = 0; x < ancho; x += 1) {
      if (!mascara[y * ancho + x]) continue;
      caja = caja ? { x0: Math.min(caja.x0, x), y0: Math.min(caja.y0, y), x1: Math.max(caja.x1, x), y1: Math.max(caja.y1, y) } : { x0: x, y0: y, x1: x, y1: y };
    }
  }
  return caja;
}

/** La máscara dentro de `caja`, llevada a una rejilla `lado × lado` (vecino más cercano). */
function rejillaDe(mascara: Uint8Array, ancho: number, caja: Caja, lado: number): Uint8Array {
  const salida = new Uint8Array(lado * lado);
  const w = caja.x1 - caja.x0 + 1;
  const h = caja.y1 - caja.y0 + 1;
  for (let fila = 0; fila < lado; fila += 1) {
    for (let columna = 0; columna < lado; columna += 1) {
      const x = caja.x0 + Math.min(w - 1, Math.floor(((columna + 0.5) * w) / lado));
      const y = caja.y0 + Math.min(h - 1, Math.floor(((fila + 0.5) * h) / lado));
      salida[fila * lado + columna] = mascara[y * ancho + x]!;
    }
  }
  return salida;
}

function iou(uno: Uint8Array, otro: Uint8Array): number {
  let interseccion = 0;
  let union = 0;
  for (let i = 0; i < uno.length; i += 1) {
    if (uno[i] && otro[i]) interseccion += 1;
    if (uno[i] || otro[i]) union += 1;
  }
  return union ? interseccion / union : 0;
}

export type MedidaSilueta = {
  /** IoU de las siluetas recortadas a su caja: la forma, sin importar posición ni escala. */
  iouAlineada: number;
  /** IoU en el encuadre entero: la forma y dónde quedó. */
  iouEncuadre: number;
  /** Alto / ancho de la caja de cada una. */
  razonGuia: number;
  razonGenerada: number;
  /** Parte del encuadre que ocupa la estructura generada. */
  ocupacion: number;
};

export function medirSilueta(generada: Pixeles, guia: Pixeles): MedidaSilueta | null {
  const mascaraGenerada = mascaraEstructura(generada);
  const mascaraGuia = mascaraEstructura(guia);
  const cajaGenerada = cajaDe(mascaraGenerada, generada.ancho, generada.alto);
  const cajaGuia = cajaDe(mascaraGuia, guia.ancho, guia.alto);
  if (!cajaGenerada || !cajaGuia) return null;
  const lado = LIMITES.rejilla;
  const encuadre = (mascara: Uint8Array, imagen: Pixeles) => rejillaDe(mascara, imagen.ancho, { x0: 0, y0: 0, x1: imagen.ancho - 1, y1: imagen.alto - 1 }, lado);
  const ocupados = mascaraGenerada.reduce((total, valor) => total + valor, 0);
  const razon = (caja: Caja) => (caja.y1 - caja.y0 + 1) / (caja.x1 - caja.x0 + 1);
  return {
    iouAlineada: iou(rejillaDe(mascaraGenerada, generada.ancho, cajaGenerada, lado), rejillaDe(mascaraGuia, guia.ancho, cajaGuia, lado)),
    iouEncuadre: iou(encuadre(mascaraGenerada, generada), encuadre(mascaraGuia, guia)),
    razonGuia: razon(cajaGuia),
    razonGenerada: razon(cajaGenerada),
    ocupacion: ocupados / (generada.ancho * generada.alto),
  };
}

export type MedidaColor = {
  objetivo: ObjetivoColor;
  neutro: boolean;
  /** Parte de los píxeles cromáticos de la estructura que son de este tono (0–1). */
  presencia: number;
  /** El color del cuerpo en la foto (banda media de claridad), o `null` si no apareció. */
  encontrado: string | null;
  deltaTono: number | null;
  razonCroma: number | null;
  ok: boolean;
};

export type MedidaColores = { colores: MedidaColor[]; intrusos: number; pixeles: number; ok: boolean };

const hexDe = (r: number, g: number, b: number) => `#${[r, g, b].map((valor) => Math.round(valor).toString(16).padStart(2, "0")).join("")}`;

/** Color de cuerpo de un grupo de píxeles: el promedio de su banda media de claridad (30–70 %). */
function colorDeCuerpo(grupo: ReadonlyArray<readonly [number, number, number]>): string | null {
  if (!grupo.length) return null;
  const conLuz = grupo.map((pixel) => ({ pixel, l: lab(pixel[0], pixel[1], pixel[2]).l })).sort((uno, otro) => uno.l - otro.l);
  const desde = Math.floor(conLuz.length * 0.3);
  const banda = conLuz.slice(desde, Math.max(desde + 1, Math.ceil(conLuz.length * 0.7)));
  const suma = banda.reduce((acumulado, { pixel }) => [acumulado[0] + pixel[0], acumulado[1] + pixel[1], acumulado[2] + pixel[2]] as [number, number, number], [0, 0, 0] as [number, number, number]);
  return hexDe(suma[0] / banda.length, suma[1] / banda.length, suma[2] / banda.length);
}

/** Presencia, tono y croma de cada color pedido dentro de la estructura (`mascara`; toda la imagen si falta). */
export function medirColores(imagen: Pixeles, objetivos: readonly ObjetivoColor[], mascara?: Uint8Array): MedidaColores {
  const labObjetivos = objetivos.map((objetivo) => labHex(objetivo.hex));
  const neutros = labObjetivos.map((valor) => croma(valor) < LIMITES.cromaMinima);
  const tonos = labObjetivos.map(tono);
  const grupos: Array<Array<readonly [number, number, number]>> = objetivos.map(() => []);
  let cromaticos = 0;
  let sinDueno = 0;
  for (let i = 0; i < imagen.ancho * imagen.alto; i += 1) {
    if (mascara && !mascara[i]) continue;
    const pixel = [imagen.rgb[i * 3]!, imagen.rgb[i * 3 + 1]!, imagen.rgb[i * 3 + 2]!] as const;
    const valor = lab(pixel[0], pixel[1], pixel[2]);
    if (croma(valor) < LIMITES.cromaMinima) continue;
    cromaticos += 1;
    const t = tono(valor);
    let mejor = -1;
    let mejorDistancia = Infinity;
    tonos.forEach((objetivo, indice) => {
      if (neutros[indice]) return;
      const distancia = distanciaTono(t, objetivo);
      if (distancia < mejorDistancia) {
        mejorDistancia = distancia;
        mejor = indice;
      }
    });
    if (mejor >= 0 && mejorDistancia <= LIMITES.tonoAsignar) grupos[mejor]!.push(pixel);
    else sinDueno += 1;
  }
  const suficientes = cromaticos >= LIMITES.pixelesMinimos;
  const colores = objetivos.map((objetivo, indice): MedidaColor => {
    if (neutros[indice]) return { objetivo, neutro: true, presencia: 0, encontrado: null, deltaTono: null, razonCroma: null, ok: true };
    const presencia = cromaticos ? grupos[indice]!.length / cromaticos : 0;
    if (!suficientes || presencia < LIMITES.presencia) return { objetivo, neutro: false, presencia, encontrado: null, deltaTono: null, razonCroma: null, ok: false };
    const encontrado = colorDeCuerpo(grupos[indice]!)!;
    const labEncontrado = labHex(encontrado);
    const deltaTono = distanciaTono(tono(labEncontrado), tonos[indice]!);
    const pedido = croma(labObjetivos[indice]!);
    const razonCroma = pedido > 0 ? croma(labEncontrado) / pedido : 1;
    return { objetivo, neutro: false, presencia, encontrado, deltaTono, razonCroma, ok: deltaTono <= LIMITES.tono && razonCroma >= LIMITES.croma };
  });
  const intrusos = cromaticos ? sinDueno / cromaticos : 0;
  return { colores, intrusos, pixeles: cromaticos, ok: suficientes && colores.every((color) => color.ok) && intrusos <= LIMITES.intrusos };
}

export type MedidaGuia = { silueta: MedidaSilueta | null; color: MedidaColores };

/** Las dos medidas de una imagen generada contra su guía; el color, dentro de la silueta generada. */
export function medirContraGuia(generada: Pixeles, guia: Pixeles, objetivos: readonly ObjetivoColor[]): MedidaGuia {
  return { silueta: medirSilueta(generada, guia), color: medirColores(generada, objetivos, mascaraEstructura(generada)) };
}
