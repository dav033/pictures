import { formatoPorId, FORMATOS_GLOBO } from "@/lib/globos3d/formatos";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import type { GloboDecoracion, TuboDecoracion } from "@/lib/globos3d/decoraciones";
import type { EscenaArmada, Sala } from "@/lib/globos3d/escena";
import type { CajaEnEscena, EscenaGlobos, GloboColocadoEnEscena, TuboEnEscena } from "./escena-globos";
import { CONFETI_ORO, CONFETI_PLATA } from "./confeti-visor";

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

/** ¿Es un dorado (tono entre ámbar y amarillo, con color)? Para decidir el papel del confeti. */
function esDorado(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === 0 || (max - min) / max < 0.25) return false;
  const h = max === r ? ((g - b) / (max - min)) * 60 : max === g ? (2 + (b - r) / (max - min)) * 60 : (4 + (r - g) / (max - min)) * 60;
  const grados = (h + 360) % 360;
  return grados >= 25 && grados <= 62;
}

/**
 * El papel del confeti de una pieza: el cristal «con confeti» no dice de qué color es el papel, así que sale del metal que lo
 * acompaña, que es como se combina en las fotos: si la mayoría de los globos cromados o metal de la pieza son dorados, dorado;
 * si no, plateado (el Cristal 390 con confeti plateado de la tienda).
 *
 * TODO(integración): es una heurística. El color del papel debería venir como dato (un `confetiHex` en el globo del motor y de
 * la lectura de la foto, que hoy solo trae `confeti: boolean`); cuando exista, este cálculo se quita y se lee el dato.
 */
export function papelDeConfeti(globos: ReadonlyArray<{ codigo: string }>): string {
  let dorados = 0, otros = 0;
  for (const g of globos) {
    const ref = referenciaPorCodigo(g.codigo);
    if (!ref || (ref.familia !== "reflex" && ref.familia !== "metal")) continue;
    if (esDorado(ref.hexGlobo)) dorados++; else otros++;
  }
  return dorados > otros ? CONFETI_ORO : CONFETI_PLATA;
}

function tuboAVisor(t: TuboDecoracion): TuboEnEscena {
  if (t.papel) return { puntos: t.puntos, grosorCm: t.grosorCm, hex: t.papel.hex, familia: "papel", cerrado: t.cerrado, ...(t.papel.relleno ? { relleno: true } : {}) };
  const ref = referenciaPorCodigo(t.codigo);
  return { puntos: t.puntos, grosorCm: t.grosorCm, hex: ref?.hexGlobo ?? "#ffffff", familia: ref?.familia ?? "fashion", cerrado: t.cerrado };
}

/**
 * Dibuja la escena armada (con su sala, o la que se pida) y encuadra. `opciones.encuadrar: false` deja la cámara donde
 * está y `opciones.resaltado` marca una caja (no sale en las capturas): los usa el estudio de módulos al elegir un globo.
 */
export function mostrarArmada(visor: EscenaGlobos, armada: EscenaArmada, sala: Sala = armada.sala, opciones: { encuadrar?: boolean; resaltado?: CajaEnEscena | null } = {}): void {
  visor.mostrarModulo(
    armada.porNodo.flatMap((n) => {
      const papel = n.globos.some((g) => (g as { confeti?: boolean }).confeti) ? papelDeConfeti(n.globos) : null;
      return n.globos.map((g) => ({ ...globoAVisor(g), nodo: n.id, ...(papel && (g as { confeti?: boolean }).confeti ? { confetiHex: papel } : {}) }));
    }),
    [],
    armada.porNodo.flatMap((n) => n.tubos.map((t) => ({ ...tuboAVisor(t), nodo: n.id }))),
    {
      flores: armada.porNodo.flatMap((n) => n.flores.map((f) => ({ ...f, nodo: n.id }))),
      cilindros: armada.cilindros,
      solidos: armada.porNodo.flatMap((n) => n.solidos.map((x) => ({ ...x, nodo: n.id }))),
      sala,
      ...(opciones.encuadrar === false ? { encuadrar: false } : {}),
      ...(opciones.resaltado ? { resaltado: opciones.resaltado } : {}),
    },
  );
}
