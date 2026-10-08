import type { Vec3 } from "./modulos";
import { formaColumna, formaGuirnalda, RELLENO_TUPIDO, type ColorOrganico, type OpcionesOrganico, type PuntoMezcla, type RellenoOrganico, type TramoOrganico } from "./organico";

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
    id: "anillo_interior", nombre: "Anillo de dentro", recorrido: circulo(rDentro, R, a.interior.adelanteCm),
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
