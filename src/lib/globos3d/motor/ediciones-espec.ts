import { agregarColor, masMenosColor, proporcionColor, quitarColor, reemplazarColor } from "./ediciones-color";
import type { ResultadoEdicion } from "./ediciones-comunes";
import { agregarIdea, agregarPieza, floresPieza, ladoPieza, quitarPieza, tamanoGlobos, tamanoPieza } from "./ediciones-pieza";
import { EdicionEspecV1Schema, type EdicionEspecV1 } from "./edicion-espec-v1";
import { EspecClienteV1Schema, type EspecClienteV1 } from "./espec-cliente-v1";

/**
 * **Las ediciones del cliente sobre su espec** (REQ-007, fase 5): operaciones puras `espec -> espec` que nunca mienten.
 * Cada una devuelve `{ espec, avisos, descripcion, tocadas, noAplicado? }`: si no cambió nada, la espec es la misma y
 * `noAplicado` dice por qué con «No pude: …»; si cambió algo, `avisos` dice lo que el cliente debe saber (un color
 * sustituido, una medida acotada, una pieza que se saltó). Nada de esto añade geometría que no sea una pieza oficial
 * (`agregar_pieza`) o las de una idea del catálogo (`agregar_idea`): no hay arrastrar, mover ni crear.
 */
export type { ResultadoEdicion } from "./ediciones-comunes";
export { PREFIJO_NO_PUDE } from "./prefijo-no-pude";

export type ContextoEdicion = {
  /** La espec de la idea del catálogo que `agregar_idea` suma (la ruta la arma del plan guardado); null si no existe. */
  idea?: (ideaId: string) => EspecClienteV1 | null;
};

/** Aplica UNA edición a la espec. La edición se valida contra su esquema: una forma inventada no se ejecuta. */
export function aplicarEdicion(espec: EspecClienteV1, edicion: EdicionEspecV1, contexto: ContextoEdicion = {}): ResultadoEdicion {
  const leida = EdicionEspecV1Schema.safeParse(edicion);
  if (!leida.success) return { espec, avisos: [], descripcion: "", tocadas: [], noAplicado: "No pude: esa edición no tiene una forma que sepa hacer." };
  const resultado = hacer(espec, leida.data, contexto);
  if (resultado.noAplicado) return resultado;
  // Una edición nunca deja una espec que el contrato no admite (pesos que no suman 1, ids repetidos, demasiadas piezas).
  const valida = EspecClienteV1Schema.safeParse(resultado.espec);
  return valida.success ? resultado : { espec, avisos: resultado.avisos, descripcion: "", tocadas: [], noAplicado: "No pude: ese cambio dejaría tu plan en un estado que no sé armar." };
}

function hacer(espec: EspecClienteV1, e: EdicionEspecV1, contexto: ContextoEdicion): ResultadoEdicion {
  switch (e.op) {
    case "reemplazar_color": return reemplazarColor(espec, e);
    case "agregar_color": return agregarColor(espec, e);
    case "quitar_color": return quitarColor(espec, e);
    case "proporcion_color": return proporcionColor(espec, e);
    case "mas_menos_color": return masMenosColor(espec, e);
    case "tamano_pieza": return tamanoPieza(espec, e);
    case "tamano_globos": return tamanoGlobos(espec, e);
    case "quitar_pieza": return quitarPieza(espec, e);
    case "agregar_pieza": return agregarPieza(espec, e);
    case "agregar_idea": return agregarIdea(espec, e, contexto.idea?.(e.ideaId) ?? null);
    case "flores": return floresPieza(espec, e);
    case "lado": return ladoPieza(espec, e);
  }
}

export type ResultadoEdiciones = {
  espec: EspecClienteV1;
  avisos: string[];
  /** Las descripciones de lo que sí se hizo, en el orden en que se hizo. */
  hechas: string[];
  /** Los «No pude: …» de lo que no se pudo hacer. */
  noAplicadas: string[];
  /** Las piezas cuya espec cambió (sin repetir). */
  tocadas: string[];
  /** Cuántas ediciones cambiaron la espec. */
  aplicadas: number;
};

/**
 * Una tanda de ediciones de un mismo pedido, una tras otra sobre lo que dejó la anterior. Las que no se pueden hacer se
 * dicen y no detienen a las demás: la tanda es honesta aunque sea parcial. Si ninguna cambió nada, `aplicadas` es 0.
 */
export function aplicarEdiciones(inicial: EspecClienteV1, ediciones: readonly EdicionEspecV1[], contexto: ContextoEdicion = {}): ResultadoEdiciones {
  let espec = inicial;
  const salida: ResultadoEdiciones = { espec, avisos: [], hechas: [], noAplicadas: [], tocadas: [], aplicadas: 0 };
  for (const edicion of ediciones) {
    const resultado = aplicarEdicion(espec, edicion, contexto);
    salida.avisos.push(...resultado.avisos);
    if (resultado.noAplicado) { salida.noAplicadas.push(resultado.noAplicado); continue; }
    espec = resultado.espec;
    salida.hechas.push(resultado.descripcion);
    salida.aplicadas += 1;
    for (const id of resultado.tocadas) if (!salida.tocadas.includes(id)) salida.tocadas.push(id);
  }
  return { ...salida, espec, avisos: [...new Set(salida.avisos)] };
}
