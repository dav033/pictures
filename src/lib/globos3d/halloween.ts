import { altoPerfil, centroCuerpo, perfilRedondo } from "./geometria";
import type { Vec3 } from "./modulos";
import type { CapaEstampado, GloboDecoracion, ParteGlobo, TuboDecoracion } from "./decoraciones";
import type { Decoracion } from "./figuras";

/**
 * Las piezas de Halloween de las 5 fotos del dueño, por propiedades (como las flores y los moños de `figuras.ts`):
 * ojo y racimo de ojos, araña de T-260, calabaza grande con tallo de lazos, calabaza con sombrero de bruja, mano
 * de T-260, ramo de helio con cintas, árbol de tubitos trenzados y, de papel (no son globos), fantasma y telaraña.
 *
 * Se arman en el espacio de las decoraciones: **+y es la cara** (lo que mira a quien ve) y **+z es arriba**; la
 * derecha de quien mira es −x (el giro `deFrente` y la miniatura cambian el signo de x). En una pared quedan de
 * frente y derechas; las que van de pie (calabazas, árbol, ramo, fantasma, ver `esDePie`) también en el piso.
 *
 * - Lo **impreso** (iris y pupila, cara de calabaza, ojos de la araña) es un `estampado` del globo: polígonos de
 *   color sobre su superficie, que el visor pega al látex. No es material: no se cotiza.
 * - Lo de **papel** (fantasma, telaraña, sombrero de bruja, cintas y peso del ramo) son tramos con `papel`: el visor
 *   los pinta mate y sin brillo de látex, y no cuentan en los materiales.
 * Unidades: cm. Todo determinista (sin azar).
 */

// ----------------------------------------------------------------------------------------------------------
// Propiedades
// ----------------------------------------------------------------------------------------------------------

/** Un tubito (T-160/T-260/T-360) con su grosor inflado y su color. */
export type ParteTubito = { formatoId: string; grosorCm: number; codigo: string };

/**
 * Cómo se ve un ojo: iris (opcional), pupila, brillo y venitas. `proporcion` es el diámetro de la mancha sobre el
 * diámetro del globo (pupila de ojo saltón ≈ 0,5; iris de ojo con venas ≈ 0,5 y su pupila ≈ 0,22).
 */
export type EstiloOjo = {
  iris: { hex: string; proporcion: number } | null;
  pupila: { hex: string; proporcion: number };
  brillo: boolean;
  venas: { hex: string; cantidad: number } | null;
};

export type PropiedadesOjo = { globo: ParteGlobo; estilo: EstiloOjo; /** Hacia dónde mira la pupila (0° = derecha, 90° = arriba). */ miradaGrados: number };

export type PropiedadesRacimoOjos = { ojos: ParteGlobo[]; estilo: EstiloOjo };

export type PropiedadesArana = {
  cuerpo: ParteGlobo;
  cabeza: ParteGlobo;
  /** Ojos impresos en la cabeza (blanco con iris de este color y pupila negra); null = cabeza lisa. */
  ojos: { hexIris: string } | null;
  /** «articuladas»: cada pata en tres burbujas con rodilla (foto 3); «lazos»: cada pata un lazo grande (foto 5). */
  patas: ParteTubito & { largoCm: number; estilo: "articuladas" | "lazos" };
  /** Giro en su plano (en una pared, como las agujas del reloj al revés). */
  giroGrados: number;
};

export type PropiedadesCalabaza = {
  globo: ParteGlobo;
  /** Cara impresa (ojos y nariz de triángulo, boca con dientes); null = lisa. */
  cara: { hex: string } | null;
  /** Tallo corto con lazos alrededor y zarcillos de T-160 (foto 2). */
  tallo: (ParteTubito & { lazos: number; largoLazoCm: number; zarcillos: boolean }) | null;
};

export type PropiedadesCalabazaBruja = {
  cabeza: ParteGlobo;
  cuerpo: ParteGlobo;
  cuello: ParteGlobo & { cantidad: number };
  brazos: ParteTubito;
  cara: { hex: string } | null;
  /** Sombrero de papel (no es globo): ala, copa doblada y cinta. */
  sombrero: { hex: string; cinta: string } | null;
};

export type PropiedadesMano = ParteTubito & {
  /** 4 = cuatro dedos; 5 = cuatro y el pulgar. */
  dedos: number;
  largoDedoCm: number;
  aberturaGrados: number;
  /** Las puntas dobladas hacia delante, como una garra. */
  garra: boolean;
  giroGrados: number;
};

export type PropiedadesRamoHelio = {
  globos: ParteGlobo[];
  /** Del piso (el peso) a lo alto del globo de arriba. */
  alturaCm: number;
  cinta: { hex: string };
  peso: { hex: string };
};

export type PropiedadesArbolTrenzado = {
  alturaCm: number;
  ramas: number;
  /** Los tubitos del tronco, torcidos en espiral (y de las ramas, trenzadas de a dos). */
  tronco: ParteTubito & { tubitos: number };
  /** Tubitos que se enrollan por fuera del tronco (los dorados de la foto 4); null = sin ellos. */
  cintas: { formatoId: string; grosorCm: number; codigos: string[] } | null;
  /** La copa: un racimo alargado de globitos, en ciclo de colores. */
  copa: { formatoId: string; infladoCm: number; codigos: string[] };
  /** La base orgánica: globos grandes y acentos pequeños en ciclo. */
  base: { grandes: ParteGlobo; acentos: ParteGlobo[] };
  ojos: boolean;
};

export type PropiedadesFantasma = { altoCm: number; hex: string; hexCara: string; cola: { vueltas: number; largoCm: number } | null };

export type PropiedadesTelarana = { radioCm: number; radios: number; anillos: number; hex: string; grosorCm: number };

export type DecoracionHalloween =
  | { tipo: "ojo"; propiedades: PropiedadesOjo }
  | { tipo: "racimo_ojos"; propiedades: PropiedadesRacimoOjos }
  | { tipo: "arana"; propiedades: PropiedadesArana }
  | { tipo: "calabaza"; propiedades: PropiedadesCalabaza }
  | { tipo: "calabaza_bruja"; propiedades: PropiedadesCalabazaBruja }
  | { tipo: "mano"; propiedades: PropiedadesMano }
  | { tipo: "ramo_helio"; propiedades: PropiedadesRamoHelio }
  | { tipo: "arbol_trenzado"; propiedades: PropiedadesArbolTrenzado }
  | { tipo: "fantasma"; propiedades: PropiedadesFantasma }
  | { tipo: "telarana"; propiedades: PropiedadesTelarana };

export type TipoHalloween = DecoracionHalloween["tipo"];

export const TIPOS_HALLOWEEN: ReadonlySet<string> = new Set<TipoHalloween>(["ojo", "racimo_ojos", "arana", "calabaza", "calabaza_bruja", "mano", "ramo_helio", "arbol_trenzado", "fantasma", "telarana"]);

export function esHalloween(d: Decoracion): d is DecoracionHalloween {
  return TIPOS_HALLOWEEN.has(d.tipo);
}

/** Las que se paran (o cuelgan) derechas: en el piso y del techo van de frente, no acostadas mirando arriba. */
export function esDePie(d: Decoracion): boolean {
  return d.tipo === "calabaza" || d.tipo === "calabaza_bruja" || d.tipo === "ramo_helio" || d.tipo === "arbol_trenzado" || d.tipo === "fantasma";
}

// ----------------------------------------------------------------------------------------------------------
// Ayudas de geometría
// ----------------------------------------------------------------------------------------------------------

const rad = (g: number) => (g * Math.PI) / 180;
/** Un punto por lo que ve quien mira: a su derecha, hacia él (fuera de la pared) y arriba. */
const P = (derecha: number, frente: number, arriba: number): Vec3 => ({ x: -derecha, y: frente, z: arriba });
const mas = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const por = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const unitario = (v: Vec3): Vec3 => { const n = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / n, y: v.y / n, z: v.z / n }; };
const r2 = (v: number) => Math.round(v * 100) / 100;
const redondo = (p: Vec3): Vec3 => ({ x: r2(p.x), y: r2(p.y), z: r2(p.z) });

const ARRIBA = P(0, 0, 1);
const AL_FRENTE = P(0, 1, 0);

/** Un globo redondo con el centro de su cuerpo en `centro` y el cuerpo hacia `direccion` (el nudo queda detrás). */
function globoEn(parte: ParteGlobo, centro: Vec3, direccion: Vec3, extra: Pick<GloboDecoracion, "frente" | "estampado"> = {}): GloboDecoracion {
  const d = unitario(direccion);
  const c = centroCuerpo("redondo", parte.infladoCm);
  return { formatoId: parte.formatoId, infladoCm: parte.infladoCm, codigo: parte.codigo, nudo: redondo(mas(centro, por(d, -c))), direccion: d, cuelloExtraCm: 0, ...extra };
}

function tubito(parte: ParteTubito, puntos: Vec3[], cerrado = false): TuboDecoracion {
  return { formatoId: parte.formatoId, grosorCm: parte.grosorCm, codigo: parte.codigo, puntos: puntos.map(redondo), cerrado };
}

/** Un tramo de papel (no es globo): `relleno` pinta la figura cerrada entera, no solo su borde. */
function papel(hex: string, grosorCm: number, puntos: Vec3[], cerrado = false, relleno = false): TuboDecoracion {
  return { formatoId: "papel", grosorCm, codigo: "papel", puntos: puntos.map(redondo), cerrado, papel: relleno ? { hex, relleno: true } : { hex } };
}

/** Lazo: sale de `desde`, se aleja `largo` hacia `radial` abriéndose `ancho` hacia `lateral` y vuelve. */
function lazo(desde: Vec3, radial: Vec3, lateral: Vec3, largo: number, ancho: number, puntos = 22): Vec3[] {
  const salida: Vec3[] = [];
  for (let i = 0; i <= puntos; i++) {
    const t = i / puntos;
    salida.push(mas(mas(desde, por(radial, largo * Math.sin(Math.PI * t))), por(lateral, (ancho / 2) * Math.sin(2 * Math.PI * t))));
  }
  return salida;
}

/** Contorno de un círculo (o elipse) en el plano del estampado. */
function circulo(cu: number, cv: number, ru: number, rv = ru, n = 24): Array<[number, number]> {
  return Array.from({ length: n }, (_, i): [number, number] => {
    const a = (2 * Math.PI * i) / n;
    return [r2(cu + ru * Math.cos(a)), r2(cv + rv * Math.sin(a))];
  });
}

/** Una línea gruesa (venita, ceja) como polígono: el trazo de ida por un lado y de vuelta por el otro. */
function trazo(puntos: ReadonlyArray<[number, number]>, anchoInicio: number, anchoFin: number): Array<[number, number]> {
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

/** Gira en el plano de la decoración (sobre su eje y, el que mira a quien ve). */
function girarEnPlano(figura: FiguraHalloween, grados: number): FiguraHalloween {
  if (!grados) return figura;
  const c = Math.cos(rad(grados)), s = Math.sin(rad(grados));
  const g = (v: Vec3): Vec3 => ({ x: v.x * c - v.z * s, y: v.y, z: v.x * s + v.z * c });
  return {
    ...figura,
    globos: figura.globos.map((x) => ({ ...x, nudo: redondo(g(x.nudo)), direccion: g(x.direccion), ...(x.frente ? { frente: g(x.frente) } : {}) })),
    tubos: figura.tubos.map((t) => ({ ...t, puntos: t.puntos.map((p) => redondo(g(p))) })),
  };
}

// ----------------------------------------------------------------------------------------------------------
// Lo impreso: ojos y caras
// ----------------------------------------------------------------------------------------------------------

/**
 * Las capas de un ojo sobre un globo de radio `r`: venitas (desde el borde del iris hacia los lados), iris, pupila
 * y brillo, en ese orden (lo último queda encima). `mirada` corre iris y pupila (fracción del radio).
 */
export function capasOjo(r: number, estilo: EstiloOjo, mirada: [number, number] = [0, 0]): CapaEstampado[] {
  const capas: CapaEstampado[] = [];
  const [cu, cv] = [mirada[0] * r, mirada[1] * r];
  const radioIris = estilo.iris ? r * estilo.iris.proporcion : r * estilo.pupila.proporcion;
  if (estilo.venas) {
    const n = Math.max(0, Math.min(12, Math.round(estilo.venas.cantidad)));
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n + 0.35;
      const puntos: Array<[number, number]> = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        const s = radioIris * 0.85 + (r * 1.05 - radioIris * 0.85) * t;
        const desvio = 0.16 * Math.sin(t * Math.PI * 2.5 + i * 1.7) * t;
        puntos.push([cu * (1 - t) + s * Math.cos(a + desvio), cv * (1 - t) + s * Math.sin(a + desvio)]);
      }
      capas.push({ hex: estilo.venas.hex, puntos: trazo(puntos, r * 0.07, r * 0.025) });
    }
  }
  if (estilo.iris) capas.push({ hex: estilo.iris.hex, puntos: circulo(cu, cv, radioIris) });
  capas.push({ hex: estilo.pupila.hex, puntos: circulo(cu, cv, r * estilo.pupila.proporcion) });
  if (estilo.brillo) capas.push({ hex: "#ffffff", puntos: circulo(cu - radioIris * 0.38, cv + radioIris * 0.38, Math.max(r * 0.07, radioIris * 0.2), undefined, 16) });
  return capas;
}

/** La cara de calabaza de la foto 2 sobre un globo de radio `r`: ojos y nariz de triángulo y boca con dos dientes. */
export function capasCaraCalabaza(r: number, hex: string): CapaEstampado[] {
  const ojo = (s: number): Array<[number, number]> => {
    const cu = s * 0.34 * r, cv = 0.2 * r;
    return [[r2(cu - 0.17 * r), r2(cv - 0.1 * r)], [r2(cu + 0.17 * r), r2(cv - 0.1 * r)], [r2(cu - s * 0.04 * r), r2(cv + 0.18 * r)]];
  };
  const nariz: Array<[number, number]> = [[r2(-0.07 * r), r2(-0.08 * r)], [r2(0.07 * r), r2(-0.08 * r)], [0, r2(0.04 * r)]];
  // Boca: borde de arriba (con los dos dientes que bajan) de izquierda a derecha y el de abajo de vuelta.
  const w = 0.56 * r;
  const arriba = (x: number) => -0.2 * r + 0.11 * r * (x / w) ** 2;
  const abajo = (x: number) => arriba(x) - 0.22 * r * Math.pow(Math.max(0, 1 - (x / w) ** 2), 0.7);
  const diente = 0.09 * r;
  const boca: Array<[number, number]> = [];
  const borde = [-1, -0.7, -0.45, -0.3, -0.12, 0, 0.12, 0.3, 0.45, 0.7, 1];
  for (const f of borde) {
    const x = f * w;
    if (f === -0.3 || f === 0.12) boca.push([r2(x), r2(arriba(x))], [r2(x), r2(arriba(x) - diente)]);
    else if (f === -0.12 || f === 0.3) boca.push([r2(x), r2(arriba(x) - diente)], [r2(x), r2(arriba(x))]);
    else boca.push([r2(x), r2(arriba(x))]);
  }
  for (let i = 9; i >= 1; i--) { const x = (-1 + (2 * i) / 10) * w; boca.push([r2(x), r2(abajo(x))]); }
  return [{ hex, puntos: ojo(-1) }, { hex, puntos: ojo(1) }, { hex, puntos: nariz }, { hex, puntos: boca }];
}

// ----------------------------------------------------------------------------------------------------------
// Las piezas
// ----------------------------------------------------------------------------------------------------------

/** Lo que arma una pieza de Halloween: globos y tramos, su radio de frente y cuánto se hunde por detrás. */
export type FiguraHalloween = { globos: GloboDecoracion[]; tubos: TuboDecoracion[]; radioCm: number; fondoCm: number };

function figura(globos: GloboDecoracion[], tubos: TuboDecoracion[]): FiguraHalloween {
  // Tamaño de frente (la mitad del lado mayor de su caja en el plano x-z: una figura alta no es un disco) y fondo
  // (lo más atrás, −y).
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, fondo = 0;
  const meter = (p: Vec3, r: number) => { minX = Math.min(minX, p.x - r); maxX = Math.max(maxX, p.x + r); minZ = Math.min(minZ, p.z - r); maxZ = Math.max(maxZ, p.z + r); };
  for (const g of globos) {
    const r = g.infladoCm / 2;
    const c = mas(g.nudo, por(g.direccion, centroCuerpo("redondo", g.infladoCm) + g.cuelloExtraCm));
    meter(c, r);
    fondo = Math.max(fondo, -(c.y - r), -g.nudo.y);
  }
  for (const t of tubos) for (const p of t.puntos) { meter(p, t.grosorCm / 2); fondo = Math.max(fondo, -(p.y - t.grosorCm / 2)); }
  const radio = Number.isFinite(minX) ? Math.max(maxX - minX, maxZ - minZ) / 2 : 0;
  return { globos, tubos, radioCm: r2(radio), fondoCm: r2(fondo) };
}

/** Un ojo: el globo mira hacia quien ve (nudo detrás) y lleva lo impreso en la punta. */
function unOjo(parte: ParteGlobo, estilo: EstiloOjo, centro: Vec3, miradaGrados: number, direccion: Vec3 = AL_FRENTE): GloboDecoracion {
  const r = parte.infladoCm / 2;
  const fuerza = estilo.iris ? 0.16 : 0.2;
  const mirada: [number, number] = [r2(fuerza * Math.cos(rad(miradaGrados))), r2(fuerza * Math.sin(rad(miradaGrados)))];
  return globoEn(parte, centro, direccion, { frente: ARRIBA, estampado: { en: "punta", capas: capasOjo(r, estilo, mirada) } });
}

export function armarOjo(p: PropiedadesOjo): FiguraHalloween {
  return figura([unOjo(p.globo, p.estilo, P(0, 0, 0), p.miradaGrados)], []);
}

/**
 * Racimo de 2 a 5 ojos de tamaños mezclados: el primero al centro y los demás alrededor, tocándolo, cada uno
 * mirando hacia un lado (como los ojos saltones de las fotos 1 y 3).
 */
export function armarRacimoOjos(p: PropiedadesRacimoOjos): FiguraHalloween {
  const ojos = p.ojos.slice(0, 5);
  if (!ojos.length) return figura([], []);
  const centro = ojos[0]!;
  const angulos = [205, 25, 115, 295];
  const globos = ojos.map((o, i) => {
    if (i === 0) return unOjo(o, p.estilo, P(0, 0, 0), 60);
    const a = rad(angulos[(i - 1) % angulos.length]!);
    const d = (centro.infladoCm / 2 + o.infladoCm / 2) * 0.9;
    const fuera = P(Math.cos(a), 0, Math.sin(a));
    return unOjo(o, p.estilo, P(d * Math.cos(a), i % 2 === 0 ? -1.5 : 1, d * Math.sin(a)), 60 + i * 97, mas(AL_FRENTE, por(fuera, 0.25)));
  });
  return figura(globos, []);
}

export function armarArana(p: PropiedadesArana): FiguraHalloween {
  const rc = p.cuerpo.infladoCm / 2, rh = p.cabeza.infladoCm / 2;
  const globos: GloboDecoracion[] = [globoEn(p.cuerpo, P(0, 0, 0), AL_FRENTE)];
  const ojos: CapaEstampado[] = p.ojos
    ? [-1, 1].flatMap((s) => [
      { hex: "#f4f3ee", puntos: circulo(s * 0.3 * rh, 0.02 * rh, 0.22 * rh, 0.26 * rh) },
      { hex: p.ojos!.hexIris, puntos: circulo(s * 0.3 * rh - s * 0.04 * rh, 0, 0.14 * rh) },
      { hex: "#111111", puntos: circulo(s * 0.3 * rh - s * 0.05 * rh, 0, 0.07 * rh, 0.09 * rh) },
    ])
    : [];
  globos.push(globoEn(p.cabeza, P(0, rc * 0.3, rc + rh * 0.6), mas(AL_FRENTE, por(ARRIBA, 0.45)), p.ojos ? { frente: ARRIBA, estampado: { en: "punta", capas: ojos } } : {}));

  const L = p.patas.largoCm, tubos: TuboDecoracion[] = [];
  // En el plano de la pared: `r` desde el centro, a un ángulo (0° = hacia fuera, +90° = arriba) y a la altura `y`.
  const enPlano = (s: number, r: number, grados: number, y: number, desde: Vec3 = P(0, 0, 0)) => mas(desde, P(s * r * Math.cos(rad(grados)), y, r * Math.sin(rad(grados))));
  for (const s of [1, -1]) {
    for (let j = 0; j < 4; j++) {
      if (p.patas.estilo === "articuladas") {
        const alfa = [55, 20, -12, -45][j]!;
        const cadera = enPlano(s, rc * 0.8, alfa, 1);
        const rodilla = enPlano(s, L * 0.4, alfa + 28, rc * 0.3, cadera);
        const tobillo = enPlano(s, L * 0.42, alfa - 38, rc * 0.18, rodilla);
        const pie = enPlano(s, L * 0.18, alfa - 72, 0, tobillo);
        // Tres burbujas por pata: la torcedura de cada rodilla marca la articulación.
        tubos.push(tubito(p.patas, [cadera, rodilla]), tubito(p.patas, [rodilla, tobillo]), tubito(p.patas, [tobillo, pie]));
      } else {
        const beta = [52, 18, -18, -52][j]!;
        const radial = P(s * Math.cos(rad(beta)), 0, Math.sin(rad(beta)));
        const lateral = P(-s * Math.sin(rad(beta)), 0, Math.cos(rad(beta)));
        const puntos = lazo(enPlano(s, rc * 0.7, beta, -1), radial, lateral, L, L * 0.36).map((q, k, todos) => mas(q, P(0, 2.5 * Math.sin((Math.PI * k) / (todos.length - 1)), 0)));
        tubos.push(tubito(p.patas, puntos));
      }
    }
  }
  return girarEnPlano(figura(globos, tubos), p.giroGrados);
}

/** Lo alto de un globo redondo (del nudo a la punta). */
const altoGlobo = (d: number) => altoPerfil(perfilRedondo(d));

export function armarCalabaza(p: PropiedadesCalabaza): FiguraHalloween {
  const d = p.globo.infladoCm, r = d / 2;
  const centro = P(0, 0, 0);
  const globo = globoEn(p.globo, centro, ARRIBA, p.cara ? { frente: AL_FRENTE, estampado: { en: "cara", capas: capasCaraCalabaza(r, p.cara.hex) } } : {});
  const tubos: TuboDecoracion[] = [];
  if (p.tallo) {
    const t = p.tallo;
    const tope = mas(globo.nudo, por(ARRIBA, altoGlobo(d)));
    // Tallo: una burbuja corta hacia arriba.
    tubos.push(tubito(t, [mas(tope, P(0, 0, -t.grosorCm * 0.3)), mas(tope, P(0.8, 0, 7))]));
    // Lazos tumbados alrededor del tallo, un poco caídos sobre la calabaza.
    const n = Math.max(2, Math.min(10, Math.round(t.lazos)));
    for (let k = 0; k < n; k++) {
      const phi = rad(15) + (2 * Math.PI * k) / n;
      const radial = unitario(P(Math.cos(phi) * Math.cos(rad(25)), Math.sin(phi) * Math.cos(rad(25)), -Math.sin(rad(25))));
      const lateral = P(-Math.sin(phi), Math.cos(phi), 0);
      tubos.push(tubito(t, lazo(mas(tope, P(0, 0, t.grosorCm * 0.2)), radial, lateral, t.largoLazoCm, t.largoLazoCm * 0.55)));
    }
    if (t.zarcillos) {
      // Zarcillos: dos rizos de T-160 que salen hacia los lados.
      for (const [s, frente] of [[1, 0.4], [-1, -0.2]] as const) {
        const puntos: Vec3[] = [];
        for (let i = 0; i <= 30; i++) {
          const u = i / 30, a = 2 * Math.PI * 2.5 * u;
          puntos.push(mas(tope, P(s * (3 + 13 * u) + s * 2.4 * Math.cos(a), frente * 10 * u + 2.4 * Math.sin(a) * 0.4, 2 + 2.4 * Math.sin(a))));
        }
        tubos.push(tubito({ formatoId: "T-160", grosorCm: 2, codigo: t.codigo }, puntos));
      }
    }
  }
  return figura([globo], tubos);
}

export function armarCalabazaBruja(p: PropiedadesCalabazaBruja): FiguraHalloween {
  const rc = p.cuerpo.infladoCm / 2, rh = p.cabeza.infladoCm / 2;
  const globos: GloboDecoracion[] = [globoEn(p.cuerpo, P(0, 0, 0), ARRIBA)];
  // Cuello: un anillo de globitos sobre el cuerpo, con los nudos al centro.
  const n = Math.max(3, Math.min(10, Math.round(p.cuello.cantidad)));
  const dc = p.cuello.infladoCm;
  const alturaCuello = rc * 0.95 + dc * 0.3;
  const rho = (0.46 * dc) / Math.sin(Math.PI / n);
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n + rad(90);
    globos.push(globoEn(p.cuello, P(rho * Math.cos(a), rho * Math.sin(a), alturaCuello), P(Math.cos(a), Math.sin(a), 0)));
  }
  const centroCabeza = P(0, 0, alturaCuello + dc * 0.35 + rh);
  globos.push(globoEn(p.cabeza, centroCabeza, ARRIBA, p.cara ? { frente: AL_FRENTE, estampado: { en: "cara", capas: capasCaraCalabaza(rh, p.cara.hex) } } : {}));
  const tubos: TuboDecoracion[] = [];
  // Brazos: un tubito por lado que sale del hombro, se abre y termina en una burbuja de mano.
  for (const s of [1, -1]) {
    const hombro = P(s * rc * 0.8, 1, rc * 0.45);
    const codo = P(s * (rc + 11), 3, rc * 0.1);
    const muneca = P(s * (rc + 20), 5, rc * 0.45);
    tubos.push(tubito(p.brazos, [hombro, codo, muneca]), tubito(p.brazos, [muneca, P(s * (rc + 23), 5.5, rc * 0.8)]));
  }
  if (p.sombrero) {
    const { hex, cinta } = p.sombrero;
    const ala = centroCabeza.z + rh * 0.78;
    const inclinado = (v: Vec3): Vec3 => ({ x: v.x, y: v.y * Math.cos(rad(10)) - (v.z - ala) * Math.sin(rad(10)), z: ala + v.y * Math.sin(rad(10)) + (v.z - ala) * Math.cos(rad(10)) });
    const aro = (radio: number, z: number, m = 32) => Array.from({ length: m }, (_, i) => inclinado(P(radio * Math.cos((2 * Math.PI * i) / m), radio * Math.sin((2 * Math.PI * i) / m), z)));
    tubos.push(papel(hex, 1.2, aro(rh * 1.4, ala), true, true));
    // Copa: tramos cada vez más finos, con la punta doblada hacia un lado.
    const tramos = 10, alto = rh * 2.3;
    const eje = (u: number) => inclinado(P(rh * 0.55 * u ** 2.2, 0, ala + alto * u));
    for (let k = 0; k < tramos; k++) {
      const u0 = k / tramos, u1 = (k + 1) / tramos;
      tubos.push(papel(hex, Math.max(1.2, 2 * rh * 0.72 * (1 - (u0 + u1) / 2)), [eje(u0 + 0.01), eje(u1)]));
    }
    tubos.push(papel(cinta, 2.2, aro(rh * 0.66, ala + 2.2, 24), true));
  }
  return figura(globos, tubos);
}

export function armarMano(p: PropiedadesMano): FiguraHalloween {
  const g = p.grosorCm, L = p.largoDedoCm;
  const tubos: TuboDecoracion[] = [];
  // Palma: tres burbujas cruzadas, una sobre otra; la muñeca baja de ella.
  const anchoPalma = g * 3.6;
  for (let k = 0; k < 3; k++) tubos.push(tubito(p, [P(-anchoPalma / 2 + g / 2, 0, -g * (0.5 + k * 0.95)), P(anchoPalma / 2 - g / 2, 0, -g * (0.5 + k * 0.95))]));
  tubos.push(tubito(p, [P(0, -0.5, -g * 2.9), P(0, -1, -g * 2.9 - L * 0.45)]));
  // Dedos juntos, en abanico: el del medio más largo; con garra la punta se dobla hacia delante.
  const largos = [0.82, 0.97, 1, 0.9];
  for (let i = 0; i < 4; i++) {
    const off = (i - 1.5) * g * 0.95;
    const a = rad(90 + (1.5 - i) * p.aberturaGrados);
    const base = P(off, 0, 0);
    const largo = L * largos[i]!;
    const nudillo = mas(base, P(Math.cos(a) * largo * 0.58, 0, Math.sin(a) * largo * 0.58));
    const punta = p.garra
      ? mas(nudillo, P(Math.cos(a) * largo * 0.3, largo * 0.3, Math.sin(a) * largo * 0.3))
      : mas(nudillo, P(Math.cos(a) * largo * 0.42, 0, Math.sin(a) * largo * 0.42));
    tubos.push(tubito(p, [base, nudillo]), tubito(p, [nudillo, punta]));
  }
  if (p.dedos >= 5) {
    // Pulgar: sale del costado de la palma, abierto hacia fuera.
    const base = P(-anchoPalma / 2, 0.5, -g * 1.6);
    const a = rad(150);
    const nudillo = mas(base, P(Math.cos(a) * L * 0.4, 0, Math.sin(a) * L * 0.4));
    const punta = mas(nudillo, P(Math.cos(a + rad(-35)) * L * 0.32, p.garra ? L * 0.15 : 0, Math.sin(a + rad(-35)) * L * 0.32));
    tubos.push(tubito(p, [base, nudillo]), tubito(p, [nudillo, punta]));
  }
  return girarEnPlano(figura([], tubos), p.giroGrados);
}

export function armarRamoHelio(p: PropiedadesRamoHelio): FiguraHalloween {
  const globos: GloboDecoracion[] = [], tubos: TuboDecoracion[] = [];
  const n = p.globos.length;
  const altoPeso = 6;
  const amarre = P(0, 0, altoPeso);
  // Los globos en espiral (ángulo de oro) bajando desde lo alto: un ramo alto como el de la foto 1.
  const mayor = Math.max(...p.globos.map((g) => g.infladoCm), 10);
  const tramo = Math.min(mayor * 0.62, (p.alturaCm * 0.55) / Math.max(1, n - 1));
  for (let i = 0; i < n; i++) {
    const parte = p.globos[i]!;
    const a = rad(137.5 * i + 20);
    const radio = i === 0 ? 0 : mayor * (0.75 + 0.2 * (i % 2));
    const centro = P(radio * Math.cos(a), radio * Math.sin(a) * 0.6, p.alturaCm - parte.infladoCm * 0.55 - i * tramo);
    const direccion = mas(ARRIBA, P(Math.cos(a) * 0.25 * (i ? 1 : 0), Math.sin(a) * 0.15 * (i ? 1 : 0), 0));
    const globo = globoEn(parte, centro, direccion);
    globos.push(globo);
    // Cinta: del nudo al peso, con una onda suave al salir del globo.
    const puntos: Vec3[] = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const onda = 2.2 * Math.sin(t * Math.PI * 3) * (1 - t);
      puntos.push(mas(mas(por(globo.nudo, 1 - t), por(amarre, t)), P(onda, 0, 0)));
    }
    tubos.push(papel(p.cinta.hex, 0.35, puntos));
  }
  tubos.push(papel(p.peso.hex, 10, [P(0, 0, 3), P(0, 0, altoPeso)]));
  return figura(globos, tubos);
}

export function armarArbolTrenzado(p: PropiedadesArbolTrenzado): FiguraHalloween {
  const H = Math.max(120, p.alturaCm);
  const globos: GloboDecoracion[] = [], tubos: TuboDecoracion[] = [];
  const t = p.tronco, g = t.grosorCm;

  // Base orgánica: dos vueltas de globos grandes y acentos pequeños metidos entre ellos.
  const grande = p.base.grandes, rg = grande.infladoCm / 2;
  const acento = (i: number) => p.base.acentos[i % Math.max(1, p.base.acentos.length)] ?? grande;
  for (let k = 0; k < 7; k++) {
    const a = (2 * Math.PI * k) / 7 + 0.2;
    globos.push(globoEn(grande, P(Math.cos(a) * rg * 2.2, Math.sin(a) * rg * 1.7, rg), P(Math.cos(a), Math.sin(a), 0.35)));
  }
  for (let k = 0; k < 4; k++) {
    const a = (2 * Math.PI * k) / 4 + 0.6;
    globos.push(globoEn(grande, P(Math.cos(a) * rg * 1.1, Math.sin(a) * rg * 0.9, rg * 2.4), P(Math.cos(a), Math.sin(a), 0.8)));
  }
  for (let k = 0; k < 12; k++) {
    const a = (2 * Math.PI * k) / 12 + 0.45;
    const parte = acento(k);
    const lejos = k % 2 === 0 ? rg * 3.05 : rg * 1.95;
    globos.push(globoEn(parte, P(Math.cos(a) * lejos, Math.sin(a) * lejos * 0.85, k % 2 === 0 ? parte.infladoCm * 0.5 : rg * 2.1), P(Math.cos(a), Math.sin(a), 0.6)));
  }

  // Tronco: tubitos torcidos en espiral, de lo alto de la base a la copa.
  const z0 = rg * 2.2, copaZ = H - 30, z1 = copaZ - 8;
  const n = Math.max(2, Math.min(8, Math.round(t.tubitos)));
  const radioTronco = g * 1.15;
  for (let k = 0; k < n; k++) {
    const puntos: Vec3[] = [];
    for (let i = 0; i <= 28; i++) {
      const u = i / 28, a = (2 * Math.PI * k) / n + 2 * Math.PI * ((z1 - z0) / 70) * u;
      puntos.push(P(radioTronco * Math.cos(a), radioTronco * Math.sin(a), z0 + (z1 - z0) * u));
    }
    tubos.push(tubito(t, puntos));
  }
  // Tubitos dorados enrollados por fuera, más abiertos en el medio.
  if (p.cintas) {
    p.cintas.codigos.forEach((codigo, k) => {
      const puntos: Vec3[] = [];
      const desde = z0 + 8, hasta = z1 - 4;
      for (let i = 0; i <= 36; i++) {
        const u = i / 36, a = Math.PI * k + 2 * Math.PI * ((hasta - desde) / 42) * u;
        const radio = radioTronco + g * 0.9 + 9 * Math.sin(Math.PI * u);
        puntos.push(P(radio * Math.cos(a), radio * Math.sin(a), desde + (hasta - desde) * u));
      }
      tubos.push(tubito({ formatoId: p.cintas!.formatoId, grosorCm: p.cintas!.grosorCm, codigo }, puntos));
    });
  }
  // Ramas trenzadas de a dos, a un lado y al otro: las de arriba se levantan como brazos.
  const ramas = Math.max(2, Math.min(6, Math.round(p.ramas)));
  for (let i = 0; i < ramas; i++) {
    const s = i % 2 === 0 ? 1 : -1;
    const nivel = ramas === 1 ? 1 : 1 - Math.floor(i / 2) / Math.max(1, Math.ceil(ramas / 2) - 1);
    const h = z0 + (z1 - z0) * (0.3 + 0.62 * nivel);
    const largo = H * (0.22 + 0.12 * nivel);
    const inicio = 8 + 12 * nivel, curva = 25 + 45 * nivel;
    const eje = (u: number) => {
      // Ángulo que va de casi horizontal a levantado; se integra a mano (pasos fijos) para que sea determinista.
      let x = radioTronco, z = h;
      const pasos = Math.max(1, Math.round(u * 30));
      for (let k = 0; k < pasos; k++) {
        const a = rad(inicio + curva * ((k + 0.5) / 30));
        x += (largo / 30) * Math.cos(a);
        z += (largo / 30) * Math.sin(a);
      }
      return { x, z, a: rad(inicio + curva * u) };
    };
    for (const fase of [0, Math.PI]) {
      const puntos: Vec3[] = [];
      for (let k = 0; k <= 30; k++) {
        const u = k / 30, e = eje(u), giro = fase + 2 * Math.PI * ((u * largo) / 10);
        const r = g * 0.55;
        // Trenza: los dos tubitos giran uno alrededor del otro (hacia el frente y a lo largo de la normal de la rama).
        puntos.push(P(s * (e.x - Math.sin(e.a) * r * Math.cos(giro)), r * Math.sin(giro), e.z + Math.cos(e.a) * r * Math.cos(giro)));
      }
      tubos.push(tubito(t, puntos));
    }
    // Ramitas en la punta: tres burbujas cortas en abanico.
    const fin = eje(1);
    for (const abre of [-35, 0, 35]) {
      const a = fin.a + rad(abre);
      tubos.push(tubito({ ...t, grosorCm: g * 0.8 }, [P(s * fin.x, 0, fin.z), P(s * (fin.x + Math.cos(a) * 9), 0, fin.z + Math.sin(a) * 9)]));
    }
  }

  // Copa: racimo alargado de globitos alrededor de lo alto del tronco.
  const copa = p.copa, rcopa = copa.infladoCm / 2;
  const cantidad = 30;
  for (let k = 0; k < cantidad; k++) {
    // Puntos repartidos en la esfera (espiral de Fibonacci), estirada hacia arriba.
    const v = 1 - (2 * (k + 0.5)) / cantidad, s = Math.sqrt(1 - v * v), a = k * rad(137.5);
    const dir = P(s * Math.cos(a), s * Math.sin(a), v);
    const codigo = copa.codigos[k % Math.max(1, copa.codigos.length)] ?? grande.codigo;
    globos.push(globoEn({ formatoId: copa.formatoId, infladoCm: copa.infladoCm, codigo }, P(s * Math.cos(a) * rcopa * 1.6, s * Math.sin(a) * rcopa * 1.6, copaZ + v * rcopa * 2.6), dir));
  }
  if (p.ojos) {
    // Ojos bravos (foto 4): dos globitos cobre con pupila y ceja impresas, al frente de la copa.
    const ojo = acento(0);
    const ro = ojo.infladoCm / 2;
    for (const s of [1, -1]) {
      const capas: CapaEstampado[] = [
        { hex: "#1b120d", puntos: circulo(-s * 0.12 * ro, -0.08 * ro, 0.3 * ro) },
        { hex: "#ffffff", puntos: circulo(-s * 0.12 * ro - 0.1 * ro, 0.04 * ro, 0.07 * ro, undefined, 12) },
        { hex: "#1b120d", puntos: trazo([[s * 0.55 * ro, 0.55 * ro], [0, 0.42 * ro], [-s * 0.45 * ro, 0.22 * ro]], ro * 0.2, ro * 0.12) },
      ];
      globos.push(globoEn(ojo, P(s * ro * 1.05, rcopa * 1.6 + ro * 0.6, copaZ - rcopa * 1.2), AL_FRENTE, { frente: ARRIBA, estampado: { en: "punta", capas } }));
    }
  }
  return figura(globos, tubos);
}

/** Fantasma de papel: silueta blanca con la cola hacia un lado, cara negra y una tira en espiral que cuelga. */
export function armarFantasma(p: PropiedadesFantasma): FiguraHalloween {
  const A = p.altoCm, w = A * 0.3, zc = A - w;
  const contorno: Vec3[] = [];
  // Cabeza: media vuelta por arriba, de derecha a izquierda.
  for (let i = 0; i <= 16; i++) { const a = (Math.PI * i) / 16; contorno.push(P(w * Math.cos(a), 0, zc + w * Math.sin(a))); }
  // Lado izquierdo: baja y se va hacia la derecha hasta la punta de la cola (curva de Bézier).
  const bezier = (a: [number, number], b: [number, number], c: [number, number], u: number): [number, number] => [(1 - u) ** 2 * a[0] + 2 * (1 - u) * u * b[0] + u * u * c[0], (1 - u) ** 2 * a[1] + 2 * (1 - u) * u * b[1] + u * u * c[1]];
  const punta: [number, number] = [w * 0.9, 0];
  for (let i = 1; i <= 12; i++) { const [x, z] = bezier([-w, zc], [-w * 0.9, A * 0.12], punta, i / 12); contorno.push(P(x, 0, z)); }
  // Lado derecho: sube de la punta a la cabeza, con una ondita (el pliegue del papel).
  for (let i = 1; i < 12; i++) { const [x, z] = bezier(punta, [w * 0.55, A * 0.3], [w, zc], i / 12); contorno.push(P(x + 1.2 * Math.sin(i * 0.9), 0, z)); }
  const tubos: TuboDecoracion[] = [papel(p.hex, 0.6, contorno, true, true)];
  const cara = (cu: number, cz: number, ru: number, rz: number) => Array.from({ length: 16 }, (_, i) => P(cu + ru * Math.cos((2 * Math.PI * i) / 16), 0.4, cz + rz * Math.sin((2 * Math.PI * i) / 16)));
  tubos.push(papel(p.hexCara, 0.3, cara(-w * 0.32, zc + w * 0.08, A * 0.035, A * 0.06), true, true));
  tubos.push(papel(p.hexCara, 0.3, cara(w * 0.28, zc + w * 0.08, A * 0.035, A * 0.06), true, true));
  tubos.push(papel(p.hexCara, 0.3, cara(-w * 0.02, zc - w * 0.32, A * 0.03, A * 0.045), true, true));
  if (p.cola) {
    // Tira en espiral que cuelga de la punta de la cola, cada vez más cerrada.
    const puntos: Vec3[] = [];
    const vueltas = Math.max(1, p.cola.vueltas);
    for (let i = 0; i <= 60; i++) {
      const u = i / 60, a = 2 * Math.PI * vueltas * u, r = A * 0.16 * (1 - 0.7 * u);
      puntos.push(P(punta[0] + r * (Math.cos(a) - 1) * 0.9, r * Math.sin(a), -p.cola.largoCm * u));
    }
    tubos.push(papel(p.hex, 1.3, puntos));
  }
  return figura([], tubos);
}

/** Telaraña de papel: radios y anillos combados hacia el centro, como la de la foto 5. Plana, mirando a +y. */
export function armarTelarana(p: PropiedadesTelarana): FiguraHalloween {
  const n = Math.max(5, Math.min(16, Math.round(p.radios)));
  const anillos = Math.max(1, Math.min(10, Math.round(p.anillos)));
  // Un poco irregular, pero determinista: ángulos y largos con un vaivén fijo.
  const angulos = Array.from({ length: n }, (_, i) => (2 * Math.PI * i) / n + 0.1 * Math.sin(i * 2.3));
  const largos = Array.from({ length: n }, (_, i) => p.radioCm * (0.9 + 0.1 * Math.sin(i * 1.7 + 0.5)));
  const tubos: TuboDecoracion[] = angulos.map((a, i) => papel(p.hex, p.grosorCm, [P(0, 0, 0), P(largos[i]! * Math.cos(a), 0, largos[i]! * Math.sin(a))]));
  for (let k = 1; k <= anillos; k++) {
    const f = k / (anillos + 0.15);
    const puntos: Vec3[] = [];
    for (let i = 0; i < n; i++) {
      const a = angulos[i]!, b = angulos[(i + 1) % n]! + (i === n - 1 ? 2 * Math.PI : 0);
      const ra = largos[i]! * f, rb = largos[(i + 1) % n]! * f;
      puntos.push(P(ra * Math.cos(a), 0, ra * Math.sin(a)));
      // El hilo entre dos radios se comba hacia el centro.
      const m = (a + b) / 2, rm = ((ra + rb) / 2) * Math.cos((b - a) / 2) * 0.86;
      puntos.push(P(rm * Math.cos(m), 0, rm * Math.sin(m)));
    }
    tubos.push(papel(p.hex, p.grosorCm, puntos, true));
  }
  return figura([], tubos);
}

export function armarHalloween(d: DecoracionHalloween): FiguraHalloween {
  switch (d.tipo) {
    case "ojo": return armarOjo(d.propiedades);
    case "racimo_ojos": return armarRacimoOjos(d.propiedades);
    case "arana": return armarArana(d.propiedades);
    case "calabaza": return armarCalabaza(d.propiedades);
    case "calabaza_bruja": return armarCalabazaBruja(d.propiedades);
    case "mano": return armarMano(d.propiedades);
    case "ramo_helio": return armarRamoHelio(d.propiedades);
    case "arbol_trenzado": return armarArbolTrenzado(d.propiedades);
    case "fantasma": return armarFantasma(d.propiedades);
    case "telarana": return armarTelarana(d.propiedades);
  }
}

/** Qué es, en inglés y corto (para la foto con IA). */
export function halloweenEnIngles(d: DecoracionHalloween): string {
  switch (d.tipo) {
    case "ojo": return "a white balloon eyeball";
    case "racimo_ojos": return "a cluster of balloon eyeballs";
    case "arana": return d.propiedades.patas.estilo === "lazos" ? "a black balloon spider with looped twisted-balloon legs" : "a black balloon spider with jointed twisted-balloon legs";
    case "calabaza": return "a big orange jack-o'-lantern balloon with green twisted-balloon leaves";
    case "calabaza_bruja": return "a pumpkin-head balloon figure wearing a black witch hat";
    case "mano": return "a green twisted-balloon monster hand";
    case "ramo_helio": return "a bouquet of helium balloons on ribbons tied to a weight";
    case "arbol_trenzado": return "a spooky tree of braided brown twisting balloons with an organic balloon base";
    case "fantasma": return "a white paper ghost cut-out with a spiral tail";
    case "telarana": return "a black paper spider web cut-out";
  }
}

// ----------------------------------------------------------------------------------------------------------
// Predefinidas (las de las fotos)
// ----------------------------------------------------------------------------------------------------------

/**
 * Colores Sempertex medidos en las fotos (mediana de un recorte, ver el informe): naranja 061 (calabaza #ea8e0e),
 * verde lima 031 (mano #7bcd66), negro 080, blanco 005, chocolate 076 (tronco #634639), café 074, Reflex Dorado
 * Rosa 968 (el «cobre» de la base, #c07252; en R-9 no se fabrica y la copa usa Naranja Cobrizo 062), arena 071 (beige), Reflex Dorado 970 y Champaña 971 (los dorados),
 * gris 081 (cuello de la bruja), Reflex Plata 981 y Reflex Verde Lima 931 (cromados del ramo). Lo impreso y el
 * papel van en hex (no son globos).
 */
const OJO_SALTON: EstiloOjo = { iris: null, pupila: { hex: "#2b2a33", proporcion: 0.46 }, brillo: true, venas: null };
const OJO_VENAS: EstiloOjo = { iris: { hex: "#c3262e", proporcion: 0.5 }, pupila: { hex: "#141414", proporcion: 0.22 }, brillo: true, venas: { hex: "#c8323a", cantidad: 7 } };
const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });

export const HALLOWEEN_PREDEFINIDAS: ReadonlyArray<{ id: string; nombre: string; descripcion: string; decoracion: DecoracionHalloween }> = [
  {
    id: "ojo_venas", nombre: "Ojo con venas",
    descripcion: "R-9 Blanco con iris rojo, pupila negra y venitas rojas impresas (foto 3).",
    decoracion: { tipo: "ojo", propiedades: { globo: R("R-9", 18, "005"), estilo: OJO_VENAS, miradaGrados: 200 } },
  },
  {
    id: "ojo_salton", nombre: "Ojo saltón",
    descripcion: "R-9 Blanco con una pupila grande gris oscuro y su brillo (foto 1).",
    decoracion: { tipo: "ojo", propiedades: { globo: R("R-9", 18, "005"), estilo: OJO_SALTON, miradaGrados: 60 } },
  },
  {
    id: "ojos_saltones", nombre: "Racimo de ojos saltones",
    descripcion: "Cuatro ojos de R-12, R-9 y R-5 Blanco con pupila gris oscuro, cada uno mirando a un lado (foto 1).",
    decoracion: { tipo: "racimo_ojos", propiedades: { ojos: [R("R-12", 22, "005"), R("R-9", 16, "005"), R("R-9", 15, "005"), R("R-5", 11, "005")], estilo: OJO_SALTON } },
  },
  {
    id: "ojos_venas", nombre: "Racimo de ojos con venas",
    descripcion: "Cinco R-9 y R-5 Blanco con iris rojo y venitas (el aro de la foto 3).",
    decoracion: { tipo: "racimo_ojos", propiedades: { ojos: [R("R-9", 17, "005"), R("R-9", 15, "005"), R("R-5", 12, "005"), R("R-9", 16, "005"), R("R-5", 11, "005")], estilo: OJO_VENAS } },
  },
  {
    id: "arana_articulada", nombre: "Araña de patas articuladas",
    descripcion: "Cuerpo R-12 y cabeza R-9 Negro con ojos impresos; 8 patas de T-260 Negro en tres burbujas (foto 3).",
    decoracion: { tipo: "arana", propiedades: { cuerpo: R("R-12", 24, "080"), cabeza: R("R-9", 15, "080"), ojos: { hexIris: "#1d1d1d" }, patas: { formatoId: "T-260", grosorCm: 3.5, codigo: "080", largoCm: 34, estilo: "articuladas" }, giroGrados: 0 } },
  },
  {
    id: "arana_lazos", nombre: "Araña de lazos",
    descripcion: "Cuerpo R-12 y cabeza R-9 Negro (en la foto el cuerpo trae telarañas impresas: aquí liso) con ojos verdes; 8 lazos grandes de T-260 Negro (foto 5).",
    decoracion: { tipo: "arana", propiedades: { cuerpo: R("R-12", 25, "080"), cabeza: R("R-9", 18, "080"), ojos: { hexIris: "#7cb83a" }, patas: { formatoId: "T-260", grosorCm: 4, codigo: "080", largoCm: 30, estilo: "lazos" }, giroGrados: -20 } },
  },
  {
    id: "calabaza_grande", nombre: "Calabaza grande",
    descripcion: "R-24 Naranja con la cara impresa y el tallo de T-260 Verde Lima en lazos con zarcillos de T-160 (foto 2).",
    decoracion: { tipo: "calabaza", propiedades: { globo: R("R-24", 55, "061"), cara: { hex: "#1a1a1a" }, tallo: { formatoId: "T-260", grosorCm: 4, codigo: "031", lazos: 6, largoLazoCm: 17, zarcillos: true } } },
  },
  {
    id: "calabaza_bruja", nombre: "Calabaza con sombrero de bruja",
    descripcion: "Cabeza R-12 Naranja con cara, cuello de 6 R-5 Gris, cuerpo R-12 Negro, brazos de T-260 Naranja y sombrero de papel (foto 2).",
    decoracion: { tipo: "calabaza_bruja", propiedades: { cabeza: R("R-12", 24, "061"), cuerpo: R("R-12", 25, "080"), cuello: { ...R("R-5", 10, "081"), cantidad: 6 }, brazos: { formatoId: "T-260", grosorCm: 3.5, codigo: "061" }, cara: { hex: "#1a1a1a" }, sombrero: { hex: "#161616", cinta: "#6b3fa0" } } },
  },
  {
    id: "mano_verde", nombre: "Mano de monstruo",
    descripcion: "Mano de T-260 Verde Lima: cuatro dedos juntos y el pulgar, en dos burbujas con garra (foto 1).",
    decoracion: { tipo: "mano", propiedades: { formatoId: "T-260", grosorCm: 4.5, codigo: "031", dedos: 5, largoDedoCm: 24, aberturaGrados: 6, garra: true, giroGrados: 0 } },
  },
  {
    id: "ramo_helio", nombre: "Ramo de helio con cintas",
    descripcion: "Nueve R-12 (Reflex Plata, Naranja, Negro, Verde Lima, Reflex Verde Lima) con cintas naranja que bajan a un peso (foto 1; lo impreso «Happy Halloween» no se modela).",
    decoracion: { tipo: "ramo_helio", propiedades: { globos: [R("R-12", 27, "981"), R("R-12", 27, "061"), R("R-12", 27, "080"), R("R-12", 27, "031"), R("R-12", 27, "061"), R("R-12", 27, "931"), R("R-12", 27, "080"), R("R-12", 27, "031"), R("R-12", 27, "061")], alturaCm: 175, cinta: { hex: "#e0571f" }, peso: { hex: "#e8681e" } } },
  },
  {
    id: "arbol_trenzado", nombre: "Árbol de tubitos trenzados",
    descripcion: "Tronco de 5 T-260 Chocolate en espiral con T-260 Reflex Dorado y Champaña enrollados, 4 ramas trenzadas, copa de R-9 Café con acentos Naranja Cobrizo, ojos bravos y base orgánica de R-12 Chocolate con R-5 cobre, arena y dorado (foto 4).",
    decoracion: { tipo: "arbol_trenzado", propiedades: { alturaCm: 190, ramas: 4, tronco: { formatoId: "T-260", grosorCm: 4.5, codigo: "076", tubitos: 5 }, cintas: { formatoId: "T-260", grosorCm: 4.5, codigos: ["970", "971"] }, copa: { formatoId: "R-9", infladoCm: 16, codigos: ["074", "074", "062", "074", "074"] }, base: { grandes: R("R-12", 27, "076"), acentos: [R("R-5", 11, "968"), R("R-5", 11, "071"), R("R-5", 9, "970")] }, ojos: true } },
  },
  {
    id: "fantasma", nombre: "Fantasma de papel",
    descripcion: "No es globo: silueta blanca con cara negra y la cola en espiral (foto 4).",
    decoracion: { tipo: "fantasma", propiedades: { altoCm: 42, hex: "#f5f3ee", hexCara: "#1a1a1a", cola: { vueltas: 3, largoCm: 34 } } },
  },
  {
    id: "telarana", nombre: "Telaraña de papel",
    descripcion: "No es globo: telaraña negra plana de 9 radios y 6 vueltas (foto 5).",
    decoracion: { tipo: "telarana", propiedades: { radioCm: 38, radios: 9, anillos: 6, hex: "#151515", grosorCm: 0.45 } },
  },
];
