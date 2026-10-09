import { distanciaLab } from "./colores-formato";
import type { ColorLeido, ColoresEscalon } from "./lectura-foto";
import type { Globo } from "./medir-geometria";
import type { Escalon } from "./mezcla-lectura";

/**
 * **Los colores de la lectura medidos con los globos detectados** (`medir-con-detecciones.ts`): a qué color de la pieza
 * corresponde cada globo detectado, y con esa cuenta los pesos de los colores de la pieza, los de cada escalón de tamaño y
 * el color dominante de cada tramo. Puro.
 *
 * El detector dice el color con una palabra de una lista corta («azul», «plateado», «blanco»); la lectura, con el nombre del
 * decorador y el color medido en la foto («azul marino», «plata», «blanco perla»). Casarlos por el comienzo del nombre se
 * equivoca («plateado» no es «plata», «azul» no es «azul marino»): cada palabra del detector tiene su color típico y se casa
 * con el color de la pieza más cercano en CIELAB, si no se aparta demasiado. El confeti y lo transparente van por acabado.
 */

export const COLORES_DETECCION = ["dorado", "plateado", "blanco", "negro", "rosa", "fucsia", "rojo", "vino", "naranja", "amarillo", "verde", "azul", "azul marino", "morado", "lila", "nude", "beige", "cafe", "gris", "confeti", "transparente", "otro"] as const;
export type ColorDetectado = (typeof COLORES_DETECCION)[number];

/** El color típico de cada palabra del detector (un globo de látex iluminado). */
export const HEX_DE_COLOR_DETECTADO: Readonly<Record<Exclude<ColorDetectado, "confeti" | "transparente" | "otro">, string>> = {
  dorado: "#D4AF37", plateado: "#C0C0C0", blanco: "#F5F5F5", negro: "#1C1C1C", rosa: "#F4A6C0", fucsia: "#D6247A", rojo: "#C8102E", vino: "#6D1A2B",
  naranja: "#F28C28", amarillo: "#F7D94C", verde: "#3A9D5D", azul: "#2F6DB5", "azul marino": "#1B2A5C", morado: "#6A3FA0", lila: "#C3A6E0",
  nude: "#E3C2A8", beige: "#D8C3A0", cafe: "#6B4423", gris: "#8C8C8C",
};

/** Hasta esta distancia CIELAB un color de la pieza vale por el que dijo el detector; más allá, ese globo no cuenta. */
export const DISTANCIA_MAXIMA_COLOR = 40;
/** Con menos globos de color casado no se rehace el reparto de colores de la pieza. */
export const MINIMO_CASADOS = 15;
/** Globos casados que pide un escalón o un tramo para fiarse de su reparto de colores. */
export const MINIMO_COLOR_ESCALON = 6;
/** Diferencia mínima (en puntos de %) con el reparto de la pieza para que un escalón lleve sus propios colores. */
export const DESVIO_COLOR_ESCALON = 15;
/**
 * Un color domina un tramo si tiene al menos este % de sus globos, le saca esta diferencia (puntos de %) a su peso en la pieza y
 * tiene al menos `RAZON_SEGUNDO` veces los globos del segundo color. Con 70 % no dominaba ningún tramo de una guirnalda con acentos
 * (el blanco de la izquierda con un tercio de plateados): la mayoría simple y el doble del segundo bastan.
 */
export const PARTE_DOMINANTE = 50;
export const VENTAJA_DOMINANTE = 15;
export const RAZON_SEGUNDO = 2;
/** Una ventana de dos puntos seguidos necesita al menos estos globos casados del cuerpo para decir un tramo, y un punto al menos estos para tomarlo. */
export const MINIMO_VENTANA = 12;
export const MINIMO_PUNTO = 5;
/** El azar que se tolera en TODA la guirnalda (probabilidad de pintar un tramo falso en una guirnalda de colores parejos); se reparte entre sus ventanas y colores. */
export const ALFA_DOMINANTE = 0.05;

/**
 * Un nude o un beige no se parecen a un blanco por estar «a menos de 40» de él (un montón de nude se leía blanco, 005): para casarlos con un color de
 * la pieza tienen que estar mucho más cerca. El dorado detectado casa con el cromado más cercano (el champaña 971 de una guirnalda es «dorado» para el
 * detector, aunque su hex quede a 43 del dorado típico).
 */
export const DISTANCIA_MAXIMA_NEUTRO = 15;
export const DISTANCIA_MAXIMA_METAL = 60;
/** El tono (grados) de un hex #rrggbb. */
function tonoDe(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), croma = max - Math.min(r, g, b);
  if (croma === 0) return 0;
  const h = max === r ? ((g - b) / croma) % 6 : max === g ? (b - r) / croma + 2 : (r - g) / croma + 4;
  return (h * 60 + 360) % 360;
}
/** Un cromado es «dorado» (champaña, oro) y no «oro rosa» o plata si su tono cae en el amarillo-naranja. */
const esTonoDorado = (hex: string) => { const t = tonoDe(hex); return t >= 28 && t <= 62; };
const PALABRAS_NEUTRAS: ReadonlySet<string> = new Set(["nude", "beige"]);

/** El índice del color de la pieza que corresponde a cada color detectado (memoizado), o -1. */
export function indiceDeDetectado(colores: readonly ColorLeido[]): (color: string) => number {
  const memo = new Map<string, number>();
  const calcular = (color: string): number => {
    const c = color.trim().toLowerCase();
    if (c === "confeti") return colores.findIndex((x) => x.acabado === "confeti");
    if (c === "transparente") return colores.findIndex((x) => x.acabado === "cristal");
    const hex = (HEX_DE_COLOR_DETECTADO as Readonly<Record<string, string>>)[c];
    if (!hex) return -1;
    const mejorEntre = (admite: (x: ColorLeido) => boolean, limite: number): number => {
      let mejor = -1, mejorD = Infinity;
      colores.forEach((x, k) => {
        if (x.acabado === "confeti" || x.acabado === "cristal" || !admite(x)) return;
        const d = distanciaLab(hex, x.hex);
        if (d < mejorD) { mejorD = d; mejor = k; }
      });
      return mejorD <= limite ? mejor : -1;
    };
    const normal = mejorEntre(() => true, PALABRAS_NEUTRAS.has(c) ? DISTANCIA_MAXIMA_NEUTRO : DISTANCIA_MAXIMA_COLOR);
    // El champaña 971 de una guirnalda es «dorado» para el detector aunque su hex quede a 43 del dorado típico: si ningún color se le parece, casa con el cromado más cercano.
    return normal >= 0 || c !== "dorado" ? normal : mejorEntre((x) => x.acabado === "cromado" && esTonoDorado(x.hex), DISTANCIA_MAXIMA_METAL);
  };
  return (color) => {
    if (!memo.has(color)) memo.set(color, calcular(color));
    return memo.get(color)!;
  };
}

/** Cuántos globos de cada color de la pieza hay en la lista (los que no casan con ninguno no cuentan). */
export function cuentaPorColor(lista: readonly Globo[], colores: readonly ColorLeido[], indiceDe = indiceDeDetectado(colores)): { cuenta: number[]; total: number } {
  const cuenta = colores.map(() => 0);
  let total = 0;
  for (const g of lista) { const k = indiceDe(g.color); if (k >= 0) { cuenta[k]!++; total++; } }
  return { cuenta, total };
}

/**
 * Los pesos de los colores de la pieza por la cuenta de colores detectados, en una sola escala (suman 100): los colores que
 * aparecen se reparten lo que no ocupan los que no aparecen, que conservan su parte de la lectura.
 */
export function coloresDe(colores: readonly ColorLeido[], globos: readonly Globo[]): ColorLeido[] {
  const { cuenta, total } = cuentaPorColor(globos, colores);
  if (total < MINIMO_CASADOS) return [...colores];
  const pesoTotal = colores.reduce((s, c) => s + c.peso, 0) || 1;
  const sinCuenta = colores.reduce((s, c, k) => s + (cuenta[k]! > 0 ? 0 : (100 * c.peso) / pesoTotal), 0);
  const presupuesto = Math.max(0, 100 - sinCuenta);
  return colores.map((c, k) => ({ ...c, peso: Math.max(1, Math.round(cuenta[k]! > 0 ? (presupuesto * cuenta[k]!) / total : (100 * c.peso) / pesoTotal)) }));
}

/** Los colores de cada escalón que se aparta del reparto de la pieza («los chicos, todos dorados»). */
export function coloresPorEscalonDe(porEscalon: ReadonlyMap<Escalon, readonly Globo[]>, colores: readonly ColorLeido[]): ColoresEscalon[] {
  const indiceDe = indiceDeDetectado(colores);
  const pesoTotal = colores.reduce((s, c) => s + c.peso, 0) || 1;
  const salida: ColoresEscalon[] = [];
  for (const [e, lista] of porEscalon) {
    const { cuenta, total } = cuentaPorColor(lista, colores, indiceDe);
    if (total < MINIMO_COLOR_ESCALON) continue;
    const pesos = cuenta.map((n) => Math.round((100 * n) / total));
    if (pesos.some((w, k) => Math.abs(w - (100 * colores[k]!.peso) / pesoTotal) >= DESVIO_COLOR_ESCALON)) salida.push({ escalon: e, pesos });
  }
  return salida;
}

/** El reparto (0 a 1) de los globos entre los colores de la pieza, sin contar los que no casan con ninguno; vacío (ceros) si no hay ninguno. */
export function repartoDeColores(lista: readonly Globo[], colores: readonly ColorLeido[], indiceDe = indiceDeDetectado(colores)): number[] {
  const { cuenta, total } = cuentaPorColor(lista, colores, indiceDe);
  return cuenta.map((n) => (total ? n / total : 0));
}

/** P(X ≥ k) para X binomial de `n` pruebas y probabilidad `p`: cuán raro es ver `k` globos de un color entre `n` si cada uno lo fuera por azar con su parte `p`. */
export function colaBinomial(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  const q = Math.min(1, Math.max(0, p));
  let termino = Math.pow(1 - q, n), suma = 0;
  for (let i = 1; i <= n; i++) {
    termino *= ((n - i + 1) / i) * (q / (1 - q || 1e-12));
    if (i >= k) suma += termino;
  }
  return Math.min(1, suma);
}

/**
 * El color que domina cada punto de una guirnalda (`null` en un punto sin globos medidos), o undefined. Es un barrido de ventanas
 * de dos puntos seguidos: en cada una, para cada color, se pregunta si su cuenta entre los globos del CUERPO de la ventana se da por
 * azar contra su parte en el cuerpo de toda la pieza (`referencia`; cola binomial), con la corrección por pruebas múltiples
 * (`ALFA_DOMINANTE` es el azar tolerado en TODA la guirnalda, repartido entre sus ventanas y colores): sin ella, doce puntos de una
 * guirnalda pareja daban un tramo falso una vez de cada seis. Un punto toma el color de una ventana que lo trae si además él mismo lo
 * tiene en mayoría (≥ 50 % de sus globos casados, el doble que el segundo y 15 puntos más que en la referencia).
 */
export function dominantesPorTramo(tramos: ReadonlyArray<readonly Globo[] | null>, colores: readonly ColorLeido[], indiceDe: (color: string) => number, referencia: readonly number[]): Array<string | undefined> {
  const cuentas = tramos.map((t) => (t ? cuentaPorColor(t, colores, indiceDe) : null));
  const ventanas = cuentas.flatMap((c, i) => (c && cuentas[i + 1] ? [i] : []));
  const alfa = ALFA_DOMINANTE / Math.max(1, ventanas.length * colores.length);
  const sale = cuentas.map(() => new Set<number>());
  for (const i of ventanas) {
    const a = cuentas[i]!, b = cuentas[i + 1]!, n = a.total + b.total;
    if (n < MINIMO_VENTANA) continue;
    colores.forEach((_, k) => {
      if (colaBinomial(a.cuenta[k]! + b.cuenta[k]!, n, referencia[k] ?? 0) <= alfa) { sale[i]!.add(k); sale[i + 1]!.add(k); }
    });
  }
  return cuentas.map((c, i) => {
    if (!c || c.total < MINIMO_PUNTO) return undefined;
    const propios = [...sale[i]!].filter((k) => {
      const segundo = c.cuenta.reduce((m, n, j) => (j !== k && n > m ? n : m), 0);
      return 100 * (c.cuenta[k]! / c.total) >= PARTE_DOMINANTE && c.cuenta[k]! >= RAZON_SEGUNDO * segundo && 100 * (c.cuenta[k]! / c.total - (referencia[k] ?? 0)) >= VENTAJA_DOMINANTE;
    });
    const k = propios.reduce<number | undefined>((m, j) => (m === undefined || c.cuenta[j]! > c.cuenta[m]! ? j : m), undefined);
    return k === undefined ? undefined : colores[k]!.nombre;
  });
}

// ----------------------------------------------------------------------------------------------------------
// La paleta de la escena en los montones de piso
// ----------------------------------------------------------------------------------------------------------

/** Un color nuevo en un montón necesita al menos esta cantidad de globos detectados y esta parte de los del montón. */
export const MINIMO_COLOR_NUEVO = 2;
export const PARTE_COLOR_NUEVO = 0.1;
/** Lo más que pesan juntos los colores que se agregan a un montón (el resto sigue siendo de los que leyó el lector). */
const PESO_MAXIMO_NUEVOS = 60;
const DISTANCIA_PALETA = 25;
/** Cómo se llama en la tabla Sempertex el color típico de cada palabra del detector que no se parece a ningún color de la escena. */
const NOMBRE_DE_PALABRA: Readonly<Record<string, string>> = { nude: "nude", beige: "arena", dorado: "dorado", plateado: "plata", cafe: "café" };

/** El color de la escena (o, si ninguno se le parece, el típico de la palabra) que representa a la palabra del detector en un montón. */
function colorParaPalabra(palabra: string, paleta: readonly ColorLeido[]): ColorLeido | null {
  const hex = (HEX_DE_COLOR_DETECTADO as Readonly<Record<string, string>>)[palabra];
  if (palabra === "confeti" || palabra === "transparente") return paleta.find((x) => x.acabado === (palabra === "confeti" ? "confeti" : "cristal")) ?? null;
  if (!hex) return null;
  const metal = palabra === "dorado" || palabra === "plateado";
  const candidatos = paleta.filter((x) => x.acabado !== "confeti" && x.acabado !== "cristal" && (metal ? x.acabado === "cromado" : x.acabado !== "cromado"));
  const limite = palabra === "dorado" ? DISTANCIA_MAXIMA_METAL : PALABRAS_NEUTRAS.has(palabra) ? DISTANCIA_MAXIMA_NEUTRO : DISTANCIA_PALETA;
  const mejor = candidatos.map((x) => ({ x, d: distanciaLab(hex, x.hex) })).sort((a, b) => a.d - b.d)[0];
  if (mejor && mejor.d <= limite) return mejor.x;
  return { nombre: NOMBRE_DE_PALABRA[palabra] ?? palabra, hex, peso: 1, acabado: metal ? "cromado" : "mate" };
}

/**
 * Los colores de un montón de piso con los que la detección ve en él y el lector no puso (`coloresDe` solo repesa los que ya había): cada color
 * detectado que no casa con ninguno del montón, con al menos `MINIMO_COLOR_NUEVO` globos y `PARTE_COLOR_NUEVO` de los del montón, entra con su parte;
 * toma el color de la escena que más se le parece (`paleta`: los de las demás piezas de globos) o, si ninguno, el típico de su palabra. Vale con pocas
 * detecciones (un montón de menos de `MINIMO_GLOBOS`). Los que ya había se encogen para dejarles lugar. Puro.
 */
export function coloresConLaEscena(colores: readonly ColorLeido[], globos: readonly Globo[], paleta: readonly ColorLeido[]): { colores: ColorLeido[]; nuevos: string[] } {
  const indiceDe = indiceDeDetectado(colores);
  const palabra = (g: Globo) => g.color.trim().toLowerCase();
  const conocidos = globos.filter((g) => palabra(g) in HEX_DE_COLOR_DETECTADO || palabra(g) === "confeti" || palabra(g) === "transparente");
  const sinColor = new Map<string, number>();
  for (const g of conocidos) if (indiceDe(g.color) < 0) sinColor.set(palabra(g), (sinColor.get(palabra(g)) ?? 0) + 1);
  const nuevos: ColorLeido[] = [];
  for (const [clave, cuenta] of [...sinColor].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    if (cuenta < MINIMO_COLOR_NUEVO || cuenta / conocidos.length < PARTE_COLOR_NUEVO) continue;
    const base = colorParaPalabra(clave, paleta);
    if (!base || [...colores, ...nuevos].some((x) => x.nombre === base.nombre && x.acabado === base.acabado)) continue;
    nuevos.push({ ...base, peso: Math.max(1, Math.round((100 * cuenta) / conocidos.length)) });
  }
  if (!nuevos.length) return { colores: [...colores], nuevos: [] };
  const suma = nuevos.reduce((s, c) => s + c.peso, 0);
  const factor = suma > PESO_MAXIMO_NUEVOS ? PESO_MAXIMO_NUEVOS / suma : 1;
  const agregados = nuevos.map((c) => ({ ...c, peso: Math.max(1, Math.round(c.peso * factor)) }));
  const restante = Math.max(1, 100 - agregados.reduce((s, c) => s + c.peso, 0));
  const pesoTotal = colores.reduce((s, c) => s + c.peso, 0) || 1;
  return { colores: [...colores.map((c) => ({ ...c, peso: Math.max(1, Math.round((restante * c.peso) / pesoTotal)) })), ...agregados].slice(0, 6), nuevos: agregados.map((c) => c.nombre) };
}
