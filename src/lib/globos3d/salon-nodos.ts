import { descendientes, type Colocacion, type Escena, type NodoEscena } from "./escena";
import { fallar } from "./herramientas-escena-colores";
import { muebleDe } from "./mobiliario-catalogo";
import { opcionesDeMueble, piezaDeMueble } from "./mobiliario-pieza";
import { grupoDeSillasDe } from "./mobiliario-asientos-mesa";
import { esMesaParametrica, mesaDePieza, sillasDePieza } from "./mobiliario-conjunto";
import { conjuntoDeMesaSalon } from "./salon-mesa-parametrica";
import { MESAS_SALON, TIPOS_MESA_SALON, type ElementoSalon, type TipoMesaSalon } from "./salon-evento";
import { anotarPieza, conPieza, idLibre, mesasVivas, sinAnotar, type PiezaSalon, type RegistroSalon } from "./salon-registro";

/** Las piezas de un salón: de un elemento de la distribución a un nodo de escena registrado, y las ediciones sencillas de sus nodos. */

/** Colores (`#rrggbb`) del salón en el orden del conjunto de mesa: mantel, sillas, cojines. */
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

function tipoMesaDeElemento(e: ElementoSalon): TipoMesaSalon | null {
  if (e.rol !== "mesa") return null;
  return TIPOS_MESA_SALON.find((tipo) => MESAS_SALON[tipo].mueble === e.mueble) ?? null;
}

/** La mesa paramétrica y su grupo de sillas para un elemento de la distribución del salón. */
export function conjuntoDeElementoSalon(e: ElementoSalon, paleta: PaletaSalon, ids: { mesa: string; sillas: string }, ranura?: number) {
  const tipo = tipoMesaDeElemento(e);
  if (!tipo) return null;
  return conjuntoDeMesaSalon({ tipo, ...(e.sillas !== undefined ? { sillas: e.sillas } : {}), ids, xCm: e.xCm, zCm: e.zCm, giroGrados: e.giroGrados, paleta, nombre: nombreDe(e, ranura) });
}

/** El nodo de un elemento del salón con la paleta pedida y el id que se le dé. */
export function nodoDeElemento(e: ElementoSalon, paleta: PaletaSalon, id: string, ranura?: number): NodoEscena {
  const conjunto = conjuntoDeElementoSalon(e, paleta, { mesa: id, sillas: `${id}-sillas` }, ranura);
  if (conjunto) return conjunto.mesa;
  const m = muebleDe(e.mueble) ?? fallar(`Falta «${e.mueble}» en el catálogo de mobiliario.`);
  const acabado = e.zona === "pista" ? "brillante" as const : undefined;
  const opciones = opcionesDeMueble(m, { anchoCm: e.anchoCm, fondoCm: e.fondoCm, altoCm: e.altoCm, colores: coloresDe(e, paleta), ...(acabado ? { acabado } : {}), ...(e.sillas !== undefined ? { sillas: e.sillas } : {}) });
  return { id, nombre: nombreDe(e, ranura), pieza: piezaDeMueble(m, opciones), colocacion: { en: "piso", xCm: Math.round(e.xCm), zCm: Math.round(e.zCm), giroGrados: e.giroGrados } };
}

/** Pone un elemento en la escena con un id libre y lo anota en el registro (mesas y anclas guardan la posición que se les dio). */
export function ponerElemento(escena: Escena, e: ElementoSalon, paleta: PaletaSalon, inicial: Omit<RegistroSalon, "piezas">, ranura?: number): Escena {
  if (tipoMesaDeElemento(e)) {
    const id = idLibre(escena, e.id);
    const conjunto = conjuntoDeElementoSalon(e, paleta, { mesa: id, sillas: idLibre(escena, `${id}-sillas`) }, ranura);
    if (conjunto) {
      const c = conjunto.mesa.colocacion;
      const info: PiezaSalon = { zona: "mesas", rol: "mesa", ...(ranura !== undefined ? { ranura } : {}), ...(c.en === "piso" ? { pos: { x: c.xCm, z: c.zCm } } : {}) };
      let resultado = conPieza(escena, conjunto.mesa, info, inicial);
      if (conjunto.sillas) resultado = conPieza(resultado, conjunto.sillas, { zona: "mesas", rol: "grupo_sillas" }, inicial);
      return resultado;
    }
  }
  const nodo = nodoDeElemento(e, paleta, idLibre(escena, e.id), ranura);
  const c = nodo.colocacion;
  const info: PiezaSalon = {
    zona: e.zona ?? "mesas", rol: e.rol, ...(ranura !== undefined ? { ranura } : {}),
    ...(e.rol !== "silla" && c.en === "piso" ? { pos: { x: c.xCm, z: c.zCm } } : {}),
  };
  return conPieza(escena, nodo, info, inicial);
}

/** Reemplaza la mesa y su grupo de sillas juntos, conservando ids, posición, giro y ranura del salón. */
export function reemplazarMesaDelSalon(escena: Escena, e: ElementoSalon, paleta: PaletaSalon, mesaId: string, ranura?: number, agregarGrupoSiFalta = false): Escena {
  const mesa = escena.nodos.find((n) => n.id === mesaId);
  if (!mesa || mesa.colocacion.en !== "piso") return fallar(`No encontré la mesa de salón «${mesaId}» en el piso.`);
  const grupoAnterior = grupoDeSillasDe(escena, mesaId);
  const idSillas = grupoAnterior?.id ?? idLibre(escena, `${mesaId}-sillas`);
  const conjunto = conjuntoDeElementoSalon({ ...e, xCm: mesa.colocacion.xCm, zCm: mesa.colocacion.zCm, giroGrados: mesa.colocacion.giroGrados }, paleta, { mesa: mesaId, sillas: idSillas }, ranura);
  if (!conjunto) return fallar(`No pude reconstruir el conjunto paramétrico de «${mesaId}».`);
  const debeTenerGrupo = Boolean(grupoAnterior) || !esMesaParametrica(mesa.pieza) || agregarGrupoSiFalta;
  const grupoSillas = debeTenerGrupo ? conjunto.sillas : null;
  if (debeTenerGrupo && !grupoSillas) return fallar(`No pude reconstruir las sillas de «${mesaId}».`);
  const nodos = escena.nodos.flatMap((n) => {
    if (n.id === mesaId) return [conjunto.mesa, ...(!grupoAnterior && grupoSillas ? [grupoSillas] : [])];
    if (grupoAnterior && n.id === grupoAnterior.id) return grupoSillas ? [grupoSillas] : [];
    return [n];
  });
  const resultado = { ...escena, nodos };
  return grupoSillas ? anotarPieza(resultado, grupoSillas.id, { zona: "mesas", rol: "grupo_sillas" }) : resultado;
}

/** El tipo de mesa de invitados que es esa pieza, o null si no es de las del salón. */
export function tipoDeMesa(n: NodoEscena): TipoMesaSalon | null {
  const id = n.pieza.tipo === "escenografia" ? n.pieza.mueble?.id : undefined;
  return (Object.keys(MESAS_SALON) as TipoMesaSalon[]).find((t) => MESAS_SALON[t].mueble === id) ?? null;
}

/** Los colores con que están hechas las mesas de invitados (de la primera), para que las nuevas o de otro tipo queden iguales. */
export function paletaDeMesas(escena: Escena): PaletaSalon {
  const primera = mesasVivas(escena)[0]?.nodo;
  if (primera && esMesaParametrica(primera.pieza)) {
    const mesa = mesaDePieza(primera.pieza);
    const grupo = mesasVivas(escena).map((v) => grupoDeSillasDe(escena, v.nodo.id)).find((g) => g !== null);
    const sillas = grupo ? sillasDePieza(grupo.pieza) : null;
    if (!mesa) return [];
    return [mesa.colorMantel, sillas?.colorEstructura ?? "", ...(sillas?.colorCojin ? [sillas.colorCojin] : [])];
  }
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
 * Quita un grupo paramétrico añadido encima de una mesa fija antigua que ya trae sus sillas en `opciones.sillas`. Los conjuntos paramétricos
 * del salón mantienen su grupo. Devuelve la escena y cuántos grupos salieron (una escena guardada antes de la guarda de `cambiar_sillas`).
 */
export function sinGruposSobreMesasDelSalon(escena: Escena): { escena: Escena; quitados: number } {
  const ids = mesasVivas(escena).flatMap((v) => {
    if (esMesaParametrica(v.nodo.pieza)) return [];
    const g = grupoDeSillasDe(escena, v.nodo.id);
    return g ? [g.id] : [];
  });
  if (!ids.length) return { escena, quitados: 0 };
  return { escena: { ...escena, nodos: escena.nodos.filter((n) => !ids.includes(n.id)) }, quitados: ids.length };
}
