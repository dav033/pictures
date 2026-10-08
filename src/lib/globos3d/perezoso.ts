/**
 * Memoriza un cálculo: se hace la primera vez que se pide y después se devuelve el mismo resultado. Para todo lo caro
 * que un módulo ofrecería «ya calculado» al importarse (escenas, piezas armadas, miniaturas): importar /3d o la
 * biblioteca no puede armar nada (ver el patrón perezoso de `ideas-sempertex/tipos.ts` y `scripts/test/test-carga-3d.ts`).
 */
export function perezoso<T>(calcular: () => T): () => T {
  let hecho: { valor: T } | null = null;
  return () => (hecho ??= { valor: calcular() }).valor;
}
