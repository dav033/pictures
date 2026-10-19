import { repositorioDeLista } from "../../construir";
import type { Repositorio } from "../../repositorio";
import { entradasDeBiblioteca, resolutorDeDerivados } from "./entradas-biblioteca";
import { entradasDeDecoracionesGuiadas, entradasDePlanesDeIdeas } from "./entradas-guiada";
import { entradasDeColores, entradasDeFormatos, entradasDeModulos, entradasDeProductos } from "./entradas-referencia";
import { MANIFIESTO_SEMPERTEX } from "./manifiesto";

/** Sempertex como vista (R3): la biblioteca de fábrica en su orden y después formatos, colores, utilería de la tienda, la biblioteca guiada y los módulos. */
export const cargarSempertex = (): Repositorio => repositorioDeLista(MANIFIESTO_SEMPERTEX, () => [
  ...entradasDeBiblioteca(),
  ...entradasDeFormatos(),
  ...entradasDeColores(),
  ...entradasDeProductos(),
  ...entradasDePlanesDeIdeas(),
  ...entradasDeDecoracionesGuiadas(),
  ...entradasDeModulos(),
], resolutorDeDerivados());
