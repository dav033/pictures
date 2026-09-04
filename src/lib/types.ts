export type Categoria =
  | "arco"
  | "centro_mesa"
  | "mobiliario"
  | "manteleria"
  | "iluminacion"
  | "flores";

export type Producto = {
  id: string;
  nombre: string;
  /**
   * String libre, no el enum `Categoria`: el catálogo real de Shopify (§2 del
   * plan) trae su propia taxonomía de categorías y comparte este mismo tipo
   * para poder renderizarse con los mismos componentes que el catálogo
   * curado a mano, que sí usa `Categoria`.
   */
  categoria: string;
  /**
   * product_type crudo de Shopify (ej. "E-DECORS", "FIESTAS PREDISEÑADAS") —
   * distinto de `categoria`. Indica que el producto ya es un kit/decoración
   * completa con look propio, no un ingrediente suelto — la generación de
   * imagen lo usa para no fusionarlo visualmente con otros elementos.
   */
  tipoProducto?: string;
  estilos: string[];
  colores: string[];
  /** Descripción visual rica: es lo que se le manda al modelo de imagen. */
  descripcion: string;
  precio: number;
  /** Unidades por paquete cuando el precio es por paquete, no por pieza (catálogo Shopify). */
  unidadesPaquete?: number;
  /** Paquetes cotizados de esta variante cuando la selección viene del flujo RAG. */
  paquetes?: number;
  /**
   * Tamaño real de esta variante (plan de tamaños F4) — antes se calculaba y
   * se descartaba al construir `Producto` (`aProducto()`), así que nunca
   * llegaba al prompt de imagen: la generación no tenía forma de saber que
   * "R-12" son 30 cm y terminaba variando la escala a ciegas.
   */
  tamanoCodigo?: string;
  /** Forma física del globo (redondo, corazon, link, modelar) — no el acabado. */
  forma?: string;
  /** Diámetro real en pulgadas — solo globo redondo. */
  diamPulg?: number;
  /**
   * Id del producto Shopify (no de la variante) — varias variantes de
   * distinto tamaño comparten el mismo `familiaId` aunque cada una tenga su
   * propio `id` (de variante). Permite agrupar una mezcla de tamaños del
   * MISMO producto en un solo elemento visual coherente en vez de una
   * tarjeta de catálogo dispersa por tamaño (ver `agruparPorFamilia` en
   * generate/route.ts).
   */
  familiaId?: string;
  /** SKU factual de Shopify, solo para resolver identidad canónica internamente. */
  catalogSku?: string;
  /** Emoji + color de acento para el placeholder cuando no hay foto real. */
  emoji?: string;
  tono?: string;
  /**
   * Foto real del producto: ruta local en /public/uploads (catálogo curado a
   * mano) o URL completa a cdn.shopify.com (catálogo real). Si existe, se
   * manda como imagen de referencia a la API de imágenes y se muestra en vez
   * del placeholder.
   */
  foto?: string;
};

/**
 * Paquete curado de productos del catálogo (ej. "Boda boho jardín"). Todos
 * sus elementos son opcionales: el cliente puede quitar cualquiera al
 * personalizar la decoración antes de generar la visualización.
 */
export type Decoracion = {
  id: string;
  nombre: string;
  descripcion?: string;
  /** Imagen de portada que representa la decoración. */
  imagen: string;
  /** ids de Producto que la componen. */
  elementos: string[];
};

export type Brief = {
  tipo_evento?: string;
  espacio?: string;
  invitados?: number;
  colores?: string[];
  estilo?: string;
  momento_dia?: string;
  fecha?: string;
  /** Número cuando lo infiere la IA de texto libre; texto cuando el cliente
   * toca uno de los 3 niveles fijos (ej. rango "$100.000 a $200.000"). */
  presupuesto?: number | string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

/** Decoración con sus productos ya resueltos, para mostrarla en el chat sin pedirlos aparte. */
export type DecoracionConProductos = Decoracion & { productos: Producto[] };

export type ChatResponse = {
  reply: string;
  brief: Brief;
  recomendaciones: Producto[];
  decoraciones: DecoracionConProductos[];
};

export type GenerateResponse = {
  imagen: string;
  prompt: string;
};
