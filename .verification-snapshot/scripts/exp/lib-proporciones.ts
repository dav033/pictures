/**
 * **Proporciones de la captura contra la foto** (REQ-001): una medida objetiva de cuánto se parece la forma de lo que arma
 * el taller a la de la foto, para que «mejor» se mida y no se mire. La verdad de la foto son los globos que detectó Gemini
 * (`detectar-globos-ia.ts`, una caja por globo) y las cajas de sus fondos; lo armado son los globos de la escena proyectados
 * con la cámara de la foto (`proyeccion-foto.ts`, la misma de la captura). Todo en unidades de ALTO de la foto (x también).
 * Puro y sin red.
 *
 * Lo que se mide, con lo que ve un ojo que compara las dos imágenes:
 *  - `iou`: cuánto de lo cubierto por globos coincide (máscaras de discos);
 *  - `bordes`: dónde acaba la masa de globos por los cuatro lados (el semiarco que llega a un lado y no al otro);
 *  - `silueta`: por franjas horizontales, de dónde a dónde va la masa (el largo y la inclinación del tramo de arriba, lo
 *    ancho y lo corrido de la columna) y, por franjas verticales, a qué altura empieza y acaba (la pendiente del trazo);
 *  - `diametro`: el tamaño mediano de los globos y el de los grandes (si la escala o la mezcla los agranda o los achica);
 *  - `fondos`: cuánto se solapa cada fondo detectado con la caja del fondo armado (marco, panel, aro, pedestales);
 *  - `tramo` y `zonasColor` (`lib-zonas.ts`): si el tramo de arriba sube o baja y se adelgaza como en la foto, y si los colores
 *    van por zonas (blanco a la izquierda, vino en la columna) o mezclados por todas partes.
 */
import { TOLERANCIA_TRAMO, errorDeZonasDeColor, medirTramo, type MedidaDeTramo } from "./lib-zonas";

/** Un globo como disco; `color` es la palabra del detector (`medir-colores.ts`) con que se compara el color por zonas. */
export type Disco = { x: number; y: number; r: number; color?: string };
export type Caja = { x0: number; y0: number; x1: number; y1: number };
export type FondoMedido = { id: string; caja: Caja };

/** Franjas con que se miden las siluetas. */
const FRANJAS = 8;
/** Resolución de las máscaras: celdas por alto de la foto. */
const CELDAS_POR_ALTO = 96;
/** Un borde de la masa es el percentil de las extremidades de los discos (un globo suelto lejos no manda). */
const PERCENTIL_BORDE = 0.03;
/** Una franja cuenta si tiene al menos esta fracción de los globos (de la que tiene más). */
const MINIMO_FRANJA = 0.04;
/** Lo que se tolera de error (alto de la foto) antes de que una medida valga 0 en el puntaje. */
const TOLERANCIA_BORDES = 0.15;
const TOLERANCIA_SILUETA = 0.15;
const TOLERANCIA_DIAMETRO = Math.log(2);

const percentil = (v: readonly number[], p: number): number => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))] ?? 0;
};
const mediana = (v: readonly number[]): number => percentil(v, 0.5);
const redondear = (n: number) => Math.round(n * 1000) / 1000;

/** La caja que cubre los discos (con percentil en los bordes: un globo suelto no manda). */
export function cajaDeDiscos(discos: readonly Disco[], percentilBorde = PERCENTIL_BORDE): Caja | null {
  if (!discos.length) return null;
  return {
    x0: percentil(discos.map((d) => d.x - d.r), percentilBorde), x1: percentil(discos.map((d) => d.x + d.r), 1 - percentilBorde),
    y0: percentil(discos.map((d) => d.y - d.r), percentilBorde), y1: percentil(discos.map((d) => d.y + d.r), 1 - percentilBorde),
  };
}

/** La máscara de los discos en una malla de `CELDAS_POR_ALTO` celdas por alto de la foto y `aspecto` veces eso de ancho. */
function mascara(discos: readonly Disco[], aspecto: number): Uint8Array {
  const filas = CELDAS_POR_ALTO, columnas = Math.ceil(CELDAS_POR_ALTO * aspecto);
  const celda = new Uint8Array(filas * columnas);
  for (const d of discos) {
    const cx0 = Math.max(0, Math.floor((d.x - d.r) * CELDAS_POR_ALTO)), cx1 = Math.min(columnas - 1, Math.ceil((d.x + d.r) * CELDAS_POR_ALTO));
    const cy0 = Math.max(0, Math.floor((d.y - d.r) * CELDAS_POR_ALTO)), cy1 = Math.min(filas - 1, Math.ceil((d.y + d.r) * CELDAS_POR_ALTO));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      if (Math.hypot((cx + 0.5) / CELDAS_POR_ALTO - d.x, (cy + 0.5) / CELDAS_POR_ALTO - d.y) <= d.r) celda[cy * columnas + cx] = 1;
    }
  }
  return celda;
}

/** Intersección sobre unión de dos máscaras. */
function iouDeMascaras(a: Uint8Array, b: Uint8Array): number {
  let dentro = 0, union = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] && b[i]) dentro++; if (a[i] || b[i]) union++; }
  return union ? dentro / union : 0;
}

export type Franja = { desde: number; hasta: number; x0: number; x1: number; y0: number; y1: number };

/**
 * Las franjas de la masa de globos: `FRANJAS` partes iguales del alto (o del ancho, según `eje`) de la CAJA DE REFERENCIA;
 * de cada una, hasta dónde llegan los discos que la tocan (por el otro eje). Una franja sin globos suficientes es `null`.
 */
export function franjasDe(discos: readonly Disco[], caja: Caja, eje: "alto" | "ancho"): Array<Franja | null> {
  const largo = (eje === "alto" ? caja.y1 - caja.y0 : caja.x1 - caja.x0) / FRANJAS;
  const origen = eje === "alto" ? caja.y0 : caja.x0;
  const lista = Array.from({ length: FRANJAS }, (_, k) => {
    const desde = origen + k * largo, hasta = desde + largo;
    const dentro = discos.filter((d) => (eje === "alto" ? d.y : d.x) >= desde && (eje === "alto" ? d.y : d.x) < hasta);
    return { desde, hasta, dentro };
  });
  const maximo = Math.max(1, ...lista.map((f) => f.dentro.length));
  return lista.map(({ desde, hasta, dentro }) => {
    if (dentro.length < Math.max(1, MINIMO_FRANJA * maximo)) return null;
    const c = cajaDeDiscos(dentro, 0)!;
    return { desde, hasta, x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1 };
  });
}

export type ErrorSilueta = {
  /** Franjas horizontales: error medio (alto de la foto) del ancho y del corrimiento lateral de la masa. */
  ancho: number; centro: number;
  /** Franjas verticales: error medio del borde de arriba y del de abajo (la pendiente del trazo). */
  arriba: number; abajo: number;
  /** El promedio de las cuatro. */
  medio: number;
};

function errorDeSilueta(foto: readonly Disco[], armado: readonly Disco[], referencia: Caja): ErrorSilueta {
  const medias = (v: readonly number[]) => (v.length ? v.reduce((s, n) => s + n, 0) / v.length : 0);
  const horizontales = [franjasDe(foto, referencia, "alto"), franjasDe(armado, referencia, "alto")] as const;
  const verticales = [franjasDe(foto, referencia, "ancho"), franjasDe(armado, referencia, "ancho")] as const;
  const par = (a: ReadonlyArray<Franja | null>, b: ReadonlyArray<Franja | null>) => a.flatMap((f, i) => (f ? [{ f, g: b[i] ?? null }] : []));
  // Una franja de la foto que el armado deja vacía cuenta como error de todo su ancho (no se esconde).
  const h = par(horizontales[0], horizontales[1]), v = par(verticales[0], verticales[1]);
  const anchoFoto = referencia.x1 - referencia.x0, altoFoto = referencia.y1 - referencia.y0;
  const ancho = medias(h.map(({ f, g }) => (g ? Math.abs((g.x1 - g.x0) - (f.x1 - f.x0)) : f.x1 - f.x0)));
  const centro = medias(h.map(({ f, g }) => (g ? Math.abs((g.x0 + g.x1) / 2 - (f.x0 + f.x1) / 2) : anchoFoto / 2)));
  const arriba = medias(v.map(({ f, g }) => (g ? Math.abs(g.y0 - f.y0) : altoFoto / 2)));
  const abajo = medias(v.map(({ f, g }) => (g ? Math.abs(g.y1 - f.y1) : altoFoto / 2)));
  return { ancho: redondear(ancho), centro: redondear(centro), arriba: redondear(arriba), abajo: redondear(abajo), medio: redondear((ancho + centro + arriba + abajo) / 4) };
}

/** Cuánto sale lo armado más allá de la masa de globos de la foto por cada lado (alto de la foto; negativo = queda corto) y el error medio. */
export type ErrorBordes = { izquierda: number; derecha: number; arriba: number; abajo: number; medio: number };

export type Diametros = {
  /** Mediana del diámetro (alto de la foto) en la foto y en lo armado, y su razón armado / foto. */
  foto: number; armado: number; razon: number;
  /** Lo mismo con el cuarto de globos más grandes de cada uno. */
  grandesFoto: number; grandesArmado: number; razonGrandes: number;
};

export type ProporcionesMedidas = {
  iou: number;
  bordes: ErrorBordes;
  silueta: ErrorSilueta;
  diametro: Diametros;
  /** IoU de cada fondo detectado con el mejor fondo armado de su familia; `null` si no se armó ninguno. */
  fondos: Array<{ id: string; iou: number | null; foto: Caja; armado: Caja | null }>;
  /** La pendiente y el afinado del tramo de arriba (`null` si la foto no tiene un tramo medible). */
  tramo: MedidaDeTramo | null;
  /** Qué tan distintos son los colores por zonas, de 0 (los mismos) a 1; `null` sin colores en la foto. */
  zonasColor: number | null;
  /** De 0 a 1: el promedio de las medidas de arriba, cada una llevada a 0-1 (1 = idéntico). */
  puntaje: number;
};

const diametrosDe = (discos: readonly Disco[]): { mediana: number; grandes: number } => {
  const d = discos.map((x) => x.r * 2);
  const grandes = [...d].sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(d.length / 4)));
  return { mediana: mediana(d), grandes: mediana(grandes) };
};

const razonDe = (armado: number, foto: number) => (foto > 0 ? armado / foto : 0);

/** El solape de dos cajas (intersección sobre unión). */
export function iouDeCajas(a: Caja, b: Caja): number {
  const w = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), h = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const area = (c: Caja) => Math.max(0, c.x1 - c.x0) * Math.max(0, c.y1 - c.y0);
  const union = area(a) + area(b) - w * h;
  return union > 0 ? (w * h) / union : 0;
}

/** Una caja detectada como globo es en realidad un fondo (un pedestal tomado por un globo gigante) si se le parece tanto como esto (IoU). */
const IOU_CAJA_ES_FONDO = 0.3;

/**
 * Los globos detectados en la foto como discos, sin las cajas que son un fondo del catálogo tomado por un globo (Gemini detecta
 * un pedestal blanco como un globo gigante): no son parte de la masa de globos con que se compara.
 */
export function discosDeLaFoto(globos: ReadonlyArray<{ x: number; y: number; w: number; h: number; d: number; color?: string }>, fondos: readonly FondoMedido[]): Disco[] {
  return globos
    .filter((g) => !fondos.some((f) => iouDeCajas({ x0: g.x - g.w / 2, x1: g.x + g.w / 2, y0: g.y - g.h / 2, y1: g.y + g.h / 2 }, f.caja) >= IOU_CAJA_ES_FONDO))
    .map((g) => ({ x: g.x, y: g.y, r: g.d / 2, ...(g.color ? { color: g.color } : {}) }));
}

/** Los fondos con el mismo id juntos en una sola caja (tres pedestales detectados uno por uno son la unión que arma un solo nodo). */
export function unirPorId(fondos: readonly FondoMedido[]): FondoMedido[] {
  const porId = new Map<string, Caja>();
  for (const { id, caja } of fondos) {
    const previa = porId.get(id);
    porId.set(id, previa ? { x0: Math.min(previa.x0, caja.x0), y0: Math.min(previa.y0, caja.y0), x1: Math.max(previa.x1, caja.x1), y1: Math.max(previa.y1, caja.y1) } : caja);
  }
  return [...porId].map(([id, caja]) => ({ id, caja }));
}

/**
 * Compara los globos de la foto (detectados) con los armados y proyectados, y los fondos de una y otra. `mismoFondo` dice si
 * dos ids son el mismo fondo para el ojo (la familia de `fondos-familias.ts`).
 */
export function medirProporciones(
  entrada: { foto: readonly Disco[]; armado: readonly Disco[]; aspecto: number; fondosFoto: readonly FondoMedido[]; fondosArmados: readonly FondoMedido[]; mismoFondo: (a: string, b: string) => boolean; esTelon: (id: string) => boolean },
): ProporcionesMedidas {
  const { foto, armado, aspecto } = entrada;
  const cajaFoto = cajaDeDiscos(foto), cajaArmado = cajaDeDiscos(armado);
  if (!cajaFoto || !cajaArmado) throw new Error("Hacen falta globos en la foto y en lo armado para medir las proporciones.");
  const iou = iouDeMascaras(mascara(foto, aspecto), mascara(armado, aspecto));
  // Con signo: positivo = lo armado se sale más allá de la masa de la foto por ese lado; negativo = se queda corto.
  const izquierda = cajaFoto.x0 - cajaArmado.x0, derecha = cajaArmado.x1 - cajaFoto.x1, arriba = cajaFoto.y0 - cajaArmado.y0, abajo = cajaArmado.y1 - cajaFoto.y1;
  const bordes = { izquierda: redondear(izquierda), derecha: redondear(derecha), arriba: redondear(arriba), abajo: redondear(abajo), medio: redondear((Math.abs(izquierda) + Math.abs(derecha) + Math.abs(arriba) + Math.abs(abajo)) / 4) };
  const silueta = errorDeSilueta(foto, armado, cajaFoto);
  const f = diametrosDe(foto), a = diametrosDe(armado);
  const diametro = { foto: redondear(f.mediana), armado: redondear(a.mediana), razon: redondear(razonDe(a.mediana, f.mediana)), grandesFoto: redondear(f.grandes), grandesArmado: redondear(a.grandes), razonGrandes: redondear(razonDe(a.grandes, f.grandes)) };
  const armados = unirPorId(entrada.fondosArmados);
  const fondos = unirPorId(entrada.fondosFoto).map((q) => {
    // Un telón se ve solo en parte (los pedestales y los globos tapan su pie): lo que arma por debajo de lo visible no cuenta.
    const recorte = (c: Caja): Caja => (entrada.esTelon(q.id) ? { ...c, y1: Math.min(c.y1, q.caja.y1) } : c);
    const par = armados.filter((o) => entrada.mismoFondo(o.id, q.id)).map((o) => ({ caja: o.caja, iou: iouDeCajas(q.caja, recorte(o.caja)) })).sort((a, b) => b.iou - a.iou)[0];
    return { id: q.id, iou: par ? redondear(par.iou) : null, foto: q.caja, armado: par?.caja ?? null };
  });
  const tramo = medirTramo(foto, armado, cajaFoto);
  const zonasColor = errorDeZonasDeColor(foto, armado, cajaFoto);
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const partes = [
    iou,
    1 - clamp(bordes.medio / TOLERANCIA_BORDES),
    1 - clamp(silueta.medio / TOLERANCIA_SILUETA),
    1 - clamp(Math.abs(Math.log(Math.max(1e-6, diametro.razon))) / TOLERANCIA_DIAMETRO),
    ...(fondos.length ? [fondos.reduce((s, q) => s + (q.iou ?? 0), 0) / fondos.length] : []),
    ...(tramo ? [1 - clamp(tramo.error / TOLERANCIA_TRAMO)] : []),
    ...(zonasColor !== null ? [1 - zonasColor] : []),
  ];
  return { iou: redondear(iou), bordes, silueta, diametro, fondos, tramo, zonasColor, puntaje: redondear(partes.reduce((s, n) => s + n, 0) / partes.length) };
}
