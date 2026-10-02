import type { ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { coloresCanonicos, type AnalisisColorSempertex } from "@/lib/plan/analisis-color";
import { tieneElementosAprobados, tieneEstructurasDeGlobos } from "@/lib/ia/referencia/reference-structure";
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

/**
 * Los chips de color que ve el cliente. Con el color medido de la foto son **referencias del catálogo** —código,
 * nombre comercial y el tono del globo real—; sin él, las palabras del analizador, que es lo que había antes
 * («rojo metalizado», «gris»). Una referencia se puede pedir; una palabra, no.
 */
function chipsDeColor(blueprint: ReferenceBlueprintV2, medidos: AnalisisColorSempertex | null): MuestraColor[] {
  const canonicos = coloresCanonicos(medidos, 6);
  if (canonicos.length === 0) return coloresObservadosCliente(blueprint, 5);
  return canonicos.map((color) => ({
    color: color.codigo,
    etiqueta: `${color.nombre} · ${color.codigo}`,
    fondo: muestraDeGlobo(color.hexGlobo, color.acabado),
    conBorde: esClaro(color.hexGlobo),
  }));
}

/** El círculo del chip, con el brillo que le toca a su acabado: un cromado no se ve como un mate. */
export function muestraDeGlobo(hex: string, acabado: string): string {
  const texto = acabado.toLowerCase();
  if (texto.includes("translucent")) {
    return `radial-gradient(circle at 35% 30%, #ffffff 0 25%, ${hex}59 60%)`;
  }
  if (texto.includes("chrome") || texto.includes("metallic")) {
    return `radial-gradient(circle at 32% 28%, #ffffff 0 12%, ${hex} 45%, #00000055 100%)`;
  }
  if (texto.includes("satin") || texto.includes("pearlescent")) {
    return `radial-gradient(circle at 35% 30%, #ffffffcc 0 20%, ${hex} 70%)`;
  }
  return hex;
}

/** Un color claro necesita borde para verse sobre el fondo de la tarjeta. */
function esClaro(hex: string): boolean {
  const entero = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(entero >> 16) & 255, (entero >> 8) & 255, entero & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 200;
}

export function vistaAnalisisFoto(
  estado: EstadoAnalisisFoto,
  blueprint: ReferenceBlueprintV2 | null,
  error?: string | null,
  medidos: AnalisisColorSempertex | null = null,
): VistaAnalisisFoto {
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
      colores: chipsDeColor(blueprint, medidos),
    };
  }
  return {
    caso: "listo",
    resumen,
    piezas,
    colores: chipsDeColor(blueprint, medidos),
    ambientacion: ambientacionCliente(blueprint, new Set(piezas.map((pieza) => pieza.elementId))),
  };
}
