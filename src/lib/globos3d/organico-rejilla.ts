import { interpolarGrosor, limitar, rangoS, type TramoPreparado } from "./organico-geometria";

export type PuntoRejillaOrganica = { tramo: number; s: number; phi: number };

/** Candidate points over each organic envelope; closed loops use finer longitudinal spacing to find legal fill gaps. */
export function crearRejillaOrganica(tramos: readonly TramoPreparado[]): PuntoRejillaOrganica[] {
  const rejilla: PuntoRejillaOrganica[] = [];
  tramos.forEach((tp, it) => {
    let fila = 0;
    const rango = rangoS(tp);
    const paso = tp.def.cerrado ? 1 : 4;
    for (let s = rango.min + 2; s < rango.max; s += paso, fila++) {
      const R = interpolarGrosor(tp.def.grosor, limitar(s / tp.largo, 0, 1));
      const fuera = s > tp.largo ? s - tp.largo : s < 0 ? -s : 0;
      const n = Math.max(4, Math.round((2 * Math.PI * Math.sqrt(Math.max(0, R * R - fuera * fuera))) / 5));
      for (let j = 0; j < n; j++) rejilla.push({ tramo: it, s, phi: ((j + (fila % 2) * 0.5) / n) * Math.PI * 2 });
    }
  });
  return rejilla;
}
