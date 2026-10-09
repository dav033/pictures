import type { Vec3 } from "./modulos";
import { RELLENO_TUPIDO, crearAzar, type ColorOrganico, type GloboFijo, type OpcionesOrganico, type PuntoGrosor, type PuntoMezcla, type RellenoOrganico, type TramoOrganico } from "./organico";
import { INFLADOS_ORGANICOS, type PesosFormato } from "./estructuras-organicas";
import { TOCA_PISO_CM } from "./puntas-lectura";
import { ZONAS_ORGANICAS, fraccionesDe, normalizarPesos, pesosConZonas, rangoAltura, type RangoAltura, type ZonaMezcla } from "./zonas-organicas";

/**
 * **Trazo orgánico**: una guirnalda orgánica que sigue CUALQUIER silueta dibujada en la pared — el festón, el arco
 * sobre la mesa, la que cruza arriba y baja por un lado hasta el piso, la que se dobla en la esquina de un mueble, el
 * arco asimétrico con un lado más cargado —, con el grosor que tiene en cada punto (los bultos de racimos grandes y
 * las puntas finas de las fotos). Es lo que más se ve en las referencias de Pinterest y lo que la guirnalda orgánica
 * por ancho y caída no alcanzaba.
 *
 * Se describe por sus **parámetros** (los puntos del trazo con su grosor, la mezcla de tamaños, los colores con peso,
 * cuánto se abulta en racimos) y el motor orgánico la vuelve a armar cada vez: la pieza `organico` guarda el trazo en
 * `generador` y así se edita (más larga, más gruesa, otra silueta, otros colores) sin perder la forma.
 *
 * Coordenadas: el plano de la pared, `x` a la derecha y `y` hacia arriba desde el piso (cm); el eje del trazo va en
 * z = 0 y los globos se reparten a su alrededor. Un extremo que llega al piso queda abierto (nace del piso); uno en el
 * aire lleva remate redondo.
 */

export type PuntoTrazo = {
  x: number; y: number; /** Diámetro del cuerpo de globos en ese punto (cm). */ grosor: number;
  /**
   * La mezcla en ese tramo cuando no es la de toda la pieza (pesos por formato): el lado cargado de gigantes, el racimo
   * de R-5 de una esquina. Entre dos puntos se interpola por el recorrido; un punto sin ella lleva la mezcla de la pieza.
   */
  pesos?: PesosFormato;
};

export type ParametrosTrazoOrganico = {
  /** Al menos 2 puntos, en orden a lo largo del trazo. */
  puntos: readonly PuntoTrazo[];
  /** La silueta con nombre de la que salieron los puntos (sin ella, el trazo es libre: de una foto o de la IA). */
  silueta?: SiluetaTrazo;
  /** Pesos por formato (R-36, R-24, R-18, R-12, R-9, R-5) de la estructura; el relleno va aparte. */
  mezcla: PesosFormato;
  /**
   * Cambios de la mezcla por zona («los R-24 solo abajo», «más R-18 al inicio»; ver `zonas-organicas.ts`): en cada
   * punto del eje dentro de la zona, esos formatos toman su peso sobre la mezcla normalizada. Los pone la IA de escena.
   */
  zonas?: readonly ZonaMezcla[];
  /** El relleno de huecos, si no es el de siempre (R-9 si va en la mezcla y tríos de R-5): «sin R-5», «menos chicos». */
  relleno?: readonly RellenoOrganico[];
  /** 0 = cuerpo parejo · 1 = muy abultado (racimos grandes que sobresalen y cinturas entre ellos). */
  racimos?: number;
  colores: readonly ColorOrganico[];
  densidad?: number;
  irregularidad?: number;
  semilla: number;
  /** Globos fijos en el plano del trazo (los gigantes de una foto, donde la foto los tiene): ver `OpcionesOrganico.fijos`. */
  fijos?: readonly GloboFijo[];
};

/** Inflados de lo orgánico con el gigante de 36" (lo que asoma en los arcos de las fotos). */
export const INFLADOS_TRAZO: Readonly<Record<string, number>> = { ...INFLADOS_ORGANICOS, "R-36": 75 };

/** Mezcla de partida: la guirnalda orgánica de las fotos (grandes que asoman, base de 12 y 9, puntitos de 5). */
export const MEZCLA_TRAZO: PesosFormato = { "R-24": 0.06, "R-18": 0.24, "R-12": 0.44, "R-9": 0.2, "R-5": 0.06 };

// ----------------------------------------------------------------------------------------------------------
// Siluetas con nombre (para pedirlas por texto y como punto de partida en el editor)
// ----------------------------------------------------------------------------------------------------------

export const SILUETAS_TRAZO = [
  { id: "feston", grupo: "guirnalda", nombre: "Festón", descripcion: "Cruza de lado a lado colgando un poco en medio (la guirnalda sobre la mesa)." },
  { id: "arco_pared", grupo: "guirnalda", nombre: "Arco en la pared", descripcion: "Sube desde un lado, pasa arriba y baja al otro sin llegar al piso." },
  { id: "esquina_derecha", grupo: "guirnalda", nombre: "Esquina derecha", descripcion: "Cruza arriba y baja por el lado derecho (sobre un mueble o un panel)." },
  { id: "esquina_izquierda", grupo: "guirnalda", nombre: "Esquina izquierda", descripcion: "Cruza arriba y baja por el lado izquierdo." },
  { id: "semiarco_izquierdo", grupo: "guirnalda", nombre: "Medio arco desde la izquierda", descripcion: "Nace del piso a la izquierda, sube y cruza arriba hacia la derecha." },
  { id: "semiarco_derecho", grupo: "guirnalda", nombre: "Medio arco desde la derecha", descripcion: "Nace del piso a la derecha, sube y cruza arriba hacia la izquierda." },
  { id: "arco_asimetrico", grupo: "guirnalda", nombre: "Arco asimétrico", descripcion: "Un racimo arriba a la izquierda, cruza y baja hasta el piso por la derecha, más cargado abajo." },
  { id: "diagonal", grupo: "guirnalda", nombre: "Diagonal", descripcion: "Sube en diagonal de abajo a la izquierda a arriba a la derecha (una guirnalda de esquina)." },
  { id: "columna_recta", grupo: "columna", nombre: "Irregular · recta", descripcion: "La silueta de una columna normal (recta, del mismo grosor) pero empacada orgánica, con globos de varios tamaños." },
  { id: "columna_racimos", grupo: "columna", nombre: "Racimos apilados", descripcion: "Forma libre: racimos que se corren a un lado y al otro al subir (la columna de graduación con uvas)." },
  { id: "columna_s", grupo: "columna", nombre: "Curva en S", descripcion: "Forma libre: sube ondulando en S." },
  { id: "columna_inclinada", grupo: "columna", nombre: "Inclinada", descripcion: "Forma libre: nace ancha del piso y se inclina hacia un lado al subir." },
] as const;
export type SiluetaTrazo = (typeof SILUETAS_TRAZO)[number]["id"];

/** Las siluetas que nacen del piso; las demás van colgadas en la pared. */
export const DESDE_EL_PISO: ReadonlySet<SiluetaTrazo> = new Set(["semiarco_izquierdo", "semiarco_derecho", "arco_asimetrico", "columna_recta", "columna_racimos", "columna_s", "columna_inclinada"]);
export const esColumnaTrazo = (s: SiluetaTrazo | undefined) => s !== undefined && SILUETAS_TRAZO.some((x) => x.id === s && x.grupo === "columna");
const ELEVACION_PARED_CM = 130;

/**
 * Los puntos de una silueta con nombre, dentro de una caja de `anchoCm` × `altoCm` centrada en x = 0, con el borde de
 * abajo de los globos en y = 0 (las que nacen del piso) y el grosor `grosorCm` (más fino en las puntas que quedan en el
 * aire, más grueso donde carga).
 */
export function puntosDeSilueta(silueta: SiluetaTrazo, medidas: { anchoCm: number; altoCm: number; grosorCm: number }): PuntoTrazo[] {
  const { anchoCm: A, altoCm: H, grosorCm: g } = medidas;
  const r = g / 2;
  // Las de pared quedan en el aire (sus puntas llevan remate); la colocación en la pared pone su altura real.
  const aire = DESDE_EL_PISO.has(silueta) ? 0 : ELEVACION_PARED_CM;
  // Fracciones de la caja → cm (el eje queda a medio grosor del borde).
  const p = (fx: number, fy: number, fg: number): PuntoTrazo => ({ x: r1(-A / 2 + r + (A - g) * fx), y: r1(aire + r + (H - g) * fy), grosor: r1(g * fg) });
  switch (silueta) {
    case "feston": return [p(0, 1, 0.75), p(0.25, 0.45, 1), p(0.5, 0.2, 1), p(0.75, 0.45, 1), p(1, 1, 0.75)];
    case "arco_pared": return [p(0, 0, 0.7), p(0.08, 0.55, 0.95), p(0.3, 0.95, 1), p(0.5, 1, 1), p(0.7, 0.95, 1), p(0.92, 0.55, 0.95), p(1, 0, 0.7)];
    case "esquina_derecha": return [p(0, 0.85, 0.65), p(0.3, 1, 0.95), p(0.62, 1, 1.05), p(0.88, 0.85, 1), p(1, 0.45, 0.85), p(0.97, 0, 0.6)];
    case "esquina_izquierda": return [p(1, 0.85, 0.65), p(0.7, 1, 0.95), p(0.38, 1, 1.05), p(0.12, 0.85, 1), p(0, 0.45, 0.85), p(0.03, 0, 0.6)];
    case "semiarco_izquierdo": return [p(0.02, 0, 1.15), p(0, 0.35, 1.05), p(0.06, 0.7, 1), p(0.25, 0.95, 0.95), p(0.6, 1, 0.8), p(1, 0.9, 0.55)];
    case "semiarco_derecho": return [p(0.98, 0, 1.15), p(1, 0.35, 1.05), p(0.94, 0.7, 1), p(0.75, 0.95, 0.95), p(0.4, 1, 0.8), p(0, 0.9, 0.55)];
    case "arco_asimetrico": return [p(0, 0.82, 0.9), p(0.18, 1, 1), p(0.5, 1, 0.85), p(0.82, 0.9, 0.9), p(1, 0.55, 1), p(0.98, 0.2, 1.15), p(0.9, 0, 1.2)];
    case "diagonal": return [p(0, 0, 0.7), p(0.35, 0.3, 1), p(0.7, 0.7, 1), p(1, 1, 0.7)];
    // Columnas: de pie desde el piso; el ancho de la caja es lo que se corre de lado (la recta, solo su grosor).
    case "columna_recta": return [0, 0.25, 0.5, 0.75, 1].map((f, i) => p(0.5, f, i === 4 ? 0.85 : 1));
    case "columna_racimos": return [0, 0.17, 0.34, 0.5, 0.67, 0.84, 1].map((f, i) => p(i === 0 ? 0.5 : i % 2 ? 0.05 : 0.95, f, i === 0 ? 1.15 : i === 6 ? 0.85 : 1.05 - (i % 3) * 0.08));
    case "columna_s": return [p(0.5, 0, 1.1), p(0.15, 0.22, 1), p(0.2, 0.42, 0.95), p(0.8, 0.62, 0.95), p(0.85, 0.82, 0.9), p(0.5, 1, 0.8)];
    case "columna_inclinada": return [p(0.05, 0, 1.15), p(0.2, 0.3, 1), p(0.5, 0.62, 0.92), p(0.95, 1, 0.8)];
  }
}

// ----------------------------------------------------------------------------------------------------------
// Trazo → opciones del motor orgánico
// ----------------------------------------------------------------------------------------------------------

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Catmull-Rom en x, y y grosor a la vez (el grosor también se suaviza entre puntos). */
function suavizar(puntos: readonly PuntoTrazo[], pasosPorTramo: number): PuntoTrazo[] {
  if (puntos.length < 3) {
    const [a, b] = [puntos[0]!, puntos[puntos.length - 1]!];
    return Array.from({ length: pasosPorTramo + 1 }, (_, k) => { const t = k / pasosPorTramo; return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, grosor: a.grosor + (b.grosor - a.grosor) * t }; });
  }
  const salida: PuntoTrazo[] = [];
  const en = (i: number) => puntos[Math.max(0, Math.min(puntos.length - 1, i))]!;
  const cr = (a: number, b: number, c: number, d: number, t: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  for (let i = 0; i < puntos.length - 1; i++) {
    const [a, b, c, d] = [en(i - 1), en(i), en(i + 1), en(i + 2)];
    for (let k = 0; k < pasosPorTramo; k++) {
      const t = k / pasosPorTramo;
      salida.push({ x: cr(a.x, b.x, c.x, d.x, t), y: cr(a.y, b.y, c.y, d.y, t), grosor: Math.max(8, cr(a.grosor, b.grosor, c.grosor, d.grosor, t)) });
    }
  }
  salida.push({ ...puntos[puntos.length - 1]! });
  return salida;
}

/** Un formato cabe en un cuerpo si su inflado no pasa de esta fracción del grosor (un R-24 no va en una punta de 30 cm). */
export const CABE_EN_GROSOR = 0.82;

/** El grosor mínimo (cm) en que cabe un formato del trazo. */
export const grosorParaFormato = (formatoId: string) => Math.ceil((INFLADOS_TRAZO[formatoId] ?? 0) / CABE_EN_GROSOR + 1);

/** Los formatos que caben en un cuerpo de `grosor` cm (un R-24 no va en una punta de 30 cm). */
function pesosQueCaben(mezcla: PesosFormato, grosor: number, inflados: Readonly<Record<string, number>>): Record<string, number> {
  const caben = Object.entries(mezcla).filter(([f, w]) => w > 0 && (inflados[f] ?? 0) <= grosor * CABE_EN_GROSOR);
  const lista = caben.length ? caben : Object.entries(mezcla).filter(([, w]) => w > 0).sort((a, b) => (inflados[a[0]] ?? 0) - (inflados[b[0]] ?? 0)).slice(0, 2);
  return Object.fromEntries(lista.map(([f, w]) => [f, Math.round(w * 1000) / 1000]));
}

export function validarTrazo(p: ParametrosTrazoOrganico): string | null {
  if (p.puntos.length < 2) return "El trazo necesita al menos 2 puntos.";
  if (p.puntos.length > 40) return "El trazo admite hasta 40 puntos.";
  for (const q of p.puntos) {
    if (![q.x, q.y, q.grosor].every(Number.isFinite)) return "Hay un punto del trazo con medidas que no son números.";
    if (q.grosor < 12 || q.grosor > 160) return `Grosor de ${q.grosor} cm fuera de rango (12 a 160 cm).`;
    if (q.y < -1) return "Ningún punto del trazo va bajo el piso.";
  }
  if (!Object.values(p.mezcla).some((w) => w > 0)) return "La mezcla de tamaños no tiene ningún formato con peso.";
  if (!p.colores.some((c) => c.peso > 0)) return "El trazo necesita al menos un color con peso.";
  for (const q of p.puntos) {
    if (q.pesos && (Object.values(q.pesos).some((w) => !Number.isFinite(w) || w < 0) || !Object.values(q.pesos).some((w) => w > 0))) return "La mezcla de un punto del trazo necesita pesos positivos.";
  }
  for (const z of p.zonas ?? []) {
    if (!(ZONAS_ORGANICAS as readonly string[]).includes(z.zona)) return `Zona «${z.zona}» desconocida: ${ZONAS_ORGANICAS.join(", ")}.`;
    if (Object.values(z.pesos).some((w) => !Number.isFinite(w) || w < 0)) return "Un peso de zona no es un número positivo.";
  }
  return null;
}

/** Un punto del eje suavizado del trazo: dónde está, su grosor y su fracción del recorrido. */
export type MuestraTrazo = { x: number; y: number; grosor: number; t: number };

/**
 * El eje del trazo como lo arma el motor: los extremos que tocan el piso bajan a un cuarto del grosor, suavizado y con
 * la fracción del recorrido de cada punto; y la altura que recorre (para las zonas `abajo`/`arriba`).
 */
export function muestrasTrazo(p: Pick<ParametrosTrazoOrganico, "puntos">): { muestras: MuestraTrazo[]; rango: RangoAltura; largoCm: number; tocaPiso: { inicio: boolean; fin: boolean } } {
  // Los extremos que tocan el piso: el eje baja hasta un cuarto del grosor (como el pie de una columna).
  const tocaPiso = (q: PuntoTrazo) => q.y - q.grosor / 2 <= TOCA_PISO_CM;
  const ultimo = p.puntos.length - 1;
  const puntos = p.puntos.map((q, i) => ({ ...q, y: (i === 0 || i === ultimo) && tocaPiso(q) ? q.grosor * 0.25 : Math.max(q.y, q.grosor * 0.25) }));
  const densos = suavizar(puntos, 6);
  // Largo acumulado (para poner el grosor y la mezcla en su fracción del recorrido).
  const largos = [0];
  for (let i = 1; i < densos.length; i++) largos.push(largos[i - 1]! + Math.hypot(densos[i]!.x - densos[i - 1]!.x, densos[i]!.y - densos[i - 1]!.y));
  const total = Math.max(1, largos[largos.length - 1]!);
  const muestras = densos.map((q, i) => ({ ...q, t: largos[i]! / total }));
  return { muestras, rango: rangoAltura(muestras), largoCm: total, tocaPiso: { inicio: tocaPiso(puntos[0]!), fin: tocaPiso(puntos[ultimo]!) } };
}

/**
 * La mezcla a la fracción `t` del recorrido con mezclas por punto: la de los dos puntos que la rodean (la de la pieza
 * en los que no traen), normalizadas e interpoladas por el largo. Es aproximada: `t` es del eje suavizado y las fracciones
 * de los puntos, de la polilínea original (casi iguales).
 */
export function mezclaEnRecorrido(p: Pick<ParametrosTrazoOrganico, "puntos" | "mezcla">, t: number): PesosFormato {
  const fr = fraccionesDe(p.puntos);
  const de = (i: number) => normalizarPesos(p.puntos[i]!.pesos ?? p.mezcla);
  let i = 0;
  while (i < fr.length - 2 && fr[i + 1]! < t) i++;
  const a = de(i), b = de(Math.min(i + 1, fr.length - 1));
  const u = Math.min(1, Math.max(0, (t - fr[i]!) / ((fr[i + 1] ?? 1) - fr[i]! || 1)));
  const salida: Record<string, number> = {};
  for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const w = (a[f] ?? 0) * (1 - u) + (b[f] ?? 0) * u;
    if (w > 0) salida[f] = Math.round(w * 1000) / 1000;
  }
  return salida;
}

/** Las opciones del motor orgánico de un trazo. */
export function opcionesTrazoOrganico(p: ParametrosTrazoOrganico): OpcionesOrganico {
  const error = validarTrazo(p);
  if (error) throw new Error(error);
  const racimos = Math.min(1, Math.max(0, p.racimos ?? 0.35));
  const azar = crearAzar(p.semilla * 7 + 3);
  const { muestras: densos, rango, largoCm: total, tocaPiso } = muestrasTrazo(p);
  const grosorMedio = densos.reduce((s, q) => s + q.grosor, 0) / densos.length;
  // Racimos: bultos a lo largo (uno cada ~1,1 grosores) que engordan o adelgazan el cuerpo un poco al azar.
  const bultos: Array<{ t: number; amplitud: number }> = [];
  const paso = (grosorMedio * 1.1) / total;
  for (let t = paso * (0.3 + azar() * 0.5); t < 1; t += paso * (0.8 + azar() * 0.5)) bultos.push({ t, amplitud: (azar() * 0.5 - 0.15) * racimos });
  const abulta = (t: number) => 1 + bultos.reduce((s, b) => s + b.amplitud * Math.exp(-(((t - b.t) / (paso * 0.35)) ** 2)), 0);
  const grosor: PuntoGrosor[] = densos.map((q) => ({ t: r1(q.t * 1000) / 1000, radioCm: r1((q.grosor / 2) * Math.max(0.6, abulta(q.t))) }));
  const cadaMezcla = Math.max(1, Math.round(densos.length / 8));
  // Con zonas, la mezcla se pone en cada punto (para que el cambio de zona quede donde va); sin ellas, cada tanto.
  const porPunto = p.puntos.some((q) => q.pesos);
  const cada = p.zonas?.length || porPunto ? 1 : cadaMezcla;
  const mezcla: PuntoMezcla[] = densos.flatMap((q, i) => {
    if (i % cada !== 0 && i !== densos.length - 1) return [];
    const base = porPunto ? mezclaEnRecorrido(p, q.t) : p.mezcla;
    return [{ t: r1(q.t * 1000) / 1000, pesos: pesosQueCaben(p.zonas?.length ? pesosConZonas(base, p.zonas, q.t, q.y, rango, q.x) : base, q.grosor, INFLADOS_TRAZO) }];
  });
  const recorrido: Vec3[] = densos.map((q) => ({ x: r1(q.x), y: r1(q.y), z: 0 }));
  const tramo: TramoOrganico = {
    id: "trazo", nombre: "Guirnalda orgánica (trazo)", recorrido, grosor, mezcla,
    irregularidad: Math.min(0.3, p.irregularidad ?? 0.12 + racimos * 0.1),
    tapas: { inicio: !tocaPiso.inicio, fin: !tocaPiso.fin },
  };
  const formatos = new Set([...Object.keys(p.mezcla).filter((f) => (p.mezcla[f] ?? 0) > 0), ...p.puntos.flatMap((q) => Object.keys(q.pesos ?? {}).filter((f) => (q.pesos![f] ?? 0) > 0)), ...(p.zonas ?? []).flatMap((z) => Object.keys(z.pesos).filter((f) => (z.pesos[f] ?? 0) > 0))]);
  const relleno = (p.relleno ?? RELLENO_TUPIDO.filter((x) => formatos.has(x.formatoId) || x.formatoId === "R-5")).map((x) => ({ ...x }));
  return {
    semilla: p.semilla, tramos: [tramo], inflados: INFLADOS_TRAZO, variacionInflado: 0.07, relleno,
    colores: p.colores.map((c) => ({ ...c })), suelo: true, huecosFlores: 0, vista: { x: 0, y: 0, z: 1 }, densidad: p.densidad ?? DENSIDAD_TRAZO,
    ...(p.fijos?.length ? { fijos: p.fijos.map((f) => ({ ...f })) } : {}),
  };
}

/** La densidad de estructura del trazo cuando no se pide otra. */
export const DENSIDAD_TRAZO = 1.25;

/** Medidas de la caja del trazo (por fuera, con el grosor): ancho, alto y el punto más bajo de los globos. */
export function cajaTrazo(p: Pick<ParametrosTrazoOrganico, "puntos">): { anchoCm: number; altoCm: number; minX: number; minY: number } {
  const xs = p.puntos.flatMap((q) => [q.x - q.grosor / 2, q.x + q.grosor / 2]);
  const ys = p.puntos.flatMap((q) => [Math.max(0, q.y - q.grosor / 2), q.y + q.grosor / 2]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { anchoCm: r1(Math.max(...xs) - minX), altoCm: r1(Math.max(...ys) - minY), minX: r1(minX), minY: r1(minY) };
}

/**
 * El trazo estirado a otra caja por fuera (ancho, alto) y/o con otro grosor (factor): para «más larga», «más gruesa».
 * Se estira el eje (lo que sobresale el grosor no cambia), así que la medida por fuera queda la pedida; el pie (lo más
 * bajo) no se mueve.
 */
export function escalarTrazo(p: ParametrosTrazoOrganico, cambio: { anchoCm?: number; altoCm?: number; grosor?: number }): ParametrosTrazoOrganico {
  const fg = cambio.grosor ?? 1;
  const engrosado = p.puntos.map((q) => ({ ...q, grosor: r1(Math.min(160, Math.max(12, q.grosor * fg))) }));
  const caja = cajaTrazo({ puntos: engrosado });
  const xs = engrosado.map((q) => q.x), ys = engrosado.map((q) => q.y);
  const ejeX = Math.max(...xs) - Math.min(...xs), ejeY = Math.max(...ys) - Math.min(...ys);
  const fx = cambio.anchoCm && ejeX > 1 ? Math.max(0.05, (cambio.anchoCm - (caja.anchoCm - ejeX)) / ejeX) : 1;
  const fy = cambio.altoCm && ejeY > 1 ? Math.max(0.05, (cambio.altoCm - (caja.altoCm - ejeY)) / ejeY) : 1;
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, y0 = Math.min(...ys);
  const enX = (x: number) => r1(cx + (x - cx) * fx), enY = (y: number) => r1(y0 + (y - y0) * fy);
  // Los puntos conservan su mezcla propia (`pesos`). Un fijo va en su sitio del cuerpo: el punto del eje que tenía más cerca se
  // estira con el eje y lo que lo separa de él (hacia fuera) crece con el grosor de ese punto, no con el estiramiento del eje.
  const fijos = p.fijos?.map((f) => {
    const { punto, u, tramo } = proyectarEnEje(p.puntos, f);
    const antes = p.puntos[tramo]!.grosor + (p.puntos[tramo + 1]!.grosor - p.puntos[tramo]!.grosor) * u;
    const despues = engrosado[tramo]!.grosor + (engrosado[tramo + 1]!.grosor - engrosado[tramo]!.grosor) * u;
    const radial = antes > 0 ? despues / antes : 1;
    return { ...f, x: r1(enX(punto.x) + (f.x - punto.x) * radial), y: r1(enY(punto.y) + (f.y - punto.y) * radial) };
  });
  return { ...p, puntos: engrosado.map((q) => ({ ...q, x: enX(q.x), y: enY(q.y) })), ...(fijos ? { fijos } : {}) };
}

/** El punto del eje (la polilínea de los puntos del trazo) más cercano a `c`, con su tramo y su fracción `u` dentro de él. */
function proyectarEnEje(puntos: readonly PuntoTrazo[], c: { x: number; y: number }): { punto: { x: number; y: number }; tramo: number; u: number } {
  let mejor = { punto: { x: puntos[0]!.x, y: puntos[0]!.y }, tramo: 0, u: 0, d: Infinity };
  for (let i = 0; i < puntos.length - 1; i++) {
    const a = puntos[i]!, b = puntos[i + 1]!;
    const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1e-9;
    const u = Math.max(0, Math.min(1, ((c.x - a.x) * vx + (c.y - a.y) * vy) / l2));
    const punto = { x: a.x + vx * u, y: a.y + vy * u };
    const d = Math.hypot(c.x - punto.x, c.y - punto.y);
    if (d < mejor.d) mejor = { punto, tramo: i, u, d };
  }
  return mejor;
}
