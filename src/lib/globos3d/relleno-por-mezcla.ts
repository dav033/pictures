import type { OpcionesFlores } from "./flores-artificiales";
import { piezaDeGenerador } from "./generadores-organicos";
import { distanciaEscalones, escalonesDe, globosPorFormatoDe } from "./mezcla-escena";
import type { RellenoOrganico } from "./organico";
import type { ParametrosTrazoOrganico } from "./trazo-organico";

/**
 * **Que lo armado tenga los tamaños de la foto.** El motor orgánico pone primero la estructura con la mezcla pedida y luego
 * rellena los huecos con R-9 y tríos de R-5 (la técnica Sempertex): en un cuerpo grueso ese relleno es el 70 % de los globos
 * y ahoga a los grandes (una guirnalda con 35 % de globos grandes en la lectura salía con 12 %). Como la mezcla leída de una
 * foto cuenta TODOS los globos que se ven, aquí se prueban tres rellenos (el de siempre, solo R-9, ninguno) y se queda el que
 * deja el reparto grande / mediano / chico más cerca del leído; si el de siempre queda casi igual de cerca, gana (más lleno).
 * Determinista y sin red: es armar la pieza unas veces y contar.
 */

const SOLO_R9: readonly RellenoOrganico[] = [{ formatoId: "R-9", infladoCm: 18, trios: false }];
/** El relleno de siempre (`undefined`), solo R-9 y ninguno. */
const VARIANTES: ReadonlyArray<readonly RellenoOrganico[] | undefined> = [undefined, SOLO_R9, []];
const NOMBRE: readonly string[] = ["tupido", "solo R-9", "sin relleno"];
/** Cuánto tiene que mejorar la distancia para dejar un relleno más lleno por uno más ralo. */
const MEJORA_MINIMA = 0.03;

export type PiezaConMezcla = { pieza: ReturnType<typeof piezaDeGenerador>; relleno: string; distancia: number };

/** Cuánto se corrige a lo más cada peso en la segunda pasada (los globos grandes ocupan más largo y salen menos de los pedidos). */
const CORRECCION_MAXIMA = 2.5;
/** Con una distancia menor a esta ya no se corrige. */
const DISTANCIA_ACEPTABLE = 0.06;

const armar = (trazo: ParametrosTrazoOrganico, relleno: readonly RellenoOrganico[] | undefined, flores: OpcionesFlores | null, huecos: number) => {
  const pieza = piezaDeGenerador({ tipo: "trazo", trazo: relleno ? { ...trazo, relleno } : trazo }, flores, huecos);
  return { pieza, cuenta: globosPorFormatoDe(pieza) };
};

/**
 * La pieza orgánica del trazo con el relleno que más se acerca al reparto `objetivo` (pesos por formato) y, si aún queda lejos,
 * una segunda pasada que corrige cada peso de la mezcla por lo que faltó o sobró (los grandes ocupan más largo y salen menos
 * de los que se piden).
 */
export function piezaConMezcla(trazo: ParametrosTrazoOrganico, objetivo: Readonly<Record<string, number>>, flores: OpcionesFlores | null, huecosFlores: number): PiezaConMezcla {
  const meta = escalonesDe(objetivo);
  let mejor: (PiezaConMezcla & { variante: readonly RellenoOrganico[] | undefined; cuenta: Record<string, number> }) | null = null;
  VARIANTES.forEach((relleno, i) => {
    const { pieza, cuenta } = armar(trazo, relleno, flores, huecosFlores);
    const distancia = distanciaEscalones(escalonesDe(cuenta), meta);
    if (!mejor || distancia < mejor.distancia - MEJORA_MINIMA) mejor = { pieza, relleno: NOMBRE[i]!, distancia, variante: relleno, cuenta };
  });
  const elegido = mejor!;
  if (elegido.distancia <= DISTANCIA_ACEPTABLE) return { pieza: elegido.pieza, relleno: elegido.relleno, distancia: elegido.distancia };
  // Segunda pasada: cada peso por lo que faltó (meta / lo que salió), acotado, con el mismo relleno.
  const total = Object.values(elegido.cuenta).reduce((s, n) => s + n, 0) || 1;
  const pedidos = Object.entries(trazo.mezcla).filter(([, w]) => w > 0);
  const suma = pedidos.reduce((s, [, w]) => s + w, 0) || 1;
  const corregida = Object.fromEntries(pedidos.map(([f, w]) => {
    const quiso = w / suma, salio = (elegido.cuenta[f] ?? 0) / total;
    return [f, w * Math.min(CORRECCION_MAXIMA, Math.max(1 / CORRECCION_MAXIMA, salio > 0 ? quiso / salio : CORRECCION_MAXIMA))];
  }));
  const segunda = armar({ ...trazo, mezcla: corregida }, elegido.variante, flores, huecosFlores);
  const distancia = distanciaEscalones(escalonesDe(segunda.cuenta), meta);
  return distancia < elegido.distancia ? { pieza: segunda.pieza, relleno: `${elegido.relleno} + mezcla corregida`, distancia } : { pieza: elegido.pieza, relleno: elegido.relleno, distancia: elegido.distancia };
}
