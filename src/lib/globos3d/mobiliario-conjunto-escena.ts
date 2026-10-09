import { armarEscena, idNuevo, puntoALocal, puntoAlMundo, type Escena, type NodoEscena } from "./escena";
import { muebleDe } from "./mobiliario-catalogo";
import { esquivarEnElPiso } from "./mobiliario-colocar";
import { dentroDelContorno } from "./mobiliario-contornos";
import {
  armarConjuntoMesa, colocacionDeSillas, esGrupoDeSillas, esMesaParametrica, mesaDePieza, nombreDeMesa, nombreDeSillas, piezaDeMesa, piezaDeSillas, sillasDePieza, sillasParaMesa,
  type PedidoSillas,
} from "./mobiliario-conjunto";
import { NOMBRE_MESA, normalizarMesa, PARTIDA_MESA, type MesaGuardada } from "./mobiliario-conjunto-tipos";
import { superficieDeMesa } from "./mobiliario-mesas-param";
import { normalizarOpciones } from "./mobiliario-pieza";
import { SILLAS } from "./mobiliario-sillas-param";
import type { PiezaArmada } from "./piezas";

/**
 * **El conjunto de mesa dentro de una escena** (REQ-012): encontrar la mesa de unas sillas y las sillas de una mesa, cambiar las
 * sillas o la mesa dejando lo demás en su sitio (lo que está sobre la tapa se reubica), pasar a conjunto paramétrico los fijos de
 * antes (`mesa_redonda_sillas`, `mesa_imperial_sillas`), repartir varios conjuntos en cuadrícula y contar mesas y sillas de
 * verdad. Puro: sin red ni React.
 */

const CACHE = new Map<string, PiezaArmada>();

export type Conjunto = { mesa: NodoEscena; sillas: NodoEscena | null };

/** El grupo de sillas de una mesa (el nodo `sobre` ella con `mueble.sillas`), o null. */
export function sillasDeMesa(escena: Escena, mesaId: string): NodoEscena | null {
  return escena.nodos.find((n) => n.colocacion.en === "sobre" && n.colocacion.padreId === mesaId && esGrupoDeSillas(n.pieza)) ?? null;
}

/** El conjunto al que pertenece un id (el de la mesa o el de sus sillas), o null si no es una mesa paramétrica. */
export function conjuntoDe(escena: Escena, id: string): Conjunto | null {
  const nodo = escena.nodos.find((n) => n.id === id);
  if (!nodo) return null;
  if (esMesaParametrica(nodo.pieza)) return { mesa: nodo, sillas: sillasDeMesa(escena, nodo.id) };
  if (esGrupoDeSillas(nodo.pieza) && nodo.colocacion.en === "sobre") {
    const padreId = nodo.colocacion.padreId;
    const mesa = escena.nodos.find((n) => n.id === padreId);
    return mesa && esMesaParametrica(mesa.pieza) ? { mesa, sillas: nodo } : null;
  }
  return null;
}

/** Todos los conjuntos paramétricos de la escena, en su orden. */
export const conjuntosDe = (escena: Escena): Conjunto[] => escena.nodos.filter((n) => esMesaParametrica(n.pieza)).map((mesa) => ({ mesa, sillas: sillasDeMesa(escena, mesa.id) }));

// ----------------------------------------------------------------------------------------------------------
// Los fijos de antes
// ----------------------------------------------------------------------------------------------------------

const LEGACY: Readonly<Record<string, { sillas: number; cabeceras: boolean }>> = { mesa_redonda_sillas: { sillas: 8, cabeceras: false }, mesa_imperial_sillas: { sillas: 10, cabeceras: true } };

/** ¿Es uno de los conjuntos fijos de antes (una sola pieza con sus sillas Tiffany)? */
export const esConjuntoFijo = (n: NodoEscena): boolean => n.pieza.tipo === "escenografia" && Boolean(n.pieza.mueble && !n.pieza.mueble.mesa && n.pieza.mueble.id in LEGACY);

/**
 * Pasa un conjunto fijo (`mesa_redonda_sillas`, `mesa_imperial_sillas`) a mesa paramétrica con su grupo de sillas, en el mismo
 * sitio y con los mismos colores y medidas de mesa (la mesa conserva el id). Las sillas vuelven a sus 8 o 10 de siempre
 * (4 + 4 + una en cada cabecera en la imperial); la mesa y las sillas miden lo mismo salvo unos milímetros. Null si no es uno de ellos.
 */
export function pasarAConjunto(escena: Escena, id: string, notas: string[] = []): Escena | null {
  const nodo = escena.nodos.find((n) => n.id === id);
  const mueble = nodo && nodo.pieza.tipo === "escenografia" ? nodo.pieza.mueble : undefined;
  const fijo = mueble ? LEGACY[mueble.id] : undefined;
  const m = mueble ? muebleDe(mueble.id) : undefined;
  if (!nodo || !mueble || !fijo || !m || mueble.mesa) return null;
  const o = normalizarOpciones(m, mueble.opciones);
  const alto = (o.altoCm * 75) / 90;
  const mesa = mueble.id === "mesa_redonda_sillas"
    ? normalizarMesa({ tipo: "redonda", anchoCm: Math.max(60, Math.min(o.anchoCm, o.fondoCm) - 120), altoCm: alto, mantel: "piso", colorMantel: o.colores[0] })
    : normalizarMesa({ tipo: "rectangular", anchoCm: Math.max(120, o.anchoCm - 120), fondoCm: Math.max(60, o.fondoCm - 108), altoCm: alto, mantel: "piso", colorMantel: o.colores[0] });
  const hecho = sillasParaMesa(mesa, { cantidad: fijo.sillas, tipo: "tiffany", colorEstructura: o.colores[1], colorCojin: o.colores[2], disposicion: "alrededor" });
  if (hecho.nota) notas.push(`«${id}»: ${hecho.nota}`);
  const nodoMesa: NodoEscena = { ...nodo, nombre: nombreDeMesa(mesa), pieza: piezaDeMesa(mesa) };
  const sinMesa = { ...escena, nodos: escena.nodos.map((n) => (n.id === id ? nodoMesa : n)) };
  return hecho.sillas ? conSillasNuevas(sinMesa, nodoMesa, hecho.sillas) : sinMesa;
}

function conSillasNuevas(escena: Escena, mesa: NodoEscena, sillas: NonNullable<ReturnType<typeof sillasDePieza>>): Escena {
  const nodo: NodoEscena = { id: idNuevo(escena, `sillas-${mesa.id}`), nombre: nombreDeSillas(sillas, mesa.id), pieza: piezaDeSillas(sillas), colocacion: colocacionDeSillas(mesa.id) };
  const i = escena.nodos.findIndex((n) => n.id === mesa.id);
  return { ...escena, nodos: [...escena.nodos.slice(0, i + 1), nodo, ...escena.nodos.slice(i + 1)] };
}

// ----------------------------------------------------------------------------------------------------------
// Cambiar las sillas
// ----------------------------------------------------------------------------------------------------------

/**
 * Cambia (o pone, o quita) las sillas de una mesa paramétrica: lo que no se pide se queda como estaba (tipo, colores, disposición).
 * `pedido` = null (o cantidad 0) las quita. Si no caben todas las pedidas, quedan las que caben y `notas` lo dice.
 */
export function cambiarSillas(escena: Escena, mesaId: string, pedido: PedidoSillas | null, notas: string[]): Escena {
  const mesaNodo = escena.nodos.find((n) => n.id === mesaId);
  const mesa = mesaNodo ? mesaDePieza(mesaNodo.pieza) : null;
  if (!mesaNodo || !mesa) return escena;
  const previo = sillasDeMesa(escena, mesaId);
  const sinSillas = (): Escena => (previo ? { ...escena, nodos: escena.nodos.filter((n) => n.id !== previo.id) } : escena);
  if (!pedido || Math.round(pedido.cantidad) <= 0) return sinSillas();
  const r = sillasParaMesa(mesa, pedido, previo ? sillasDePieza(previo.pieza) : null);
  if (r.nota) notas.push(`${mesaNodo.nombre}: ${r.nota}`);
  if (!r.sillas) return sinSillas();
  if (!previo) return conSillasNuevas(escena, mesaNodo, r.sillas);
  const nuevo: NodoEscena = { ...previo, nombre: nombreDeSillas(r.sillas, mesaId), pieza: piezaDeSillas(r.sillas) };
  return { ...escena, nodos: escena.nodos.map((n) => (n.id === previo.id ? nuevo : n)) };
}

// ----------------------------------------------------------------------------------------------------------
// Cambiar la mesa
// ----------------------------------------------------------------------------------------------------------

const centroDeCaja = (p: ReadonlyArray<{ x: number; y: number }>) => {
  const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
  return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, mx: (Math.max(...xs) - Math.min(...xs)) / 2 || 1, my: (Math.max(...ys) - Math.min(...ys)) / 2 || 1 };
};

/**
 * Lo que está sobre la tapa de una mesa que cambió de tipo, medida o alto se lleva a su misma posición relativa y al alto nuevo: lo
 * que va `sobre` ella (un punto de su marco) y lo suelto que apoya en su tapa (la base de pastel, un centro de mesa). Lo que quedaría
 * fuera de la tapa nueva se lleva a su centro.
 */
function reubicarEncima(antes: Escena, despues: Escena, mesaId: string, vieja: MesaGuardada, nueva: MesaGuardada): Escena {
  const sup0 = superficieDeMesa(vieja), sup1 = superficieDeMesa(nueva);
  const k0 = centroDeCaja(sup0.contorno), k1 = centroDeCaja(sup1.contorno);
  const lleva = (x: number, z: number): { x: number; z: number } => {
    const px = k1.cx + ((x - k0.cx) / k0.mx) * k1.mx, pz = k1.cy + ((z - k0.cy) / k0.my) * k1.my;
    return dentroDelContorno(sup1.contorno, px, pz) ? { x: px, z: pz } : { x: sup1.centro.x, z: sup1.centro.y };
  };
  const dy = sup1.altoCm - sup0.altoCm;
  // Lo suelto cuenta solo si cae cerca de la mesa (sin armar la escena para saberlo): una mesa no rearma todo por una pieza lejana.
  const sitio = antes.nodos.find((n) => n.id === mesaId)?.colocacion;
  const cerca = (n: NodoEscena) => n.colocacion.en === "libre" && (sitio?.en !== "piso" || Math.hypot(n.colocacion.xCm - sitio.xCm, n.colocacion.zCm - sitio.zCm) <= Math.max(vieja.anchoCm, vieja.fondoCm, nueva.anchoCm, nueva.fondoCm) + 40);
  const candidatos = despues.nodos.filter((n) => !esGrupoDeSillas(n.pieza) && n.id !== mesaId && ((n.colocacion.en === "sobre" && n.colocacion.padreId === mesaId) || cerca(n)));
  if (!candidatos.length) return despues;
  const marcoDe = (e: Escena) => armarEscena(e, CACHE).porNodo.find((n) => n.id === mesaId)?.puestas[0]?.marco;
  const m0 = marcoDe(antes), m1 = marcoDe(despues);
  const nodos = despues.nodos.map((n) => {
    const c = n.colocacion;
    if (!candidatos.includes(n)) return n;
    if (c.en === "sobre") {
      const p = lleva(c.puntoCm.x, c.puntoCm.z);
      return { ...n, colocacion: { ...c, puntoCm: { x: Math.round(p.x * 10) / 10, y: Math.round((c.puntoCm.y + dy) * 10) / 10, z: Math.round(p.z * 10) / 10 } } };
    }
    if (c.en !== "libre" || !m0 || !m1) return n;
    const l = puntoALocal(m0, { x: c.xCm, y: c.yCm, z: c.zCm });
    const encima = dentroDelContorno(sup0.contorno, l.x, l.z, 6) && Math.abs(l.y - sup0.altoCm) <= 4;
    if (!encima) return n;
    const p = lleva(l.x, l.z), w = puntoAlMundo(m1, { x: p.x, y: l.y + dy, z: p.z });
    return { ...n, colocacion: { ...c, xCm: Math.round(w.x * 10) / 10, yCm: Math.round(w.y * 10) / 10, zCm: Math.round(w.z * 10) / 10 } };
  });
  return { ...despues, nodos };
}

/** Cuando la mesa cambia de tipo, lo que no se pide parte de los valores del tipo nuevo (un fondo de 90 de una rectangular no sirve en una redonda). */
function mesaCambiada(vieja: MesaGuardada, cambio: Partial<MesaGuardada>): MesaGuardada {
  if (!cambio.tipo || cambio.tipo === vieja.tipo) return normalizarMesa({ ...vieja, ...cambio });
  const partida = PARTIDA_MESA[cambio.tipo];
  const alto = vieja.tipo === "coctel" || cambio.tipo === "coctel" ? partida.altoCm : vieja.altoCm;
  return normalizarMesa({ ...vieja, anchoCm: cambio.tipo === "coctel" ? partida.anchoCm : vieja.anchoCm, fondoCm: partida.fondoCm, altoCm: alto, mantel: vieja.tipo === "coctel" || cambio.tipo === "coctel" ? partida.mantel : vieja.mantel, ...cambio });
}

/**
 * Cambia el tipo, la medida, el alto, el mantel o los colores de una mesa paramétrica: sus sillas se vuelven a repartir por el perímetro
 * nuevo (con las que se habían pedido, no las que cabían) y lo que está sobre la tapa se lleva a la tapa nueva. `notas` recibe lo que
 * se ajustó (ya no caben todas las sillas, el camino no va en ese tipo…).
 */
export function cambiarMesa(escena: Escena, mesaId: string, cambio: Partial<MesaGuardada>, notas: string[]): Escena {
  const nodo = escena.nodos.find((n) => n.id === mesaId);
  const vieja = nodo ? mesaDePieza(nodo.pieza) : null;
  if (!nodo || !vieja) return escena;
  const nueva = mesaCambiada(vieja, cambio);
  const sufijo = /\s(\d+)$/.exec(nodo.nombre)?.[1];
  const propio = nodo.nombre.startsWith(NOMBRE_MESA[vieja.tipo]);
  const nombre = propio ? `${nombreDeMesa(nueva)}${sufijo ? ` ${sufijo}` : ""}` : nodo.nombre;
  let actual: Escena = { ...escena, nodos: escena.nodos.map((n) => (n.id === mesaId ? { ...n, nombre, pieza: piezaDeMesa(nueva) } : n)) };
  const sillas = sillasDeMesa(actual, mesaId);
  const previas = sillas ? sillasDePieza(sillas.pieza) : null;
  if (previas) actual = cambiarSillas(actual, mesaId, { cantidad: previas.pedida }, notas);
  return reubicarEncima(escena, actual, mesaId, vieja, nueva);
}

// ----------------------------------------------------------------------------------------------------------
// Varios conjuntos en cuadrícula
// ----------------------------------------------------------------------------------------------------------

export type Cuadricula = { puntos: Array<{ x: number; z: number }>; columnas: number; filas: number };

/**
 * `cantidad` sitios en cuadrícula centrada en (`cx`, `cz`), de celdas de `anchoCm` × `fondoCm`: sin pedirlo, tantas columnas
 * como caben a lo ancho de la sala (sin pasar de las que dejan filas parejas). La última fila, si queda corta, va centrada.
 */
export function cuadricula(o: { cantidad: number; anchoCm: number; fondoCm: number; columnas?: number; cx: number; cz: number; salaAnchoCm: number }): Cuadricula {
  const caben = Math.max(1, Math.floor((o.salaAnchoCm - 60) / o.anchoCm));
  const columnas = Math.max(1, Math.min(o.cantidad, o.columnas ?? Math.min(caben, Math.ceil(Math.sqrt(o.cantidad * 1.3)))));
  const filas = Math.ceil(o.cantidad / columnas);
  const puntos = Array.from({ length: o.cantidad }, (_, i) => {
    const fila = Math.floor(i / columnas), enFila = fila === filas - 1 ? o.cantidad - fila * columnas : columnas;
    return { x: Math.round(o.cx + ((i % columnas) - (enFila - 1) / 2) * o.anchoCm), z: Math.round(o.cz + (fila - (filas - 1) / 2) * o.fondoCm) };
  });
  return { puntos, columnas, filas };
}

// ----------------------------------------------------------------------------------------------------------
// Contar de verdad
// ----------------------------------------------------------------------------------------------------------

export type ConteoMobiliario = { mesas: number; sillas: number };

const MESAS_PARA_SENTARSE = new Set(["mesa_imperial", "mesa_imperial_mantel", "mesa_redonda", "mesa_redonda_mantel", "mesa_coctel", "mesa_coctel_licra", "mesa_mantel"]);

/** Las mesas y sillas que HAY en la escena, leídas de las piezas: las paramétricas, los conjuntos fijos de antes, las mesas del catálogo y las sillas sueltas. */
export function contarMobiliario(escena: Escena): ConteoMobiliario {
  let mesas = 0, sillas = 0;
  for (const n of escena.nodos) {
    const m = n.pieza.tipo === "escenografia" ? n.pieza.mueble : undefined;
    if (!m) continue;
    if (m.mesa) mesas++;
    else if (m.sillas) sillas += m.sillas.puestos.length;
    else if (m.id in LEGACY) { mesas++; sillas += LEGACY[m.id]!.sillas; }
    else if (MESAS_PARA_SENTARSE.has(m.id)) mesas++;
    else if (muebleDe(m.id)?.asiento) sillas++;
  }
  return { mesas, sillas };
}

/** «3 mesas, 24 sillas» (solo lo que hay). */
export function textoConteo(c: ConteoMobiliario): string {
  return [c.mesas ? `${c.mesas} ${c.mesas === 1 ? "mesa" : "mesas"}` : "", c.sillas ? `${c.sillas} ${c.sillas === 1 ? "silla" : "sillas"}` : ""].filter(Boolean).join(", ") || "sin mesas ni sillas";
}

/** Cómo se llama un tipo de silla en plural, para los resúmenes. */
export const pluralDeSilla = (tipo: keyof typeof SILLAS): string => SILLAS[tipo].plural;

// ----------------------------------------------------------------------------------------------------------
// El conjunto de siempre (el botón «Mesa con sillas» del panel)
// ----------------------------------------------------------------------------------------------------------

/** Cuánto se separa de la pared del fondo el centro de la mesa al ponerla (cm): su mantel y sus sillas quedan delante de la pared. */
const RETIRO_CONJUNTO_CM = 190;

/**
 * Una mesa redonda de 1,5 m con ocho sillas Tiffany, en el piso delante de la pared del fondo y corrida si ya hay algo ahí. Devuelve la
 * escena, el id de la mesa y un aviso si no cabe (tope de piezas) o no hay lugar libre.
 */
export function agregarConjuntoPorDefecto(escena: Escena, maxNodos: number): { escena: Escena; mesaId: string | null; aviso: string | null } {
  if (escena.nodos.length + 2 > maxNodos) return { escena, mesaId: null, aviso: `La escena ya tiene ${escena.nodos.length} piezas (máximo ${maxNodos}): no cabe una mesa con sus sillas.` };
  const z = Math.round(-escena.sala.fondoCm / 2 + RETIRO_CONJUNTO_CM);
  const sitio = esquivarEnElPiso(escena, 0, z, 300, 300);
  const mesaId = idNuevo(escena, "mesa-redonda");
  const conjunto = armarConjuntoMesa({
    ids: { mesa: mesaId, sillas: idNuevo({ ...escena, nodos: [...escena.nodos, { id: mesaId } as NodoEscena] }, `sillas-${mesaId}`) },
    mesa: { tipo: "redonda" }, sillas: { cantidad: 8 }, colocacion: { en: "piso", xCm: sitio?.x ?? 0, zCm: z, giroGrados: 0 },
  });
  return { escena: { ...escena, nodos: [...escena.nodos, ...conjunto.nodos] }, mesaId, aviso: sitio ? null : "No hay lugar libre delante de la pared: la mesa quedó en el centro, encima de otra pieza. Muévela." };
}
