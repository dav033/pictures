import { armarNodoSuelto, HUNDIMIENTO_SOBRE_CM, idNuevo, puntoAlMundo, puntoALocal, vectorALocal, type Escena, type EscenaArmada, type MarcoPieza, type NodoArmado, type NodoEscena } from "./escena";
import { puntosSolido } from "./escenografia";
import { entradaDeCatalogo } from "./fondos-escenografia";
import type { Vec3 } from "./modulos";
import type { Pieza } from "./piezas";

/**
 * **Centros de mesa**: una pieza encima de cada mesa, colocada como `sobre` la mesa (en el espacio de la mesa), así que moverla,
 * girarla o cambiarla de sitio lleva su centro con ella. Sirve con cualquier mesa del catálogo, esté o no en un salón armado por
 * `armar_salon`: redonda, imperial, cóctel, de postres… con mantel, con sillas o sin ellas.
 *
 * Por qué una pieza por mesa y no un reparto en anclas (`ancla` + `cada` + `copias`): ese reparto copia UNA pieza en las anclas de
 * OTRA, y una mesa de escenografía no tiene anclas (son los huecos entre globos). Con N mesas hacen falta N piezas más; el tope de
 * la escena (`MAX_NODOS`) lo cuidan las herramientas y los materiales cuentan N veces porque son N piezas reales.
 *
 * Qué es un centro: un nodo `sobre` cuyo id empieza por `centro-` (diseño A) o `centro2-` (diseño B, el que alterna con el A).
 * El diseño es la pieza misma: todos los de una ranura son iguales, y cambiar la ranura los cambia todos a la vez.
 *
 * La altura de la cubierta sale de la geometría de la mesa (el sólido grande más alto), no de una constante: una mesa de cóctel
 * (110 cm), una redonda (75 cm) o una con sillas (cuya caja llega a lo alto del respaldo) dan cada una la suya.
 */

export type TipoMesa = "redonda" | "imperial" | "coctel" | "postres" | "otra";
export const GRUPOS_MESA = ["todas", "redondas", "imperiales", "coctel", "postres", "principal", "invitados"] as const;
export type GrupoMesa = (typeof GRUPOS_MESA)[number];
export type Ranura = 0 | 1;

/** La cara de arriba de una mesa: su centro y sus medidas en el espacio de la mesa, y el centro en el mundo. */
export type Cubierta = { local: Vec3; centro: Vec3; anchoCm: number; fondoCm: number; topeMundo: { minX: number; maxX: number; minZ: number; maxZ: number } };
export type MesaDeEscena = { nodo: NodoEscena; hecho: NodoArmado; marco: MarcoPieza; tipo: TipoMesa; cubierta: Cubierta; conCosas: boolean };

/** Un centro no se pone si ocupa más de esta parte de lo angosto de la cubierta. */
export const OCUPACION_MAXIMA = 0.9;
const RENGLON_CM = 70;
const NOMBRE_PRINCIPAL = /principal|honor|novios|presidi|head/i;
/** Mesas que ya llevan cosas encima de fábrica (regalos, dulces) y juegos de varias mesas, que no admiten un centro. */
const DE_FABRICA_CON_COSAS = /^(mesa_regalos|carrito_dulces)$/;
const JUEGO_DE_MESAS = /^mesas_nido/;

const esCentroId = (id: string) => /^centro2?-/.test(id);
export const esCentro = (n: NodoEscena): boolean => n.colocacion.en === "sobre" && esCentroId(n.id);
export const ranuraDe = (n: NodoEscena): Ranura => (n.id.startsWith("centro2-") ? 1 : 0);
export const centrosDe = (escena: Escena): NodoEscena[] => escena.nodos.filter(esCentro);
export const padreDeCentro = (n: NodoEscena): string | null => (n.colocacion.en === "sobre" ? n.colocacion.padreId : null);

function tipoDeMesa(id: string): TipoMesa {
  if (/^mesa_redonda/.test(id)) return "redonda";
  if (/^mesa_imperial|^mesa_mantel$/.test(id)) return "imperial";
  if (/^mesa_coctel/.test(id)) return "coctel";
  if (/^mesa_postres/.test(id)) return "postres";
  return "otra";
}

/** El mueble del catálogo que es la mesa de este nodo, o null si no es una mesa que admita un centro. */
function muebleDeMesa(n: NodoEscena): string | null {
  if (n.pieza.tipo !== "escenografia") return null;
  const id = n.pieza.mueble?.id;
  if (!id || JUEGO_DE_MESAS.test(id)) return null;
  return entradaDeCatalogo(id)?.grupo === "mesa" ? id : null;
}

/**
 * La cubierta de una mesa armada: entre los sólidos, los que tienen al menos la mitad del área del mayor (la tapa, el sobremantel;
 * no las sillas) y, de ellos, el más alto. Se mide en el espacio de la mesa para que girarla no cambie sus medidas.
 */
function cubiertaDe(hecho: NodoArmado, marco: MarcoPieza): Cubierta | null {
  const piezas = hecho.solidos.filter((s) => !s.oculto).map((s) => {
    const mundo = puntosSolido(s);
    const local = mundo.map((p) => puntoALocal(marco, p));
    const caja = (puntos: Vec3[]) => ({ minX: Math.min(...puntos.map((p) => p.x)), maxX: Math.max(...puntos.map((p) => p.x)), minZ: Math.min(...puntos.map((p) => p.z)), maxZ: Math.max(...puntos.map((p) => p.z)), maxY: Math.max(...puntos.map((p) => p.y)) });
    const l = caja(local), m = caja(mundo);
    return { l, m, area: (l.maxX - l.minX) * (l.maxZ - l.minZ) };
  });
  if (!piezas.length) return null;
  const mayor = Math.max(...piezas.map((p) => p.area));
  const grandes = piezas.filter((p) => p.area >= mayor * 0.5);
  const tope = Math.max(...grandes.map((p) => p.l.maxY));
  const tapa = grandes.filter((p) => p.l.maxY >= tope - 0.01).sort((a, b) => b.area - a.area)[0]!;
  const local: Vec3 = { x: (tapa.l.minX + tapa.l.maxX) / 2, y: tope, z: (tapa.l.minZ + tapa.l.maxZ) / 2 };
  return { local, centro: puntoAlMundo(marco, local), anchoCm: tapa.l.maxX - tapa.l.minX, fondoCm: tapa.l.maxZ - tapa.l.minZ, topeMundo: { minX: tapa.m.minX, maxX: tapa.m.maxX, minZ: tapa.m.minZ, maxZ: tapa.m.maxZ } };
}

/** Las mesas de la escena que admiten un centro, con su cubierta. */
export function mesasDeEscena(escena: Escena, armada: EscenaArmada): MesaDeEscena[] {
  return escena.nodos.flatMap((nodo): MesaDeEscena[] => {
    const id = muebleDeMesa(nodo);
    const hecho = armada.porNodo.find((n) => n.id === nodo.id);
    const marco = hecho?.puestas[0]?.marco;
    if (!id || !hecho || !marco || hecho.copias === 0) return [];
    const cubierta = cubiertaDe(hecho, marco);
    return cubierta ? [{ nodo, hecho, marco, tipo: tipoDeMesa(id), cubierta, conCosas: DE_FABRICA_CON_COSAS.test(id) }] : [];
  });
}

// ----------------------------------------------------------------------------------------------------------
// Qué mesas
// ----------------------------------------------------------------------------------------------------------

/**
 * La mesa principal: la que se llama así (principal, honor, novios…) y, si ninguna, la imperial del fondo del salón (la de menor z;
 * una mesa de postres no cuenta). Vacío si no hay con qué decidirlo.
 */
export function mesasPrincipales(mesas: readonly MesaDeEscena[]): MesaDeEscena[] {
  const nombradas = mesas.filter((m) => NOMBRE_PRINCIPAL.test(`${m.nodo.id} ${m.nodo.nombre}`));
  if (nombradas.length) return nombradas;
  const imperiales = mesas.filter((m) => m.tipo === "imperial");
  const fondo = [...imperiales].sort((a, b) => a.cubierta.centro.z - b.cubierta.centro.z)[0];
  return fondo ? [fondo] : [];
}

const DE_GRUPO: Readonly<Record<Exclude<GrupoMesa, "todas" | "principal" | "invitados">, TipoMesa>> = { redondas: "redonda", imperiales: "imperial", coctel: "coctel", postres: "postres" };

/** Las mesas pedidas: por ids, por grupo, o las dos cosas a la vez (las que cumplen ambas). Sin nada, todas. */
export function seleccionarMesas(mesas: readonly MesaDeEscena[], pedido: { ids?: readonly string[]; grupo?: GrupoMesa }): { mesas: MesaDeEscena[]; error?: string } {
  let elegidas = [...mesas];
  if (pedido.ids?.length) {
    const faltan = pedido.ids.filter((id) => !mesas.some((m) => m.nodo.id === id));
    if (faltan.length) return { mesas: [], error: `No son mesas de la escena: ${faltan.join(", ")}. Mesas: ${mesas.map((m) => m.nodo.id).join(", ") || "(no hay)"}.` };
    elegidas = elegidas.filter((m) => pedido.ids!.includes(m.nodo.id));
  }
  const grupo = pedido.grupo ?? "todas";
  if (grupo === "principal") {
    const principales = mesasPrincipales(mesas);
    if (!principales.length) return { mesas: [], error: "No identifico la mesa principal (ninguna se llama así ni hay una imperial): pásala con mesas = su id." };
    elegidas = elegidas.filter((m) => principales.includes(m));
  } else if (grupo === "invitados") {
    const principales = mesasPrincipales(mesas);
    elegidas = elegidas.filter((m) => (m.tipo === "redonda" || m.tipo === "imperial") && !principales.includes(m));
  } else if (grupo !== "todas") {
    elegidas = elegidas.filter((m) => m.tipo === DE_GRUPO[grupo]);
  }
  return { mesas: elegidas };
}

/**
 * Qué diseño le toca a cada mesa cuando se alternan dos: un tablero de ajedrez por filas (mesas con z parecida) y de izquierda a
 * derecha, así que en una sola fila se alternan A, B, A, B y en una cuadrícula no quedan dos iguales pegadas.
 */
export function ranurasAlternas(mesas: readonly MesaDeEscena[]): Map<string, Ranura> {
  const porZ = [...mesas].sort((a, b) => a.cubierta.centro.z - b.cubierta.centro.z || a.cubierta.centro.x - b.cubierta.centro.x);
  const filas: MesaDeEscena[][] = [];
  for (const m of porZ) {
    const fila = filas.at(-1);
    if (fila && Math.abs(m.cubierta.centro.z - fila[0]!.cubierta.centro.z) <= RENGLON_CM) fila.push(m); else filas.push([m]);
  }
  const salida = new Map<string, Ranura>();
  filas.forEach((fila, r) => [...fila].sort((a, b) => a.cubierta.centro.x - b.cubierta.centro.x).forEach((m, c) => salida.set(m.nodo.id, ((r + c) % 2) as Ranura)));
  return salida;
}

// ----------------------------------------------------------------------------------------------------------
// Poner un centro
// ----------------------------------------------------------------------------------------------------------

/** Por qué una mesa ya no admite un centro sin forzar: lleva algo encima (regalos, un pastel, otra pieza apoyada), o null. */
export function cosaEncima(escena: Escena, armada: EscenaArmada, mesa: MesaDeEscena): string | null {
  if (mesa.conCosas) return "ya trae cosas encima de fábrica";
  const t = mesa.cubierta.topeMundo, cara = mesa.cubierta.centro.y;
  for (const n of escena.nodos) {
    if (n.id === mesa.nodo.id || esCentro(n)) continue;
    if (n.colocacion.en === "sobre" && n.colocacion.padreId === mesa.nodo.id) return `lleva «${n.nombre}» encima`;
    const hecho = armada.porNodo.find((x) => x.id === n.id);
    if (!hecho || hecho.copias === 0 || muebleDeMesa(n)) continue;
    const c = hecho.caja;
    const cx = (c.min.x + c.max.x) / 2, cz = (c.min.z + c.max.z) / 2;
    if (c.min.y >= cara - 3 && c.min.y <= cara + 4 && cx >= t.minX - 5 && cx <= t.maxX + 5 && cz >= t.minZ - 5 && cz <= t.maxZ + 5) return `lleva «${n.nombre}» encima`;
  }
  return null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * El nodo del centro de esta mesa: `sobre` la mesa, en el centro de su cubierta con la base justo en ella (el hundimiento del látex
 * se compensa para que no quede enterrado), o el motivo por el que no se pudo (no cabe, no sube al techo, no se arma).
 * `escena` es la escena de trabajo (con los centros ya puestos en esta misma llamada); `armada`, la de la mesa antes de empezar;
 * `como.nombre` es el nombre completo que se ve en la lista.
 */
export function centroDeMesa(escena: Escena, armada: EscenaArmada, mesa: MesaDeEscena, pieza: Pieza, como: { ranura: Ranura; nombre: string; /** Conserva el id de un centro que se rehace. */ id?: string }): { nodo: NodoEscena } | { motivo: string } {
  const normal = vectorALocal(mesa.marco, { x: 0, y: 1, z: 0 });
  let punto: Vec3 = { x: mesa.cubierta.local.x, y: mesa.cubierta.local.y + HUNDIMIENTO_SOBRE_CM, z: mesa.cubierta.local.z };
  const nodoCon = (p: Vec3): NodoEscena => ({
    id: como.id ?? idNuevo(escena, `centro${como.ranura ? "2" : ""}-${mesa.nodo.id}`), nombre: como.nombre, pieza,
    colocacion: { en: "sobre", padreId: mesa.nodo.id, puntoCm: { x: r1(p.x), y: r1(p.y), z: r1(p.z) }, normal: { x: r1(normal.x), y: r1(normal.y), z: r1(normal.z) }, giroGrados: 0 },
  });
  let nodo = nodoCon(punto);
  let armado = armarNodoSuelto(escena, armada, nodo);
  // Centrado: lo armado cae donde su caja, no donde su origen; se corre lo que falte (dos pasadas bastan).
  for (let pasada = 0; pasada < 2 && armado.copias > 0; pasada++) {
    const dx = mesa.cubierta.centro.x - (armado.caja.min.x + armado.caja.max.x) / 2, dz = mesa.cubierta.centro.z - (armado.caja.min.z + armado.caja.max.z) / 2;
    if (Math.hypot(dx, dz) < 0.3) break;
    const d = vectorALocal(mesa.marco, { x: dx, y: 0, z: dz });
    punto = { x: punto.x + d.x, y: punto.y, z: punto.z + d.z };
    nodo = nodoCon(punto);
    armado = armarNodoSuelto(escena, armada, nodo);
  }
  if (armado.copias === 0) return { motivo: `no se pudo armar sobre la mesa (${armado.avisos[0] ?? "sin motivo"})` };
  const ancho = armado.caja.max.x - armado.caja.min.x, fondo = armado.caja.max.z - armado.caja.min.z;
  const largo = Math.max(ancho, fondo), angosto = Math.min(mesa.cubierta.anchoCm, mesa.cubierta.fondoCm);
  if (largo > angosto * OCUPACION_MAXIMA) return { motivo: `no cabe: mide ${Math.round(largo)} cm y la cubierta tiene ${Math.round(angosto)} cm de lo angosto (máximo ${Math.round(angosto * OCUPACION_MAXIMA)} cm)` };
  if (armado.caja.max.y > escena.sala.altoCm) return { motivo: `llegaría a ${Math.round(armado.caja.max.y)} cm y el techo está a ${Math.round(escena.sala.altoCm)} cm` };
  return { nodo };
}
