import { descendientes, type Colocacion, type Escena, type NodoEscena } from "./escena";
import { muebleDe } from "./mobiliario-catalogo";
import { opcionesDeMueble, piezaDeMueble } from "./mobiliario-pieza";
import { fallar } from "./herramientas-escena-colores";
import { MESAS_SALON, type ElementoSalon, type TipoMesaSalon } from "./salon-evento";
import { esDeZona, esMesaDeInvitados, type ZonaSalon } from "./salon-zonas";

/** Las piezas de un salón: de un elemento de la distribución a un nodo de escena, y las ediciones sencillas de sus nodos. */

/** Colores (`#rrggbb`) del salón en el orden del conjunto de mesa: mantel, sillas, cojines. Los que faltan, los de partida del catálogo. */
export type PaletaSalon = readonly string[];

const ORO = "#d6b25a";
const CREMA = "#e9e2d6";
const PISTA = "#232328";

const sinHuecos = (...valores: Array<string | undefined>): string[] => {
  const salida: string[] = [];
  for (const v of valores) { if (v === undefined) break; salida.push(v); }
  return salida;
};

/** Los colores de una pieza del salón según lo que es. */
function coloresDe(e: ElementoSalon, paleta: PaletaSalon): string[] {
  const [mantel, sillas, cojin] = paleta;
  switch (e.mueble) {
    case "silla_tiffany": return sinHuecos(sillas, cojin);
    case "marco_tela": return [sillas ?? ORO, mantel ?? "#f7f6f2"];
    case "alfombra_redonda": return e.zona === "pista" ? [PISTA] : [mantel ?? CREMA, sillas ?? mantel ?? CREMA];
    case "mesa_imperial_mantel":
    case "mesa_postres_mantel": return sinHuecos(mantel);
    default: return sinHuecos(mantel, sillas, cojin);
  }
}

const NOMBRE_ZONA: Readonly<Record<ZonaSalon, string>> = {
  mesa_principal: "Mesa principal", pista: "Pista de baile", mesa_postres: "Mesa de postres", fondo_fotos: "Fondo de fotos", entrada: "Tapete de entrada",
};

function nombreDe(e: ElementoSalon): string {
  if (e.zona === null) return `Mesa ${Number(e.id.slice(-2))}`;
  return e.mueble === "silla_tiffany" ? `Silla principal ${e.id.slice(e.id.lastIndexOf("-") + 1)}` : NOMBRE_ZONA[e.zona];
}

/** El nodo de escena de un elemento del salón, con la paleta pedida. */
export function nodoDeElemento(e: ElementoSalon, paleta: PaletaSalon): NodoEscena {
  const m = muebleDe(e.mueble) ?? fallar(`Falta «${e.mueble}» en el catálogo de mobiliario.`);
  const acabado = e.zona === "pista" ? "brillante" as const : undefined;
  const opciones = opcionesDeMueble(m, { anchoCm: e.anchoCm, fondoCm: e.fondoCm, altoCm: e.altoCm, colores: coloresDe(e, paleta), ...(acabado ? { acabado } : {}) });
  return { id: e.id, nombre: nombreDe(e), pieza: piezaDeMueble(m, opciones), colocacion: { en: "piso", xCm: Math.round(e.xCm), zCm: Math.round(e.zCm), giroGrados: e.giroGrados } };
}

/** El tipo de mesa de invitados que es esa pieza, o null si no es de las del salón. */
export function tipoDeMesa(n: NodoEscena): TipoMesaSalon | null {
  const id = n.pieza.tipo === "escenografia" ? n.pieza.mueble?.id : undefined;
  return (Object.keys(MESAS_SALON) as TipoMesaSalon[]).find((t) => MESAS_SALON[t].mueble === id) ?? null;
}

/** Las mesas de invitados de la escena, en su orden. */
export const mesasDeInvitados = (escena: Escena): NodoEscena[] => escena.nodos.filter((n) => esMesaDeInvitados(n.id)).sort((a, b) => a.id.localeCompare(b.id));

/** Los colores con que están hechas las mesas de invitados (de la primera), para que las nuevas o de otro tipo queden iguales. */
export function paletaDeMesas(escena: Escena): PaletaSalon {
  const primera = mesasDeInvitados(escena)[0];
  return primera?.pieza.tipo === "escenografia" ? primera.pieza.mueble?.opciones?.colores ?? [] : [];
}

/** Quita esos nodos y lo que está sobre o colgado de ellos (el centro de una mesa que se quita se va con la mesa). Devuelve la escena y cuántas piezas de más salieron. */
export function quitarConLoSuyo(escena: Escena, ids: readonly string[]): { escena: Escena; deMas: number } {
  const fuera = new Set<string>();
  for (const id of ids) for (const d of descendientes(escena, id)) fuera.add(d);
  const nodos = escena.nodos.filter((n) => !fuera.has(n.id));
  const pedidos = new Set(ids);
  return { escena: { ...escena, nodos }, deMas: escena.nodos.filter((n) => fuera.has(n.id) && !pedidos.has(n.id)).length };
}

/** Corre un nodo (x, z) lo que dicen; lo que cuelga o va sobre otra pieza la acompaña solo. */
export function desplazarNodo(n: NodoEscena, dx: number, dz: number): NodoEscena {
  const c = n.colocacion;
  const colocacion: Colocacion = c.en === "piso" || c.en === "libre" || c.en === "techo" ? { ...c, xCm: Math.round(c.xCm + dx), zCm: Math.round(c.zCm + dz) }
    : c.en === "pared" ? { ...c, aLoLargoCm: Math.round(c.aLoLargoCm + dx) } : c;
  return { ...n, colocacion };
}

/** Los ids de las piezas de una zona (la principal y lo que la acompaña). */
export const idsDeZona = (escena: Escena, zona: ZonaSalon): string[] => escena.nodos.filter((n) => esDeZona(n.id, zona)).map((n) => n.id);
