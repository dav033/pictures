import type { NodoArmado } from "./escena";
import { FLORES_ARTIFICIALES, type TipoFlorArtificial } from "./flores-artificiales";
import type { Pieza } from "./piezas";

/**
 * Lo que lleva una pieza además de sus globos y que la hoja tiene que nombrar para armarla: las flores artificiales metidas
 * entre los globos y el relleno de un globo burbuja (confeti o plumas). Ninguno de los dos es globo ni pasa por la bomba.
 */

/** Las flores de UNA copia de la pieza, por tipo (de la más numerosa a la menos). */
export type LineaFlor = { tipo: TipoFlorArtificial; nombre: string; cantidad: number };

export function floresDeUnidad(nodo: NodoArmado): LineaFlor[] {
  if (nodo.copias <= 0 || !nodo.flores.length) return [];
  const cuenta = new Map<TipoFlorArtificial, number>();
  for (const f of nodo.flores) cuenta.set(f.tipo, (cuenta.get(f.tipo) ?? 0) + 1);
  return [...cuenta.entries()]
    .map(([tipo, n]) => ({ tipo, nombre: FLORES_ARTIFICIALES[tipo].nombre, cantidad: Math.round(n / nodo.copias) }))
    .filter((l) => l.cantidad > 0)
    .sort((a, b) => b.cantidad - a.cantidad);
}

/** «Flores: 12 (8 Rosa, 4 Monstera)». */
export function textoFlores(flores: readonly LineaFlor[]): string {
  const total = flores.reduce((s, f) => s + f.cantidad, 0);
  return `Flores: ${total} (${flores.map((f) => `${f.cantidad} ${f.nombre}`).join(", ")})`;
}

/**
 * El relleno de un globo burbuja, contado en lo que el armado puso de verdad (los papelitos o plumas de UNA copia): «Relleno:
 * confeti de papel, 40 papelitos». `undefined` si la pieza no es una burbuja rellena.
 */
export function rellenoDe(pieza: Pieza | undefined, nodo: NodoArmado): string | undefined {
  if (pieza?.tipo !== "decoracion" || pieza.decoracion.tipo !== "burbuja") return undefined;
  const relleno = pieza.decoracion.propiedades.relleno;
  if (!relleno || nodo.copias <= 0) return undefined;
  const cantidad = Math.round(nodo.tubos.filter((t) => t.papel?.relleno).length / nodo.copias);
  if (!cantidad) return undefined;
  const colores = new Set(relleno.colores).size;
  const enColores = colores > 1 ? ` en ${colores} colores` : "";
  return relleno.tipo === "confeti"
    ? `Relleno: confeti de papel, ${cantidad} ${cantidad === 1 ? "papelito" : "papelitos"}${enColores}`
    : `Relleno: ${cantidad} ${cantidad === 1 ? "pluma" : "plumas"}${enColores}`;
}
