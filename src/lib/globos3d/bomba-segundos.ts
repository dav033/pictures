import { FORMATOS_GLOBO, formatoPorId } from "./formatos";
import { esGloboDeHelio } from "./helio-cinta";

/**
 * Segundos de bomba para inflar un globo. La tabla da los segundos para inflar cada formato a SU tamaño de decoración
 * (`infladoDecoracionCm`), y son una ESTIMACIÓN para una bomba eléctrica estándar: no está medida en ninguna bomba
 * concreta. Para otro tamaño se escala con el volumen: el tiempo crece con el cubo del diámetro (segundos × (cm / cm_ref)³).
 * Cada taller corrige los segundos de referencia en su navegador (calibración en `localStorage`).
 */
export const SEGUNDOS_BOMBA_DEFECTO: Readonly<Record<string, number>> = {
  "R-5": 1.0,
  "R-9": 1.5,
  "R-12": 2.0,
  "R-18": 3.5,
  "R-24": 4.5,
  "R-36": 7.0,
  "LOL-6": 1.0,
  "LOL-12": 2.0,
  "LOL-660": 2.5,
  "T-160": 0.5,
  "T-260": 0.7,
  "T-360": 1.0,
  "C-12": 2.0,
  "C-6": 1.0,
};

/** Clave de la calibración del taller en `localStorage` (versión 1). */
export const CLAVE_CALIBRACION_BOMBA = "taller3d.bomba.segundos.v1";

/** Un segundo de referencia es un número finito entre 0,1 y 60: lo de fuera se descarta. */
const SEGUNDOS_MIN = 0.1;
const SEGUNDOS_MAX = 60;

export type CalibracionBomba = Readonly<Record<string, number>>;

export const redondearSegundos = (segundos: number): number => Math.round(segundos * 10) / 10;

/** Lo que llega de fuera (la calibración guardada): solo formatos conocidos con segundos válidos. */
export function normalizarCalibracion(valor: unknown): CalibracionBomba {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) return {};
  const salida: Record<string, number> = {};
  for (const [formatoId, s] of Object.entries(valor)) {
    if (!formatoPorId(formatoId) || typeof s !== "number" || !Number.isFinite(s) || s < SEGUNDOS_MIN || s > SEGUNDOS_MAX) continue;
    salida[formatoId] = redondearSegundos(s);
  }
  return salida;
}

/**
 * Lee la calibración del taller de un almacén tipo `localStorage`. Nunca lanza: sin almacén, sin clave o con texto roto,
 * vale la tabla por defecto (`{}`).
 */
export function leerCalibracionBomba(almacen: Pick<Storage, "getItem"> | undefined): CalibracionBomba {
  try {
    const crudo = almacen?.getItem(CLAVE_CALIBRACION_BOMBA);
    return crudo ? normalizarCalibracion(JSON.parse(crudo)) : {};
  } catch {
    return {};
  }
}

/**
 * Lee lo que escribe una persona en el campo de segundos (coma o punto decimal, sin texto). Devuelve los segundos a 0,1 o
 * `undefined` si no es un número dentro de 0,1–60: entonces el campo conserva el valor anterior.
 */
export function parsearSegundos(texto: string): number | undefined {
  const limpio = texto.trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(limpio)) return undefined;
  const s = Number(limpio.replace(",", "."));
  return s >= SEGUNDOS_MIN && s <= SEGUNDOS_MAX ? redondearSegundos(s) : undefined;
}

/** Segundos de referencia de un formato (la calibración del taller si la hay, si no la tabla). */
export function segundosReferencia(formatoId: string, calibracion: CalibracionBomba = {}): number | undefined {
  const s = calibracion[formatoId] ?? SEGUNDOS_BOMBA_DEFECTO[formatoId];
  return s === undefined ? undefined : redondearSegundos(s);
}

/** Segundos (sin redondear) para inflar un globo de `formatoId` a `cm`: escala con el cubo del tamaño de referencia. */
export function segundosParaTamano(formatoId: string, cm: number, calibracion: CalibracionBomba = {}): number | undefined {
  const formato = formatoPorId(formatoId);
  const ref = segundosReferencia(formatoId, calibracion);
  if (!formato || ref === undefined) return undefined;
  return ref * (cm / formato.infladoDecoracionCm) ** 3;
}

/** Una fila por formato: `cmMin`–`cmMax` es el rango de tamaños inflados (redondeados al cm) y `segundosPorGlobo` el promedio. */
export type FilaBomba = { formatoId: string; nombre: string; /** «globo» o «tubito» (el tubito se infla entero, no por burbuja). */ unidad: "globo" | "tubito"; cantidad: number; cmMin: number; cmMax: number; segundosPorGlobo: number; segundosTotal: number; /** Sin redondear: el total de bomba se suma desde aquí. */ segundosSinRedondear: number };

export type InflableBomba = { formatoId: string; infladoCm: number; parte?: string; helio?: true };

/**
 * Lo que pasa por la bomba en una escena armada: cada globo por su tamaño inflado y cada tubito ENTERO que se compra
 * (`materiales` de formato tubito, los que cuenta la lista). Un tubito se infla una vez, a su tamaño de decoración, sin
 * importar en cuántas burbujas se tuerza después: por eso no se cuentan sus tramos (`armada.tubos`: 168 tramos de la
 * columna rellena son 8 tubitos).
 */
export function inflablesDeEscena(armada: { globos: ReadonlyArray<InflableBomba>; materiales: ReadonlyArray<{ formatoId: string; cantidad: number }> }): InflableBomba[] {
  const tubitos = armada.materiales.flatMap((m) => {
    const formato = formatoPorId(m.formatoId);
    if (formato?.tipo !== "tubito") return [];
    return Array.from({ length: Math.max(0, Math.round(m.cantidad)) }, (): InflableBomba => ({ formatoId: formato.id, infladoCm: formato.infladoDecoracionCm }));
  });
  return [...armada.globos, ...tubitos];
}

/**
 * Las filas de bomba de una escena: una por formato (R-5, R-9, T-160…), con el rango de tamaños inflados redondeado al cm.
 * El tiempo de cada fila es la suma globo a globo (cada uno a su tamaño); el promedio por globo es esa suma entre la cantidad.
 * Los globos de helio no pasan por la bomba (van con el tanque). Para una escena armada, `inflablesDeEscena`.
 */
export function filasBomba(globos: ReadonlyArray<InflableBomba>, calibracion: CalibracionBomba = {}): FilaBomba[] {
  const grupos = new Map<string, { formatoId: string; cmMin: number; cmMax: number; cantidad: number; segundos: number }>();
  for (const g of globos) {
    if (esGloboDeHelio(g)) continue;
    const exactos = segundosParaTamano(g.formatoId, g.infladoCm, calibracion);
    if (exactos === undefined) continue;
    const cm = Math.round(g.infladoCm);
    const previo = grupos.get(g.formatoId);
    if (previo) {
      previo.cantidad += 1;
      previo.segundos += exactos;
      previo.cmMin = Math.min(previo.cmMin, cm);
      previo.cmMax = Math.max(previo.cmMax, cm);
    } else grupos.set(g.formatoId, { formatoId: g.formatoId, cmMin: cm, cmMax: cm, cantidad: 1, segundos: exactos });
  }
  const orden = new Map(FORMATOS_GLOBO.map((f, i) => [f.id, i] as const));
  return [...grupos.values()]
    .sort((a, b) => (orden.get(a.formatoId) ?? 0) - (orden.get(b.formatoId) ?? 0))
    .map((g) => ({
      formatoId: g.formatoId,
      nombre: formatoPorId(g.formatoId)?.nombre ?? g.formatoId,
      unidad: formatoPorId(g.formatoId)?.tipo === "tubito" ? "tubito" : "globo",
      cantidad: g.cantidad,
      cmMin: g.cmMin,
      cmMax: g.cmMax,
      segundosPorGlobo: redondearSegundos(g.segundos / g.cantidad),
      segundosTotal: redondearSegundos(g.segundos),
      segundosSinRedondear: g.segundos,
    }));
}

/** El tiempo total de bomba de las filas, en segundos a 0,1. */
export const tiempoTotalBomba = (filas: readonly FilaBomba[]): number => redondearSegundos(filas.reduce((suma, f) => suma + f.segundosSinRedondear, 0));

/** Número en español con coma decimal y hasta un decimal: el único formato de tiempos de la bomba. */
export const nf = (n: number): string => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });

/** «45,3 s», «2 min 5,3 s», «4 min 12 s» o «1 h 1 min 2 s» (coma decimal, como en el resto de la lista). */
export function textoTiempo(segundos: number): string {
  if (segundos < 60) return `${nf(segundos)} s`;
  if (segundos < 3600) {
    const minutos = Math.floor(segundos / 60);
    return `${minutos} min ${nf(redondearSegundos(segundos - minutos * 60))} s`;
  }
  const horas = Math.floor(segundos / 3600);
  const resto = segundos - horas * 3600;
  const minutos = Math.floor(resto / 60);
  return `${horas} h ${minutos} min ${nf(redondearSegundos(resto - minutos * 60))} s`;
}

/** Una fila en texto: «23 × R-5 · 8–12 cm · ~0,6 s c/u · 13,8 s»; el tubito no lleva tamaño: «8 × T-260 · ~0,7 s c/u · 5,6 s». */
export function textoFilaBomba(f: FilaBomba): string {
  const total = `${nf(f.segundosTotal)} s`;
  if (f.unidad === "tubito") return `${f.cantidad} × ${f.formatoId} · ~${nf(f.segundosPorGlobo)} s c/u · ${total}`;
  const rango = f.cmMin === f.cmMax ? `${f.cmMin} cm` : `${f.cmMin}–${f.cmMax} cm`;
  return `${f.cantidad} × ${f.formatoId} · ${rango} · ~${nf(f.segundosPorGlobo)} s c/u · ${total}`;
}

/** Las líneas de bomba para el texto copiado, con su aviso de estimación (vacío si no hay globos que inflar con bomba). */
export function lineasBomba(filas: readonly FilaBomba[]): string[] {
  if (!filas.length) return [];
  return ["", "BOMBA (estimación; el taller puede calibrarla)", ...filas.map(textoFilaBomba), `Tiempo total de bomba: ${textoTiempo(tiempoTotalBomba(filas))}`];
}

/** El `localStorage` del navegador, o `undefined` si no hay o el navegador lo bloquea (nunca lanza). */
export function almacenDelNavegador(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Guarda la calibración (o la quita si está vacía). Si el almacén no deja, no pasa nada: la lista sigue con lo que hay en pantalla. */
export function guardarCalibracionBomba(almacen: Pick<Storage, "setItem" | "removeItem"> | undefined, calibracion: CalibracionBomba): void {
  try {
    if (Object.keys(calibracion).length) almacen?.setItem(CLAVE_CALIBRACION_BOMBA, JSON.stringify(calibracion));
    else almacen?.removeItem(CLAVE_CALIBRACION_BOMBA);
  } catch {
    /* sin almacenamiento: la calibración vale solo mientras la pantalla esté abierta */
  }
}
