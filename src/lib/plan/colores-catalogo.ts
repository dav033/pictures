import { clasificarColores } from "@/lib/rag/taxonomy/v2";
import type { PlanDecoracion } from "./tipos";

/**
 * El catálogo guarda colores canónicos gruesos (`azul`, `rosado`, `dorado`) y
 * los resolvers (TypeScript y Python) comparan el color del material de forma
 * literal contra esos valores. El modelo escribe el color con las palabras del
 * cliente ("azul rey", "rosa"), así que ninguna variante coincidía y el plan
 * quedaba SIN_COBERTURA en todos los tamaños, en bucle (A6,
 * docs/mejoras/PLAN-ESTRUCTURAS-Y-UX.md).
 *
 * La taxonomía de colores (`clasificarColores`) es la dueña de los sinónimos;
 * esto la aplica una vez, en la frontera, antes de validar y resolver. El tono
 * concreto lo sigue fijando el producto elegido ("Fashion Azul Rey"): el color
 * solo filtra variantes dentro de ese producto. Un color desconocido o que
 * nombra varios colores se deja tal cual.
 */
export function colorDeCatalogo(color: string): string {
  const clasificacion = clasificarColores(color);
  return clasificacion.status === "known" && clasificacion.values.length === 1 ? clasificacion.values[0]! : color;
}

export type ColorNormalizado = { original: string; catalogo: string };

export function canonizarColoresPlan(plan: PlanDecoracion): { plan: PlanDecoracion; cambios: ColorNormalizado[] } {
  const cambios = new Map<string, string>();
  const canonizar = <T extends { color?: string }>(item: T): T => {
    if (!item.color) return item;
    const catalogo = colorDeCatalogo(item.color);
    if (catalogo === item.color) return item;
    cambios.set(item.color, catalogo);
    return { ...item, color: catalogo };
  };
  const estructuras = plan.estructuras.map((estructura) => ({
    ...estructura,
    materiales: estructura.materiales.map(canonizar),
    ...(estructura.variant_overrides ? { variant_overrides: estructura.variant_overrides.map(canonizar) } : {}),
  }));
  return {
    plan: { ...plan, estructuras },
    cambios: [...cambios.entries()].map(([original, catalogo]) => ({ original, catalogo })),
  };
}
