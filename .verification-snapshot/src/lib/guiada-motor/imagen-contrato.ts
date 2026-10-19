import { z } from "zod";
import { CuerpoArmadaSchema, VISTAS_ARMADA } from "./armada-contrato";

/**
 * Contrato de `POST /api/guiada/motor/imagen` (REQ-007, fase 4): «Ver cómo quedaría» de un plan armado por el motor 3D. El
 * navegador manda lo que su plan ya trae (token, hash, motor y espec firmada, como en la ruta de la armada) y, si pudo, la
 * captura del visor que el cliente está viendo. El servidor vuelve a armar la espec firmada, cuenta la escena en inglés y la
 * pasa por FLUX junto con la captura: del navegador solo cuenta la firma y los píxeles. Sin `server-only`: lo comparten la ruta
 * y el navegador.
 */
export const RUTA_IMAGEN_MOTOR = "/api/guiada/motor/imagen";

/**
 * Los lugares que la vista guiada ofrece para la imagen: uno, «Igual al visor» (la sala del 3D que el cliente ve). La guiada no
 * tiene selector de lugar (el lugar que dice el cliente solo entra al plan como palabras); los demás lugares del Taller
 * (`salon_elegante`…) rehacen paredes y luz y van por otro camino de FLUX, así que esta ruta no los acepta hasta que la guiada
 * los ofrezca.
 */
export const AMBIENTES_IMAGEN_GUIADA = ["igual_visor"] as const;
export type AmbienteImagenGuiada = (typeof AMBIENTES_IMAGEN_GUIADA)[number];

/** Tope de la captura como texto (data URL): un PNG de 1024 px de globos pesa 1 a 3 MB. */
export const MAX_CARACTERES_CAPTURA = 8_000_000;
export const MAX_CARACTERES_CUERPO_IMAGEN = MAX_CARACTERES_CAPTURA + 400_000;

export const CuerpoImagenSchema = z.object({
  approval_token: CuerpoArmadaSchema.shape.approval_token,
  plan_hash: CuerpoArmadaSchema.shape.plan_hash,
  motor: CuerpoArmadaSchema.shape.motor,
  /** La espec que el token firmó: el servidor la valida y comprueba su hash; no se fía de ella. */
  espec: z.unknown(),
  ambiente: z.enum(AMBIENTES_IMAGEN_GUIADA).default("igual_visor"),
  /** Solo sin captura: la cámara de la proyección SVG que el servidor rasteriza (la que el cliente ve en su tarjeta). */
  vista: z.enum(VISTAS_ARMADA).optional(),
  /** La captura del visor compartido (lo que el cliente ve). Sin ella el servidor rasteriza la proyección SVG de la armada. */
  captura: z.string().regex(/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/).max(MAX_CARACTERES_CAPTURA).optional(),
}).strict();
export type CuerpoImagen = z.infer<typeof CuerpoImagenSchema>;
export type CuerpoImagenEntrada = z.input<typeof CuerpoImagenSchema>;
