import { FORMATOS_GLOBO } from "@/lib/globos3d/formatos";
import { MODULOS, armarModulo, moduloPorId, type TipoModulo, type Vec3 } from "@/lib/globos3d/modulos";

/**
 * Las simetrías de un módulo, sacadas de su geometría y no escritas a mano.
 *
 * Dos configuraciones de color son el mismo módulo si una sale de la otra moviendo el módulo como un objeto rígido
 * (girarlo, voltearlo) o mirándolo en un espejo (un globo no tiene lado derecho ni izquierdo). Eso es una isometría
 * de las direcciones nudo → cuerpo que arma `armarModulo`: los cuerpos están todos a la misma distancia del centro,
 * así que dos colocaciones coinciden exactamente cuando se conservan los productos escalares entre cada par de
 * direcciones. Se prueban las `n!` permutaciones (n ≤ 6: 720) y se quedan las que conservan todos los productos.
 * Con ello salen, sin suponer nada, el grupo del dúo (intercambiar los dos), del trío (las 6 del triángulo), del
 * cuarteto (las 8 de las dos parejas cruzadas) y el del quinteto, que es más pobre porque `armarModulo` alterna
 * arriba/abajo con `i % 2` y con cinco globos el 4 y el 0 quedan los dos arriba (solo el espejo que los cambia).
 */

const TOLERANCIA = 1e-6;

const producto = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

function permutaciones(n: number): number[][] {
  if (n <= 1) return [Array.from({ length: n }, (_, i) => i)];
  const resto = permutaciones(n - 1);
  const salida: number[][] = [];
  for (const p of resto) for (let posicion = 0; posicion <= p.length; posicion++) salida.push([...p.slice(0, posicion), n - 1, ...p.slice(posicion)]);
  return salida;
}

/** Las direcciones de los globos tal como las coloca el motor. No dependen del tamaño: se arma con el R-12 de referencia. */
function direccionesDe(tipo: TipoModulo): Vec3[] {
  const modulo = moduloPorId(tipo);
  const formato = FORMATOS_GLOBO.find((f) => f.id === "R-12");
  if (!modulo || !formato) throw new Error(`Módulo desconocido: ${tipo}`);
  return armarModulo(modulo, formato, formato.infladoDecoracionCm).globos.map((g) => g.direccion);
}

/**
 * Las permutaciones `p` (incluida la identidad) que dejan el módulo igual: el globo de la posición `i` pasa a la `p[i]`.
 * Es un grupo, así que sirve igual leída al revés (`p` o su inversa) para escoger el representante canónico.
 */
function calcularSimetrias(tipo: TipoModulo): readonly (readonly number[])[] {
  const d = direccionesDe(tipo);
  const n = d.length;
  const gram = d.map((a) => d.map((b) => producto(a, b)));
  return permutaciones(n).filter((p) => {
    for (let i = 0; i < n; i++) for (let j = i; j < n; j++) if (Math.abs(gram[p[i]!]![p[j]!]! - gram[i]![j]!) > TOLERANCIA) return false;
    return true;
  });
}

const CACHE = new Map<TipoModulo, readonly (readonly number[])[]>();

export function simetriasDeModulo(tipo: TipoModulo): readonly (readonly number[])[] {
  const hecha = CACHE.get(tipo);
  if (hecha) return hecha;
  const nueva = calcularSimetrias(tipo);
  CACHE.set(tipo, nueva);
  return nueva;
}

/** Cuántos globos tiene cada tipo (para validar y expandir sin importar `MODULOS` en cada sitio). */
export const GLOBOS_POR_TIPO: Readonly<Record<TipoModulo, number>> = Object.fromEntries(MODULOS.map((m) => [m.id, m.globos])) as Record<TipoModulo, number>;

/**
 * La forma canónica de una lista de colores (un código por globo, en el orden de `armarModulo`): de todas las que
 * da el grupo de simetrías, la menor por orden de texto. Dos listas equivalentes dan la misma.
 */
export function coloresCanonicos(tipo: TipoModulo, codigos: readonly string[]): string[] {
  const n = GLOBOS_POR_TIPO[tipo];
  if (codigos.length !== n) throw new Error(`${tipo} lleva ${n} globos y llegaron ${codigos.length} colores.`);
  let mejor: string[] | null = null;
  let mejorTexto = "";
  for (const p of simetriasDeModulo(tipo)) {
    const candidata = p.map((i) => codigos[i]!);
    const texto = candidata.join("_");
    if (mejor === null || texto < mejorTexto) { mejor = candidata; mejorTexto = texto; }
  }
  return mejor ?? [...codigos];
}
