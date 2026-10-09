import { z } from "zod";

/**
 * Contrato de `POST /api/guiada/motor/armada` (REQ-007, fase 3): la vista del plan 3D. El navegador manda lo que su plan ya
 * trae (token, hash, motor y espec firmada) y el servidor, que es el único que tiene el motor, la vuelve a armar y
 * devuelve la armada compacta (o, sin WebGL, el SVG ya dibujado). Sin `server-only`: lo comparten la ruta y el navegador.
 */
export const RUTA_ARMADA_MOTOR = "/api/guiada/motor/armada";

export const VISTAS_ARMADA = ["frente", "tres-cuartos"] as const;
export type VistaArmada = (typeof VISTAS_ARMADA)[number];

export const CuerpoArmadaSchema = z.object({
  approval_token: z.string().min(1),
  plan_hash: z.string().regex(/^[0-9a-f]{64}$/),
  motor: z.object({ id: z.literal("globos3d"), version: z.string().min(1).max(40) }).strict(),
  /** La espec que el token firmó: el servidor la valida y comprueba su hash; no se fía de ella. */
  espec: z.unknown(),
  /** `armada` (por defecto): la geometría compacta para dibujar en WebGL. `svg`: la proyección de reserva. */
  salida: z.enum(["armada", "svg"]).default("armada"),
  /** Solo con `salida: "svg"`. */
  vista: z.enum(VISTAS_ARMADA).optional(),
  /** Solo con `salida: "svg"`: una sola pieza, encuadrada por su caja. */
  pieza: z.string().min(1).max(80).optional(),
}).strict();
export type CuerpoArmada = z.infer<typeof CuerpoArmadaSchema>;
export type CuerpoArmadaEntrada = z.input<typeof CuerpoArmadaSchema>;
