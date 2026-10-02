import { z } from "zod";
import {
  AdornosPedidosSchema,
  ColorPedidoSchema,
  FormaPedidaSchema,
  GeometriaPedidaSchema,
  PesoTamanoSchema,
  RematePedidoSchema,
  TIPOS_ARMADO_MOTOR,
  VolumenPedidoSchema,
} from "@/lib/plan/armado-estructura-ia";

/**
 * La frontera de las dos herramientas de armado del agente (ADR-0034 §5): qué forma tienen que tener sus
 * argumentos para que se ejecuten.
 *
 * Los argumentos del modelo **se validan siempre**, aquí, antes de llegar a Python; el JSON Schema de
 * `herramientas.ts` solo guía al modelo, igual que con `ajustar_plan_decoracion` y `EdicionSchema`. Lo que no
 * se valida aquí son las reglas del motor —qué patrón admite cuántos colores, qué grosor cabe en un largo,
 * qué acabados existen—: eso lo decide la puerta de Python, que es la dueña, y repetirlo aquí sería un segundo
 * dueño que se desincroniza en silencio.
 *
 * Qué NO hay en este archivo: ningún patrón por defecto, ningún rango de mando, ninguna receta y ninguna
 * lista del motor. Si aquí apareciera un valor de partida, el motor dejaría de ser el dueño de cómo se arma
 * una pieza.
 */

export const ArgsConsultarOpcionesArmadoSchema = z
  .object({ tipo: z.enum(TIPOS_ARMADO_MOTOR) })
  .strict();

export type ArgsConsultarOpcionesArmado = z.infer<typeof ArgsConsultarOpcionesArmadoSchema>;

/**
 * Los mandos del patrón llegan como lista de pares y no como objeto libre porque cada patrón tiene los suyos
 * (`ancho` en la espiral, `periodo` en el zigzag, `suavidad` en el ombré): un objeto con claves abiertas no se
 * puede declarar en el esquema de la herramienta, y sin declararlo el proveedor no lo emite. La clave y el
 * rango los publica el catálogo del motor; aquí solo se comprueba que sea un número con nombre.
 *
 * Los bloques de la guirnalda (`forma`, `volumen`, `adornos`) **no** van como pares: sus claves son fijas y
 * las publica el contrato, así que se declaran una a una y se leen mejor.
 */
const ParOpcionSchema = z
  .object({ clave: z.string().trim().min(1).max(40), valor: z.number().finite() })
  .strict();

export const ArgsArmarEstructuraSchema = z
  .object({
    estructura_id: z.string().trim().min(1).max(160),
    tipo: z.enum(TIPOS_ARMADO_MOTOR),
    /** Cuántos materiales va a llevar la pieza; es el tope de los índices del armado. */
    colores: z.number().int().min(1).max(12),
    // --- Arco y columna: el patrón y sus mandos ---
    patron: z.string().trim().min(1).max(40).optional(),
    materiales: z.array(z.number().int().min(0).max(11)).min(1).max(8).optional(),
    opciones: z.array(ParOpcionSchema).max(12).optional(),
    geometria: GeometriaPedidaSchema.optional(),
    remate: RematePedidoSchema.optional(),
    // --- Guirnalda orgánica: no tiene patrón, la define su paleta y su línea ---
    paleta: z.array(ColorPedidoSchema).min(1).max(8).optional(),
    reparto: z.string().trim().min(1).max(40).optional(),
    mezcla_colores: z.number().min(0).max(1).optional(),
    forma: FormaPedidaSchema.optional(),
    volumen: VolumenPedidoSchema.optional(),
    tamanos: z.array(PesoTamanoSchema).min(1).max(6).optional(),
    adornos: AdornosPedidosSchema.optional(),
  })
  .strict()
  .superRefine((args, ctx) => {
    // La condición es por tipo y no se puede expresar en el JSON Schema que ve el modelo (ni el proveedor la
    // respetaría): el esquema la cuenta en texto, como el resto del archivo de herramientas, y aquí se exige.
    if (args.tipo === "guirnalda") {
      if (!args.paleta) {
        ctx.addIssue({ code: "custom", path: ["paleta"], message: "Una guirnalda se arma con su paleta: un color por material, con su acabado y su papel." });
      }
      return;
    }
    if (!args.patron) {
      ctx.addIssue({ code: "custom", path: ["patron"], message: "Un arco o una columna necesitan el id de un patrón de consultar_opciones_armado." });
    }
    if (!args.materiales) {
      ctx.addIssue({ code: "custom", path: ["materiales"], message: "Un arco o una columna necesitan los índices de material que usa el patrón." });
    }
  });

export type ArgsArmarEstructura = z.infer<typeof ArgsArmarEstructuraSchema>;

/** Los pares clave/valor como el mapa que viaja a Python. Un par repetido: gana el último, como un objeto. */
export function opcionesDePares(pares: readonly { clave: string; valor: number }[] | undefined): Record<string, number> | undefined {
  if (!pares || pares.length === 0) return undefined;
  return Object.fromEntries(pares.map((par) => [par.clave, par.valor]));
}

/** Los errores de Zod en el formato que ya usan los demás resultados de herramienta. */
export function erroresDeArgs(error: z.ZodError, raiz: string): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || raiz}: ${issue.message}`);
}
