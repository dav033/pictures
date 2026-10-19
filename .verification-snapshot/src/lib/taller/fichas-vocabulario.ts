import type { TipoItem } from "@/lib/globos3d/biblioteca";
import { formatoPorId } from "@/lib/globos3d/formatos";
import { parteDecoracion } from "@/lib/globos3d/partes-decoraciones";
import { PARTES_ESTRUCTURA } from "@/lib/globos3d/partes-estructuras";
import { SIN_PARTE } from "@/lib/globos3d/partes-globos";
import type { TipoPieza } from "@/lib/globos3d/piezas";
import type { FuenteRegistro } from "./fichas-tipos";

/**
 * Las palabras con que el dueño y los decoradores nombran las cosas, para que la ficha (el texto que se embebe) se
 * parezca a lo que alguien escribe al buscar: «columna orgánica», «pared de link», «R-24 de 24 pulgadas», «tubitos».
 */

export const FRASE_TIPO_ITEM: Readonly<Record<TipoItem, string>> = {
  escena: "Escena completa de decoración con globos",
  conjunto: "Estructura de globos con sus decoraciones",
  estructura: "Estructura de globos",
  decoracion: "Decoración de globos",
  utileria: "Utilería de fiesta",
};

export const FRASE_TIPO_PIEZA: Readonly<Record<TipoPieza, string>> = {
  columna: "columna clásica de cuartetos trenzados",
  arco: "arco clásico de cuartetos trenzados",
  pared_malla: "pared de link-o-loon (malla de eslabones)",
  pared_trenzas: "pared de trenzas de cuartetos",
  organico: "estructura orgánica de globos de varios tamaños",
  decoracion: "decoración pequeña (flor, moño, estrella, figura)",
  arco_organico: "arco orgánico",
  guirnalda: "guirnalda clásica de cuartetos en festón",
  escenografia: "escenografía de fondo o utilería (no es globo)",
  globo: "globo suelto, remate",
  forma: "forma de globos rellena (figura, esfera, cono)",
  letras: "letras o números de globos",
  metalizado: "globo metalizado (foil)",
  mural: "mural pixelado de globos",
  techo: "decoración de techo (red de racimos, festones, tiras colgantes, globos de helio)",
  arbol_globos: "palmera o árbol de globos",
  modulo: "módulo suelto de globos (pareja, trío, cuarteto)",
};

/** Qué silueta orgánica es, por las partes que lleva («pata» y «clave» son de un arco, «columna» de una columna…). */
const SILUETA_ORGANICA: ReadonlyArray<{ partes: readonly string[]; frase: string }> = [
  { partes: ["columna", "espiral", "monticulo"], frase: "columna orgánica" },
  { partes: ["pata", "clave", "arco", "travesano", "semiarco"], frase: "arco orgánico o semiarco" },
  { partes: ["guirnalda", "trazo"], frase: "guirnalda orgánica" },
  { partes: ["anillo", "marco", "lado"], frase: "aro o marco orgánico" },
];

export function siluetasDe(tiposPieza: readonly string[], partes: readonly string[]): string[] {
  const raices = new Set(partes.map((p) => p.split("/")[0]!));
  const frases: string[] = [];
  for (const tipo of tiposPieza) {
    if (tipo === "organico") {
      const precisas = SILUETA_ORGANICA.filter((s) => s.partes.some((p) => raices.has(p))).map((s) => s.frase);
      frases.push(...(precisas.length ? precisas : [FRASE_TIPO_PIEZA.organico]));
    } else if (tipo in FRASE_TIPO_PIEZA) frases.push(FRASE_TIPO_PIEZA[tipo as TipoPieza]);
  }
  return [...new Set(frases)];
}

/** «R-24» → «R-24 «de 24 pulgadas»», «LOL-660» → «LOL-660 (link-o-loon largo)», «T-260» → «T-260 (tubito)». */
export function nombreComercialFormato(formatoId: string): string {
  const f = formatoPorId(formatoId);
  if (!f) return formatoId;
  const pulgadas = /-(\d+)$/.exec(formatoId)?.[1];
  switch (f.tipo) {
    case "redondo": return `${formatoId} «de ${pulgadas} pulgadas»`;
    case "corazon": return `${formatoId} (corazón de ${pulgadas} pulgadas)`;
    case "tubito": return `${formatoId} (tubito)`;
    case "link": return formatoId === "LOL-660" ? `${formatoId} (link-o-loon largo, eslabón de 60 pulgadas)` : `${formatoId} (link-o-loon de ${pulgadas} pulgadas)`;
  }
}

/** Orden de los formatos al listarlos: redondos por tamaño, luego link-o-loon, tubitos y corazones. */
export function ordenFormato(formatoId: string): number {
  const f = formatoPorId(formatoId);
  const tipo = { redondo: 0, link: 1, tubito: 2, corazon: 3 }[f?.tipo ?? "redondo"] ?? 4;
  return tipo * 1000 + (f?.diametroMaxCm ?? 0);
}

export const esTubito = (formatoId: string): boolean => formatoPorId(formatoId)?.tipo === "tubito";

const NOMBRE_OCASION: Readonly<Record<string, string>> = { cumpleanos: "cumpleaños", graduacion: "graduación" };

/** Las ocasiones tal como se guardaron, a como se dicen («cumpleanos» → «cumpleaños»). */
export const ocasionLegible = (ocasion: string): string => NOMBRE_OCASION[ocasion] ?? ocasion;

export function frasesFuente(f: Pick<FuenteRegistro, "tipo" | "titulo">): string {
  const titulo = f.titulo.replace(/^Sempertex · Ideas de fiesta · /, "").replace(/[.\s]+$/, "");
  switch (f.tipo) {
    case "idea-sempertex": return `Idea de decoración de sempertex.com: ${titulo}.`;
    case "celebra": return `Revista Celebra de Sempertex: ${titulo}.`;
    case "referencia-web": return `Referencia de internet (foto de un decorador o fabricante digitalizada): ${titulo}.`;
    case "referencia-dueno": return `Referencia del dueño (foto de Pinterest que él pasó): ${titulo}.`;
    case "propio": return `Del taller: ${titulo}.`;
  }
}

/** Qué es una parte, en una línea: la de decoraciones, o la de estructuras (con sus calificadores recortados). */
export function descripcionDeParte(parte: string): string | null {
  if (parte === SIN_PARTE) return null;
  const niveles = parte.split("/");
  for (let n = niveles.length; n > 0; n--) {
    const clave = niveles.slice(0, n).join("/");
    const d = parteDecoracion(clave)?.descripcion ?? PARTES_ESTRUCTURA.find((p) => p.id === clave)?.descripcion;
    if (d) return d;
  }
  return null;
}
