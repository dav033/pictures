import type { Colocacion, Sala } from "./escena";
import { SALA_INICIAL } from "./escena";
import type { Conjunto, NodoConjunto } from "./biblioteca";
import type { Pieza } from "./piezas";
import type { Vec3 } from "./modulos";
import type { ColorOrganico, OpcionesOrganico } from "./organico";
import type { OpcionesArcoOrganico } from "./formas-escena";
import type { OpcionesFlores } from "./flores-artificiales";
import type { Decoracion } from "./figuras";
import type { AcabadoEscenografia } from "./escenografia";
import { coloresDelFormato } from "./formatos";
import {
  contornoMarco, opcionesArcoOrganicoParametrico, opcionesColumnaOrganica,
  type ParametrosArcoOrganico, type ParametrosColumnaOrganica, type PesosFormato,
} from "./estructuras-organicas";

/**
 * **Bases orgánicas**: arcos y columnas orgánicos de fotos de decoradores y fabricantes encontradas en internet,
 * digitalizados con los PARÁMETROS del generador (medidas, curva, inclinación, grosores, mezcla de tamaños por formato,
 * colores con pesos, franjas de color, densidad, decoraciones colgadas), no como una lista fija de globos: el motor los
 * vuelve a armar cada vez, así que sirven de punto de partida para crear más (más alto, otro color, otra curva).
 *
 * Cada base guarda el crédito (sitio y url de la página de origen, y la url pública de la foto: aquí NO se copia
 * ninguna imagen) y una nota honesta de qué quedó igual y qué no. Las fotos descargadas para medirlas viven fuera del
 * repo (`ideas-fiesta-sempertex/web-organicos/`, con su `indice.json`).
 *
 * Cómo se editan: en la biblioteca salen como estructuras (o estructuras con decoraciones). Los arcos de dos patas
 * simétricos van como pieza `arco_organico` (el panel de la escena cambia ancho, alto, grosores, densidad y colores);
 * los demás como pieza `organico` con sus tramos ya calculados (colores en el panel; alto, ancho, grosor, colores y
 * tamaños con `cambiar_pieza` de la IA de escena). `piezaDeBase(base, cambios)` vuelve a armar desde los parámetros.
 */

export type TipoBase = "arco" | "columna";

/** La forma, con los parámetros de su generador. */
export type FormaBase =
  | { generador: "columna"; columna: ParametrosColumnaOrganica }
  | { generador: "arco"; arco: ParametrosArcoOrganico }
  | { generador: "arco_organico"; arco: OpcionesArcoOrganico };

/**
 * Lo que la base lleva además de la estructura:
 * - `colgada`: una decoración (flor de globos, moño…) repetida en los huecos de la estructura (`cada` hueco, desde el
 *   `desde`): se reservan `huecos` huecos en el motor.
 * - `remate`: una pieza en un punto relativo a la estructura (el globo grande de arriba).
 * - `marco`: el aro o marco de detrás de una guirnalda sobre marco (escenografía: no es producto): una banda de
 *   `anchoCm` con la forma del marco, metida `margenCm` desde la medida por fuera.
 */
export type ExtraBase =
  | { tipo: "colgada"; nombre: string; decoracion: Decoracion; cada: number; desde?: number }
  | { tipo: "remate"; nombre: string; pieza: Pieza; puntoCm: Vec3 }
  | { tipo: "marco"; nombre: string; hex: string; acabado: AcabadoEscenografia; grosorCm: number; margenCm: number; anchoCm: number };

export type FuenteBase = { sitio: string; urlPagina: string; urlImagen?: string };

export type BaseOrganica = {
  /** «base-organica:…», estable. */
  id: string;
  nombre: string;
  tipo: TipoBase;
  /** Semiarco, arco completo, inclinada, en espiral… */
  subtipo: string;
  ocasiones: string[];
  fuente: FuenteBase;
  forma: FormaBase;
  /** Huecos reservados en la estructura para lo que cuelga (y flores artificiales). */
  huecos?: number;
  /** Flores artificiales (de tela) en los huecos. */
  flores?: OpcionesFlores;
  extras?: readonly ExtraBase[];
  /** Qué quedó igual a la foto y qué no (honesto). */
  nota: string;
  /** 1 (se parece poco) a 5 (casi igual), juzgado contra la foto. */
  fidelidad: 1 | 2 | 3 | 4 | 5;
};

// ----------------------------------------------------------------------------------------------------------
// Colores: solo los que existen en cada formato
// ----------------------------------------------------------------------------------------------------------

/** Los formatos que usa una mezcla (con peso). */
function formatosDe(...mezclas: PesosFormato[]): string[] {
  return [...new Set(mezclas.flatMap((m) => Object.entries(m).filter(([, p]) => p > 0).map(([f]) => f)))];
}

/** Los formatos que pide la forma (mezclas de estructura y relleno). */
export function formatosDeForma(forma: FormaBase): string[] {
  if (forma.generador === "arco_organico") return ["R-24", "R-18", "R-12", "R-9", "R-5"];
  const relleno = (forma.generador === "columna" ? forma.columna.relleno : forma.arco.relleno)?.map((r) => r.formatoId) ?? ["R-9", "R-5"];
  if (forma.generador === "columna") {
    const c = forma.columna;
    return [...new Set([...formatosDe(c.mezcla.base, c.mezcla.punta, ...(c.espiral ? [c.espiral.mezcla] : []), ...(c.monticulo ? [c.monticulo.mezcla] : [])), ...relleno])];
  }
  return [...new Set([...formatosDe(...forma.arco.segmentos.flatMap((s) => [s.mezcla.inicio, s.mezcla.fin])), ...relleno])];
}

/**
 * Cada color limitado a los formatos en que se fabrica (un Reflex que no viene en R-9 va solo en los demás), como hace
 * el decorador: así el motor no sustituye nada. Si un color no se fabrica en ninguno de los formatos, error.
 */
export function coloresQueExisten(colores: readonly ColorOrganico[], formatos: readonly string[]): ColorOrganico[] {
  return colores.map((c) => {
    const base = c.formatos ?? formatos;
    const existen = base.filter((f) => coloresDelFormato(f).some((r) => r.codigo === c.codigo));
    if (existen.length === 0) throw new Error(`El color ${c.codigo} no se fabrica en ninguno de ${base.join(", ")}`);
    return existen.length === formatos.length && !c.formatos ? { ...c } : { ...c, formatos: existen };
  });
}

// ----------------------------------------------------------------------------------------------------------
// Armar una base: la pieza, el conjunto y el item
// ----------------------------------------------------------------------------------------------------------

/** Cambios sobre los parámetros (lo que pide el usuario o la IA al partir de una base). */
export type CambiosBase = { altoCm?: number; anchoCm?: number; colores?: readonly ColorOrganico[]; inclinacionGrados?: number; densidad?: number; semilla?: number };

/** La forma con los cambios aplicados (alto, ancho, colores, inclinación, densidad, semilla). */
export function formaConCambios(forma: FormaBase, c: CambiosBase = {}): FormaBase {
  if (forma.generador === "columna") {
    const p = forma.columna;
    return {
      generador: "columna",
      columna: {
        ...p,
        ...(c.altoCm !== undefined ? { altoCm: c.altoCm } : {}),
        ...(c.anchoCm !== undefined ? { grosorBaseCm: c.anchoCm, grosorMedioCm: (p.grosorMedioCm * c.anchoCm) / p.grosorBaseCm, grosorPuntaCm: (p.grosorPuntaCm * c.anchoCm) / p.grosorBaseCm } : {}),
        ...(c.colores ? { colores: c.colores.map((x) => ({ ...x })) } : {}),
        ...(c.inclinacionGrados !== undefined ? { inclinacionGrados: c.inclinacionGrados } : {}),
        ...(c.densidad !== undefined ? { densidad: c.densidad } : {}),
        ...(c.semilla !== undefined ? { semilla: c.semilla } : {}),
      },
    };
  }
  if (forma.generador === "arco") {
    return {
      generador: "arco",
      arco: {
        ...forma.arco,
        ...(c.altoCm !== undefined ? { altoCm: c.altoCm } : {}),
        ...(c.anchoCm !== undefined ? { anchoCm: c.anchoCm } : {}),
        ...(c.colores ? { colores: c.colores.map((x) => ({ ...x })) } : {}),
        ...(c.densidad !== undefined ? { densidad: c.densidad } : {}),
        ...(c.semilla !== undefined ? { semilla: c.semilla } : {}),
      },
    };
  }
  return {
    generador: "arco_organico",
    arco: {
      ...forma.arco,
      ...(c.altoCm !== undefined ? { altoCm: c.altoCm } : {}),
      ...(c.anchoCm !== undefined ? { anchoCm: c.anchoCm } : {}),
      ...(c.colores ? { colores: c.colores.map((x) => ({ ...x })) } : {}),
      ...(c.densidad !== undefined ? { densidad: c.densidad } : {}),
      ...(c.semilla !== undefined ? { semilla: c.semilla } : {}),
    },
  };
}

/** Las opciones del motor de una forma (con los colores ya limitados a sus formatos). */
export function opcionesDeForma(forma: FormaBase, huecos = 0): OpcionesOrganico {
  const formatos = formatosDeForma(forma);
  if (forma.generador === "columna") return { ...opcionesColumnaOrganica({ ...forma.columna, colores: coloresQueExisten(forma.columna.colores, formatos) }), huecosFlores: huecos };
  if (forma.generador === "arco") return { ...opcionesArcoOrganicoParametrico({ ...forma.arco, colores: coloresQueExisten(forma.arco.colores, formatos) }), huecosFlores: huecos };
  throw new Error("El arco orgánico de dos patas se arma como pieza `arco_organico`.");
}

/** La pieza de la estructura de una base, armable y editable (con los cambios pedidos). */
export function piezaDeBase(base: BaseOrganica, cambios: CambiosBase = {}): Pieza {
  const forma = formaConCambios(base.forma, cambios);
  const huecos = base.huecos ?? 0;
  if (forma.generador === "arco_organico") {
    return { tipo: "arco_organico", arco: { ...forma.arco, colores: coloresQueExisten(forma.arco.colores, formatosDeForma(forma)), flores: base.flores ? structuredClone(base.flores) : null, huecosFlores: huecos } };
  }
  return { tipo: "organico", opciones: opcionesDeForma(forma, huecos), flores: base.flores ? structuredClone(base.flores) : null };
}

/** La sala para ver una base: la de partida, sin paredes laterales ni techo. */
const SALA_BASE: Sala = { ...SALA_INICIAL, tonos: { ...SALA_INICIAL.tonos }, mostrar: { piso: true, fondo: true, laterales: false, techo: false } };

const EN_EL_PISO: Colocacion = { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 };

/** Los hijos del conjunto (lo que cuelga, el remate y el marco); vacío si la base no lleva extras. */
export function hijosDeBase(base: BaseOrganica): NodoConjunto[] {
  const hijos: NodoConjunto[] = [];
  for (const e of base.extras ?? []) {
    const id = `hijo-${hijos.length + 1}`;
    if (e.tipo === "colgada") hijos.push({ id, nombre: e.nombre, pieza: { tipo: "decoracion", decoracion: structuredClone(e.decoracion) }, colocacion: { en: "ancla", padreId: "estructura", ancla: e.desde ?? 0, cada: e.cada, giroGrados: 0 } });
    else if (e.tipo === "remate") hijos.push({ id, nombre: e.nombre, pieza: structuredClone(e.pieza), colocacion: { en: "relativa", puntoCm: { ...e.puntoCm }, giroGrados: 0 } });
    else {
      if (base.forma.generador !== "arco") throw new Error(`${base.id}: el marco solo va con el generador de arco`);
      if (base.forma.arco.marco.forma === "arco") throw new Error(`${base.id}: el marco va con un aro o un rectángulo cerrado`);
      const redondo = (q: { x: number; y: number }) => ({ x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 });
      const contorno = contornoMarco(base.forma.arco, e.margenCm).map(redondo);
      const hueco = contornoMarco(base.forma.arco, e.margenCm + e.anchoCm).map(redondo);
      hijos.push({
        id, nombre: e.nombre,
        pieza: { tipo: "escenografia", elementos: [{ forma: "panel", contorno, huecos: [hueco], zCm: -e.grosorCm / 2, grosorCm: e.grosorCm, hex: e.hex, acabado: e.acabado }] },
        colocacion: { en: "relativa", puntoCm: { x: 0, y: 0, z: 0 }, giroGrados: 0 },
      });
    }
  }
  return hijos;
}

/** El conjunto de una base con extras (estructura + lo que lleva), autocontenido; `null` si no lleva extras. */
export function conjuntoDeBase(base: BaseOrganica): Conjunto | null {
  const hijos = hijosDeBase(base);
  if (hijos.length === 0) return null;
  return { raiz: { id: "estructura", nombre: base.nombre, pieza: piezaDeBase(base), colocacion: { ...EN_EL_PISO } }, hijos, sugerida: { ...EN_EL_PISO }, sala: structuredClone(SALA_BASE) };
}

/** Título de la fuente en la biblioteca: así el texto «bases orgánicas» las encuentra todas. */
export const tituloFuenteBase = (b: BaseOrganica) => `Bases orgánicas · referencia web · ${b.fuente.sitio}`;

/** La descripción para la biblioteca: el tipo, la nota honesta y la fidelidad. */
export const descripcionBase = (b: BaseOrganica) => `Base orgánica (${b.tipo === "arco" ? "arco" : "columna"}, ${b.subtipo}). ${b.nota} Fidelidad a la foto: ${b.fidelidad}/5.`;

// ----------------------------------------------------------------------------------------------------------
// Las bases
// ----------------------------------------------------------------------------------------------------------

/** Atajos: un color con su peso (y, si va solo en unas franjas o tramos, cuáles). */
const c = (codigo: string, peso: number, tramos?: readonly string[], formatos?: readonly string[]): ColorOrganico => ({ codigo, peso, ...(tramos ? { tramos } : {}), ...(formatos ? { formatos } : {}) });

/** Mezclas de tamaños de uso común (pesos por formato). */
const M = {
  baseGruesa: { "R-24": 0.15, "R-18": 0.25, "R-12": 0.4, "R-9": 0.2 },
  base: { "R-18": 0.25, "R-12": 0.5, "R-9": 0.25 },
  cuerpo: { "R-18": 0.1, "R-12": 0.55, "R-9": 0.35 },
  fina: { "R-12": 0.5, "R-9": 0.5 },
} as const satisfies Record<string, PesosFormato>;

/** Remate: un globo grande encima de la columna (o de cada una del par), hundido un cuarto en la punta. */
function rematesColumna(p: ParametrosColumnaOrganica, nombre: string, formatoId: string, infladoCm: number, codigo: string): ExtraBase[] {
  const alto = p.altoCm - p.grosorBaseCm * 0.25 - p.grosorPuntaCm * 0.4;
  const desvio = Math.tan(((p.inclinacionGrados ?? 0) * Math.PI) / 180) * alto;
  const y = Math.round((p.altoCm + infladoCm * 0.25) * 10) / 10;
  const pies = p.par ? [[-p.par.separacionCm / 2, -1], [p.par.separacionCm / 2, 1]] as const : [[0, 1]] as const;
  return pies.map(([x0, lado], i) => ({
    tipo: "remate" as const, nombre: pies.length > 1 ? `${nombre} ${i === 0 ? "izquierdo" : "derecho"}` : nombre,
    pieza: { tipo: "globo" as const, formatoId, infladoCm, codigo }, puntoCm: { x: Math.round((x0 + desvio * lado) * 10) / 10, y, z: 0 },
  }));
}

/** Flor de globos colgada en los huecos: pétalos, centro y, si se pide, corona. */
const flor = (petalos: { formatoId: string; infladoCm: number; codigo: string; cantidad: number }, centro: { formatoId: string; infladoCm: number; codigo: string }): Decoracion =>
  ({ tipo: "flor", propiedades: { petalos: { ...petalos, aperturaGrados: 8, giroGrados: 0 }, centro: { ...centro, cantidad: 1 } } });

// ----------------------------------------------------------------------------------------------------------
// Columnas (parámetros a mano: así los remates se calculan de ellos)
// ----------------------------------------------------------------------------------------------------------

const COLUMNA_CINE: ParametrosColumnaOrganica = {
  altoCm: 170, grosorBaseCm: 58, grosorMedioCm: 54, grosorPuntaCm: 50, serpenteoCm: 3,
  mezcla: { base: M.base, punta: M.cuerpo },
  colores: [c("080", 35), c("970", 40), c("015", 25)], semilla: 404,
};

const PAR_BLANCO_NEGRO_ORO: ParametrosColumnaOrganica = {
  altoCm: 170, grosorBaseCm: 52, grosorMedioCm: 50, grosorPuntaCm: 46, serpenteoCm: 4, par: { separacionCm: 300 },
  franjas: [0.22, 0.45, 0.7],
  mezcla: { base: M.base, punta: M.cuerpo },
  colores: [
    c("005", 2, ["franja_1"]), c("080", 1, ["franja_1"]), c("970", 1, ["franja_1"]),
    c("080", 1, ["franja_2"]),
    c("005", 2, ["franja_3"]), c("970", 2, ["franja_3"]),
    c("080", 1, ["franja_4"]),
  ],
  semilla: 505,
};

const COLUMNA_BIENVENIDA: ParametrosColumnaOrganica = {
  altoCm: 160, grosorBaseCm: 60, grosorMedioCm: 58, grosorPuntaCm: 52, serpenteoCm: 7,
  franjas: [0.22, 0.42, 0.58, 0.78],
  mezcla: { base: M.base, punta: M.cuerpo },
  colores: [
    c("080", 2, ["franja_1"]), c("107", 1, ["franja_1"]),
    c("970", 2, ["franja_2"]), c("107", 1, ["franja_2"]),
    c("107", 1, ["franja_3"]),
    c("080", 1, ["franja_4"]), c("970", 1, ["franja_4"]),
    c("107", 1, ["franja_5"]),
  ],
  semilla: 707,
};

const COLUMNA_FLORES_PASTEL: ParametrosColumnaOrganica = {
  altoCm: 150, grosorBaseCm: 62, grosorMedioCm: 58, grosorPuntaCm: 50,
  mezcla: { base: M.base, punta: M.cuerpo },
  colores: [c("126", 30), c("620", 25), c("650", 25), c("609", 20)], semilla: 808,
};

const COLUMNAS_OTONO: ParametrosColumnaOrganica = {
  altoCm: 215, grosorBaseCm: 50, grosorMedioCm: 48, grosorPuntaCm: 46, par: { separacionCm: 120 },
  espiral: { vueltas: 2.2, grosorCm: 14, mezcla: { "R-5": 1 } },
  mezcla: { base: { "R-12": 0.75, "R-9": 0.25 }, punta: { "R-12": 0.7, "R-9": 0.3 } },
  colores: [c("061", 55, ["columna"]), c("570", 45, ["columna"]), c("073", 1, ["espiral"])],
  relleno: [{ formatoId: "R-9", infladoCm: 18, trios: false }, { formatoId: "R-5", infladoCm: 12, trios: true }],
  semilla: 606,
};

// ----------------------------------------------------------------------------------------------------------
// Las bases
// ----------------------------------------------------------------------------------------------------------

export const BASES_ORGANICAS: readonly BaseOrganica[] = [
  // ------------------------------------------------------------------------------------------------ Arcos
  {
    id: "base-organica:semiarco-fucsia-rosa-plata", nombre: "Semiarco orgánico fucsia, rosa y plata en J", tipo: "arco", subtipo: "semiarco en J",
    ocasiones: ["cumpleaños", "quince años", "general"],
    fuente: { sitio: "Lush Balloons (EE. UU.)", urlPagina: "https://www.lushballoons.com/products/extra-lush-organic-demi-arch-rental", urlImagen: "https://cdn.shopify.com/s/files/1/0363/2984/8969/files/extra-lush-organic-demi-arch-rental-247026.jpg?width=1400" },
    forma: {
      generador: "arco",
      arco: {
        marco: { forma: "arco", curva: "medio_punto" }, anchoCm: 230, altoCm: 225,
        segmentos: [{ id: "semiarco", desde: 0, hasta: 0.6, grosorCm: { inicio: 90, medio: 66, fin: 58 }, mezcla: { inicio: M.baseGruesa, fin: M.cuerpo }, tapas: { fin: true } }],
        franjas: [0.24, 0.42],
        colores: [
          c("012", 3, ["franja_1"]), c("011", 2, ["franja_1"]),
          c("009", 3, ["franja_2"]), c("005", 2, ["franja_2"]), c("981", 1, ["franja_2"]),
          c("005", 3, ["franja_3"]), c("981", 1, ["franja_3"]), c("012", 1, ["franja_3"]), c("390", 1, ["franja_3"], ["R-18", "R-24"]),
        ],
        semilla: 101,
      },
    },
    nota: "Igual: una sola pata de ~2,25 m que sube recta y se dobla a la derecha arriba (en J, ~1,2 m de vuelo), gruesa abajo (~90 cm) y más fina arriba, con grandes en la base y racimos de R-5; colores por tramos medidos en la foto: fucsia #c90957 y magenta #da1b78 → Fashion Fucsia 012 y Fashion Rosa 011 abajo, rosa pastel #f4abc6 → Fashion Rosado 009 con blanco y Reflex Plata 981 en medio, blanco arriba con algo de plata, fucsia y cristal. Distinto: el foil de bola disco y las dos burbujas con globos dentro no se modelan (el cristal va liso); el reparto por tramos es más ordenado que en la foto, donde los bloques se entrelazan.",
    fidelidad: 3,
  },
  {
    id: "base-organica:arco-naranja-azul-naval-racimos", nombre: "Arco orgánico de racimos naranja y azul naval", tipo: "arco", subtipo: "arco completo por racimos de color",
    ocasiones: ["cumpleaños", "grado", "halloween", "general"],
    fuente: { sitio: "Lush Balloons (EE. UU.)", urlPagina: "https://www.lushballoons.com/products/organic-balloon-arch-rental", urlImagen: "https://cdn.shopify.com/s/files/1/0363/2984/8969/files/organic-balloon-arch-rental-312613.jpg?width=1400" },
    forma: {
      generador: "arco",
      arco: {
        marco: { forma: "arco", curva: "elipse" }, anchoCm: 300, altoCm: 270,
        segmentos: [
          { id: "pata_izquierda", desde: 0, hasta: 0.5, grosorCm: { inicio: 62, medio: 54, fin: 52 }, mezcla: { inicio: M.base, fin: M.fina } },
          { id: "pata_derecha", desde: 1, hasta: 0.5, grosorCm: { inicio: 62, medio: 54, fin: 52 }, mezcla: { inicio: M.base, fin: M.fina } },
        ],
        bloques: { largoCm: 40 },
        colores: [c("061", 1), c("044", 1)], semilla: 102,
      },
    },
    nota: "Igual: arco de dos patas de ~3 × 2,7 m, redondo arriba, casi del mismo grueso en todo el recorrido (~55 cm, ~60 en los pies), hecho de racimos de un solo color que se alternan cada ~40 cm; naranja medido #fc5f2d → Fashion Naranja 061 y azul marino casi negro #12223f → Fashion Azul Naval 044. Distinto: en la foto casi no hay globos grandes (R-12 y R-5); aquí el motor pone algún R-18 en los pies. Los racimos son tramos de un color uno tras otro: el zigzag de la foto, donde un racimo se monta sobre el siguiente, no se reproduce.",
    fidelidad: 4,
  },
  {
    id: "base-organica:arco-l-cromado-negro-oro-plata", nombre: "Arco en L cromado negro, oro y plata", tipo: "arco", subtipo: "asimétrico en L",
    ocasiones: ["año nuevo", "grado", "cumpleaños", "general"],
    fuente: { sitio: "B&M Unique", urlPagina: "https://www.bnmunique.com/products/chrome-organic-balloon-semi-arch", urlImagen: "https://cdn.shopify.com/s/files/1/0649/6908/1023/files/Chrome-Organic-Balloon-Semi-Arch-for-Elegant-Parties.png" },
    forma: {
      generador: "arco",
      arco: {
        marco: { forma: "rectangulo", radioEsquinaCm: 35 }, anchoCm: 240, altoCm: 225,
        segmentos: [{ id: "guirnalda", desde: 0.23, hasta: 0.75, grosorCm: { inicio: 55, medio: 58, fin: 72 }, mezcla: { inicio: M.cuerpo, fin: M.base }, tapas: { inicio: true } }],
        colores: [c("080", 50), c("970", 26), c("981", 24)], semilla: 103,
      },
    },
    nota: "Igual: guirnalda en L que cruza arriba ~2,2 m desde la pared y baja por la derecha hasta el piso (~2,2 m), más gruesa en la pata (~70 cm) que arriba (~55 cm); negro mate #0a0a09 → Fashion Negro 080 (la mitad), oro cromado → Reflex Dorado 970 y plata cromada → Reflex Plata 981, mezclados al azar como en la foto. Distinto: el ramo de helio y el pedestal dorado de la foto no van; el plateado grande (~45 cm) de la pata sale donde lo ponga el motor, no en ese sitio exacto.",
    fidelidad: 4,
  },
  {
    id: "base-organica:aro-dorado-nude-palo-de-rosa", nombre: "Guirnalda sobre aro dorado nude, palo de rosa y champaña", tipo: "arco", subtipo: "guirnalda sobre marco redondo",
    ocasiones: ["boda", "baby shower", "día de la madre", "general"],
    fuente: { sitio: "Now It's A Party", urlPagina: "https://www.shopnowitsaparty.com/products/rental-67ft-ringhoop-arch-backdrop", urlImagen: "https://cdn.shopify.com/s/files/1/0725/6375/3274/files/CA801A96-0AD8-4C85-BD80-C5573240A897.jpg?width=1400" },
    forma: {
      generador: "arco",
      arco: {
        marco: { forma: "circulo" }, anchoCm: 210, altoCm: 210,
        segmentos: [
          { id: "lado_izquierdo", desde: 0.36, hasta: 0, grosorCm: { inicio: 58, medio: 60, fin: 52 }, mezcla: { inicio: M.base, fin: M.cuerpo }, tapas: { inicio: true }, adelanteCm: 6 },
          { id: "pie_derecho", desde: 1, hasta: 0.9, grosorCm: { inicio: 52, medio: 62, fin: 70 }, mezcla: { inicio: M.cuerpo, fin: M.base }, tapas: { fin: true }, adelanteCm: 6 },
        ],
        colores: [c("661", 35), c("010", 25), c("071", 20), c("971", 20)], semilla: 104,
      },
    },
    extras: [{ tipo: "marco", nombre: "Aro dorado", hex: "#c9a24a", acabado: "metal", grosorCm: 3, margenCm: 22, anchoCm: 3 }],
    nota: "Igual: aro de ~2 m con la guirnalda de las 10 hasta abajo por la izquierda y un racimo más gordo en el pie derecho (de las 6 a las 5), dejando el resto del aro a la vista; colores medidos: blush claro → Pastel Mate Nude 661, rosa empolvado #be7c7c → Fashion Palo de Rosa 010, arena → Fashion Arena 071 y champaña cromado #c09a7b → Reflex Champaña 971. Distinto: el aro es un tubo de 3 cm dibujado como escenografía (no es producto) y sin las patas del soporte; en la foto el palo de rosa va en racimos arriba y abajo a la derecha, aquí mezclado.",
    fidelidad: 4,
  },
  {
    id: "base-organica:guirnalda-marco-lila-plata", nombre: "Guirnalda en S lila y plata cromada", tipo: "arco", subtipo: "guirnalda sobre marco rectangular",
    ocasiones: ["quince años", "cumpleaños", "boda", "general"],
    fuente: { sitio: "Salem Balloons and Flowers (Oregón)", urlPagina: "https://www.salemballoonsandflowers.com/products/organic-balloon-garland-on-a-frame-oregon", urlImagen: "https://www.salemballoonsandflowers.com/cdn/shop/files/Balloon-Garland-on-a-metal-frame.-Balloon-Decor.-Oregon.jpg?width=1400" },
    forma: {
      generador: "arco",
      arco: {
        marco: { forma: "rectangulo", radioEsquinaCm: 50 }, anchoCm: 220, altoCm: 205,
        segmentos: [{ id: "guirnalda", desde: 0, hasta: 0.46, grosorCm: { inicio: 100, medio: 50, fin: 52 }, mezcla: { inicio: M.baseGruesa, fin: M.cuerpo }, tapas: { fin: true } }],
        bloques: { largoCm: 45 },
        colores: [c("650", 3), c("981", 2)], semilla: 105,
      },
    },
    nota: "Igual: guirnalda que nace en un montón ancho (~1 m) abajo a la izquierda, sube ~1,7 m y cruza arriba hacia la derecha sobre el marco, más fina arriba (~50 cm); racimos de lila pastel #b7b0bc → Pastel Mate Lila 650 que se turnan con racimos de plata cromada → Reflex Plata 981 (sin R-9 en Reflex Plata: ahí va el lila). Distinto: los cuatro foils de bola disco y el globo con logo no se modelan; el marco negro de la foto no va; la S de la foto se tuerce más que este recorrido de esquinas redondeadas.",
    fidelidad: 3,
  },
  {
    id: "base-organica:arco-cromado-negro-oro-plata", nombre: "Arco orgánico cromado negro, oro y plata", tipo: "arco", subtipo: "arco completo cromado",
    ocasiones: ["año nuevo", "grado", "boda", "general"],
    fuente: { sitio: "Monarch Balloon Boutique (California)", urlPagina: "https://www.monarchballoonboutique.com/products/20ft-organic-balloon-arch", urlImagen: "https://cdn.shopify.com/s/files/1/0609/6909/1142/files/20ftOrganicArchSantaAna_27261a9f-8057-4d05-aa0b-43c8a5ee3abf.jpg?width=1400" },
    forma: { generador: "arco_organico", arco: { anchoCm: 260, altoCm: 255, radioBaseCm: 25, radioPuntaCm: 20, semilla: 106, densidad: 1, colores: [c("080", 32), c("970", 50), c("981", 18)], flores: null, huecosFlores: 0 } },
    nota: "Igual: arco de dos patas de ~3 × 2,6 m (unos 6 m de guirnalda), delgado (~40 cm, ~50 en los pies), mezcla uniforme de negro mate → Fashion Negro 080, oro cromado #916a41 → Reflex Dorado 970 (la mitad) y plata cromada → Reflex Plata 981. Va como arco orgánico de dos patas: se edita entero en el panel (ancho, alto, grosores, densidad y colores). Distinto: la foto tiene patas rectas y arriba casi plano; este arco es de curva elíptica.",
    fidelidad: 4,
  },
  {
    id: "base-organica:arco-asimetrico-oro-perlado", nombre: "Arco asimétrico dorado perlado de un solo color", tipo: "arco", subtipo: "asimétrico rectangular monocromo",
    ocasiones: ["boda", "año nuevo", "grado", "general"],
    fuente: { sitio: "Mis Globos (Madrid)", urlPagina: "https://misglobos.com/products/columna-organica-por-metros", urlImagen: "https://cdn.shopify.com/s/files/1/0320/5854/0091/products/columna-organica-por-metros-709234.jpg?width=1400" },
    forma: {
      generador: "arco",
      arco: {
        marco: { forma: "rectangulo", radioEsquinaCm: 35 }, anchoCm: 380, altoCm: 270,
        segmentos: [{ id: "guirnalda", desde: 0.08, hasta: 0.69, grosorCm: { inicio: 78, medio: 74, fin: 56 }, mezcla: { inicio: { "R-24": 0.12, "R-12": 0.4, "R-9": 0.48 }, fin: { "R-24": 0.08, "R-12": 0.42, "R-9": 0.5 } }, tapas: { inicio: true } }],
        colores: [c("570", 1)], semilla: 107,
      },
    },
    nota: "Igual: un solo color, oro perlado (no espejo) #98730d → Metal Dorado 570, sobre la puerta: el lado izquierdo acaba en un racimo a ~1,3 m del piso, cruza arriba (~3,8 m) y baja por la derecha hasta el piso, gruesa arriba (~75 cm) y más fina en la pata (~55 cm), con R-24 sueltos que sobresalen y mucho R-9 y R-5 que le dan textura. Distinto: los R-24 caen donde los pone el motor (en la foto se reparten más regulares por el borde); medidas estimadas por la puerta.",
    fidelidad: 4,
  },
  {
    id: "base-organica:arco-ombre-coral-menta", nombre: "Arco asimétrico en degradé de coral a menta", tipo: "arco", subtipo: "asimétrico en degradé",
    ocasiones: ["cumpleaños", "baby shower", "general"],
    fuente: { sitio: "Inflated Creations", urlPagina: "https://www.inflatedcreations.com/organic-arches", urlImagen: "https://images.squarespace-cdn.com/content/v1/55668890e4b0a63819e5bd65/1628885594423-ZBGZ8BZSG13TR9FPQX8Q/1ombreorganicballoonarchgarlandentry.jpg?format=1500w" },
    forma: {
      generador: "arco",
      arco: {
        marco: { forma: "rectangulo", radioEsquinaCm: 35 }, anchoCm: 210, altoCm: 250,
        segmentos: [{ id: "guirnalda", desde: 0, hasta: 0.47, grosorCm: { inicio: 105, medio: 70, fin: 50 }, mezcla: { inicio: M.baseGruesa, fin: M.fina }, tapas: { fin: true } }],
        franjas: [0.14, 0.24, 0.33, 0.41],
        colores: [
          c("014", 3, ["franja_1"]), c("015", 1, ["franja_1"]),
          c("059", 2, ["franja_2"]), c("060", 1, ["franja_2"]),
          c("060", 2, ["franja_3"]), c("663", 1, ["franja_3"]),
          c("620", 2, ["franja_4"]), c("661", 1, ["franja_4"]),
          c("126", 1, ["franja_5"]),
        ],
        semilla: 108,
      },
    },
    nota: "Igual: pata izquierda gruesa (~1,1 m en el pie) que sube ~2,5 m y cruza arriba adelgazando (~50 cm), con R-24 en la base y muchos R-5; degradé por tramos medido de abajo a la punta: coral rojo #e34958 → Fashion Frambuesa 014 (con algo de Fashion Rojo 015, que sí viene en R-18), salmón #e0645c → Fashion Coral Tropical 059 (solo R-12 y R-5) con Fashion Durazno 060, melocotón → Durazno 060 y Pastel Mate Melón 663, amarillo pálido → Pastel Mate Amarillo 620 con Nude 661, y menta → Pastel Dusk Té Verde 126. Distinto: el paso de un color a otro es por franjas (en la foto se funden un poco más); la pata derecha no existe, igual que en la foto.",
    fidelidad: 4,
  },
  {
    id: "base-organica:marco-blanco-rojo-durazno-flores", nombre: "Guirnalda sobre marco blanco de rojo a durazno con flores", tipo: "arco", subtipo: "guirnalda sobre marco rectangular con flores",
    ocasiones: ["cumpleaños", "día de la madre", "boda"],
    fuente: { sitio: "Salem Balloons and Flowers (Oregón)", urlPagina: "https://www.salemballoonsandflowers.com/products/organic-balloon-garland-on-a-frame-oregon", urlImagen: "https://www.salemballoonsandflowers.com/cdn/shop/files/garland-on-a-white-wooden-frame.Balloon-Decor.-Salem-Oregon-and-nearby-cities..jpg?width=1400" },
    forma: {
      generador: "arco",
      arco: {
        marco: { forma: "rectangulo", radioEsquinaCm: 25 }, anchoCm: 190, altoCm: 220,
        segmentos: [{ id: "guirnalda", desde: 0, hasta: 0.6, grosorCm: { inicio: 62, medio: 46, fin: 46 }, mezcla: { inicio: M.base, fin: { "R-12": 0.75, "R-9": 0.25 } }, tapas: { fin: true } }],
        franjas: [0.18, 0.42],
        colores: [
          c("015", 3, ["franja_1"]), c("059", 1, ["franja_1"]), c("060", 1, ["franja_1"]),
          c("060", 2, ["franja_2"]), c("663", 1, ["franja_2"]),
          c("107", 2, ["franja_3"]), c("661", 1, ["franja_3"]),
        ],
        semilla: 109,
      },
    },
    huecos: 8,
    flores: { semilla: 109, tallosPorRacimo: 4, proporcion: [{ tipo: "rosa", colorId: "blanca", peso: 40 }, { tipo: "rosa", colorId: "marfil", peso: 30 }, { tipo: "gypsophila", colorId: "blanca", peso: 30 }] },
    extras: [{ tipo: "marco", nombre: "Marco de madera blanco", hex: "#f4f1ec", acabado: "madera", grosorCm: 4, margenCm: 30, anchoCm: 9 }],
    nota: "Igual: guirnalda de ~45 cm (~60 en el pie) que sube por el lado izquierdo de un marco blanco de ~1,9 × 2,2 m, cruza arriba y dobla un poco por la derecha, sobre todo R-12; degradé por tramos medido: rojo #d8082d → Fashion Rojo 015 con coral y durazno abajo, melocotón #d8a188 → Fashion Durazno 060 y Pastel Mate Melón 663 en medio, crema #cfbaa5 → Pastel Dusk Crema 107 con Nude 661 al final. Flores de tela (rosas blancas y marfil con gypsophila) en los huecos. Distinto: las rosas de la foto son rosadas (el taller solo tiene rosas blancas y marfil), no hay amaranto colgante ni el marco de foto, las letras «21» ni el globo con logo; el marco es una banda blanca de 9 cm.",
    fidelidad: 3,
  },
  {
    id: "base-organica:arco-menta-azul-blanco", nombre: "Arco orgánico menta, azul empolvado y blanco", tipo: "arco", subtipo: "arco completo pastel tricolor",
    ocasiones: ["baby shower", "bautizo y comunión", "cumpleaños", "general"],
    fuente: { sitio: "Pink Flamingo Party Co. (Connecticut)", urlPagina: "https://pinkflamingoparty.co/products/8x12-organic-balloon-arch", urlImagen: "https://cdn.shopify.com/s/files/1/0013/9683/4349/files/IMG_3197.jpg?width=1400" },
    forma: { generador: "arco_organico", arco: { anchoCm: 250, altoCm: 270, radioBaseCm: 30, radioPuntaCm: 22, semilla: 110, densidad: 1, colores: [c("140", 30), c("126", 30), c("005", 40)], flores: null, huecosFlores: 0 } },
    nota: "Igual: arco de dos patas de ~3 × 2,8 m, ~45 cm de grueso (~60 en los pies), mezcla uniforme de azul acero empolvado #37859e → Pastel Dusk Azul 140, menta #abcdba → Pastel Dusk Té Verde 126 y blanco → Fashion Blanco 005, con R-18 abajo y R-5 de relleno. Va como arco orgánico de dos patas: se edita entero en el panel. Distinto: en la foto hay además un celeste más claro (#79b6d3) en poca cantidad que aquí no va, y la mezcla de las patas parece ir en espiral.",
    fidelidad: 4,
  },
  // ------------------------------------------------------------------------------------------------ Columnas
  {
    id: "base-organica:columna-recta-multicolor-tierra", nombre: "Columna orgánica recta multicolor rosa, café y naranja", tipo: "columna", subtipo: "recta multicolor",
    ocasiones: ["cumpleaños", "infantil", "general"],
    fuente: { sitio: "99 Haus Balloons (Chicago)", urlPagina: "https://99hausballoons.com/products/organic-balloon-column", urlImagen: "https://99hausballoons.com/cdn/shop/files/Organic_Column.jpg" },
    forma: {
      generador: "columna",
      columna: {
        altoCm: 150, grosorBaseCm: 52, grosorMedioCm: 50, grosorPuntaCm: 48,
        mezcla: { base: { "R-18": 0.45, "R-12": 0.35, "R-9": 0.2 }, punta: { "R-18": 0.4, "R-12": 0.4, "R-9": 0.2 } },
        colores: [c("010", 22), c("074", 20), c("015", 14), c("059", 13), c("050", 12), c("061", 10), c("012", 9)], semilla: 201,
      },
    },
    nota: "Igual: columna recta de ~1,5 m (la tienda la ofrece de 5 o 7 pies) y ~50 cm de grueso igual de arriba abajo, de globos grandes (~40 cm) con R-5 en las costuras, siete colores mates al azar medidos en la foto: blush #d19e94 → Fashion Palo de Rosa 010, chocolate #6d4626 → Fashion Café 074, rojo → Fashion Rojo 015, coral #e86968 → Fashion Coral Tropical 059 (solo en R-12 y R-5), lila #b39dc0 → Fashion Lila 050, naranja → Fashion Naranja 061 y magenta → Fashion Fucsia 012. Distinto: la foto es casi semiorgánica (pares de globos apilados con una costura de R-5); el motor la arma orgánica, más irregular y tupida.",
    fidelidad: 3,
  },
  {
    id: "base-organica:columna-cuatro-franjas", nombre: "Columna orgánica de cuatro franjas de color", tipo: "columna", subtipo: "por franjas de color",
    ocasiones: ["cumpleaños", "infantil", "grado", "general"],
    fuente: { sitio: "Lush Balloons (EE. UU.)", urlPagina: "https://www.lushballoons.com/products/organic-balloon-column", urlImagen: "https://cdn.shopify.com/s/files/1/0363/2984/8969/files/organic-balloon-column-885772.jpg?width=1400" },
    forma: {
      generador: "columna",
      columna: {
        altoCm: 190, grosorBaseCm: 62, grosorMedioCm: 58, grosorPuntaCm: 74, serpenteoCm: 6,
        franjas: [0.27, 0.5, 0.73],
        mezcla: { base: M.base, punta: { "R-18": 0.3, "R-12": 0.4, "R-9": 0.3 } },
        colores: [
          c("014", 3, ["franja_1"]), c("015", 1, ["franja_1"]),
          c("030", 1, ["franja_2"]),
          c("051", 1, ["franja_3"]),
          c("023", 1, ["franja_4"]),
        ],
        semilla: 202,
      },
    },
    nota: "Igual: columna de ~1,9 m en cuatro bloques de un color de ~45 cm, con el de arriba más ancho (~75 cm, una corona) y un leve zigzag; colores medidos de abajo arriba: carmesí #a71128 → Fashion Frambuesa 014 (con Fashion Rojo 015, que sí viene en R-18), verde azulado #019490 → Fashion Verde 030, morado #523aa4 → Fashion Violeta 051 y naranja mostaza #e39029 → Fashion Mostaza 023. Distinto: la base negra cuadrada de la foto no va; los cortes entre franjas son rectos (en la foto se escalonan un poco).",
    fidelidad: 4,
  },
  {
    id: "base-organica:columna-pastel-pascua", nombre: "Columna orgánica pastel de seis colores", tipo: "columna", subtipo: "pastel mezclada",
    ocasiones: ["baby shower", "infantil", "cumpleaños", "general"],
    fuente: { sitio: "Pink Flamingo Party Co. (Connecticut)", urlPagina: "https://pinkflamingoparty.co/products/easter-column", urlImagen: "https://cdn.shopify.com/s/files/1/0013/9683/4349/files/6T4A0420_defa8a79-7077-4408-981f-9c5a16b4be10.jpg?width=1400" },
    forma: {
      generador: "columna",
      columna: {
        altoCm: 160, grosorBaseCm: 50, grosorMedioCm: 48, grosorPuntaCm: 46,
        mezcla: { base: { "R-18": 0.08, "R-12": 0.55, "R-9": 0.37 }, punta: { "R-12": 0.55, "R-9": 0.45 } },
        colores: [c("140", 14), c("126", 14), c("620", 17), c("150", 16), c("023", 13), c("071", 11)], semilla: 203,
      },
    },
    nota: "Igual: columna recta de ~1,6 m de cuerpo y ~48 cm de grueso constante, sobre todo R-12 con racimos de R-5 del mismo color; seis pasteles mates medidos: azul polvo #bbc7c8 → Pastel Dusk Azul 140 y Pastel Dusk Té Verde 126, marfil #e1d8c2 → Pastel Mate Amarillo 620, malva #c59da8 → Pastel Dusk Lavanda 150, mostaza #d2961c → Fashion Mostaza 023 y arena → Fashion Arena 071. Distinto: el foil de huevo «Happy Easter» con minifoils de flor de arriba y las mariposas de papel no se modelan (pon un metalizado encima si hace falta); el azul polvo de la foto es más gris que el Pastel Dusk Azul.",
    fidelidad: 3,
  },
  {
    id: "base-organica:columna-cine-negro-rojo-oro", nombre: "Columna orgánica negra, roja y oro con remate dorado", tipo: "columna", subtipo: "con globo grande de remate",
    ocasiones: ["grado", "año nuevo", "cumpleaños", "general"],
    fuente: { sitio: "Kristopher Renee", urlPagina: "https://www.kristopherrenee.com/product-page/organic-balloon-column", urlImagen: "https://static.wixstatic.com/media/93aa26_324e66f8193c4633ad68eb3d1597cc30~mv2.jpg" },
    forma: { generador: "columna", columna: COLUMNA_CINE },
    extras: rematesColumna(COLUMNA_CINE, "Remate R-24 Metal Dorado", "R-24", 52, "570"),
    nota: "Igual: columna de ~1,7 m de cuerpo y ~55 cm de grueso con un R-24 dorado de remate (~55 cm) encima, mezcla de negro mate → Fashion Negro 080, oro cromado #936d3d → Reflex Dorado 970 y rojo coral #923123 → Fashion Rojo 015, con racimos de R-5 dorados. Distinto: en la foto el remate es oro perlado (va Metal Dorado 570, porque el Reflex Dorado no viene en R-36 y el R-24 de la foto es mate); la banda de R-5 dorados del tercio de abajo y las pegatinas de estrella no se modelan (los R-5 se reparten).",
    fidelidad: 4,
  },
  {
    id: "base-organica:par-columnas-blanco-negro-oro", nombre: "Par de columnas blanco, negro y oro con remate blanco", tipo: "columna", subtipo: "doble con remate",
    ocasiones: ["año nuevo", "boda", "grado", "general"],
    fuente: { sitio: "Kristopher Renee", urlPagina: "https://www.kristopherrenee.com/product-page/organic-balloon-column", urlImagen: "https://static.wixstatic.com/media/93aa26_8f64be37598945d9afffcf8160febaaf~mv2.jpg" },
    forma: { generador: "columna", columna: PAR_BLANCO_NEGRO_ORO },
    extras: rematesColumna(PAR_BLANCO_NEGRO_ORO, "Remate R-24 blanco", "R-24", 55, "005"),
    nota: "Igual: dos columnas de ~1,7 m de cuerpo y ~50 cm de grueso a los lados de una puerta doble (3 m entre ejes), cada una con un R-24 blanco de remate (~55 cm); franjas de abajo arriba: blanco con negro y oro, negro, blanco y oro cromado (Reflex Dorado 970), negro arriba (Fashion Negro 080, Fashion Blanco 005). Distinto: en la foto las franjas van en diagonal (casi en espiral) y la columna derecha es más delgada; aquí las dos son iguales y las franjas, horizontales. Es la misma página de producto que la columna negra, roja y oro (otra foto).",
    fidelidad: 3,
  },
  {
    id: "base-organica:par-columnas-otono-espiral", nombre: "Par de columnas otoñales naranja y oro con espiral y girasoles", tipo: "columna", subtipo: "espiral con flores (par)",
    ocasiones: ["general", "halloween", "cumpleaños"],
    fuente: { sitio: "Balloons Charlotte", urlPagina: "https://balloonscharlotte.com/products/fall-inspired-topless-balloon-columns", urlImagen: "https://cdn.shopify.com/s/files/1/0537/8664/0538/files/fall-inspired-topless-balloon-columns-530.jpg" },
    forma: { generador: "columna", columna: COLUMNAS_OTONO },
    huecos: 16,
    extras: [{ tipo: "colgada", nombre: "Girasol de globos", decoracion: flor({ formatoId: "R-5", infladoCm: 10, codigo: "021", cantidad: 8 }, { formatoId: "R-5", infladoCm: 9, codigo: "074" }), cada: 2 }],
    nota: "Igual: dos columnas de ~2,15 m y ~50 cm sin remate, de naranja #d85610 → Fashion Naranja 061 y oro metálico #875522 → Metal Dorado 570 mezclados, con un cordón tostado que les da ~2 vueltas en espiral (sentidos contrarios) y girasoles en los huecos. Distinto: la foto es de montaje clásico (cuartetos de R-11) y la espiral es UN tubito largo tostado; aquí la columna es orgánica y la espiral es un cordón de R-5 Fashion Latte 073; los girasoles son flores de globo (8 R-5 Amarillo Miel 021 y centro Café 074), no de tela, y las hojas otoñales y espigas no se modelan.",
    fidelidad: 2,
  },
  {
    id: "base-organica:columna-bienvenida-crema-negro-oro", nombre: "Columna de bienvenida crema, negro y oro por franjas con remate", tipo: "columna", subtipo: "por franjas con remate grande",
    ocasiones: ["boda", "grado", "año nuevo", "general"],
    fuente: { sitio: "Lush Balloons (EE. UU.)", urlPagina: "https://www.lushballoons.com/products/organic-balloon-column", urlImagen: "https://cdn.shopify.com/s/files/1/0363/2984/8969/files/organic-balloon-column-560549.jpg?width=1400" },
    forma: { generador: "columna", columna: COLUMNA_BIENVENIDA },
    extras: rematesColumna(COLUMNA_BIENVENIDA, "Remate R-36 crema", "R-36", 85, "107"),
    nota: "Igual: columna de ~1,6 m de cuerpo y ~60 cm con un leve zigzag y un R-36 crema de remate (~85 cm) encima; bandas alternas de abajo arriba medidas en la foto: negro con crema, oro cromado con crema, crema, negro con oro y crema arriba (crema #cbbfb2 → Pastel Dusk Crema 107, negro → Fashion Negro 080, oro → Reflex Dorado 970). Distinto: el rótulo de vinilo del remate («Welcome to…») y las ramitas de eucalipto no se modelan. Es la misma página de producto que la columna de cuatro franjas (otra foto).",
    fidelidad: 4,
  },
  {
    id: "base-organica:columna-pastel-flores-de-globo", nombre: "Columna pastel con flores de globo y remate durazno", tipo: "columna", subtipo: "con flores de globo y remate",
    ocasiones: ["cumpleaños", "infantil", "baby shower"],
    fuente: { sitio: "Party Hop Shop", urlPagina: "https://partyhopshop.com/products/custom-organic-balloon-column", urlImagen: "https://cdn.shopify.com/s/files/1/0006/7334/9684/files/E1CE6B9B-8B24-49CC-AEF1-A0B3E8C2DA71.jpg?width=1400" },
    forma: { generador: "columna", columna: COLUMNA_FLORES_PASTEL },
    huecos: 6,
    extras: [
      { tipo: "colgada", nombre: "Flor amarilla de globos", decoracion: flor({ formatoId: "R-12", infladoCm: 20, codigo: "620", cantidad: 5 }, { formatoId: "R-9", infladoCm: 13, codigo: "005" }), cada: 2, desde: 0 },
      { tipo: "colgada", nombre: "Flor lila de globos", decoracion: flor({ formatoId: "R-12", infladoCm: 20, codigo: "650", cantidad: 5 }, { formatoId: "R-9", infladoCm: 13, codigo: "005" }), cada: 2, desde: 1 },
      ...rematesColumna(COLUMNA_FLORES_PASTEL, "Remate R-36 durazno", "R-36", 85, "060"),
    ],
    nota: "Igual: columna de ~1,5 m de cuerpo y ~60 cm en sage #b9c388 → Pastel Dusk Té Verde 126, amarillo pálido → Pastel Mate Amarillo 620, lavanda → Pastel Mate Lila 650 y rosa pálido → Pastel Mate Rosado 609, con flores grandes amarillas y lilas de centro blanco y un R-36 durazno (#e8af8f → Fashion Durazno 060) de remate. Distinto: en la foto las margaritas son foils y aquí son flores de 5 R-12 con centro R-9; el número foil «4» y el texto impreso del remate no se modelan (añade un metalizado de número si hace falta).",
    fidelidad: 3,
  },
  {
    id: "base-organica:columna-champana-inclinada", nombre: "Columna champaña inclinada blanco perla y oro", tipo: "columna", subtipo: "base ancha e inclinada",
    ocasiones: ["año nuevo", "boda", "grado", "cumpleaños"],
    fuente: { sitio: "Balloons Charlotte", urlPagina: "https://balloonscharlotte.com/products/happy-anniversary-organic-column", urlImagen: "https://cdn.shopify.com/s/files/1/0537/8664/0538/files/happy-anniversary-organic-column-584.jpg" },
    forma: {
      generador: "columna",
      columna: {
        altoCm: 190, grosorBaseCm: 90, grosorMedioCm: 58, grosorPuntaCm: 36, inclinacionGrados: -6, curvaInclinacion: 0.3,
        mezcla: { base: M.baseGruesa, punta: { "R-12": 0.55, "R-9": 0.45 } },
        colores: [c("406", 55), c("970", 25), c("971", 10), c("390", 10, undefined, ["R-18", "R-24"])], semilla: 209,
      },
    },
    nota: "Igual: la «espuma» de champaña: columna de ~1,9 m que va de ~90 cm en la base a ~35 cm arriba, inclinada ~6° hacia la izquierda (hacia la boca de la botella), blanca perlada (#ad9b8e bajo luz cálida → Satín Perla 406) con oro cromado (Reflex Dorado 970), algo de Reflex Champaña 971 y burbujas de Cristal Transparente 390 grandes en la base. Distinto: el foil de botella de champaña de arriba y los números «25» no se modelan (van como metalizados aparte); en la foto las burbujas de cristal están en el piso, aquí dentro de la columna.",
    fidelidad: 3,
  },
  {
    id: "base-organica:baston-ombre-rosa-blanco-monos", nombre: "Columna bastón en degradé de rosa palo a blanco con moños", tipo: "columna", subtipo: "se curva arriba, degradé",
    ocasiones: ["baby shower", "bautizo y comunión", "día de la madre"],
    fuente: { sitio: "Now It's A Party", urlPagina: "https://www.shopnowitsaparty.com/products/balloon-garland-column-organic", urlImagen: "https://cdn.shopify.com/s/files/1/0725/6375/3274/files/column_5_d4911de1-05a3-41ca-b189-da4f56ecb273.png" },
    forma: {
      generador: "arco",
      arco: {
        marco: { forma: "arco", curva: "medio_punto" }, anchoCm: 150, altoCm: 195,
        segmentos: [{ id: "baston", desde: 1, hasta: 0.4, grosorCm: { inicio: 46, medio: 46, fin: 70 }, mezcla: { inicio: M.cuerpo, fin: { "R-18": 0.3, "R-12": 0.4, "R-9": 0.3 } }, tapas: { fin: true } }],
        franjas: [0.62, 0.8],
        colores: [
          c("010", 2, ["franja_3"]), c("110", 1, ["franja_3"]),
          c("110", 2, ["franja_2"]), c("609", 1, ["franja_2"]),
          c("005", 2, ["franja_1"]), c("406", 1, ["franja_1"]),
        ],
        semilla: 210,
      },
    },
    huecos: 3,
    extras: [{
      tipo: "colgada", nombre: "Moño de tubito blanco", cada: 1,
      decoracion: { tipo: "mono", propiedades: { formatoId: "T-260", grosorCm: 4, codigo: "005", lazosPorLado: 1, largoLazoCm: 20, anchoLazoCm: 11, aberturaGrados: 30, colas: true, largoColaCm: 26, centro: null } },
    }],
    nota: "Igual: tronco de ~1,95 m y ~45 cm que arriba se curva a la izquierda en una nube blanca más gorda (~70 cm, ~1 m de vuelo), con degradé por tramos de abajo arriba: rosa palo oscuro #8f5148 → Fashion Palo de Rosa 010 con Pastel Dusk Rosa 110, blush → Pastel Dusk Rosa 110 con Pastel Mate Rosado 609, y blanco → Fashion Blanco 005 con Satín Perla 406; tres moños de tubito T-260 blanco colgados. Distinto: el caballete con el letrero no va; el rosa más oscuro de la foto es más tostado que el Palo de Rosa.",
    fidelidad: 4,
  },
];
