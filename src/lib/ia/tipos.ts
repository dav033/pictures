// El subconjunto de chat (ProveedorId, Mensaje, ChatPort, ErrorIA...) se
// movió a @sempertex/agente-core como parte de la extracción del motor
// reutilizable — ver PLAN: extraer el motor de chat/RAG a un paquete. Todo
// lo de generación de imagen (Imagen, ImagenPort, PeticionImagen...) es
// específico de este proyecto y se queda aquí sin cambios.
import type { ProveedorId } from "@sempertex/agente-core";

export type {
  ProveedorId,
  Mensaje,
  LlamadaHerramienta,
  Herramienta,
  PeticionChat,
  TurnoChat,
  FragmentoChat,
  ChatPort,
  CausaFallo,
} from "@sempertex/agente-core";
export { ErrorIA } from "@sempertex/agente-core";

/* ---------- Imagen ---------- */
export type Imagen = {
  base64: string;
  mime: string;
  /** Identificador semántico que también se transmite junto a la imagen al proveedor. */
  id?: string;
  /** Descripción literal asociada al mismo `id`; nunca sustituye los píxeles. */
  descripcion?: string;
  ancho?: number;
  alto?: number;
  originalAncho?: number;
  originalAlto?: number;
};

export type ImagenEtiquetada = Imagen & { id: string; descripcion: string };

export type ImageInputRole =
  | "composition_reference"
  | "element_reference"
  | "palette_reference"
  | "style_reference"
  | "catalog_product_reference"
  | "venue_base"
  | "previous_generated_result";

export type ImageInput = ImagenEtiquetada & {
  role: ImageInputRole;
  priority: number;
  allowed_use: string;
};

export type ProviderCapabilities = {
  exactAspectRatios: PeticionImagen["aspecto"][];
  totalInputImageLimit: number;
  objectFidelityInputLimit: number;
  highFidelityInputSupport: boolean;
  multiTurnSupport: boolean;
};

export type PeticionImagen = {
  prompt: string;
  /** Foto del cliente → modo "editar". */
  /** Fotos reales de producto — deben verse tal cual, no reinterpretadas. */
  /** Referencias de estilo del cliente — solo guían paleta/ambiente/textura, nunca aportan objetos nuevos. */
  inputs: ImageInput[];
  sceneSpec?: import("./scene-spec").SceneSpec;
  previousGeneratedImage?: ImagenEtiquetada;
  /** Id de la interacción anterior (solo Gemini) — encadena de verdad esta
   * llamada con la anterior en la misma revisión, en vez de depender solo
   * de reenviar la imagen previa como referencia. */
  previousInteractionId?: string;
  revisionMode?: "new_generation" | "revise_current_result";
  aspecto: "3:2" | "1:1" | "2:3" | "16:9";
  calidad: "borrador" | "alta";
  /** Metadatos acotados para atribuir coste. Nunca contiene prompt ni imágenes. */
  telemetria?: import("./telemetria-llamadas").ContextoTelemetriaIA & {
    capacidad?: "imagen_generacion" | "imagen_generacion_correctiva";
  };
  /** En laboratorio, las referencias sí definen objetos y composición completa. */
};

export interface ImagenPort {
  readonly id: ProveedorId;
  readonly modelo: string;
  readonly capabilities: ProviderCapabilities;
  /** Cuántas imágenes de referencia + base admite una sola petición. */
  readonly maxReferencias: number;
  generar(p: PeticionImagen): Promise<{ imagen: Imagen; modelo: string; ms: number; interactionId?: string }>;
}
