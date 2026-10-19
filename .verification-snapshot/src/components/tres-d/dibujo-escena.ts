import { formatoPorId, FORMATOS_GLOBO } from "@/lib/globos3d/formatos";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import type { GloboDecoracion, TuboDecoracion } from "@/lib/globos3d/decoraciones";
import type { FlorEnEscena, GloboColocadoEnEscena, SolidoEnEscena, TuboEnEscena } from "./escena-globos";

/** Cómo el taller pasa una escena armada a lo que dibuja el visor (cada cosa con el id de su pieza). */

/** El formato por defecto de un globo que no trae el suyo. */
export const R12 = formatoPorId("R-12") ?? FORMATOS_GLOBO[2]!;

/** Un globo de la escena tal como lo dibuja el visor: formato, color oficial y orientación. */
export function globoAEscena(g: GloboDecoracion, porDefecto: NonNullable<ReturnType<typeof formatoPorId>>): GloboColocadoEnEscena {
  const ref = referenciaPorCodigo(g.codigo);
  return {
    formato: formatoPorId(g.formatoId) ?? porDefecto, infladoCm: g.infladoCm, hex: ref?.hexGlobo ?? "#ffffff", familia: ref?.familia ?? "fashion",
    nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm, ...(g.frente ? { frente: g.frente } : {}), ...(g.estampado ? { estampado: g.estampado } : {}),
  };
}

export function tuboAEscena(t: TuboDecoracion): TuboEnEscena {
  const ref = referenciaPorCodigo(t.codigo);
  // Papel (fantasma, telaraña, cintas): no es globo, va en su color y mate.
  if (t.papel) return { puntos: t.puntos, grosorCm: t.grosorCm, hex: t.papel.hex, familia: "papel", cerrado: t.cerrado, ...(t.papel.relleno ? { relleno: true } : {}) };
  return { puntos: t.puntos, grosorCm: t.grosorCm, hex: ref?.hexGlobo ?? "#ffffff", familia: ref?.familia ?? "fashion", cerrado: t.cerrado };
}

/** Materiales con el nombre del color en inglés, para la descripción que acompaña la captura a FLUX. */
export function materialesEnIngles(materiales: ReadonlyArray<{ formatoId: string; codigo: string; cantidad: number }>) {
  return materiales.map((m) => ({ cantidad: m.cantidad, formatoId: m.formatoId, colorEn: referenciaPorCodigo(m.codigo)?.nombreEn ?? m.codigo }));
}

/** Lo que el visor dibuja de una escena armada. */
export type DibujoEscena = { globos: GloboColocadoEnEscena[]; tubos: TuboEnEscena[]; flores: FlorEnEscena[]; solidos: SolidoEnEscena[] };
export const DIBUJO_VACIO: DibujoEscena = { globos: [], tubos: [], flores: [], solidos: [] };
