import type { Vec3 } from "./modulos";
import { formaColumna, formaGuirnalda, RELLENO_TUPIDO, type ColorOrganico, type FranjaColor, type OpcionesOrganico, type PuntoMezcla, type RellenoOrganico, type TramoOrganico } from "./organico";

/** El tramo de dentro del aro: lo que lo distingue de las demás estructuras (su cuerpo, el presupuesto y su rango de grosor). */
export const ANILLO_INTERIOR = "anillo_interior";

/**
 * Estructuras orgánicas que no son columna, guirnalda recta ni arco de dos patas, armadas con el mismo motor
 * (`armarOrganico`) sobre recorridos propios. Cada una devuelve las opciones del motor: la escena las usa como pieza
 * `organico`. Espacio local: cm, y hacia arriba, +z hacia quien mira.
 *
 * - **Aro orgánico**: una corona en un plano vertical, de dos anillos cerrados: el de fuera de un solo formato
 *   (la fila de R-12 que hace de marco) y el de dentro de tamaños mezclados.
 * - **Racimos libres**: uno o varios tramos de guirnalda orgánica sobre recorridos 3D cualesquiera (racimos que
 *   suben por un marco y bajan, media guirnalda en curva, montículos al pie de una estructura).
 * - **Arco rectangular**: patas rectas, esquinas redondeadas y travesaño; puede dejar un hueco en cada pata (donde
 *   va una calabaza u otra figura). El remate de un globo grande arriba se pone aparte: el motor no coloca un globo
 *   suelto en un sitio exacto.
 * - **Tronco con base**: un montículo ancho en el piso (un anillo acostado de globos grandes) y un tronco fino que sube
 *   de él (el árbol de Halloween).
 */

/** Inflados de la técnica orgánica (los del arco orgánico y la columna de XV). */
export const INFLADOS_ORGANICOS: Readonly<Record<string, number>> = { "R-24": 48, "R-18": 34, "R-12": 25, "R-9": 17, "R-5": 12 };

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function opciones(tramos: TramoOrganico[], colores: readonly ColorOrganico[], semilla: number, suelo: boolean, inflados: Readonly<Record<string, number>> = INFLADOS_ORGANICOS, relleno: readonly RellenoOrganico[] = RELLENO_TUPIDO): OpcionesOrganico {
  return { semilla, tramos, inflados, variacionInflado: 0.07, relleno: relleno.map((r) => ({ ...r })), colores: colores.map((c) => ({ ...c })), suelo, huecosFlores: 0, vista: { x: 0, y: 0, z: 1 } };
}

// ----------------------------------------------------------------------------------------------------------
// Aro
// ----------------------------------------------------------------------------------------------------------

export type OpcionesAroOrganico = {
  /** Diámetro de fuera a fuera. */
  diametroCm: number;
  /** Anillo de fuera: un formato (la fila que hace de marco), con su radio de envoltura. */
  exterior: { formatoId: string; radioCm: number };
  /** Anillo de dentro: mezcla de tamaños y radio de envoltura; va un poco por delante del de fuera. */
  interior: { pesos: Readonly<Record<string, number>>; radioCm: number; adelanteCm: number };
  colores: ColorOrganico[];
  semilla: number;
};

/** Un círculo cerrado del plano XY (centro a `radio` del piso), empezando abajo y dando la vuelta entera. */
function circulo(radio: number, centroY: number, z: number, puntos = 28): Vec3[] {
  const salida: Vec3[] = [];
  for (let i = 0; i <= puntos; i++) {
    const a = -Math.PI / 2 + (i / puntos) * Math.PI * 2;
    salida.push(v(Math.round(radio * Math.cos(a) * 10) / 10, Math.round((centroY + radio * Math.sin(a)) * 10) / 10, z));
  }
  return salida;
}

export function opcionesAroOrganico(a: OpcionesAroOrganico): OpcionesOrganico {
  const R = a.diametroCm / 2;
  const rFuera = R - a.exterior.radioCm;
  const rDentro = rFuera - a.exterior.radioCm - a.interior.radioCm * 0.55;
  const fuera: TramoOrganico = {
    id: "anillo_exterior", nombre: "Anillo de fuera", recorrido: circulo(rFuera, R, 0),
    grosor: [{ t: 0, radioCm: a.exterior.radioCm }, { t: 1, radioCm: a.exterior.radioCm }],
    mezcla: [{ t: 0, pesos: { [a.exterior.formatoId]: 1 } }, { t: 1, pesos: { [a.exterior.formatoId]: 1 } }],
    irregularidad: 0.04, tapas: {},
  };
  const dentro: TramoOrganico = {
    id: ANILLO_INTERIOR, nombre: "Anillo de dentro", recorrido: circulo(rDentro, R, a.interior.adelanteCm),
    grosor: [{ t: 0, radioCm: a.interior.radioCm }, { t: 1, radioCm: a.interior.radioCm }],
    mezcla: [{ t: 0, pesos: a.interior.pesos }, { t: 1, pesos: a.interior.pesos }],
    irregularidad: 0.16, tapas: {},
  };
  return opciones([fuera, dentro], a.colores, a.semilla, false);
}

// ----------------------------------------------------------------------------------------------------------
// Racimos libres
// ----------------------------------------------------------------------------------------------------------

export type RacimoLibre = {
  id: string;
  nombre: string;
  puntos: Vec3[];
  radioInicioCm: number;
  radioFinCm: number;
  mezcla: readonly PuntoMezcla[];
  /** Remate redondo en cada punta (un racimo suelto los lleva en las dos). */
  tapas: { inicio: boolean; fin: boolean };
};

export function opcionesRacimosLibres(o: { racimos: readonly RacimoLibre[]; colores: ColorOrganico[]; semilla: number; suelo: boolean; relleno?: readonly RellenoOrganico[] }): OpcionesOrganico {
  const tramos = o.racimos.map((r) => ({
    ...formaGuirnalda({ id: r.id, nombre: r.nombre, puntos: r.puntos, radioInicioCm: r.radioInicioCm, radioFinCm: r.radioFinCm, mezcla: r.mezcla }),
    tapas: { ...r.tapas },
  }));
  return opciones(tramos, o.colores, o.semilla, o.suelo, INFLADOS_ORGANICOS, o.relleno ?? RELLENO_TUPIDO);
}

// ----------------------------------------------------------------------------------------------------------
// Arco rectangular
// ----------------------------------------------------------------------------------------------------------

export type OpcionesArcoRectangular = {
  /** Distancia entre los ejes de las patas y altura del eje del travesaño. */
  anchoEjeCm: number;
  altoEjeCm: number;
  radioEsquinaCm: number;
  /** Envoltura en la base de las patas, en el resto de las patas y en el travesaño. */
  radioBaseCm: number;
  radioPataCm: number;
  radioArribaCm: number;
  /** Hueco en cada pata entre estas alturas (para una figura): la base queda como un montículo y la pata sigue arriba. */
  hueco: { desdeCm: number; hastaCm: number } | null;
  mezcla: { base: Readonly<Record<string, number>>; pata: Readonly<Record<string, number>>; arriba: Readonly<Record<string, number>> };
  colores: ColorOrganico[];
  semilla: number;
};

/** Eje de una U invertida de esquinas redondeadas: de (−a, y0) sube, cruza a `alto` y baja a (a, y0). */
function ejeU(a: number, alto: number, y0: number, radio: number): Vec3[] {
  const r = Math.min(radio, a * 0.9, (alto - y0) * 0.9);
  const salida: Vec3[] = [];
  const recta = (desde: Vec3, hasta: Vec3, n: number) => { for (let i = 0; i < n; i++) { const f = i / n; salida.push(v(desde.x + (hasta.x - desde.x) * f, desde.y + (hasta.y - desde.y) * f, 0)); } };
  const esquina = (cx: number, cy: number, a0: number, a1: number) => { for (let i = 0; i < 4; i++) { const t = a0 + ((a1 - a0) * i) / 4; salida.push(v(cx + r * Math.cos(t), cy + r * Math.sin(t), 0)); } };
  const pasosPata = Math.max(2, Math.round((alto - r - y0) / 30));
  const pasosArriba = Math.max(3, Math.round((2 * (a - r)) / 30));
  recta(v(-a, y0, 0), v(-a, alto - r, 0), pasosPata);
  esquina(-a + r, alto - r, Math.PI, Math.PI / 2);
  recta(v(-a + r, alto, 0), v(a - r, alto, 0), pasosArriba);
  esquina(a - r, alto - r, Math.PI / 2, 0);
  recta(v(a, alto - r, 0), v(a, y0, 0), pasosPata);
  salida.push(v(a, y0, 0));
  return salida.map((p) => v(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, 0));
}

const constante = (pesos: Readonly<Record<string, number>>): PuntoMezcla[] => [{ t: 0, pesos }, { t: 1, pesos }];

export function opcionesArcoRectangular(o: OpcionesArcoRectangular): OpcionesOrganico {
  const a = o.anchoEjeCm / 2;
  const tramos: TramoOrganico[] = [];
  if (o.hueco) {
    // Montículo de la base de cada pata (con remate arriba, donde se apoya la figura) y la U desde encima del hueco.
    const alto = Math.max(20, o.hueco.desdeCm - o.radioBaseCm * 0.6);
    for (const [lado, x] of [["izquierda", -a], ["derecha", a]] as const) {
      tramos.push({
        id: `base_${lado}`, nombre: `Base ${lado}`, recorrido: [v(x, o.radioBaseCm * 0.5, 0), v(x, (o.radioBaseCm * 0.5 + alto) / 2, 0), v(x, alto, 0)],
        grosor: [{ t: 0, radioCm: o.radioBaseCm }, { t: 1, radioCm: o.radioBaseCm * 0.9 }],
        mezcla: constante(o.mezcla.base), irregularidad: 0.16, tapas: { fin: true },
      });
    }
    const y0 = o.hueco.hastaCm + o.radioPataCm * 0.6;
    tramos.push({
      id: "travesano", nombre: "Patas y travesaño", recorrido: ejeU(a, o.altoEjeCm, y0, o.radioEsquinaCm),
      grosor: [{ t: 0, radioCm: o.radioPataCm }, { t: 0.3, radioCm: o.radioArribaCm }, { t: 0.7, radioCm: o.radioArribaCm }, { t: 1, radioCm: o.radioPataCm }],
      mezcla: [{ t: 0, pesos: o.mezcla.pata }, { t: 0.3, pesos: o.mezcla.arriba }, { t: 0.7, pesos: o.mezcla.arriba }, { t: 1, pesos: o.mezcla.pata }],
      irregularidad: 0.15, tapas: { inicio: true, fin: true },
    });
  } else {
    tramos.push({
      id: "arco", nombre: "Arco rectangular", recorrido: ejeU(a, o.altoEjeCm, o.radioBaseCm * 0.5, o.radioEsquinaCm),
      grosor: [{ t: 0, radioCm: o.radioBaseCm }, { t: 0.12, radioCm: o.radioPataCm }, { t: 0.3, radioCm: o.radioArribaCm }, { t: 0.7, radioCm: o.radioArribaCm }, { t: 0.88, radioCm: o.radioPataCm }, { t: 1, radioCm: o.radioBaseCm }],
      mezcla: [{ t: 0, pesos: o.mezcla.base }, { t: 0.15, pesos: o.mezcla.pata }, { t: 0.3, pesos: o.mezcla.arriba }, { t: 0.7, pesos: o.mezcla.arriba }, { t: 0.85, pesos: o.mezcla.pata }, { t: 1, pesos: o.mezcla.base }],
      irregularidad: 0.15, tapas: {},
    });
  }
  return opciones(tramos, o.colores, o.semilla, true);
}

// ----------------------------------------------------------------------------------------------------------
// Tronco con base (árbol)
// ----------------------------------------------------------------------------------------------------------

export type OpcionesTroncoConBase = {
  /** El montículo: un anillo acostado alrededor del pie del tronco (radio del anillo y de su envoltura). */
  base: { radioAnilloCm: number; radioCm: number; mezcla: Readonly<Record<string, number>> };
  tronco: { desdeCm: number; altoCm: number; radioCm: number; radioCopaCm: number; mezcla: Readonly<Record<string, number>> };
  colores: ColorOrganico[];
  inflados?: Readonly<Record<string, number>>;
  /** Relleno de huecos (por defecto R-9 y tríos de R-5): sin R-9 si la paleta no se fabrica en R-9. */
  relleno?: readonly RellenoOrganico[];
  semilla: number;
};

export function opcionesTroncoConBase(o: OpcionesTroncoConBase): OpcionesOrganico {
  const anillo: Vec3[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = (i / 20) * Math.PI * 2;
    anillo.push(v(Math.round(o.base.radioAnilloCm * Math.cos(t) * 10) / 10, Math.round(o.base.radioCm * 0.9 * 10) / 10, Math.round(o.base.radioAnilloCm * Math.sin(t) * 10) / 10));
  }
  const base: TramoOrganico = {
    id: "base", nombre: "Base", recorrido: anillo,
    grosor: [{ t: 0, radioCm: o.base.radioCm }, { t: 1, radioCm: o.base.radioCm }],
    mezcla: constante(o.base.mezcla), irregularidad: 0.2, tapas: {},
  };
  const tronco = formaColumna({
    id: "tronco", nombre: "Tronco", altoCm: o.tronco.altoCm - o.tronco.desdeCm, origen: v(0, o.tronco.desdeCm, 0),
    radioBaseCm: o.tronco.radioCm, radioMedioCm: o.tronco.radioCm * 0.9, radioPuntaCm: o.tronco.radioCopaCm,
    mezcla: constante(o.tronco.mezcla), irregularidad: 0.1, serpenteoCm: 3,
  });
  return opciones([base, tronco], o.colores, o.semilla, true, o.inflados ?? INFLADOS_ORGANICOS, o.relleno ?? RELLENO_TUPIDO);
}

// ----------------------------------------------------------------------------------------------------------
// Columna paramétrica (recta, inclinada, en par, por franjas de color, con espiral o con montículo al pie)
// ----------------------------------------------------------------------------------------------------------

/** Pesos por formato («R-12»: 0,5) en un extremo de la pieza. */
export type PesosFormato = Readonly<Record<string, number>>;

/**
 * Una columna orgánica descrita por sus medidas, no por sus globos: el motor la vuelve a armar cada vez, así que se
 * puede cambiar el alto, la inclinación o los colores y sale bien. Medidas por fuera (de la cara de los globos).
 *
 * - **Inclinación** en grados desde la vertical (+ hacia +x). Con `curvaInclinacion` 0 el eje es recto e inclinado
 *   desde el piso (las columnas «un poco inclinadas» de la foto CASE-002); con 1 se dobla más arriba (como `formaColumna`).
 * - **Franjas**: cortes del alto (fracciones, de abajo arriba) que nombran las franjas `franja_1`, `franja_2`… Un color
 *   con `tramos: ["franja_2"]` va solo en esa franja (degradé o bicolor por alturas); la columna sigue siendo un solo
 *   tramo `columna` (sin costuras): el motor reparte el color por la fracción de su recorrido (`franjas` del color).
 * - **Espiral**: un cordón orgánico más fino que da vueltas pegado a la columna (tramo `espiral`): la columna en
 *   espiral de dos colores.
 * - **Montículo**: un anillo acostado de globos grandes al pie (tramo `monticulo`): la columna con base de racimo.
 * - **Par**: dos columnas iguales separadas `separacionCm` entre pies, la de la izquierda con la inclinación al revés
 *   (las dos se abren o se cierran a la vez). Sus tramos llevan el sufijo `_izquierda` / `_derecha`; un color limitado
 *   a `franja_1`, `columna` o `espiral` vale para las dos (ver `tramos` en `ColorOrganico`).
 */
export type ParametrosColumnaOrganica = {
  altoCm: number;
  /** Diámetro de la columna abajo, a media altura y en la punta. */
  grosorBaseCm: number;
  grosorMedioCm: number;
  grosorPuntaCm: number;
  inclinacionGrados?: number;
  /** 0 (recta) a 1 (se dobla arriba). */
  curvaInclinacion?: number;
  serpenteoCm?: number;
  /** Mezcla de tamaños abajo y en la punta; en medio se interpola. */
  mezcla: { base: PesosFormato; punta: PesosFormato };
  franjas?: readonly number[];
  espiral?: { vueltas: number; grosorCm: number; mezcla: PesosFormato };
  monticulo?: { anchoCm: number; grosorCm: number; mezcla: PesosFormato };
  par?: { separacionCm: number };
  colores: readonly ColorOrganico[];
  /** Multiplica los globos de estructura (1 = envoltura cubierta). */
  densidad?: number;
  irregularidad?: number;
  inflados?: Readonly<Record<string, number>>;
  relleno?: readonly RellenoOrganico[];
  semilla: number;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Interpola dos juegos de pesos (los formatos que falten pesan 0). */
function mezclaEntre(a: PesosFormato, b: PesosFormato, f: number): Record<string, number> {
  const salida: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const p = (a[k] ?? 0) * (1 - f) + (b[k] ?? 0) * f;
    if (p > 0.001) salida[k] = Math.round(p * 1000) / 1000;
  }
  return salida;
}

/** Radio (cm) de la envoltura de la columna en la fracción `f` del alto: base hasta el 15 %, medio a la mitad, punta arriba. */
function radioColumna(p: ParametrosColumnaOrganica, f: number): number {
  const puntos: Array<[number, number]> = [[0, p.grosorBaseCm], [0.15, p.grosorBaseCm], [0.5, p.grosorMedioCm], [0.9, p.grosorPuntaCm], [1, p.grosorPuntaCm * 0.8]];
  for (let i = 1; i < puntos.length; i++) {
    const [t0, g0] = puntos[i - 1]!, [t1, g1] = puntos[i]!;
    if (f <= t1) return (g0 + (g1 - g0) * ((f - t0) / Math.max(1e-6, t1 - t0))) / 2;
  }
  return (p.grosorPuntaCm * 0.8) / 2;
}

/** Los tramos de UNA columna con el pie en `x0` y la inclinación con el signo `lado`; `sufijo` distingue las del par. */
function tramosColumna(p: ParametrosColumnaOrganica, x0: number, lado: 1 | -1, sufijo: string): TramoOrganico[] {
  const inicio = p.grosorBaseCm * 0.25;
  const fin = p.altoCm - p.grosorPuntaCm * 0.4;
  const alto = Math.max(20, fin - inicio);
  const desvio = Math.tan(((p.inclinacionGrados ?? 0) * Math.PI) / 180) * alto * lado;
  const c = Math.min(1, Math.max(0, p.curvaInclinacion ?? 0));
  const eje = (f: number): Vec3 => v(
    r1(x0 + desvio * ((1 - c) * f + c * f * f) + (p.serpenteoCm ?? 0) * Math.sin(Math.PI * 2 * f)),
    r1(inicio + alto * f),
    0,
  );
  const etiqueta = sufijo ? ` ${sufijo.slice(1)}` : "";
  const recorrido = Array.from({ length: 9 }, (_, k) => eje(k / 8));
  const tramos: TramoOrganico[] = [{
    id: `columna${sufijo}`, nombre: `Columna${etiqueta}`, recorrido,
    grosor: [0, 0.15, 0.3, 0.5, 0.7, 0.9, 1].map((t) => ({ t, radioCm: r1(radioColumna(p, t)) })),
    mezcla: [0, 0.25, 0.5, 0.75, 1].map((t) => ({ t, pesos: mezclaEntre(p.mezcla.base, p.mezcla.punta, t) })),
    irregularidad: p.irregularidad ?? 0.12, tapas: { fin: true },
  }];
  if (p.espiral) {
    const e = p.espiral;
    const puntos: Vec3[] = [];
    const n = Math.max(12, Math.round(e.vueltas * 12));
    for (let k = 0; k <= n; k++) {
      const f = 0.04 + (0.9 * k) / n;
      const ang = Math.PI * 2 * e.vueltas * f * lado;
      const centro = eje(f);
      // El cordón va pegado por fuera: su eje un poco más allá de la cara de la columna.
      const r = radioColumna(p, f) + e.grosorCm * 0.2;
      puntos.push(v(r1(centro.x + Math.sin(ang) * r), centro.y, r1(Math.cos(ang) * r)));
    }
    tramos.push({
      id: `espiral${sufijo}`, nombre: `Espiral${etiqueta}`, recorrido: puntos,
      grosor: [{ t: 0, radioCm: e.grosorCm / 2 }, { t: 1, radioCm: e.grosorCm / 2 }], mezcla: constante(e.mezcla),
      // Un cordón fino de globos chicos deja ver entre ellos: va más tupido que la columna.
      irregularidad: 0.1, tapas: { inicio: true, fin: true }, densidad: 1.6,
    });
  }
  if (p.monticulo) {
    const m = p.monticulo;
    const radioAnillo = Math.max(10, m.anchoCm / 2 - m.grosorCm / 2);
    const anillo: Vec3[] = [];
    for (let k = 0; k <= 16; k++) {
      const t = (k / 16) * Math.PI * 2;
      anillo.push(v(r1(x0 + radioAnillo * Math.cos(t)), r1(m.grosorCm * 0.45), r1(radioAnillo * Math.sin(t))));
    }
    tramos.push({
      id: `monticulo${sufijo}`, nombre: `Montículo al pie${etiqueta}`, recorrido: anillo,
      grosor: [{ t: 0, radioCm: m.grosorCm / 2 }, { t: 1, radioCm: m.grosorCm / 2 }], mezcla: constante(m.mezcla), irregularidad: 0.18, tapas: {},
    });
  }
  return tramos;
}

export function opcionesColumnaOrganica(p: ParametrosColumnaOrganica): OpcionesOrganico {
  const tramos = p.par
    ? [...tramosColumna(p, -p.par.separacionCm / 2, -1, "_izquierda"), ...tramosColumna(p, p.par.separacionCm / 2, 1, "_derecha")]
    : tramosColumna(p, 0, 1, "");
  const cortes = cortesDeFranjas(p.franjas);
  const colores = coloresPorFranjas(p.colores, (k) => (k < cortes.length - 1 ? [{ tramo: "columna", desde: cortes[k]!, hasta: cortes[k + 1]! }] : []));
  return { ...opciones(tramos, colores, p.semilla, true, p.inflados ?? INFLADOS_ORGANICOS, p.relleno ?? RELLENO_TUPIDO), densidad: p.densidad ?? 1 };
}

/** 0, los cortes (ordenados, dentro de 0–1) y 1. */
const cortesDeFranjas = (franjas: readonly number[] | undefined) => [0, ...[...(franjas ?? [])].filter((f) => f > 0.01 && f < 0.99).sort((a, b) => a - b), 1];

/** Dónde cae la franja k (0, 1…) de una pieza: en qué tramo (o tramos, por el comienzo de su id) y en qué trecho de él. */
type TrechoFranja = { tramo: string; desde: number; hasta: number };

/**
 * Los colores con `tramos: ["franja_N"]` pasados al motor: una entrada por tramo donde cae esa franja, limitada a su
 * trecho (`franjas` del color). Lo que no es franja queda como venía (si un color mezcla franjas y otros tramos, va
 * en dos entradas con el mismo peso).
 */
function coloresPorFranjas(colores: readonly ColorOrganico[], trechos: (k: number) => TrechoFranja[]): ColorOrganico[] {
  return colores.flatMap((c) => {
    const franjas = (c.tramos ?? []).map((t) => /^franja_(\d+)$/.exec(t)).filter((m): m is RegExpExecArray => m !== null).map((m) => Number(m[1]) - 1);
    if (franjas.length === 0) return [{ ...c }];
    const otros = (c.tramos ?? []).filter((t) => !/^franja_\d+$/.test(t));
    const porTramo = new Map<string, FranjaColor[]>();
    for (const k of franjas) for (const t of trechos(k)) porTramo.set(t.tramo, [...(porTramo.get(t.tramo) ?? []), { desde: r1000(t.desde), hasta: r1000(t.hasta) }]);
    const resto: ColorOrganico = { codigo: c.codigo, peso: c.peso, ...(c.confeti ? { confeti: true } : {}), ...(c.formatos ? { formatos: c.formatos } : {}) };
    return [
      ...[...porTramo.entries()].map(([tramo, rangos]) => ({ ...resto, tramos: [tramo], franjas: rangos })),
      ...(otros.length ? [{ ...resto, tramos: otros }] : []),
    ];
  });
}

const r1000 = (n: number) => Math.round(n * 1000) / 1000;

// ----------------------------------------------------------------------------------------------------------
// Arco paramétrico (completo, semiarco, asimétrico, guirnalda sobre marco redondo o rectangular)
// ----------------------------------------------------------------------------------------------------------

/**
 * El recorrido que siguen los globos (el marco), con la pieza medida por fuera:
 * - `arco`: U invertida apoyada en el piso, de pie izquierdo a pie derecho. `curva`: `elipse` (media elipse),
 *   `parabola` (más picudo) o `medio_punto` (patas rectas y medio círculo arriba).
 * - `circulo`: aro parado en el piso; empieza abajo, sube por la izquierda, pasa arriba y baja por la derecha.
 * - `rectangulo`: marco de esquinas redondeadas parado en el piso; empieza abajo a la izquierda, sube, cruza arriba,
 *   baja por la derecha y vuelve por abajo.
 */
export type MarcoArcoOrganico =
  | { forma: "arco"; curva: "elipse" | "parabola" | "medio_punto" }
  | { forma: "circulo" }
  | { forma: "rectangulo"; radioEsquinaCm: number };

/**
 * Un tramo de globos sobre el marco, de `desde` a `hasta` (fracciones del largo del marco: 0 = inicio, 1 = fin), con su
 * grosor (diámetro) al empezar, en medio y al acabar y su mezcla de tamaños al empezar y al acabar. `tapas`: remate
 * redondo en sus puntas (un tramo que acaba en el aire lo lleva; uno que nace del piso o sigue en otro, no).
 */
export type SegmentoArcoOrganico = {
  id: string;
  desde: number;
  hasta: number;
  grosorCm: { inicio: number; medio: number; fin: number };
  mezcla: { inicio: PesosFormato; fin: PesosFormato };
  tapas?: { inicio?: boolean; fin?: boolean };
  /** Cuánto va por delante del marco (cm, hacia quien mira). */
  adelanteCm?: number;
};

export type ParametrosArcoOrganico = {
  marco: MarcoArcoOrganico;
  /** Medidas por fuera con los globos (de la cara de fuera de un lado a la del otro, y del piso a lo más alto). */
  anchoCm: number;
  altoCm: number;
  segmentos: readonly SegmentoArcoOrganico[];
  /**
   * Cortes del marco (fracciones, 0–1) que nombran las franjas `franja_1`, `franja_2`… a lo largo del recorrido: un color
   * con `tramos: ["franja_2"]` va solo ahí (degradé o color por tramos: el ombré de coral a menta). Los segmentos no se
   * parten: el motor reparte el color por la fracción de su recorrido.
   */
  franjas?: readonly number[];
  /**
   * Racimos de un solo color: cada segmento se reparte en bloques de unos `largoCm` y cada bloque toma UN color de la
   * paleta, por turnos según los pesos (naranja, negro, naranja…); los colores que ya traen `tramos` quedan de acento.
   * Manda sobre `franjas`.
   */
  bloques?: { largoCm: number };
  colores: readonly ColorOrganico[];
  densidad?: number;
  irregularidad?: number;
  inflados?: Readonly<Record<string, number>>;
  relleno?: readonly RellenoOrganico[];
  semilla: number;
};

type Punto2D = { x: number; y: number };

/** Puntos del marco en el plano XY, metidos `margen` cm hacia dentro (el radio de los globos de la orilla). */
function puntosMarco(m: MarcoArcoOrganico, ancho: number, alto: number, margen: number): Punto2D[] {
  const a = Math.max(10, ancho / 2 - margen);
  const n = 64;
  const salida: Punto2D[] = [];
  if (m.forma === "arco") {
    const y0 = margen * 0.5;
    const h = Math.max(20, alto - margen - y0);
    if (m.curva === "medio_punto") {
      const r = Math.min(a, h);
      const patas = Math.max(0, h - r);
      const largoArco = Math.PI * r, total = 2 * patas + largoArco;
      for (let i = 0; i <= n; i++) {
        const s = (i / n) * total;
        if (s <= patas) salida.push({ x: -a, y: y0 + s });
        else if (s <= patas + largoArco) {
          const ang = Math.PI - (s - patas) / r;
          salida.push({ x: a * Math.cos(ang), y: y0 + patas + r * Math.sin(ang) });
        } else salida.push({ x: a, y: y0 + patas - (s - patas - largoArco) });
      }
    } else {
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        if (m.curva === "parabola") { const x = -a + 2 * a * u; salida.push({ x, y: y0 + h * (1 - (x / a) ** 2) }); }
        else { const ang = Math.PI * (1 - u); salida.push({ x: a * Math.cos(ang), y: y0 + h * Math.sin(ang) }); }
      }
    }
  } else if (m.forma === "circulo") {
    const r = Math.max(10, Math.min(ancho, alto) / 2 - margen);
    const cy = alto / 2;
    for (let i = 0; i <= n; i++) {
      const ang = -Math.PI / 2 - (i / n) * Math.PI * 2;
      salida.push({ x: r * Math.cos(ang), y: cy + r * Math.sin(ang) });
    }
  } else {
    const b = margen, t = Math.max(b + 20, alto - margen);
    const r = Math.min(m.radioEsquinaCm, a * 0.9, ((t - b) / 2) * 0.9);
    // Cada esquina gira 90° en el sentido del reloj visto de frente; entre esquinas, los lados rectos.
    const esquinas: Array<[number, number, number]> = [[-a + r, t - r, Math.PI], [a - r, t - r, Math.PI / 2], [a - r, b + r, 0], [-a + r, b + r, -Math.PI / 2]];
    salida.push({ x: -a, y: b + r });
    for (const [cx, cy, a0] of esquinas) {
      for (let j = 0; j <= 6; j++) {
        const ang = a0 - (j / 6) * (Math.PI / 2);
        salida.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
      }
    }
  }
  return salida;
}

/** El punto en la fracción `f` (0–1) del largo de una polilínea. */
function puntoEnLargo(puntos: readonly Punto2D[], f: number): Punto2D {
  const largos = [0];
  for (let i = 1; i < puntos.length; i++) largos.push(largos[i - 1]! + Math.hypot(puntos[i]!.x - puntos[i - 1]!.x, puntos[i]!.y - puntos[i - 1]!.y));
  const objetivo = Math.min(1, Math.max(0, f)) * largos[largos.length - 1]!;
  for (let i = 1; i < puntos.length; i++) {
    if (largos[i]! >= objetivo) {
      const u = (objetivo - largos[i - 1]!) / Math.max(1e-6, largos[i]! - largos[i - 1]!);
      return { x: puntos[i - 1]!.x + (puntos[i]!.x - puntos[i - 1]!.x) * u, y: puntos[i - 1]!.y + (puntos[i]!.y - puntos[i - 1]!.y) * u };
    }
  }
  return puntos[puntos.length - 1]!;
}


/** El largo (cm) de una polilínea del plano. */
function largoPolilinea(puntos: readonly Punto2D[]): number {
  let largo = 0;
  for (let i = 1; i < puntos.length; i++) largo += Math.hypot(puntos[i]!.x - puntos[i - 1]!.x, puntos[i]!.y - puntos[i - 1]!.y);
  return largo;
}

/** Turnos de color por pesos (round-robin suave): con pesos 2 y 1 sale A, B, A, A, B, A…, sin dos iguales seguidos si se puede. */
function turnosPorPeso(pesos: readonly number[], n: number): number[] {
  const acumulado = pesos.map(() => 0);
  const total = pesos.reduce((a, b) => a + b, 0);
  const salida: number[] = [];
  for (let j = 0; j < n; j++) {
    pesos.forEach((p, i) => { acumulado[i]! += p; });
    let mejor = 0;
    for (let i = 1; i < pesos.length; i++) if (acumulado[i]! > acumulado[mejor]! + 1e-9) mejor = i;
    if (pesos.length > 1 && salida[salida.length - 1] === mejor) {
      let otro = mejor === 0 ? 1 : 0;
      for (let i = 0; i < pesos.length; i++) if (i !== mejor && acumulado[i]! > acumulado[otro]! + 1e-9) otro = i;
      if (acumulado[otro]! > 0) mejor = otro;
    }
    acumulado[mejor]! -= total;
    salida.push(mejor);
  }
  return salida;
}

/** El perfil de tres puntos (inicio, medio, fin) en la fracción `t` del segmento. */
const enPerfil = (g: { inicio: number; medio: number; fin: number }, t: number) => (t <= 0.5 ? g.inicio + (g.medio - g.inicio) * (t / 0.5) : g.medio + (g.fin - g.medio) * ((t - 0.5) / 0.5));

export function opcionesArcoOrganicoParametrico(p: ParametrosArcoOrganico): OpcionesOrganico {
  // El marco por fuera; cada punto del eje se mete hacia dentro su propio radio (la pieza mide lo pedido por fuera
  // aunque sea gruesa en un pie y fina arriba). Todos los marcos se recorren en el sentido del reloj visto de frente:
  // hacia dentro es la tangente girada −90°.
  const marco = puntosMarco(p.marco, p.anchoCm, p.altoCm, 0);
  const largoMarco = Math.max(1, largoPolilinea(marco));
  const tramos: TramoOrganico[] = p.segmentos.map((s) => {
    const pasos = Math.max(3, Math.round(Math.abs(s.hasta - s.desde) * 24));
    const recorrido = Array.from({ length: pasos + 1 }, (_, k) => {
      const f = s.desde + ((s.hasta - s.desde) * k) / pasos;
      const q = puntoEnLargo(marco, f);
      const delante = puntoEnLargo(marco, Math.min(1, f + 0.004)), detras = puntoEnLargo(marco, Math.max(0, f - 0.004));
      const tx = delante.x - detras.x, ty = delante.y - detras.y, n = Math.hypot(tx, ty) || 1;
      const r = enPerfil(s.grosorCm, k / pasos) / 2;
      // Lo que nace del piso apoya en él: el eje, a medio radio del piso como mínimo.
      return v(r1(q.x + (ty / n) * r), r1(Math.max(r * 0.5, q.y - (tx / n) * r)), s.adelanteCm ?? 0);
    });
    return {
      id: s.id, nombre: s.id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), recorrido,
      grosor: [{ t: 0, radioCm: s.grosorCm.inicio / 2 }, { t: 0.5, radioCm: s.grosorCm.medio / 2 }, { t: 1, radioCm: s.grosorCm.fin / 2 }],
      mezcla: [{ t: 0, pesos: { ...s.mezcla.inicio } }, { t: 0.5, pesos: mezclaEntre(s.mezcla.inicio, s.mezcla.fin, 0.5) }, { t: 1, pesos: { ...s.mezcla.fin } }],
      irregularidad: p.irregularidad ?? 0.14, tapas: { ...(s.tapas ?? {}) },
    };
  });
  /** Fracción del segmento (0 en `desde`, 1 en `hasta`) de una fracción del marco. */
  const local = (s: SegmentoArcoOrganico, f: number) => (s.hasta === s.desde ? 0 : (f - s.desde) / (s.hasta - s.desde));
  let colores: ColorOrganico[];
  if (p.bloques) {
    // Bloques de cada segmento, en orden; cada uno, un color por turnos (los que traen `tramos` quedan de acento).
    const bloques: TrechoFranja[] = p.segmentos.flatMap((s) => {
      const n = Math.max(1, Math.round((Math.abs(s.hasta - s.desde) * largoMarco) / Math.max(20, p.bloques!.largoCm)));
      return Array.from({ length: n }, (_, k) => ({ tramo: s.id, desde: k / n, hasta: (k + 1) / n }));
    });
    const libres = p.colores.map((c, i) => ({ c, i })).filter((x) => !x.c.tramos);
    const turnos = turnosPorPeso(libres.map((x) => x.c.peso), bloques.length);
    colores = p.colores.flatMap((c, i) => {
      if (c.tramos) return [{ ...c }];
      const mios = bloques.filter((_, j) => libres.length > 0 && libres[turnos[j]!]!.i === i);
      const porTramo = new Map<string, FranjaColor[]>();
      for (const b of mios) porTramo.set(b.tramo, [...(porTramo.get(b.tramo) ?? []), { desde: r1000(b.desde), hasta: r1000(b.hasta) }]);
      return [...porTramo.entries()].map(([tramo, franjas]) => ({ ...c, tramos: [tramo], franjas }));
    });
  } else {
    const cortes = cortesDeFranjas(p.franjas);
    colores = coloresPorFranjas(p.colores, (k) => {
      if (k >= cortes.length - 1) return [];
      const a = cortes[k]!, b = cortes[k + 1]!;
      return p.segmentos.flatMap((s) => {
        const lo = Math.max(a, Math.min(s.desde, s.hasta)), hi = Math.min(b, Math.max(s.desde, s.hasta));
        if (hi <= lo) return [];
        const [t0, t1] = [local(s, lo), local(s, hi)].sort((x, y) => x - y) as [number, number];
        return [{ tramo: s.id, desde: t0, hasta: t1 }];
      });
    });
  }
  return { ...opciones(tramos, colores, p.semilla, true, p.inflados ?? INFLADOS_ORGANICOS, p.relleno ?? RELLENO_TUPIDO), densidad: p.densidad ?? 1 };
}

/** El contorno del marco (plano XY, cm) metido `margenCm` hacia dentro de la medida por fuera: el panel de detrás. */
export function contornoMarco(p: Pick<ParametrosArcoOrganico, "marco" | "anchoCm" | "altoCm">, margenCm: number): Punto2D[] {
  return puntosMarco(p.marco, p.anchoCm, p.altoCm, margenCm);
}
