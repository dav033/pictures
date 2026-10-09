import type { ConteoPorClave, EjemploPeor, FraseFrecuente, MetricasAnalisis, ProductoFeedback } from "./contrato";

/**
 * Agregación pura de los huecos recurrentes de la IA a partir de las calificaciones de un periodo: cuántas veces sale
 * cada motivo, cómo califica cada producto y cada herramienta, qué frases se repiten en los comentarios y cuáles fueron
 * los peores turnos. Sin base ni red: la consulta y el resumen de Gemini viven aparte.
 */

export type FilaParaAnalisis = {
  id: number;
  turnoId: string;
  producto: ProductoFeedback;
  calificacion: number | null;
  motivos: string[];
  comentario: string | null;
  pedido: string | null;
  herramientas: string[];
  deshecho: boolean;
};

export type ResultadoAgregacion = {
  totalTurnos: number;
  totalCalificados: number;
  promedio: number | null;
  metricas: MetricasAnalisis;
};

const MAX_PEORES = 5;
const MAX_FRASES = 15;
const NOTA_DE_QUEJA = 7;

const PALABRAS_VACIAS = new Set([
  "para", "pero", "como", "cuando", "porque", "donde", "sobre", "entre", "desde", "hasta", "este", "esta", "esto", "estos", "estas",
  "esos", "esas", "eso", "ese", "esa", "algo", "todo", "toda", "todos", "todas", "muy", "mas", "más", "menos", "sin", "con", "los",
  "las", "una", "unos", "unas", "del", "que", "por", "pido", "pedí", "puso", "puse", "hizo", "hace", "hacer", "debe", "debería",
  "está", "están", "fue", "son", "ser", "tiene", "tienen", "tenía", "quedó", "quedo", "queda", "también", "tambien",
  "cada", "otra", "otro", "otras", "otros", "solo", "sólo", "así", "asi", "ahora", "siempre", "nunca", "bien", "mal", "cosa", "cosas",
]);

function promedioDe(notas: readonly number[]): number | null {
  if (notas.length === 0) return null;
  return Math.round((notas.reduce((suma, nota) => suma + nota, 0) / notas.length) * 100) / 100;
}

function conteos(grupos: ReadonlyMap<string, number[]>, orden: "mas_frecuentes" | "peor_promedio"): ConteoPorClave[] {
  const filas = [...grupos].map(([clave, notas]) => ({ clave, total: notas.length, promedio: promedioDe(notas) }));
  return filas.sort((a, b) => orden === "mas_frecuentes"
    ? b.total - a.total || a.clave.localeCompare(b.clave)
    : (a.promedio ?? 11) - (b.promedio ?? 11) || b.total - a.total || a.clave.localeCompare(b.clave));
}

function agrupar(filas: readonly FilaParaAnalisis[], claves: (fila: FilaParaAnalisis) => readonly string[]): Map<string, number[]> {
  const grupos = new Map<string, number[]>();
  for (const fila of filas) {
    if (fila.calificacion === null) continue;
    for (const clave of new Set(claves(fila))) grupos.set(clave, [...(grupos.get(clave) ?? []), fila.calificacion]);
  }
  return grupos;
}

function palabrasDe(texto: string): string[] {
  return texto.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
}

const esPalabraUtil = (palabra: string) => palabra.length >= 4 && !PALABRAS_VACIAS.has(palabra);

/** Palabras y pares de palabras (sin las vacías en medio) que se repiten en comentarios de turnos mal calificados (cada comentario cuenta una vez). */
export function frasesFrecuentes(comentarios: readonly string[]): FraseFrecuente[] {
  const veces = new Map<string, number>();
  for (const comentario of comentarios) {
    const palabras = palabrasDe(comentario).filter(esPalabraUtil);
    const candidatas = new Set<string>();
    palabras.forEach((palabra, i) => {
      candidatas.add(palabra);
      const siguiente = palabras[i + 1];
      if (siguiente) candidatas.add(`${palabra} ${siguiente}`);
    });
    for (const frase of candidatas) veces.set(frase, (veces.get(frase) ?? 0) + 1);
  }
  const repetidas = [...veces].filter(([, n]) => n >= 2).map(([frase, n]) => ({ frase, veces: n }));
  const sinContenidas = repetidas.filter((a) => a.frase.includes(" ") || !repetidas.some((b) => b.frase.includes(" ") && b.veces >= a.veces && b.frase.split(" ").includes(a.frase)));
  return sinContenidas
    .sort((a, b) => b.veces - a.veces || b.frase.split(" ").length - a.frase.split(" ").length || a.frase.localeCompare(b.frase))
    .slice(0, MAX_FRASES);
}

function peoresEjemplos(filas: readonly FilaParaAnalisis[]): EjemploPeor[] {
  return filas
    .filter((fila): fila is FilaParaAnalisis & { calificacion: number } => fila.calificacion !== null)
    .sort((a, b) => a.calificacion - b.calificacion || Number(b.comentario !== null) - Number(a.comentario !== null) || b.id - a.id)
    .slice(0, MAX_PEORES)
    .map((fila) => ({
      id: fila.id,
      turnoId: fila.turnoId,
      producto: fila.producto,
      calificacion: fila.calificacion,
      motivos: fila.motivos,
      comentario: fila.comentario,
      pedido: fila.pedido,
    }));
}

export function agregarFeedback(filas: readonly FilaParaAnalisis[]): ResultadoAgregacion {
  const notas = filas.flatMap((fila) => (fila.calificacion === null ? [] : [fila.calificacion]));
  const comentariosDeQueja = filas.flatMap((fila) =>
    fila.comentario && (fila.calificacion === null || fila.calificacion <= NOTA_DE_QUEJA) ? [fila.comentario] : []);
  return {
    totalTurnos: filas.length,
    totalCalificados: notas.length,
    promedio: promedioDe(notas),
    metricas: {
      porMotivo: conteos(agrupar(filas, (fila) => fila.motivos), "mas_frecuentes"),
      porProducto: conteos(agrupar(filas, (fila) => [fila.producto]), "mas_frecuentes"),
      porHerramienta: conteos(agrupar(filas, (fila) => fila.herramientas), "peor_promedio"),
      deshechos: filas.filter((fila) => fila.deshecho).length,
      frases: frasesFrecuentes(comentariosDeQueja),
      peores: peoresEjemplos(filas),
    },
  };
}
