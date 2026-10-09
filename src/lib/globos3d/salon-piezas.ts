import type { Colocacion } from "./escena";
import { arcoOrganico, columnaClasica, guirnaldaFeston } from "./escenas-presets";
import { coloresOrganicosPedidos, crearEstructura } from "./herramientas-escena-estructuras";
import { resolverColorFlexible, resolverColorOrganico } from "./herramientas-escena-colores";
import type { Pieza } from "./piezas";

/**
 * Las piezas de globos con que se decora un salón (REQ-008), en los dos estilos del pedido: `organico` (globos de varios tamaños) o
 * `clasico` (cuartetos). Las usan las composiciones del fondo de fotos (salon-fondos.ts) y la entrada (salon-decoracion.ts).
 */

export const ESTILOS_SALON = ["organico", "clasico"] as const;
export type EstiloSalon = (typeof ESTILOS_SALON)[number];

const POR_DEFECTO = ["blanco", "dorado"];

/** Los colores que el resolvedor reconoce; los demás se avisan y se saltan. Sin ninguno, blanco y dorado. */
export function coloresReconocidos(pedidos: readonly string[], notas: string[]): string[] {
  const buenos: string[] = [];
  for (const c of pedidos) {
    try { resolverColorOrganico(c, []); buenos.push(c); } catch { notas.push(`No reconocí el color «${c}» para los globos: lo salté.`); }
  }
  return buenos.length ? buenos : [...POR_DEFECTO];
}

export function arco(estilo: EstiloSalon, nombres: readonly string[], anchoCm: number, altoCm: number, notas: string[]): Pieza {
  if (estilo === "organico") {
    const base = arcoOrganico(anchoCm, altoCm);
    return base.tipo === "arco_organico" ? { ...base, arco: { ...base.arco, colores: coloresOrganicosPedidos(nombres, undefined, notas) } } : base;
  }
  const codigos = nombres.map((n) => resolverColorFlexible(n, ["R-12"], notas));
  const patron = codigos.length >= 3 ? "espiral" as const : codigos.length === 2 ? "dos_colores" as const : "un_color" as const;
  const colores = patron === "espiral" ? Array.from({ length: 4 }, (_, i) => codigos[i % codigos.length]!) : codigos;
  return { tipo: "arco", formatoId: "R-12", infladoCm: 25, forma: "redondo", anchoCm, altoCm, patron, colores };
}

export function columna(estilo: EstiloSalon, nombres: readonly string[], altoCm: number, notas: string[]): Pieza {
  if (estilo === "organico") return crearEstructura("columna_organica", { alto_cm: altoCm, grosor_cm: 60, colores: [...nombres] }, notas).pieza;
  const codigos = nombres.map((n) => resolverColorFlexible(n, ["R-12"], notas));
  return columnaClasica(altoCm, Array.from({ length: 4 }, (_, i) => codigos[i % codigos.length]!));
}

export function guirnalda(estilo: EstiloSalon, nombres: readonly string[], anchoCm: number, notas: string[]): Pieza {
  if (estilo === "organico") return crearEstructura("guirnalda_organica", { ancho_cm: anchoCm, caida_cm: 50, grosor_cm: 50, colores: [...nombres] }, notas).pieza;
  const base = guirnaldaFeston(anchoCm, 45);
  const codigos = nombres.map((n) => resolverColorFlexible(n, ["R-9"], notas));
  return base.tipo === "guirnalda" ? { ...base, guirnalda: { ...base.guirnalda, colores: [codigos[0]!, codigos[1] ?? codigos[0]!] } } : base;
}

export const enPiso = (xCm: number, zCm: number): Colocacion => ({ en: "piso", xCm: Math.round(xCm), zCm: Math.round(zCm), giroGrados: 0 });
export const enPared = (aLoLargoCm: number, alturaCm: number): Colocacion => ({ en: "pared", pared: "fondo", aLoLargoCm: Math.round(aLoLargoCm), alturaCm: Math.round(alturaCm) });
