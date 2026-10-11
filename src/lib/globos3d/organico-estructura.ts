import { formatoPorId, infladoValido } from "./formatos";
import { estructuraPorCm, interpolarGrosor, largoRecorrido, mezclaEn } from "./organico-geometria";
import type { OpcionesOrganico, TramoOrganico } from "./organico";

/**
 * **Cuántos globos de estructura pide una mezcla, sin armar la pieza.** El empaque (`organico.ts`) decide primero, solo con las medidas
 * del cuerpo y los pesos de la mezcla, cuántos globos de cada formato lleva la estructura de cada tramo; después los coloca (lo caro:
 * crece con el cuadrado de los globos) y el relleno tapa los huecos. Lo primero se puede contar sin colocar nada: es lo que usa
 * `ajustar_tamanos` para buscar la mezcla que da la meta (armando solo la elegida) y el presupuesto de armado para no dejar armar un cuerpo de
 * miles de globos chicos (`presupuesto-cuerpo.ts`).
 *
 * La cuenta es la del empaque: la misma función (`perfilDeEstructura`) la saca allá y aquí. Solo cuenta la estructura: los globos que
 * no cupieron sin montarse (`sinCupo`) y el relleno de huecos (que sí puede ser del mismo formato) los pone el empaque al colocar.
 */

/** El inflado (cm) con que entra el formato en el empaque, o `null` si no es un redondo modelado (se quita de la mezcla). */
export function infladoNominal(opciones: Pick<OpcionesOrganico, "inflados">, formatoId: string): number | null {
  const f = formatoPorId(formatoId);
  if (!f || f.tipo !== "redondo") return null;
  return infladoValido(f, opciones.inflados?.[formatoId] ?? f.infladoDecoracionCm);
}

/** Los globos de estructura de un tramo, centímetro a centímetro: lo acumulado por formato (el último valor es su total) y el total del tramo. */
export type PerfilEstructura = { acumulados: Map<string, number[]>; total: number };

/**
 * Globos de estructura por centímetro de recorrido: en cada uno, la densidad entre lo que consume cada formato de la mezcla (media armónica
 * ponderada, ver `estructuraPorCm`) repartida por sus pesos. `formatoValido` registra los formatos de la mezcla que se pueden usar (en
 * `nominal`, que se recorre al final: todos los formatos pedidos de cualquier tramo, aunque este no los use).
 */
export function perfilDeEstructura(def: TramoOrganico, largo: number, nominal: Map<string, number>, densidad: number, formatoValido: (id: string) => boolean): PerfilEstructura {
  const ds = 1;
  const acumulados = new Map<string, number[]>();
  let total = 0;
  for (let s = 0; s < largo; s += ds) {
    const t = (s + ds / 2) / largo;
    const pesos = [...mezclaEn(def.mezcla, t)].filter(([id]) => formatoValido(id));
    const R = interpolarGrosor(def.grosor, t);
    const consumo = pesos.reduce((acc, [id, w]) => acc + w / estructuraPorCm(nominal.get(id)!, R), 0);
    const n = consumo > 0 ? (densidad * (def.densidad ?? 1)) / consumo : 0;
    total += n * ds;
    for (const [id] of nominal) {
      const w = pesos.find(([x]) => x === id)?.[1] ?? 0;
      const lista = acumulados.get(id) ?? [];
      lista.push((lista[lista.length - 1] ?? 0) + n * w * ds);
      acumulados.set(id, lista);
    }
  }
  return { acumulados, total };
}

export type CuentaEstructura = {
  /** Globos de estructura del formato (dentro de la zona, si se pidió). */
  cantidad: number;
  /** Globos de estructura de todos los formatos (en la zona). */
  estructura: number;
};

type Contable = Pick<OpcionesOrganico, "tramos" | "densidad" | "inflados">;
/** Un globo por su tramo y la fracción de su recorrido (lo que decide una zona, `zonas-organicas.ts`). */
export type SitioDeGlobo = { tramo: string; fraccion: number };

/**
 * Los globos de estructura que el empaque pide al formato (y a toda la mezcla), contados sin armar. Con `dentro`, solo los que caen en
 * esa zona: se cuenta la parte del recorrido que la cumple (cada centímetro es un sitio), así que en una zona el número es el esperado
 * de lo que el empaque reparte a lo largo, con menos de un globo de diferencia por tramo.
 */
export function contarEstructura(o: Contable, formato: string, dentro?: (g: SitioDeGlobo) => boolean): CuentaEstructura {
  const nominal = new Map<string, number>();
  const formatoValido = (id: string): boolean => {
    if (nominal.has(id)) return true;
    const inflado = infladoNominal(o, id);
    if (inflado === null) return false;
    nominal.set(id, inflado);
    return true;
  };
  for (const tramo of o.tramos) for (const p of tramo.mezcla) for (const [id, w] of Object.entries(p.pesos)) if (w > 0) formatoValido(id);
  let cantidad = 0, estructura = 0;
  for (const def of o.tramos) {
    const largo = largoRecorrido(def.recorrido);
    const { acumulados } = perfilDeEstructura(def, largo, nominal, o.densidad ?? 1, formatoValido);
    const largos = [...acumulados.values()][0]?.length ?? 0;
    const sitios = dentro ? Array.from({ length: largos }, (_, k) => dentro({ tramo: def.id, fraccion: Math.min(1, (k + 0.5) / largo) })) : null;
    for (const [id, acumulado] of acumulados) {
      const masa = sitios
        ? acumulado.reduce((suma, valor, k) => (sitios[k] ? suma + valor - (acumulado[k - 1] ?? 0) : suma), 0)
        : acumulado[acumulado.length - 1] ?? 0;
      const globos = Math.round(masa);
      estructura += globos;
      if (id === formato) cantidad += globos;
    }
  }
  return { cantidad, estructura };
}

/** Todos los globos de estructura de la pieza, contados sin armar. */
export const globosDeEstructura = (o: Contable): number => contarEstructura(o, "").estructura;
