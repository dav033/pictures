import { formatoPorId } from "./formatos";
import { centroCuerpo } from "./geometria";
import type { Vec3 } from "./modulos";
import type { CapaEstampado, EstampadoGlobo, GloboDecoracion, ParteGlobo, TuboDecoracion } from "./decoraciones";
import { capasCaraCalabaza, capasOjo, type EstiloOjo, type ParteTubito } from "./halloween";

/**
 * **Figuras de globos y tubitos** (muñecos, animales, objetos): un generador por partes, todo por propiedades.
 *
 * Un **esqueleto**: base de globos para pararla → piernas → cuerpo (1–3 segmentos: globo, racimo o tubito largo) →
 * cuello → cabeza (con cara impresa: ojos, boca, mejillas, bigote, nariz, cejas). Brazos y piernas son cadenas de
 * **burbujas** de tubito (largo de cada una, ángulo de cada una), con mano o pie al final (burbuja, globo o dedos).
 * Los **accesorios** (sombrero, moño, orejas, antenas, alas, cola, pico, cresta, globos pegados, cadenas de
 * burbujas, aros, bufanda) se pegan en **puntos con nombre** del esqueleto (`coronilla`, `cara`, `cuello`, `mano`…),
 * con un corrimiento y, si van en par, en espejo.
 *
 * Tres posturas: **de pie** (las piernas llegan a la base), **sentado** (el cuerpo se apoya en la base y las piernas
 * salen al frente) y **de lado** (`horizontal`: cuerpo acostado de izquierda a derecha con pares de patas o ruedas, la
 * cabeza al frente: animales de cuatro patas, insectos y vehículos).
 *
 * Espacio de las decoraciones (igual que `halloween.ts`): **+y es la cara** (mira a quien ve), **+z es arriba** y la
 * derecha de quien mira es −x; la figura se para en z = 0. Unidades: cm. Todo determinista (sin azar).
 *
 * Ángulos: en el plano de frente, 0° = hacia fuera (hacia el lado de esa extremidad o accesorio; para uno solo, la
 * derecha de quien mira), 90° = arriba, −90° = abajo, 180° = hacia el otro lado. «adelante» lo saca hacia quien mira.
 * En una figura de lado, 0° de las patas es hacia la cabeza.
 */

// ----------------------------------------------------------------------------------------------------------
// Propiedades
// ----------------------------------------------------------------------------------------------------------

/** Lo impreso en la cara de un globo (la cabeza o un cuerpo que hace de cabeza). Colores en hex: no son globos. */
export type Cara = {
  ojos: { estilo: "puntos" | "ovalos"; hex: string } | null;
  boca: { estilo: "sonrisa" | "abierta" | "beso" | "linea"; hex: string } | null;
  mejillas: { hex: string } | null;
  /** «mostacho»: bigote retorcido de señor; «gato»: tres bigotes finos por lado. */
  bigote: { estilo: "mostacho" | "gato"; hex: string } | null;
  nariz: { estilo: "punto" | "zanahoria"; hex: string } | null;
  cejas: { hex: string; bravas: boolean } | null;
  /** Cara de calabaza (ojos y nariz de triángulo y boca con dientes): reemplaza ojos, nariz y boca. */
  calabaza?: { hex: string } | null;
};

/** Lo impreso sobre un segmento del cuerpo: gajos de calabaza (rayas), los puntos de una mariquita, rayas de abeja. */
export type DibujoCuerpo = { estilo: "gajos" | "puntos" | "franjas"; hex: string; cantidad: number };

export type SegmentoCuerpo =
  | { tipo: "globo"; globo: ParteGlobo; cara?: Cara | null; dibujo?: DibujoCuerpo | null }
  /** Racimo redondo de globos iguales (una bola de 4 a 12). */
  | { tipo: "racimo"; globo: ParteGlobo; cantidad: number }
  /** Un tubito largo de pie (el cuerpo de un muñeco flaco). */
  | { tipo: "tubito"; tubito: ParteTubito; largoCm: number };

/** Mano o pie al final de una extremidad. */
export type PuntaExtremidad =
  | { tipo: "burbuja"; largoCm: number }
  | { tipo: "globo"; globo: ParteGlobo }
  | { tipo: "dedos"; cantidad: number; largoCm: number; aberturaGrados: number };

/** Un brazo o una pierna: burbujas de tubito, cada una con su largo y su ángulo (el último ángulo se repite). */
export type Extremidad = ParteTubito & {
  burbujasCm: number[];
  angulosGrados: number[];
  adelanteGrados?: number[];
  /** Dos tubitos retorcidos juntos (los brazos de los «Amigos felices»). */
  trenzado?: boolean;
  punta: PuntaExtremidad | null;
  /** La del lado izquierdo de quien mira, si no es el espejo de la derecha (un brazo saludando). */
  otroLado?: { angulosGrados: number[]; adelanteGrados?: number[] } | null;
};

/** Un anillo de la base: `cantidad` globos con los nudos al centro (1 = uno al medio; 4 = un cuarteto). */
export type AnilloBase = { formatoId: string; infladoCm: number; codigos: string[]; cantidad: number };

/** Puntos con nombre del esqueleto donde se pegan los accesorios. Los de `mano`, `pie`, `hombro`, `cadera` y `oreja` tienen lado. */
export type PuntoFigura = "coronilla" | "cara" | "oreja" | "cuello" | "pecho" | "barriga" | "lomo" | "espalda" | "cola" | "hombro" | "mano" | "cadera" | "pie" | "base";

export const PUNTOS_FIGURA: readonly PuntoFigura[] = ["coronilla", "cara", "oreja", "cuello", "pecho", "barriga", "lomo", "espalda", "cola", "hombro", "mano", "cadera", "pie", "base"];

/** Un abanico de lazos, burbujas o flecos (tubitos casi sin inflar) alrededor de una dirección. */
export type Abanico = ParteTubito & { estilo: "lazos" | "burbujas" | "flecos"; cantidad: number; largoCm: number; anchoCm?: number; aberturaGrados: number };

export type FormaAccesorio =
  | {
    tipo: "sombrero";
    /** Ala: un aro cerrado (bombín, gorro) o flecos alrededor (sombrero de paja). */
    ala: (ParteTubito & { estilo: "aro" | "flecos"; radioCm: number; cantidad?: number }) | null;
    /** Copa: un globo redondo, o una burbuja de tubito alta. */
    copa: { globo: ParteGlobo } | { tubito: ParteTubito; largoCm: number } | null;
    cinta: ParteTubito | null;
    pompon: ParteGlobo | null;
    inclinacionGrados: number;
  }
  | { tipo: "mono"; lazos: (ParteTubito & { largoCm: number; anchoCm: number }) | null; globos: ParteGlobo | null; centro: ParteGlobo | null }
  | { tipo: "orejas"; estilo: "lazo" | "globo" | "burbuja"; tubito?: ParteTubito; globo?: ParteGlobo; largoCm: number; anchoCm?: number; anguloGrados: number }
  | { tipo: "antenas"; tubito: ParteTubito; largoCm: number; anguloGrados: number; punta: ParteGlobo | null }
  | { tipo: "alas"; abanico: Abanico; anguloGrados: number; adelanteGrados?: number }
  | { tipo: "cola"; estilo: "rizo" | "curva" | "plumas"; tubito: ParteTubito; largoCm: number; anguloGrados: number; adelanteGrados?: number; giroGrados?: number; cantidad?: number }
  | { tipo: "pico"; abanico: Abanico; anguloGrados?: number }
  | { tipo: "cresta"; abanico: Abanico; anguloGrados: number; adelanteGrados?: number }
  | { tipo: "globo"; globo: ParteGlobo; anguloGrados: number; adelanteGrados?: number; estampado?: "ojo" | "nariz_cerdo" | "ventana" | "rin" | null }
  | { tipo: "burbujas"; tubito: ParteTubito; largosCm: number[]; angulosGrados: number[]; adelanteGrados?: number[] }
  | { tipo: "aro"; tubito: ParteTubito; radioCm: number; plano: "frente" | "lado" | "horizontal"; desdeGrados: number; hastaGrados: number }
  | { tipo: "bufanda"; formatoId: string; grosorCm: number; codigos: string[]; radioCm: number };

export type Accesorio = {
  en: PuntoFigura;
  /** Corrimiento desde el punto: [a la derecha de quien mira, hacia quien mira, arriba] (cm). En par, la derecha se refleja. */
  corrimientoCm?: [number, number, number];
  /** Uno a cada lado, en espejo (orejas, ojos, alas); sin él, uno solo, del lado derecho de quien mira. */
  par?: boolean;
  forma: FormaAccesorio;
};

export type PropiedadesFigura = {
  postura: "de_pie" | "sentado" | "horizontal";
  /** Anillos de la base, del piso hacia arriba (vacío = sin base). */
  base: AnilloBase[];
  piernas: Extremidad | null;
  /** De lado: cuántas patas por lado (2 = cuatro patas, 3 = insecto). */
  patasPorLado?: number;
  /** De abajo arriba (de pie y sentado) o de atrás hacia la cabeza (de lado). */
  cuerpo: SegmentoCuerpo[];
  cuello: (ParteGlobo & { cantidad: number }) | null;
  cabeza: (ParteGlobo & { cara: Cara | null }) | null;
  /** De lado: hacia dónde sale la cabeza desde el frente del cuerpo (0° = al frente, 90° = arriba). */
  cabezaGrados?: number;
  brazos: Extremidad | null;
  /** De lado: ruedas (un vehículo), `ejes` pares. */
  ruedas?: (ParteGlobo & { ejes: number }) | null;
  accesorios: Accesorio[];
  /** Qué es, en inglés y corto (para la foto con IA). */
  queEs: string;
};

export type DecoracionFigura = { tipo: "figura"; propiedades: PropiedadesFigura };

/** Un tramo de una extremidad (de la raíz a la punta): para revisar que cada burbuja toca la anterior. */
export type ExtremidadArmada = { nombre: string; raiz: Vec3; tramos: Array<[Vec3, Vec3]> };

export type FiguraArmada = {
  globos: GloboDecoracion[];
  tubos: TuboDecoracion[];
  /** Mitad del lado mayor de la figura vista de frente y lo que se hunde por detrás (como las de Halloween). */
  radioCm: number;
  fondoCm: number;
  altoCm: number;
  anchoCm: number;
  extremidades: ExtremidadArmada[];
  /** Holgura entre partes que deben tocarse (cm): > 0 separadas, < 0 metidas una en otra. */
  uniones: Array<{ nombre: string; holguraCm: number }>;
  /** Dónde quedó cada punto con nombre (con lado: `mano_derecha`, `mano_izquierda`). */
  puntos: Record<string, Vec3>;
};

// ----------------------------------------------------------------------------------------------------------
// Ayudas de geometría
// ----------------------------------------------------------------------------------------------------------

const rad = (g: number) => (g * Math.PI) / 180;
/** Un punto por lo que ve quien mira: a su derecha, hacia él y arriba. */
const P = (derecha: number, frente: number, arriba: number): Vec3 => ({ x: -derecha, y: frente, z: arriba });
const mas = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const menos = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const por = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const largo = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const unitario = (v: Vec3): Vec3 => { const n = largo(v) || 1; return { x: v.x / n, y: v.y / n, z: v.z / n }; };
const cruz = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const r2 = (v: number) => Math.round(v * 100) / 100;
const redondo = (p: Vec3): Vec3 => ({ x: r2(p.x), y: r2(p.y), z: r2(p.z) });
const ciclo = <T>(lista: readonly T[], i: number, otro: T): T => (lista.length ? lista[Math.min(i, lista.length - 1)]! : otro);

const ARRIBA = P(0, 0, 1);
const AL_FRENTE = P(0, 1, 0);

/** Dirección en el plano de frente: `a` desde «hacia fuera» del lado `s` (+1 derecha de quien mira), `f` hacia quien mira. */
function enPlano(a: number, f: number, s: number): Vec3 {
  return unitario(P(s * Math.cos(rad(a)) * Math.cos(rad(f)), Math.sin(rad(f)), Math.sin(rad(a)) * Math.cos(rad(f))));
}

const esLink = (formatoId: string) => formatoPorId(formatoId)?.tipo === "link";
/** Medio largo de un globo a lo largo de su eje (un redondo es un 8 % más largo que ancho; un Link-O-Loon, un 35 %). */
const medioLargo = (g: ParteGlobo) => (g.infladoCm / 2) * (esLink(g.formatoId) ? 1.35 : 1.08);

/** Un globo con el centro de su cuerpo en `centro` y el cuerpo hacia `direccion` (el nudo queda detrás). */
function globoEn(parte: ParteGlobo, centro: Vec3, direccion: Vec3, estampado?: EstampadoGlobo, frente?: Vec3): GloboDecoracion {
  const d = unitario(direccion);
  const c = centroCuerpo(esLink(parte.formatoId) ? "link" : "redondo", parte.infladoCm);
  return {
    formatoId: parte.formatoId, infladoCm: parte.infladoCm, codigo: parte.codigo, nudo: redondo(mas(centro, por(d, -c))), direccion: d, cuelloExtraCm: 0,
    ...(estampado ? { frente: frente ?? AL_FRENTE, estampado } : frente ? { frente } : {}),
  };
}

function tubito(parte: ParteTubito, puntos: Vec3[], cerrado = false): TuboDecoracion {
  return { formatoId: parte.formatoId, grosorCm: parte.grosorCm, codigo: parte.codigo, puntos: puntos.map(redondo), cerrado };
}

/** Lazo: sale de `desde`, se aleja `l` hacia `radial` abriéndose `ancho` hacia `lateral` y vuelve. */
function lazo(desde: Vec3, radial: Vec3, lateral: Vec3, l: number, ancho: number, puntos = 20): Vec3[] {
  const salida: Vec3[] = [];
  for (let i = 0; i <= puntos; i++) {
    const t = i / puntos;
    salida.push(mas(mas(desde, por(radial, l * Math.sin(Math.PI * t))), por(lateral, (ancho / 2) * Math.sin(2 * Math.PI * t))));
  }
  return salida;
}

/** Una perpendicular cualquiera (estable) a `d`. */
function perpendicular(d: Vec3): Vec3 {
  const auxiliar = Math.abs(d.y) < 0.9 ? AL_FRENTE : ARRIBA;
  return unitario(cruz(d, auxiliar));
}

/** Un elipsoide del esqueleto: centro, radio de ancho (y fondo) y medio alto. */
type Esfera = { centro: Vec3; radio: number; alto: number };

/** Un punto sobre la superficie del elipsoide, en la dirección (derecha, frente, arriba) dada. */
function sobre(e: Esfera, derecha: number, frente: number, arriba: number): Vec3 {
  const u = unitario({ x: derecha, y: frente, z: arriba });
  return mas(e.centro, P(e.radio * u.x, e.radio * u.y, e.alto * u.z));
}

// ----------------------------------------------------------------------------------------------------------
// Lo impreso
// ----------------------------------------------------------------------------------------------------------

function circulo(cu: number, cv: number, ru: number, rv = ru, n = 18): Array<[number, number]> {
  return Array.from({ length: n }, (_, i): [number, number] => {
    const a = (2 * Math.PI * i) / n;
    return [r2(cu + ru * Math.cos(a)), r2(cv + rv * Math.sin(a))];
  });
}

/** Una línea gruesa como polígono (el trazo de ida por un lado y de vuelta por el otro). */
function trazo(puntos: ReadonlyArray<[number, number]>, anchoInicio: number, anchoFin = anchoInicio): Array<[number, number]> {
  const ida: Array<[number, number]> = [], vuelta: Array<[number, number]> = [];
  for (let i = 0; i < puntos.length; i++) {
    const a = puntos[Math.max(0, i - 1)]!, b = puntos[Math.min(puntos.length - 1, i + 1)]!;
    const tx = b[0] - a[0], ty = b[1] - a[1];
    const n = Math.hypot(tx, ty) || 1;
    const w = (anchoInicio + (anchoFin - anchoInicio) * (i / Math.max(1, puntos.length - 1))) / 2;
    const [x, y] = puntos[i]!;
    ida.push([r2(x - (ty / n) * w), r2(y + (tx / n) * w)]);
    vuelta.push([r2(x + (ty / n) * w), r2(y - (tx / n) * w)]);
  }
  return [...ida, ...vuelta.reverse()];
}

/** Puntos de un arco (u, v) de centro (cu, cv), radios (ru, rv), de `desde` a `hasta` grados. */
function arco(cu: number, cv: number, ru: number, rv: number, desde: number, hasta: number, n = 12): Array<[number, number]> {
  return Array.from({ length: n + 1 }, (_, i): [number, number] => {
    const a = rad(desde + ((hasta - desde) * i) / n);
    return [cu + ru * Math.cos(a), cv + rv * Math.sin(a)];
  });
}

/** Las capas de una cara sobre un globo de radio `r` (u a la derecha de quien mira, v arriba; en cm sobre el globo). */
export function capasCara(r: number, cara: Cara): CapaEstampado[] {
  const capas: CapaEstampado[] = [];
  const espejo = (puntos: Array<[number, number]>): Array<[number, number]> => puntos.map(([u, v]) => [r2(-u), v]);
  if (cara.mejillas) for (const s of [1, -1]) capas.push({ hex: cara.mejillas.hex, puntos: circulo(s * 0.5 * r, -0.12 * r, 0.13 * r, 0.1 * r) });
  if (cara.calabaza) {
    capas.push(...capasCaraCalabaza(r, cara.calabaza.hex));
  } else {
    if (cara.ojos) {
      for (const s of [1, -1]) {
        if (cara.ojos.estilo === "puntos") capas.push({ hex: cara.ojos.hex, puntos: circulo(s * 0.27 * r, 0.2 * r, 0.075 * r, 0.11 * r) });
        else {
          capas.push({ hex: "#ffffff", puntos: circulo(s * 0.28 * r, 0.2 * r, 0.16 * r, 0.2 * r) });
          capas.push({ hex: cara.ojos.hex, puntos: circulo(s * 0.26 * r, 0.17 * r, 0.09 * r, 0.11 * r) });
          capas.push({ hex: "#ffffff", puntos: circulo(s * 0.23 * r, 0.21 * r, 0.03 * r, 0.03 * r, 10) });
        }
      }
    }
    if (cara.nariz) {
      capas.push(cara.nariz.estilo === "punto"
        ? { hex: cara.nariz.hex, puntos: circulo(0, -0.02 * r, 0.09 * r, 0.075 * r) }
        // Zanahoria: un triángulo que sale hacia la derecha de quien mira.
        : { hex: cara.nariz.hex, puntos: [[r2(-0.06 * r), r2(0.04 * r)], [r2(-0.06 * r), r2(-0.08 * r)], [r2(0.34 * r), r2(-0.03 * r)]] });
    }
    if (cara.boca) {
      const hex = cara.boca.hex;
      if (cara.boca.estilo === "sonrisa") capas.push({ hex, puntos: trazo(arco(0, -0.05 * r, 0.36 * r, 0.3 * r, 200, 340), 0.055 * r) });
      else if (cara.boca.estilo === "linea") capas.push({ hex, puntos: trazo(arco(0, -0.1 * r, 0.16 * r, 0.12 * r, 215, 325, 6), 0.05 * r) });
      else if (cara.boca.estilo === "abierta") {
        // Media luna: el borde de arriba recto y el de abajo en arco.
        capas.push({ hex, puntos: [[r2(-0.3 * r), r2(-0.2 * r)], [r2(0.3 * r), r2(-0.2 * r)], ...arco(0, -0.2 * r, 0.3 * r, 0.22 * r, 0, -180, 12).slice(1).map(([u, v]): [number, number] => [r2(u), r2(v)])] });
      } else {
        // Beso: dos labios redondeados.
        capas.push({ hex, puntos: circulo(0, -0.27 * r, 0.1 * r, 0.06 * r) }, { hex, puntos: circulo(0, -0.37 * r, 0.09 * r, 0.055 * r) });
      }
    }
  }
  if (cara.bigote) {
    const hex = cara.bigote.hex;
    if (cara.bigote.estilo === "mostacho") {
      // Medio mostacho: sale del centro, baja y se enrolla hacia arriba en la punta.
      const medio: Array<[number, number]> = [[0.02 * r, -0.1 * r], [0.14 * r, -0.13 * r], [0.26 * r, -0.2 * r], [0.38 * r, -0.19 * r], [0.45 * r, -0.12 * r], [0.42 * r, -0.06 * r]];
      const derecho = trazo(medio, 0.13 * r, 0.04 * r);
      capas.push({ hex, puntos: derecho }, { hex, puntos: espejo(derecho) });
    } else {
      for (const s of [1, -1]) for (const k of [-1, 0, 1]) capas.push({ hex, puntos: trazo([[s * 0.12 * r, -0.1 * r], [s * 0.55 * r, -0.08 * r + k * 0.1 * r]], 0.025 * r) });
    }
  }
  if (cara.cejas) {
    for (const s of [1, -1]) {
      const puntos: Array<[number, number]> = cara.cejas.bravas ? [[s * 0.45 * r, 0.46 * r], [s * 0.12 * r, 0.32 * r]] : [[s * 0.4 * r, 0.38 * r], [s * 0.27 * r, 0.44 * r], [s * 0.14 * r, 0.4 * r]];
      capas.push({ hex: cara.cejas.hex, puntos: trazo(puntos, 0.07 * r) });
    }
  }
  return capas;
}

/** El dibujo de un segmento del cuerpo (gajos, puntos o franjas), sobre la cara de un globo de radio `r`. */
export function capasDibujo(r: number, d: DibujoCuerpo): CapaEstampado[] {
  const n = Math.max(1, Math.min(16, Math.round(d.cantidad)));
  const capas: CapaEstampado[] = [];
  if (d.estilo === "gajos") {
    // Líneas de arriba abajo, curvadas como los gajos de una calabaza.
    for (let k = 0; k < n; k++) {
      const u0 = (k - (n - 1) / 2) * ((1.5 * r) / Math.max(1, n));
      const linea: Array<[number, number]> = Array.from({ length: 9 }, (_, i): [number, number] => {
        const v = -1.25 * r + (2.5 * r * i) / 8;
        return [u0 * (1 - 0.35 * (v / (1.3 * r)) ** 2), v];
      });
      capas.push({ hex: d.hex, puntos: trazo(linea, 0.05 * r) });
    }
  } else if (d.estilo === "franjas") {
    // Franjas de lado a lado (abeja), un poco curvadas hacia abajo.
    for (let k = 0; k < n; k++) {
      const v0 = (k - (n - 1) / 2) * ((2.2 * r) / (n + 0.5));
      const linea: Array<[number, number]> = Array.from({ length: 9 }, (_, i): [number, number] => {
        const u = -1.3 * r + (2.6 * r * i) / 8;
        return [u, v0 - 0.12 * r * (1 - (u / (1.3 * r)) ** 2)];
      });
      capas.push({ hex: d.hex, puntos: trazo(linea, 0.26 * r) });
    }
  } else {
    // Puntos repartidos (ángulo de oro) en el frente visible.
    for (let k = 0; k < n; k++) {
      const a = k * rad(137.5) + 0.4, dist = 1.25 * r * Math.sqrt((k + 0.6) / n);
      capas.push({ hex: d.hex, puntos: circulo(dist * Math.cos(a), dist * Math.sin(a), (0.12 + 0.04 * (k % 3)) * r) });
    }
  }
  return capas;
}

const OJO_SALTON: EstiloOjo = { iris: null, pupila: { hex: "#1b1b1b", proporcion: 0.42 }, brillo: true, venas: null };

/** Lo impreso de un globo pegado (accesorio `globo`). */
function estampadoAccesorio(tipo: "ojo" | "nariz_cerdo" | "ventana" | "rin", r: number, s: number): EstampadoGlobo {
  switch (tipo) {
    case "ojo": return { en: "punta", capas: capasOjo(r, OJO_SALTON, [r2(-s * 0.12), 0.06]) };
    case "nariz_cerdo": return { en: "punta", capas: [{ hex: "#b34d73", puntos: circulo(-0.28 * r, 0, 0.13 * r, 0.2 * r) }, { hex: "#b34d73", puntos: circulo(0.28 * r, 0, 0.13 * r, 0.2 * r) }] };
    case "rin": return { en: "punta", capas: [{ hex: "#c9ccd1", puntos: circulo(0, 0, 0.45 * r) }, { hex: "#7d8288", puntos: circulo(0, 0, 0.16 * r) }] };
    case "ventana": {
      // Dos ventanas de esquinas redondeadas, separadas por el parante.
      const ventana = (u0: number): Array<[number, number]> => circulo(u0, 0.05 * r, 0.32 * r, 0.26 * r, 16).map(([u, v]): [number, number] => [r2(u0 + Math.sign(u - u0) * Math.min(Math.abs(u - u0) * 1.15, 0.32 * r)), v]);
      return { en: "cara", capas: [{ hex: "#bfe6f5", puntos: ventana(-0.38 * r) }, { hex: "#bfe6f5", puntos: ventana(0.38 * r) }] };
    }
  }
}

// ----------------------------------------------------------------------------------------------------------
// Partes
// ----------------------------------------------------------------------------------------------------------

type Salida = { globos: GloboDecoracion[]; tubos: TuboDecoracion[] };

/** Burbujas a lo largo de `tramos`: cada una se acorta un poco en sus puntas (la torcedura), o dos tubitos trenzados. */
function burbujasDe(parte: ParteTubito, tramos: ReadonlyArray<[Vec3, Vec3]>, trenzado: boolean, salida: Salida) {
  const g = parte.grosorCm;
  const pellizco = Math.min(0.45, g * 0.1);
  for (const [a, b] of tramos) {
    const d = unitario(menos(b, a)), l = largo(menos(b, a));
    if (!trenzado) {
      salida.tubos.push(tubito(parte, [mas(a, por(d, pellizco)), mas(b, por(d, -pellizco))]));
      continue;
    }
    // Dos tubitos que giran uno alrededor del otro (una vuelta cada 14 cm).
    const n1 = perpendicular(d), n2 = cruz(d, n1);
    for (const fase of [0, Math.PI]) {
      const puntos: Vec3[] = [];
      const pasos = Math.max(4, Math.round(l / 2.5));
      for (let k = 0; k <= pasos; k++) {
        const t = k / pasos, th = fase + (2 * Math.PI * t * l) / 14;
        puntos.push(mas(mas(a, por(d, l * t)), mas(por(n1, Math.cos(th) * g * 0.42), por(n2, Math.sin(th) * g * 0.42))));
      }
      salida.tubos.push(tubito(parte, puntos));
    }
  }
}

/**
 * Un abanico de lazos, burbujas o flecos desde `origen` alrededor de `eje`, abierto en el plano de `eje` y `lateral`.
 * Los lazos se abren hacia `anchoHacia` (por omisión, en el mismo plano del abanico).
 */
function abanico(a: Abanico, origen: Vec3, eje: Vec3, lateral: Vec3, salida: Salida, anchoHacia?: Vec3) {
  const n = Math.max(1, Math.min(14, Math.round(a.cantidad)));
  const plano = unitario(lateral);
  for (let i = 0; i < n; i++) {
    const b = rad((i - (n - 1) / 2) * a.aberturaGrados);
    const radial = unitario(mas(por(eje, Math.cos(b)), por(plano, Math.sin(b))));
    const perp = unitario(mas(por(eje, -Math.sin(b)), por(plano, Math.cos(b))));
    if (a.estilo === "lazos") salida.tubos.push(tubito(a, lazo(origen, radial, anchoHacia ?? perp, a.largoCm, Math.max(a.grosorCm, a.anchoCm ?? a.largoCm * 0.5))));
    else {
      // Los flecos varían un poco de largo, como tubitos desinflados de verdad.
      const l = a.estilo === "flecos" ? a.largoCm * (0.85 + 0.15 * Math.cos(i * 2.1)) : a.largoCm;
      salida.tubos.push(tubito(a, [mas(origen, por(radial, a.grosorCm * 0.2)), mas(origen, por(radial, l))]));
    }
  }
}

type CadenaArmada = { tramos: Array<[Vec3, Vec3]>; punta: Vec3; direccion: Vec3 };

/** Las posiciones de una extremidad (sin dibujarla): de la raíz, burbuja a burbuja. `marco(a, f)` da la dirección. */
function cadena(raiz: Vec3, e: Pick<Extremidad, "burbujasCm">, angulos: number[], adelante: number[], marco: (a: number, f: number) => Vec3): CadenaArmada {
  const tramos: Array<[Vec3, Vec3]> = [];
  let p = raiz, direccion = ARRIBA;
  e.burbujasCm.forEach((l, i) => {
    direccion = marco(ciclo(angulos, i, 0), ciclo(adelante, i, 0));
    const q = mas(p, por(direccion, Math.max(1, l)));
    tramos.push([p, q]);
    p = q;
  });
  return { tramos, punta: p, direccion };
}

/** Dibuja una extremidad ya calculada y su mano o pie. Devuelve dónde quedó la mano (su centro). */
function dibujarExtremidad(e: Extremidad, c: CadenaArmada, lateral: Vec3, salida: Salida): Vec3 {
  burbujasDe(e, c.tramos, Boolean(e.trenzado), salida);
  const p = e.punta;
  if (!p) return c.punta;
  if (p.tipo === "burbuja") {
    const fin = mas(c.punta, por(c.direccion, p.largoCm));
    burbujasDe(e, [[c.punta, fin]], false, salida);
    return mas(c.punta, por(c.direccion, p.largoCm / 2));
  }
  if (p.tipo === "globo") {
    const centro = mas(c.punta, por(c.direccion, medioLargo(p.globo) * 0.85));
    salida.globos.push(globoEn(p.globo, centro, c.direccion));
    return centro;
  }
  abanico({ ...e, estilo: "burbujas", cantidad: p.cantidad, largoCm: p.largoCm, aberturaGrados: p.aberturaGrados }, c.punta, c.direccion, lateral, salida);
  return mas(c.punta, por(c.direccion, p.largoCm / 2));
}

/** Lo que baja una extremidad desde su raíz, contando la mano o el pie (para que la figura apoye en la base). */
function caidaDe(e: Extremidad, c: CadenaArmada): number {
  let minimo = 0;
  for (const [a, b] of c.tramos) minimo = Math.min(minimo, a.z - e.grosorCm / 2, b.z - e.grosorCm / 2);
  const p = e.punta;
  if (p?.tipo === "globo") minimo = Math.min(minimo, c.punta.z + c.direccion.z * medioLargo(p.globo) * 0.85 - p.globo.infladoCm / 2);
  else if (p) minimo = Math.min(minimo, c.punta.z + c.direccion.z * p.largoCm - e.grosorCm / 2);
  return -minimo;
}

/** Los anillos de la base, del piso hacia arriba. Devuelve el tope (donde se apoya lo de encima) y su elipsoide. */
function armarBase(anillos: readonly AnilloBase[], salida: Salida, uniones: FiguraArmada["uniones"]): { tope: number; esfera: Esfera | null } {
  let anterior: { z: number; r: number; esfera: Esfera } | null = null;
  for (const [k, a] of anillos.entries()) {
    const n = Math.max(1, Math.min(10, Math.round(a.cantidad)));
    const d = a.infladoCm, r = d / 2;
    const rho = n === 1 ? 0 : n === 2 ? r * 0.92 : (0.46 * d) / Math.sin(Math.PI / n);
    // Cada anillo se mete en los huecos del de abajo.
    const z: number = anterior ? anterior.z + (anterior.r + r) * 0.62 : r;
    if (anterior) uniones.push({ nombre: `base ${k} sobre base ${k - 1}`, holguraCm: r2(z - r - (anterior.z + anterior.r)) });
    // Con 4 (o 2) quedan dos al frente, como un cuarteto visto de frente.
    const giro = Math.PI / 2 + Math.PI / n;
    for (let i = 0; i < n; i++) {
      const ang = giro + (2 * Math.PI * i) / n;
      const fuera = P(Math.cos(ang), Math.sin(ang), 0);
      const codigo = a.codigos[i % Math.max(1, a.codigos.length)] ?? "005";
      salida.globos.push(globoEn({ formatoId: a.formatoId, infladoCm: d, codigo }, mas(P(0, 0, z), por(fuera, rho)), n === 1 ? ARRIBA : mas(fuera, P(0, 0, 0.35))));
    }
    // Su elipsoide (para pegarle cosas): con 1 o 2 globos, el fondo es el del globo; con más, el del frente del anillo.
    anterior = { z, r, esfera: { centro: P(0, 0, z), radio: n <= 2 ? r : rho * 0.75 + r, alto: r } };
  }
  if (!anterior) return { tope: 0, esfera: null };
  return { tope: anterior.z + anterior.r * 0.72, esfera: anterior.esfera };
}

/** Medio alto (de pie) o medio largo (de lado) de un segmento del cuerpo, y su medio ancho. */
function medidasSegmento(s: SegmentoCuerpo): { medio: number; ancho: number } {
  if (s.tipo === "globo") return { medio: medioLargo(s.globo), ancho: s.globo.infladoCm / 2 };
  if (s.tipo === "tubito") return { medio: s.largoCm / 2, ancho: s.tubito.grosorCm / 2 };
  const rho = (s.globo.infladoCm / 2) * Math.sqrt(0.3 * Math.max(2, s.cantidad));
  return { medio: rho + s.globo.infladoCm / 2, ancho: rho + s.globo.infladoCm / 2 };
}

/** Dibuja un segmento del cuerpo con su centro en `centro`, a lo largo de `eje` (arriba de pie, a la derecha de lado). */
function dibujarSegmento(s: SegmentoCuerpo, centro: Vec3, eje: Vec3, salida: Salida) {
  if (s.tipo === "globo") {
    const r = s.globo.infladoCm / 2;
    const capas = [...(s.dibujo ? capasDibujo(r, s.dibujo) : []), ...(s.cara ? capasCara(r, s.cara) : [])];
    // Lo impreso va en la cara del globo (hacia quien mira); un Link-O-Loon no lleva impreso en el visor.
    salida.globos.push(globoEn(s.globo, centro, eje, capas.length && !esLink(s.globo.formatoId) ? { en: "cara", capas } : undefined, capas.length ? AL_FRENTE : undefined));
    return;
  }
  if (s.tipo === "tubito") {
    const m = s.largoCm / 2;
    salida.tubos.push(tubito(s.tubito, [mas(centro, por(eje, -m)), mas(centro, por(eje, m))]));
    return;
  }
  // Racimo: globos repartidos en una esfera (espiral de Fibonacci), cada uno mirando hacia fuera.
  const n = Math.max(2, Math.min(14, Math.round(s.cantidad)));
  const rho = (s.globo.infladoCm / 2) * Math.sqrt(0.3 * n);
  for (let k = 0; k < n; k++) {
    const v = 1 - (2 * (k + 0.5)) / n, w = Math.sqrt(1 - v * v), a = k * rad(137.5) + 0.5;
    const fuera = P(w * Math.cos(a), w * Math.sin(a), v);
    salida.globos.push(globoEn(s.globo, mas(centro, por(fuera, rho)), fuera));
  }
}

// ----------------------------------------------------------------------------------------------------------
// La figura
// ----------------------------------------------------------------------------------------------------------

export function armarFiguraTubito(p: PropiedadesFigura): FiguraArmada {
  const salida: Salida = { globos: [], tubos: [] };
  const uniones: FiguraArmada["uniones"] = [];
  const extremidades: ExtremidadArmada[] = [];
  const puntos: Record<string, Vec3> = {};
  const base = armarBase(p.base, salida, uniones);
  const de_lado = p.postura === "horizontal";

  // Las piernas (de pie y sentado) o las patas (de lado), calculadas antes de saber dónde va el cuerpo.
  const marcoFrente = (s: number) => (a: number, f: number) => enPlano(a, f, s);
  const marcoLado = (s: number) => (a: number, f: number) => unitario(P(Math.cos(rad(a)) * Math.cos(rad(f)), s * Math.sin(rad(f)), Math.sin(rad(a)) * Math.cos(rad(f))));
  const angulosDe = (e: Extremidad, s: number) => (s < 0 && e.otroLado ? e.otroLado.angulosGrados : e.angulosGrados);
  const adelanteDe = (e: Extremidad, s: number) => (s < 0 && e.otroLado ? e.otroLado.adelanteGrados ?? e.adelanteGrados ?? [] : e.adelanteGrados ?? []);

  const segmentos = p.cuerpo.length ? p.cuerpo : [];
  const torsos: Esfera[] = [];
  let tope: number;

  if (!de_lado) {
    // ----- De pie o sentado: el cuerpo de abajo arriba.
    const primero = segmentos[0];
    const m0 = primero ? medidasSegmento(primero) : null;
    let centroZ: number;
    if (p.postura === "de_pie" && p.piernas && m0) {
      // Las piernas bajan de la cadera hasta la base: la cadera queda a esa altura.
      let caida = 0;
      for (const s of [1, -1]) caida = Math.max(caida, caidaDe(p.piernas, cadena(P(0, 0, 0), p.piernas, angulosDe(p.piernas, s), adelanteDe(p.piernas, s), marcoFrente(s))));
      const caderaZ = base.tope + caida;
      centroZ = caderaZ + m0.medio * (primero.tipo === "tubito" ? 1 : Math.cos(rad(28)));
    } else {
      centroZ = base.tope + (m0 ? m0.medio * 0.9 : 0);
    }
    if (m0 && base.esfera && !(p.postura === "de_pie" && p.piernas)) uniones.push({ nombre: "cuerpo sobre la base", holguraCm: r2(centroZ - m0.medio - base.tope) });
    let anterior: { z: number; medio: number } | null = null;
    for (const [i, s] of segmentos.entries()) {
      const m = medidasSegmento(s);
      const z: number = anterior ? anterior.z + (anterior.medio + m.medio) * (s.tipo === "tubito" || segmentos[i - 1]?.tipo === "tubito" ? 0.97 : 0.9) : centroZ;
      if (anterior) uniones.push({ nombre: `cuerpo ${i} sobre cuerpo ${i - 1}`, holguraCm: r2(z - m.medio - (anterior.z + anterior.medio)) });
      dibujarSegmento(s, P(0, 0, z), ARRIBA, salida);
      torsos.push({ centro: P(0, 0, z), radio: m.ancho, alto: m.medio });
      anterior = { z, medio: m.medio };
    }
    tope = anterior ? anterior.z + anterior.medio * 0.92 : base.tope;
  } else {
    // ----- De lado: el cuerpo de atrás (izquierda de quien mira) hacia la cabeza (derecha), sobre patas o ruedas.
    const medidas = segmentos.map(medidasSegmento);
    const largoTotal = medidas.reduce((s, m, i) => s + 2 * m.medio * (i ? 0.9 : 1), 0);
    const anchoMax = Math.max(1, ...medidas.map((m) => m.ancho));
    const pares = Math.max(0, Math.min(4, Math.round(p.patasPorLado ?? 2)));
    let alturaCentro = base.tope + anchoMax * 0.9;
    if (p.ruedas) alturaCentro = Math.max(alturaCentro, p.ruedas.infladoCm * 0.5 + p.ruedas.infladoCm * 0.35 + anchoMax * 0.75);
    if (p.piernas && pares > 0) {
      const caida = caidaDe(p.piernas, cadena(P(0, 0, 0), p.piernas, p.piernas.angulosGrados, p.piernas.adelanteGrados ?? [], marcoLado(1)));
      alturaCentro = base.tope + caida + anchoMax * 0.9;
    }
    let x = -largoTotal / 2;
    for (const [i, s] of segmentos.entries()) {
      const m = medidas[i]!;
      if (i) x -= 2 * medidas[i - 1]!.medio * 0.1;
      const centro = P(x + m.medio, 0, alturaCentro);
      dibujarSegmento(s, centro, P(1, 0, 0), salida);
      torsos.push({ centro, radio: m.ancho, alto: m.ancho });
      x += 2 * m.medio;
    }
    tope = alturaCentro + anchoMax;
    // Patas: `pares` por lado, repartidas a lo largo del cuerpo; las de atrás (−y) se ven detrás.
    if (p.piernas && pares > 0) {
      const desde = -largoTotal / 2 + largoTotal * 0.22, hasta = largoTotal / 2 - largoTotal * 0.22;
      for (let k = 0; k < pares; k++) {
        const xk = pares === 1 ? 0 : desde + ((hasta - desde) * k) / (pares - 1);
        for (const s of [1, -1]) {
          // El segmento más cercano y su sección a esa distancia de su centro: la pata nace en su superficie.
          const j = torsos.reduce((mejor, t, i) => (Math.abs(-t.centro.x - xk) < Math.abs(-torsos[mejor]!.centro.x - xk) ? i : mejor), 0);
          const torso = torsos[j]!, h = medidas[j]!.medio;
          const a = Math.max(-0.9 * h, Math.min(0.9 * h, xk + torso.centro.x));
          const seccion = torso.radio * Math.sqrt(1 - (a / h) ** 2);
          const u = unitario({ x: 0, y: 0.45, z: -0.9 });
          const raiz = P(-torso.centro.x + a, s * seccion * u.y, torso.centro.z + seccion * u.z);
          const c = cadena(raiz, p.piernas, p.piernas.angulosGrados, p.piernas.adelanteGrados ?? [], marcoLado(s));
          const pie = dibujarExtremidad(p.piernas, c, P(0, s, 0), salida);
          extremidades.push({ nombre: `pata ${k + 1} ${s > 0 ? "delante" : "detrás"}`, raiz, tramos: c.tramos });
          if (k === 0) puntos[`pie_${s > 0 ? "derecho" : "izquierdo"}`] = redondo(pie);
        }
      }
    }
    if (p.ruedas) {
      const ejes = Math.max(1, Math.min(4, Math.round(p.ruedas.ejes)));
      const rw = p.ruedas.infladoCm / 2;
      for (let k = 0; k < ejes; k++) {
        const xk = ejes === 1 ? 0 : -largoTotal / 2 + rw * 1.1 + ((largoTotal - 2.2 * rw) * k) / (ejes - 1);
        for (const s of [1, -1]) {
          const centro = P(xk, s * anchoMax * 0.72, rw);
          salida.globos.push(globoEn(p.ruedas, centro, P(0, s, 0), { en: "punta", capas: estampadoAccesorio("rin", rw, s).capas }, ARRIBA));
        }
      }
      uniones.push({ nombre: "cuerpo sobre las ruedas", holguraCm: r2(alturaCentro - anchoMax - (2 * rw)) });
    }
    if (base.esfera && !(p.piernas && pares > 0)) uniones.push({ nombre: "cuerpo sobre la base", holguraCm: r2(alturaCentro - anchoMax - base.tope) });
  }

  // Lo de arriba del cuerpo (de pie o sentado) o su frente (de lado): de ahí salen cuello y cabeza.
  const torsoArriba: Esfera | null = torsos.length ? torsos[torsos.length - 1]! : base.esfera;
  const torsoAbajo: Esfera | null = torsos.length ? torsos[0]! : base.esfera;
  let cuelloZ = tope;
  let cabeza: Esfera | null = null;
  if (!de_lado) {
    if (p.cuello) {
      const n = Math.max(1, Math.min(10, Math.round(p.cuello.cantidad)));
      const d = p.cuello.infladoCm, r = d / 2;
      const z = tope + r * 0.35;
      const rho = n === 1 ? 0 : n === 2 ? r * 0.95 : (0.46 * d) / Math.sin(Math.PI / n);
      for (let i = 0; i < n; i++) {
        const ang = Math.PI / 2 + Math.PI / n + (2 * Math.PI * i) / n;
        const fuera = n === 2 ? P(i === 0 ? 1 : -1, 0.15, 0) : P(Math.cos(ang), Math.sin(ang), 0);
        salida.globos.push(globoEn(p.cuello, mas(P(0, 0, z), por(unitario(fuera), rho)), n === 1 ? ARRIBA : fuera));
      }
      cuelloZ = z + r * 0.55;
      uniones.push({ nombre: "cuello sobre el cuerpo", holguraCm: r2(z - r - tope) });
    }
    if (p.cabeza) {
      const h = medioLargo(p.cabeza), r = p.cabeza.infladoCm / 2;
      const centro = P(0, 0, cuelloZ + h * 0.92);
      const capas = p.cabeza.cara && !esLink(p.cabeza.formatoId) ? capasCara(r, p.cabeza.cara) : [];
      salida.globos.push(globoEn(p.cabeza, centro, ARRIBA, capas.length ? { en: "cara", capas } : undefined, AL_FRENTE));
      cabeza = { centro, radio: r, alto: h };
      uniones.push({ nombre: "cabeza sobre el cuello", holguraCm: r2(centro.z - h - cuelloZ) });
    }
  } else if (p.cabeza && torsoArriba) {
    // De lado: la cabeza sale del frente del cuerpo, hacia `cabezaGrados`.
    const h = medioLargo(p.cabeza), r = p.cabeza.infladoCm / 2;
    const frente = torsoArriba;
    const medioFrente = segmentos.length ? medidasSegmento(segmentos[segmentos.length - 1]!).medio : frente.radio;
    const dir = enPlano(p.cabezaGrados ?? 35, 0, 1);
    // Del centro del segmento de adelante hasta su borde (elipse de medio largo × medio ancho), más la cabeza.
    const radioBorde = (medioFrente * frente.radio) / Math.max(1e-6, Math.hypot(frente.radio * dir.x, medioFrente * dir.z));
    const centro = mas(frente.centro, por(dir, (radioBorde + r) * 0.9));
    const capas = p.cabeza.cara && !esLink(p.cabeza.formatoId) ? capasCara(r, p.cabeza.cara) : [];
    salida.globos.push(globoEn(p.cabeza, centro, ARRIBA, capas.length ? { en: "cara", capas } : undefined, AL_FRENTE));
    cabeza = { centro, radio: r, alto: h };
    uniones.push({ nombre: "cabeza junto al cuerpo", holguraCm: r2(largo(menos(centro, frente.centro)) - radioBorde - r) });
  }

  // Brazos (de pie y sentado): de los hombros del segmento de arriba.
  if (!de_lado && p.brazos && torsoArriba) {
    const seg = segmentos[segmentos.length - 1];
    for (const s of [1, -1]) {
      const raiz = seg?.tipo === "tubito"
        ? mas(torsoArriba.centro, P(s * torsoArriba.radio, 0, torsoArriba.alto * 0.62))
        : sobre(torsoArriba, s * Math.cos(rad(32)), 0, Math.sin(rad(32)));
      const c = cadena(raiz, p.brazos, angulosDe(p.brazos, s), adelanteDe(p.brazos, s), marcoFrente(s));
      const mano = dibujarExtremidad(p.brazos, c, AL_FRENTE, salida);
      const lado = s > 0 ? "derecho" : "izquierdo";
      extremidades.push({ nombre: `brazo ${lado}`, raiz, tramos: c.tramos });
      puntos[`hombro_${lado}`] = redondo(raiz);
      puntos[`mano_${lado}`] = redondo(mano);
    }
  }
  // Piernas (de pie y sentado): de la cadera del segmento de abajo.
  if (!de_lado && p.piernas && torsoAbajo) {
    const seg = segmentos[0];
    for (const s of [1, -1]) {
      const raiz = seg?.tipo === "tubito"
        ? mas(torsoAbajo.centro, P(s * torsoAbajo.radio, 0, -torsoAbajo.alto))
        : p.postura === "sentado"
          ? sobre(torsoAbajo, s * 0.45, 0.55, -0.7)
          : sobre(torsoAbajo, s * Math.sin(rad(28)), 0, -Math.cos(rad(28)));
      const c = cadena(raiz, p.piernas, angulosDe(p.piernas, s), adelanteDe(p.piernas, s), marcoFrente(s));
      const pie = dibujarExtremidad(p.piernas, c, AL_FRENTE, salida);
      const lado = s > 0 ? "derecho" : "izquierdo";
      extremidades.push({ nombre: `pierna ${lado}`, raiz, tramos: c.tramos });
      puntos[`cadera_${lado}`] = redondo(raiz);
      puntos[`pie_${lado}`] = redondo(pie);
    }
  }

  // ----- Puntos con nombre.
  const cabezaOTorso = cabeza ?? torsoArriba ?? { centro: P(0, 0, tope), radio: 5, alto: 5 };
  const torso = torsoArriba ?? cabezaOTorso;
  const atras = de_lado ? (torsos[0] ?? torso) : torsoAbajo ?? torso;
  // De lado, el lomo, la espalda y la barriga son los del segmento del medio.
  const medio = de_lado && torsos.length ? torsos[Math.floor((torsos.length - 1) / 2)]! : torso;
  const fijos: Record<string, Vec3> = {
    coronilla: sobre(cabezaOTorso, 0, 0, 1),
    cara: sobre(cabezaOTorso, 0, 1, 0.05),
    cuello: de_lado ? sobre(torso, 0.7, 0.3, 0.6) : P(0, cabezaOTorso.radio * 0.15, cuelloZ),
    pecho: de_lado ? sobre(torso, 0.85, 0.25, 0.1) : sobre(torso, 0, 1, 0.25),
    barriga: de_lado ? sobre(medio, 0, 0.75, -0.5) : sobre(torsoAbajo ?? torso, 0, 1, -0.15),
    lomo: sobre(medio, 0, 0, 1),
    espalda: de_lado ? sobre(medio, 0, -1, 0.3) : sobre(torso, 0, -1, 0.2),
    cola: de_lado ? mas(atras.centro, P(-(segmentos[0] ? medidasSegmento(segmentos[0]).medio : atras.radio) * 0.95, 0, atras.radio * 0.25)) : sobre(atras, -0.35, -0.9, -0.3),
    base: P(0, 0, base.tope),
  };
  for (const [nombre, v] of Object.entries(fijos)) puntos[nombre] = redondo(v);
  for (const s of [1, -1]) {
    const lado = s > 0 ? "derecho" : "izquierdo";
    puntos[`oreja_${lado}`] = redondo(sobre(cabezaOTorso, s * 0.75, 0, 0.66));
    const siFalta = (clave: string, v: Vec3) => { if (!puntos[clave]) puntos[clave] = redondo(v); };
    siFalta(`hombro_${lado}`, sobre(torso, s * 0.9, 0, 0.4));
    siFalta(`mano_${lado}`, puntos[`hombro_${lado}`]!);
    siFalta(`cadera_${lado}`, sobre(torsoAbajo ?? torso, s * 0.5, 0, -0.85));
    siFalta(`pie_${lado}`, P(s * (base.esfera?.radio ?? torso.radio) * 0.5, 0, Math.max(0, base.tope * 0.5)));
  }
  const fueraDe: Record<PuntoFigura, Vec3> = {
    coronilla: ARRIBA, cara: AL_FRENTE, oreja: P(1, 0, 0.6), cuello: AL_FRENTE, pecho: AL_FRENTE, barriga: AL_FRENTE, lomo: ARRIBA, espalda: P(0, -1, 0), cola: de_lado ? P(-1, 0, 0.3) : P(0, -1, 0),
    hombro: P(1, 0, 0), mano: P(1, 0, 0), cadera: P(1, 0, -0.5), pie: P(1, 0, -0.5), base: ARRIBA,
  };
  const conLado = (en: PuntoFigura) => en === "oreja" || en === "hombro" || en === "mano" || en === "cadera" || en === "pie";

  for (const acc of p.accesorios) {
    for (const s of acc.par ? [1, -1] : [1]) {
      const lado = s > 0 ? "derecho" : "izquierdo";
      const base0 = conLado(acc.en) ? puntos[`${acc.en}_${lado}`]! : puntos[acc.en]!;
      const [cd, cf, ca] = acc.corrimientoCm ?? [0, 0, 0];
      const origen = mas(base0, P(s * cd, cf, ca));
      const fuera0 = fueraDe[acc.en];
      const fuera = conLado(acc.en) ? unitario(P(s * -fuera0.x, fuera0.y, fuera0.z)) : fuera0;
      accesorio(acc.forma, origen, s, fuera, salida);
    }
  }

  return cerrar(salida, extremidades, uniones, puntos);
}

/** Un accesorio en `origen`, del lado `s`, con `fuera` la normal de la superficie en ese punto. */
function accesorio(f: FormaAccesorio, origen: Vec3, s: number, fuera: Vec3, salida: Salida) {
  switch (f.tipo) {
    case "sombrero": {
      const giro = rad(f.inclinacionGrados) * s;
      // Inclinado de lado (en el plano de frente) alrededor del origen.
      const inc = (v: Vec3): Vec3 => {
        const d = menos(v, origen);
        const derecha = -d.x, arriba = d.z;
        return mas(origen, P(derecha * Math.cos(giro) + arriba * Math.sin(giro), d.y, -derecha * Math.sin(giro) + arriba * Math.cos(giro)));
      };
      const arriba = inc(mas(origen, ARRIBA));
      const eje = unitario(menos(arriba, origen));
      let alto = 0;
      if (f.ala) {
        const g = f.ala.grosorCm;
        if (f.ala.estilo === "aro") {
          const aro = Array.from({ length: 28 }, (_, i) => inc(mas(origen, P(f.ala!.radioCm * Math.cos((2 * Math.PI * i) / 28), f.ala!.radioCm * 0.9 * Math.sin((2 * Math.PI * i) / 28), g * 0.3))));
          salida.tubos.push(tubito(f.ala, aro, true));
        } else {
          const n = Math.max(4, Math.min(16, Math.round(f.ala.cantidad ?? 10)));
          for (let i = 0; i < n; i++) {
            const a = (2 * Math.PI * (i + 0.5)) / n;
            const fuera2 = P(Math.cos(a), Math.sin(a) * 0.9, -0.12);
            salida.tubos.push(tubito(f.ala, [inc(mas(origen, mas(por(fuera2, f.ala.radioCm * 0.35), P(0, 0, g * 0.4)))), inc(mas(origen, por(fuera2, f.ala.radioCm * (0.9 + 0.1 * Math.cos(i * 1.7)))))]));
          }
        }
        alto = g * 0.5;
      }
      let tope = mas(origen, por(eje, alto));
      if (f.copa) {
        if ("globo" in f.copa) {
          const h = medioLargo(f.copa.globo);
          salida.globos.push(globoEn(f.copa.globo, mas(origen, por(eje, alto + h * 0.75)), eje));
          tope = mas(origen, por(eje, alto + h * 1.6));
        } else {
          salida.tubos.push(tubito(f.copa.tubito, [mas(origen, por(eje, alto)), mas(origen, por(eje, alto + f.copa.largoCm))]));
          tope = mas(origen, por(eje, alto + f.copa.largoCm));
        }
      }
      if (f.cinta) {
        // Alrededor de la copa (globo o tubito), un poco arriba del ala.
        const radio = !f.copa ? (f.ala?.radioCm ?? 10) * 0.6 : "globo" in f.copa ? f.copa.globo.infladoCm * 0.42 : f.copa.tubito.grosorCm * 0.5 + f.cinta.grosorCm * 0.4;
        const h = !f.copa ? alto + f.cinta.grosorCm * 0.6 : "globo" in f.copa ? alto + medioLargo(f.copa.globo) * 0.25 : alto + f.copa.largoCm * 0.3;
        const aro = Array.from({ length: 24 }, (_, i) => inc(mas(origen, P(radio * Math.cos((2 * Math.PI * i) / 24), radio * Math.sin((2 * Math.PI * i) / 24), h))));
        salida.tubos.push(tubito(f.cinta, aro, true));
      }
      if (f.pompon) salida.globos.push(globoEn(f.pompon, mas(tope, por(eje, f.pompon.infladoCm * 0.3)), eje));
      return;
    }
    case "mono": {
      if (f.lazos) {
        for (const lado of [1, -1]) {
          for (const b of [16, -16]) {
            const radial = enPlano(b, 8, lado);
            salida.tubos.push(tubito(f.lazos, lazo(origen, radial, enPlano(b + 90, 0, lado), f.lazos.largoCm, f.lazos.anchoCm)));
          }
        }
      }
      if (f.globos) for (const lado of [1, -1]) salida.globos.push(globoEn(f.globos, mas(origen, P(lado * medioLargo(f.globos) * 0.85, 1, 0)), P(lado, 0.2, 0)));
      if (f.centro) salida.globos.push(globoEn(f.centro, mas(origen, P(0, f.centro.infladoCm * 0.35, 0)), AL_FRENTE));
      return;
    }
    case "orejas": {
      const dir = enPlano(f.anguloGrados, 0, s);
      if (f.estilo === "globo" && f.globo) salida.globos.push(globoEn(f.globo, mas(origen, por(dir, medioLargo(f.globo) * 0.8)), dir));
      else if (f.estilo === "lazo" && f.tubito) salida.tubos.push(tubito(f.tubito, lazo(origen, dir, enPlano(f.anguloGrados + 90, 0, s), f.largoCm, f.anchoCm ?? f.largoCm * 0.6)));
      else if (f.tubito) salida.tubos.push(tubito(f.tubito, [origen, mas(origen, por(dir, f.largoCm))]));
      return;
    }
    case "antenas": {
      const dir = enPlano(f.anguloGrados, 0, s);
      const fin = mas(origen, por(dir, f.largoCm));
      // Una antena levemente curva: el punto del medio se abre hacia fuera.
      const medio = mas(mas(origen, por(dir, f.largoCm / 2)), por(enPlano(f.anguloGrados - 90, 0, s), f.largoCm * 0.08));
      salida.tubos.push(tubito(f.tubito, [origen, medio, fin]));
      if (f.punta) salida.globos.push(globoEn(f.punta, mas(fin, por(dir, medioLargo(f.punta) * 0.8)), dir));
      return;
    }
    case "alas": {
      const eje = enPlano(f.anguloGrados, f.adelanteGrados ?? -15, s);
      abanico(f.abanico, origen, eje, enPlano(f.anguloGrados + 90, 0, s), salida);
      return;
    }
    case "pico": {
      const b = rad(f.anguloGrados ?? 0);
      // Hacia quien mira; el abanico se abre de arriba abajo y cada lazo de lado a lado (como dos labios).
      const eje = unitario(P(0, Math.cos(b), Math.sin(b)));
      abanico(f.abanico, origen, eje, unitario(P(0, -Math.sin(b), Math.cos(b))), salida, P(1, 0, 0));
      return;
    }
    case "cresta": {
      const eje = enPlano(f.anguloGrados, f.adelanteGrados ?? 0, s);
      abanico(f.abanico, origen, eje, enPlano(f.anguloGrados + 90, 0, s), salida);
      return;
    }
    case "globo": {
      const dir = enPlano(f.anguloGrados, f.adelanteGrados ?? 0, s);
      const r = f.globo.infladoCm / 2;
      const est = f.estampado ? estampadoAccesorio(f.estampado, r, s) : undefined;
      // Los ojos y narices miran al frente con su impreso en la punta; la ventana va en la cara.
      const frente = est?.en === "punta" ? ARRIBA : AL_FRENTE;
      salida.globos.push(globoEn(f.globo, mas(origen, por(dir, medioLargo(f.globo) * 0.7)), dir, est && !esLink(f.globo.formatoId) ? est : undefined, est ? frente : undefined));
      return;
    }
    case "burbujas": {
      const c = cadena(origen, { burbujasCm: f.largosCm }, f.angulosGrados, f.adelanteGrados ?? [], (a, fr) => enPlano(a, fr, s));
      burbujasDe(f.tubito, c.tramos, false, salida);
      return;
    }
    case "cola": {
      const dir = enPlano(f.anguloGrados, f.adelanteGrados ?? 0, s);
      const L = f.largoCm;
      if (f.estilo === "plumas") {
        abanico({ ...f.tubito, estilo: "burbujas", cantidad: f.cantidad ?? 3, largoCm: L, aberturaGrados: 16 }, origen, dir, enPlano(f.anguloGrados + 90, 0, s), salida);
      } else if (f.estilo === "rizo") {
        // Un resorte: avanza hacia `dir` dando vueltas alrededor de él.
        const n1 = perpendicular(dir), n2 = cruz(dir, n1);
        const vueltas = 2.5, radio = Math.max(f.tubito.grosorCm * 0.9, L * 0.16);
        const puntos2: Vec3[] = [];
        for (let i = 0; i <= 40; i++) {
          const t = i / 40, a = 2 * Math.PI * vueltas * t;
          puntos2.push(mas(mas(origen, por(dir, L * 0.75 * t + radio)), mas(por(n1, radio * (Math.cos(a) - 1)), por(n2, radio * Math.sin(a)))));
        }
        salida.tubos.push(tubito(f.tubito, [origen, ...puntos2]));
      } else {
        // Curva: sale hacia `dir` y se va doblando `giroGrados` (la cola de un gato que sube y se engancha).
        const giro = f.giroGrados ?? 70;
        const d2 = enPlano(f.anguloGrados + giro, f.adelanteGrados ?? 0, s), d3 = enPlano(f.anguloGrados + 2 * giro, f.adelanteGrados ?? 0, s);
        const p1 = mas(origen, por(dir, L * 0.45)), p2 = mas(p1, por(d2, L * 0.4)), p3 = mas(p2, por(d3, L * 0.18));
        const bezier = (t: number): Vec3 => mas(mas(por(origen, (1 - t) ** 3), por(p1, 3 * (1 - t) ** 2 * t)), mas(por(p2, 3 * (1 - t) * t * t), por(p3, t ** 3)));
        salida.tubos.push(tubito(f.tubito, Array.from({ length: 13 }, (_, i) => bezier(i / 12))));
      }
      return;
    }
    case "aro": {
      const desde = f.desdeGrados, hasta = f.hastaGrados;
      const completo = Math.abs(hasta - desde) >= 359;
      const n = Math.max(6, Math.round(Math.abs(hasta - desde) / 10));
      const puntos2: Vec3[] = [];
      for (let i = 0; i < (completo ? n : n + 1); i++) {
        const a = rad(desde + ((hasta - desde) * i) / n);
        const u = f.radioCm * Math.cos(a), v = f.radioCm * Math.sin(a);
        puntos2.push(mas(origen, f.plano === "frente" ? P(s * u, 0, v) : f.plano === "lado" ? P(0, u, v) : P(s * u, v, 0)));
      }
      salida.tubos.push(tubito(f.tubito, puntos2, completo));
      return;
    }
    case "bufanda": {
      // Tubitos trenzados alrededor de un aro horizontal (la bufanda del muñeco de nieve).
      const k = Math.max(1, Math.min(4, f.codigos.length));
      for (let j = 0; j < k; j++) {
        const puntos2: Vec3[] = [];
        for (let i = 0; i < 48; i++) {
          const th = (2 * Math.PI * i) / 48, fase = (2 * Math.PI * j) / k + th * 9;
          const radial = P(Math.cos(th), Math.sin(th), 0);
          puntos2.push(mas(origen, mas(por(radial, f.radioCm + Math.cos(fase) * f.grosorCm * 0.55), P(0, 0, Math.sin(fase) * f.grosorCm * 0.55))));
        }
        salida.tubos.push(tubito({ formatoId: f.formatoId, grosorCm: f.grosorCm, codigo: f.codigos[j]! }, puntos2, true));
      }
      return;
    }
  }
}

/** Lo más bajo de la figura (cm): el fondo de cada globo (su elipsoide) y de cada tubito. */
function pisoDe(salida: Salida): number {
  let minimo = Infinity;
  for (const g of salida.globos) {
    const c = mas(g.nudo, por(g.direccion, centroCuerpo(esLink(g.formatoId) ? "link" : "redondo", g.infladoCm)));
    const h = medioLargo(g), r = g.infladoCm / 2, dz = g.direccion.z;
    minimo = Math.min(minimo, c.z - Math.sqrt((h * dz) ** 2 + r * r * (1 - dz * dz)));
  }
  for (const t of salida.tubos) for (const q of t.puntos) minimo = Math.min(minimo, q.z - t.grosorCm / 2);
  return Number.isFinite(minimo) ? minimo : 0;
}

/**
 * Medidas finales: alto, ancho, radio de frente y fondo (como `figura` de Halloween). Antes, la figura se apoya en
 * el piso (lo más bajo en z = 0): unas patas cortas o una cabeza que cuelga no la dejan flotando ni enterrada.
 */
function cerrar(salida: Salida, extremidades: ExtremidadArmada[], uniones: FiguraArmada["uniones"], puntos: Record<string, Vec3>): FiguraArmada {
  const dz = -pisoDe(salida);
  if (Math.abs(dz) > 0.01) {
    const subir = (v: Vec3): Vec3 => redondo({ x: v.x, y: v.y, z: v.z + dz });
    salida = { globos: salida.globos.map((g) => ({ ...g, nudo: subir(g.nudo) })), tubos: salida.tubos.map((t) => ({ ...t, puntos: t.puntos.map(subir) })) };
    extremidades = extremidades.map((e) => ({ ...e, raiz: subir(e.raiz), tramos: e.tramos.map(([a, b]): [Vec3, Vec3] => [subir(a), subir(b)]) }));
    puntos = Object.fromEntries(Object.entries(puntos).map(([k, v]) => [k, subir(v)]));
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, fondo = 0;
  const meter = (p: Vec3, r: number) => { minX = Math.min(minX, p.x - r); maxX = Math.max(maxX, p.x + r); minZ = Math.min(minZ, p.z - r); maxZ = Math.max(maxZ, p.z + r); };
  for (const g of salida.globos) {
    const c = mas(g.nudo, por(g.direccion, centroCuerpo(esLink(g.formatoId) ? "link" : "redondo", g.infladoCm)));
    meter(c, g.infladoCm / 2);
    fondo = Math.max(fondo, -(c.y - g.infladoCm / 2), -g.nudo.y);
  }
  for (const t of salida.tubos) for (const q of t.puntos) { meter(q, t.grosorCm / 2); fondo = Math.max(fondo, -(q.y - t.grosorCm / 2)); }
  const ancho = Number.isFinite(minX) ? maxX - minX : 0, alto = Number.isFinite(minZ) ? maxZ - Math.min(0, minZ) : 0;
  return {
    globos: salida.globos, tubos: salida.tubos,
    radioCm: r2(Math.max(ancho, Number.isFinite(minZ) ? maxZ - minZ : 0) / 2), fondoCm: r2(fondo), altoCm: r2(alto), anchoCm: r2(ancho),
    extremidades, uniones, puntos,
  };
}

/** Qué es, en inglés y corto (para la foto con IA). */
export function figuraEnIngles(p: PropiedadesFigura): string {
  return p.queEs;
}

// ----------------------------------------------------------------------------------------------------------
// Plantillas (punto de partida: todo se cambia por propiedades)
// ----------------------------------------------------------------------------------------------------------

const G = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });
const T = (formatoId: string, grosorCm: number, codigo: string): ParteTubito => ({ formatoId, grosorCm, codigo });
const TINTA = "#1b1b1b";

export type PlantillaFigura = { id: string; nombre: string; descripcion: string; decoracion: DecoracionFigura };

/** Las plantillas del generador: personaje de pie, sentado saludando, animal de cuatro patas, ave, insecto, auto y la base. */
export const PLANTILLAS_FIGURA: readonly PlantillaFigura[] = [
  {
    id: "figura_de_pie", nombre: "Muñeco de pie",
    descripcion: "Plantilla: base de cuarteto R-12, piernas y brazos de T-260 en dos burbujas, cuerpo R-12, cabeza R-12 con cara y bombín de tubito.",
    decoracion: {
      tipo: "figura", propiedades: {
        postura: "de_pie", queEs: "a standing twisted-balloon doll with a round balloon head, a smiling printed face and a little hat, on a balloon base",
        base: [{ formatoId: "R-12", infladoCm: 25, codigos: ["041"], cantidad: 4 }],
        piernas: { ...T("T-260", 4.5, "041"), burbujasCm: [14, 13], angulosGrados: [-90], punta: { tipo: "globo", globo: G("R-5", 8, "080") } },
        cuerpo: [{ tipo: "globo", globo: G("R-12", 26, "015") }],
        cuello: { ...G("R-5", 9, "020"), cantidad: 1 },
        cabeza: { ...G("R-12", 24, "060"), cara: { ojos: { estilo: "puntos", hex: TINTA }, boca: { estilo: "sonrisa", hex: TINTA }, mejillas: { hex: "#f08f8f" }, bigote: null, nariz: null, cejas: null } },
        brazos: { ...T("T-260", 4.5, "015"), burbujasCm: [12, 11], angulosGrados: [-50, -78], punta: { tipo: "globo", globo: G("R-5", 7, "060") } },
        accesorios: [{ en: "coronilla", corrimientoCm: [0, 0, -3], forma: { tipo: "sombrero", ala: { ...T("T-260", 4, "080"), estilo: "aro", radioCm: 11 }, copa: { globo: G("R-9", 15, "080") }, cinta: T("T-160", 2.2, "015"), pompon: null, inclinacionGrados: 12 } }],
      },
    },
  },
  {
    id: "figura_saludando", nombre: "Muñeca sentada saludando",
    descripcion: "Plantilla: sentada sobre tres R-12, un brazo arriba saludando con dedos de burbuja, piernas al frente y moño de lazos en la cabeza.",
    decoracion: {
      tipo: "figura", propiedades: {
        postura: "sentado", queEs: "a sitting twisted-balloon doll waving one hand, with a printed smiling face and a bow on her head",
        base: [{ formatoId: "R-12", infladoCm: 26, codigos: ["012"], cantidad: 3 }],
        piernas: { ...T("T-260", 4.5, "060"), burbujasCm: [12, 11], angulosGrados: [-25, -90], adelanteGrados: [65, 15], punta: { tipo: "globo", globo: G("R-5", 8, "012") } },
        cuerpo: [{ tipo: "globo", globo: G("R-12", 26, "009") }],
        cuello: { ...G("R-5", 9, "012"), cantidad: 2 },
        cabeza: { ...G("R-12", 24, "060"), cara: { ojos: { estilo: "ovalos", hex: "#3b2a1e" }, boca: { estilo: "sonrisa", hex: "#c0272d" }, mejillas: { hex: "#f08f8f" }, bigote: null, nariz: null, cejas: null } },
        brazos: { ...T("T-260", 4.5, "060"), burbujasCm: [11, 10], angulosGrados: [-60, -82], adelanteGrados: [15], punta: { tipo: "dedos", cantidad: 3, largoCm: 4, aberturaGrados: 32 }, otroLado: { angulosGrados: [35, 78], adelanteGrados: [10] } },
        accesorios: [{ en: "coronilla", corrimientoCm: [5, 0, -3], forma: { tipo: "mono", lazos: { ...T("T-260", 3.5, "012"), largoCm: 9, anchoCm: 6 }, globos: null, centro: G("R-5", 6, "009") } }],
      },
    },
  },
  {
    id: "figura_perrito", nombre: "Perrito (4 patas)",
    descripcion: "Plantilla de animal de cuatro patas: cuerpo R-12 de lado, patas de T-260 en dos burbujas, cabeza R-9 con cara, orejas de lazo y cola curva.",
    decoracion: {
      tipo: "figura", propiedades: {
        postura: "horizontal", queEs: "a four-legged balloon puppy seen from the side with a printed face, floppy loop ears and a curled tail",
        base: [], patasPorLado: 2,
        piernas: { ...T("T-260", 4.5, "073"), burbujasCm: [7, 6], angulosGrados: [-90], adelanteGrados: [6], punta: { tipo: "burbuja", largoCm: 3 } },
        cuerpo: [{ tipo: "globo", globo: G("R-12", 24, "073") }],
        cuello: null,
        cabeza: { ...G("R-9", 19, "073"), cara: { ojos: { estilo: "puntos", hex: TINTA }, boca: { estilo: "sonrisa", hex: TINTA }, mejillas: null, bigote: null, nariz: { estilo: "punto", hex: TINTA }, cejas: null } },
        cabezaGrados: 40, brazos: null,
        accesorios: [
          { en: "oreja", par: true, forma: { tipo: "orejas", estilo: "lazo", tubito: T("T-260", 4, "074"), largoCm: 12, anchoCm: 6, anguloGrados: -55 } },
          { en: "cola", forma: { tipo: "cola", estilo: "curva", tubito: T("T-260", 4, "073"), largoCm: 18, anguloGrados: 130, giroGrados: -35 } },
        ],
      },
    },
  },
  {
    id: "figura_pajaro", nombre: "Pájaro",
    descripcion: "Plantilla de ave: cuerpo Link-O-Loon 12, ojos R-5 con pupila, pico de lazos, alas de lazos, cresta de T-160 y cola de plumas, sobre patitas de R-5.",
    decoracion: {
      tipo: "figura", propiedades: {
        postura: "de_pie", queEs: "a round balloon bird with googly eyes, a twisted-balloon beak, loop wings and a feather tail",
        base: [{ formatoId: "R-5", infladoCm: 10, codigos: ["061"], cantidad: 5 }],
        piernas: null, cuerpo: [{ tipo: "globo", globo: G("LOL-12", 28, "040") }], cuello: null, cabeza: null, brazos: null,
        accesorios: [
          { en: "pecho", par: true, corrimientoCm: [4.5, 0, 6], forma: { tipo: "globo", globo: G("R-5", 7, "005"), anguloGrados: 30, adelanteGrados: 72, estampado: "ojo" } },
          { en: "pecho", corrimientoCm: [0, 0, 0], forma: { tipo: "pico", abanico: { ...T("T-260", 3.5, "020"), estilo: "lazos", cantidad: 2, largoCm: 7, anchoCm: 4, aberturaGrados: 50 } } },
          { en: "hombro", par: true, forma: { tipo: "alas", abanico: { ...T("T-260", 4, "040"), estilo: "lazos", cantidad: 2, largoCm: 17, anchoCm: 7, aberturaGrados: 26 }, anguloGrados: 5 } },
          { en: "coronilla", forma: { tipo: "cresta", abanico: { ...T("T-160", 2.2, "041"), estilo: "flecos", cantidad: 4, largoCm: 10, aberturaGrados: 18 }, anguloGrados: 90 } },
          { en: "cola", forma: { tipo: "cola", estilo: "plumas", tubito: T("T-260", 4, "041"), largoCm: 16, anguloGrados: 200, adelanteGrados: -30, cantidad: 3 } },
        ],
      },
    },
  },
  {
    id: "figura_abeja", nombre: "Abeja (insecto)",
    descripcion: "Plantilla de insecto: cuerpo R-12 Amarillo con franjas negras impresas, cabeza R-9 Negro con cara, 6 patas de T-160, alas de lazos, antenas y aguijón.",
    decoracion: {
      tipo: "figura", propiedades: {
        postura: "horizontal", queEs: "a yellow balloon bee with black printed stripes, a black head with a smiling face, loop wings and antennae",
        base: [], patasPorLado: 3,
        piernas: { ...T("T-160", 2.2, "080"), burbujasCm: [7, 6], angulosGrados: [-110, -70], adelanteGrados: [25, 0], punta: null },
        cuerpo: [{ tipo: "globo", globo: G("R-12", 26, "020"), dibujo: { estilo: "franjas", hex: TINTA, cantidad: 3 } }],
        cuello: null,
        cabeza: { ...G("R-9", 17, "080"), cara: { ojos: { estilo: "ovalos", hex: TINTA }, boca: { estilo: "sonrisa", hex: "#ffffff" }, mejillas: null, bigote: null, nariz: null, cejas: null } },
        cabezaGrados: 15, brazos: null,
        accesorios: [
          { en: "lomo", par: true, corrimientoCm: [3, -2, -2], forma: { tipo: "alas", abanico: { ...T("T-260", 4, "390"), estilo: "lazos", cantidad: 2, largoCm: 16, anchoCm: 9, aberturaGrados: 30 }, anguloGrados: 72, adelanteGrados: -25 } },
          { en: "coronilla", par: true, corrimientoCm: [3, 0, -1], forma: { tipo: "antenas", tubito: T("T-160", 2, "080"), largoCm: 10, anguloGrados: 62, punta: G("R-5", 5.5, "080") } },
          { en: "cola", forma: { tipo: "burbujas", tubito: T("T-260", 3.5, "080"), largosCm: [6], angulosGrados: [182] } },
        ],
      },
    },
  },
  {
    id: "figura_auto", nombre: "Auto",
    descripcion: "Plantilla de vehículo: carrocería de tres R-12 Rojo de lado, cabina R-12 con ventanas impresas, cuatro ruedas R-9 Negro con rin y faro R-5.",
    decoracion: {
      tipo: "figura", propiedades: {
        postura: "horizontal", queEs: "a red balloon toy car seen from the side with black balloon wheels and a cabin with windows",
        base: [], piernas: null, patasPorLado: 0,
        cuerpo: [{ tipo: "globo", globo: G("R-12", 24, "015") }, { tipo: "globo", globo: G("R-12", 24, "015") }, { tipo: "globo", globo: G("R-12", 24, "015") }],
        cuello: null, cabeza: null, brazos: null,
        ruedas: { ...G("R-9", 18, "080"), ejes: 2 },
        accesorios: [
          { en: "lomo", corrimientoCm: [0, 0, -7], forma: { tipo: "globo", globo: G("R-12", 26, "015"), anguloGrados: 90, estampado: "ventana" } },
          { en: "pecho", corrimientoCm: [0, 2, 0], forma: { tipo: "globo", globo: G("R-5", 7, "020"), anguloGrados: 0, adelanteGrados: 30 } },
        ],
      },
    },
  },
  {
    id: "figura_base", nombre: "Base para figura",
    descripcion: "La base para pararlas: un cuarteto de R-12 en el piso y un anillo de R-9 encima, con los nudos al centro.",
    decoracion: {
      tipo: "figura", propiedades: {
        postura: "de_pie", queEs: "a small round balloon base made of a quad of balloons",
        base: [{ formatoId: "R-12", infladoCm: 26, codigos: ["041"], cantidad: 4 }, { formatoId: "R-9", infladoCm: 16, codigos: ["020"], cantidad: 4 }],
        piernas: null, cuerpo: [], cuello: null, cabeza: null, brazos: null, accesorios: [],
      },
    },
  },
];
