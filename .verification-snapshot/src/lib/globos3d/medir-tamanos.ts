import type { MezclaLeida, MezclaTramo } from "./lectura-foto";
import { kMedias1D, mediana, r3, type Globo } from "./medir-geometria";
import { CAMPOS, ESCALONES, FORMATOS_DEL_ESCALON, diametroOrganicoCm, formatoOrganicoPorDiametro, type Escalon } from "./mezcla-lectura";

/**
 * **Los tamaños de una pieza medidos con sus globos detectados** (`medir-con-detecciones.ts`): los globos se agrupan en los
 * escalones que leyó el lector (chicos < medianos < grandes < gigantes), de cada escalón sale su diámetro y su formato, y de los
 * propios globos la escala de la foto. Puro.
 *
 * El agrupado es robusto a lo que falla en una detección: una caja suelta mucho mayor que las demás (el panel de fondo tomado por
 * un globo, un globo repetido que se fundió mal) no se lleva un escalón entero. Un grupo con menos de 3 globos (y del 3 % de la
 * pieza) no es un escalón: sus cajas se descartan y se agrupa de nuevo con los mismos escalones; dos grupos casi del mismo tamaño
 * son uno solo y se pierde el escalón de más arriba. Después, los globos que se apartan de la mediana de su escalón más de
 * `RAZON_ATIPICO` veces se descartan y se vuelve a agrupar.
 */

/** Los globos a la altura de la pared llegan a esta fracción del alto de la foto bajo la línea del piso. */
const HOLGURA_PISO = 0.02;
/** Los globos que se miden para la escala: al menos esta cantidad de los del escalón ancla, a la altura de la pared. */
const MINIMO_PARA_ESCALA = 3;
/**
 * El formato que nombró el lector se respeta si la medida no se le aparta más de esta fracción de su diámetro, o de estos cm si
 * es más (las cajas salen infladas unos centímetros: un R-5 de 12 cm se mide como de 15 a 17).
 */
const TOLERANCIA_FORMATO_NOMBRADO = 0.25;
const HOLGURA_CAJA_CM = 5;
/** Tope de la parte de chicos que se toma de lo leído (los chicos se detectan de menos). */
const TOPE_CHICOS_LEIDOS = 60;
const REAL_ANCLA_POR_OMISION_CM = 25;
/** Un grupo de globos con menos de esta parte de la pieza (y de 3) no es un escalón: es una caja suelta. */
const PARTE_MINIMA_GRUPO = 0.03;
const MINIMO_ABSOLUTO_GRUPO = 3;
/** Dos escalones vecinos de la detección miden al menos esta razón entre sí (R-18 contra R-12 es 1,36; la caja suelta de un solo tamaño no la alcanza). */
const RAZON_ESCALON_MINIMA = 1.2;
/** Un grupo chico de globos enteros se queda como escalón si su diámetro no pasa de esta vez el del escalón de abajo (R-36 contra R-12 es 3). */
const RAZON_MAXIMA_ENTRE_ESCALONES = 3.3;
/** Un globo que mide más de esta razón (o menos de su inversa) de la mediana de su escalón no es de ese escalón. */
const RAZON_ATIPICO = 2;
const VUELTAS_ATIPICOS = 3;
/** El escalón en que se ancla la escala: el más común y de formato más seguro; los chicos, que se detectan peor, solo si no hay otro. */
const PREFERENCIA_ANCLA: readonly Escalon[] = ["medianos", "grandes", "gigantes", "chicos"];

/** Los escalones que la pieza dice tener, de chico a grande (al menos chicos y medianos). */
export function escalonesDe(m: MezclaLeida | undefined): Escalon[] {
  const hay = [...ESCALONES].reverse().filter((e) => ((m?.[e] as number | undefined) ?? 0) > 0);
  return hay.length >= 2 ? hay : ["chicos", "medianos", "grandes"];
}

/** El % por escalón de una lista; los chicos, como mínimo los leídos (se detectan de menos). */
export function repartoDe(lista: readonly Escalon[], escalones: readonly Escalon[], leida: Partial<MezclaTramo> | undefined): MezclaTramo {
  const cuenta = new Map<Escalon, number>();
  for (const e of lista) cuenta.set(e, (cuenta.get(e) ?? 0) + 1);
  const total = lista.length || 1;
  const pct = Object.fromEntries(escalones.map((e) => [e, (100 * (cuenta.get(e) ?? 0)) / total])) as Record<Escalon, number>;
  if (escalones.includes("chicos")) pct.chicos = Math.max(pct.chicos, Math.min(TOPE_CHICOS_LEIDOS, leida?.chicos ?? 0));
  const suma = Object.values(pct).reduce((s, w) => s + w, 0) || 1;
  const salida: MezclaTramo = { grandes: 0, medianos: 0, chicos: 0 };
  for (const e of escalones) (salida as Record<string, number>)[e] = Math.round((100 * pct[e]) / suma);
  return salida;
}

/** Un grupo chico es un escalón de verdad si son globos enteros y no pasan de `RAZON_MAXIMA_ENTRE_ESCALONES` veces el grupo de abajo. */
function esEscalonDeEnteros(i: number, globos: readonly Globo[], indice: readonly number[]): boolean {
  const suyos = globos.filter((_, j) => indice[j] === i);
  if (!suyos.every((g) => g.entero)) return false;
  if (i === 0) return true;
  const deAbajo = globos.filter((_, j) => indice[j] === i - 1).map((g) => g.d);
  return deAbajo.length === 0 || mediana(suyos.map((g) => g.d)) <= RAZON_MAXIMA_ENTRE_ESCALONES * mediana(deAbajo);
}

type Agrupado = { escalones: Escalon[]; globos: Globo[]; indice: number[] };

/**
 * Agrupa los globos en tantos grupos como escalones y asigna cada uno al más cercano. Mientras no queden bien separados:
 * - un grupo con menos globos que el mínimo son cajas sueltas (con ellas el agrupado gastaba un escalón en cada una): se
 *   descartan y se vuelve a agrupar con los mismos escalones; salvo que todos sus globos sean ENTEROS (una caja de globo, no la
 *   de medio montón) y no midan más de 3,3 veces el escalón de abajo: dos o tres gigantes de verdad son el escalón de gigantes;
 * - dos grupos vecinos de tamaño casi igual (o un grupo vacío) son el mismo escalón: se queda uno menos, el de más arriba
 *   (los escalones de arriba son los que menos globos tienen y los que más se inventa el lector).
 */
function agrupar(lista: readonly Globo[], escalonesLeidos: readonly Escalon[]): Agrupado {
  const minimo = Math.max(MINIMO_ABSOLUTO_GRUPO, Math.floor(PARTE_MINIMA_GRUPO * lista.length));
  let globos = [...lista];
  let escalones = [...escalonesLeidos];
  for (;;) {
    const logs = globos.map((g) => Math.log(g.d));
    const centros = kMedias1D(logs, escalones.length);
    const indice = logs.map((x) => centros.reduce((mejor, c, i) => (Math.abs(x - c) < Math.abs(x - centros[mejor]!) ? i : mejor), 0));
    if (escalones.length <= 2) return { escalones, globos, indice };
    const tamanos = centros.map((_, i) => indice.filter((j) => j === i).length);
    const sueltas = tamanos.findIndex((n, i) => n > 0 && n < minimo && !esEscalonDeEnteros(i, globos, indice));
    if (sueltas >= 0) { globos = globos.filter((_, j) => indice[j] !== sueltas); continue; }
    const juntos = centros.some((c, i) => tamanos[i] === 0 || (i > 0 && c - centros[i - 1]! < Math.log(RAZON_ESCALON_MINIMA)));
    if (!juntos) return { escalones, globos, indice };
    escalones = escalones.slice(0, -1);
  }
}

export type MedidaTamanos = {
  escalones: Escalon[];
  /** Los globos que se midieron (los de la lista menos los atípicos). */
  globos: Globo[];
  /** Cuántos globos de la lista se descartaron por no ser de ningún escalón. */
  atipicos: number;
  /** El escalón de cada globo medido (en el mismo orden). */
  escalonDe: Escalon[];
  porEscalon: Map<Escalon, Globo[]>;
  mezcla: MezclaLeida;
  reparto: MezclaTramo;
  escalaCm: number | null;
  /** Los globos a la altura de la pared (no los del frente), para las anclas. */
  dePared: (g: Globo) => boolean;
};

/**
 * Rehace los formatos de cada escalón de una mezcla ya medida con otra escala de la foto: el diámetro medido (fracción del alto de la foto)
 * por la escala (cm de alto de foto) da los cm reales. Cuando la política de escala (`escala-por-muebles.ts`) no toma la escala de los globos,
 * los formatos que `medirTamanos` puso con ella (diámetro × escala de los globos) ya no cuadran; el nombrado se respeta si cae en la misma
 * tolerancia que allí y, si no, se toma el formato de catálogo más cercano a los cm nuevos. Pura.
 */
export function formatosPorEscala(mezcla: MezclaLeida, escalaCm: number): MezclaLeida {
  const salida: MezclaLeida = { ...mezcla };
  for (const e of ESCALONES) {
    const d = mezcla[CAMPOS[e].diametro];
    if (typeof d !== "number" || !(d > 0)) continue;
    const cm = d * escalaCm;
    const nombrado = mezcla[CAMPOS[e].formato] as string | undefined;
    const real = nombrado ? diametroOrganicoCm(nombrado) : null;
    (salida as Record<string, unknown>)[CAMPOS[e].formato] = real && Math.abs(cm - real) <= Math.max(real * TOLERANCIA_FORMATO_NOMBRADO, HOLGURA_CAJA_CM) ? nombrado : formatoOrganicoPorDiametro(cm);
  }
  return salida;
}

/**
 * Agrupa los globos de una pieza en los escalones que leyó el lector y mide cada uno. Con `renombrar` escribe en la mezcla el
 * diámetro y el formato de cada escalón y saca la escala de la foto (las guirnaldas); sin él solo el reparto (un montón de piso
 * se ve más cerca de la cámara: su tamaño no dice la escala de la foto).
 */
export function medirTamanos(m: MezclaLeida | undefined, lista: readonly Globo[], pisoY: number | null, renombrar: boolean): MedidaTamanos {
  const leidos = escalonesDe(m);
  let grupos = agrupar(lista, leidos);
  for (let vuelta = 0; vuelta < VUELTAS_ATIPICOS; vuelta++) {
    const medianas = grupos.escalones.map((_, i) => mediana(grupos.globos.filter((_, j) => grupos.indice[j] === i).map((g) => g.d)));
    const buenos = grupos.globos.filter((g, j) => { const med = medianas[grupos.indice[j]!]!; return g.d <= med * RAZON_ATIPICO && g.d >= med / RAZON_ATIPICO; });
    if (buenos.length === grupos.globos.length || buenos.length < 2) break;
    grupos = agrupar(buenos, leidos);
  }
  const { escalones, globos } = grupos;
  const escalonDe = globos.map((_, i) => escalones[grupos.indice[i]!]!);
  const porEscalon = new Map<Escalon, Globo[]>();
  globos.forEach((g, i) => { const l = porEscalon.get(escalonDe[i]!); if (l) l.push(g); else porEscalon.set(escalonDe[i]!, [g]); });
  const dePared = (g: Globo) => pisoY === null || g.y + g.d / 2 <= pisoY + HOLGURA_PISO;
  const mezcla: MezclaLeida = { ...(m ?? { grandes: 0, medianos: 0, chicos: 0, diametroGrande: 0.1 }) };
  let escalaCm: number | null = null;
  if (renombrar) {
    // El diámetro de cada escalón; la escala se ancla en los medianos (casi siempre R-12) y el formato de los demás sale de su
    // PROPORCIÓN con ellos, no del nombre que puso el lector a ojo.
    const diametros = new Map<Escalon, { d: number; pared: number }>();
    for (const e of escalones) {
      const l = porEscalon.get(e) ?? [];
      if (!l.length) continue;
      const pared = l.filter(dePared);
      diametros.set(e, { d: mediana((pared.length >= 2 ? pared : l).map((g) => g.d)), pared: pared.length });
    }
    const ancla = PREFERENCIA_ANCLA.find((e) => diametros.has(e));
    if (ancla) {
      const formatoAncla = ((mezcla[CAMPOS[ancla].formato] as string | undefined) ?? FORMATOS_DEL_ESCALON[ancla][0]!);
      const realAncla = diametroOrganicoCm(formatoAncla) ?? REAL_ANCLA_POR_OMISION_CM;
      const dAncla = diametros.get(ancla)!.d;
      if (diametros.get(ancla)!.pared >= MINIMO_PARA_ESCALA) escalaCm = realAncla / dAncla;
      for (const [e, { d }] of diametros) {
        (mezcla as Record<string, unknown>)[CAMPOS[e].diametro] = r3(d);
        const cm = (d / dAncla) * realAncla;
        const nombrado = mezcla[CAMPOS[e].formato] as string | undefined;
        const realNombrado = nombrado ? diametroOrganicoCm(nombrado) : null;
        const formato = e === ancla ? formatoAncla : realNombrado && Math.abs(cm - realNombrado) <= Math.max(realNombrado * TOLERANCIA_FORMATO_NOMBRADO, HOLGURA_CAJA_CM) ? nombrado! : formatoOrganicoPorDiametro(cm);
        (mezcla as Record<string, unknown>)[CAMPOS[e].formato] = formato;
      }
    }
  }
  const reparto = repartoDe(escalonDe, escalones, m);
  // Un escalón que el lector vio y la detección no encontró queda en 0 %.
  for (const e of leidos) if (!escalones.includes(e)) (mezcla as Record<string, unknown>)[e] = 0;
  Object.assign(mezcla, reparto);
  return { escalones, globos, atipicos: lista.length - globos.length, escalonDe, porEscalon, mezcla, reparto, escalaCm, dePared };
}
