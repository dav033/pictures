import type { Pieza } from "./piezas";

/**
 * Decoraciones reales digitalizadas: cada una reproduce una foto del banco de estructuras de Sempertex (revistas
 * Celebra y PDF de técnicas) como una `Pieza` del taller. `fotoId` es el id de la foto en el banco
 * (p. ej. «e01-p007-000»). Las escenas las ofrecen para añadirlas con un clic.
 */
export type DecoracionDigitalizada = {
  id: string;
  nombre: string;
  /** Id de la foto del banco de estructuras. */
  fotoId: string;
  /** «Celebra ed. 1 (2011), p. 7». */
  fuente: string;
  /** Qué se reprodujo y qué no (en español, corto). */
  descripcion: string;
  pieza: Pieza;
};

export const CATALOGO_DECORACIONES: readonly DecoracionDigitalizada[] = [];
