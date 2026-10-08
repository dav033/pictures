import { formatoPorId } from "./formatos";
import type { Vec3 } from "./modulos";
import { FLORES_PREDEFINIDAS, anillo, armarFlor, materialesPorFormato, type GloboDecoracion, type ParteGlobo, type PropiedadesFlor, type TuboDecoracion } from "./decoraciones";
import { HALLOWEEN_PREDEFINIDAS, armarHalloween, halloweenEnIngles, type DecoracionHalloween } from "./halloween";
import { armarFiguraTubito, figuraEnIngles, type DecoracionFigura } from "./figuras-tubito";
import { FIGURAS_PREDEFINIDAS } from "./ideas-figuras";
import { RIZOS_PREDEFINIDOS, armarRizo, rizoEnIngles, type DecoracionRizo } from "./rizos";
import { BURBUJAS_PREDEFINIDAS, armarBurbuja, burbujaEnIngles, type DecoracionBurbuja } from "./burbujas";
import { conParte } from "./partes-decoraciones";
import { RACIMOS_PREDEFINIDOS, armarOrbe, armarRacimo, orbeEnIngles, racimoEnIngles, type DecoracionOrbe, type DecoracionRacimo } from "./racimos-globos";

/**
 * Todas las decoraciones aplicadas por propiedades: la flor de globos redondos (`decoraciones.ts`) y las de
 * tubito y corazón de Celebra ed. 27, p. 42 («Malla con flores orgánicas»):
 * - flor de tubito: pétalos en lazo (un T-260 retorcido en lazos) o en burbuja (segmentos retorcidos), con un
 *   anillo interior opcional, corona de globitos y centro;
 * - moño de T-260: lazos a cada lado, colas y un globito al centro;
 * - estrella de T-260: rayos con su perilla en la punta, o el contorno cerrado;
 * - flor de corazones: Corazón 6 de pétalos, con la cara al frente, anillo interior de lazos y centro;
 * - rizos de tubito (`rizos.ts`) y globo burbuja con globos dentro (`burbujas.ts`).
 * Igual que la flor: «qué es» se arma en el espacio de la decoración mirando a +Y (en una pared, +Z local es
 * arriba y +X local la derecha); «dónde va» lo deciden las anclas y `colocarEn` / `colocarTubosEn`.
 * Unidades: cm.
 */
export type AnilloTubito = {
  formatoId: string;
  /** Grosor del tubito inflado (T-260: hasta 5 cm). */
  grosorCm: number;
  /** Colores pétalo a pétalo, en ciclo (un solo código = todos iguales). */
  codigos: string[];
  cantidad: number;
  /** «lazo»: el tubito sale y vuelve al centro (pétalo hueco); «burbuja»: un segmento retorcido (pétalo macizo). */
  estilo: "lazo" | "burbuja";
  /** Del centro a la punta del pétalo. */
  largoCm: number;
  /** Ancho del lazo (en burbuja no cuenta: el ancho es el grosor). */
  anchoCm: number;
  aperturaGrados: number;
  giroGrados: number;
};

export type PropiedadesFlorTubito = {
  petalos: AnilloTubito;
  interior: AnilloTubito | null;
  corona: (ParteGlobo & { cantidad: number }) | null;
  centro: ParteGlobo | null;
};

export type PropiedadesMono = {
  formatoId: string;
  grosorCm: number;
  codigo: string;
  lazosPorLado: number;
  largoLazoCm: number;
  anchoLazoCm: number;
  /** Ángulo entre lazos vecinos de un mismo lado. */
  aberturaGrados: number;
  colas: boolean;
  largoColaCm: number;
  centro: ParteGlobo | null;
};

export type PropiedadesEstrella = {
  formatoId: string;
  grosorCm: number;
  codigo: string;
  puntas: number;
  radioCm: number;
  estilo: "rayos" | "contorno";
  giroGrados: number;
  centro: ParteGlobo | null;
};

export type PropiedadesFlorCorazones = {
  corazones: ParteGlobo & { cantidad: number; aperturaGrados: number; giroGrados: number };
  interior: AnilloTubito | null;
  centro: ParteGlobo | null;
};

export type Decoracion =
  | { tipo: "flor"; propiedades: PropiedadesFlor }
  | { tipo: "flor_tubito"; propiedades: PropiedadesFlorTubito }
  | { tipo: "mono"; propiedades: PropiedadesMono }
  | { tipo: "estrella"; propiedades: PropiedadesEstrella }
  | { tipo: "flor_corazones"; propiedades: PropiedadesFlorCorazones }
  /** Las de Halloween (ojos, araña, calabazas, mano, ramo de helio, árbol trenzado, fantasma y telaraña): `halloween.ts`. */
  | DecoracionHalloween
  /** Figuras de globos y tubitos (muñecos, animales, objetos) por partes: `figuras-tubito.ts`. */
  | DecoracionFigura
  /** Rizos de tubito (tirabuzón, resorte, penacho, flecos, voluta, burbujas en cadena): `rizos.ts`. */
  | DecoracionRizo
  /** Globo burbuja con globos (y confeti o plumas) dentro, y el globo dentro de globo: `burbujas.ts`. */
  | DecoracionBurbuja
  /** Racimos de globitos (uvas, bola, collar) y el orbe con flecos: `racimos-globos.ts`. */
  | DecoracionRacimo
  | DecoracionOrbe;

export type TipoDecoracion = Decoracion["tipo"];

export const TIPOS_DECORACION: ReadonlyArray<{ id: TipoDecoracion; nombre: string; descripcion: string }> = [
  { id: "flor", nombre: "Flor de globos", descripcion: "Pétalos de globos redondos (R-5 a R-12) con corona y centro." },
  { id: "flor_tubito", nombre: "Flor de tubito", descripcion: "Pétalos de T-260 en lazo o en burbuja, con anillo interior y centro." },
  { id: "mono", nombre: "Moño", descripcion: "Moño de T-260: lazos a cada lado, colas y un globito al centro." },
  { id: "estrella", nombre: "Estrella", descripcion: "Estrella de T-260: rayos con perilla o contorno cerrado." },
  { id: "flor_corazones", nombre: "Flor de corazones", descripcion: "Corazones de pétalos, con la cara al frente, y un anillo de lazos encima." },
];

export type MaterialDecoracion = { formatoId: string; codigo: string; cantidad: number };

/**
 * Una decoración armada: globos y tramos de tubito en su espacio, sus materiales (los tubitos se cuentan por
 * largo: un T-260 da ~137 cm útiles), su diámetro y cuánto se hunde por detrás del plano de amarre (`fondoCm`),
 * para apoyarla sobre la pared sin enterrarla.
 */
export type DecoracionArmada = { globos: GloboDecoracion[]; tubos: TuboDecoracion[]; materiales: MaterialDecoracion[]; diametroCm: number; fondoCm: number };

const rad = (g: number) => (g * Math.PI) / 180;
const PUNTOS_LAZO = 28;
/** Lo que se pierde de un tubito en la boquilla, el nudo y la cola sin inflar. */
const DESPERDICIO_TUBITO_CM = 15;
/** Cada torcedura gasta algo de largo: se cuenta un 10 % de más. */
const FACTOR_TORCEDURA = 1.1;

/** Radial (con la apertura) y lateral de un pétalo que sale en el ángulo `phi` del plano XZ. */
function ejes(phi: number, apertura: number) {
  const radial: Vec3 = { x: Math.cos(phi) * Math.cos(apertura), y: Math.sin(apertura), z: Math.sin(phi) * Math.cos(apertura) };
  const lateral: Vec3 = { x: -Math.sin(phi), y: 0, z: Math.cos(phi) };
  return { radial, lateral };
}

const punto = (radial: Vec3, lateral: Vec3, u: number, v: number, y0: number): Vec3 => ({ x: radial.x * u + lateral.x * v, y: radial.y * u + y0, z: radial.z * u + lateral.z * v });

/** Lazo: el tubito sale del centro por un lado, da la vuelta en la punta y vuelve por el otro (una gota hueca). */
export function curvaLazo(phi: number, apertura: number, desdeCm: number, largoCm: number, anchoCm: number, y0 = 0): Vec3[] {
  const { radial, lateral } = ejes(phi, apertura);
  const puntos: Vec3[] = [];
  for (let i = 0; i <= PUNTOS_LAZO; i++) {
    const t = i / PUNTOS_LAZO;
    puntos.push(punto(radial, lateral, desdeCm + largoCm * Math.sin(Math.PI * t), (anchoCm / 2) * Math.sin(2 * Math.PI * t), y0));
  }
  return puntos;
}

/** Burbuja: un segmento recto de tubito, retorcido en sus dos extremos. */
function curvaBurbuja(phi: number, apertura: number, desdeCm: number, hastaCm: number, y0 = 0): Vec3[] {
  const { radial, lateral } = ejes(phi, apertura);
  return [0, 0.5, 1].map((t) => punto(radial, lateral, desdeCm + (hastaCm - desdeCm) * t, 0, y0));
}

/** Anillo de pétalos de tubito alrededor de +Y. */
function anilloTubito(a: AnilloTubito, y0 = 0): TuboDecoracion[] {
  const n = Math.max(2, Math.min(12, Math.round(a.cantidad)));
  const g = a.grosorCm;
  const apertura = rad(a.aperturaGrados);
  // Las burbujas salen de un círculo donde caben sin montarse; los lazos se tuercen todos en el centro.
  const desde = a.estilo === "burbuja" ? Math.max(g / 2, (n * g * 0.8) / (2 * Math.PI)) : g * 0.3;
  const tubos: TuboDecoracion[] = [];
  for (let i = 0; i < n; i++) {
    const phi = rad(a.giroGrados) + (2 * Math.PI * i) / n;
    const codigo = a.codigos[i % Math.max(1, a.codigos.length)] ?? a.codigos[0] ?? "009";
    const puntos = a.estilo === "lazo"
      ? curvaLazo(phi, apertura, desde, a.largoCm, Math.max(g, a.anchoCm), y0)
      : curvaBurbuja(phi, apertura, desde + g / 2, desde + Math.max(g, a.largoCm) - g / 2, y0);
    tubos.push({ formatoId: a.formatoId, grosorCm: g, codigo, puntos, cerrado: false });
  }
  return tubos;
}

function alcanceAnillo(a: AnilloTubito): number {
  const n = Math.max(2, Math.min(12, Math.round(a.cantidad)));
  const desde = a.estilo === "burbuja" ? Math.max(a.grosorCm / 2, (n * a.grosorCm * 0.8) / (2 * Math.PI)) : a.grosorCm * 0.3;
  return (desde + Math.max(a.grosorCm, a.largoCm)) * Math.cos(rad(a.aperturaGrados)) + a.grosorCm / 2;
}

/** Un globito al centro (la parte «centro»), mirando hacia fuera (+Y), con el nudo en `y0`. */
function globoCentral(parte: ParteGlobo, y0: number): GloboDecoracion {
  return { formatoId: parte.formatoId, infladoCm: parte.infladoCm, codigo: parte.codigo, nudo: { x: 0, y: y0, z: 0 }, direccion: { x: 0, y: 1, z: 0 }, cuelloExtraCm: 0, parte: "centro" };
}

export function largoCurva(puntos: readonly Vec3[], cerrado: boolean): number {
  let total = 0;
  for (let i = 1; i < puntos.length; i++) total += Math.hypot(puntos[i]!.x - puntos[i - 1]!.x, puntos[i]!.y - puntos[i - 1]!.y, puntos[i]!.z - puntos[i - 1]!.z);
  if (cerrado && puntos.length > 2) {
    const a = puntos[0]!, b = puntos[puntos.length - 1]!;
    total += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }
  return total;
}

/**
 * Materiales de una decoración: los globos uno por uno; los tubitos por largo, por formato y color (cuántos
 * tubitos enteros hacen falta para todos los tramos de ese color, contando las torceduras).
 */
export function materialesDecoracion(globos: readonly GloboDecoracion[], tubos: readonly TuboDecoracion[]): MaterialDecoracion[] {
  const lista = materialesPorFormato(globos);
  const largos = new Map<string, { formatoId: string; codigo: string; largo: number }>();
  for (const t of tubos) {
    // Lo de papel (fantasma, telaraña, cintas) no es globo: no se cotiza aquí.
    if (t.papel) continue;
    const clave = `${t.formatoId}|${t.codigo}`;
    const actual = largos.get(clave) ?? { formatoId: t.formatoId, codigo: t.codigo, largo: 0 };
    actual.largo += largoCurva(t.puntos, t.cerrado) + t.grosorCm;
    largos.set(clave, actual);
  }
  for (const { formatoId, codigo, largo } of largos.values()) {
    const util = (formatoPorId(formatoId)?.largoCm ?? 152) - DESPERDICIO_TUBITO_CM;
    lista.push({ formatoId, codigo, cantidad: Math.max(1, Math.ceil((largo * FACTOR_TORCEDURA) / util)) });
  }
  return lista;
}

function armada(globos: GloboDecoracion[], tubos: TuboDecoracion[], radioCm: number, fondoCm: number): DecoracionArmada {
  return { globos, tubos, materiales: materialesDecoracion(globos, tubos), diametroCm: Math.round(2 * radioCm), fondoCm };
}

export function armarFlorTubito(p: PropiedadesFlorTubito): DecoracionArmada {
  const tubos = conParte(anilloTubito(p.petalos, 0), "petalos");
  const g = p.petalos.grosorCm;
  if (p.interior) tubos.push(...conParte(anilloTubito(p.interior, g * 0.7), "petalos/interior"));
  const globos: GloboDecoracion[] = [];
  const alto = p.interior ? g * 0.7 + p.interior.grosorCm * 0.5 : g * 0.4;
  if (p.corona && p.corona.cantidad >= 3) {
    for (const globo of anillo(p.corona, Math.min(8, Math.round(p.corona.cantidad)), 30, p.petalos.giroGrados + 180 / p.corona.cantidad)) {
      globos.push({ ...globo, nudo: { ...globo.nudo, y: globo.nudo.y + alto }, parte: "corona" });
    }
  }
  if (p.centro) globos.push(globoCentral(p.centro, alto));
  const radio = Math.max(alcanceAnillo(p.petalos), p.interior ? alcanceAnillo(p.interior) : 0);
  return armada(globos, tubos, radio, g / 2);
}

export function armarMono(p: PropiedadesMono): DecoracionArmada {
  const g = p.grosorCm;
  const k = Math.max(1, Math.min(3, Math.round(p.lazosPorLado)));
  const tubos: TuboDecoracion[] = [];
  const apertura = rad(6);
  for (const lado of [1, -1]) {
    for (let j = 0; j < k; j++) {
      // Los lazos de cada lado se abren en abanico, un poco hacia arriba (+Z local).
      const theta = rad((j - (k - 1) / 2) * p.aberturaGrados + 8);
      const phi = lado > 0 ? theta : Math.PI - theta;
      tubos.push({ formatoId: p.formatoId, grosorCm: g, codigo: p.codigo, puntos: curvaLazo(phi, apertura, g * 0.3, p.largoLazoCm, Math.max(g, p.anchoLazoCm)), cerrado: false, parte: "lazos" });
    }
    if (p.colas) {
      // Colas: bajan hacia fuera con una onda, como las puntas del T-260 que quedan sueltas.
      const phi = -Math.PI / 2 + lado * rad(28);
      const { radial, lateral } = ejes(phi, 0);
      const puntos: Vec3[] = [];
      for (let i = 0; i <= 10; i++) {
        const u = g * 0.4 + (p.largoColaCm - g * 0.4) * (i / 10);
        puntos.push(punto(radial, lateral, u, lado * p.largoColaCm * 0.12 * Math.sin((2 * Math.PI * i) / 10), -g * 0.2));
      }
      tubos.push({ formatoId: p.formatoId, grosorCm: g, codigo: p.codigo, puntos, cerrado: false, parte: "colas" });
    }
  }
  const globos = p.centro ? [globoCentral(p.centro, g * 0.3)] : [];
  const radio = Math.max(g * 0.3 + p.largoLazoCm + g / 2, p.colas ? p.largoColaCm + g / 2 : 0);
  return armada(globos, tubos, radio, g / 2);
}

export function armarEstrella(p: PropiedadesEstrella): DecoracionArmada {
  const g = p.grosorCm;
  const n = Math.max(3, Math.min(8, Math.round(p.puntas)));
  const r = Math.max(p.radioCm, g * 2.5);
  const tubos: TuboDecoracion[] = [];
  // La primera punta mira hacia arriba (+Z local, que en una pared es arriba).
  const angulo = (i: number) => Math.PI / 2 + rad(p.giroGrados) + (2 * Math.PI * i) / n;
  if (p.estilo === "rayos") {
    const desde = Math.max(g / 2, (n * g * 0.8) / (2 * Math.PI));
    for (let i = 0; i < n; i++) {
      tubos.push({ formatoId: p.formatoId, grosorCm: g, codigo: p.codigo, puntos: curvaBurbuja(angulo(i), 0, desde + g / 2, r - g * 1.6), cerrado: false, parte: "rayos" });
      // La perilla de la punta: una burbuja cortita después de la torcedura.
      tubos.push({ formatoId: p.formatoId, grosorCm: g, codigo: p.codigo, puntos: curvaBurbuja(angulo(i), 0, r - g * 1.05, r - g * 0.5), cerrado: false, parte: "rayos/perillas" });
    }
  } else {
    const puntos: Vec3[] = [];
    for (let j = 0; j < 2 * n; j++) {
      const radio = j % 2 === 0 ? r - g / 2 : (r - g / 2) * 0.45;
      const a = angulo(0) + (Math.PI * j) / n;
      puntos.push({ x: Math.cos(a) * radio, y: 0, z: Math.sin(a) * radio });
    }
    tubos.push({ formatoId: p.formatoId, grosorCm: g, codigo: p.codigo, puntos, cerrado: true, parte: "contorno" });
  }
  const globos = p.centro ? [globoCentral(p.centro, g * 0.3)] : [];
  return armada(globos, tubos, r, g / 2);
}

export function armarFlorCorazones(p: PropiedadesFlorCorazones): DecoracionArmada {
  const { corazones } = p;
  const n = Math.max(3, Math.min(8, Math.round(corazones.cantidad)));
  const a = corazones.infladoCm;
  const apertura = rad(corazones.aperturaGrados);
  // Las puntas de los corazones al centro; los lóbulos (a ~0,55 del ancho de la punta) caben en la vuelta.
  const desde = Math.max(a * 0.1, (n * a * 0.95) / (2 * Math.PI) - a * 0.55);
  const globos: GloboDecoracion[] = [];
  for (let i = 0; i < n; i++) {
    const phi = rad(corazones.giroGrados) + (2 * Math.PI * i) / n;
    const { radial } = ejes(phi, apertura);
    // La cara del corazón mira hacia fuera de la flor (perpendicular al pétalo).
    const frente: Vec3 = { x: -Math.cos(phi) * Math.sin(apertura), y: Math.cos(apertura), z: -Math.sin(phi) * Math.sin(apertura) };
    globos.push({ formatoId: corazones.formatoId, infladoCm: a, codigo: corazones.codigo, nudo: { x: radial.x * desde, y: radial.y * desde, z: radial.z * desde }, direccion: radial, cuelloExtraCm: 0, frente, parte: "petalos" });
  }
  const tubos = p.interior ? conParte(anilloTubito(p.interior, a * 0.28), "petalos/interior") : [];
  if (p.centro) globos.push(globoCentral(p.centro, a * 0.25));
  const radio = Math.max((desde + a * 0.95) * Math.cos(apertura), p.interior ? alcanceAnillo(p.interior) : 0);
  return armada(globos, tubos, radio, a * 0.25);
}

/**
 * Las partes de una flor de globos redondos, en el orden en que la arma `armarFlor`: primero los pétalos (3 a 8), luego
 * la corona (si lleva 3 o más, hasta 8) y al final el centro (uno o un trío).
 */
function partesDeFlor(globos: readonly GloboDecoracion[], p: PropiedadesFlor): GloboDecoracion[] {
  const petalos = Math.max(3, Math.min(8, Math.round(p.petalos.cantidad)));
  const corona = p.corona && p.corona.cantidad >= 3 ? Math.min(8, Math.round(p.corona.cantidad)) : 0;
  return globos.map((g, i) => (g.parte ? g : { ...g, parte: i < petalos ? "petalos" : i < petalos + corona ? "corona" : "centro" }));
}

export function armarDecoracion(decoracion: Decoracion): DecoracionArmada {
  switch (decoracion.tipo) {
    case "flor": {
      const flor = armarFlor(decoracion.propiedades);
      return armada(partesDeFlor(flor.globos, decoracion.propiedades), [], flor.diametroCm / 2, decoracion.propiedades.petalos.infladoCm / 2);
    }
    case "flor_tubito": return armarFlorTubito(decoracion.propiedades);
    case "mono": return armarMono(decoracion.propiedades);
    case "estrella": return armarEstrella(decoracion.propiedades);
    case "flor_corazones": return armarFlorCorazones(decoracion.propiedades);
    case "figura": {
      const figura = armarFiguraTubito(decoracion.propiedades);
      return armada(figura.globos, figura.tubos, figura.radioCm, figura.fondoCm);
    }
    case "rizo": {
      // Cada rizo es un tubito aparte (no se cuentan por largo como los lazos de una flor): ver `materialesRizo`.
      const rizo = armarRizo(decoracion.propiedades);
      return { globos: [], tubos: rizo.tubos, materiales: rizo.materiales, diametroCm: Math.round(2 * rizo.radioCm), fondoCm: rizo.fondoCm };
    }
    case "burbuja": {
      const burbuja = armarBurbuja(decoracion.propiedades);
      return armada(burbuja.globos, burbuja.tubos, burbuja.radioCm, burbuja.fondoCm);
    }
    case "racimo": case "orbe": {
      const r = decoracion.tipo === "racimo" ? armarRacimo(decoracion.propiedades) : armarOrbe(decoracion.propiedades);
      return armada(r.globos, r.tubos, r.radioCm, r.fondoCm);
    }
    default: {
      const figura = armarHalloween(decoracion);
      return armada(figura.globos, figura.tubos, figura.radioCm, figura.fondoCm);
    }
  }
}

/** Qué es una decoración, en inglés y corto (para la foto con IA). */
export function decoracionEnIngles(decoracion: Decoracion): string {
  switch (decoracion.tipo) {
    case "mono": return "a twisted-balloon bow";
    case "estrella": return "a twisted-balloon star";
    case "flor": case "flor_tubito": case "flor_corazones": return "a small balloon flower";
    case "figura": return figuraEnIngles(decoracion.propiedades);
    case "rizo": return rizoEnIngles(decoracion.propiedades);
    case "burbuja": return burbujaEnIngles(decoracion.propiedades);
    case "racimo": return racimoEnIngles(decoracion.propiedades);
    case "orbe": return orbeEnIngles(decoracion.propiedades);
    default: return halloweenEnIngles(decoracion);
  }
}

/** Las piezas de Celebra ed. 27, p. 42 (y algunas más), como punto de partida; todo se cambia por propiedades. */
const lazos = (codigos: string[], cantidad: number, largoCm: number, anchoCm: number, grosorCm = 4, giroGrados = 0): AnilloTubito =>
  ({ formatoId: "T-260", grosorCm, codigos, cantidad, estilo: "lazo", largoCm, anchoCm, aperturaGrados: 4, giroGrados });

export const DECORACIONES_PREDEFINIDAS: ReadonlyArray<{ id: string; nombre: string; descripcion: string; decoracion: Decoracion }> = [
  ...FLORES_PREDEFINIDAS.map((f) => ({ id: f.id, nombre: f.nombre, descripcion: f.descripcion, decoracion: { tipo: "flor" as const, propiedades: f.propiedades } })),
  {
    id: "flor_graffiti", nombre: "Flor grande de R-12",
    // Los pétalos de la revista son Graffiti Rosa R-12 (impresos): aquí un R-12 Satín Fucsia liso. Medido en la
    // foto, el pétalo promedia #d26f94; el Satín Fucsia (#e581a4) es el liso más cercano y tiene el brillo
    // satinado del impreso. El dibujo del Graffiti no se modela.
    descripcion: "Cinco R-12 de pétalos (en la revista, Graffiti Rosa; aquí Satín Fucsia liso) con corona de 6 R-5 Fucsia y centro Reflex Dorado Rosa.",
    decoracion: { tipo: "flor", propiedades: { petalos: { formatoId: "R-12", infladoCm: 22, codigo: "412", cantidad: 5, aperturaGrados: 4, giroGrados: 0 }, corona: { formatoId: "R-5", infladoCm: 9, codigo: "012", cantidad: 6 }, centro: { formatoId: "R-5", infladoCm: 8, codigo: "968", cantidad: 1 } } },
  },
  {
    id: "flor_r5_rosada", nombre: "Flor de R-5 rosada", descripcion: "Cinco R-5 Fashion Rosado con corona de R-5 Fucsia y centro Reflex Dorado Rosa.",
    decoracion: { tipo: "flor", propiedades: { petalos: { formatoId: "R-5", infladoCm: 10, codigo: "009", cantidad: 5, aperturaGrados: 6, giroGrados: 0 }, corona: { formatoId: "R-5", infladoCm: 6, codigo: "012", cantidad: 5 }, centro: { formatoId: "R-5", infladoCm: 6, codigo: "968", cantidad: 1 } } },
  },
  {
    id: "racimo_dorado", nombre: "Racimo dorado", descripcion: "Seis R-5 Reflex Dorado chiquitos en copa con un trío al centro.",
    decoracion: { tipo: "flor", propiedades: { petalos: { formatoId: "R-5", infladoCm: 7, codigo: "970", cantidad: 6, aperturaGrados: 30, giroGrados: 0 }, centro: { formatoId: "R-5", infladoCm: 6, codigo: "970", cantidad: 3 } } },
  },
  {
    id: "flor_lazos_dorados", nombre: "Flor de lazos dorados", descripcion: "Tres lazos de T-260 Reflex Dorado, tres lazos Fashion Rosado encima y un botón Fucsia.",
    decoracion: { tipo: "flor_tubito", propiedades: { petalos: lazos(["970"], 3, 12, 9, 4, 90), interior: lazos(["009"], 3, 7, 6, 3.5, 30), corona: null, centro: { formatoId: "R-5", infladoCm: 5, codigo: "012" } } },
  },
  {
    // La revista dice Frambuesa, pero el Frambuesa (014) no se fabrica en T-260: va el Fucsia (012), el más cercano.
    id: "flor_burbujas", nombre: "Flor de 8 burbujas", descripcion: "Ocho burbujas de T-260 Fucsia, Reflex Dorado y Fashion Rosado con un botón Fucsia (la revista dice Frambuesa, que no viene en T-260).",
    decoracion: { tipo: "flor_tubito", propiedades: { petalos: { formatoId: "T-260", grosorCm: 3.5, codigos: ["012", "970", "012", "009"], cantidad: 8, estilo: "burbuja", largoCm: 7, anchoCm: 3.5, aperturaGrados: 4, giroGrados: 0 }, interior: null, corona: null, centro: { formatoId: "R-5", infladoCm: 5, codigo: "012" } } },
  },
  {
    id: "flor_lazos_rosados", nombre: "Flor de lazos fucsia", descripcion: "Cinco lazos de T-260 Fucsia con corona de 5 R-5 Reflex Dorado Rosa y centro Fashion Rosado.",
    decoracion: { tipo: "flor_tubito", propiedades: { petalos: lazos(["012"], 5, 15, 10, 3.5, 90), interior: null, corona: { formatoId: "R-5", infladoCm: 8, codigo: "968", cantidad: 5 }, centro: { formatoId: "R-5", infladoCm: 6, codigo: "009" } } },
  },
  {
    id: "mono_fucsia", nombre: "Moño fucsia", descripcion: "Moño de T-260 Fucsia: dos lazos por lado, colas y un R-5 Fashion Rosado al centro.",
    decoracion: { tipo: "mono", propiedades: { formatoId: "T-260", grosorCm: 4, codigo: "012", lazosPorLado: 2, largoLazoCm: 17, anchoLazoCm: 11, aberturaGrados: 40, colas: true, largoColaCm: 18, centro: { formatoId: "R-5", infladoCm: 7, codigo: "009" } } },
  },
  {
    id: "estrella_dorada", nombre: "Estrella dorada", descripcion: "Estrella de rayos de T-260 Reflex Dorado, con la perilla en cada punta.",
    decoracion: { tipo: "estrella", propiedades: { formatoId: "T-260", grosorCm: 3, codigo: "970", puntas: 5, radioCm: 11, estilo: "rayos", giroGrados: 0, centro: null } },
  },
  {
    id: "estrella_contorno", nombre: "Estrella de contorno", descripcion: "El contorno de una estrella de 5 puntas en un T-260.",
    decoracion: { tipo: "estrella", propiedades: { formatoId: "T-260", grosorCm: 4, codigo: "970", puntas: 5, radioCm: 18, estilo: "contorno", giroGrados: 0, centro: null } },
  },
  {
    id: "flor_corazones", nombre: "Flor de corazones", descripcion: "Cinco Corazón 6 Fashion Fucsia, cinco lazos de T-260 Fashion Rosado encima y centro Reflex Dorado Rosa.",
    decoracion: { tipo: "flor_corazones", propiedades: { corazones: { formatoId: "C-6", infladoCm: 14, codigo: "012", cantidad: 5, aperturaGrados: 6, giroGrados: 90 }, interior: lazos(["009"], 5, 7, 4.5, 3, 126), centro: { formatoId: "R-5", infladoCm: 8, codigo: "968" } } },
  },
  // Halloween (las 5 fotos del dueño): ojos, arañas, calabazas, mano, ramo de helio, árbol, fantasma y telaraña.
  ...HALLOWEEN_PREDEFINIDAS,
  // Figuras de globos y tubitos: las plantillas del generador y las ideas de sempertex.com digitalizadas.
  ...FIGURAS_PREDEFINIDAS,
  // Rizos de tubito y globos burbuja (los que más faltan en las ideas de sempertex.com).
  ...RIZOS_PREDEFINIDOS,
  ...BURBUJAS_PREDEFINIDAS,
  // Racimos de uvas, bolitas y collares de R-5, y el orbe con flecos (las fotos de Pinterest del dueño).
  ...RACIMOS_PREDEFINIDOS,
];

export function decoracionPredefinida(id: string): Decoracion {
  return (DECORACIONES_PREDEFINIDAS.find((d) => d.id === id) ?? DECORACIONES_PREDEFINIDAS[0]!).decoracion;
}

/** Las predefinidas de un tipo (para la botonera del editor). */
export function predefinidasDe(tipo: TipoDecoracion) {
  return DECORACIONES_PREDEFINIDAS.filter((d) => d.decoracion.tipo === tipo);
}
