import type { Colocacion, Escena } from "../escena";
import type { Pieza } from "../piezas";

/**
 * Una idea de fiesta de sempertex.com (https://sempertex.com/blogs/idea-de-fiesta) digitalizada en el taller 3D.
 * Solo datos y urls públicas: ni fotos ni rutas locales en el repo. La biblioteca la convierte en item (escena o
 * pieza) y de ahí salen sus estructuras con sus decoraciones y sus decoraciones sueltas.
 */
export type ProductoDeIdea = {
  /** Nombre exacto en la tienda («GLOBO REDONDO FASHION NARANJA»). */
  nombre: string;
  /** Ruta de la tienda («/products/globo-para-fiesta-latex-redondo-fashion-naranja»). */
  url: string;
  formato: string | null;
  codigo: string | null;
  /** Cantidad si la idea la publica (lista «Materiales»), o la contada en la foto (`contada: true`). */
  cantidad: number | null;
  contada?: boolean;
};

export type IdeaDigitalizada = {
  /** «idea:<slug>». */
  id: string;
  /** Número en el índice local de las 987 ideas (para encontrar su foto y su clasificación). */
  numero: number;
  slug: string;
  nombre: string;
  ocasiones: string[];
  /** Foto pública de la idea en el CDN de Sempertex (https). */
  fotoUrl: string;
  productos: ProductoDeIdea[];
  contenido: { tipo: "escena"; escena: Escena } | { tipo: "pieza"; pieza: Pieza; sugerida?: Colocacion };
  /** Qué quedó igual a la foto y qué no (honesto y concreto). */
  nota: string;
};

export const urlDeIdea = (slug: string) => `https://sempertex.com/blogs/idea-de-fiesta/${slug}`;
