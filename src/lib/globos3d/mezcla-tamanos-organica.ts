import { avisar } from "./avisos-usuario";
import { FORMATOS_ORGANICOS, fallar, formatosOrganicosDe } from "./herramientas-escena-colores";
import { INFLADOS_ORGANICOS } from "./estructuras-organicas";
import { RELLENO_TUPIDO, type ColorOrganico, type OpcionesOrganico, type PuntoMezcla, type RellenoOrganico } from "./organico";
import { formatoPorId } from "./formatos";
import { medirTramos } from "./presupuesto-cuerpo";
import { compensarRellenoMediano } from "./relleno-compensado";

/**
 * **Los tamaños de globo de una pieza orgánica nueva** (columna, guirnalda, semiarco, aro, marco): cuáles se usan de verdad según los colores y el
 * grosor, la mezcla y el relleno que dejan, y la medida del cuerpo con ellos (un cuerpo de solo R-5 lleva muchos más globos que uno de R-24:
 * `presupuesto-cuerpo.ts`).
 */

const r0 = (n: number) => Math.round(n);

/**
 * Los tamaños que de verdad se pueden usar: los pedidos (o todos) en los que se fabrica algún color de la paleta. Un tamaño que se pidió y en el que
 * ningún color se fabrica (el R-24 en un verde Fashion) se quita, y se avisa en `notas`: la pieza no lleva lo que la persona pidió.
 */
export function tamanosPosibles(colores: readonly ColorOrganico[], tamanos: readonly string[] | undefined, maximoInfladoCm = Infinity, notas?: string[]): string[] {
  const pedidos = tamanos?.length ? tamanos.map((t) => t.trim().toUpperCase()) : [...FORMATOS_ORGANICOS];
  for (const t of pedidos) if (!(FORMATOS_ORGANICOS as readonly string[]).includes(t)) fallar(`El tamaño «${t}» no es de la técnica orgánica: usa ${FORMATOS_ORGANICOS.join(", ")}.`);
  const conColor = pedidos.filter((f) => colores.some((c) => (c.formatos ?? formatosOrganicosDe(c.codigo)).includes(f)));
  if (!conColor.length) fallar(`Ningún color de la paleta se fabrica en ${pedidos.join(", ")}.`);
  const sinColor = pedidos.filter((f) => !conColor.includes(f));
  if (notas && tamanos?.length && sinColor.length) {
    avisar(notas, `Pediste ${sinColor.join(" y ")}, pero ningún color de la paleta se fabrica en ${sinColor.length > 1 ? "esos tamaños" : "ese tamaño"}: la pieza lleva solo ${conColor.join(", ")}.`, "no se fabrica");
  }
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

const infladoDe = (f: string) => INFLADOS_ORGANICOS[f] ?? 0;

/**
 * El relleno de una pieza cuyos colores no se fabrican en R-9 (13 de ~80 códigos: 056, 909, 932...): el hueco de 18 cm que tapaba el R-9 lo tapa, **después** de los
 * tríos de R-5 (que siguen llenando primero, así que el conteo nunca baja), el R-12 desinflado a esos 18 cm, que sigue dentro del 40 % que admite el formato. Un R-18
 * a 18 cm sería un globo medio vacío: si no hay R-12, queda el relleno de siempre. Si algún color sí se fabrica en R-9 (aunque la persona no lo pidiera o el grosor
 * no lo deje), no se sustituye nada. P-087.
 */
export const rellenoCompensadoPara = (colores: readonly ColorOrganico[]) => {
  const conR9 = colores.some((c) => (c.formatos ?? formatosOrganicosDe(c.codigo)).includes("R-9"));
  const rellenoR9 = RELLENO_TUPIDO.find((item) => item.formatoId === "R-9");
  return (permitidos: readonly string[]): RellenoOrganico[] => compensarRellenoMediano(
    rellenoCon(permitidos),
    conR9,
    permitidos.map((formatoId) => ({
      formatoId,
      infladoCm: infladoDe(formatoId),
      diametroMaxCm: formatoPorId(formatoId)?.diametroMaxCm ?? Infinity,
    })),
    infladoDe("R-9"),
    rellenoR9,
  );
};

export function rellenoCon(permitidos: readonly string[]): RellenoOrganico[] {
  const r = RELLENO_TUPIDO.filter((x) => permitidos.includes(x.formatoId)).map((x) => ({ ...x }));
  if (r.length) return r;
  const menor = [...permitidos].sort((a, b) => (INFLADOS_ORGANICOS[a] ?? 0) - (INFLADOS_ORGANICOS[b] ?? 0))[0];
  return menor ? [{ formatoId: menor, infladoCm: r0((INFLADOS_ORGANICOS[menor] ?? 20) * 0.88), trios: false }] : [];
}
