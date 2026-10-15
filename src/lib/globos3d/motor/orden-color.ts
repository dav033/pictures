import type { EspecClienteV1, PiezaEspec } from "./espec-cliente-v1";
import { plegar } from "./ediciones-comunes";
import {
  type CambioPiezaReemplazo, type ContextoOrdenColor, type IdentidadColor,
  type RegistroReemplazoColor, type ResolucionSinCambio, VERSION_ORDEN_COLOR,
} from "@/lib/plan/orden-color";

export {
  CambioPiezaReemplazoSchema, ContextoOrdenColorSchema, IdentidadColorSchema,
  MAX_COLORES_ORDEN, RegistroReemplazoColorSchema, VERSION_ORDEN_COLOR,
  crearContextoOrdenColorVacio, type CambioPiezaReemplazo, type ContextoOrdenColor,
  type IdentidadColor, type RegistroReemplazoColor, type ResolucionSinCambio,
} from "@/lib/plan/orden-color";

/**
 * **Contexto de la última orden de color del cliente** (REQ-016 T2, D-046).
 *
 * Se almacena en el token de aprobación firmado (payload v3) para saber si una orden de reemplazo de color
 * es la repetición de la orden anterior o una orden nueva.
 * - Con historial conocido (`lastReplacement: null` o registro), si el destino ya está en la pieza NO se pregunta
 *   (elimina la heurística frágil de `yaEntro` + `origen.tipo === 'edicion'`).
 * - Una repetición demostrada de la misma orden (misma frase de origen plegada, mismo destino efectivo por pieza,
 *   misma pieza cambiada y colores resultantes idénticos) no cambia nada y da un motivo declarativo
 *   («No pude: ese cambio de color ya estaba aplicado en el arco.»), sin preguntar.
 * - Ambigüedades reales entre dos tonos del catálogo siguen preguntando con opciones.
 * - Historial legado (tokens v1/v2, donde el contexto es `undefined`) conserva la heurística conservadora anterior.
 * Nested colour-order.v2 also retains requested resolved no-ops (D-048); v1 remains readable without invented snapshots.
 */

export function identidadesDeColores(colores: readonly { codigo: string; nombre: string }[]): IdentidadColor[] {
  return colores.map((c) => ({ codigo: c.codigo, nombrePlegado: plegar(c.nombre) }));
}

/** Comprueba si dos listas de colores tienen exactamente el mismo conjunto de identidades (código y nombre plegado). */
export function mismasIdentidades(guardadas: readonly IdentidadColor[], actuales: readonly { codigo: string; nombre: string }[]): boolean {
  if (guardadas.length !== actuales.length) return false;
  const mapa = new Map<string, string>();
  for (const c of actuales) mapa.set(c.codigo, plegar(c.nombre));
  for (const g of guardadas) {
    if (mapa.get(g.codigo) !== g.nombrePlegado) return false;
  }
  return true;
}

/** Comprueba si la orden actual sobre `pieza` es una repetición demostrada del reemplazo guardado. */
export function esReplayProbado(
  record: RegistroReemplazoColor,
  pieza: PiezaEspec,
  fraseOrigen: string,
  destinosEfectivos: readonly string[],
): { replay: true; changed: boolean; entry: ResolucionSinCambio } | { replay: false } {
  if (record.fraseOrigenPlegada !== plegar(fraseOrigen)) return { replay: false };
  const changed = record.piezasCambiadas.includes(pieza.id);
  const unchanged = "resolucionesSinCambio" in record ? record.resolucionesSinCambio : [];
  const entry = changed
    ? record.cambiosPorPieza.find((c) => c.piezaId === pieza.id)
    : unchanged.find((c) => c.piezaId === pieza.id);
  if (!entry) return { replay: false };
  if (entry.destinosEfectivos.length !== destinosEfectivos.length) return { replay: false };
  for (let i = 0; i < destinosEfectivos.length; i += 1) {
    if (entry.destinosEfectivos[i] !== destinosEfectivos[i]) return { replay: false };
  }
  if (!mismasIdentidades(entry.coloresResultantes, pieza.colores)) return { replay: false };
  return { replay: true, changed, entry };
}

/**
 * Poda el contexto cuando la espec cambia por una edición distinta (tamaño, flores, etc.) o suma de idea:
 * conserva solo las entradas de piezas que sigan existiendo y cuyas identidades de color sigan intactas.
 */
export function podarContextoOrdenColor(contexto: ContextoOrdenColor, espec: EspecClienteV1): ContextoOrdenColor {
  if (!contexto.lastReplacement) return contexto;
  const validas: CambioPiezaReemplazo[] = [];
  for (const entry of contexto.lastReplacement.cambiosPorPieza) {
    const pieza = espec.piezas.find((p) => p.id === entry.piezaId);
    if (pieza && mismasIdentidades(entry.coloresResultantes, pieza.colores)) {
      validas.push(entry);
    }
  }
  const sinCambio = "resolucionesSinCambio" in contexto.lastReplacement
    ? contexto.lastReplacement.resolucionesSinCambio.filter((entry) => {
        const pieza = espec.piezas.find((p) => p.id === entry.piezaId);
        return pieza && mismasIdentidades(entry.coloresResultantes, pieza.colores);
      })
    : [];
  // Keep the original version when pruning a legacy record; do not invent missing snapshots.
  if (!validas.length && !sinCambio.length) return { v: contexto.v, lastReplacement: null };
  const lastReplacement = {
    fraseOrigenPlegada: contexto.lastReplacement.fraseOrigenPlegada,
    piezasSolicitadas: contexto.lastReplacement.piezasSolicitadas.filter((id) => [...validas, ...sinCambio].some((v) => v.piezaId === id)),
    piezasCambiadas: validas.map((v) => v.piezaId),
    cambiosPorPieza: validas,
  };
  if (contexto.v === "colour-order.v1") return { v: contexto.v, lastReplacement };
  return {
    v: VERSION_ORDEN_COLOR,
    lastReplacement: {
      ...lastReplacement,
      resolucionesSinCambio: sinCambio,
    },
  };
}
