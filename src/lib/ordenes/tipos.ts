// Tipos compartidos del pipeline de dataset por orden (fotos reales + desglose + caption +
// feedback humano) -- usados tanto por las rutas de API del panel de admin como por el
// generador de captions que corre server-side.

export type LineaDesglose = {
  producto: string;
  variante: string | null;
  sku: string | null;
  cantidad: number;
  precioUnitario: number;
};

export type Desglose = {
  orden: string;
  cliente: string | null;
  fecha: string | null;
  lineas: LineaDesglose[];
};

export type Caption = {
  orden: string;
  foto: string;
  trigger_token: string;
  tipo_estructura: string;
  elementos_no_comprados: string[];
  proporcion_relativa_presente: boolean;
  proporcion_relativa_descripcion: string;
  caption: string;
  caption_status: string;
  source: string;
};

export type ProductoRepresentado = {
  producto: string;
  representado: boolean;
};

/** Categoría temática para separar qué foto entrena el LoRA base vs. cuál de los acentos por
 * tema (ver docs/data/PLAN-ENTRENAMIENTO-SEMPERTEX-v002.md §4). "no_asignada" es el default real
 * de "todavía nadie decidió esto" (nueva foto, o migrada desde el "general" viejo que en verdad
 * era solo el default sin revisar). "general" ahora es un balde deliberado: fotos confirmadas
 * como base bien balanceada por acabado, o que a propósito no calzan en ningún tema. */
export const CATEGORIAS_ENTRENAMIENTO = [
  "no_asignada",
  "general",
  "amor_y_amistad",
  "halloween",
  "navidad",
  "xv_anos",
  "fiesta_infantil",
  "fiesta_generica",
] as const;
export type CategoriaEntrenamiento = (typeof CATEGORIAS_ENTRENAMIENTO)[number];

/**
 * Revisión humana estructurada de una foto -- insumo limpio para regenerar el caption
 * ("recaption"), separado de editar el texto del caption a mano. Responde preguntas que un
 * modelo de visión no puede autoverificar de forma confiable: si la foto es realmente de una
 * decoración, si el encuadre es la escena completa o un recorte, y cuáles productos
 * comprados de verdad se alcanzan a ver.
 */
export type FeedbackFoto = {
  orden: string;
  foto: string;
  esDecoracion: boolean;
  decoracionCompleta: boolean;
  elementoPrincipal: string;
  fidelidadImagen: "alta" | "media" | "baja";
  productosRepresentados: ProductoRepresentado[];
  aptoParaEntrenamiento: boolean;
  categoria: CategoriaEntrenamiento;
  notas: string;
  revisadoEn: string;
  /** "ia_automatica": la IA lo determinó sola al generar el caption, sin intervención
   * humana. "humano": alguien lo revisó y guardó a mano desde el modal de Feedback (esto
   * incluye corregir uno que empezó como automático). */
  fuente: "ia_automatica" | "humano";
};
