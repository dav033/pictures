import { descendientes, type Colocacion, type Escena, type NodoEscena } from "./escena";
import { fallar } from "./herramientas-escena-colores";
import { muebleDe } from "./mobiliario-catalogo";
import { opcionesDeMueble, piezaDeMueble } from "./mobiliario-pieza";
import { grupoDeSillasDe } from "./mobiliario-asientos-mesa";
import { MESAS_SALON, type ElementoSalon, type TipoMesaSalon } from "./salon-evento";
import { conPieza, idLibre, mesasVivas, sinAnotar, type PiezaSalon, type RegistroSalon } from "./salon-registro";

/** Las piezas de un salón: de un elemento de la distribución a un nodo de escena registrado, y las ediciones sencillas de sus nodos. */

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

const NOMBRE_ZONA = {
  mesa_principal: "Mesa principal", pista: "Pista de baile", mesa_postres: "Mesa de postres", fondo_fotos: "Fondo de fotos", entrada: "Tapete de entrada",
} as const;

function nombreDe(e: ElementoSalon, ranura: number | undefined): string {
  if (e.zona === null) return `Mesa ${ranura ?? ""}`.trim();
  return e.rol === "silla" ? `Silla principal ${e.id.slice(e.id.lastIndexOf("-") + 1)}` : NOMBRE_ZONA[e.zona];
}

/** El nodo de un elemento del salón con la paleta pedida y el id que se le dé. */
export function nodoDeElemento(e: ElementoSalon, paleta: PaletaSalon, id: string, ranura?: number): NodoEscena {
  const m = muebleDe(e.mueble) ?? fallar(`Falta «${e.mueble}» en el catálogo de mobiliario.`);
  const acabado = e.zona === "pista" ? "brillante" as const : undefined;
  const opciones = opcionesDeMueble(m, { anchoCm: e.anchoCm, fondoCm: e.fondoCm, altoCm: e.altoCm, colores: coloresDe(e, paleta), ...(acabado ? { acabado } : {}), ...(e.sillas !== undefined ? { sillas: e.sillas } : {}) });
  return { id, nombre: nombreDe(e, ranura), pieza: piezaDeMueble(m, opciones), colocacion: { en: "piso", xCm: Math.round(e.xCm), zCm: Math.round(e.zCm), giroGrados: e.giroGrados } };
}

/** Pone un elemento en la escena con un id libre y lo anota en el registro (mesas y anclas guardan la posición que se les dio). */
export function ponerElemento(escena: Escena, e: ElementoSalon, paleta: PaletaSalon, inicial: Omit<RegistroSalon, "piezas">, ranura?: number): Escena {
  const nodo = nodoDeElemento(e, paleta, idLibre(escena, e.id), ranura);
  const c = nodo.colocacion;
  const info: PiezaSalon = {
    zona: e.zona ?? "mesas", rol: e.rol, ...(ranura !== undefined ? { ranura } : {}),
    ...(e.rol !== "silla" && c.en === "piso" ? { pos: { x: c.xCm, z: c.zCm } } : {}),
  };
  return conPieza(escena, nodo, info, inicial);
}

/** El tipo de mesa de invitados que es esa pieza, o null si no es de las del salón. */
export function tipoDeMesa(n: NodoEscena): TipoMesaSalon | null {
  const id = n.pieza.tipo === "escenografia" ? n.pieza.mueble?.id : undefined;
  return (Object.keys(MESAS_SALON) as TipoMesaSalon[]).find((t) => MESAS_SALON[t].mueble === id) ?? null;
}

/** Los colores con que están hechas las mesas de invitados (de la primera), para que las nuevas o de otro tipo queden iguales. */
export function paletaDeMesas(escena: Escena): PaletaSalon {
  const primera = mesasVivas(escena)[0]?.nodo;
  return primera?.pieza.tipo === "escenografia" ? primera.pieza.mueble?.opciones?.colores ?? [] : [];
}

/**
 * Quita esos nodos, lo que está sobre o colgado de ellos (el centro de una mesa que se quita se va con la mesa) y sus anotaciones.
 * Devuelve la escena y cuántas piezas de más salieron.
 */
export function quitarConLoSuyo(escena: Escena, ids: readonly string[]): { escena: Escena; deMas: number } {
  const fuera = new Set<string>();
  for (const id of ids) for (const d of descendientes(escena, id)) fuera.add(d);
  const pedidos = new Set(ids);
  const sinNodos: Escena = { ...escena, nodos: escena.nodos.filter((n) => !fuera.has(n.id)) };
  return { escena: sinAnotar(sinNodos, [...fuera]), deMas: escena.nodos.filter((n) => fuera.has(n.id) && !pedidos.has(n.id)).length };
}

/** Corre un nodo (x, z) lo que dicen; lo que cuelga o va sobre otra pieza la acompaña solo. */
export function desplazarNodo(n: NodoEscena, dx: number, dz: number): NodoEscena {
  const c = n.colocacion;
  const colocacion: Colocacion = c.en === "piso" || c.en === "libre" || c.en === "techo" ? { ...c, xCm: Math.round(c.xCm + dx), zCm: Math.round(c.zCm + dz) }
    : c.en === "pared" ? { ...c, aLoLargoCm: Math.round(c.aLoLargoCm + dx) } : c;
  return { ...n, colocacion };
}

/**
 * Quita el grupo de sillas paramétrico que haya sobre una mesa del salón: esas mesas ya traen sus sillas dentro (`opciones.sillas`), y con un grupo
 * encima se dibujarían las dos veces. Devuelve la escena y cuántos grupos salieron (una escena guardada antes de la guarda de `cambiar_sillas`).
 */
export function sinGruposSobreMesasDelSalon(escena: Escena): { escena: Escena; quitados: number } {
  const ids = mesasVivas(escena).flatMap((v) => { const g = grupoDeSillasDe(escena, v.nodo.id); return g ? [g.id] : []; });
  if (!ids.length) return { escena, quitados: 0 };
  return { escena: { ...escena, nodos: escena.nodos.filter((n) => !ids.includes(n.id)) }, quitados: ids.length };
}
