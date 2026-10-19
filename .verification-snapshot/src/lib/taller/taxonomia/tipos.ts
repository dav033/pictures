/**
 * Tipos de la taxonomía del taller. Dos ejes cerrados e independientes (celebración y temática); los datos viven en
 * archivos hermanos y `../taxonomia-celebraciones.ts` es la única puerta de entrada.
 */

export type GrupoCelebracion = "vida-y-familia" | "calendario" | "deporte-y-eventos" | "empresa-y-comercio" | "fiestas-y-otros";

export type GrupoTematica = "animales-y-naturaleza" | "fantasia-y-cuentos" | "aventura-y-oficios" | "estilos" | "paletas-y-acabados" | "lugares-y-culturas" | "gustos-y-motivos";

export type EntradaTaxonomia<G extends string> = {
  /** Slug ascii estable: se guarda en los items, en el navegador del dueño y en la base. No se renombra. */
  id: string;
  nombre: string;
  en: string;
  grupo: G;
  /** Variantes que lo nombran sin dudar (también faltas de ortografía, sin tildes y palabras en inglés). */
  sinonimos: readonly string[];
  /** Palabras que lo sugieren sin asegurarlo («mamá», «oferta»): cuentan como pista débil. */
  ambiguos?: readonly string[];
};

export type Celebracion = EntradaTaxonomia<GrupoCelebracion>;
export type Tematica = EntradaTaxonomia<GrupoTematica>;

/**
 * Lo que encontró el buscador de texto por id: el término de la taxonomía que casó (el más fuerte) y si era una pista
 * débil, más todos los términos distintos del mismo id que aparecen en el texto.
 */
export type Coincidencia = { id: string; termino: string; debil: boolean; terminos: string[] };

export const NOMBRE_GRUPO_CELEBRACION: Readonly<Record<GrupoCelebracion, string>> = {
  "vida-y-familia": "Vida y familia",
  calendario: "Fechas del calendario",
  "deporte-y-eventos": "Deporte y eventos",
  "empresa-y-comercio": "Empresa y comercio",
  "fiestas-y-otros": "Fiestas y otros",
};

export const NOMBRE_GRUPO_TEMATICA: Readonly<Record<GrupoTematica, string>> = {
  "animales-y-naturaleza": "Animales y naturaleza",
  "fantasia-y-cuentos": "Fantasía y cuentos",
  "aventura-y-oficios": "Aventura y oficios",
  estilos: "Estilos",
  "paletas-y-acabados": "Paletas y acabados",
  "lugares-y-culturas": "Lugares y culturas",
  "gustos-y-motivos": "Gustos y motivos",
};
