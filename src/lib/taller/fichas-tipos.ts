import type { IdRepositorio } from "@/lib/catalogo/tipos";
import type { FuenteItem, TipoItem } from "@/lib/globos3d/biblioteca";

/** Lo que otro agente decide para cada item (taxonomía de celebraciones y temáticas): aquí solo se aceptan ids o nombres. */
export type ClasificacionTaller = { celebraciones: string[]; tematicas: string[] };

export type FuenteRegistro = { tipo: FuenteItem["tipo"]; titulo: string; url: string | null; foto: string | null };

export type ColorRegistro = { codigo: string; nombre: string };

/** Una línea del inventario por parte × formato × color (de `inventarioDe`, con las copias ya contadas). */
export type LineaParteRegistro = { parte: string; formatoId: string; codigo: string; cantidad: number };

/** Un producto de la tienda (o genérico, sin url) que hace falta para armar el item. */
export type ProductoRegistro = {
  origen: "globo" | "impreso" | "metalizado" | "utileria";
  nombre: string;
  url: string | null;
  cantidad: number;
  /** No hay uno igual en la tienda: se compra uno parecido. */
  generico: boolean;
};

export type MedidasRegistro = { altoCm: number; anchoCm: number; fondoCm: number };

/** El registro buscable de un item de la biblioteca: sus facetas, su contenido resumido y la ficha que se embebe. */
export type RegistroTaller = {
  id: string;
  /** El repositorio de catálogo (REQ-013, R2): una etiqueta del índice, fuera de la huella (no obliga a volver a embeber). */
  repositorio: IdRepositorio;
  tipo: TipoItem;
  nombre: string;
  descripcion: string;
  fuente: FuenteRegistro | null;
  ocasiones: string[];
  tiposPieza: string[];
  formatos: string[];
  colores: ColorRegistro[];
  partes: string[];
  lineasPartes: LineaParteRegistro[];
  productos: ProductoRegistro[];
  medidas: MedidasRegistro;
  /** Globos que no son tubito (cada uno, uno). */
  globos: number;
  /** Tubitos (tramos de tubito y globos de formato tubito). */
  tubos: number;
  clasificacion: ClasificacionTaller | null;
  /** Huella (sha256) de todo lo que alimenta la ficha: si no cambia, no hay que volver a embeber. */
  hash: string;
  ficha: string;
};
