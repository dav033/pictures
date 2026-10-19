import { formatoPorId } from "./formatos";
import type { PiezaArmada } from "./piezas";

/**
 * **Partes y selección de globos** (contrato común, 2026-10-08): cada globo y tubito armado lleva su `formatoId`, su
 * `codigo` de color y su `parte` (ver `GloboDecoracion.parte`). Sobre eso:
 * - `inventarioDe`: lo que tiene una pieza, por parte → formato → color, con cantidades (lo que la IA «ve» por dentro);
 * - `SelectorGlobos` y `coincide`: a qué globos se refiere un pedido («los link-o-loon de las ramas», «los R-24 azules»):
 *   formatos exactos («R-24») o por familia («LOL-*», «T-*», «R-*»), partes (prefijo: «copa» vale para «copa/frutas»),
 *   colores (códigos). Todo lo que falte no filtra.
 * Lo que traduce las palabras del usuario a esto (el glosario) y lo que edita los datos de la pieza según el selector
 * viven aparte; aquí solo el contrato y lo que se calcula del armado.
 */
export type SelectorGlobos = {
  /** Formatos: exactos («R-24», «LOL-12», «T-260») o familia con «*» («LOL-*», «T-*», «R-*», «C-*»). */
  formatos?: readonly string[];
  /** Partes: «ramas», «copa», «copa/frutas»… (una parte vale para sus subpartes). */
  partes?: readonly string[];
  /** Códigos de color Sempertex. */
  colores?: readonly string[];
};

export type ElementoSeleccionable = { formatoId: string; codigo: string; parte?: string };

export const SIN_PARTE = "general";

const coincideFormato = (formatoId: string, patron: string) => {
  const p = patron.trim().toUpperCase();
  return p.endsWith("*") ? formatoId.toUpperCase().startsWith(p.slice(0, -1)) : formatoId.toUpperCase() === p;
};
const coincideParte = (parte: string | undefined, patron: string) => {
  const actual = (parte ?? SIN_PARTE).toLowerCase(), p = patron.trim().toLowerCase();
  return actual === p || actual.startsWith(`${p}/`);
};

export function coincide(e: ElementoSeleccionable, s: SelectorGlobos): boolean {
  if (s.formatos?.length && !s.formatos.some((f) => coincideFormato(e.formatoId, f))) return false;
  if (s.partes?.length && !s.partes.some((p) => coincideParte(e.parte, p))) return false;
  if (s.colores?.length && !s.colores.includes(e.codigo)) return false;
  return true;
}

export type LineaInventario = { parte: string; formatoId: string; codigo: string; cantidad: number; tubito: boolean };

/** Lo que tiene una pieza armada: una línea por parte × formato × color (los tubitos cuentan uno por tramo). */
export function inventarioDe(armada: Pick<PiezaArmada, "globos" | "tubos">): LineaInventario[] {
  const mapa = new Map<string, LineaInventario>();
  const sumar = (e: ElementoSeleccionable, tubito: boolean) => {
    const parte = e.parte ?? SIN_PARTE;
    const clave = `${parte}|${e.formatoId}|${e.codigo}`;
    const l = mapa.get(clave) ?? { parte, formatoId: e.formatoId, codigo: e.codigo, cantidad: 0, tubito };
    l.cantidad += 1;
    mapa.set(clave, l);
  };
  for (const g of armada.globos) sumar(g, formatoPorId(g.formatoId)?.tipo === "tubito");
  for (const t of armada.tubos) if (!t.papel) sumar(t, true);
  return [...mapa.values()].sort((a, b) => a.parte.localeCompare(b.parte) || b.cantidad - a.cantidad);
}

/** Cuántos globos de una pieza armada caen en un selector (para verificar antes/después). */
export function contar(armada: Pick<PiezaArmada, "globos" | "tubos">, s: SelectorGlobos): number {
  return armada.globos.filter((g) => coincide(g, s)).length + armada.tubos.filter((t) => !t.papel && coincide(t, s)).length;
}
