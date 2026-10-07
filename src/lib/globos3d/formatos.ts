import { TABLA_SEMPERTEX, type ReferenciaSempertex } from "@/lib/plan/referencia-sempertex";

/**
 * Los formatos de globo Sempertex que modela la página /3d, uno por uno, a su tamaño real.
 *
 * Las medidas son las nominales del catálogo (la pulgada del nombre es el diámetro máximo de inflado) y el
 * inflado de decoración es el que usan los tutoriales de Sempertex (Celebra, «Conceptos y técnicas»): R-12 a
 * 25 cm, R-9 a 18 cm, R-5 a 12 cm, Link-O-Loon 12 a 25 cm, Link-O-Loon 6 a 12 cm. Todo en centímetros.
 * Los formatos salen de la tabla oficial de color (`TABLA_SEMPERTEX`): solo se ofrecen los que se fabrican. El
 * Corazón 6 no está en esa tabla y se añade con los colores que documenta la revista (`COLORES_ATESTIGUADOS`).
 */
export type TipoGlobo = "redondo" | "link" | "tubito" | "corazon";

export type FormatoGlobo = {
  /** Código del catálogo: «R-12», «LOL-6», «T-260», «C-12». */
  id: string;
  tipo: TipoGlobo;
  nombre: string;
  /** Diámetro máximo de inflado (cm): para el tubito y el Link-O-Loon 660, el grosor. */
  diametroMaxCm: number;
  /** Inflado típico en decoración (cm), el que usan los tutoriales de Sempertex. */
  infladoDecoracionCm: number;
  /** Largo inflado (cm): solo tubitos y Link-O-Loon 660. */
  largoCm?: number;
  descripcion: string;
};

const PULGADA_CM = 2.54;
const cm = (pulgadas: number) => Math.round(pulgadas * PULGADA_CM * 10) / 10;

export const FORMATOS_GLOBO: readonly FormatoGlobo[] = [
  { id: "R-5", tipo: "redondo", nombre: "Redondo 5\"", diametroMaxCm: cm(5), infladoDecoracionCm: 12, descripcion: "El más pequeño: relleno de guirnaldas orgánicas, flores y parejas de unión." },
  { id: "R-9", tipo: "redondo", nombre: "Redondo 9\"", diametroMaxCm: cm(9), infladoDecoracionCm: 18, descripcion: "Trenzas medianas y mezcla de tamaños en arcos orgánicos." },
  { id: "R-12", tipo: "redondo", nombre: "Redondo 12\"", diametroMaxCm: cm(12), infladoDecoracionCm: 25, descripcion: "El estándar de columnas y arcos de cuartetos." },
  { id: "R-18", tipo: "redondo", nombre: "Redondo 18\"", diametroMaxCm: cm(18), infladoDecoracionCm: 42, descripcion: "Globo grande para dar volumen en guirnaldas y bases." },
  { id: "R-24", tipo: "redondo", nombre: "Redondo 24\"", diametroMaxCm: cm(24), infladoDecoracionCm: 55, descripcion: "Gran formato: anclas de arcos orgánicos y techos." },
  { id: "R-36", tipo: "redondo", nombre: "Redondo 36\"", diametroMaxCm: cm(36), infladoDecoracionCm: 85, descripcion: "Súper gigante: remates de columna y protagonistas de techo." },
  { id: "LOL-6", tipo: "link", nombre: "Link-O-Loon 6\"", diametroMaxCm: cm(6), infladoDecoracionCm: 12, descripcion: "Eslabón pequeño con conector: mallas finas y cenefas." },
  { id: "LOL-12", tipo: "link", nombre: "Link-O-Loon 12\"", diametroMaxCm: cm(12), infladoDecoracionCm: 25, descripcion: "Eslabón estándar: arcos, mallas, columnas cuadradas." },
  { id: "LOL-660", tipo: "link", nombre: "Link-O-Loon 660", diametroMaxCm: cm(6), infladoDecoracionCm: 13, largoCm: cm(60), descripcion: "Eslabón largo de 6\" × 60\": cuerpos de columna y ramas." },
  { id: "T-160", tipo: "tubito", nombre: "Tubito 160", diametroMaxCm: cm(1), infladoDecoracionCm: 2.5, largoCm: cm(60), descripcion: "Tubito fino de 1\" × 60\": detalles, cruces y espirales." },
  { id: "T-260", tipo: "tubito", nombre: "Tubito 260", diametroMaxCm: cm(2), infladoDecoracionCm: 5, largoCm: cm(60), descripcion: "El clásico de modelar, 2\" × 60\": moños, flores y figuras." },
  { id: "T-360", tipo: "tubito", nombre: "Tubito 360", diametroMaxCm: cm(3), infladoDecoracionCm: 7.5, largoCm: cm(60), descripcion: "Tubito grueso de 3\" × 60\": tallos, arcos y estructuras de figura." },
  { id: "C-12", tipo: "corazon", nombre: "Corazón 12\"", diametroMaxCm: cm(12), infladoDecoracionCm: 28, descripcion: "Corazón de látex: San Valentín, bodas y remates." },
  { id: "C-6", tipo: "corazon", nombre: "Corazón 6\"", diametroMaxCm: cm(6), infladoDecoracionCm: 14, descripcion: "Corazón pequeño: pétalos de flores de corazones y detalles aplicados. Solo los colores que la revista documenta." },
];

/**
 * Colores que una publicación de Sempertex documenta en un formato que la tabla oficial de color no trae.
 * La tabla (`TABLA_SEMPERTEX`) la genera el repo dueño y no lista el Corazón 6; la revista Celebra ed. 27, p. 42
 * («Malla con flores orgánicas») sí lo usa: «Corazón 6 Fashion Fucsia». Aquí solo entra lo atestiguado, con su
 * fuente; no se supone que el Corazón 6 venga en todos los colores del C-12 ni al revés.
 */
export const COLORES_ATESTIGUADOS: Readonly<Record<string, ReadonlyArray<{ codigo: string; fuente: string }>>> = {
  "C-6": [{ codigo: "012", fuente: "Celebra ed. 27, p. 42: Corazón 6 Fashion Fucsia" }],
};

export function formatoPorId(id: string): FormatoGlobo | undefined {
  return FORMATOS_GLOBO.find((formato) => formato.id === id);
}

/** Los colores Sempertex que se fabrican en ese formato, en el orden de la tabla oficial. */
export function coloresDelFormato(id: string): ReferenciaSempertex[] {
  const atestiguados = new Set((COLORES_ATESTIGUADOS[id] ?? []).map((c) => c.codigo));
  return TABLA_SEMPERTEX.referencias.filter((referencia) => referencia.formatos.includes(id) || atestiguados.has(referencia.codigo));
}

/** Familias de acabado de la tabla oficial, con su nombre comercial. */
export const NOMBRE_FAMILIA: Readonly<Record<string, string>> = {
  fashion: "Fashion", reflex: "Reflex", silk: "Silk", pastelMate: "Pastel Mate", satin: "Satín", metal: "Metal", pastelDusk: "Pastel Dusk", neon: "Neón", cristal: "Cristal",
};

/** Inflado limitado entre el 40 % y el 100 % del máximo de su formato, en cm. */
export function infladoValido(formato: FormatoGlobo, cmPedidos: number): number {
  return Math.min(formato.diametroMaxCm, Math.max(formato.diametroMaxCm * 0.4, cmPedidos));
}
