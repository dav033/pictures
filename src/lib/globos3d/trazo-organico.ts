import type { Vec3 } from "./modulos";
import { RELLENO_TUPIDO, crearAzar, type ColorOrganico, type OpcionesOrganico, type PuntoGrosor, type PuntoMezcla, type TramoOrganico } from "./organico";
import { INFLADOS_ORGANICOS, type PesosFormato } from "./estructuras-organicas";

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

export type PuntoTrazo = { x: number; y: number; /** Diámetro del cuerpo de globos en ese punto (cm). */ grosor: number };

export type ParametrosTrazoOrganico = {
  /** Al menos 2 puntos, en orden a lo largo del trazo. */
  puntos: readonly PuntoTrazo[];
  /** La silueta con nombre de la que salieron los puntos (sin ella, el trazo es libre: de una foto o de la IA). */
  silueta?: SiluetaTrazo;
  /** Pesos por formato (R-36, R-24, R-18, R-12, R-9, R-5) de la estructura; el relleno va aparte. */
  mezcla: PesosFormato;
  /** 0 = cuerpo parejo · 1 = muy abultado (racimos grandes que sobresalen y cinturas entre ellos). */
  racimos?: number;
  colores: readonly ColorOrganico[];
  densidad?: number;
  irregularidad?: number;
  semilla: number;
};

/** Inflados de lo orgánico con el gigante de 36" (lo que asoma en los arcos de las fotos). */
export const INFLADOS_TRAZO: Readonly<Record<string, number>> = { ...INFLADOS_ORGANICOS, "R-36": 75 };

/** Mezcla de partida: la guirnalda orgánica de las fotos (grandes que asoman, base de 12 y 9, puntitos de 5). */
export const MEZCLA_TRAZO: PesosFormato = { "R-24": 0.06, "R-18": 0.24, "R-12": 0.44, "R-9": 0.2, "R-5": 0.06 };

// ----------------------------------------------------------------------------------------------------------
// Siluetas con nombre (para pedirlas por texto y como punto de partida en el editor)
// ----------------------------------------------------------------------------------------------------------

export const SILUETAS_TRAZO = [
  { id: "feston", nombre: "Festón", descripcion: "Cruza de lado a lado colgando un poco en medio (la guirnalda sobre la mesa)." },
  { id: "arco_pared", nombre: "Arco en la pared", descripcion: "Sube desde un lado, pasa arriba y baja al otro sin llegar al piso." },
  { id: "esquina_derecha", nombre: "Esquina derecha", descripcion: "Cruza arriba y baja por el lado derecho (sobre un mueble o un panel)." },
  { id: "esquina_izquierda", nombre: "Esquina izquierda", descripcion: "Cruza arriba y baja por el lado izquierdo." },
  { id: "semiarco_izquierdo", nombre: "Medio arco desde la izquierda", descripcion: "Nace del piso a la izquierda, sube y cruza arriba hacia la derecha." },
  { id: "semiarco_derecho", nombre: "Medio arco desde la derecha", descripcion: "Nace del piso a la derecha, sube y cruza arriba hacia la izquierda." },
  { id: "arco_asimetrico", nombre: "Arco asimétrico", descripcion: "Un racimo arriba a la izquierda, cruza y baja hasta el piso por la derecha, más cargado abajo." },
  { id: "diagonal", nombre: "Diagonal", descripcion: "Sube en diagonal de abajo a la izquierda a arriba a la derecha (una guirnalda de esquina)." },
] as const;
export type SiluetaTrazo = (typeof SILUETAS_TRAZO)[number]["id"];

/** Las siluetas que nacen del piso; las demás van colgadas en la pared. */
export const DESDE_EL_PISO: ReadonlySet<SiluetaTrazo> = new Set(["semiarco_izquierdo", "semiarco_derecho", "arco_asimetrico"]);
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
  }
}

// ----------------------------------------------------------------------------------------------------------
// Trazo → opciones del motor orgánico
// ----------------------------------------------------------------------------------------------------------

const r1 = (n: number) => Math.round(n * 10) / 10;
/** Un extremo con el borde de los globos a menos de esto del piso nace del piso. */
const TOCA_PISO_CM = 6;

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

/** Los formatos que caben en un cuerpo de `grosor` cm (un R-24 no va en una punta de 30 cm). */
function pesosQueCaben(mezcla: PesosFormato, grosor: number, inflados: Readonly<Record<string, number>>): Record<string, number> {
  const caben = Object.entries(mezcla).filter(([f, w]) => w > 0 && (inflados[f] ?? 0) <= grosor * 0.82);
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
  return null;
}

/** Las opciones del motor orgánico de un trazo. */
export function opcionesTrazoOrganico(p: ParametrosTrazoOrganico): OpcionesOrganico {
  const error = validarTrazo(p);
  if (error) throw new Error(error);
  const racimos = Math.min(1, Math.max(0, p.racimos ?? 0.35));
  const azar = crearAzar(p.semilla * 7 + 3);
  // Los extremos que tocan el piso: el eje baja hasta un cuarto del grosor (como el pie de una columna).
  const tocaPiso = (q: PuntoTrazo) => q.y - q.grosor / 2 <= TOCA_PISO_CM;
  const ultimo = p.puntos.length - 1;
  const puntos = p.puntos.map((q, i) => ({ ...q, y: (i === 0 || i === ultimo) && tocaPiso(q) ? q.grosor * 0.25 : Math.max(q.y, q.grosor * 0.25) }));
  const densos = suavizar(puntos, 6);
  // Largo acumulado (para poner el grosor y la mezcla en su fracción del recorrido).
  const largos = [0];
  for (let i = 1; i < densos.length; i++) largos.push(largos[i - 1]! + Math.hypot(densos[i]!.x - densos[i - 1]!.x, densos[i]!.y - densos[i - 1]!.y));
  const total = Math.max(1, largos[largos.length - 1]!);
  const grosorMedio = densos.reduce((s, q) => s + q.grosor, 0) / densos.length;
  // Racimos: bultos a lo largo (uno cada ~1,1 grosores) que engordan o adelgazan el cuerpo un poco al azar.
  const bultos: Array<{ t: number; amplitud: number }> = [];
  const paso = (grosorMedio * 1.1) / total;
  for (let t = paso * (0.3 + azar() * 0.5); t < 1; t += paso * (0.8 + azar() * 0.5)) bultos.push({ t, amplitud: (azar() * 0.5 - 0.15) * racimos });
  const abulta = (t: number) => 1 + bultos.reduce((s, b) => s + b.amplitud * Math.exp(-(((t - b.t) / (paso * 0.35)) ** 2)), 0);
  const grosor: PuntoGrosor[] = densos.map((q, i) => ({ t: r1((largos[i]! / total) * 1000) / 1000, radioCm: r1((q.grosor / 2) * Math.max(0.6, abulta(largos[i]! / total))) }));
  const cadaMezcla = Math.max(1, Math.round(densos.length / 8));
  const mezcla: PuntoMezcla[] = densos.flatMap((q, i) => (i % cadaMezcla === 0 || i === densos.length - 1 ? [{ t: r1((largos[i]! / total) * 1000) / 1000, pesos: pesosQueCaben(p.mezcla, q.grosor, INFLADOS_TRAZO) }] : []));
  const recorrido: Vec3[] = densos.map((q) => ({ x: r1(q.x), y: r1(q.y), z: 0 }));
  const tramo: TramoOrganico = {
    id: "trazo", nombre: "Guirnalda orgánica (trazo)", recorrido, grosor, mezcla,
    irregularidad: Math.min(0.3, p.irregularidad ?? 0.12 + racimos * 0.1),
    tapas: { inicio: !tocaPiso(puntos[0]!), fin: !tocaPiso(puntos[puntos.length - 1]!) },
  };
  const formatos = new Set(Object.keys(p.mezcla).filter((f) => (p.mezcla[f] ?? 0) > 0));
  const relleno = RELLENO_TUPIDO.filter((x) => formatos.has(x.formatoId) || x.formatoId === "R-5").map((x) => ({ ...x }));
  return {
    semilla: p.semilla, tramos: [tramo], inflados: INFLADOS_TRAZO, variacionInflado: 0.07, relleno,
    colores: p.colores.map((c) => ({ ...c })), suelo: true, huecosFlores: 0, vista: { x: 0, y: 0, z: 1 }, densidad: p.densidad ?? 1.25,
  };
}

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
  return { ...p, puntos: engrosado.map((q) => ({ x: r1(cx + (q.x - cx) * fx), y: r1(y0 + (q.y - y0) * fy), grosor: q.grosor })) };
}
