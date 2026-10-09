import type { Escena, NodoEscena } from "./escena";
import type { TipoMesaSalon } from "./salon-evento";
import type { ZonaSalon } from "./salon-zonas";

/**
 * **El registro del salón** (REQ-008): la libreta que el salón lleva EN la escena (`Escena.salon`) con lo que las herramientas
 * armaron, para no adivinarlo por los ids ni confundirlo con lo del usuario. Dice qué piezas son del salón y de qué zona, la
 * posición que les puso la herramienta (`pos`: si la pieza ya no está ahí, la movió el usuario o `mover_zona` y se respeta),
 * cuántos invitados se pidieron y cuánto se reservó al fondo de fotos. Una pieza del registro que ya no está en la escena es
 * una que el usuario quitó a mano: no se vuelve a poner. Duplicar una pieza no la copia al registro (la copia es del usuario).
 *
 * Roles: `mesa` (de invitados, con su `ranura` en el orden de llenado), `ancla` (la pieza principal de una zona: el panel,
 * la mesa principal, la pista, los postres, el tapete), `silla` (de la mesa principal), `adorno` (arco, columnas y guirnalda
 * de globos) y `adoptada` (una pieza del USUARIO que el salón corrió al fondo de fotos: sigue a su zona pero no es del salón y
 * nunca se quita con ella).
 */

export type RolSalon = "mesa" | "ancla" | "silla" | "adorno" | "adoptada";

export type PiezaSalon = {
  zona: ZonaSalon | "mesas";
  rol: RolSalon;
  /** Solo `mesa`: el lugar de la mesa en el orden en que se llena el salón (1, 2, 3…). */
  ranura?: number;
  /** Solo `mesa` y `ancla`: dónde la puso la herramienta (x, z en cm). */
  pos?: { x: number; z: number };
};

export type RegistroSalon = {
  /** Los invitados que se pidieron (no los que caben). */
  invitados: number;
  mesa: TipoMesaSalon;
  /** Lo que ocupa el fondo de fotos desde la pared (cm): más que lo de siempre si el usuario tenía decoración delante del panel. */
  profundidadFondoCm: number;
  piezas: Record<string, PiezaSalon>;
};

/** Lo que mide de más o de menos una pieza para considerar que no está donde la dejó la herramienta (cm). */
const TOLERANCIA_CM = 1;

export type PiezaViva = { nodo: NodoEscena; info: PiezaSalon };

/** Las piezas del registro que siguen en la escena. */
export function vivas(escena: Escena): PiezaViva[] {
  const registro = escena.salon;
  if (!registro) return [];
  return escena.nodos.flatMap((nodo) => { const info = registro.piezas[nodo.id]; return info ? [{ nodo, info }] : []; });
}

/** El registro si el salón sigue teniendo alguna pieza; si no, `null` (un registro sin piezas es un salón que ya no está). */
export const registroVivo = (escena: Escena): RegistroSalon | null => (escena.salon && vivas(escena).some((v) => v.info.rol !== "adoptada") ? escena.salon : null);

/** ¿Es una pieza que armó el salón (y no una del usuario)? */
export const esDelSalon = (escena: Escena, id: string): boolean => { const i = escena.salon?.piezas[id]; return i !== undefined && i.rol !== "adoptada"; };

export const miembrosDeZona = (escena: Escena, zona: ZonaSalon): PiezaViva[] => vivas(escena).filter((v) => v.info.zona === zona);
export const anclaDeZona = (escena: Escena, zona: ZonaSalon): PiezaViva | undefined => miembrosDeZona(escena, zona).find((v) => v.info.rol === "ancla");
export const mesasVivas = (escena: Escena): PiezaViva[] => vivas(escena).filter((v) => v.info.rol === "mesa").sort((a, b) => (a.info.ranura ?? 0) - (b.info.ranura ?? 0));

/** ¿La pieza ya no está donde la puso la herramienta (la movió el usuario o `mover_zona`)? Sin posición registrada, no. */
export function estaMovida(v: PiezaViva): boolean {
  const c = v.nodo.colocacion, pos = v.info.pos;
  if (!pos || c.en !== "piso") return false;
  return Math.abs(c.xCm - pos.x) > TOLERANCIA_CM || Math.abs(c.zCm - pos.z) > TOLERANCIA_CM;
}

/** Un id que no choca con ninguno de la escena (el `base`, y si está tomado, `base-2`, `base-3`…). */
export function idLibre(escena: Escena, base: string): string {
  const usados = new Set(escena.nodos.map((n) => n.id));
  if (!usados.has(base)) return base;
  for (let i = 2; ; i++) if (!usados.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Agrega un nodo a la escena y lo anota en el registro (que se crea con `inicial` si todavía no hay). */
export function conPieza(escena: Escena, nodo: NodoEscena, info: PiezaSalon, inicial: Omit<RegistroSalon, "piezas">): Escena {
  const registro: RegistroSalon = escena.salon ?? { ...inicial, piezas: {} };
  return { ...escena, nodos: [...escena.nodos, nodo], salon: { ...registro, piezas: { ...registro.piezas, [nodo.id]: info } } };
}

/** Quita esas piezas del registro (los nodos no se tocan: quien las quita de la escena lo hace aparte). */
export function sinAnotar(escena: Escena, ids: readonly string[]): Escena {
  if (!escena.salon) return escena;
  const piezas = Object.fromEntries(Object.entries(escena.salon.piezas).filter(([id]) => !ids.includes(id)));
  return { ...escena, salon: { ...escena.salon, piezas } };
}

/** Cambia lo anotado de una pieza (por ejemplo su posición). */
export function conAnotacion(escena: Escena, id: string, cambio: Partial<PiezaSalon>): Escena {
  const registro = escena.salon;
  const previa = registro?.piezas[id];
  if (!registro || !previa) return escena;
  return { ...escena, salon: { ...registro, piezas: { ...registro.piezas, [id]: { ...previa, ...cambio } } } };
}
