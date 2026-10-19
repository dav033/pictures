import { coloresDelFormato } from "./formatos";

/**
 * Cambiar un color en todo un montaje de una vez: recorre cualquier dato del taller (pared, mezcla de
 * decoraciones, decoración suelta, ajustes del orgánico) y cambia el código `de` por `a` donde aparezca:
 * - `codigo: "…"` de una parte (con su `formatoId` al lado, o sin él);
 * - listas `codigos` y `colores` (los colores pétalo a pétalo, los de la pared, …).
 * Solo cambia donde el color nuevo se fabrica en ese formato; los formatos donde no existe se devuelven en
 * `omitidos` (p. ej. un color que no viene en T-260 deja los tubitos como estaban) para avisarlo en pantalla.
 */
export type Recoloreado<T> = { valor: T; cambios: number; omitidos: string[] };

const existe = (formatoId: string, codigo: string) => coloresDelFormato(formatoId).some((c) => c.codigo === codigo);

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Los formatos que aplican a un objeto: el suyo, o los de su globo grande y chico (pared de trenzas). */
function formatosDe(o: Record<string, unknown>): string[] {
  const propios = typeof o.formatoId === "string" ? [o.formatoId] : [];
  const anidados = ["grande", "chico"].flatMap((k) => {
    const v = o[k];
    return esObjeto(v) && typeof v.formatoId === "string" ? [v.formatoId] : [];
  });
  return [...propios, ...anidados];
}

export function reemplazarColor<T>(valor: T, de: string, a: string): Recoloreado<T> {
  let cambios = 0;
  const omitidos = new Set<string>();
  const sePuede = (formatos: string[]) => {
    const faltan = formatos.filter((f) => !existe(f, a));
    faltan.forEach((f) => omitidos.add(f));
    return faltan.length === 0;
  };
  const recorrer = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(recorrer);
    if (!esObjeto(v)) return v;
    const formatos = formatosDe(v);
    const salida: Record<string, unknown> = {};
    for (const [clave, x] of Object.entries(v)) {
      if (clave === "codigo" && x === de && de !== a) {
        if (sePuede(formatos)) { salida[clave] = a; cambios += 1; } else salida[clave] = x;
      } else if ((clave === "codigos" || clave === "colores") && Array.isArray(x) && x.some((c) => c === de) && de !== a) {
        if (sePuede(formatos)) { salida[clave] = x.map((c) => (c === de ? a : c)); cambios += 1; } else salida[clave] = x;
      } else {
        salida[clave] = recorrer(x);
      }
    }
    return salida;
  };
  return { valor: recorrer(valor) as T, cambios, omitidos: [...omitidos] };
}

/** Los colores que usa un montaje, de más a menos globos, con sus formatos. */
export function coloresUsados(materiales: ReadonlyArray<{ formatoId: string; codigo: string; cantidad: number }>): Array<{ codigo: string; cantidad: number; formatos: string[] }> {
  const mapa = new Map<string, { codigo: string; cantidad: number; formatos: string[] }>();
  for (const m of materiales) {
    const actual = mapa.get(m.codigo) ?? { codigo: m.codigo, cantidad: 0, formatos: [] };
    actual.cantidad += m.cantidad;
    if (!actual.formatos.includes(m.formatoId)) actual.formatos.push(m.formatoId);
    mapa.set(m.codigo, actual);
  }
  return [...mapa.values()].sort((x, y) => y.cantidad - x.cantidad);
}
