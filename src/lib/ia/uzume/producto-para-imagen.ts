/**
 * Cómo se le nombra un producto de catálogo al modelo de imagen.
 *
 * Cada foto de producto viajaba con `${nombre}. ${descripcion}. Cotización: N
 * paquete(s) de M unidades.`, pegada a la imagen: capacidad de compra
 * presentada como cantidad visual, justo lo contrario del contrato del prompt
 * ("Neither surplus nor unused package units may appear in the decoration").
 * Y el nombre de la variante arrastra el empaque ("R-12 / PAQUETE X 50"), que
 * el preflight del LoRA rechaza como fuga comercial.
 *
 * Puro: sin proveedor, HTTP, base de datos ni variables de entorno.
 */

export type ProductoParaImagen = {
  nombre: string;
  descripcion: string;
  /** Título del producto en el catálogo, sin el título de la variante. */
  catalogProductTitle?: string;
};

/**
 * Sufijo de variante al final del nombre: el título comercial se arma como
 * `${producto_titulo} — ${variante_titulo}` (rag/chat/validar.ts), y el título
 * de la variante es un código de tamaño y/o el empaque.
 */
const SUFIJO_VARIANTE = /\s*[—–]\s*[^—–]*(?:\bR-\d+\b|\bpaquete\b|\bpack\b|\bbolsa\s+x\b|\bcaja\s+x\b)[^—–]*$/i;

/** Nombre del producto para el modelo de imagen, sin el sufijo de variante. */
export function nombreProductoParaImagen(product: ProductoParaImagen): string {
  const titulo = product.catalogProductTitle?.trim();
  if (titulo) return titulo;
  return product.nombre.replace(SUFIJO_VARIANTE, "").trim() || product.nombre;
}

/**
 * Descripción que acompaña a la foto del producto. Nunca lleva paquetes ni
 * precios: si hace falta una cantidad es la instalada del estimado, en inglés,
 * porque la capacidad comprada no es cantidad visual.
 */
export function descripcionProductoParaImagen(product: ProductoParaImagen, unidadesInstaladas?: number): string {
  const unidades = unidadesInstaladas !== undefined && unidadesInstaladas > 0
    ? ` Installed design quantity in this scene: ${unidadesInstaladas} unit(s).`
    : "";
  return `${nombreProductoParaImagen(product)}. ${product.descripcion}.${unidades}`;
}
