/**
 * La cobertura del cuerpo de una guirnalda orgánica vista de frente: se muestrea el cuerpo (una banda a cada lado del eje, hasta una
 * fracción de su semigrosor) y cada punto cuenta como cubierto si cae dentro del círculo de algún globo (su proyección de frente). Una
 * guirnalda con un hueco visible (la foto 07 con el relleno tupido) tiene puntos del cuerpo por donde se ve la pared. Solo para pruebas.
 */
import { pisoDeLectura } from "../../src/lib/globos3d/encuadre-foto";
import type { LecturaFoto } from "../../src/lib/globos3d/lectura-foto";

export type GloboVisto = { nudo: { x: number; y: number }; direccion: { x: number; y: number }; infladoCm: number };
export type PuntoDelEje = { x: number; y: number; grosor: number };

const PASO_CM = 2;
const LADOS = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
/** Qué parte del semigrosor del cuerpo se muestrea: el borde es irregular y no cuenta. */
export const FRACCION_DEL_CUERPO = 0.9;
/** Las puntas se afinan: no se muestrea el comienzo ni el final del eje (fracción del largo). */
const MARGEN_DEL_EJE = 0.06;
const VENTANA_CM = 30;

/** El eje de la guirnalda orgánica `indice` de la lectura, en cm del mundo (como lo coloca `compilarLectura`), con su grosor en cada punto. */
export function ejeEnCm(l: LecturaFoto, indice = 0): PuntoDelEje[] {
  const H = l.escala.altoImagenCm, piso = pisoDeLectura(l);
  const g = l.piezas.filter((p) => p.tipo === "guirnalda_organica")[indice];
  if (!g || g.tipo !== "guirnalda_organica") throw new Error("la lectura no tiene esa guirnalda orgánica");
  return g.puntos.map((q) => ({ x: (q.x - 0.5) * l.aspecto * H, y: Math.max(0, (piso - q.y) * H), grosor: q.grosor * H }));
}

/** El círculo de frente de cada globo: su centro es el nudo más media inflada en su dirección. */
const discosDe = (globos: readonly GloboVisto[]) => globos.map((g) => ({ x: g.nudo.x + g.direccion.x * (g.infladoCm / 2), y: g.nudo.y + g.direccion.y * (g.infladoCm / 2), r: g.infladoCm / 2 }));

/** Qué fracción del cuerpo (0 a 1) cubren los globos y cuánto del peor tramo de `VENTANA_CM` del eje queda al descubierto. */
export function coberturaDelCuerpo(eje: readonly PuntoDelEje[], globos: readonly GloboVisto[]): { cobertura: number; peorVentana: number; puntos: number } {
  const discos = discosDe(globos);
  const largos = eje.slice(1).map((q, i) => Math.hypot(q.x - eje[i]!.x, q.y - eje[i]!.y));
  const total = largos.reduce((s, n) => s + n, 0);
  const porPaso: number[] = [];
  let recorrido = 0, puntos = 0, sin = 0;
  eje.slice(1).forEach((b, i) => {
    const a = eje[i]!, largo = largos[i]!;
    const nx = -(b.y - a.y) / (largo || 1), ny = (b.x - a.x) / (largo || 1);
    for (let d = 0; d < largo; d += PASO_CM) {
      const t = (recorrido + d) / total;
      if (t < MARGEN_DEL_EJE || t > 1 - MARGEN_DEL_EJE) continue;
      const u = d / (largo || 1), cx = a.x + (b.x - a.x) * u, cy = a.y + (b.y - a.y) * u;
      const semi = ((a.grosor + (b.grosor - a.grosor) * u) / 2) * FRACCION_DEL_CUERPO;
      let descubiertos = 0;
      for (const lado of LADOS) {
        const x = cx + nx * semi * lado, y = cy + ny * semi * lado;
        if (!discos.some((c) => Math.hypot(c.x - x, c.y - y) <= c.r)) descubiertos++;
      }
      puntos += LADOS.length;
      sin += descubiertos;
      porPaso.push(descubiertos / LADOS.length);
    }
    recorrido += largo;
  });
  const ventana = Math.max(1, Math.round(VENTANA_CM / PASO_CM));
  let peor = 0;
  for (let i = 0; i + ventana <= porPaso.length; i++) peor = Math.max(peor, porPaso.slice(i, i + ventana).reduce((s, n) => s + n, 0) / ventana);
  return { cobertura: puntos ? 1 - sin / puntos : 1, peorVentana: peor, puntos };
}
