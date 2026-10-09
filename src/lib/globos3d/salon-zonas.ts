import type { Escena, NodoEscena } from "./escena";
import { muebleDe } from "./mobiliario-catalogo";

/**
 * **Las zonas de un salón de eventos** (REQ-008). La escena es la única fuente de verdad: el salón no guarda nada aparte,
 * cada pieza que arma `armar_salon` / `planificar_evento` lleva un id con prefijo `salon-` y las zonas se leen de ahí.
 * Así `ajustar_salon`, `mover_zona`, `quitar_zona` y las herramientas que decoran por zona (centros de mesa, techo) ven lo
 * mismo, y lo que el usuario movió o quitó a mano se respeta.
 *
 * Ids: `salon-mesa-01…` (mesas de invitados), `salon-principal` y `salon-principal-silla-N`, `salon-pista`, `salon-postres`,
 * `salon-fondo` (el panel del fondo de fotos) y `salon-fondo-*` (lo que lo decora), `salon-entrada` (el tapete) y `salon-entrada-*`.
 */

export const ZONAS_SALON = ["mesa_principal", "pista", "mesa_postres", "fondo_fotos", "entrada"] as const;
export type ZonaSalon = (typeof ZONAS_SALON)[number];

export const PREFIJO_ZONA: Readonly<Record<ZonaSalon, string>> = {
  mesa_principal: "salon-principal", pista: "salon-pista", mesa_postres: "salon-postres", fondo_fotos: "salon-fondo", entrada: "salon-entrada",
};
export const PREFIJO_MESAS = "salon-mesa-";
export const idMesa = (numero: number) => `${PREFIJO_MESAS}${String(numero).padStart(2, "0")}`;

export const esDeSalon = (id: string) => id.startsWith("salon-");
export const esMesaDeInvitados = (id: string) => id.startsWith(PREFIJO_MESAS);
/** ¿El id es de esa zona (la pieza principal o algo que la acompaña: sus sillas, su decoración)? */
export const esDeZona = (id: string, zona: ZonaSalon) => id === PREFIJO_ZONA[zona] || id.startsWith(`${PREFIJO_ZONA[zona]}-`);

/** Un rectángulo del piso en cm: x de izquierda a derecha, z de fondo (−) a frente (+). */
export type RectCm = { x0: number; x1: number; z0: number; z1: number };

export const rectDe = (x: number, z: number, anchoCm: number, fondoCm: number): RectCm => ({ x0: x - anchoCm / 2, x1: x + anchoCm / 2, z0: z - fondoCm / 2, z1: z + fondoCm / 2 });
export const unir = (a: RectCm, b: RectCm): RectCm => ({ x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), z0: Math.min(a.z0, b.z0), z1: Math.max(a.z1, b.z1) });
export const inflar = (r: RectCm, cm: number): RectCm => ({ x0: r.x0 - cm, x1: r.x1 + cm, z0: r.z0 - cm, z1: r.z1 + cm });
export const seCruzan = (a: RectCm, b: RectCm) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;

/**
 * Las zonas del salón armado, como las consumen las herramientas que decoran por zona (`decorar_mesas`, el techo por zona…).
 * Los ids son de nodos de la escena; las cajas, rectángulos del piso en cm.
 */
export type ZonasSalon = {
  sala: { anchoCm: number; fondoCm: number; altoCm: number };
  /** Ids de las mesas de invitados, en el orden en que se llenan (la primera es la más cercana a la mesa principal). */
  mesas: readonly string[];
  /** La mesa de los novios o de honor, con sus sillas (detrás de ella, mirando al salón). */
  mesaPrincipal: { id: string; sillas: readonly string[]; caja: RectCm } | null;
  /** La pista de baile (el rectángulo que la contiene). */
  pista: RectCm | null;
  postres: { id: string; caja: RectCm } | null;
  /** La pared del fondo de fotos: el panel y su centro (el arco y las columnas se arman delante de él, hacia +z). */
  fondo: { id: string; xCm: number; zCm: number; anchoCm: number; altoCm: number } | null;
  /** Dónde se entra: el tapete de bienvenida; el arco de la entrada va 120 cm hacia la puerta (+z). */
  entrada: { id: string; xCm: number; zCm: number } | null;
};

const cuantoMide = (n: NodoEscena): { anchoCm: number; fondoCm: number } | null => {
  if (n.pieza.tipo !== "escenografia" || !n.pieza.mueble) return null;
  const m = muebleDe(n.pieza.mueble.id);
  if (!m) return null;
  const o = n.pieza.mueble.opciones;
  return { anchoCm: o?.anchoCm ?? m.medidas.anchoCm, fondoCm: o?.fondoCm ?? m.medidas.fondoCm };
};

/** El rectángulo del piso que ocupa un mueble puesto en el piso (con su giro), o null si no es un mueble en el piso. */
export function cajaDeMueble(n: NodoEscena): RectCm | null {
  const c = n.colocacion;
  const medidas = cuantoMide(n);
  if (c.en !== "piso" || !medidas) return null;
  const girado = Math.abs(Math.round(c.giroGrados)) % 180 === 90;
  return rectDe(c.xCm, c.zCm, girado ? medidas.fondoCm : medidas.anchoCm, girado ? medidas.anchoCm : medidas.fondoCm);
}

const centroDe = (r: RectCm) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });

/** Lee las zonas del salón que hay en la escena (todo `null` o vacío si no hay un salón armado). */
export function zonasDeEscena(escena: Escena): ZonasSalon {
  const nodo = (id: string) => escena.nodos.find((n) => n.id === id);
  const caja = (id: string) => { const n = nodo(id); return n ? cajaDeMueble(n) : null; };
  const mesas = escena.nodos.filter((n) => esMesaDeInvitados(n.id)).map((n) => n.id).sort();

  const principal = caja(PREFIJO_ZONA.mesa_principal);
  const sillas = escena.nodos.filter((n) => n.id.startsWith(`${PREFIJO_ZONA.mesa_principal}-silla-`));
  const cajaPrincipal = principal && sillas.reduce((r, s) => { const c = cajaDeMueble(s); return c ? unir(r, c) : r; }, principal);
  const postres = caja(PREFIJO_ZONA.mesa_postres);
  const nodoFondo = nodo(PREFIJO_ZONA.fondo_fotos), cajaFondo = nodoFondo ? cajaDeMueble(nodoFondo) : null;
  const opcionesFondo = nodoFondo?.pieza.tipo === "escenografia" ? nodoFondo.pieza.mueble?.opciones : undefined;
  const nodoEntrada = nodo(PREFIJO_ZONA.entrada), cajaEntrada = nodoEntrada ? cajaDeMueble(nodoEntrada) : null;

  return {
    sala: { anchoCm: escena.sala.anchoCm, fondoCm: escena.sala.fondoCm, altoCm: escena.sala.altoCm },
    mesas,
    mesaPrincipal: principal && cajaPrincipal ? { id: PREFIJO_ZONA.mesa_principal, sillas: sillas.map((s) => s.id), caja: cajaPrincipal } : null,
    pista: caja(PREFIJO_ZONA.pista),
    postres: postres ? { id: PREFIJO_ZONA.mesa_postres, caja: postres } : null,
    fondo: nodoFondo && cajaFondo ? { id: nodoFondo.id, xCm: centroDe(cajaFondo).x, zCm: centroDe(cajaFondo).z, anchoCm: cajaFondo.x1 - cajaFondo.x0, altoCm: opcionesFondo?.altoCm ?? 0 } : null,
    entrada: nodoEntrada && cajaEntrada ? { id: nodoEntrada.id, xCm: centroDe(cajaEntrada).x, zCm: centroDe(cajaEntrada).z } : null,
  };
}

/** Las zonas que hay en la escena (con al menos su pieza principal). */
export function zonasPresentes(escena: Escena): ZonaSalon[] {
  return ZONAS_SALON.filter((z) => escena.nodos.some((n) => n.id === PREFIJO_ZONA[z]));
}
