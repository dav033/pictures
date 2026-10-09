import type { Colocacion, Escena, NodoEscena } from "./escena";
import { arcoOrganico, columnaClasica, guirnaldaFeston } from "./escenas-presets";
import { coloresOrganicosPedidos, crearEstructura } from "./herramientas-escena-estructuras";
import { resolverColorFlexible, resolverColorOrganico } from "./herramientas-escena-colores";
import type { Pieza } from "./piezas";
import { ARCO_ENTRADA_DELANTE_CM, ARCO_FONDO_DELANTE_CM } from "./salon-evento";
import { conPieza, idLibre } from "./salon-registro";
import type { ZonaSalon, ZonasSalon } from "./salon-zonas";

/**
 * Lo que decora un salón armado con globos (REQ-008): el fondo de fotos (arco delante del panel, una columna a cada lado y una
 * guirnalda en la pared por encima) y el arco de la entrada. Los colores son los del pedido, resueltos con el resolvedor
 * de colores de siempre; el estilo es `organico` (globos de varios tamaños) o `clasico` (cuartetos). Las piezas quedan anotadas en
 * el registro del salón como adornos de su zona, así que `mover_zona` y `quitar_zona` las llevan con ella.
 */

export const ESTILOS_SALON = ["organico", "clasico"] as const;
export type EstiloSalon = (typeof ESTILOS_SALON)[number];

export type PedidoDecoracion = { colores: readonly string[]; estilo: EstiloSalon; fondo: boolean; entrada: boolean };

const POR_DEFECTO = ["blanco", "dorado"];

/** Los colores que el resolvedor reconoce; los demás se avisan y se saltan. Sin ninguno, blanco y dorado. */
function coloresReconocidos(pedidos: readonly string[], notas: string[]): string[] {
  const buenos: string[] = [];
  for (const c of pedidos) {
    try { resolverColorOrganico(c, []); buenos.push(c); } catch { notas.push(`No reconocí el color «${c}» para los globos: lo salté.`); }
  }
  return buenos.length ? buenos : POR_DEFECTO;
}

function arco(estilo: EstiloSalon, nombres: readonly string[], anchoCm: number, altoCm: number, notas: string[]): Pieza {
  if (estilo === "organico") {
    const base = arcoOrganico(anchoCm, altoCm);
    return base.tipo === "arco_organico" ? { ...base, arco: { ...base.arco, colores: coloresOrganicosPedidos(nombres, undefined, notas) } } : base;
  }
  const codigos = nombres.map((n) => resolverColorFlexible(n, ["R-12"], notas));
  const patron = codigos.length >= 3 ? "espiral" as const : codigos.length === 2 ? "dos_colores" as const : "un_color" as const;
  const colores = patron === "espiral" ? Array.from({ length: 4 }, (_, i) => codigos[i % codigos.length]!) : codigos;
  return { tipo: "arco", formatoId: "R-12", infladoCm: 25, forma: "redondo", anchoCm, altoCm, patron, colores };
}

function columna(estilo: EstiloSalon, nombres: readonly string[], altoCm: number, notas: string[]): Pieza {
  if (estilo === "organico") return crearEstructura("columna_organica", { alto_cm: altoCm, grosor_cm: 60, colores: [...nombres] }, notas).pieza;
  const codigos = nombres.map((n) => resolverColorFlexible(n, ["R-12"], notas));
  return columnaClasica(altoCm, Array.from({ length: 4 }, (_, i) => codigos[i % codigos.length]!));
}

function guirnalda(estilo: EstiloSalon, nombres: readonly string[], anchoCm: number, notas: string[]): Pieza {
  if (estilo === "organico") return crearEstructura("guirnalda_organica", { ancho_cm: anchoCm, caida_cm: 50, grosor_cm: 50, colores: [...nombres] }, notas).pieza;
  const base = guirnaldaFeston(anchoCm, 45);
  const codigos = nombres.map((n) => resolverColorFlexible(n, ["R-9"], notas));
  return base.tipo === "guirnalda" ? { ...base, guirnalda: { ...base.guirnalda, colores: [codigos[0]!, codigos[1] ?? codigos[0]!] } } : base;
}

const enPiso = (xCm: number, zCm: number): Colocacion => ({ en: "piso", xCm: Math.round(xCm), zCm: Math.round(zCm), giroGrados: 0 });

/**
 * Agrega la decoración de las zonas pedidas que existan. `fondo: false` (la zona ya tiene decoración del usuario, que el salón
 * conservó delante del panel) no le suma otro arco encima.
 */
export function decorarSalon(escena: Escena, zonas: ZonasSalon, p: PedidoDecoracion, notas: string[]): Escena {
  const registro = escena.salon;
  if (!registro) return escena;
  const nombres = coloresReconocidos(p.colores, notas);
  const alto = escena.sala.altoCm;
  let actual = escena;
  const agregar = (zona: ZonaSalon, base: string, nombre: string, pieza: Pieza, colocacion: Colocacion) => {
    const nodo: NodoEscena = { id: idLibre(actual, base), nombre, pieza, colocacion };
    actual = conPieza(actual, nodo, { zona, rol: "adorno" }, registro);
  };

  if (p.fondo && zonas.fondo) {
    const f = zonas.fondo, z = f.zCm + ARCO_FONDO_DELANTE_CM;
    const anchoArco = Math.min(380, Math.max(150, f.anchoCm - 60)), altoArco = Math.min(300, Math.max(150, alto - 60));
    agregar("fondo_fotos", "salon-fondo-arco", "Arco del fondo de fotos", arco(p.estilo, nombres, anchoArco, altoArco, notas), enPiso(f.xCm, z));
    const lado = anchoArco / 2 + 70;
    agregar("fondo_fotos", "salon-fondo-columna", "Columna del fondo (izquierda)", columna(p.estilo, nombres, Math.min(230, alto - 60), notas), enPiso(f.xCm - lado, z));
    agregar("fondo_fotos", "salon-fondo-columna", "Columna del fondo (derecha)", columna(p.estilo, nombres, Math.min(230, alto - 60), notas), enPiso(f.xCm + lado, z));
    const altura = f.altoCm + 20;
    if (alto - altura >= 110) agregar("fondo_fotos", "salon-fondo-guirnalda", "Guirnalda del fondo", guirnalda(p.estilo, nombres, Math.min(600, Math.max(100, f.anchoCm + 80)), notas), { en: "pared", pared: "fondo", aLoLargoCm: Math.round(f.xCm), alturaCm: altura });
  }
  if (p.entrada && zonas.entrada) {
    const e = zonas.entrada;
    agregar("entrada", "salon-entrada-arco", "Arco de la entrada", arco(p.estilo, nombres, 400, Math.min(280, Math.max(150, alto - 60)), notas), enPiso(e.xCm, e.zCm + ARCO_ENTRADA_DELANTE_CM));
  }
  return actual;
}
