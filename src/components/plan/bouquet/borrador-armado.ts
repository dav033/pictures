import type { ArmadoBouquetV1 } from "@/lib/plan/armado-bouquet";

/**
 * Ediciones del armado DECLARATIVO que arma el editor: intercambiar dos
 * globos de sitio. Es una permutación pura de índices de material: nunca
 * cambia cuántos globos de cada color lleva el bouquet, así que no hay regla
 * de conteo aquí. Todo lo demás (niveles, remate, dónde van los números) lo
 * arma y lo valida Python en la vista previa (ADR-0030). Puro: sin React.
 */

/** Un globo del armado: uno de una unidad de un nivel, uno del remate o un número. */
export type Posicion = { nivel: number; unidad: number; globo: number } | { remate: number } | { digito: number };

/** JSON con las claves ordenadas: el eco de Python puede traerlas en otro orden. */
function jsonEstable(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(jsonEstable).join(",")}]`;
  if (valor && typeof valor === "object") {
    const entradas = Object.entries(valor as Record<string, unknown>).filter(([, campo]) => campo !== undefined).sort(([a], [b]) => a.localeCompare(b));
    return `{${entradas.map(([clave, campo]) => `${JSON.stringify(clave)}:${jsonEstable(campo)}`).join(",")}}`;
  }
  return JSON.stringify(valor);
}

export function claveArmado(armado: ArmadoBouquetV1): string {
  return jsonEstable(armado);
}

/** Mismo armado aunque cambie quién lo firmó (`origen`). */
export function mismoArmado(a: ArmadoBouquetV1 | null, b: ArmadoBouquetV1 | null): boolean {
  if (!a || !b) return a === b;
  return jsonEstable({ ...a, origen: null }) === jsonEstable({ ...b, origen: null });
}

export function mismaPosicion(a: Posicion, b: Posicion): boolean {
  return jsonEstable(a) === jsonEstable(b);
}

/** Los números solo cambian de sitio entre sí; el resto, entre sí. */
function esDigito(posicion: Posicion): boolean {
  return "digito" in posicion;
}

/** Índice de material en esa posición del armado; `undefined` si no existe. */
export function indiceEn(armado: ArmadoBouquetV1, posicion: Posicion): number | undefined {
  if ("digito" in posicion) return armado.numero?.digitos[posicion.digito];
  if ("remate" in posicion) return armado.remate?.[posicion.remate];
  return armado.niveles[posicion.nivel]?.posiciones[posicion.globo];
}

function conIndice(armado: ArmadoBouquetV1, posicion: Posicion, indice: number): ArmadoBouquetV1 {
  if ("digito" in posicion) {
    if (!armado.numero) return armado;
    return { ...armado, numero: { ...armado.numero, digitos: armado.numero.digitos.map((actual, i) => (i === posicion.digito ? indice : actual)) } };
  }
  if ("remate" in posicion) {
    if (!armado.remate) return armado;
    return { ...armado, remate: armado.remate.map((actual, i) => (i === posicion.remate ? indice : actual)) };
  }
  return {
    ...armado,
    niveles: armado.niveles.map((nivel, n) => (n === posicion.nivel ? { ...nivel, posiciones: nivel.posiciones.map((actual, g) => (g === posicion.globo ? indice : actual)) } : nivel)),
  };
}

/**
 * El armado con los globos de `a` y `b` intercambiados, firmado por el
 * decorador. `null` si no hay nada que cambiar (misma posición, mismo
 * material, una posición que no existe) o si se mezcla un número con un globo.
 * Las `cantidad` unidades de un nivel son iguales: cambiar un globo de una
 * unidad las cambia todas.
 */
export function intercambiar(armado: ArmadoBouquetV1, a: Posicion, b: Posicion): ArmadoBouquetV1 | null {
  if (mismaPosicion(a, b) || esDigito(a) !== esDigito(b)) return null;
  const indiceA = indiceEn(armado, a);
  const indiceB = indiceEn(armado, b);
  if (indiceA === undefined || indiceB === undefined || indiceA === indiceB) return null;
  return { ...conIndice(conIndice(armado, a, indiceB), b, indiceA), origen: "decorador" };
}

/** Si dos posiciones se pueden intercambiar entre sí (los números solo con números). */
export function intercambiables(a: Posicion, b: Posicion): boolean {
  return !mismaPosicion(a, b) && esDigito(a) === esDigito(b);
}
