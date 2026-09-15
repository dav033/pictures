import type { ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import { tieneElementosAprobados, tieneEstructurasDeGlobos } from "@/lib/ia/reference-structure";
import {
  ambientacionCliente,
  coloresObservadosCliente,
  piezasVistasEnReferencia,
  resumenReferenciaCliente,
  type MuestraColor,
  type PiezaVistaEnReferencia,
} from "@/lib/plan/presentacion-cliente";

export type EstadoAnalisisFoto = "analizando" | "listo" | "error";

/** What the reference analysis panel says, decided without React or motion (testable under any runtime). */
export type VistaAnalisisFoto =
  | { caso: "analizando"; titulo: string }
  | { caso: "error"; titulo: string; mensaje: string }
  /** The analysis kept nothing usable (e.g. a truncated photo): never "Listo" (hallazgo #17). */
  | { caso: "sin_elementos"; titulo: string; mensaje: string }
  /** Something was seen, but no balloon decoration: the assistant asks before building. */
  | { caso: "sin_globos"; titulo: string; mensaje: string; colores: MuestraColor[] }
  | { caso: "listo"; resumen: string; piezas: PiezaVistaEnReferencia[]; colores: MuestraColor[]; ambientacion: string[] };

export const TEXTO_ANALIZANDO = "Estoy mirando tu foto";
export const TEXTO_SIN_GLOBOS = "No veo decoración con globos en esta foto";

export function vistaAnalisisFoto(estado: EstadoAnalisisFoto, blueprint: ReferenceBlueprintV2 | null, error?: string | null): VistaAnalisisFoto {
  if (estado === "analizando") return { caso: "analizando", titulo: TEXTO_ANALIZANDO };
  if (estado === "error" || !blueprint) {
    return { caso: "error", titulo: "No pude mirar bien tu foto", mensaje: error ?? "Puede ser la conexión. Inténtalo de nuevo o prueba con otra foto." };
  }
  if (!tieneElementosAprobados(blueprint)) {
    return { caso: "sin_elementos", titulo: "No pude ver bien tu foto", mensaje: "No encontré nada que pueda usar. Prueba con otra foto más clara o elige una foto de ejemplo." };
  }
  const piezas = piezasVistasEnReferencia(blueprint);
  const resumen = resumenReferenciaCliente(blueprint);
  if (!tieneEstructurasDeGlobos(blueprint) || !piezas.length || !resumen) {
    return {
      caso: "sin_globos",
      titulo: TEXTO_SIN_GLOBOS,
      mensaje: "Puedo usarla como idea de colores y ambiente. Antes de armar la propuesta te preguntaré qué piezas quieres, o puedes elegir una foto de ejemplo.",
      colores: coloresObservadosCliente(blueprint, 5),
    };
  }
  return {
    caso: "listo",
    resumen,
    piezas,
    colores: coloresObservadosCliente(blueprint, 5),
    ambientacion: ambientacionCliente(blueprint, new Set(piezas.map((pieza) => pieza.elementId))),
  };
}
