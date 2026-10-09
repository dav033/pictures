import { TABLA_SEMPERTEX, type ReferenciaSempertex } from "@/lib/plan/referencia-sempertex";
import { coloresDelFormato, formatoPorId, infladoValido } from "./formatos";
import { colorDeRescate, sustitutoDeFamilia } from "./colores-formato";
import { centroCuerpo } from "./geometria";
import type { GloboColocado, Vec3 } from "./modulos";

/**
 * Generador orgánico 3D (columna, guirnalda, semiarco) sin three.js ni React: dónde va cada globo, de qué
 * tamaño y color, y qué huecos quedan para las flores. Determinista: la misma semilla da el mismo resultado.
 *
 * **Cómo se arma (técnica Sempertex, revistas Celebra).** Una estructura orgánica son tiras de racimos de
 * tamaños mezclados atadas a un armazón: los globos grandes van de ancla en la base y decrecen hacia la punta,
 * y al final se rellena con tríos de R-5 «hasta que quede tupido y gordito». Aquí se reproduce en ese orden:
 *
 * 1. **Recorrido y envoltura.** Cada tramo es una polilínea 3D (cm, y hacia arriba) suavizada con Catmull-Rom,
 *    con un perfil de grosor (radio de la envoltura según la fracción del recorrido) que se abolla con un ruido
 *    periódico (`irregularidad`): eso es lo que hace que la silueta no sea un tubo perfecto.
 * 2. **Estructura, de grande a pequeño.** La mezcla de tamaños cambia a lo largo del recorrido (`PuntoMezcla`).
 *    Con ella se calcula cuántos globos de cada formato pide cada centímetro para cubrir la envoltura (ver
 *    `estructuraPorCm`) y se colocan primero todos los grandes (anclas, donde los pide la mezcla) y luego los
 *    medianos, de abajo arriba, cada uno en el primer sitio libre y pegado a sus vecinos. El centro de un globo
 *    nunca se mete en el eje (va amarrado al armazón y sale hacia fuera: `profundidad`).
 *    Luego se **aprietan**: cada par cuyas caras quedan a menos de 7 cm se atrae hasta tocarse, mientras la envoltura
 *    los sujeta; así no quedan rendijas de unos centímetros entre todos y los huecos se juntan en bolsillos.
 * 3. **Huecos para flores.** Antes de rellenar se reservan los bolsillos más grandes de la cara que se ve (no del borde
 *    de la silueta), repartidos entre los tramos según su largo: ahí van las flores artificiales
 *    (`flores-artificiales.ts`), no globos. Cada ancla lleva sus globos vecinos (`apoyos`) para que las flores se
 *    asienten contra ellos y no queden al aire.
 * 4. **Relleno.** Los huecos que quedan se tapan con R-9 y luego con tríos de R-5, de mayor a menor hueco, y se
 *    vuelve a apretar.
 * 5. **Relajación.** Unas pasadas atraen cada globo a la envoltura y separan los que se montan; al final ningún
 *    par se aplasta más del 12 % del diámetro del menor (`APLASTAMIENTO_MAXIMO`, el mismo criterio de los
 *    módulos de `modulos.ts`), y si alguno no se puede soltar, se quita.
 * 5b. **Tupido.** Una capa de globos que se tocan deja triángulos por donde se ve a través (cerrarlos pediría un 13 %
 *    de aplastamiento). Se lanzan rayos desde el eje hacia fuera y en cada uno que no toca un globo se mete un relleno
 *    (por fuera si cabe, si no por dentro, contra el armazón) que toque a tres vecinos; el que queda tocando a menos de
 *    tres se arrima, se acompaña con otro R-5, se cambia o, si no hace falta para tapar, se quita. Los contactos
 *    cuentan el piso, el pedestal y el tubo del armazón (`RADIO_ARMAZON_CM`).
 * 6. **Color.** Por proporción (cuotas exactas sobre el total) y sin dos globos del mismo color pegados cuando se
 *    puede. Cada color debe fabricarse en el formato del globo: si no, se usa el más parecido de su misma familia
 *    en ese formato (y se avisa); si la familia no lo tiene parecido, ese color no se usa en ese globo. Si ningún
 *    color de la paleta viene en un formato, el más parecido que se fabrique en él (y se avisa), nunca el blanco.
 *
 * Los globos apuntan hacia fuera del eje: el nudo queda hacia dentro, oculto, y el cuerpo hacia fuera.
 *
 * **Densidad.** Se informa en globos por metro y por pie del recorrido y se sitúa con los rangos del oficio que
 * usa el motor del plan (`services/ai-api/app/organico/medidas.py`): ligero hasta 10 por pie (33/m), estándar
 * 11–17 (36–56/m), lleno más de 17. Esos rangos son de la mezcla `organica_fina` (R-12 domina); con una mezcla
 * de grandes (`organica_gruesa`, R-18/R-24 en la base) salen menos globos por metro para el mismo grosor.
 */

/** Cuánto pueden aplastarse dos globos que se tocan: un 12 % del diámetro del menor (igual que en `modulos.ts`). */
export const APLASTAMIENTO_MAXIMO = 0.12;

/** Un globo de este inflado o más es «grande» (ancla de la base). */
export const INFLADO_GRANDE_CM = 38;

/** Radio del tubo del armazón (PVC de 1"), en el eje de cada tramo: los globos de dentro se apoyan en él. */
export const RADIO_ARMAZON_CM = 1.6;

export type PuntoGrosor = { t: number; radioCm: number };

/** Pesos relativos por formato (`"R-12"`) en la fracción `t` del recorrido; entre dos puntos se interpola. */
export type PuntoMezcla = { t: number; pesos: Readonly<Record<string, number>> };

export type TramoOrganico = {
  id: string;
  nombre: string;
  /** Puntos de control del eje (cm); se suaviza con Catmull-Rom. */
  recorrido: readonly Vec3[];
  /** Radio de la envoltura (hasta donde llega la cara de fuera de los globos) a lo largo del recorrido. */
  grosor: readonly PuntoGrosor[];
  mezcla: readonly PuntoMezcla[];
  /** 0–0,3: cuánto se abolla la envoltura. */
  irregularidad: number;
  /** Remate redondo (media esfera de globos) al inicio o al final; sin él, el extremo queda abierto (al piso o a otro tramo). */
  tapas?: { inicio?: boolean; fin?: boolean };
  /** Multiplica los globos de estructura de este tramo (además de `densidad` de las opciones). */
  densidad?: number;
};

/** Relleno de huecos: se prueba en este orden; con `trios`, cada relleno intenta llevar dos compañeros. */
export type RellenoOrganico = {
  formatoId: string; infladoCm: number; trios: boolean;
  /** A lo más cuántos globos de este relleno (con sus compañeros): para que los chicos no pasen de lo que pide la mezcla. */
  maximo?: number;
  /** Globos por racimito (con `trios`; 3 por omisión, hasta 6): los R-5 de las fotos van en racimitos de 3 a 5. */
  racimo?: number;
};

/**
 * Un color de la paleta (código Sempertex de 3 cifras) con su peso relativo. `formatos` limita en qué globos va
 * (p. ej. el cristal con confeti solo en R-12 y R-18); `confeti` marca el globo para que el visor lo rellene.
 * `tramos` limita en qué tramos va (por su `id`, o por el comienzo de su id hasta un «_»: «franja_1» vale para
 * «franja_1» y «franja_1_izquierda», no para «franja_10»): así se hace un degradé o un bicolor por partes (la franja
 * de abajo oscura y la de arriba clara, la espiral de otro color). El mismo código puede ir dos veces con tramos y pesos
 * distintos. `franjas` lo limita además a unos trechos de su tramo (fracciones del recorrido, 0 al inicio y 1 al final):
 * racimos de un color que se turnan o un degradé a lo largo de un arco sin partirlo en tramos. Las cuotas se reparten,
 * en cada grupo de globos que admite los mismos colores, entre esos colores por sus pesos.
 */
export type FranjaColor = { desde: number; hasta: number };
export type ColorOrganico = {
  codigo: string; peso: number; confeti?: boolean; formatos?: readonly string[]; tramos?: readonly string[]; franjas?: readonly FranjaColor[];
  /**
   * La cuota de este color se cuenta en cada FORMATO por separado (los colores por escalón medidos en una foto: «los R-24,
   * 89 % dorados»). Sin él, la cuota es sobre todos los globos del tramo y un color que no va en un formato se concentra
   * en los demás (el Reflex Azul que no viene en R-9 queda en todos los R-24).
   */
  porFormato?: boolean;
};

/** Un obstáculo cilíndrico vertical (un pedestal): `base` es el centro de su cara de abajo. */
export type Cilindro = { id: string; base: Vec3; radioCm: number; altoCm: number };

export type OpcionesOrganico = {
  semilla: number;
  tramos: readonly TramoOrganico[];
  /** Inflado nominal por formato (cm); si falta, el de decoración del formato. */
  inflados?: Readonly<Record<string, number>>;
  /** ±fracción con que varía el inflado de cada globo (0,07 = ±7 %). */
  variacionInflado: number;
  relleno: readonly RellenoOrganico[];
  colores: readonly ColorOrganico[];
  obstaculos?: readonly Cilindro[];
  /** Hay piso en y = 0: ningún globo lo atraviesa. */
  suelo: boolean;
  /** Cuántos huecos reservar para flores. */
  huecosFlores: number;
  /** Hacia dónde está quien mira: las flores solo van en la cara que se ve. Sin él, en cualquier lado. */
  vista?: Vec3;
  /** Multiplica los globos de estructura por centímetro (1 = envoltura cubierta). */
  densidad?: number;
  pasadasRelajacion?: number;
  /**
   * Globos FIJOS (los gigantes y grandes de una foto, donde la foto los tiene): van en ese sitio y con ese color, la
   * relajación no los mueve ni se quitan, y la estructura del tramo cuenta con ellos (pone uno menos de su formato).
   * `centro` en el plano del tramo (x, y en cm); se ponen por delante del eje, en la cara que se ve.
   */
  fijos?: readonly GloboFijo[];
};

export type GloboFijo = { formatoId: string; codigo: string; x: number; y: number; infladoCm?: number };

export type TamanoOrganico = "grande" | "mediano" | "relleno";

export type GloboOrganico = GloboColocado & {
  formatoId: string;
  infladoCm: number;
  codigo: string;
  nombreColor: string;
  hexGlobo: string;
  /** Centro del cuerpo (para medir y para choques). */
  centro: Vec3;
  tramo: string;
  /** 0 al inicio del recorrido de su tramo, 1 al final. */
  fraccion: number;
  tamano: TamanoOrganico;
  /** Los tríos de relleno comparten número; la estructura va suelta (`null`). */
  racimo: number | null;
  /** Cristal: el visor lo dibuja transparente. */
  transparente: boolean;
  /** Lleva confeti por dentro (el visor lo dibujará después). */
  confeti: boolean;
};

/** Un globo vecino de un hueco, para apoyar en él las flores (centro del cuerpo y radio, cm). */
export type ApoyoHueco = { centro: Vec3; radioCm: number };

/**
 * Un hueco reservado para una flor: compatible con `Ancla` de `decoraciones.ts` (posición + normal). `apoyos` son los
 * globos que rodean el hueco (a 30 cm o menos de su boca): las flores se meten hasta tocarlos, no quedan al aire.
 */
export type AnclaHueco = { indice: number; tramo: string; fraccion: number; posicion: Vec3; normal: Vec3; holguraCm: number; apoyos?: readonly ApoyoHueco[] };

export type MaterialOrganico = {
  formatoId: string;
  codigo: string;
  nombre: string;
  cantidad: number;
  transparente: boolean;
  confeti: boolean;
};

export type MedidaTramo = {
  id: string;
  nombre: string;
  largoCm: number;
  globos: number;
  globosPorMetro: number;
  globosPorPie: number;
  densidad: string;
  /** Globos de estructura por metro que pide la mezcla (antes del relleno). */
  estructuraPorMetro: number;
};

export type ResultadoOrganico = {
  globos: GloboOrganico[];
  anclas: AnclaHueco[];
  materiales: MaterialOrganico[];
  medidas: {
    altoCm: number;
    anchoCm: number;
    fondoCm: number;
    tramos: MedidaTramo[];
    /** El peor aplastamiento entre dos globos (fracción del diámetro del menor). */
    peorAplastamiento: number;
  };
  conteo: {
    total: number;
    porTamano: Record<TamanoOrganico, number>;
    porFormato: Record<string, number>;
    porColor: Record<string, number>;
  };
  avisos: string[];
};

// ----------------------------------------------------------------------------------------------------------
// Utilidades
// ----------------------------------------------------------------------------------------------------------

/** PRNG mulberry32: rápido, de 32 bits, el mismo en cualquier motor de JS. */
export function crearAzar(semilla: number): () => number {
  let a = semilla >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const suma = (a: Vec3, b: Vec3): Vec3 => vec(a.x + b.x, a.y + b.y, a.z + b.z);
const resta = (a: Vec3, b: Vec3): Vec3 => vec(a.x - b.x, a.y - b.y, a.z - b.z);
const escala = (a: Vec3, k: number): Vec3 => vec(a.x * k, a.y * k, a.z * k);
const punto = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cruz = (a: Vec3, b: Vec3): Vec3 => vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const norma = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const distancia = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const unitario = (a: Vec3, siNulo: Vec3 = vec(0, 1, 0)): Vec3 => {
  const n = norma(a);
  return n > 1e-9 ? escala(a, 1 / n) : siNulo;
};
const limitar = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));

/** Aplastamiento de dos cuerpos que se tocan, como fracción del diámetro del menor (negativo: no se tocan). */
export function aplastamiento(a: { centro: Vec3; infladoCm: number }, b: { centro: Vec3; infladoCm: number }): number {
  return (a.infladoCm / 2 + b.infladoCm / 2 - distancia(a.centro, b.centro)) / Math.min(a.infladoCm, b.infladoCm);
}

// ----------------------------------------------------------------------------------------------------------
// Recorrido: muestreo uniforme y marco que no gira (transporte paralelo)
// ----------------------------------------------------------------------------------------------------------

type Muestra = { s: number; p: Vec3; t: Vec3; n: Vec3; b: Vec3 };

function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 {
  const u2 = u * u, u3 = u2 * u;
  const c = (a: number, b: number, c2: number, d: number) => 0.5 * (2 * b + (-a + c2) * u + (2 * a - 5 * b + 4 * c2 - d) * u2 + (-a + 3 * b - 3 * c2 + d) * u3);
  return vec(c(p0.x, p1.x, p2.x, p3.x), c(p0.y, p1.y, p2.y, p3.y), c(p0.z, p1.z, p2.z, p3.z));
}

/** Largo (cm) del recorrido suavizado. */
export function largoRecorrido(control: readonly Vec3[]): number {
  const m = muestrear(control, 2);
  return m[m.length - 1]!.s;
}

function muestrear(control: readonly Vec3[], pasoCm: number): Muestra[] {
  if (control.length < 2) throw new Error("El recorrido orgánico necesita al menos dos puntos");
  const densa: Vec3[] = [control[0]!];
  for (let i = 0; i < control.length - 1; i++) {
    const p0 = control[Math.max(0, i - 1)]!, p1 = control[i]!, p2 = control[i + 1]!, p3 = control[Math.min(control.length - 1, i + 2)]!;
    for (let k = 1; k <= 16; k++) densa.push(catmullRom(p0, p1, p2, p3, k / 16));
  }
  const acumulado = [0];
  for (let i = 1; i < densa.length; i++) acumulado.push(acumulado[i - 1]! + distancia(densa[i]!, densa[i - 1]!));
  const total = acumulado[acumulado.length - 1]!;
  if (!(total > 0)) throw new Error("El recorrido orgánico no tiene largo");
  const n = Math.max(1, Math.ceil(total / pasoCm));
  const puntos: Array<{ s: number; p: Vec3 }> = [];
  let j = 1;
  for (let i = 0; i <= n; i++) {
    const s = (i * total) / n;
    while (j < densa.length - 1 && acumulado[j]! < s) j++;
    const a = densa[j - 1]!, b = densa[j]!;
    const tramo = acumulado[j]! - acumulado[j - 1]!;
    const f = tramo > 0 ? limitar((s - acumulado[j - 1]!) / tramo, 0, 1) : 0;
    puntos.push({ s, p: suma(a, escala(resta(b, a), f)) });
  }
  const muestras: Muestra[] = [];
  for (let i = 0; i < puntos.length; i++) {
    const antes = puntos[Math.max(0, i - 1)]!.p, despues = puntos[Math.min(puntos.length - 1, i + 1)]!.p;
    const t = unitario(resta(despues, antes));
    let nrm: Vec3;
    if (i === 0) {
      const ref = Math.abs(t.y) < 0.9 ? vec(0, 1, 0) : vec(1, 0, 0);
      nrm = unitario(resta(ref, escala(t, punto(ref, t))));
    } else {
      const previa = muestras[i - 1]!.n;
      nrm = unitario(resta(previa, escala(t, punto(previa, t))), previa);
    }
    muestras.push({ s: puntos[i]!.s, p: puntos[i]!.p, t, n: nrm, b: cruz(t, nrm) });
  }
  return muestras;
}

type Fases = readonly [number, number, number];

type TramoPreparado = {
  def: TramoOrganico;
  muestras: Muestra[];
  largo: number;
  paso: number;
  fases: Fases;
};

function muestraEn(tp: TramoPreparado, s: number): Muestra {
  if (s > tp.largo || s < 0) {
    const extremo = s > tp.largo ? tp.muestras[tp.muestras.length - 1]! : tp.muestras[0]!;
    const fuera = s > tp.largo ? s - tp.largo : s;
    return { ...extremo, s, p: suma(extremo.p, escala(extremo.t, fuera)) };
  }
  const f = s / tp.paso;
  const i = Math.min(tp.muestras.length - 2, Math.floor(f));
  const a = tp.muestras[i]!, b = tp.muestras[i + 1]!;
  const u = limitar(f - i, 0, 1);
  const cercana = u < 0.5 ? a : b;
  return { ...cercana, s: limitar(s, 0, tp.largo), p: suma(a.p, escala(resta(b.p, a.p), u)) };
}

/** Proyección de un punto sobre el eje del tramo: muestra más cercana, afinada sobre sus dos segmentos. */
function proyectar(tp: TramoPreparado, c: Vec3): Muestra {
  let mejor = 0, mejorD = Infinity;
  for (let i = 0; i < tp.muestras.length; i++) {
    const d = distancia(tp.muestras[i]!.p, c);
    if (d < mejorD) { mejorD = d; mejor = i; }
  }
  let s = tp.muestras[mejor]!.s;
  let menor = Infinity;
  for (const k of [mejor - 1, mejor]) {
    if (k < 0 || k + 1 >= tp.muestras.length) continue;
    const a = tp.muestras[k]!.p, b = tp.muestras[k + 1]!.p;
    const ab = resta(b, a);
    const f = limitar(punto(resta(c, a), ab) / (punto(ab, ab) || 1), 0, 1);
    const q = suma(a, escala(ab, f));
    const d = distancia(q, c);
    if (d < menor) { menor = d; s = tp.muestras[k]!.s + f * tp.paso; }
  }
  return muestraEn(tp, s);
}

function ruido(f: Fases, s: number, phi: number): number {
  return (Math.sin(s / 19 + 2 * phi + f[0]) + 0.7 * Math.sin(s / 9 - 3 * phi + f[1]) + 0.5 * Math.sin(s / 31 + phi + f[2])) / 2.2;
}

function interpolarGrosor(grosor: readonly PuntoGrosor[], t: number): number {
  const g = [...grosor].sort((a, b) => a.t - b.t);
  if (g.length === 0) return 20;
  if (t <= g[0]!.t) return g[0]!.radioCm;
  for (let i = 1; i < g.length; i++) {
    const a = g[i - 1]!, b = g[i]!;
    if (t <= b.t) return a.radioCm + (b.radioCm - a.radioCm) * ((t - a.t) / (b.t - a.t || 1));
  }
  return g[g.length - 1]!.radioCm;
}

/** Pesos normalizados de la mezcla en la fracción `t` (solo los positivos). */
export function mezclaEn(mezcla: readonly PuntoMezcla[], t: number): Map<string, number> {
  const m = [...mezcla].sort((a, b) => a.t - b.t);
  const crudo = new Map<string, number>();
  if (m.length === 0) return crudo;
  let a = m[0]!, b = m[0]!, u = 0;
  if (t >= m[m.length - 1]!.t) { a = b = m[m.length - 1]!; }
  else if (t > m[0]!.t) {
    for (let i = 1; i < m.length; i++) if (t <= m[i]!.t) { a = m[i - 1]!; b = m[i]!; u = (t - a.t) / (b.t - a.t || 1); break; }
  }
  for (const id of new Set([...Object.keys(a.pesos), ...Object.keys(b.pesos)])) {
    const w = (a.pesos[id] ?? 0) * (1 - u) + (b.pesos[id] ?? 0) * u;
    if (w > 0) crudo.set(id, w);
  }
  const total = [...crudo.values()].reduce((x, y) => x + y, 0);
  for (const [id, w] of crudo) crudo.set(id, w / total);
  return crudo;
}

function radioEnvoltura(tp: TramoPreparado, s: number, phi: number): number {
  const base = interpolarGrosor(tp.def.grosor, limitar(s / tp.largo, 0, 1));
  return base * (1 + limitar(tp.def.irregularidad, 0, 0.3) * ruido(tp.fases, s, phi));
}

/**
 * A qué distancia del eje va el centro de un globo de radio `r`: con su cara de fuera en la envoltura (`R − r`,
 * corrido por el hundimiento), pero nunca a menos de su propio radio (×1,05). El globo va amarrado por el nudo al
 * armazón del centro y el cuerpo sale hacia fuera, así que su centro no puede meterse en el eje: un globo más ancho
 * que la envoltura sobresale hacia su lado (los grandes de la base abomban la silueta) en vez de tapar toda la
 * sección y no dejar sitio a nadie a su altura.
 */
export function profundidad(radioEnvolturaCm: number, r: number, hundimiento: number): number {
  return Math.max(radioEnvolturaCm - r * hundimiento, r * 1.05);
}

/** Hasta dónde se reparte el tramo: de 0 al largo, más 0,85 radios en cada extremo con tapa. */
function rangoS(tp: TramoPreparado): { min: number; max: number } {
  return {
    min: tp.def.tapas?.inicio ? -0.85 * interpolarGrosor(tp.def.grosor, 0) : 0,
    max: tp.largo + (tp.def.tapas?.fin ? 0.85 * interpolarGrosor(tp.def.grosor, 1) : 0),
  };
}

/**
 * Punto de la envoltura en (`s`, `phi`) y su normal hacia fuera. Dentro del recorrido es un tubo; pasado un extremo
 * con tapa, una media esfera centrada en el extremo (`s` fuera del recorrido es cuánto se avanza sobre ella).
 */
function superficie(tp: TramoPreparado, s: number, phi: number): { punto: Vec3; normal: Vec3; radio: number; centro: Vec3 } {
  const m = muestraEn(tp, s);
  const radial = suma(escala(m.n, Math.cos(phi)), escala(m.b, Math.sin(phi)));
  const radio = radioEnvoltura(tp, s, phi);
  if (s > tp.largo || s < 0) {
    const centro = muestraEn(tp, limitar(s, 0, tp.largo)).p;
    const fuera = s > tp.largo ? s - tp.largo : s;
    const seno = limitar(fuera / Math.max(1, radio), -1, 1);
    const normal = unitario(suma(escala(m.t, seno), escala(radial, Math.sqrt(1 - seno * seno))));
    return { punto: suma(centro, escala(normal, radio)), normal, radio, centro };
  }
  return { punto: suma(m.p, escala(radial, radio)), normal: radial, radio, centro: m.p };
}

/**
 * Globos de estructura de diámetro `d` por centímetro de recorrido, si la envoltura tiene radio `R`. Cada globo
 * ocupa la huella de un tresbolillo, d²·0,866, sobre la
 * superficie a media profundidad del globo: el cuerpo va con su cara de fuera en la envoltura y su centro a
 * `R − d/2`, así que la superficie que de verdad reparte es la de radio `R − d/4` (y nunca menos de `d/4`, para
 * el globo más ancho que la envoltura, que va casi en el eje). Con una mezcla, cada formato consume su parte:
 * el total por centímetro es la media armónica ponderada por la proporción en número de cada formato.
 * `EMPAQUE` lo calibra: colocando de abajo arriba sin pasar del 12 % de aplastamiento se llena el 76 % del
 * tresbolillo ideal (medido: R-12 a 27 cm en una columna de 64 cm de ancho y 1,9 m → 36 globos, 19 por metro, lo
 * mismo que la trenza de cuartetos de Sempertex con R-12: 5 niveles × 4 = 20 por metro). Lo que no cabe se avisa y
 * lo cubre el relleno.
 */
const EMPAQUE = 0.76;
export function estructuraPorCm(d: number, radioCm: number): number {
  const radioMedio = Math.max(radioCm - d / 4, d / 4);
  return (EMPAQUE * 2 * Math.PI * radioMedio) / (d * d * 0.866);
}

// ----------------------------------------------------------------------------------------------------------
// El armado
// ----------------------------------------------------------------------------------------------------------

type Interno = {
  formatoId: string;
  d: number;
  r: number;
  c: Vec3;
  tramo: number;
  s: number;
  phi: number;
  /** <1 sobresale de la envoltura, >1 se hunde: lo irregular. */
  hundimiento: number;
  inclinacion: number;
  tamano: TamanoOrganico;
  racimo: number | null;
  /** Puesto desde fuera (`opciones.fijos`): no se mueve, no se quita y trae su color. */
  fijo?: boolean;
  codigoFijo?: string;
};

type Hueco = { tramo: number; s: number; c: Vec3; r: number; superficie: Vec3; normal: Vec3 };

const PASO_MUESTRA_CM = 2;

function etiquetaDensidad(porPie: number): string {
  if (porPie <= 10) return "Ligero (hasta 10 por pie)";
  if (porPie <= 17) return "Estándar (11–17 por pie)";
  return "Lleno (más de 17 por pie)";
}

const M_A_PIES = 3.28084;

/**
 * Lo que arma el empaque (pasos 1 a 5): dónde va cada globo, los huecos para flores y lo que se avisó. No depende de
 * los colores; `usosAzar` cuenta cuántas veces se tiró el azar para seguir la misma secuencia al repartir los colores.
 */
type GeometriaOrganica = {
  tramos: TramoPreparado[]; globos: Interno[]; huecos: Hueco[]; estructuraPorMetro: number[]; avisos: readonly string[]; usosAzar: number;
};

/**
 * El empaque ya hecho por opciones sin los colores: cambiar un color (la paleta, «Colores de la escena») solo
 * reparte de nuevo los colores (milisegundos) y no rehace el empaque (medio segundo o más por estructura).
 */
const GEOMETRIAS = new Map<string, GeometriaOrganica>();
const TOPE_GEOMETRIAS = 12;

/** Olvida los empaques guardados (para las pruebas: armar desde cero). */
export function olvidarEmpaquesOrganicos(): void {
  GEOMETRIAS.clear();
}

function geometriaOrganica(opciones: OpcionesOrganico): GeometriaOrganica {
  const clave = JSON.stringify({ ...opciones, colores: null });
  const guardada = GEOMETRIAS.get(clave);
  if (guardada) {
    // La más usada queda al final (la primera es la que se olvida).
    GEOMETRIAS.delete(clave);
    GEOMETRIAS.set(clave, guardada);
    return guardada;
  }
  const nueva = empacarOrganico(opciones);
  GEOMETRIAS.set(clave, nueva);
  while (GEOMETRIAS.size > TOPE_GEOMETRIAS) { const primera = GEOMETRIAS.keys().next().value; if (primera === undefined) break; GEOMETRIAS.delete(primera); }
  return nueva;
}

function empacarOrganico(opciones: OpcionesOrganico): GeometriaOrganica {
  const azarBase = crearAzar(opciones.semilla);
  let usosAzar = 0;
  const azar = () => { usosAzar++; return azarBase(); };
  const avisos: string[] = [];
  const obstaculos = opciones.obstaculos ?? [];
  const tramos: TramoPreparado[] = opciones.tramos.map((def) => {
    const muestras = muestrear(def.recorrido, PASO_MUESTRA_CM);
    const largo = muestras[muestras.length - 1]!.s;
    return { def, muestras, largo, paso: largo / (muestras.length - 1), fases: [azar() * 6.283, azar() * 6.283, azar() * 6.283] as const };
  });

  // Inflado nominal de cada formato pedido; solo redondos.
  const nominal = new Map<string, number>();
  const formatoValido = (id: string): boolean => {
    if (nominal.has(id)) return true;
    const f = formatoPorId(id);
    if (!f || f.tipo !== "redondo") { avisos.push(`El formato ${id} no es un redondo modelado: se quita de la mezcla.`); return false; }
    nominal.set(id, infladoValido(f, opciones.inflados?.[id] ?? f.infladoDecoracionCm));
    return true;
  };
  const inflar = (id: string, base?: number): number => {
    const f = formatoPorId(id)!;
    const n = base ?? nominal.get(id)!;
    return infladoValido(f, n * (1 + opciones.variacionInflado * (2 * azar() - 1)));
  };

  const globos: Interno[] = [];
  const huecos: Hueco[] = [];
  const LIM = APLASTAMIENTO_MAXIMO;

  const restringir = (c: Vec3, r: number): Vec3 => {
    let { x, y, z } = c;
    if (opciones.suelo && y < r * 0.94) y = r * 0.94;
    for (const o of obstaculos) {
      if (y + r <= o.base.y || y - r * 0.97 >= o.base.y + o.altoCm) continue;
      const dx = x - o.base.x, dz = z - o.base.z;
      const h = Math.hypot(dx, dz);
      const minimo = o.radioCm + r * 0.97;
      if (h >= minimo) continue;
      const ux = h > 1e-6 ? dx / h : 1, uz = h > 1e-6 ? dz / h : 0;
      x = o.base.x + ux * minimo;
      z = o.base.z + uz * minimo;
    }
    return vec(x, y, z);
  };

  /**
   * Peor aplastamiento contra lo ya colocado (infinito si pisa un hueco reservado) y la holgura mínima (hasta 30 cm:
   * lo que está más lejos no cuenta). Sale en cuanto encuentra un choque: solo importa si cabe.
   */
  const HOLGURA_MAXIMA = 30;
  const evaluar = (c: Vec3, d: number): { peor: number; holgura: number } => {
    let peor = -Infinity, holgura = HOLGURA_MAXIMA;
    const r = d / 2;
    for (const g of globos) {
      const alcance = r + g.r + HOLGURA_MAXIMA;
      const dx = c.x - g.c.x, dy = c.y - g.c.y, dz = c.z - g.c.z;
      if (dx > alcance || dx < -alcance || dy > alcance || dy < -alcance || dz > alcance || dz < -alcance) continue;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const pen = (r + g.r - dist) / Math.min(d, g.d);
      if (pen > LIM) return { peor: pen, holgura: dist - r - g.r };
      if (pen > peor) peor = pen;
      const h = dist - r - g.r;
      if (h < holgura) holgura = h;
    }
    for (const hueco of huecos) if (distancia(c, hueco.c) < r + hueco.r) return { peor: Infinity, holgura };
    return { peor, holgura };
  };

  const enEnvoltura = (tp: TramoPreparado, s: number, phi: number, r: number, hundimiento: number): Vec3 => {
    const sup = superficie(tp, s, phi);
    return restringir(suma(sup.centro, escala(sup.normal, profundidad(sup.radio, r, hundimiento))), r);
  };

  /** Cuántos globos ya colocados toca un cuerpo en `c` (superficies a 1 cm o menos, contando el aplastamiento). */
  const contactos = (c: Vec3, r: number): number => {
    let n = 0;
    for (const g of globos) {
      const alcance = r + g.r + 1;
      const dx = c.x - g.c.x, dy = c.y - g.c.y, dz = c.z - g.c.z;
      if (dx > alcance || dx < -alcance || dy > alcance || dy < -alcance || dz > alcance || dz < -alcance) continue;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= alcance) n++;
    }
    return n;
  };

  /** Separa los que se montan más de `factor` × 12 % (el más liviano se mueve más) y respeta huecos, piso y pedestal. */
  const separar = (factor: number): number => {
    let peor = 0;
    for (let i = 0; i < globos.length; i++) {
      const a = globos[i]!;
      for (let j = i + 1; j < globos.length; j++) {
        const b = globos[j]!;
        const alcance = a.r + b.r;
        const dx = b.c.x - a.c.x, dy = b.c.y - a.c.y, dz = b.c.z - a.c.z;
        if (dx > alcance || dx < -alcance || dy > alcance || dy < -alcance || dz > alcance || dz < -alcance) continue;
        const delta = vec(dx, dy, dz);
        const dist = norma(delta);
        const menor = Math.min(a.d, b.d);
        const exceso = a.r + b.r - dist - LIM * factor * menor;
        if (exceso <= 0) continue;
        peor = Math.max(peor, (a.r + b.r - dist) / menor);
        const u = unitario(delta, vec(1, 0, 0));
        const ma = a.fijo ? 1e12 : a.d ** 3, mb = b.fijo ? 1e12 : b.d ** 3;
        a.c = suma(a.c, escala(u, (-exceso * mb) / (ma + mb)));
        b.c = suma(b.c, escala(u, (exceso * ma) / (ma + mb)));
      }
    }
    for (const g of globos) {
      if (g.fijo) continue;
      for (const h of huecos) {
        const delta = resta(g.c, h.c);
        const dist = norma(delta);
        if (dist < g.r + h.r) g.c = suma(h.c, escala(unitario(delta, h.normal), g.r + h.r));
      }
      g.c = restringir(g.c, g.r);
    }
    return peor;
  };

  /**
   * Lleva cada globo una fracción `factor` del camino hacia su sitio en la envoltura (la cara de fuera en la envoltura,
   * corrida por su hundimiento); en el remate, hacia el radio de la media esfera.
   */
  const atraerEnvoltura = (factor: number) => {
    for (const g of globos) {
      if (g.fijo) continue;
      const tp = tramos[g.tramo]!;
      const m = proyectar(tp, g.c);
      g.s = m.s;
      const rel = resta(g.c, m.p);
      const axial = punto(rel, m.t);
      const radial = resta(rel, escala(m.t, axial));
      const rho = norma(radial);
      const dir = rho > 1e-6 ? escala(radial, 1 / rho) : suma(escala(m.n, Math.cos(g.phi)), escala(m.b, Math.sin(g.phi)));
      g.phi = Math.atan2(punto(dir, m.b), punto(dir, m.n));
      const objetivo = profundidad(radioEnvoltura(tp, m.s, g.phi), g.r, g.hundimiento);
      const enTapa = (m.s >= tp.largo - 1e-6 && axial > 0 && tp.def.tapas?.fin) || (m.s <= 1e-6 && axial < 0 && tp.def.tapas?.inicio);
      if (enTapa) {
        // Sobre la media esfera del remate: se atrae a su radio desde el extremo.
        const dist = norma(rel);
        g.c = suma(m.p, escala(unitario(rel, m.t), dist + (objetivo - dist) * factor));
        g.s = m.s + axial;
        continue;
      }
      g.c = suma(suma(m.p, escala(m.t, axial)), escala(dir, rho + (objetivo - rho) * factor));
    }
  };

  /**
   * Apretar, como cuando se amarran las tiras al armazón y se empujan unas contra otras: cada par de globos cuyas
   * caras quedan a menos de `ALCANCE_APRIETE` se atrae hasta tocarse con un 4 % de aplastamiento, mientras la
   * envoltura los sujeta a su sitio. Así no quedan rendijas de unos centímetros entre todos los globos: los huecos
   * se juntan en bolsillos más grandes, donde caben el relleno y las flores.
   */
  const ALCANCE_APRIETE = 7;
  const apretar = (pasadas: number) => {
    for (let pasada = 0; pasada < pasadas; pasada++) {
      for (let i = 0; i < globos.length; i++) {
        const a = globos[i]!;
        for (let j = i + 1; j < globos.length; j++) {
          const b = globos[j]!;
          const alcance = a.r + b.r + ALCANCE_APRIETE;
          const dx = b.c.x - a.c.x, dy = b.c.y - a.c.y, dz = b.c.z - a.c.z;
          if (dx > alcance || dx < -alcance || dy > alcance || dy < -alcance || dz > alcance || dz < -alcance) continue;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist >= alcance || dist < 1e-9) continue;
          const falta = dist - a.r - b.r + 0.04 * Math.min(a.d, b.d);
          if (falta <= 0) continue;
          const u = vec(dx / dist, dy / dist, dz / dist);
          const ma = a.fijo ? 1e12 : a.d ** 3, mb = b.fijo ? 1e12 : b.d ** 3;
          const k = 0.3 * falta;
          a.c = suma(a.c, escala(u, (k * mb) / (ma + mb)));
          b.c = suma(b.c, escala(u, (-k * ma) / (ma + mb)));
        }
      }
      atraerEnvoltura(0.25);
      separar(0.85);
    }
  };

  /** ¿La semirrecta desde `o` hacia `u` (unitario) pasa sin tocar ningún globo? */
  const rayoLibre = (o: Vec3, u: Vec3): boolean => {
    for (const g of globos) {
      const ox = g.c.x - o.x, oy = g.c.y - o.y, oz = g.c.z - o.z;
      const t = ox * u.x + oy * u.y + oz * u.z;
      const d2 = ox * ox + oy * oy + oz * oz - t * t;
      if (d2 <= g.r * g.r && t + Math.sqrt(g.r * g.r - d2) > 0) return false;
    }
    return true;
  };

  /** ¿La semirrecta choca con un pedestal antes de `alcance` cm? (Esa vista la tapa el pedestal: no cuenta.) */
  const chocaObstaculo = (o: Vec3, u: Vec3, alcance: number): boolean => obstaculos.some((ob) => {
    const h = Math.hypot(u.x, u.z);
    if (h < 1e-6) return false;
    const ux = u.x / h, uz = u.z / h, ox = o.x - ob.base.x, oz = o.z - ob.base.z;
    const t = -(ox * ux + oz * uz);
    const d2 = ox * ox + oz * oz - t * t;
    if (t <= 0 || d2 >= ob.radioCm * ob.radioCm) return false;
    const entrada = (t - Math.sqrt(ob.radioCm * ob.radioCm - d2)) / h;
    const y = o.y + u.y * entrada;
    return entrada < alcance && y >= ob.base.y && y <= ob.base.y + ob.altoCm;
  });

  /**
   * En cuántos apoyos que no son globos descansa el cuerpo en `c` (a 1 cm o menos): el piso, un pedestal y el armazón
   * del eje (el tubo al que se amarran las tiras, `RADIO_ARMAZON_CM`). Cada uno cuenta como un vecino más.
   */
  const apoyado = (c: Vec3, r: number, tramo?: number): number => {
    let n = opciones.suelo && c.y - r <= 1 ? 1 : 0;
    if (tramo !== undefined) {
      const tp = tramos[tramo]!;
      const m = proyectar(tp, c);
      const rel = resta(c, m.p);
      if (m.s > 0 && m.s < tp.largo && norma(resta(rel, escala(m.t, punto(rel, m.t)))) - r - RADIO_ARMAZON_CM <= 1) n++;
    }
    for (const o of obstaculos) {
      if (c.y - r > o.base.y + o.altoCm || c.y + r < o.base.y) continue;
      if (Math.hypot(c.x - o.base.x, c.z - o.base.z) - o.radioCm - r <= 1) n++;
    }
    return n;
  };

  /**
   * Asentar los sueltos: el globo que toca a menos de tres vecinos (contando el piso y el pedestal) se arrima a sus
   * tres más próximos hasta tocarlos con un 3 % de aplastamiento, sin pasar del 12 % con nadie, sin moverse más de
   * un radio y sin destapar ningún rayo que solo él tapaba. Si no lo logra, se queda donde estaba.
   */
  const asentarSueltos = (rayos: readonly Rayo[]) => {
    for (let i = 0; i < globos.length; i++) {
      const g = globos[i]!;
      if (g.fijo) continue;
      globos.splice(i, 1);
      if (contactos(g.c, g.r) + apoyado(g.c, g.r, g.tramo) < 3) {
        let c = g.c;
        for (let paso = 0; paso < 30; paso++) {
          const cercanos = globos
            .map((h) => ({ h, hueco: distancia(c, h.c) - g.r - h.r }))
            .sort((a, b) => a.hueco - b.hueco)
            .slice(0, 3);
          for (const { h, hueco } of cercanos) {
            const meta = -0.03 * Math.min(g.d, h.d);
            if (hueco > meta) c = suma(c, escala(unitario(resta(h.c, c)), (hueco - meta) * 0.4));
          }
          for (const h of globos) {
            const delta = resta(c, h.c);
            const dist = norma(delta);
            const exceso = g.r + h.r - dist - 0.9 * LIM * Math.min(g.d, h.d);
            if (exceso > 0) c = suma(c, escala(unitario(delta, vec(1, 0, 0)), exceso));
          }
          c = restringir(c, g.r);
        }
        if (distancia(c, g.c) <= g.r && evaluar(c, g.d).peor <= LIM && contactos(c, g.r) + apoyado(c, g.r, g.tramo) >= 3) {
          const movido = { c, r: g.r };
          if (rayos.every((rayo) => !cortaRayo(g, rayo) || cortaRayo(movido, rayo) || globos.some((h) => cortaRayo(h, rayo)))) g.c = c;
        }
      }
      globos.splice(i, 0, g);
    }
  };

  /**
   * Acompañar a los sueltos: al globo que aún toca a menos de tres, se le pone al lado otro relleno chico (el trío de
   * R-5 de la técnica) que lo toque a él y a otro más, por dentro de la envoltura y sin pasar del 12 %. Se prueban 96
   * direcciones alrededor del suelto y se queda la que más globos toca.
   */
  const acompanarSueltos = (tamanos: ReadonlyArray<{ formatoId: string; base: number }>) => {
    const N = 96;
    const total = globos.length;
    for (let i = 0; i < total; i++) {
      const g = globos[i]!;
      if (contactos(g.c, g.r) - 1 + apoyado(g.c, g.r, g.tramo) >= 3) continue;
      const tp = tramos[g.tramo]!;
      let mejor: Interno | null = null, mejorN = 0;
      for (const tam of [...tamanos].reverse()) {
        const d = tam.base, r = d / 2;
        // Hacia cada vecino cercano que no toca (el hueco entre los dos) y, además, direcciones repartidas en espiral
        // (Fibonacci) sobre la esfera.
        const direcciones = globos
          .filter((h) => h !== g && distancia(h.c, g.c) - h.r - g.r > 1 && distancia(h.c, g.c) - h.r - g.r < 2 * r)
          .map((h) => unitario(resta(h.c, g.c)));
        for (let k = 0; k < N; k++) {
          const y = 1 - (2 * (k + 0.5)) / N, rho = Math.sqrt(1 - y * y), a = k * 2.399963;
          direcciones.push(vec(rho * Math.cos(a), y, rho * Math.sin(a)));
        }
        for (const u of direcciones) {
          const c = restringir(suma(g.c, escala(u, g.r + r - 0.04 * Math.min(g.d, d))), r);
          const m = proyectar(tp, c);
          const rel = resta(c, m.p);
          const radial = norma(resta(rel, escala(m.t, punto(rel, m.t))));
          const phi = Math.atan2(punto(rel, m.b), punto(rel, m.n));
          if (radial + r * 0.8 > radioEnvoltura(tp, m.s, phi) || radial < r * 1.05) continue;
          if (evaluar(c, d).peor > LIM) continue;
          const n = contactos(c, r) + apoyado(c, r, g.tramo);
          if (n >= 3 && n > mejorN) {
            mejorN = n;
            mejor = { formatoId: tam.formatoId, d, r, c, tramo: g.tramo, s: m.s, phi, hundimiento: (radioEnvoltura(tp, m.s, phi) - radial) / r, inclinacion: (azar() - 0.5) * 0.4, tamano: "relleno", racimo: g.racimo };
          }
        }
        if (mejor) break;
      }
      if (mejor) globos.push(mejor);
    }
  };

  /**
   * Arrima un relleno en `c` al globo más próximo que aún no toca (a 5 cm o menos), hasta tocarlo, si así no se
   * aplasta más de la cuenta, sigue cumpliendo `valido` y toca al menos a tres. `null` si no hay cómo.
   */
  const arrimar = (c: Vec3, d: number, tramo: number, valido: (c: Vec3, r: number) => boolean): Vec3 | null => {
    const r = d / 2;
    const cercanos = globos
      .map((g) => ({ g, hueco: distancia(c, g.c) - r - g.r }))
      .filter((x) => x.hueco > 1 && x.hueco <= 5)
      .sort((a, b) => a.hueco - b.hueco);
    for (const { g, hueco } of cercanos) {
      const c2 = restringir(suma(c, escala(unitario(resta(g.c, c)), hueco - 0.3)), r);
      if (valido(c2, r) && evaluar(c2, d).peor <= LIM && contactos(c2, r) + apoyado(c2, r, tramo) >= 3) return c2;
    }
    return null;
  };

  /**
   * Tapar fugas: el último paso del relleno de la técnica Sempertex («hasta que quede tupido»). Se lanzan rayos desde
   * el eje de cada tramo hacia fuera (cada 3 cm del recorrido × 40 ángulos, y por el remate) y, por cada uno que
   * sale sin tocar un globo (por ahí se ve a través), se mete un relleno en ese hueco: el mayor que quepa sin pasar del
   * 12 % de aplastamiento, tan cerca de la envoltura como se pueda y donde más globos toque (nunca suelto: al menos
   * dos vecinos). No se mira lo que queda a ras de piso ni lo que tapa el pedestal.
   */
  /** Los rellenos de mayor a menor y, al final, el más chico también a medio inflar (un R-5 a 9–10 cm), para las rendijas. */
  const tamanosRelleno = (): Array<{ formatoId: string; base: number }> => {
    const tamanos: Array<{ formatoId: string; base: number }> = [];
    for (const rel of opciones.relleno) {
      // Los rellenos en racimitos (los R-5 con tope) no tapan fugas sueltos: irían como puntos regados y pasarían su tope.
      if (!formatoValido(rel.formatoId) || rel.racimo !== undefined || rel.maximo !== undefined) continue;
      tamanos.push({ formatoId: rel.formatoId, base: infladoValido(formatoPorId(rel.formatoId)!, rel.infladoCm) });
    }
    tamanos.sort((a, b) => b.base - a.base);
    const menor = tamanos[tamanos.length - 1];
    if (menor) tamanos.push({ formatoId: menor.formatoId, base: infladoValido(formatoPorId(menor.formatoId)!, menor.base * 0.8) });
    return tamanos;
  };

  /** Un rayo de la prueba de «se ve a través»: sale del eje (`o`) hacia fuera (`u`), hasta la envoltura (`radio`). */
  type Rayo = { tramo: number; s: number; phi: number; o: Vec3; u: Vec3; radio: number };
  /**
   * Los rayos desde el eje de cada tramo hacia fuera: cada 3 cm del recorrido × 40 ángulos, y por el remate. No se
   * miran los que van a ras de piso o hacia él, ni los que tapa el pedestal (por ahí no se ve nada).
   */
  const rayosDeFuga = (): Rayo[] => {
    const rayos: Rayo[] = [];
    tramos.forEach((tp, it) => {
      const rango = rangoS(tp);
      const inicio = tp.muestras[0]!;
      // Sin remate abajo y casi vertical sobre el piso: los rayos bajan por el eje alargado hasta 10 cm del piso.
      const bajo = !tp.def.tapas?.inicio && opciones.suelo && inicio.t.y > 0.7 ? Math.max(0, (inicio.p.y - 10) / inicio.t.y) : 0;
      let fila = 0;
      for (let s = rango.min - bajo + 1.5; s < rango.max; s += 3, fila++) {
        for (let k = 0; k < 40; k++) {
          const phi = ((k + (fila % 2) * 0.5) / 40) * Math.PI * 2;
          let o: Vec3, u: Vec3, radio: number;
          if (s < 0 && !tp.def.tapas?.inicio) {
            const m = muestraEn(tp, s);
            o = m.p;
            u = suma(escala(m.n, Math.cos(phi)), escala(m.b, Math.sin(phi)));
            radio = radioEnvoltura(tp, 0, phi);
          } else {
            const sup = superficie(tp, s, phi);
            o = sup.centro; u = sup.normal; radio = sup.radio;
          }
          if (opciones.suelo && (o.y < 10 || u.y < -0.2)) continue;
          if (chocaObstaculo(o, u, radio + 15)) continue;
          rayos.push({ tramo: it, s, phi, o, u, radio });
        }
      }
    });
    return rayos;
  };

  /** ¿El cuerpo `g` corta el rayo? */
  const cortaRayo = (g: { c: Vec3; r: number }, rayo: Rayo): boolean => {
    const ox = g.c.x - rayo.o.x, oy = g.c.y - rayo.o.y, oz = g.c.z - rayo.o.z;
    const t = ox * rayo.u.x + oy * rayo.u.y + oz * rayo.u.z;
    const d2 = ox * ox + oy * oy + oz * oz - t * t;
    return d2 <= g.r * g.r && t + Math.sqrt(g.r * g.r - d2) > 0;
  };

  /**
   * Tapar fugas: el último paso del relleno de la técnica Sempertex («hasta que quede tupido»). Por cada rayo que sale
   * sin tocar un globo (por ahí se ve a través) se mete un relleno en ese hueco: el mayor que quepa sin pasar del 12 %
   * de aplastamiento, tan cerca de la envoltura como se pueda y donde más globos toque (nunca suelto: al menos
   * `minimo` vecinos contando el piso y el pedestal; si toca dos, se intenta arrimar a un tercero).
   */
  const taparFugas = (rayos: readonly Rayo[], minimo: number) => {
    const tamanos = tamanosRelleno();
    if (tamanos.length === 0) return;
    for (const rayo of rayos) {
      if (!rayoLibre(rayo.o, rayo.u)) continue;
      const nuevo = rellenoParaRayo(rayo, minimo, tamanos);
      if (nuevo) globos.push(nuevo);
    }
  };

  /**
   * A qué distancia del eje se prueba cada relleno: de la envoltura (la cara de fuera a ras) hacia dentro, cada medio
   * radio, hasta pegado al armazón (`r × 1,05`). Por dentro de la capa de fuera es donde un relleno tapa los
   * triángulos que dejan tres globos que se tocan, que ningún relleno cabe a tapar desde fuera.
   */
  const hondurasFuga = (radio: number, r: number): number[] => {
    const lista: number[] = [];
    for (let h = radio - r * 0.95; h > r * 1.05; h -= r * 0.5) lista.push(h);
    lista.push(r * 1.05);
    return lista;
  };

  /** El mejor relleno que tapa el rayo (ver `taparFugas`), o `null` si no cabe ninguno. No lo coloca. */
  const rellenoParaRayo = (rayo: Rayo, minimo: number, tamanos: ReadonlyArray<{ formatoId: string; base: number }>): Interno | null => {
    const { tramo: it, s, phi, o, u, radio } = rayo;
    // Tiene que tapar el rayo: el centro a menos de 0,9 radios de la recta, por delante del eje.
    const tapa = (c: Vec3, r: number): boolean => {
      const oc = resta(c, o), t = punto(oc, u);
      return t > 0 && punto(oc, oc) - t * t <= (0.9 * r) ** 2;
    };
    const e1 = unitario(cruz(u, Math.abs(u.y) < 0.9 ? vec(0, 1, 0) : vec(1, 0, 0)));
    const e2 = cruz(u, e1);
    let mejor: Interno | null = null, mejorPuntaje = -Infinity;
    const variacion = 1 + opciones.variacionInflado * (2 * azar() - 1);
    for (const tam of tamanos) {
      const d = infladoValido(formatoPorId(tam.formatoId)!, tam.base * variacion), r = d / 2;
      for (const hondo of hondurasFuga(radio, r)) {
        const hundimiento = (radio - hondo) / r;
        for (const [a, b] of [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]] as const) {
          let c = restringir(suma(suma(o, escala(u, hondo)), suma(escala(e1, a * r), escala(e2, b * r))), r);
          if (!tapa(c, r) || evaluar(c, d).peor > LIM) continue;
          let n = contactos(c, r) + apoyado(c, r, it);
          if (n < 2) continue;
          if (n < 3) {
            // Tocando solo dos: se arrima al vecino más próximo que aún no toca, si cabe y sigue tapando.
            const arrimado = arrimar(c, d, it, tapa);
            if (arrimado) { c = arrimado; n = 3; }
          }
          if (n < minimo) continue;
          const puntaje = n * 4 - hundimiento * 1.5 + d * 0.15;
          if (puntaje > mejorPuntaje) {
            mejorPuntaje = puntaje;
            mejor = { formatoId: tam.formatoId, d, r, c, tramo: it, s, phi, hundimiento, inclinacion: 0, tamano: "relleno", racimo: null };
          }
        }
      }
    }
    return mejor ? { ...mejor, inclinacion: (azar() - 0.5) * 0.4 } : null;
  };

  /**
   * Cambiar los sueltos que hacen falta: el globo que toca a menos de tres pero es el único que tapa algún rayo se
   * prueba a cambiar por rellenos que tapen esos rayos y sí queden apretados (tocando a tres). Si no se puede, se queda.
   */
  const cambiarSueltos = (rayos: readonly Rayo[]) => {
    const tamanos = tamanosRelleno();
    for (let i = globos.length - 1; i >= 0; i--) {
      const g = globos[i]!;
      if (g.fijo || i >= globos.length || contactos(g.c, g.r) - 1 + apoyado(g.c, g.r, g.tramo) >= 3) continue;
      const propios = rayos.filter((rayo) => cortaRayo(g, rayo) && !globos.some((h) => h !== g && cortaRayo(h, rayo)));
      if (propios.length === 0) continue;
      globos.splice(i, 1);
      const puestos: Interno[] = [];
      let todos = true;
      for (const rayo of propios) {
        if (!rayoLibre(rayo.o, rayo.u)) continue;
        const nuevo = rellenoParaRayo(rayo, 3, tamanos);
        if (!nuevo) { todos = false; break; }
        globos.push(nuevo);
        puestos.push(nuevo);
      }
      if (!todos) {
        globos.splice(globos.length - puestos.length, puestos.length);
        globos.splice(i, 0, g);
      }
    }
  };

  /**
   * Quitar los sueltos que sobran: un relleno que al final toca a menos de tres y cuyos rayos tapa también otro globo
   * no hace falta (en la columna de verdad no se amarra un globo que no queda apretado).
   */
  const quitarSueltosQueSobran = (rayos: readonly Rayo[]) => {
    for (let i = globos.length - 1; i >= 0; i--) {
      const g = globos[i]!;
      if (g.tamano !== "relleno" || contactos(g.c, g.r) - 1 + apoyado(g.c, g.r, g.tramo) >= 3) continue;
      const necesario = rayos.some((rayo) => cortaRayo(g, rayo) && !globos.some((h) => h !== g && cortaRayo(h, rayo)));
      if (!necesario) globos.splice(i, 1);
    }
  };

  // 1. Cuántos globos de estructura de cada formato pide cada tramo, y en qué fracción del recorrido.
  type Objetivo = { formatoId: string; tramo: number; s: number };
  const objetivos = new Map<string, Objetivo[]>();
  const estructuraPorMetro: number[] = [];
  const densidad = opciones.densidad ?? 1;
  // Todos los formatos de la mezcla antes de recorrer: el acumulado de cada uno empieza en s = 0. (Registrarlos al
  // aparecer corría hacia el principio los que la mezcla pide solo más adelante: R-24 en la punta fina de un trazo.)
  for (const tp of tramos) for (const p of tp.def.mezcla) for (const [id, w] of Object.entries(p.pesos)) if (w > 0) formatoValido(id);
  tramos.forEach((tp, it) => {
    const ds = 1;
    const acumulados = new Map<string, number[]>();
    let totalTramo = 0;
    for (let s = 0; s < tp.largo; s += ds) {
      const t = (s + ds / 2) / tp.largo;
      const pesos = [...mezclaEn(tp.def.mezcla, t)].filter(([id]) => formatoValido(id));
      const R = interpolarGrosor(tp.def.grosor, t);
      const consumo = pesos.reduce((acc, [id, w]) => acc + w / estructuraPorCm(nominal.get(id)!, R), 0);
      const n = consumo > 0 ? (densidad * (tp.def.densidad ?? 1)) / consumo : 0;
      totalTramo += n * ds;
      for (const [id] of nominal) {
        const w = pesos.find(([x]) => x === id)?.[1] ?? 0;
        const lista = acumulados.get(id) ?? [];
        lista.push((lista[lista.length - 1] ?? 0) + n * w * ds);
        acumulados.set(id, lista);
      }
    }
    estructuraPorMetro.push(totalTramo / (tp.largo / 100));
    for (const [id, acumulado] of acumulados) {
      const total = acumulado[acumulado.length - 1] ?? 0;
      const cantidad = Math.round(total);
      for (let i = 0; i < cantidad; i++) {
        const meta = ((i + azar()) / cantidad) * total;
        let k = 0;
        while (k < acumulado.length - 1 && acumulado[k]! < meta) k++;
        const lista = objetivos.get(id) ?? [];
        lista.push({ formatoId: id, tramo: it, s: Math.min(tp.largo, (k + azar()) * ds) });
        objetivos.set(id, lista);
      }
    }
  });

  // 2. Estructura: primero los grandes, luego los medianos. Cada globo barre una rejilla de posiciones (cada 2,5 cm
  // del recorrido × 32 ángulos) alrededor de donde lo pide la mezcla. Los grandes se quedan con la más cercana a su
  // sitio (son las anclas, repartidas); los medianos se colocan de abajo arriba y cada uno baja hasta el primer sitio
  // libre, como cuando se arma la columna desde la base: así quedan apretados contra los de abajo y no salen los
  // huecos del reparto al azar (que llena poco más de la mitad).
  // Los fijos van primero, donde los pide la foto; cada uno descuenta el objetivo de su formato más cercano.
  for (const f of opciones.fijos ?? []) {
    if (!formatoValido(f.formatoId)) continue;
    let mejor = { it: 0, m: proyectar(tramos[0]!, vec(f.x, f.y, 0)), d: Infinity };
    tramos.forEach((tp, it) => { const m = proyectar(tp, vec(f.x, f.y, 0)); const d = distancia(m.p, vec(f.x, f.y, 0)); if (d < mejor.d) mejor = { it, m, d }; });
    const tp = tramos[mejor.it]!;
    const R = interpolarGrosor(tp.def.grosor, Math.min(1, Math.max(0, mejor.m.s / tp.largo)));
    const d = f.infladoCm ? infladoValido(formatoPorId(f.formatoId)!, f.infladoCm) : inflar(f.formatoId);
    // Por delante del eje (z > 0, hacia quien mira), lo que deja su radio dentro del cuerpo.
    const z = Math.max(0, Math.sqrt(Math.max(0, R * R - mejor.d * mejor.d)) - d * 0.35);
    globos.push({ formatoId: f.formatoId, d, r: d / 2, c: vec(f.x, f.y, z), tramo: mejor.it, s: mejor.m.s, phi: Math.PI / 2, hundimiento: 1, inclinacion: 0, tamano: nominal.get(f.formatoId)! >= INFLADO_GRANDE_CM ? "grande" : "mediano", racimo: null, fijo: true, codigoFijo: f.codigo });
    const lista = objetivos.get(f.formatoId);
    if (lista?.length) {
      const k = lista.reduce((m, o, i) => (o.tramo === mejor.it && Math.abs(o.s - mejor.m.s) < Math.abs((lista[m]!.tramo === mejor.it ? lista[m]!.s : Infinity) - mejor.m.s) ? i : m), 0);
      lista.splice(k, 1);
    }
  }
  const ordenEstructura = [...objetivos.keys()].sort((a, b) => nominal.get(b)! - nominal.get(a)!);
  let sinCupo = 0;
  for (const id of ordenEstructura) {
    const lista = objetivos.get(id)!.sort((a, b) => a.tramo - b.tramo || a.s - b.s);
    const grande = nominal.get(id)! >= INFLADO_GRANDE_CM;
    for (const obj of lista) {
      const tp = tramos[obj.tramo]!;
      const d = inflar(id);
      const r = d / 2;
      const hundimiento = 0.9 + azar() * 0.2;
      const inclinacion = (azar() - 0.5) * 0.4;
      const giro = azar() * Math.PI * 2;
      const desfase = azar() * 2.5;
      const rango = rangoS(tp);
      const desde = Math.max(rango.min, obj.s - 1.2 * d), hasta = Math.min(rango.max, obj.s + 1.2 * d);
      let mejor: Interno | null = null, mejorPuntaje = Infinity;
      // Si a ras de la envoltura ya no cabe (la guirnalda fina, medio apoyada en el piso), se mete un poco más adentro,
      // como la segunda capa de una tira.
      for (const hondura of [hundimiento, 1.5, 2]) {
        for (let s = desde + desfase; s <= hasta; s += 2.5) {
          const lejania = grande ? Math.abs(s - obj.s) : s - desde;
          if (lejania > mejorPuntaje) continue;
          for (let k = 0; k < 32; k++) {
            const phi = giro + (k / 32) * Math.PI * 2;
            const c = enEnvoltura(tp, s, phi, r, hondura);
            const { peor, holgura } = evaluar(c, d);
            if (peor > LIM) continue;
            // A igual altura, el más pegado a sus vecinos.
            const puntaje = lejania + Math.min(Math.abs(holgura), 10) * 0.1;
            if (puntaje < mejorPuntaje) {
              mejorPuntaje = puntaje;
              mejor = { formatoId: id, d, r, c, tramo: obj.tramo, s, phi, hundimiento: hondura, inclinacion, tamano: grande ? "grande" : "mediano", racimo: null };
            }
          }
        }
        if (mejor) break;
      }
      if (mejor) globos.push(mejor);
      else sinCupo++;
    }
  }
  if (sinCupo > 0) avisos.push(`${sinCupo} globos de estructura no cupieron sin montarse: sus huecos los tapa el relleno.`);
  apretar(14);

  // Rejilla de puntos sobre la envoltura de todos los tramos (para huecos de flores y relleno).
  type PuntoRejilla = { tramo: number; s: number; phi: number };
  const rejilla: PuntoRejilla[] = [];
  tramos.forEach((tp, it) => {
    let fila = 0;
    const rango = rangoS(tp);
    for (let s = rango.min + 2; s < rango.max; s += 4, fila++) {
      const R = interpolarGrosor(tp.def.grosor, limitar(s / tp.largo, 0, 1));
      const fuera = s > tp.largo ? s - tp.largo : s < 0 ? -s : 0;
      const n = Math.max(4, Math.round((2 * Math.PI * Math.sqrt(Math.max(0, R * R - fuera * fuera))) / 5));
      for (let j = 0; j < n; j++) rejilla.push({ tramo: it, s, phi: ((j + (fila % 2) * 0.5) / n) * Math.PI * 2 });
    }
  });

  // 3. Huecos para flores: los más hondos de la cara que se ve, separados entre sí.
  if (opciones.huecosFlores > 0) {
    const vista = opciones.vista ? unitario(opciones.vista) : null;
    const candidatos: Array<{ p: PuntoRejilla; superficie: Vec3; normal: Vec3; holgura: number }> = [];
    for (const p of rejilla) {
      const sup = superficie(tramos[p.tramo]!, p.s, p.phi);
      const normal = sup.normal;
      // Solo de cara a quien mira (no en el borde de la silueta, donde la flor se vería suelta de perfil).
      if (vista && punto(normal, vista) < 0.35) continue;
      const enSuperficie = sup.punto;
      // A ras de piso una flor queda tirada en el suelo: solo desde 15 cm.
      if (opciones.suelo && enSuperficie.y < 15) continue;
      if (obstaculos.some((o) => Math.hypot(enSuperficie.x - o.base.x, enSuperficie.z - o.base.z) < o.radioCm + 4 && enSuperficie.y < o.base.y + o.altoCm + 4)) continue;
      let holgura = Infinity;
      for (const g of globos) holgura = Math.min(holgura, distancia(enSuperficie, g.c) - g.r);
      if (holgura >= 4) candidatos.push({ p, superficie: enSuperficie, normal, holgura });
    }
    candidatos.sort((a, b) => b.holgura - a.holgura || a.p.tramo - b.p.tramo || a.p.s - b.p.s || a.p.phi - b.p.phi);
    // Repartidos entre los tramos según su largo (la guirnalda de la base también lleva flores, como en la foto): primero
    // cada tramo hasta su parte y, si sobran, donde haya hueco.
    const largoTotal = tramos.reduce((acc, tp) => acc + tp.largo, 0);
    const cupo = tramos.map((tp) => Math.ceil((opciones.huecosFlores * tp.largo) / largoTotal));
    for (const conCupo of [true, false]) {
      for (const cand of candidatos) {
        if (huecos.length >= opciones.huecosFlores) break;
        if (conCupo && huecos.filter((h) => h.tramo === cand.p.tramo).length >= cupo[cand.p.tramo]!) continue;
        if (huecos.some((h) => distancia(h.superficie, cand.superficie) < 24)) continue;
        // Un bolsillo poco hondo (la flor se apoya en los globos que lo rodean): detrás sigue cabiendo relleno, para que
        // por el hueco de la flor no se vea a través.
        const r = limitar(cand.holgura, 4, 8) * 0.8;
        huecos.push({ tramo: cand.p.tramo, s: cand.p.s, c: suma(cand.superficie, escala(cand.normal, -r * 0.35)), r, superficie: cand.superficie, normal: cand.normal });
      }
    }
    if (huecos.length < opciones.huecosFlores) avisos.push(`Solo quedaron ${huecos.length} huecos para flores de ${opciones.huecosFlores} pedidos.`);
  }

  // 4. Relleno: de mayor a menor hueco; los R-5 en tríos. Cada relleno entra hasta donde quepa: primero a ras de la
  // envoltura y, si la boca del hueco es estrecha, más adentro (hasta 3,3 radios), para que no queden huecos que se
  // vean de lado a lado entre los grandes.
  const HONDURAS = [0.95, 1.7, 2.5, 3.3];
  const primeraHondura = (tp: TramoPreparado, s: number, phi: number, d: number): { c: Vec3; hundimiento: number; holgura: number } | null => {
    for (const hundimiento of HONDURAS) {
      const c = enEnvoltura(tp, s, phi, d / 2, hundimiento);
      const { peor, holgura } = evaluar(c, d);
      if (peor <= LIM) return { c, hundimiento, holgura };
    }
    return null;
  };
  let racimos = 0;
  for (const relleno of opciones.relleno) {
    if (!formatoValido(relleno.formatoId)) continue;
    const base = infladoValido(formatoPorId(relleno.formatoId)!, relleno.infladoCm);
    const r0 = base / 2;
    const candidatos: Array<{ p: PuntoRejilla; holgura: number }> = [];
    for (const p of rejilla) {
      // Lo que queda a ras de piso no se ve: no se rellena.
      if (opciones.suelo && superficie(tramos[p.tramo]!, p.s, p.phi).punto.y < 10) continue;
      const sitio = primeraHondura(tramos[p.tramo]!, p.s, p.phi, base);
      if (sitio) candidatos.push({ p, holgura: sitio.holgura - sitio.hundimiento * r0 });
    }
    candidatos.sort((a, b) => b.holgura - a.holgura || a.p.tramo - b.p.tramo || a.p.s - b.p.s || a.p.phi - b.p.phi);
    const tope = relleno.maximo ?? Infinity;
    const porRacimo = Math.min(6, Math.max(3, relleno.racimo ?? 3));
    let puestos = 0;
    for (const cand of candidatos) {
      if (puestos >= tope) break;
      const tp = tramos[cand.p.tramo]!;
      const d = inflar(relleno.formatoId, base);
      const sitio = primeraHondura(tp, cand.p.s, cand.p.phi, d);
      if (!sitio) continue;
      const racimo = relleno.trios ? racimos++ : null;
      const nuevo: Interno = { formatoId: relleno.formatoId, d, r: d / 2, c: sitio.c, tramo: cand.p.tramo, s: cand.p.s, phi: cand.p.phi, hundimiento: sitio.hundimiento, inclinacion: (azar() - 0.5) * 0.4, tamano: "relleno", racimo };
      globos.push(nuevo);
      puestos++;
      if (!relleno.trios) continue;
      // Dos compañeros pegados, sobre la misma envoltura: el trío en triángulo (los dos a 60° uno del otro, vistos
      // desde el primero). Si el segundo no cabe a un lado del primero, se prueba al otro.
      const R = Math.max(1, radioEnvoltura(tp, cand.p.s, cand.p.phi));
      const rango = rangoS(tp);
      const giro = azar() * Math.PI * 2;
      const companero = (k: number): boolean => {
        const a = giro + (k * Math.PI) / 3;
        const paso = d * 0.9;
        const s2 = cand.p.s + Math.cos(a) * paso;
        const phi2 = cand.p.phi + (Math.sin(a) * paso) / R;
        if (s2 < rango.min || s2 > rango.max) return false;
        const d2 = inflar(relleno.formatoId, base);
        const sitio2 = primeraHondura(tp, s2, phi2, d2);
        if (!sitio2) return false;
        globos.push({ ...nuevo, d: d2, r: d2 / 2, c: sitio2.c, s: s2, phi: phi2, hundimiento: sitio2.hundimiento, inclinacion: (azar() - 0.5) * 0.4 });
        puestos++;
        return true;
      };
      if (porRacimo === 3) {
        for (let k = 0; k < 6; k++) {
          if (!companero(k)) continue;
          if (!companero(k + 1)) companero(k + 5);
          break;
        }
      } else {
        // Racimito de más de tres: compañeros alrededor del primero, a 60° uno de otro, hasta completar.
        let enRacimo = 1;
        for (let k = 0; k < 6 && enRacimo < porRacimo && puestos < tope; k++) if (companero(k)) enRacimo++;
      }
    }
  }

  apretar(10);

  // 5. Relajación: atracción a la envoltura y separación de los que se montan.
  const pasadas = opciones.pasadasRelajacion ?? 8;
  for (let pasada = 0; pasada < pasadas; pasada++) {
    atraerEnvoltura(0.35);
    separar(0.7);
  }
  for (let pasada = 0; pasada < 60; pasada++) if (separar(0.95) === 0) break;
  // Lo que aún se monte más de la cuenta se quita (el menor de cada par).
  let quitados = 0;
  for (let i = 0; i < globos.length; i++) {
    for (let j = i + 1; j < globos.length; j++) {
      const a = globos[i]!, b = globos[j]!;
      if ((a.r + b.r - distancia(a.c, b.c)) / Math.min(a.d, b.d) > LIM) {
        if (a.fijo && b.fijo) continue;
        globos.splice(a.fijo ? j : b.fijo ? i : a.d < b.d ? i : j, 1);
        quitados++;
        i = -1;
        break;
      }
    }
  }
  if (quitados > 0) avisos.push(`Se quitaron ${quitados} globos que no se podían soltar sin aplastarse más del 12 %.`);
  const rayos = rayosDeFuga();
  // Primero solo rellenos que queden apretados (tocando a tres); al final, también los que tocan a dos.
  for (let vuelta = 0; vuelta < 2; vuelta++) {
    taparFugas(rayos, 3);
    asentarSueltos(rayos);
  }
  taparFugas(rayos, 2);
  for (let vuelta = 0; vuelta < 2; vuelta++) {
    asentarSueltos(rayos);
    acompanarSueltos(tamanosRelleno());
    quitarSueltosQueSobran(rayos);
    cambiarSueltos(rayos);
  }

  return { tramos, globos, huecos, estructuraPorMetro, avisos, usosAzar };
}

export function armarOrganico(opciones: OpcionesOrganico): ResultadoOrganico {
  const geometria = geometriaOrganica(opciones);
  const { tramos, globos, huecos, estructuraPorMetro } = geometria;
  const avisos = [...geometria.avisos];
  // El azar sigue donde lo dejó el empaque (el mismo resultado que armarlo todo de una).
  const azar = crearAzar(opciones.semilla);
  for (let i = 0; i < geometria.usosAzar; i++) azar();

  // 6. Color por cuotas, sin dos iguales pegados cuando se puede.
  const referencias = new Map<string, ReferenciaSempertex>(TABLA_SEMPERTEX.referencias.map((r) => [r.codigo, r]));
  const paleta = opciones.colores.filter((c) => {
    if (referencias.has(c.codigo) && c.peso > 0) return true;
    avisos.push(`El color ${c.codigo} no está en la tabla Sempertex (o pesa 0): se quita de la paleta.`);
    return false;
  });
  if (paleta.length === 0) throw new Error("La paleta orgánica no tiene ningún color válido");
  const avisoSustitucion = new Set<string>();
  /** El código con que la entrada `e` se sirve en el formato: el suyo, el más parecido de su familia, o ninguno. */
  const codigoEn = (e: ColorOrganico, formatoId: string): string | null => {
    if (e.formatos && !e.formatos.includes(formatoId)) return null;
    const disponibles = coloresDelFormato(formatoId);
    if (disponibles.some((r) => r.codigo === e.codigo)) return e.codigo;
    const propia = referencias.get(e.codigo)!;
    const sustituto = sustitutoDeFamilia(propia, formatoId);
    const clave = `${e.codigo}|${formatoId}`;
    if (!avisoSustitucion.has(clave)) {
      avisoSustitucion.add(clave);
      avisos.push(sustituto
        ? `${propia.nombreCompleto} (${e.codigo}) no se fabrica en ${formatoId}: se usa ${sustituto.nombreCompleto} (${sustituto.codigo}).`
        : `${propia.nombreCompleto} (${e.codigo}) no se fabrica en ${formatoId} y su familia no tiene uno parecido: en ese formato no se usa.`);
    }
    return sustituto?.codigo ?? null;
  };
  const vecinos: number[][] = globos.map(() => []);
  for (let i = 0; i < globos.length; i++) {
    for (let j = i + 1; j < globos.length; j++) {
      const a = globos[i]!, b = globos[j]!;
      if (distancia(a.c, b.c) <= a.r + b.r + 2) { vecinos[i]!.push(j); vecinos[j]!.push(i); }
    }
  }
  const entrada: Array<number | null> = globos.map(() => null);
  const codigos: Array<string | null> = globos.map(() => null), rescate = new Map<number, string>();
  const pegadoIgual = (i: number, k: number) => vecinos[i]!.some((j) => entrada[j] === k);
  const conFranjas = paleta.some((e) => e.franjas?.length);
  const porFormato = paleta.some((e) => e.porFormato);
  /** Fracción del recorrido de su tramo en que cae cada globo (solo hace falta si algún color va por franjas). */
  const fracciones = conFranjas ? globos.map((g) => { const tp = tramos[g.tramo]!; return limitar(proyectar(tp, g.c).s / tp.largo, 0, 1); }) : [];
  /** Si la entrada `e` de la paleta puede ir en el globo `i` (por su tramo y su franja). */
  const vaEnGlobo = (e: ColorOrganico, i: number) => {
    const id = tramos[globos[i]!.tramo]!.def.id;
    if (e.tramos && !e.tramos.some((t) => id === t || id.startsWith(`${t}_`))) return false;
    return !e.franjas?.length || e.franjas.some((f) => fracciones[i]! >= Math.min(f.desde, f.hasta) - 1e-9 && fracciones[i]! <= Math.max(f.desde, f.hasta) + 1e-9);
  };
  // Grupos de globos con las mismas entradas posibles: sin `tramos` ni `franjas` en la paleta, uno solo con todos.
  const grupos = new Map<string, { entradas: number[]; indices: number[] }>();
  globos.forEach((g, i) => {
    if (g.codigoFijo) return;
    // Por tramo y franja; con colores `porFormato`, también por FORMATO: cada grupo reparte sus cuotas solo entre los colores
    // que pueden ir en sus globos (si no, la cuota de un color de un escalón se calculaba sobre todos y el sobrante caía al último).
    let entradas = [...paleta.keys()].filter((k) => vaEnGlobo(paleta[k]!, i) && (!porFormato || codigoEn(paleta[k]!, g.formatoId) !== null));
    if (entradas.length === 0) entradas = [...paleta.keys()].filter((k) => vaEnGlobo(paleta[k]!, i));
    // Un globo justo en el borde de dos franjas que no cae en ninguna: los colores de su tramo, sin mirar franjas.
    if (entradas.length === 0 && conFranjas) entradas = [...paleta.keys()].filter((k) => vaEnGlobo({ ...paleta[k]!, franjas: [] }, i));
    const clave = entradas.join(",");
    const grupo = grupos.get(clave) ?? { entradas, indices: [] };
    grupo.indices.push(i);
    grupos.set(clave, grupo);
  });
  for (const { entradas, indices } of grupos.values()) {
    if (entradas.length === 0) {
      avisos.push("Hay globos sin ningún color de la paleta que pueda ir en ellos (revisa `tramos` y `franjas` de los colores): se usa Fashion Blanco (005).");
      continue;
    }
    const pesoTotal = entradas.reduce((acc, k) => acc + paleta[k]!.peso, 0);
    const exactas = new Map(entradas.map((k) => [k, (paleta[k]!.peso / pesoTotal) * indices.length]));
    const cuotas = new Map(entradas.map((k) => [k, Math.floor(exactas.get(k)!)]));
    const sobrante = indices.length - [...cuotas.values()].reduce((a, b) => a + b, 0);
    [...entradas].sort((a, b) => (exactas.get(b)! - cuotas.get(b)!) - (exactas.get(a)! - cuotas.get(a)!) || a - b).slice(0, sobrante).forEach((k) => { cuotas.set(k, cuotas.get(k)! + 1); });
    const elegibles = new Map(entradas.map((k) => [k, indices.filter((i) => codigoEn(paleta[k]!, globos[i]!.formatoId) !== null)]));
    const orden = [...entradas].sort((a, b) => elegibles.get(a)!.length - elegibles.get(b)!.length || a - b);
    orden.forEach((k, posicion) => {
      let lista = elegibles.get(k)!.filter((i) => entrada[i] === null);
      for (let i = lista.length - 1; i > 0; i--) {
        const j = Math.floor(azar() * (i + 1));
        [lista[i], lista[j]] = [lista[j]!, lista[i]!];
      }
      const exacto = (i: number) => coloresDelFormato(globos[i]!.formatoId).some((r) => r.codigo === paleta[k]!.codigo);
      lista = [...lista.filter(exacto), ...lista.filter((i) => !exacto(i))];
      const ultimo = posicion === orden.length - 1;
      let restante = ultimo ? lista.length : cuotas.get(k)!;
      for (const pasada of [0, 1]) {
        for (const i of lista) {
          if (restante <= 0) break;
          if (entrada[i] !== null || (pasada === 0 && pegadoIgual(i, k))) continue;
          entrada[i] = k;
          restante--;
        }
      }
    });
  }
  // Los que no pudo tomar nadie (solo pasa con paletas muy restringidas): la entrada posible con menos vecinos iguales.
  globos.forEach((g, i) => {
    if (entrada[i] !== null || g.codigoFijo) return;
    const posibles = paleta.map((e, k) => ({ k, ok: vaEnGlobo(e, i) && codigoEn(e, g.formatoId) !== null })).filter((x) => x.ok).map((x) => x.k);
    if (posibles.length === 0) {
      const { ref, aviso } = colorDeRescate(paleta.filter((e) => vaEnGlobo(e, i)), referencias, g.formatoId);
      if (ref) rescate.set(i, ref.codigo);
      if (!avisoSustitucion.has(aviso)) { avisoSustitucion.add(aviso); avisos.push(aviso); }
      return;
    }
    posibles.sort((a, b) => vecinos[i]!.filter((j) => entrada[j] === a).length - vecinos[i]!.filter((j) => entrada[j] === b).length || a - b);
    entrada[i] = posibles[0]!;
  });
  globos.forEach((g, i) => {
    const k = entrada[i];
    codigos[i] = g.codigoFijo && referencias.has(g.codigoFijo) ? g.codigoFijo : k === null || k === undefined ? rescate.get(i) ?? "005" : codigoEn(paleta[k]!, g.formatoId) ?? "005";
  });

  // Salida.
  const salida: GloboOrganico[] = globos.map((g, i) => {
    const tp = tramos[g.tramo]!;
    const m = proyectar(tp, g.c);
    const rel = resta(g.c, m.p);
    const radial = resta(rel, escala(m.t, punto(rel, m.t)));
    const fuera = norma(radial) > 1e-6 ? unitario(radial) : suma(escala(m.n, Math.cos(g.phi)), escala(m.b, Math.sin(g.phi)));
    const direccion = unitario(suma(fuera, escala(m.t, g.inclinacion)));
    const nudo = resta(g.c, escala(direccion, centroCuerpo("redondo", g.d)));
    const codigo = codigos[i]!;
    const ref = referencias.get(codigo)!;
    const e = entrada[i] === null || entrada[i] === undefined ? null : paleta[entrada[i]!]!;
    const transparente = ref.familia === "cristal";
    return {
      indice: i, nudo, direccion, cuelloExtraCm: 0,
      formatoId: g.formatoId, infladoCm: g.d, codigo, nombreColor: ref.nombreCompleto, hexGlobo: ref.hexGlobo,
      centro: { ...g.c }, tramo: tp.def.id, fraccion: m.s / tp.largo, tamano: g.tamano, racimo: g.racimo,
      transparente, confeti: Boolean(e?.confeti) && transparente,
    };
  });
  if (paleta.some((e) => e.confeti && referencias.get(e.codigo)?.familia !== "cristal")) avisos.push("El confeti solo se marca en globos Cristal (transparentes): en los demás no se vería.");

  const anclas: AnclaHueco[] = huecos.map((h, indice) => {
    let holgura = Infinity;
    for (const g of globos) holgura = Math.min(holgura, distancia(h.c, g.c) - g.r);
    const tp = tramos[h.tramo]!;
    const apoyos = globos.filter((g) => distancia(h.superficie, g.c) - g.r <= 30).map((g) => ({ centro: { ...g.c }, radioCm: g.r }));
    return { indice, tramo: tp.def.id, fraccion: limitar(h.s / tp.largo, 0, 1), posicion: { ...h.superficie }, normal: { ...h.normal }, holguraCm: Math.round(holgura * 10) / 10, apoyos };
  });

  // Materiales por formato + color (+ confeti, que es otro artículo).
  const materiales = new Map<string, MaterialOrganico>();
  for (const g of salida) {
    const clave = `${g.formatoId}|${g.codigo}|${g.confeti ? "c" : ""}`;
    const actual = materiales.get(clave);
    if (actual) actual.cantidad++;
    else materiales.set(clave, { formatoId: g.formatoId, codigo: g.codigo, nombre: g.confeti ? `${g.nombreColor} con confeti` : g.nombreColor, cantidad: 1, transparente: g.transparente, confeti: g.confeti });
  }

  let peorAplastamiento = 0;
  for (let i = 0; i < salida.length; i++) for (let j = i + 1; j < salida.length; j++) peorAplastamiento = Math.max(peorAplastamiento, aplastamiento(salida[i]!, salida[j]!));
  const extremo = (eje: "x" | "y" | "z") => {
    let min = Infinity, max = -Infinity;
    for (const g of salida) { min = Math.min(min, g.centro[eje] - g.infladoCm / 2); max = Math.max(max, g.centro[eje] + g.infladoCm / 2); }
    return { min, max };
  };
  const medidasTramos: MedidaTramo[] = tramos.map((tp, it) => {
    const n = salida.filter((g) => g.tramo === tp.def.id).length;
    const porMetro = n / (tp.largo / 100);
    return {
      id: tp.def.id, nombre: tp.def.nombre, largoCm: Math.round(tp.largo), globos: n,
      globosPorMetro: Math.round(porMetro * 10) / 10, globosPorPie: Math.round((porMetro / M_A_PIES) * 10) / 10,
      densidad: etiquetaDensidad(porMetro / M_A_PIES), estructuraPorMetro: Math.round(estructuraPorMetro[it]! * 10) / 10,
    };
  });
  const cuenta = (clave: (g: GloboOrganico) => string) => {
    const r: Record<string, number> = {};
    for (const g of salida) r[clave(g)] = (r[clave(g)] ?? 0) + 1;
    return r;
  };
  return {
    globos: salida,
    anclas,
    materiales: [...materiales.values()].sort((a, b) => b.cantidad - a.cantidad || a.formatoId.localeCompare(b.formatoId) || a.codigo.localeCompare(b.codigo)),
    medidas: {
      altoCm: Math.round(extremo("y").max),
      anchoCm: Math.round(extremo("x").max - extremo("x").min),
      fondoCm: Math.round(extremo("z").max - extremo("z").min),
      tramos: medidasTramos,
      peorAplastamiento: Math.round(peorAplastamiento * 1000) / 1000,
    },
    conteo: {
      total: salida.length,
      porTamano: { grande: 0, mediano: 0, relleno: 0, ...cuenta((g) => g.tamano) },
      porFormato: cuenta((g) => g.formatoId),
      porColor: cuenta((g) => g.codigo),
    },
    avisos,
  };
}

// ----------------------------------------------------------------------------------------------------------
// Formas
// ----------------------------------------------------------------------------------------------------------

/**
 * Mezcla de una columna orgánica gruesa: grandes (R-24/R-18) de ancla abajo y decrecientes hacia la punta. Parte de
 * `organica_gruesa` del plan (`mezclas.ts`: 9 → 25 %, 12 → 45 %, 18 → 20 %, 24 → 10 %), con los grandes cargados
 * en la base («grandes abajo») en vez de repartidos.
 */
export const MEZCLA_COLUMNA_GRUESA: readonly PuntoMezcla[] = [
  { t: 0, pesos: { "R-24": 0.25, "R-18": 0.35, "R-12": 0.4 } },
  { t: 0.22, pesos: { "R-24": 0.08, "R-18": 0.3, "R-12": 0.5, "R-9": 0.12 } },
  { t: 0.55, pesos: { "R-18": 0.12, "R-12": 0.5, "R-9": 0.38 } },
  { t: 1, pesos: { "R-18": 0.03, "R-12": 0.5, "R-9": 0.47 } },
];

/** Mezcla de una guirnalda baja: más carga donde nace y más fina hacia la punta. */
export const MEZCLA_GUIRNALDA: readonly PuntoMezcla[] = [
  { t: 0, pesos: { "R-18": 0.2, "R-12": 0.5, "R-9": 0.3 } },
  { t: 1, pesos: { "R-18": 0.06, "R-12": 0.47, "R-9": 0.47 } },
];

/** Relleno de la técnica Sempertex: R-9 en los huecos grandes y tríos de R-5 en el resto. */
export const RELLENO_TUPIDO: readonly RellenoOrganico[] = [
  { formatoId: "R-9", infladoCm: 18, trios: false },
  { formatoId: "R-5", infladoCm: 12, trios: true },
];

export type OpcionesColumna = {
  id?: string;
  nombre?: string;
  /** Alto total, del piso a la cara de arriba de los globos de la punta. */
  altoCm: number;
  radioBaseCm: number;
  radioMedioCm: number;
  radioPuntaCm: number;
  /** Cuánto se corre la punta hacia +x (negativo: hacia -x). */
  inclinacionCm?: number;
  /** Amplitud de la S con que serpentea el eje. */
  serpenteoCm?: number;
  origen?: Vec3;
  mezcla?: readonly PuntoMezcla[];
  irregularidad?: number;
};

/** Columna orgánica: eje casi vertical del piso a la punta, gruesa abajo y fina arriba. */
export function formaColumna(o: OpcionesColumna): TramoOrganico {
  const origen = o.origen ?? vec(0, 0, 0);
  const inicio = o.radioBaseCm * 0.5;
  // La tapa de arriba es media esfera del radio de la punta (×0,8): el eje acaba ese tanto por debajo del alto.
  const fin = o.altoCm - o.radioPuntaCm * 0.8;
  const recorrido: Vec3[] = [];
  for (let i = 0; i <= 6; i++) {
    const f = i / 6;
    recorrido.push(vec(origen.x + (o.inclinacionCm ?? 0) * f * f + (o.serpenteoCm ?? 0) * Math.sin(Math.PI * 2 * f), origen.y + inicio + (fin - inicio) * f, origen.z));
  }
  return {
    id: o.id ?? "columna",
    nombre: o.nombre ?? "Columna orgánica",
    recorrido,
    grosor: [
      { t: 0, radioCm: o.radioBaseCm },
      { t: 0.15, radioCm: o.radioBaseCm },
      { t: 0.5, radioCm: o.radioMedioCm },
      { t: 0.9, radioCm: o.radioPuntaCm },
      { t: 1, radioCm: o.radioPuntaCm * 0.8 },
    ],
    mezcla: o.mezcla ?? MEZCLA_COLUMNA_GRUESA,
    irregularidad: o.irregularidad ?? 0.12,
    tapas: { fin: true },
  };
}

/** Guirnalda: cualquier recorrido 3D, con el grosor que va de `radioInicioCm` a `radioFinCm`. */
export function formaGuirnalda(o: { id?: string; nombre?: string; puntos: readonly Vec3[]; radioInicioCm: number; radioFinCm: number; mezcla?: readonly PuntoMezcla[]; irregularidad?: number }): TramoOrganico {
  return {
    id: o.id ?? "guirnalda",
    nombre: o.nombre ?? "Guirnalda orgánica",
    recorrido: o.puntos,
    grosor: [
      { t: 0, radioCm: o.radioInicioCm },
      { t: 0.85, radioCm: o.radioFinCm },
      { t: 1, radioCm: o.radioFinCm * 0.8 },
    ],
    mezcla: o.mezcla ?? MEZCLA_GUIRNALDA,
    irregularidad: o.irregularidad ?? 0.14,
    tapas: { fin: true },
  };
}

/** Semiarco: sube del piso en `origen` y se curva hasta quedar horizontal a `altoCm`, `anchoCm` más allá (en +x). */
export function formaSemiarco(o: { id?: string; nombre?: string; anchoCm: number; altoCm: number; radioBaseCm: number; radioPuntaCm: number; origen?: Vec3; mezcla?: readonly PuntoMezcla[]; irregularidad?: number }): TramoOrganico {
  const origen = o.origen ?? vec(0, 0, 0);
  const recorrido: Vec3[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    recorrido.push(vec(origen.x + o.anchoCm * (1 - Math.cos(a)), origen.y + o.radioBaseCm * 0.5 + (o.altoCm - o.radioPuntaCm - o.radioBaseCm * 0.5) * Math.sin(a), origen.z));
  }
  return {
    id: o.id ?? "semiarco",
    nombre: o.nombre ?? "Semiarco orgánico",
    recorrido,
    grosor: [
      { t: 0, radioCm: o.radioBaseCm },
      { t: 0.2, radioCm: o.radioBaseCm },
      { t: 0.9, radioCm: o.radioPuntaCm },
      { t: 1, radioCm: o.radioPuntaCm * 0.8 },
    ],
    mezcla: o.mezcla ?? MEZCLA_COLUMNA_GRUESA,
    irregularidad: o.irregularidad ?? 0.12,
    tapas: { fin: true },
  };
}
