import type { EstampadoGlobo } from "./decoraciones";

/**
 * **Lo impreso sobre un globo** (generaliza el estampado de polígonos de los ojos y la calabaza): una textura que el
 * visor dibuja en un lienzo y envuelve sobre el cuerpo del globo, con su color de tinta. Aquí solo hay datos
 * (definiciones puras, sin DOM): qué capas lleva el impreso y cómo se ve cada una. El dibujo está en
 * `components/tres-d/textura-impreso.ts`, que guarda cada textura por su clave (un ramo de 9 globos iguales usa 1).
 *
 * Cómo se mide (en un globo redondo): en **grados de arco** sobre la superficie. 1° es 1/360 de la vuelta del globo
 * por el ecuador: en un R-12 inflado a 25 cm, 1° ≈ 0,22 cm. Así el mismo impreso sirve en un R-5 y en un R-24.
 * - Las capas de **frente** (texto, cara, ícono) se dibujan como se verían mirando el globo de frente (proyección
 *   equidistante: la distancia al centro del dibujo es el arco medido sobre el látex) y se pegan centradas hacia el
 *   `frente` del globo. `repetir` las copia alrededor: 1 = una cara, 2 = las dos caras («2 CARAS» de la tienda),
 *   3 = tres veces alrededor (los Infinity que repiten el mensaje).
 * - Las capas de **patrón** (corazones, estrellas, lunares, telarañas, confeti, graffiti…) cubren todo el globo: se
 *   reparten por filas de latitud con menos motivos cerca de los polos, para que se vean del mismo tamaño en todas
 *   partes (como un Infinity, que imprime alrededor).
 * En un corazón (C-12) la textura se pega plana en sus dos caras.
 */

/** Una tinta: su color y si es metalizada (dorado, plata, cobre: el visor la hace brillar). */
export type TintaImpreso = { hex: string; metalica?: boolean };

/** Motivos que se repiten por todo el globo. */
export type MotivoPatron =
  | "corazon" | "estrella" | "punto" | "telarana" | "arana" | "confeti" | "graffiti" | "bigote" | "corbatin" | "diamante"
  | "hoja" | "paloma" | "copo" | "marmol" | "terrazo" | "animal" | "flor" | "mariposa" | "balon" | "splash" | "destello"
  | "interrogacion" | "nota";

/** Íconos sencillos (uno, en la cara del globo). */
export type IconoImpreso =
  | "corazon" | "estrella" | "balon" | "paloma" | "birrete" | "corona" | "interrogacion" | "bigote" | "corbatin" | "arbol"
  | "calabaza" | "copa" | "regalo" | "pastel" | "mariposa" | "flor" | "sombrero" | "biberon" | "diamante";

/** Expresiones de una cara impresa (o pegada) sobre el globo. */
export type ExpresionCara = "feliz" | "risa" | "guino" | "sorpresa" | "enamorado" | "bravo" | "monstruo" | "dormido" | "lengua" | "triste";

/** Letra del texto: redonda (la de casi todos los «Feliz cumpleaños»), manuscrita (cursiva) o de bloque (gruesa). */
export type LetraImpreso = "redonda" | "manuscrita" | "bloque";

export type CapaTexto = {
  tipo: "texto";
  /** Las líneas van separadas por «\n». */
  texto: string;
  tinta: TintaImpreso;
  letra: LetraImpreso;
  /** Alto de la letra (grados de arco). Si el renglón no cabe en `anchoMaxGrados`, se achica. */
  altoGrados: number;
  /** Curva del renglón: grados de arco que abarca (0 = recto; 60 = sonrisa suave). Negativo, curva hacia arriba. */
  arcoGrados?: number;
  /** Corre el bloque de texto hacia arriba (+) o abajo (−), en grados de arco desde el centro de la cara. */
  dyGrados?: number;
  /** Ancho máximo del renglón (grados de arco); por defecto 125. */
  anchoMaxGrados?: number;
  /** Borde de otra tinta alrededor de las letras (el blanco detrás del dorado). */
  borde?: TintaImpreso | null;
};

export type CapaPatron = {
  tipo: "patron";
  motivo: MotivoPatron;
  /** Una o varias tintas: los motivos las usan en orden (o al azar fijo). */
  tintas: TintaImpreso[];
  /** Motivos por vuelta en el ecuador. */
  porVuelta: number;
  /** Tamaño de cada motivo (grados de arco). */
  tamanoGrados: number;
  /** Para variar el reparto entre dos impresos del mismo motivo. */
  semilla?: number;
};

export type CapaCara = {
  tipo: "cara";
  expresion: ExpresionCara;
  tinta: TintaImpreso;
  /** Chapas de las mejillas (rosado); null o sin dar, sin mejillas. */
  mejillas?: TintaImpreso | null;
  /** Ancho de la cara (grados de arco); por defecto 80. */
  anchoGrados?: number;
  dyGrados?: number;
};

export type CapaIcono = {
  tipo: "icono";
  icono: IconoImpreso;
  tinta: TintaImpreso;
  /** Segunda tinta (el centro de una flor, la cinta de un regalo). */
  tinta2?: TintaImpreso | null;
  /** Lado del ícono (grados de arco); por defecto 50. */
  tamanoGrados?: number;
  dxGrados?: number;
  dyGrados?: number;
};

export type CapaImpreso = CapaTexto | CapaPatron | CapaCara | CapaIcono;

/**
 * Un impreso completo: sus capas (se pintan en orden, la última encima) y cuántas veces se repite lo de frente
 * alrededor del globo (1, 2 o 3).
 */
export type ImpresoGlobo = { capas: CapaImpreso[]; repetir: 1 | 2 | 3 };

export const MOTIVOS_PATRON: readonly MotivoPatron[] = [
  "corazon", "estrella", "punto", "telarana", "arana", "confeti", "graffiti", "bigote", "corbatin", "diamante", "hoja", "paloma",
  "copo", "marmol", "terrazo", "animal", "flor", "mariposa", "balon", "splash", "destello", "interrogacion", "nota",
];
export const ICONOS_IMPRESO: readonly IconoImpreso[] = [
  "corazon", "estrella", "balon", "paloma", "birrete", "corona", "interrogacion", "bigote", "corbatin", "arbol", "calabaza", "copa",
  "regalo", "pastel", "mariposa", "flor", "sombrero", "biberon", "diamante",
];
export const EXPRESIONES_CARA: readonly ExpresionCara[] = ["feliz", "risa", "guino", "sorpresa", "enamorado", "bravo", "monstruo", "dormido", "lengua", "triste"];

// ----------------------------------------------------------------------------------------------------------
// Tintas de siempre
// ----------------------------------------------------------------------------------------------------------

export const TINTA = {
  blanco: { hex: "#ffffff" },
  negro: { hex: "#1b1b1f" },
  dorado: { hex: "#c9a14a", metalica: true },
  plata: { hex: "#c4c7cc", metalica: true },
  cobre: { hex: "#b8734a", metalica: true },
  doradoRosa: { hex: "#d79a8a", metalica: true },
  rojo: { hex: "#d42032" },
  rosado: { hex: "#f29bb7" },
  fucsia: { hex: "#e0397f" },
  morado: { hex: "#7d3c98" },
  azul: { hex: "#2f6fc0" },
  azulCielo: { hex: "#7cc3ea" },
  azulNaval: { hex: "#1d3461" },
  verde: { hex: "#2e9e57" },
  verdeLima: { hex: "#9bd24a" },
  amarillo: { hex: "#f6d21c" },
  naranja: { hex: "#f07a22" },
  gris: { hex: "#8a8f96" },
  cafe: { hex: "#6b4a2f" },
  lila: { hex: "#b79ad6" },
  turquesa: { hex: "#2bb3b1" },
} as const satisfies Record<string, TintaImpreso>;

// ----------------------------------------------------------------------------------------------------------
// Ayudas para armar impresos
// ----------------------------------------------------------------------------------------------------------

export const texto = (t: string, tinta: TintaImpreso, opciones: Partial<Omit<CapaTexto, "tipo" | "texto" | "tinta">> = {}): CapaTexto =>
  ({ tipo: "texto", texto: t, tinta, letra: opciones.letra ?? "redonda", altoGrados: opciones.altoGrados ?? 16, ...opciones });

export const patron = (motivo: MotivoPatron, tintas: TintaImpreso[], porVuelta = 9, tamanoGrados = 22, semilla?: number): CapaPatron =>
  ({ tipo: "patron", motivo, tintas, porVuelta, tamanoGrados, ...(semilla !== undefined ? { semilla } : {}) });

export const cara = (expresion: ExpresionCara, tinta: TintaImpreso = TINTA.negro, opciones: Partial<Omit<CapaCara, "tipo" | "expresion" | "tinta">> = {}): CapaCara =>
  ({ tipo: "cara", expresion, tinta, ...opciones });

export const icono = (i: IconoImpreso, tinta: TintaImpreso, opciones: Partial<Omit<CapaIcono, "tipo" | "icono" | "tinta">> = {}): CapaIcono =>
  ({ tipo: "icono", icono: i, tinta, ...opciones });

export const impreso = (capas: CapaImpreso[], repetir: 1 | 2 | 3 = 1): ImpresoGlobo => ({ capas, repetir });

/**
 * El estampado de un globo a partir de un impreso, listo para `GloboDecoracion.estampado`: va centrado en la cara
 * (hacia `frente`, que el globo debe traer para saber dónde es delante) y no lleva polígonos.
 */
export function estampadoDeImpreso(i: ImpresoGlobo): EstampadoGlobo {
  return { en: "cara", capas: [], impreso: i };
}

/**
 * Una cara dibujada sobre el globo (para figuras: muñecos, animales, personajes de tubito): ojos, boca y mejillas
 * en la tinta pedida, de `anchoGrados` de ancho. Devuelve el estampado listo para el globo de la cabeza.
 */
export function estampadoCara(expresion: ExpresionCara, tinta: TintaImpreso = TINTA.negro, opciones: { mejillas?: TintaImpreso | null; anchoGrados?: number; dyGrados?: number } = {}): EstampadoGlobo {
  return estampadoDeImpreso(impreso([cara(expresion, tinta, { mejillas: opciones.mejillas ?? null, anchoGrados: opciones.anchoGrados ?? 80, dyGrados: opciones.dyGrados ?? 0 })]));
}

/** La clave de un impreso (la de la textura guardada): dos impresos iguales dan la misma clave. */
export function claveImpreso(i: ImpresoGlobo): string {
  return JSON.stringify(i);
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Lo que está mal en un impreso (vacío si está bien): sin capas, tintas que no son hex, medidas fuera de rango… */
export function erroresImpreso(i: ImpresoGlobo): string[] {
  const errores: string[] = [];
  if (!i.capas.length) errores.push("sin capas");
  if (![1, 2, 3].includes(i.repetir)) errores.push(`repetir ${String(i.repetir)} no es 1, 2 ni 3`);
  const tinta = (t: TintaImpreso | null | undefined, donde: string) => { if (t && !HEX.test(t.hex)) errores.push(`${donde}: tinta «${t.hex}» no es un hex`); };
  i.capas.forEach((c, k) => {
    const donde = `capa ${k} (${c.tipo})`;
    switch (c.tipo) {
      case "texto":
        if (!c.texto.trim()) errores.push(`${donde}: texto vacío`);
        if (!(c.altoGrados > 2 && c.altoGrados < 60)) errores.push(`${donde}: alto ${c.altoGrados}° fuera de 2–60`);
        tinta(c.tinta, donde); tinta(c.borde, donde);
        break;
      case "patron":
        if (!MOTIVOS_PATRON.includes(c.motivo)) errores.push(`${donde}: motivo «${String(c.motivo)}» desconocido`);
        if (!c.tintas.length) errores.push(`${donde}: sin tintas`);
        if (!(c.porVuelta >= 1 && c.porVuelta <= 40)) errores.push(`${donde}: ${c.porVuelta} motivos por vuelta fuera de 1–40`);
        if (!(c.tamanoGrados > 1 && c.tamanoGrados < 120)) errores.push(`${donde}: tamaño ${c.tamanoGrados}° fuera de 1–120`);
        c.tintas.forEach((t) => tinta(t, donde));
        break;
      case "cara":
        if (!EXPRESIONES_CARA.includes(c.expresion)) errores.push(`${donde}: expresión «${String(c.expresion)}» desconocida`);
        tinta(c.tinta, donde); tinta(c.mejillas, donde);
        break;
      case "icono":
        if (!ICONOS_IMPRESO.includes(c.icono)) errores.push(`${donde}: ícono «${String(c.icono)}» desconocido`);
        tinta(c.tinta, donde); tinta(c.tinta2, donde);
        break;
    }
  });
  return errores;
}

/** Qué lleva impreso, en inglés y corto (para la descripción que acompaña la foto con IA). */
export function impresoEnIngles(i: ImpresoGlobo): string {
  const partes = i.capas.map((c) => {
    switch (c.tipo) {
      case "texto": return `the words "${c.texto.replace(/\n/g, " ")}"`;
      case "patron": return `an all-over ${c.motivo} pattern`;
      case "cara": return `a ${c.expresion} face`;
      case "icono": return `a ${c.icono} icon`;
    }
  });
  return `printed with ${partes.join(" and ")}`;
}
