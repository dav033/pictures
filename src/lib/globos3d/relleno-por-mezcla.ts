import type { OpcionesFlores } from "./flores-artificiales";
import { piezaDeGenerador } from "./generadores-organicos";
import type { MezclaLeida } from "./lectura-foto";
import { distanciaEscalones, escalonesDe, globosPorFormatoDe } from "./mezcla-escena";
import { escalonDeFormato, escalonTres, type EscalonTres } from "./mezcla-lectura";
import type { RellenoOrganico } from "./organico";
import type { ParametrosTrazoOrganico } from "./trazo-organico";

/**
 * **Que lo armado tenga los tamaños de la foto, y tupido.** El motor orgánico pone primero la estructura con la mezcla
 * pedida y luego rellena los huecos. El relleno de siempre (R-9 y tríos de R-5) en un cuerpo grueso es el 70 % de los
 * globos y ahoga a los grandes; quitarlo para respetar la mezcla dejaba la guirnalda rala, con la pared asomando entre
 * globos sueltos (lo que más se notaba contra las fotos de Pinterest, que son una masa sin huecos).
 *
 * Aquí el relleno se hace como el decorador, **por escalones**: los huecos grandes con medianos a medio inflar (un R-12 a
 * 22 cm entra donde uno a 27 no cabe), luego los intermedios con R-9 si la mezcla los lleva, y al final los chicos en
 * racimitos de 3 a 5 (como se ven los R-5 dorados en las fotos), con TOPE: solo los que faltan para llegar a la parte de
 * chicos de la mezcla. Determinista y sin red: armar la pieza un par de veces y contar.
 */

export type PiezaConMezcla = { pieza: ReturnType<typeof piezaDeGenerador>; relleno: string; distancia: number };

/** Inflado del mediano de relleno respecto al de su formato (más bajo, para que entre en los huecos). */
const INFLADO_RELLENO: Readonly<Record<string, number>> = { "R-12": 22, "R-9": 16, "R-5": 12, "R-18": 30 };
/** Cuánto pueden quedar cortos los grandes antes de corregir su peso, y cuánto se corrige a lo más. */
const DESVIO_GRANDES = 0.03;
const CORRECCION_MAXIMA = 2.5;
/** Una mezcla casi toda de chicos no tiene con qué calcular el tope: se ponen hasta este número. */
const TODO_CHICOS = 0.99;
const MAXIMO_CHICOS = 400;
const PASADAS_CORRECCION = 3;
/** Globos por racimito de chicos (los R-5 dorados de las fotos van de 3 a 5) y los que tienen que faltar para poner racimitos. */
const GLOBOS_POR_RACIMITO = 4;
const MINIMO_CHICOS_FALTANTES = 3;
/** Inflado de un chico de relleno cuando su formato no está en la tabla. */
const INFLADO_CHICO_POR_OMISION_CM = 12;
const INFLADO_MEDIANO_POR_OMISION_CM = 22;

const armar = (trazo: ParametrosTrazoOrganico, relleno: readonly RellenoOrganico[], flores: OpcionesFlores | null, huecos: number) => {
  const pieza = piezaDeGenerador({ tipo: "trazo", trazo: { ...trazo, relleno } }, flores, huecos);
  return { pieza, cuenta: globosPorFormatoDe(pieza) };
};

/** El formato con más peso de un escalón en los pesos pedidos (o el de por omisión). */
function formatoDelEscalon(objetivo: Readonly<Record<string, number>>, escalon: EscalonTres, escalonDe: (formatoId: string) => EscalonTres, porOmision: string): string {
  const lista = Object.entries(objetivo).filter(([f, w]) => w > 0 && escalonDe(f) === escalon).sort((a, b) => b[1] - a[1]);
  return lista[0]?.[0] ?? porOmision;
}

/**
 * La pieza orgánica del trazo, tupida, con el reparto `objetivo` (pesos por formato):
 * 1. Estructura + relleno de medianos a medio inflar (sin tope: tapan los huecos, que es lo que más se nota en las fotos).
 *    Si los grandes quedan cortos (los medianos los diluyen), se sube su peso en la estructura (hasta 3 pasadas, acotado).
 * 2. Los racimitos de chicos, con TOPE: los que faltan para la parte de chicos del total.
 * La parte de grandes puede quedar unos puntos bajo la leída: se prefiere un cuerpo sin huecos a la proporción exacta
 * (la mezcla de una foto cuenta lo que se ve, y lo de atrás de una guirnalda tupida no se ve). Qué formato es mediano y cuál
 * chico lo dice la `mezcla` de la pieza leída (un R-9 nombrado mediano es mediano), igual que al compilarla.
 */
export function piezaConMezcla(trazo: ParametrosTrazoOrganico, objetivo: Readonly<Record<string, number>>, flores: OpcionesFlores | null, huecosFlores: number, mezcla?: MezclaLeida): PiezaConMezcla {
  const escalonDe = (f: string): EscalonTres => escalonTres(escalonDeFormato(f, mezcla));
  const meta = escalonesDe(objetivo, escalonDe);
  const mediano = formatoDelEscalon(objetivo, "medianos", escalonDe, "R-12");
  const chico = formatoDelEscalon(objetivo, "chicos", escalonDe, "R-5");
  const medianos: RellenoOrganico[] = [{ formatoId: mediano, infladoCm: INFLADO_RELLENO[mediano] ?? INFLADO_MEDIANO_POR_OMISION_CM, trios: false }];
  let estructura = trazo;
  let base = armar(estructura, medianos, flores, huecosFlores);
  for (let pasada = 0; pasada < PASADAS_CORRECCION; pasada++) {
    const hechos = escalonesDe(base.cuenta, escalonDe).grandes;
    if (meta.grandes <= 0 || hechos >= meta.grandes - DESVIO_GRANDES) break;
    const factor = Math.min(CORRECCION_MAXIMA, meta.grandes / Math.max(0.02, hechos));
    const previa = estructura;
    estructura = { ...previa, mezcla: Object.fromEntries(Object.entries(previa.mezcla).map(([f, w]) => [f, escalonDe(f) === "grandes" ? w * factor : w])) };
    base = armar(estructura, medianos, flores, huecosFlores);
  }
  const total = Object.values(base.cuenta).reduce((s, n) => s + n, 0);
  const chicos = Object.entries(base.cuenta).filter(([f]) => escalonDe(f) === "chicos").reduce((s, [, n]) => s + n, 0);
  const faltan = meta.chicos >= TODO_CHICOS ? MAXIMO_CHICOS : Math.max(0, Math.round((meta.chicos * total - chicos) / (1 - meta.chicos)));
  if (faltan < MINIMO_CHICOS_FALTANTES) return { pieza: base.pieza, relleno: "medianos", distancia: distanciaEscalones(escalonesDe(base.cuenta, escalonDe), meta) };
  const conChicos = armar(estructura, [...medianos, { formatoId: chico, infladoCm: INFLADO_RELLENO[chico] ?? INFLADO_CHICO_POR_OMISION_CM, trios: true, racimo: GLOBOS_POR_RACIMITO, maximo: faltan }], flores, huecosFlores);
  return { pieza: conChicos.pieza, relleno: `medianos + ${faltan} chicos en racimitos`, distancia: distanciaEscalones(escalonesDe(conChicos.cuenta, escalonDe), meta) };
}
