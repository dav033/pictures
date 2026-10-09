import type { Escena, NodoEscena } from "./escena";
import { muebleDe } from "./mobiliario-catalogo";
import { anclaDeZona, mesasVivas, miembrosDeZona } from "./salon-registro";

/**
 * **Las zonas de un salón de eventos** (REQ-008), leídas de la escena con su registro (salon-registro.ts): las herramientas que
 * decoran por zona (`decorar_mesas`, el techo por zona…) llaman a `zonasDeEscena(escena)` y ven lo mismo que `ajustar_salon`,
 * `mover_zona` y `quitar_zona`; lo que el usuario movió o quitó a mano se refleja tal cual.
 */

export const ZONAS_SALON = ["mesa_principal", "pista", "mesa_postres", "fondo_fotos", "entrada"] as const;
export type ZonaSalon = (typeof ZONAS_SALON)[number];

/** Un rectángulo del piso en cm: x de izquierda a derecha, z de fondo (−) a frente (+). */
export type RectCm = { x0: number; x1: number; z0: number; z1: number };

export const rectDe = (x: number, z: number, anchoCm: number, fondoCm: number): RectCm => ({ x0: x - anchoCm / 2, x1: x + anchoCm / 2, z0: z - fondoCm / 2, z1: z + fondoCm / 2 });
export const unir = (a: RectCm, b: RectCm): RectCm => ({ x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), z0: Math.min(a.z0, b.z0), z1: Math.max(a.z1, b.z1) });
export const inflar = (r: RectCm, cm: number): RectCm => ({ x0: r.x0 - cm, x1: r.x1 + cm, z0: r.z0 - cm, z1: r.z1 + cm });
export const seCruzan = (a: RectCm, b: RectCm) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
export const dentroDe = (r: RectCm, anchoCm: number, fondoCm: number, tol = 0) => r.x0 >= -anchoCm / 2 - tol && r.x1 <= anchoCm / 2 + tol && r.z0 >= -fondoCm / 2 - tol && r.z1 <= fondoCm / 2 + tol;

/**
 * Las zonas del salón armado. Los ids son de nodos de la escena; las cajas, rectángulos del piso en cm (con la pieza donde
 * está hoy, no donde la puso la herramienta). Una zona que no hay vale `null` y no hay mesas si se quitaron.
 */
export type ZonasSalon = {
  /** Ids de las mesas de invitados que hay, en el orden en que se llenan (la primera es la más cercana a la mesa principal). */
  mesas: readonly string[];
  /** La mesa de los novios o de honor, con sus sillas (detrás de ella, mirando al salón). */
  mesaPrincipal: { id: string; sillas: readonly string[]; caja: RectCm } | null;
  /** La pista de baile (el rectángulo que la contiene). */
  pista: RectCm | null;
  /** La pared del fondo de fotos: el centro y las medidas del panel (el arco y las columnas se arman delante de él, hacia +z). */
  fondo: { xCm: number; zCm: number; anchoCm: number; altoCm: number } | null;
  /** Dónde se entra: el tapete de bienvenida; el arco de la entrada va 100 cm hacia la puerta (+z). */
  entrada: { xCm: number; zCm: number } | null;
};

const medidasDe = (n: NodoEscena): { anchoCm: number; fondoCm: number; altoCm: number } | null => {
  if (n.pieza.tipo !== "escenografia" || !n.pieza.mueble) return null;
  const m = muebleDe(n.pieza.mueble.id);
  if (!m) return null;
  const o = n.pieza.mueble.opciones;
  return { anchoCm: o?.anchoCm ?? m.medidas.anchoCm, fondoCm: o?.fondoCm ?? m.medidas.fondoCm, altoCm: o?.altoCm ?? m.medidas.altoCm };
};

/** El rectángulo del piso que ocupa un mueble puesto en el piso (con su giro), o null si no es un mueble en el piso. */
export function cajaDeMueble(n: NodoEscena): RectCm | null {
  const c = n.colocacion;
  const medidas = medidasDe(n);
  if (c.en !== "piso" || !medidas) return null;
  const girado = Math.abs(Math.round(c.giroGrados)) % 180 === 90;
  return rectDe(c.xCm, c.zCm, girado ? medidas.fondoCm : medidas.anchoCm, girado ? medidas.anchoCm : medidas.fondoCm);
}

const centroDe = (r: RectCm) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });

/** Lo que ocupan las piezas del salón de una zona que son muebles en el piso (juntas). */
export function cajaDeZona(escena: Escena, zona: ZonaSalon): RectCm | null {
  const cajas = miembrosDeZona(escena, zona).flatMap((v) => { const c = cajaDeMueble(v.nodo); return c ? [c] : []; });
  return cajas.length ? cajas.reduce(unir) : null;
}

/** Lee las zonas del salón que hay en la escena (todo `null` o vacío si no hay un salón armado). */
export function zonasDeEscena(escena: Escena): ZonasSalon {
  const principal = anclaDeZona(escena, "mesa_principal");
  const cajaPrincipal = principal && cajaDeZona(escena, "mesa_principal");
  const panel = anclaDeZona(escena, "fondo_fotos");
  const cajaPanel = panel && cajaDeMueble(panel.nodo);
  const tapete = anclaDeZona(escena, "entrada");
  const cajaTapete = tapete && cajaDeMueble(tapete.nodo);
  const pista = anclaDeZona(escena, "pista");
  return {
    mesas: mesasVivas(escena).map((v) => v.nodo.id),
    mesaPrincipal: principal && cajaPrincipal ? { id: principal.nodo.id, sillas: miembrosDeZona(escena, "mesa_principal").filter((v) => v.info.rol === "silla").map((v) => v.nodo.id), caja: cajaPrincipal } : null,
    pista: pista ? cajaDeMueble(pista.nodo) : null,
    fondo: panel && cajaPanel ? { xCm: centroDe(cajaPanel).x, zCm: centroDe(cajaPanel).z, anchoCm: cajaPanel.x1 - cajaPanel.x0, altoCm: medidasDe(panel.nodo)?.altoCm ?? 0 } : null,
    entrada: tapete && cajaTapete ? { xCm: centroDe(cajaTapete).x, zCm: centroDe(cajaTapete).z } : null,
  };
}

/** Las zonas que hay en la escena (con su pieza principal). */
export const zonasPresentes = (escena: Escena): ZonaSalon[] => ZONAS_SALON.filter((z) => anclaDeZona(escena, z) !== undefined);
