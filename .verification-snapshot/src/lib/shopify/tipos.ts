import type { DescripcionEnriquecida } from "./enriquecer-descripcion";

/** Formas crudas devueltas por las dos fuentes públicas de Shopify (§0.4 del plan). */

export type VariantePublica = {
  id: number;
  title: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  sku: string | null;
  price: string;
  available: boolean;
  grams: number;
};

export type ProductoPublico = {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  product_type: string | null;
  tags: string[];
  variants: VariantePublica[];
  images: Array<{ src: string }>;
  /** Presente en products.json y en los webhooks de Admin API — usado para
   * detectar eventos fuera de orden (plan Fase 5 §5.5). */
  updated_at?: string;
};

export type VarianteInventarioCDN = {
  sku: string | null;
  inventoryQuantity: number;
  barcode: string | null;
};

export type ProductoInventarioCDN = {
  id: string;
  handle: string;
  variants: VarianteInventarioCDN[];
};

/** Forma canónica ya derivada, lista para persistir. */
export type VarianteCanonica = {
  id: string;
  sku: string | null;
  titulo: string;
  option1: string | null;
  option2: string | null;
  precio: number;
  disponible: boolean;
  inventario: number | null;
  inventarioFuente: "cdn" | null;
  gramos: number;
  tamanoCodigo: string | null;
  forma: string | null;
  diamPulg: number | null;
  largoPulg: number | null;
  anchoCm: number | null;
  altoCm: number | null;
  unidadesPaq: number;
  unidadesInferidas: boolean;
};

export type ProductoCanonico = {
  id: string;
  handle: string;
  titulo: string;
  tituloLimpio: string;
  tipo: string | null;
  tags: string[];
  descripcionTxt: string | null;
  descripcionDatos: DescripcionEnriquecida;
  categoria: string | null;
  colores: string[];
  ocasiones: string[];
  imagenPrincipal: string | null;
  imagenes: string[];
  disponible: boolean;
  precioMin: number | null;
  precioMax: number | null;
  variantes: VarianteCanonica[];
};
