import { armarConjuntoMesa, type ConjuntoArmado } from "./mobiliario-conjunto";
import { falloDeSillas, medidasDeMesa, type TipoMesaSalon } from "./salon-evento";
import type { PaletaSalon } from "./salon-nodos";

/**
 * **La mesa de invitados del salón como conjunto paramétrico** (REQ-012, REQ-014 T54): en vez del mueble del catálogo con
 * `opciones.sillas` (mesa y sillas en una sola pieza), la mesa y su grupo de sillas son dos nodos (`armarConjuntoMesa`) con las sillas
 * `sobre` la mesa, así se mueven, giran, duplican y quitan juntas. Cada tipo de mesa del salón se traduce a una mesa paramétrica
 * cuyo conjunto (con sillas) ocupa lo mismo que `medidasDeMesa`: el salón sigue distribuyendo con esas medidas.
 *
 * `ponerElemento` en `salon-nodos.ts` usa este constructor para armar las mesas de invitados del salón.
 */

/** Lo que las sillas suman a cada lado de la mesa (cm): el mismo `ALREDEDOR_SILLAS_CM` del catálogo. */
const ALREDEDOR_SILLAS_CM = 60;
/** El fondo de una mesa imperial (cm); solo se alarga. */
const FONDO_IMPERIAL_CM = 90;
/** Alto de la tapa con mantel: el del catálogo (75 de los 90 cm del conjunto). */
const ALTO_MESA_CM = 75;

export type PedidoMesaSalon = {
  tipo: TipoMesaSalon;
  /** Sillas por mesa (`sillas_por_mesa`); sin ellas, las de siempre del tipo. */
  sillas?: number;
  ids: { mesa: string; sillas: string };
  xCm: number;
  zCm: number;
  giroGrados: number;
  /** Mantel, sillas, cojines (`#rrggbb`), en ese orden; los que faltan, los de partida del conjunto. */
  paleta?: PaletaSalon;
  nombre?: string;
};

/** La mesa y sus sillas de un tipo de mesa del salón. Falla con el mensaje de `falloDeSillas` si el número de sillas no vale. */
export function conjuntoDeMesaSalon(p: PedidoMesaSalon): ConjuntoArmado {
  const fallo = p.sillas === undefined ? null : falloDeSillas(p.tipo, p.sillas);
  if (fallo) throw new Error(fallo);
  const { anchoCm, puestos } = medidasDeMesa(p.tipo, p.sillas);
  const [mantel, sillas, cojin] = p.paleta ?? [];
  const lado = anchoCm - 2 * ALREDEDOR_SILLAS_CM;
  const colorMantel = mantel ? { colorMantel: mantel } : {};
  const mesa = p.tipo === "imperial"
    ? { tipo: "rectangular" as const, anchoCm: lado, fondoCm: FONDO_IMPERIAL_CM, altoCm: ALTO_MESA_CM, ...colorMantel }
    : { tipo: "redonda" as const, anchoCm: lado, fondoCm: lado, altoCm: ALTO_MESA_CM, ...colorMantel };
  return armarConjuntoMesa({
    ids: p.ids, mesa, colocacion: { en: "piso", xCm: Math.round(p.xCm), zCm: Math.round(p.zCm), giroGrados: p.giroGrados },
    sillas: { cantidad: puestos, disposicion: "alrededor", ...(sillas ? { colorEstructura: sillas } : {}), ...(cojin !== undefined ? { colorCojin: cojin } : {}) },
    ...(p.nombre ? { nombre: p.nombre } : {}),
  });
}
