import { FORMATOS_ORGANICOS, fallar, formatosOrganicosDe } from "./herramientas-escena-colores";
import { INFLADOS_ORGANICOS } from "./estructuras-organicas";
import { RELLENO_TUPIDO, type ColorOrganico, type OpcionesOrganico, type PuntoMezcla, type RellenoOrganico } from "./organico";
import { medirTramos } from "./presupuesto-cuerpo";

/**
 * **Los tamaños de globo de una pieza orgánica nueva** (columna, guirnalda, semiarco, aro, marco): cuáles se usan de verdad según los colores y el
 * grosor, la mezcla y el relleno que dejan, y la medida del cuerpo con ellos (un cuerpo de solo R-5 lleva muchos más globos que uno de R-24:
 * `presupuesto-cuerpo.ts`).
 */

const r0 = (n: number) => Math.round(n);

/** Los tamaños que de verdad se pueden usar: los pedidos (o todos) en los que se fabrica algún color de la paleta. */
export function tamanosPosibles(colores: readonly ColorOrganico[], tamanos: readonly string[] | undefined, maximoInfladoCm = Infinity): string[] {
  const pedidos = tamanos?.length ? tamanos.map((t) => t.trim().toUpperCase()) : [...FORMATOS_ORGANICOS];
  for (const t of pedidos) if (!(FORMATOS_ORGANICOS as readonly string[]).includes(t)) fallar(`El tamaño «${t}» no es de la técnica orgánica: usa ${FORMATOS_ORGANICOS.join(", ")}.`);
  const conColor = pedidos.filter((f) => colores.some((c) => (c.formatos ?? formatosOrganicosDe(c.codigo)).includes(f)));
  if (!conColor.length) fallar(`Ningún color de la paleta se fabrica en ${pedidos.join(", ")}.`);
  // Sin tamaños pedidos, lo que no cabe en el grosor no se usa (un R-24 en una columna de 40 cm).
  const caben = tamanos?.length ? conColor : conColor.filter((f) => (INFLADOS_ORGANICOS[f] ?? 0) <= maximoInfladoCm);
  if (caben.length) return caben;
  // Nada cabe: los dos más chicos que haya.
  return [...conColor].sort((a, b) => (INFLADOS_ORGANICOS[a] ?? 0) - (INFLADOS_ORGANICOS[b] ?? 0)).slice(0, 2);
}

export function mezclaCon(mezcla: readonly PuntoMezcla[], permitidos: readonly string[]): PuntoMezcla[] {
  return mezcla.map((p) => {
    const pesos = Object.fromEntries(Object.entries(p.pesos).filter(([f, w]) => permitidos.includes(f) && w > 0));
    if (Object.keys(pesos).length) return { t: p.t, pesos };
    const grandes = permitidos.filter((f) => f !== "R-5");
    return { t: p.t, pesos: Object.fromEntries((grandes.length ? grandes : permitidos).map((f) => [f, 1])) };
  });
}

/** La medida por grosor de una pieza nueva con los tamaños que de verdad lleva (`permitidos`): un cuerpo de solo R-5 lleva muchos más globos que uno de R-24. */
export const medidaConTamanos = (opcionesDe: (grosorCm: number) => Pick<OpcionesOrganico, "tramos" | "densidad" | "inflados">, permitidos: readonly string[]) =>
  medirTramos((g) => { const o = opcionesDe(g); return { ...o, tramos: o.tramos.map((t) => ({ ...t, mezcla: mezclaCon(t.mezcla, permitidos) })) }; });
/** Con lo que `piezaOrganica` arma un tramo suelto. */
export const BASE_TRAMOS = { inflados: INFLADOS_ORGANICOS, densidad: 1 } as const;

export function rellenoCon(permitidos: readonly string[]): RellenoOrganico[] {
  const r = RELLENO_TUPIDO.filter((x) => permitidos.includes(x.formatoId)).map((x) => ({ ...x }));
  if (r.length) return r;
  const menor = [...permitidos].sort((a, b) => (INFLADOS_ORGANICOS[a] ?? 0) - (INFLADOS_ORGANICOS[b] ?? 0))[0];
  return menor ? [{ formatoId: menor, infladoCm: r0((INFLADOS_ORGANICOS[menor] ?? 20) * 0.88), trios: false }] : [];
}
