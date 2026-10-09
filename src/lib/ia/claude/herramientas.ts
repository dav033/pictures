import type { Herramienta } from "@sempertex/agente-core";
import type { HerramientaAnthropic } from "./tipos";

/**
 * Herramientas → formato de Anthropic (`tools[]`), con los mismos nombres y argumentos que ve Gemini: zod sigue siendo la
 * fuente de verdad (el esquema llega ya exportado a JSON Schema y cada llamada se valida con zod al aplicarse).
 * - Sin `strict`: la escena tiene más de 20 herramientas y muchos opcionales (límites de strict, NOTES.md §3).
 * - `cache_control` en la ÚLTIMA herramienta: cachea toda la lista (va primero en el prefijo: tools → system → messages).
 */

/** Una declaración en la forma de Gemini (`functionDeclarations`), como `DECLARACIONES_ESCENA`. */
export type DeclaracionGemini = { name: string; description: string; parametersJsonSchema: Record<string, unknown> };

/** Regla de nombres de la API (define-tools). */
export const NOMBRE_HERRAMIENTA_VALIDO = /^[a-zA-Z0-9_-]{1,128}$/;

export function herramientaDeDeclaracion(declaracion: DeclaracionGemini): Herramienta {
  return { nombre: declaracion.name, descripcion: declaracion.description, esquema: declaracion.parametersJsonSchema };
}

/** `input_schema` tiene que ser un objeto: se quita solo el `$schema` de la raíz (lo demás es JSON Schema válido). */
function esquemaDeEntrada(nombre: string, esquema: Record<string, unknown>): Record<string, unknown> {
  const resto: Record<string, unknown> = { ...esquema };
  delete resto.$schema;
  if (resto.type === undefined) return { type: "object", properties: {}, ...resto };
  if (resto.type !== "object") throw new Error(`La herramienta ${nombre} no recibe un objeto (type: ${String(resto.type)}).`);
  return resto;
}

export function herramientasAnthropic(herramientas: readonly Herramienta[]): HerramientaAnthropic[] {
  return herramientas.map((herramienta, indice) => {
    if (!NOMBRE_HERRAMIENTA_VALIDO.test(herramienta.nombre)) throw new Error(`Nombre de herramienta no válido para Anthropic: «${herramienta.nombre}».`);
    return {
      name: herramienta.nombre,
      description: herramienta.descripcion,
      input_schema: esquemaDeEntrada(herramienta.nombre, herramienta.esquema),
      ...(indice === herramientas.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
    };
  });
}
