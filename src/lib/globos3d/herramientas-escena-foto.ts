import { z } from "zod";
import { fallar } from "./herramientas-escena-colores";
import type { HerramientaExtra } from "./herramientas-escena-grupos";

/**
 * **modelar_desde_foto**: la herramienta con que el agente de escena arma la escena a partir de la foto que el usuario
 * adjuntó en la barra de la IA (REQ-001 paso 8). La lectura de la foto y su compilación a escena las hace la ruta
 * (`/api/escena-ia`, con `modelar-desde-foto.ts`) antes de que el modelo hable; esta herramienta solo decide cómo se
 * aplica: `reemplazar` (la sala queda como la foto) o `sumar` (se agrega a lo que hay). Con la sala vacía la ruta ya la
 * aplicó. La ruta la atiende ella misma (necesita la foto leída), y solo se la ofrece al modelo cuando hay foto: aquí,
 * sin foto, contesta que no hay nada que modelar.
 */

export const MODELAR_DESDE_FOTO = "modelar_desde_foto";

export const ModelarDesdeFotoSchema = z.object({
  modo: z.enum(["reemplazar", "sumar"]).describe("reemplazar: la escena queda como la foto (sala incluida); sumar: las piezas de la foto se agregan a las que ya hay"),
});

export const HERRAMIENTA_FOTO: HerramientaExtra = {
  esquema: ModelarDesdeFotoSchema,
  descripcion: "Arma en la escena lo que se leyó de la foto adjunta (piezas, colores, medidas y posiciones ya calculados). modo «reemplazar» rehace la sala como la foto; «sumar» agrega sus piezas a las que hay. Solo existe cuando el mensaje trae una foto, y solo hace falta si la sala no estaba vacía (con la sala vacía ya se armó sola). Después corrige diferencias con las demás herramientas.",
  aplicar: () => fallar("No hay foto adjunta en este mensaje: no hay nada que modelar."),
};
