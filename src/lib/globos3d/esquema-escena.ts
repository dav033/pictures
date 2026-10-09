import { z } from "zod";
import type { Colocacion, Escena } from "./escena";
import { MAX_NODOS, TIPOS_PIEZA } from "./herramientas-escena";
import type { Pieza } from "./piezas";
import { AmbienteSalaSchema } from "./ambiente-sala";

/** La escena como la valida el servidor cuando llega del navegador (`/api/escena-ia`, `/api/escena-ia/similitud`): no se confía en lo que manda el cliente. */

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Numero = z.number().finite();
const Vec = z.object({ x: Numero, y: Numero, z: Numero });

const ColocacionSchema: z.ZodType<Colocacion> = z.discriminatedUnion("en", [
  z.object({ en: z.literal("piso"), xCm: Numero, zCm: Numero, giroGrados: Numero }),
  z.object({ en: z.literal("pared"), pared: z.enum(["fondo", "izquierda", "derecha"]), aLoLargoCm: Numero, alturaCm: Numero }),
  z.object({ en: z.literal("techo"), xCm: Numero, zCm: Numero, cuelgaCm: Numero, giroGrados: Numero, volteada: z.boolean() }),
  z.object({ en: z.literal("ancla"), padreId: z.string().min(1).max(80), ancla: Numero, cada: Numero, giroGrados: Numero, omitir: z.array(Numero).max(400).optional() }),
  z.object({ en: z.literal("libre"), xCm: Numero, yCm: Numero, zCm: Numero, giroGrados: Numero }),
  z.object({ en: z.literal("sobre"), padreId: z.string().min(1).max(80), puntoCm: Vec, normal: Vec, giroGrados: Numero }),
]);

/**
 * La pieza la arma el taller (que ya valida sus datos al armar): aquí basta con que sea un objeto de un tipo conocido.
 * Todos los tipos: una escena con formas, letras, metalizados, murales, techo o árboles (las de la biblioteca) también vale.
 */
const PiezaSchema = z.custom<Pieza>((v) => typeof v === "object" && v !== null && (TIPOS_PIEZA as readonly unknown[]).includes((v as { tipo?: unknown }).tipo), "Pieza desconocida");

export const EscenaSchema: z.ZodType<Escena> = z.object({
  sala: z.object({
    anchoCm: Numero.min(100).max(3000), fondoCm: Numero.min(100).max(3000), altoCm: Numero.min(100).max(1500),
    tonos: z.object({ piso: Hex, paredes: Hex, techo: Hex }),
    mostrar: z.object({ piso: z.boolean(), fondo: z.boolean(), laterales: z.boolean(), techo: z.boolean() }),
    ambiente: AmbienteSalaSchema.optional(),
  }),
  nodos: z.array(z.object({ id: z.string().min(1).max(80), nombre: z.string().max(120), pieza: PiezaSchema, colocacion: ColocacionSchema })).max(MAX_NODOS),
});
