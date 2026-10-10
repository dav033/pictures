import { z } from "zod";
import { idCortoDeFondo } from "@/lib/catalogo/asignacion-fondos";
import type { Colocacion, Escena } from "./escena";
import { MAX_NODOS, TIPOS_PIEZA } from "./herramientas-escena";
import type { Pieza } from "./piezas";
import { AmbienteSalaSchema } from "./ambiente-sala";
import { MuebleDePiezaSchema } from "./mobiliario-pieza";
import { RotuloSchema } from "./rotulos";
import { TIPOS_MESA_SALON } from "./salon-evento";
import { ZONAS_SALON } from "./salon-zonas";

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
  z.object({ en: z.literal("sobre"), padreId: z.string().min(1).max(80), puntoCm: Vec, normal: Vec, giroGrados: Numero, encima: z.boolean().optional() }),
]);

/** Lo que se guarda es el id corto del mueble (SPEC §5.2): uno que llega calificado con su repositorio se normaliza aquí. */
function conMuebleCorto(p: Pieza): Pieza {
  if (p.tipo !== "escenografia" || !p.mueble) return p;
  const corto = idCortoDeFondo(p.mueble.id);
  return corto === null || corto === p.mueble.id ? p : { ...p, mueble: { ...p.mueble, id: corto } };
}

/**
 * La pieza la arma el taller (que ya valida sus datos al armar): aquí basta con que sea un objeto de un tipo conocido.
 * Todos los tipos: una escena con formas, letras, metalizados, murales, techo o árboles (las de la biblioteca) también vale.
 */
const PiezaSchema = z.custom<Pieza>((v) => {
  if (typeof v !== "object" || v === null || !(TIPOS_PIEZA as readonly unknown[]).includes((v as { tipo?: unknown }).tipo)) return false;
  // Un mueble del catálogo guarda sus medidas y colores: esos sí se validan (el resto lo valida el taller al armar).
  const esEscenografia = (v as { tipo: string }).tipo === "escenografia";
  const mueble = esEscenografia ? (v as { mueble?: unknown }).mueble : undefined;
  // El rótulo de un elemento guardado (una idea o una pieza vieja) también va validado: lo dibuja el visor tal cual.
  const elementos = esEscenografia ? (v as { elementos?: unknown }).elementos : undefined;
  const rotulosBuenos = !Array.isArray(elementos) || elementos.every((e) => typeof e !== "object" || e === null || !("rotulo" in e) || (e as { rotulo?: unknown }).rotulo === undefined || RotuloSchema.safeParse((e as { rotulo: unknown }).rotulo).success);
  return rotulosBuenos && (mueble === undefined || MuebleDePiezaSchema.safeParse(mueble).success);
}, "Pieza desconocida o con un mueble o un rótulo de medidas, colores o texto no válidos").transform(conMuebleCorto);

/** El registro del salón de eventos (salon-registro.ts): qué piezas armó el salón y dónde las puso. */
const RegistroSalonSchema = z.object({
  invitados: z.number().int().min(0).max(1000),
  mesa: z.enum(TIPOS_MESA_SALON),
  sillas: z.number().int().min(2).max(20).optional(),
  profundidadFondoCm: z.number().finite().min(0).max(3000),
  variante: z.number().int().min(0).max(1000).optional(),
  peticion: z.string().max(200).optional(),
  piezas: z.record(z.string().min(1).max(80), z.object({
    zona: z.enum([...ZONAS_SALON, "mesas"]),
    rol: z.enum(["mesa", "ancla", "silla", "adorno", "adoptada"]),
    ranura: z.number().int().min(1).max(1000).optional(),
    pos: z.object({ x: Numero, z: Numero }).optional(),
  })).refine((r) => Object.keys(r).length <= MAX_NODOS, "Demasiadas piezas anotadas"),
});

export const EscenaSchema: z.ZodType<Escena> = z.object({
  sala: z.object({
    anchoCm: Numero.min(100).max(3000), fondoCm: Numero.min(100).max(3000), altoCm: Numero.min(100).max(1500),
    tonos: z.object({ piso: Hex, paredes: Hex, techo: Hex }),
    mostrar: z.object({ piso: z.boolean(), fondo: z.boolean(), laterales: z.boolean(), techo: z.boolean() }),
    ambiente: AmbienteSalaSchema.optional(),
  }),
  nodos: z.array(z.object({ id: z.string().min(1).max(80), nombre: z.string().max(120), pieza: PiezaSchema, colocacion: ColocacionSchema })).max(MAX_NODOS),
  salon: RegistroSalonSchema.optional(),
}).refine((e) => new Set(e.nodos.map((n) => n.id)).size === e.nodos.length, "Hay dos piezas con el mismo id");
