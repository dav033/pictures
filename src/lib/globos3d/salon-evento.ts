import { idMesa, inflar, PREFIJO_ZONA, rectDe, seCruzan, type RectCm, type ZonaSalon } from "./salon-zonas";

/**
 * **Distribución de un salón de eventos** (REQ-008): función pura que, dados los invitados, el tipo de mesa y las zonas
 * pedidas, dice qué mueble va dónde. Las mesas de invitados van en una cuadrícula con pasillos, llenada por filas desde
 * la mesa principal hacia la entrada y del centro hacia afuera (quitar invitados quita las últimas mesas y no mueve las
 * demás); la pista queda libre; la mesa de postres, contra la pared izquierda; el fondo de fotos, contra la pared del fondo
 * detrás de la mesa principal, y la entrada al frente.
 *
 * Sala (cm): x de izquierda (−) a derecha (+) desde el centro, z de fondo (−) a frente (+); la pared del fondo está en z = −fondo/2.
 * No toca ninguna escena: `salon-aplicar.ts` convierte esto en piezas.
 */

export const TIPOS_MESA_SALON = ["redonda8", "redonda10", "imperial"] as const;
export type TipoMesaSalon = (typeof TIPOS_MESA_SALON)[number];

/** Cada tipo de mesa de invitados: el conjunto del catálogo (mesa con sillas en una sola pieza) y lo que ocupa con las sillas. */
export const MESAS_SALON: Readonly<Record<TipoMesaSalon, { mueble: string; puestos: number; anchoCm: number; fondoCm: number; altoCm: number }>> = {
  redonda8: { mueble: "mesa_redonda_sillas", puestos: 8, anchoCm: 270, fondoCm: 270, altoCm: 90 },
  redonda10: { mueble: "mesa_redonda10_sillas", puestos: 10, anchoCm: 300, fondoCm: 300, altoCm: 90 },
  imperial: { mueble: "mesa_imperial_sillas", puestos: 10, anchoCm: 360, fondoCm: 198, altoCm: 90 },
};

/** Aire entre los conjuntos de mesas (cm): más que el pasillo mínimo de 90 cm para que quepa una silla echada atrás. */
export const PASILLO_CM = 100;
/** Lo que se deja entre una mesa y la pared o la pista (cm). */
export const MARGEN_CM = 90;
/** Del fondo de fotos: el panel va a 30 cm de la pared y lo que se arma delante empieza a 60 cm de ella. */
export const PANEL_RETIRO_CM = 30;
export const FRENTE_PANEL_CM = 60;
/** Profundidad (desde la pared) reservada al fondo de fotos cuando nada la pide mayor. */
export const PROFUNDIDAD_FONDO_CM = 180;
/** Del tapete de la entrada a la pared del frente: el tapete queda a 200 cm de ella. */
export const ENTRADA_RETIRO_CM = 200;
const BANDA_ENTRADA_CM = 380;

const SALA_MINIMA_CM = 600;
const SALA_MAXIMA_CM = 3000;
const ANCHO_PANEL_MAX_CM = 480;
const ANCHO_PRINCIPAL_MAX_CM = 360;
const FONDO_PRINCIPAL_CM = 92;
const SILLA_FONDO_CM = 45;
/** De la pared (más lo que ocupa el fondo de fotos) al centro de las sillas de la mesa principal: entero, para poder leer la profundidad de vuelta de la escena. */
export const SILLAS_DESDE_FONDO_CM = 23;
const ANCHO_POSTRES_CM = 194;
const FONDO_POSTRES_CM = 47;
const DIAMETRO_TAPETE_CM = 160;

export type ElementoSalon = {
  id: string;
  /** `null` en las mesas de invitados. */
  zona: ZonaSalon | null;
  mueble: string;
  anchoCm: number;
  fondoCm: number;
  altoCm: number;
  xCm: number;
  zCm: number;
  giroGrados: number;
};

export type ParamsSalon = {
  /** 0: solo las zonas, sin mesas de invitados. */
  invitados: number;
  mesa: TipoMesaSalon;
  zonas: readonly ZonaSalon[];
  /** Sala fija (la pedida o la que ya hay). Si falta, la más chica que cabe con proporción de salón (largo : ancho entre 0,8 y 1,6). */
  sala?: { anchoCm: number; fondoCm: number };
  /** Con `sala` ausente: no baja de estas medidas (agrandar un salón sin encogerlo). */
  salaMinima?: { anchoCm: number; fondoCm: number };
  /** Rectángulos del piso que las mesas esquivan (piezas del usuario, zonas que se movieron). */
  reservas?: readonly RectCm[];
  /** Lo que ocupa el fondo de fotos desde la pared (cm); más que el de siempre si hay una decoración propia delante del panel. */
  profundidadFondoCm?: number;
  /** Diámetro (cm) de la pista, si ya existe una: así agregar o quitar invitados no la cambia ni mueve las mesas. Si falta, sale de los invitados. */
  pistaCm?: number;
  /** Altura de la sala, para que el panel no la pase. */
  altoSalaCm?: number;
};

export type DistribucionSalon = {
  sala: { anchoCm: number; fondoCm: number };
  elementos: ElementoSalon[];
  /** Mesas de invitados que hacen falta, que caben y que se colocaron. */
  mesasNecesarias: number;
  capacidad: number;
  faltan: number;
  /** Zonas pedidas que no caben en la sala (muy chica). */
  sinLugar: ZonaSalon[];
};

type Celda = { x: number; z: number };

/** La pista de baile: ~0,7 m² por bailarín (45 % de los invitados), entre 3 y 5 m de diámetro. */
export const diametroPista = (invitados: number): number => Math.min(500, Math.max(300, Math.round((Math.sqrt((invitados * 0.45 * 0.7 * 4) / Math.PI) * 100) / 10) * 10));

export const mesasNecesarias = (invitados: number, mesa: TipoMesaSalon): number => (invitados > 0 ? Math.ceil(invitados / MESAS_SALON[mesa].puestos) : 0);

/** Las celdas libres de la cuadrícula de mesas, en el orden en que se llenan: por fila, del centro hacia los lados. */
function celdasLibres(anchoSala: number, mesa: TipoMesaSalon, z0: number, z1: number, bloqueos: readonly RectCm[]): Celda[] {
  const { anchoCm, fondoCm } = MESAS_SALON[mesa];
  const columnas = Math.floor((anchoSala - 2 * MARGEN_CM + PASILLO_CM) / (anchoCm + PASILLO_CM));
  const filas = Math.floor((z1 - z0 + PASILLO_CM) / (fondoCm + PASILLO_CM));
  const celdas: Celda[] = [];
  for (let j = 0; j < filas; j++) {
    const z = z0 + fondoCm / 2 + j * (fondoCm + PASILLO_CM);
    const fila: Celda[] = [];
    for (let i = 0; i < columnas; i++) {
      const x = (i - (columnas - 1) / 2) * (anchoCm + PASILLO_CM);
      if (!bloqueos.some((b) => seCruzan(rectDe(x, z, anchoCm, fondoCm), b))) fila.push({ x, z });
    }
    celdas.push(...fila.sort((a, b) => Math.abs(a.x) - Math.abs(b.x) || a.x - b.x));
  }
  return celdas;
}

/** Todo menos las mesas de invitados, y las celdas libres para ellas, de una sala de esas medidas. */
function planear(anchoSala: number, fondoSala: number, p: ParamsSalon): { zonas: ElementoSalon[]; celdas: Celda[]; sinLugar: ZonaSalon[] } {
  const tiene = (z: ZonaSalon) => p.zonas.includes(z);
  const zonas: ElementoSalon[] = [];
  const bloqueos: RectCm[] = (p.reservas ?? []).map((r) => inflar(r, 40));
  const sinLugar: ZonaSalon[] = [];
  const zFondo = -fondoSala / 2;
  const profundidad = p.profundidadFondoCm ?? PROFUNDIDAD_FONDO_CM;

  const anchoPanel = Math.min(ANCHO_PANEL_MAX_CM, anchoSala - 200);
  const conFondo = tiene("fondo_fotos") && anchoPanel >= 150;
  if (tiene("fondo_fotos") && !conFondo) sinLugar.push("fondo_fotos");
  if (conFondo) {
    const alto = Math.min(300, (p.altoSalaCm ?? 450) - 40);
    zonas.push({ id: PREFIJO_ZONA.fondo_fotos, zona: "fondo_fotos", mueble: "marco_tela", anchoCm: anchoPanel, fondoCm: 34, altoCm: alto, xCm: 0, zCm: zFondo + PANEL_RETIRO_CM, giroGrados: 0 });
  }

  const anchoPrincipal = Math.min(ANCHO_PRINCIPAL_MAX_CM, anchoSala - 2 * MARGEN_CM);
  const conPrincipal = tiene("mesa_principal") && anchoPrincipal >= 150;
  if (tiene("mesa_principal") && !conPrincipal) sinLugar.push("mesa_principal");
  let finPrincipal = 0;
  if (conPrincipal) {
    const zSillas = zFondo + (conFondo ? profundidad : 60) + SILLAS_DESDE_FONDO_CM;
    const zMesa = zSillas + SILLA_FONDO_CM / 2 + FONDO_PRINCIPAL_CM / 2 + 6;
    finPrincipal = zMesa + FONDO_PRINCIPAL_CM / 2;
    zonas.push({ id: PREFIJO_ZONA.mesa_principal, zona: "mesa_principal", mueble: "mesa_imperial_mantel", anchoCm: anchoPrincipal, fondoCm: FONDO_PRINCIPAL_CM, altoCm: 75, xCm: 0, zCm: zMesa, giroGrados: 0 });
    const sillas = Math.min(8, Math.floor((anchoPrincipal - 20) / 55));
    for (let i = 0; i < sillas; i++) zonas.push({ id: `${PREFIJO_ZONA.mesa_principal}-silla-${i + 1}`, zona: "mesa_principal", mueble: "silla_tiffany", anchoCm: 45, fondoCm: SILLA_FONDO_CM, altoCm: 90, xCm: (i - (sillas - 1) / 2) * 55, zCm: zSillas, giroGrados: 0 });
  }

  const zCampo = conPrincipal ? finPrincipal + 140 : conFondo ? zFondo + profundidad + 100 : zFondo + MARGEN_CM;
  const conEntrada = tiene("entrada");
  const zEntrada = fondoSala / 2 - ENTRADA_RETIRO_CM;
  const zFinCampo = conEntrada ? fondoSala / 2 - BANDA_ENTRADA_CM : fondoSala / 2 - MARGEN_CM;
  if (conEntrada) {
    if (zEntrada - DIAMETRO_TAPETE_CM / 2 > (conPrincipal ? finPrincipal : conFondo ? zFondo + profundidad : zFondo)) zonas.push({ id: PREFIJO_ZONA.entrada, zona: "entrada", mueble: "alfombra_redonda", anchoCm: DIAMETRO_TAPETE_CM, fondoCm: DIAMETRO_TAPETE_CM, altoCm: 1, xCm: 0, zCm: zEntrada, giroGrados: 0 });
    else sinLugar.push("entrada");
  }

  if (tiene("pista")) {
    const d = Math.min(p.pistaCm ?? diametroPista(p.invitados), anchoSala - 2 * MARGEN_CM, zFinCampo - zCampo);
    if (d >= 250) {
      const zc = zCampo + d / 2;
      zonas.push({ id: PREFIJO_ZONA.pista, zona: "pista", mueble: "alfombra_redonda", anchoCm: d, fondoCm: d, altoCm: 1, xCm: 0, zCm: zc, giroGrados: 0 });
      bloqueos.push(inflar(rectDe(0, zc, d, d), MARGEN_CM));
    } else sinLugar.push("pista");
  }

  if (tiene("mesa_postres")) {
    const zc = zCampo + ANCHO_POSTRES_CM / 2 + 20;
    const xc = -anchoSala / 2 + 40 + FONDO_POSTRES_CM / 2;
    if (zc + ANCHO_POSTRES_CM / 2 < zFinCampo && anchoSala >= 500) {
      zonas.push({ id: PREFIJO_ZONA.mesa_postres, zona: "mesa_postres", mueble: "mesa_postres_mantel", anchoCm: ANCHO_POSTRES_CM, fondoCm: FONDO_POSTRES_CM, altoCm: 90, xCm: xc, zCm: zc, giroGrados: 90 });
      bloqueos.push({ x0: -anchoSala / 2, x1: xc + FONDO_POSTRES_CM / 2 + MARGEN_CM, z0: zc - ANCHO_POSTRES_CM / 2 - MARGEN_CM, z1: zc + ANCHO_POSTRES_CM / 2 + MARGEN_CM });
    } else sinLugar.push("mesa_postres");
  }

  return { zonas, celdas: celdasLibres(anchoSala, p.mesa, zCampo, zFinCampo, bloqueos), sinLugar };
}

const redondear100 = (n: number) => Math.round(n / 100) * 100;

/** La sala más chica (en área, con proporción de salón) donde caben las mesas pedidas. Si ninguna alcanza, la máxima. */
function derivarSala(p: ParamsSalon, necesarias: number): { anchoCm: number; fondoCm: number } {
  const candidatas: Array<{ a: number; f: number }> = [];
  for (let a = Math.max(SALA_MINIMA_CM, redondear100(p.salaMinima?.anchoCm ?? 0)); a <= SALA_MAXIMA_CM; a += 100) {
    for (let f = Math.max(SALA_MINIMA_CM, redondear100(p.salaMinima?.fondoCm ?? 0)); f <= SALA_MAXIMA_CM; f += 100) {
      if (f / a >= 0.8 && f / a <= 1.6) candidatas.push({ a, f });
    }
  }
  const costo = (c: { a: number; f: number }) => c.a * c.f * (1 + 0.3 * Math.abs(c.f / c.a - 1.25));
  candidatas.sort((x, y) => costo(x) - costo(y));
  const hallada = candidatas.find((c) => planear(c.a, c.f, p).celdas.length >= necesarias);
  return hallada ? { anchoCm: hallada.a, fondoCm: hallada.f } : { anchoCm: SALA_MAXIMA_CM, fondoCm: SALA_MAXIMA_CM };
}

/** Cuántas mesas de invitados caben en una sala de esas medidas con esas zonas. */
export function capacidadSalon(p: ParamsSalon & { sala: { anchoCm: number; fondoCm: number } }): number {
  return planear(p.sala.anchoCm, p.sala.fondoCm, p).celdas.length;
}

/** Distribuye el salón. Determinista: los mismos parámetros dan siempre lo mismo. */
export function distribuirSalon(p: ParamsSalon): DistribucionSalon {
  const necesarias = mesasNecesarias(p.invitados, p.mesa);
  const sala = p.sala ? { anchoCm: p.sala.anchoCm, fondoCm: p.sala.fondoCm } : derivarSala(p, necesarias);
  const { zonas, celdas, sinLugar } = planear(sala.anchoCm, sala.fondoCm, p);
  const colocadas = Math.min(necesarias, celdas.length);
  const mesa = MESAS_SALON[p.mesa];
  const mesas: ElementoSalon[] = celdas.slice(0, colocadas).map((c, k) => ({
    id: idMesa(k + 1), zona: null, mueble: mesa.mueble, anchoCm: mesa.anchoCm, fondoCm: mesa.fondoCm, altoCm: mesa.altoCm, xCm: c.x, zCm: c.z, giroGrados: 0,
  }));
  return { sala, elementos: [...zonas, ...mesas], mesasNecesarias: necesarias, capacidad: celdas.length, faltan: necesarias - colocadas, sinLugar };
}
