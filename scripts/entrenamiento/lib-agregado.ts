/**
 * Agregado del leaderboard: de los registros de cada pasada (una foto, una corrida) a una fila por foto con los puntajes
 * medios de sus corridas comparables, la clase de fallo dominante y la última corrida. Solo cuentan las corridas que
 * terminaron enteras (no abortadas por un tope) y se pudieron clasificar, y solo se promedian las que miden lo mismo (mismo
 * modelo, transporte, esfuerzo, razonamiento, tope de vueltas y commit).
 * Puro: sin disco ni red.
 */
import { CLASES_FALLO, type ClaseFallo } from "./lib-fallos";

export type Puntajes = {
  /** Proporciones de lo armado contra la foto (`medirProporciones().puntaje`, 0 a 1; 0 si la escena no tiene globos). */
  proporciones: number | null;
  /** Coincidencia de colores por zonas (1 = mismos colores donde van en la foto). */
  colores: number | null;
  /** Pendiente y afinado del tramo de arriba (`medirTramo`). */
  zonas: number | null;
  iou: number | null;
};

export type ModoPasada = "seco" | "real";
export type TransporteArnes = "api" | "cli" | "seco";

export type RegistroPasada = {
  foto: string;
  modo: ModoPasada;
  transporte: TransporteArnes;
  modelo: string;
  /** Esfuerzo y razonamiento con que corrió el modelo (de la config de la app): cambian lo que mide la corrida. */
  esfuerzo: string;
  pensamiento: boolean;
  commit: string;
  iniciadaEn: string;
  /** Vueltas del asistente que se hicieron en esta pasada. */
  turnos: number;
  /** El tope de vueltas con que se corrió (`--turnos`): lo que hace comparables dos corridas. */
  turnosMax: number;
  /** Llamadas a la IA hechas por la pasada de esta foto (todas: foto, detección y asistente). */
  llamadas: number;
  deteccionCacheada: boolean;
  convergio: boolean;
  puntajes: Puntajes;
  piezas: { leidas: number; armadas: number; omitidas: number; globosFoto: number; globosArmados: number };
  fallos: ClaseFallo[];
  captura: "pendiente" | "hecha";
  costeUsd: number;
  abortada: string | null;
  error: string | null;
};

export type FilaFoto = {
  foto: string;
  corridas: number;
  puntajes: Puntajes;
  fallo: ClaseFallo | "ninguno";
  ultimaCorrida: { iniciadaEn: string; modo: ModoPasada; transporte: TransporteArnes; modelo: string; esfuerzo: string; pensamiento: boolean; commit: string; turnos: number; turnosMax: number };
  costeUsd: number;
};

/** Media de los valores presentes; `null` si ninguno lo está (un puntaje que no se midió no cuenta como cero). */
export function puntuacionMedia(valores: ReadonlyArray<number | null>): number | null {
  const presentes = valores.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!presentes.length) return null;
  return presentes.reduce((suma, v) => suma + v, 0) / presentes.length;
}

/** La clase que más se repite; en empate gana la primera en el orden de `CLASES_FALLO`. `ninguno` si no hubo fallos. */
export function claseDominante(fallos: readonly ClaseFallo[]): ClaseFallo | "ninguno" {
  if (!fallos.length) return "ninguno";
  const cuenta = new Map<ClaseFallo, number>();
  for (const f of fallos) cuenta.set(f, (cuenta.get(f) ?? 0) + 1);
  let mejor: ClaseFallo | "ninguno" = "ninguno";
  let mejorCuenta = 0;
  for (const clase of CLASES_FALLO) {
    const n = cuenta.get(clase) ?? 0;
    if (n > mejorCuenta) { mejor = clase; mejorCuenta = n; }
  }
  return mejor;
}

const PUNTAJES_VACIOS: Puntajes = { proporciones: null, colores: null, zonas: null, iou: null };

/** Sufijo del commit cuando el árbol de trabajo tenía cambios sin confirmar al correr. */
export const SUFIJO_COMMIT_SUCIO = "+dirty";

/**
 * Una corrida cuenta para el leaderboard si terminó entera y el arnés pudo clasificarla: no la paró el tope y, si hubo error,
 * lo recogió una clase de fallo (lectura, medida, agente…), que es justo lo que el leaderboard enseña. Un error sin clase es una
 * excepción inesperada del arnés (`registroDeError`): no midió nada, así que se omite.
 */
export function esCorridaValida(registro: RegistroPasada): boolean {
  return registro.abortada === null && (registro.error === null || registro.fallos.length > 0);
}

/**
 * Dos corridas se promedian solo si miden lo mismo. Un árbol sucio no se agrupa con nadie: su código pudo cambiar entre
 * dos corridas del mismo hash.
 */
export function claveComparable(registro: RegistroPasada): string {
  const partes = [registro.modo, registro.modelo, registro.transporte, registro.esfuerzo, String(registro.pensamiento), String(registro.turnosMax), registro.commit];
  if (registro.commit.endsWith(SUFIJO_COMMIT_SUCIO)) partes.push(registro.iniciadaEn);
  return partes.join("|");
}

/** Cuántos registros no entran al leaderboard: abortados por un tope o con un error del arnés sin clasificar. */
export function contarOmitidas(registros: readonly RegistroPasada[]): number {
  return registros.filter((r) => !esCorridaValida(r)).length;
}

/**
 * Una fila por foto: la última corrida válida y las corridas comparables con ella (medias de los puntajes, clase dominante,
 * coste). Orden alfabético.
 */
export function agregarPorFoto(registros: readonly RegistroPasada[]): FilaFoto[] {
  const porFoto = new Map<string, RegistroPasada[]>();
  for (const r of registros.filter(esCorridaValida)) porFoto.set(r.foto, [...(porFoto.get(r.foto) ?? []), r]);
  return [...porFoto.entries()].sort(([a], [b]) => a.localeCompare(b, "es", { numeric: true })).map(([foto, corridas]) => {
    const ordenadas = [...corridas].sort((a, b) => a.iniciadaEn.localeCompare(b.iniciadaEn));
    const ultima = ordenadas[ordenadas.length - 1]!;
    const comparables = ordenadas.filter((r) => claveComparable(r) === claveComparable(ultima));
    const media = (clave: keyof Puntajes) => puntuacionMedia(comparables.map((r) => r.puntajes[clave] ?? PUNTAJES_VACIOS[clave]));
    return {
      foto,
      corridas: comparables.length,
      puntajes: { proporciones: media("proporciones"), colores: media("colores"), zonas: media("zonas"), iou: media("iou") },
      fallo: claseDominante(comparables.flatMap((r) => r.fallos)),
      ultimaCorrida: { iniciadaEn: ultima.iniciadaEn, modo: ultima.modo, transporte: ultima.transporte, modelo: ultima.modelo, esfuerzo: ultima.esfuerzo, pensamiento: ultima.pensamiento, commit: ultima.commit, turnos: ultima.turnos, turnosMax: ultima.turnosMax },
      costeUsd: Math.round(comparables.reduce((suma, r) => suma + r.costeUsd, 0) * 1e6) / 1e6,
    };
  });
}
