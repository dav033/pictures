import { materialesPorFormato } from "./decoraciones";
import { formatoPorId } from "./formatos";
import { centroCuerpo } from "./geometria";
import { sumarMateriales } from "./mezcla";
import type { GloboDePieza, PiezaArmada } from "./piezas";

/**
 * **Remate**: el globo que va arriba de una columna (un R-36 dorado, un R-24 de cristal con confeti, un R-18…): se
 * amarra encima del último cuarteto o de la punta del cuerpo orgánico, con el nudo abajo, centrado sobre lo más alto
 * de la pieza y un poco hundido entre sus globos, como se arma de verdad. Es parte de la pieza (cotiza, se edita por
 * la parte «remate» y se mueve con ella), no un globo suelto encima.
 */
export type RemateGlobo = {
  /** Formato redondo (R-5…R-36). */
  formatoId: string;
  /** Inflado (cm); por defecto, el de decoración del formato. */
  infladoCm?: number;
  codigo: string;
};

export const PARTE_REMATE = "remate";

/** Lo que el remate se hunde entre los globos de arriba, en fracción del diámetro medio de esos globos. */
const HUNDIMIENTO = 0.3;
/** Banda (cm) desde lo más alto en la que se buscan los globos que sostienen el remate. */
const BANDA_ARRIBA_CM = 20;

export function infladoDeRemate(remate: RemateGlobo): number {
  const formato = formatoPorId(remate.formatoId);
  if (!formato || formato.tipo !== "redondo") throw new Error(`El remate va con un globo redondo (R-5…R-36), no ${remate.formatoId}.`);
  return remate.infladoCm ?? formato.infladoDecoracionCm;
}

/** El centro del cuerpo de un globo armado. */
function centroDe(g: GloboDePieza) {
  const largo = g.infladoCm / 2 + g.cuelloExtraCm;
  return { x: g.nudo.x + g.direccion.x * largo, y: g.nudo.y + g.direccion.y * largo, z: g.nudo.z + g.direccion.z * largo };
}

/** Pone el remate arriba de la pieza ya armada (sin remate previo). Sin globos, la pieza queda igual. */
export function aplicarRemate(armada: PiezaArmada, remate: RemateGlobo): PiezaArmada {
  const inflado = infladoDeRemate(remate);
  const conTope = armada.globos.map((g) => ({ g, c: centroDe(g) })).map((x) => ({ ...x, tope: x.c.y + x.g.infladoCm / 2 }));
  if (!conTope.length) return armada;
  const alto = Math.max(...conTope.map((x) => x.tope));
  const arriba = conTope.filter((x) => x.tope >= alto - BANDA_ARRIBA_CM);
  // Centro: el de los globos de arriba, pesado por volumen (el cuarteto de arriba, la punta de una columna inclinada).
  const peso = (x: (typeof arriba)[number]) => x.g.infladoCm ** 3;
  const total = arriba.reduce((s, x) => s + peso(x), 0);
  const cx = arriba.reduce((s, x) => s + x.c.x * peso(x), 0) / total;
  const cz = arriba.reduce((s, x) => s + x.c.z * peso(x), 0) / total;
  const diametroMedio = arriba.reduce((s, x) => s + x.g.infladoCm, 0) / arriba.length;
  // El nudo (lo más bajo del globo) se amarra hundido entre los globos de arriba; el cuerpo crece hacia +y.
  const nudoY = alto - HUNDIMIENTO * diametroMedio;
  const centroY = nudoY + centroCuerpo("redondo", inflado);
  const globo: GloboDePieza = {
    formatoId: remate.formatoId, infladoCm: inflado, codigo: remate.codigo,
    nudo: { x: cx, y: nudoY, z: cz }, direccion: { x: 0, y: 1, z: 0 }, cuelloExtraCm: 0, parte: PARTE_REMATE,
  };
  const r = inflado / 2;
  const caja = {
    min: { x: Math.min(armada.caja.min.x, cx - r), y: armada.caja.min.y, z: Math.min(armada.caja.min.z, cz - r) },
    max: { x: Math.max(armada.caja.max.x, cx + r), y: Math.max(armada.caja.max.y, centroY + r), z: Math.max(armada.caja.max.z, cz + r) },
  };
  return {
    ...armada,
    globos: [...armada.globos, globo],
    // Lo que se cuelga «arriba de la columna» va ahora sobre el remate.
    anclas: [...armada.anclas, { posicion: { x: cx, y: centroY + r, z: cz }, normal: { x: 0, y: 1, z: 0 } }],
    materiales: sumarMateriales(armada.materiales, materialesPorFormato([globo])),
    caja,
  };
}
