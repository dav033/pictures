import { inflar, rectDe, type RectCm, type ZonaSalon } from "./salon-zonas";

/**
 * **Distribución de un salón de eventos** (REQ-008): función pura que, dados los invitados, el tipo de mesa y las zonas
 * pedidas, dice qué mueble va dónde. Las mesas de invitados van por filas con pasillos: la mesa principal contra el fondo, la
 * pista de baile justo delante con mesas a sus dos lados y más filas detrás (hacia la entrada). Se llenan fila por fila del
 * centro hacia afuera, así que quitar invitados quita las últimas mesas y no mueve las demás. La mesa de postres va contra la
 * pared izquierda, el fondo de fotos contra la pared del fondo detrás de la mesa principal y la entrada al frente.
 *
 * Sala (cm): x de izquierda (−) a derecha (+) desde el centro, z de fondo (−) a frente (+); la pared del fondo está en z = −fondo/2.
 * No toca ninguna escena: `salon-armar.ts` y `salon-ajustar.ts` convierten esto en piezas.
 */

export const TIPOS_MESA_SALON = ["redonda8", "redonda10", "imperial"] as const;
export type TipoMesaSalon = (typeof TIPOS_MESA_SALON)[number];

/** Cada tipo de mesa de invitados: el conjunto del catálogo (mesa con sillas en una sola pieza) y lo que ocupa con las sillas. */
export type MedidasMesa = { mueble: string; puestos: number; anchoCm: number; fondoCm: number; altoCm: number };
export const MESAS_SALON: Readonly<Record<TipoMesaSalon, MedidasMesa>> = {
  redonda8: { mueble: "mesa_redonda_sillas", puestos: 8, anchoCm: 270, fondoCm: 270, altoCm: 90 },
  redonda10: { mueble: "mesa_redonda10_sillas", puestos: 10, anchoCm: 300, fondoCm: 300, altoCm: 90 },
  imperial: { mueble: "mesa_imperial_sillas", puestos: 10, anchoCm: 360, fondoCm: 198, altoCm: 90 },
};

/** Cuántas sillas admite cada forma de mesa: las redondas, de 2 a 12; la imperial, un número par de 4 a 20 (una en cada cabecera y el resto por pares a los lados). */
export const SILLAS_POR_MESA = { redonda: { min: 2, max: 12 }, imperial: { min: 4, max: 20 } } as const;
/** Lo que le suman las sillas a cada lado de la mesa (cm): lo mismo que `ALREDEDOR_SILLAS_CM` del catálogo, para que mesa y conjunto midan igual. */
const ALREDEDOR_SILLAS_CM = 60;

/** Por qué no vale ese número de sillas para ese tipo de mesa, o `null` si vale. */
export function falloDeSillas(mesa: TipoMesaSalon, sillas: number): string | null {
  const r = mesa === "imperial" ? SILLAS_POR_MESA.imperial : SILLAS_POR_MESA.redonda;
  if (!Number.isInteger(sillas) || sillas < r.min || sillas > r.max) return `sillas_por_mesa = ${sillas} está fuera de rango: en mesas ${mesa === "imperial" ? "imperiales va de 4 a 20 (par)" : "redondas va de 2 a 12"}.`;
  if (mesa === "imperial" && sillas % 2 !== 0) return `Una mesa imperial lleva un número par de sillas (una en cada cabecera y el resto por pares a los lados): ${sillas} no vale; prueba ${sillas - 1} o ${sillas + 1}.`;
  return null;
}

/**
 * Las medidas de la mesa de invitados: las de siempre, o las que salen de un número de sillas. Redonda: el diámetro de la mesa crece
 * 15 cm por silla (150 cm con 8 y 180 con 10, como las del catálogo) y las sillas van repartidas parejo por su circunferencia;
 * imperial: 60 cm de largo por cada par de sillas de los lados (240 cm con 10) y las dos de las cabeceras.
 */
export function medidasDeMesa(mesa: TipoMesaSalon, sillas?: number): MedidasMesa {
  const base = MESAS_SALON[mesa];
  if (sillas === undefined || sillas === base.puestos) return base;
  if (mesa === "imperial") return { ...base, puestos: sillas, anchoCm: Math.max(120, 30 * (sillas - 2)) + 2 * ALREDEDOR_SILLAS_CM };
  const diametro = 15 * sillas + 150;
  return { ...base, puestos: sillas, anchoCm: diametro, fondoCm: diametro };
}

/** Aire entre los conjuntos de mesas (cm): más que el pasillo mínimo de 90 cm para que quepa una silla echada atrás. */
export const PASILLO_CM = 91;
/** Lo que se deja entre una mesa y la pared o la pista (cm). */
export const MARGEN_CM = 90;
/** Del fondo de fotos: el panel va a 30 cm de la pared y lo que se arma delante empieza a 60 cm de ella. */
export const PANEL_RETIRO_CM = 30;
export const FRENTE_PANEL_CM = 60;
/** Profundidad (desde la pared) reservada al fondo de fotos cuando nada la pide mayor. */
export const PROFUNDIDAD_FONDO_CM = 150;
/** El tapete de la entrada queda a 170 cm de la pared del frente. */
export const ENTRADA_RETIRO_CM = 170;
/** Del panel al arco que va delante, y del tapete de la entrada al arco de la entrada (hacia la puerta). */
export const ARCO_FONDO_DELANTE_CM = 70;
export const ARCO_ENTRADA_DELANTE_CM = 100;
/** Entre el arco del fondo de fotos y el de la entrada: más cerca, uno tapa al otro. */
export const DISTANCIA_MINIMA_ARCOS_CM = 400;
/** De la mesa principal a lo que sigue (cm). */
const AIRE_TRAS_PRINCIPAL_CM = 100;
/** El pasillo de la entrada: el ancho del arco más aire a cada lado; las mesas de los lados siguen hasta el fondo de la sala. */
const ANCHO_PASILLO_ENTRADA_CM = 500;
/** De la pared a las sillas de la mesa principal, además del fondo de fotos: entero para poder leerlo de vuelta de la escena. */
export const SILLAS_DESDE_FONDO_CM = 23;

const SALA_MINIMA_CM = 600;
const SALA_MAXIMA_CM = 3000;
const ANCHO_PANEL_MAX_CM = 480;
const ANCHO_PRINCIPAL_MAX_CM = 360;
const FONDO_PRINCIPAL_CM = 92;
const SILLA_FONDO_CM = 45;
const ANCHO_POSTRES_CM = 194;
const FONDO_POSTRES_CM = 47;
const DIAMETRO_TAPETE_CM = 160;
const PISTA_MINIMA_CM = 250;

/** Los invitados que caben en cualquier tipo de mesa de una sala de 30 × 30 m con todas las zonas (el tope que acepta la IA). */
export const MAX_INVITADOS_SALON = 300;

export type RolElemento = "mesa" | "ancla" | "silla";

export type ElementoSalon = {
  /** Cómo se llama la pieza (el id real lo asigna quien la pone en la escena, sin repetir). */
  id: string;
  /** `null` en las mesas de invitados. */
  zona: ZonaSalon | null;
  rol: RolElemento;
  mueble: string;
  anchoCm: number;
  fondoCm: number;
  altoCm: number;
  /** Solo en las mesas de invitados con un número de sillas distinto al de siempre. */
  sillas?: number;
  xCm: number;
  zCm: number;
  giroGrados: number;
};

export type ParamsSalon = {
  /** 0: solo las zonas, sin mesas de invitados. */
  invitados: number;
  mesa: TipoMesaSalon;
  /** Sillas por mesa si no son las de siempre del tipo de mesa (ver `medidasDeMesa`). */
  sillas?: number;
  zonas: readonly ZonaSalon[];
  /** Sala fija (la pedida o la que ya hay). Si falta, la más chica que cabe con proporción de salón (largo : ancho entre 0,7 y 1,8). */
  sala?: { anchoCm: number; fondoCm: number };
  /** Con `sala` ausente: no baja de estas medidas (agrandar un salón sin encogerlo). */
  salaMinima?: { anchoCm: number; fondoCm: number };
  /** Rectángulos del piso que las mesas esquivan (piezas del usuario, zonas que se movieron). */
  reservas?: readonly RectCm[];
  /** Lo que ocupa el fondo de fotos desde la pared (cm); más que el de siempre si hay una decoración propia delante del panel. */
  profundidadFondoCm?: number;
  /** Diámetro (cm) de la pista, si ya existe una: agregar o quitar invitados no la cambia ni mueve las mesas. Si falta, sale de los invitados. */
  pistaCm?: number;
  /** Altura de la sala, para que el panel no la pase. */
  altoSalaCm?: number;
};

export type Celda = { xCm: number; zCm: number };

export type DistribucionSalon = {
  sala: { anchoCm: number; fondoCm: number };
  elementos: ElementoSalon[];
  /** Todos los sitios de mesa que hay, en el orden en que se llenan (los primeros `mesasNecesarias` llevan mesa en `elementos`). */
  celdas: Celda[];
  mesasNecesarias: number;
  capacidad: number;
  faltan: number;
  /** Zonas pedidas que no caben en la sala (muy chica). */
  sinLugar: ZonaSalon[];
};

/** La pista de baile: 0,2 m² por invitado (la mitad baila con ~0,4 m² cada uno), entre 3 y 4,5 m de diámetro. */
export const diametroPista = (invitados: number): number => Math.min(450, Math.max(300, Math.round((Math.sqrt((invitados * 0.2 * 4) / Math.PI) * 100) / 10) * 10));

export const mesasNecesarias = (invitados: number, mesa: TipoMesaSalon, sillas?: number): number => (invitados > 0 ? Math.ceil(invitados / medidasDeMesa(mesa, sillas).puestos) : 0);

/** Los tramos de [a, b] que quedan al quitar [x0, x1]. */
const sinTramo = (tramos: ReadonlyArray<readonly [number, number]>, x0: number, x1: number): Array<[number, number]> =>
  tramos.flatMap(([a, b]): Array<[number, number]> => (x1 <= a || x0 >= b ? [[a, b]] : [...(x0 > a ? [[a, x0] as [number, number]] : []), ...(x1 < b ? [[x1, b] as [number, number]] : [])]));

/** Los sitios de mesa de una sala, fila por fila: en cada fila, lo que deja libre lo bloqueado, con las mesas repartidas parejo en cada tramo. */
function celdasLibres(anchoSala: number, mesa: MedidasMesa, z0: number, z1: number, bloqueos: readonly RectCm[]): Celda[] {
  const { anchoCm, fondoCm } = mesa;
  const filas = Math.floor((z1 - z0 + PASILLO_CM) / (fondoCm + PASILLO_CM));
  const celdas: Celda[] = [];
  for (let j = 0; j < filas; j++) {
    const z = z0 + fondoCm / 2 + j * (fondoCm + PASILLO_CM);
    let tramos: Array<[number, number]> = [[-anchoSala / 2 + MARGEN_CM, anchoSala / 2 - MARGEN_CM]];
    for (const b of bloqueos) if (b.z0 < z + fondoCm / 2 && b.z1 > z - fondoCm / 2) tramos = sinTramo(tramos, b.x0, b.x1);
    const fila: Celda[] = [];
    for (const [a, b] of tramos) {
      const largo = b - a, k = Math.floor((largo + PASILLO_CM) / (anchoCm + PASILLO_CM));
      if (k < 1) continue;
      const ocupa = k * anchoCm + (k - 1) * PASILLO_CM;
      for (let i = 0; i < k; i++) fila.push({ xCm: a + (largo - ocupa) / 2 + anchoCm / 2 + i * (anchoCm + PASILLO_CM), zCm: z });
    }
    celdas.push(...fila.sort((u, v) => Math.abs(u.xCm) - Math.abs(v.xCm) || u.xCm - v.xCm));
  }
  return celdas;
}

type Plan = { zonas: ElementoSalon[]; celdas: Celda[]; sinLugar: ZonaSalon[] };

/** Todo menos las mesas de invitados, y los sitios libres para ellas, de una sala de esas medidas. */
function planear(anchoSala: number, fondoSala: number, p: ParamsSalon): Plan {
  const tiene = (z: ZonaSalon) => p.zonas.includes(z);
  const zonas: ElementoSalon[] = [];
  const bloqueos: RectCm[] = (p.reservas ?? []).map((r) => inflar(r, 40));
  const sinLugar: ZonaSalon[] = [];
  const zFondo = -fondoSala / 2;
  const profundidad = p.profundidadFondoCm ?? PROFUNDIDAD_FONDO_CM;
  const mesa = medidasDeMesa(p.mesa, p.sillas);

  const anchoPanel = Math.min(ANCHO_PANEL_MAX_CM, anchoSala - 200);
  const conFondo = tiene("fondo_fotos") && anchoPanel >= 150;
  if (tiene("fondo_fotos") && !conFondo) sinLugar.push("fondo_fotos");
  if (conFondo) {
    const alto = Math.min(300, (p.altoSalaCm ?? 450) - 40);
    zonas.push({ id: "salon-fondo", zona: "fondo_fotos", rol: "ancla", mueble: "marco_tela", anchoCm: anchoPanel, fondoCm: 34, altoCm: alto, xCm: 0, zCm: zFondo + PANEL_RETIRO_CM, giroGrados: 0 });
  }

  const anchoPrincipal = Math.min(ANCHO_PRINCIPAL_MAX_CM, anchoSala - 2 * MARGEN_CM);
  const conPrincipal = tiene("mesa_principal") && anchoPrincipal >= 150;
  if (tiene("mesa_principal") && !conPrincipal) sinLugar.push("mesa_principal");
  let finPrincipal = 0;
  if (conPrincipal) {
    const zSillas = zFondo + (conFondo ? profundidad : 60) + SILLAS_DESDE_FONDO_CM;
    const zMesa = zSillas + SILLA_FONDO_CM / 2 + FONDO_PRINCIPAL_CM / 2 + 6;
    finPrincipal = zMesa + FONDO_PRINCIPAL_CM / 2;
    zonas.push({ id: "salon-principal", zona: "mesa_principal", rol: "ancla", mueble: "mesa_imperial_mantel", anchoCm: anchoPrincipal, fondoCm: FONDO_PRINCIPAL_CM, altoCm: 75, xCm: 0, zCm: zMesa, giroGrados: 0 });
    const sillas = Math.min(8, Math.floor((anchoPrincipal - 20) / 55));
    for (let i = 0; i < sillas; i++) zonas.push({ id: `salon-principal-silla-${i + 1}`, zona: "mesa_principal", rol: "silla", mueble: "silla_tiffany", anchoCm: 45, fondoCm: SILLA_FONDO_CM, altoCm: 90, xCm: (i - (sillas - 1) / 2) * 55, zCm: zSillas, giroGrados: 0 });
  }

  const zCampo = conPrincipal ? finPrincipal + AIRE_TRAS_PRINCIPAL_CM : conFondo ? zFondo + profundidad + 100 : zFondo + MARGEN_CM;
  const conEntrada = tiene("entrada");
  const zEntrada = fondoSala / 2 - ENTRADA_RETIRO_CM;
  const zFinCampo = fondoSala / 2 - MARGEN_CM;
  if (conEntrada) {
    const previo = conPrincipal ? finPrincipal : conFondo ? zFondo + profundidad : zFondo;
    const separaArcos = !conFondo || (zEntrada + ARCO_ENTRADA_DELANTE_CM) - (zFondo + PANEL_RETIRO_CM + ARCO_FONDO_DELANTE_CM) >= DISTANCIA_MINIMA_ARCOS_CM;
    if (zEntrada - DIAMETRO_TAPETE_CM / 2 > previo && separaArcos) {
      bloqueos.push({ x0: -ANCHO_PASILLO_ENTRADA_CM / 2, x1: ANCHO_PASILLO_ENTRADA_CM / 2, z0: zEntrada - DIAMETRO_TAPETE_CM / 2 - MARGEN_CM, z1: fondoSala / 2 });
      zonas.push({ id: "salon-entrada", zona: "entrada", rol: "ancla", mueble: "alfombra_redonda", anchoCm: DIAMETRO_TAPETE_CM, fondoCm: DIAMETRO_TAPETE_CM, altoCm: 1, xCm: 0, zCm: zEntrada, giroGrados: 0 });
    } else sinLugar.push("entrada");
  }

  if (tiene("pista")) {
    const d = Math.min(p.pistaCm ?? diametroPista(p.invitados), anchoSala - 2 * MARGEN_CM, zFinCampo - zCampo);
    if (d >= PISTA_MINIMA_CM) {
      // La pista queda en las primeras filas, con mesas a sus lados: baja hasta centrarse en ellas sin acercarse a menos de 90 cm de la fila de abajo.
      const paso = mesa.fondoCm + PASILLO_CM;
      const filas = Math.ceil((d + MARGEN_CM) / paso);
      const z0 = zCampo + Math.min(70, Math.max(0, filas * paso - MARGEN_CM - d));
      zonas.push({ id: "salon-pista", zona: "pista", rol: "ancla", mueble: "alfombra_redonda", anchoCm: d, fondoCm: d, altoCm: 1, xCm: 0, zCm: z0 + d / 2, giroGrados: 0 });
      bloqueos.push({ x0: -d / 2 - MARGEN_CM, x1: d / 2 + MARGEN_CM, z0: z0 - MARGEN_CM, z1: z0 + d + MARGEN_CM });
    } else sinLugar.push("pista");
  }

  if (tiene("mesa_postres")) {
    const zc = zCampo + ANCHO_POSTRES_CM / 2 + 20;
    const xc = -anchoSala / 2 + 40 + FONDO_POSTRES_CM / 2;
    if (zc + ANCHO_POSTRES_CM / 2 < zFinCampo && anchoSala >= 500) {
      zonas.push({ id: "salon-postres", zona: "mesa_postres", rol: "ancla", mueble: "mesa_postres_mantel", anchoCm: ANCHO_POSTRES_CM, fondoCm: FONDO_POSTRES_CM, altoCm: 90, xCm: xc, zCm: zc, giroGrados: 90 });
      bloqueos.push({ x0: -anchoSala / 2, x1: xc + FONDO_POSTRES_CM / 2 + MARGEN_CM, z0: zc - ANCHO_POSTRES_CM / 2 - MARGEN_CM, z1: zc + ANCHO_POSTRES_CM / 2 + MARGEN_CM });
    } else sinLugar.push("mesa_postres");
  }

  return { zonas, celdas: celdasLibres(anchoSala, mesa, zCampo, zFinCampo, bloqueos), sinLugar };
}

const redondear50 = (n: number) => Math.ceil(n / 50) * 50;

/** La sala más chica (en área, con proporción de salón) donde caben las mesas pedidas. Si ninguna alcanza, la máxima. */
function derivarSala(p: ParamsSalon, necesarias: number): { anchoCm: number; fondoCm: number } {
  const candidatas: Array<{ a: number; f: number }> = [];
  for (let a = Math.max(SALA_MINIMA_CM, redondear50(p.salaMinima?.anchoCm ?? 0)); a <= SALA_MAXIMA_CM; a += 50) {
    for (let f = Math.max(SALA_MINIMA_CM, redondear50(p.salaMinima?.fondoCm ?? 0)); f <= SALA_MAXIMA_CM; f += 50) {
      if (f / a >= 0.7 && f / a <= 1.8) candidatas.push({ a, f });
    }
  }
  const costo = (c: { a: number; f: number }) => c.a * c.f * (1 + 0.3 * Math.abs(c.f / c.a - 1.25));
  candidatas.sort((x, y) => costo(x) - costo(y));
  const hallada = candidatas.find((c) => planear(c.a, c.f, p).celdas.length >= necesarias);
  return hallada ? { anchoCm: hallada.a, fondoCm: hallada.f } : { anchoCm: SALA_MAXIMA_CM, fondoCm: SALA_MAXIMA_CM };
}

/** Distribuye el salón. Determinista: los mismos parámetros dan siempre lo mismo. */
export function distribuirSalon(p: ParamsSalon): DistribucionSalon {
  const necesarias = mesasNecesarias(p.invitados, p.mesa, p.sillas);
  const sala = p.sala ? { anchoCm: p.sala.anchoCm, fondoCm: p.sala.fondoCm } : derivarSala(p, necesarias);
  const { zonas, celdas, sinLugar } = planear(sala.anchoCm, sala.fondoCm, p);
  const colocadas = Math.min(necesarias, celdas.length);
  const mesa = medidasDeMesa(p.mesa, p.sillas);
  const mesas: ElementoSalon[] = celdas.slice(0, colocadas).map((c, k) => ({
    id: `salon-mesa-${String(k + 1).padStart(2, "0")}`, zona: null, rol: "mesa", mueble: mesa.mueble, anchoCm: mesa.anchoCm, fondoCm: mesa.fondoCm, altoCm: mesa.altoCm, ...(p.sillas !== undefined && p.sillas !== MESAS_SALON[p.mesa].puestos ? { sillas: p.sillas } : {}), xCm: c.xCm, zCm: c.zCm, giroGrados: 0,
  }));
  return { sala, elementos: [...zonas, ...mesas], celdas, mesasNecesarias: necesarias, capacidad: celdas.length, faltan: necesarias - colocadas, sinLugar };
}

/** El rectángulo del piso de un elemento (con su giro). */
export const rectDeElemento = (e: ElementoSalon): RectCm => (Math.abs(e.giroGrados) % 180 === 90 ? rectDe(e.xCm, e.zCm, e.fondoCm, e.anchoCm) : rectDe(e.xCm, e.zCm, e.anchoCm, e.fondoCm));
