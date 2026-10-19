import { formatoPorId, infladoValido } from "./formatos";
import type { Vec3 } from "./modulos";
import type { GloboFijo, Interno, TamanoOrganico, TramoPreparado } from "./organico";

/**
 * **Los globos fijos del motor orgánico** (`opciones.fijos`: los gigantes y grandes que la foto tiene en un sitio y con un
 * color): se ponen antes que la estructura, por delante del eje del tramo más cercano, y la relajación no los mueve ni se
 * quitan (`fijo`). Cada uno ocupa el sitio de un globo de la estructura: se descuenta del objetivo de su formato PEDIDO
 * (`formatoPedidoId`: el del escalón, no el que dejó el color; un gigante dorado que solo se fabrica en R-24 sigue siendo un
 * gigante y no deja un R-36 de estructura al lado). Dos fijos que se montan más de lo permitido son el mismo globo visto dos
 * veces por la detección: el segundo no se pone.
 */

export type ObjetivoEstructura = { formatoId: string; tramo: number; s: number };

export type ContextoFijos = {
  fijos: readonly GloboFijo[];
  tramos: readonly TramoPreparado[];
  /** Los globos ya colocados; aquí se agregan los fijos. */
  globos: Interno[];
  /** Los globos de estructura que pide la mezcla, por formato (de aquí se descuentan los fijos). */
  objetivos: Map<string, ObjetivoEstructura[]>;
  nominal: ReadonlyMap<string, number>;
  /** Aplastamiento máximo entre dos globos (fracción del diámetro del menor). */
  aplastamientoMaximo: number;
  /** Cm de inflado desde el que un globo es «grande». */
  infladoGrandeCm: number;
  formatoValido: (id: string) => boolean;
  inflar: (id: string) => number;
  proyectar: (tp: TramoPreparado, c: Vec3) => { p: Vec3; s: number };
  radioEn: (tp: TramoPreparado, t: number) => number;
};

/** Pone los fijos y devuelve cuántos no se pusieron por montarse sobre otro fijo. */
export function colocarFijos(ctx: ContextoFijos): { montados: number } {
  const { tramos, globos, objetivos } = ctx;
  let montados = 0;
  for (const f of ctx.fijos) {
    if (!ctx.formatoValido(f.formatoId)) continue;
    const donde: Vec3 = { x: f.x, y: f.y, z: 0 };
    let mejor = { it: 0, m: ctx.proyectar(tramos[0]!, donde), d: Infinity };
    tramos.forEach((tp, it) => {
      const m = ctx.proyectar(tp, donde);
      const d = Math.hypot(m.p.x - donde.x, m.p.y - donde.y, m.p.z - donde.z);
      if (d < mejor.d) mejor = { it, m, d };
    });
    const tp = tramos[mejor.it]!;
    const R = ctx.radioEn(tp, Math.min(1, Math.max(0, mejor.m.s / tp.largo)));
    const d = f.infladoCm ? infladoValido(formatoPorId(f.formatoId)!, f.infladoCm) : ctx.inflar(f.formatoId);
    // Por delante del eje (z > 0, hacia quien mira), lo que deja su radio dentro del cuerpo.
    const z = Math.max(0, Math.sqrt(Math.max(0, R * R - mejor.d * mejor.d)) - d * 0.35);
    const c: Vec3 = { x: f.x, y: f.y, z };
    const repetido = globos.some((g) => g.fijo && (g.r + d / 2 - Math.hypot(g.c.x - c.x, g.c.y - c.y, g.c.z - c.z)) / Math.min(g.d, d) > ctx.aplastamientoMaximo);
    if (repetido) { montados++; continue; }
    const tamano: TamanoOrganico = ctx.nominal.get(f.formatoId)! >= ctx.infladoGrandeCm ? "grande" : "mediano";
    globos.push({ formatoId: f.formatoId, d, r: d / 2, c, tramo: mejor.it, s: mejor.m.s, phi: Math.PI / 2, hundimiento: 1, inclinacion: 0, tamano, racimo: null, fijo: true, codigoFijo: f.codigo });
    // El objetivo que ocupa: el del formato pedido; si la mezcla no lo trae, el del formato que quedó.
    const lista = [f.formatoPedidoId, f.formatoId].map((id) => (id ? objetivos.get(id) : undefined)).find((l) => l?.length);
    if (lista) {
      const k = lista.reduce((m, o, i) => (o.tramo === mejor.it && Math.abs(o.s - mejor.m.s) < Math.abs((lista[m]!.tramo === mejor.it ? lista[m]!.s : Infinity) - mejor.m.s) ? i : m), 0);
      lista.splice(k, 1);
    }
  }
  return { montados };
}
