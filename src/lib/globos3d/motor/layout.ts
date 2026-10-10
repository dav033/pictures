import { SALA_INICIAL, type Colocacion, type Sala } from "../escena";
import type { LugarEspec, PiezaEspec } from "./espec-cliente-v1";
import { medidasDe } from "./medidas-espec";
import type { Apoyo } from "./constructores-organicos";

/**
 * **Dónde va cada pieza en la sala.** El cliente dice un lugar (`centro`, `izquierda`, `derecha`, `fondo`, `techo`,
 * `mesa`), no coordenadas: aquí se reparten en filas dentro de `SALA_INICIAL` según lo que mide cada una. Las piezas
 * del mismo lugar se ponen una al lado de la otra; las de la izquierda y la derecha salen hacia afuera del centro. Si
 * hay piezas a los dos lados, entre las dos orillas de adentro queda al menos el ancho de una entrada, y no menos que
 * lo que ocupa el centro: dos columnas flanquean el claro, no se pegan entre sí. Si no caben, la sala se ensancha:
 * nada se encima.
 */
export type ItemDeLayout = {
  id: string; lugar: LugarEspec; apoyo: Apoyo; anchoCm: number;
  /** Altura del borde de abajo de lo que cuelga de la pared. */
  alturaPared: number;
  /** Lo alto que es la caja de la pieza (cm): la sala se levanta si la pieza más alta no cabe en la altura por defecto. */
  alturaCm: number;
};

const SEPARACION_CM = 40;
/** El claro de una entrada entre dos columnas (lo común es 2 a 2,5 m): con la inclinación hacia adentro, las puntas siguen separadas. */
const CLARO_ENTRE_LADOS_CM = 240;
const MARGEN_SALA_CM = 60;
/** Holgura entre lo más alto de la pieza y el techo de la sala (cm). */
const HOLGURA_TECHO_CM = 20;
const Z_PIEZAS_DE_PISO = -160;
const Z_MESA = 40;

export function anchoEstimadoCm(pieza: PiezaEspec): number {
  const m = medidasDe(pieza);
  const columna = pieza.oficial.startsWith("columna");
  if (columna) return Math.round(((m.grosorM ?? m.anchoM ?? 0.7) * 100) + 20);
  if (pieza.oficial === "guirnalda") return Math.round((m.largoM ?? m.anchoM ?? 2.5) * 100);
  if (pieza.oficial === "bouquet" || pieza.oficial === "figura") return 80;
  return Math.round((m.anchoM ?? m.largoM ?? 1) * 100 + 60);
}

/** Posición x de cada pieza de una fila: el centro contiguo alrededor de x = 0, la izquierda y la derecha hacia afuera. */
function filaX(items: readonly ItemDeLayout[]): Map<string, number> {
  const x = new Map<string, number>();
  const de = (lugar: LugarEspec) => items.filter((i) => i.lugar === lugar);
  const centro = items.filter((i) => i.lugar !== "izquierda" && i.lugar !== "derecha");
  const anchoCentro = centro.reduce((suma, i) => suma + i.anchoCm, 0) + SEPARACION_CM * Math.max(0, centro.length - 1);
  let cursor = -anchoCentro / 2;
  for (const i of centro) { x.set(i.id, Math.round(cursor + i.anchoCm / 2)); cursor += i.anchoCm + SEPARACION_CM; }
  const hayAmbosLados = de("izquierda").length > 0 && de("derecha").length > 0;
  const borde = Math.max(anchoCentro / 2 + (centro.length ? SEPARACION_CM : 0), hayAmbosLados ? CLARO_ENTRE_LADOS_CM / 2 : 0);
  let izquierda = borde;
  for (const i of de("izquierda")) { x.set(i.id, -Math.round(izquierda + i.anchoCm / 2)); izquierda += i.anchoCm + SEPARACION_CM; }
  let derecha = borde;
  for (const i of de("derecha")) { x.set(i.id, Math.round(derecha + i.anchoCm / 2)); derecha += i.anchoCm + SEPARACION_CM; }
  return x;
}

const extension = (items: readonly ItemDeLayout[], x: ReadonlyMap<string, number>) => Math.max(0, ...items.map((i) => Math.abs(x.get(i.id) ?? 0) + i.anchoCm / 2));

export function distribuir(items: readonly ItemDeLayout[]): { sala: Sala; colocaciones: Map<string, Colocacion> } {
  const de = (apoyo: Apoyo, mesa: boolean) => items.filter((i) => i.apoyo === apoyo && (i.lugar === "mesa") === mesa);
  const piso = de("piso", false), mesa = de("piso", true), pared = [...de("pared", false), ...de("pared", true)], techo = [...de("techo", false), ...de("techo", true)];
  const xPiso = filaX(piso), xMesa = filaX(mesa), xPared = filaX(pared), xTecho = filaX(techo);
  const mitadAncho = Math.max(extension(piso, xPiso), extension(mesa, xMesa), extension(pared, xPared), extension(techo, xTecho)) + MARGEN_SALA_CM;
  const topeMasAlto = Math.max(0, ...items.map((i) => (i.apoyo === "techo" ? i.alturaCm : i.alturaPared + i.alturaCm)));
  const altoCm = Math.max(SALA_INICIAL.altoCm, Math.ceil(topeMasAlto + HOLGURA_TECHO_CM));
  const sala: Sala = { ...SALA_INICIAL, tonos: { ...SALA_INICIAL.tonos }, mostrar: { ...SALA_INICIAL.mostrar }, anchoCm: Math.max(SALA_INICIAL.anchoCm, Math.round(mitadAncho * 2)), altoCm };
  const colocaciones = new Map<string, Colocacion>();
  for (const i of piso) colocaciones.set(i.id, { en: "piso", xCm: xPiso.get(i.id) ?? 0, zCm: Z_PIEZAS_DE_PISO, giroGrados: 0 });
  for (const i of mesa) colocaciones.set(i.id, { en: "piso", xCm: xMesa.get(i.id) ?? 0, zCm: Z_MESA, giroGrados: 0 });
  for (const i of pared) colocaciones.set(i.id, { en: "pared", pared: "fondo", aLoLargoCm: xPared.get(i.id) ?? 0, alturaCm: i.alturaPared });
  for (const i of techo) colocaciones.set(i.id, { en: "techo", xCm: xTecho.get(i.id) ?? 0, zCm: 0, cuelgaCm: 0, giroGrados: 0, volteada: false });
  return { sala, colocaciones };
}
