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

const RE_CORREO = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;
const RE_TELEFONO = /(?<![\w])\+?\(?\d[\d\s().-]{5,}\d(?![\w])/g;
const DIGITOS_MINIMOS_TELEFONO = 7;

/** Quita correos y teléfonos de un texto libre antes de guardarlo en métricas o de mandarlo a un modelo. */
export function anonimizar(texto: string): string {
  return texto
    .replace(RE_CORREO, "[correo]")
    .replace(RE_TELEFONO, (candidato) => (candidato.replace(/\D/g, "").length >= DIGITOS_MINIMOS_TELEFONO ? "[teléfono]" : candidato));
}

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
    for (const clave of new Set(claves(fila))) {
      const notas = grupos.get(clave);
      if (notas) notas.push(fila.calificacion);
      else grupos.set(clave, [fila.calificacion]);
    }
  }
  return grupos;
}

function palabrasDe(texto: string): string[] {
  return texto.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
}

const esPalabraUtil = (palabra: string) => palabra.length >= 4 && !PALABRAS_VACIAS.has(palabra);

/** Clave de agrupación: minúsculas y sin tildes, para que «azúl» y «azul» cuenten como la misma palabra. */
const sinTildes = (texto: string): string => texto.normalize("NFD").replace(/\p{M}/gu, "");

/**
 * Palabras y pares de palabras (sin las vacías en medio) que se repiten en comentarios de turnos mal calificados (cada
 * comentario cuenta una vez). Una sola pasada con mapas: O(palabras), sin comparar frases entre sí.
 */
export function frasesFrecuentes(comentarios: readonly string[]): FraseFrecuente[] {
  const veces = new Map<string, { frase: string; veces: number }>();
  const contar = (frase: string, vistas: Set<string>) => {
    const clave = sinTildes(frase);
    if (vistas.has(clave)) return;
    vistas.add(clave);
    const previa = veces.get(clave);
    if (previa) previa.veces += 1;
    else veces.set(clave, { frase, veces: 1 });
  };
  for (const comentario of comentarios) {
    const palabras = palabrasDe(comentario).filter(esPalabraUtil);
    const vistas = new Set<string>();
    palabras.forEach((palabra, i) => {
      contar(palabra, vistas);
      const siguiente = palabras[i + 1];
      if (siguiente) contar(`${palabra} ${siguiente}`, vistas);
    });
  }
  const repetidas = [...veces].filter(([, dato]) => dato.veces >= 2);
  // Una palabra suelta que casi siempre aparece dentro de un par frecuente es ruido: se queda el par.
  const mejorParDe = new Map<string, number>();
  for (const [clave, dato] of repetidas) {
    if (!clave.includes(" ")) continue;
    for (const palabra of clave.split(" ")) mejorParDe.set(palabra, Math.max(mejorParDe.get(palabra) ?? 0, dato.veces));
  }
  return repetidas
    .filter(([clave, dato]) => clave.includes(" ") || (mejorParDe.get(clave) ?? 0) < dato.veces)
    .map(([, dato]) => dato)
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
      comentario: fila.comentario === null ? null : anonimizar(fila.comentario),
      pedido: fila.pedido === null ? null : anonimizar(fila.pedido),
    }));
}

export function agregarFeedback(filas: readonly FilaParaAnalisis[]): ResultadoAgregacion {
  const notas = filas.flatMap((fila) => (fila.calificacion === null ? [] : [fila.calificacion]));
  const comentariosDeQueja = filas.flatMap((fila) =>
    fila.comentario && (fila.calificacion === null || fila.calificacion <= NOTA_DE_QUEJA) ? [anonimizar(fila.comentario)] : []);
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
