import { formatoPorId, FORMATOS_GLOBO } from "@/lib/globos3d/formatos";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import type { GloboDecoracion, TuboDecoracion } from "@/lib/globos3d/decoraciones";
import type { EscenaArmada, Sala } from "@/lib/globos3d/escena";
import type { EscenaGlobos, GloboColocadoEnEscena, TuboEnEscena } from "./escena-globos";

/**
 * Una escena armada, tal como la dibuja el visor (lo mismo que hace la pestaña Escena, sin elegir ni arrastrar): para
 * la vista 3D de la ficha de la biblioteca y sus miniaturas.
 */
const R12 = FORMATOS_GLOBO.find((f) => f.id === "R-12")!;

function globoAVisor(g: GloboDecoracion & { confeti?: boolean }): GloboColocadoEnEscena {
  const ref = referenciaPorCodigo(g.codigo);
  return {
    formato: formatoPorId(g.formatoId) ?? R12, infladoCm: g.infladoCm, hex: ref?.hexGlobo ?? "#ffffff", familia: ref?.familia ?? "fashion",
    nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm, ...(g.frente ? { frente: g.frente } : {}), ...(g.estampado ? { estampado: g.estampado } : {}), ...(g.confeti ? { confeti: true } : {}),
  };
}

function tuboAVisor(t: TuboDecoracion): TuboEnEscena {
  if (t.papel) return { puntos: t.puntos, grosorCm: t.grosorCm, hex: t.papel.hex, familia: "papel", cerrado: t.cerrado, ...(t.papel.relleno ? { relleno: true } : {}) };
  const ref = referenciaPorCodigo(t.codigo);
  return { puntos: t.puntos, grosorCm: t.grosorCm, hex: ref?.hexGlobo ?? "#ffffff", familia: ref?.familia ?? "fashion", cerrado: t.cerrado };
}

/** Dibuja la escena armada (con su sala, o la que se pida) y encuadra. */
export function mostrarArmada(visor: EscenaGlobos, armada: EscenaArmada, sala: Sala = armada.sala): void {
  visor.mostrarModulo(
    armada.porNodo.flatMap((n) => n.globos.map((g) => ({ ...globoAVisor(g), nodo: n.id }))),
    [],
    armada.porNodo.flatMap((n) => n.tubos.map((t) => ({ ...tuboAVisor(t), nodo: n.id }))),
    {
      flores: armada.porNodo.flatMap((n) => n.flores.map((f) => ({ ...f, nodo: n.id }))),
      cilindros: armada.cilindros,
      solidos: armada.porNodo.flatMap((n) => n.solidos.map((x) => ({ ...x, nodo: n.id }))),
      sala,
    },
  );
}
