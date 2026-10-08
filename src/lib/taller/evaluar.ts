/**
 * Evaluación de la búsqueda del taller (REQ-002, paso 7): métricas de recuperación sobre el oro
 * (`scripts/test/fixtures/oro-busqueda-taller.json`) y la tabla que compara sistemas (la búsqueda de hoy contra el RAG).
 * Puro y sin red: cada sistema se enchufa por la interfaz `SistemaBusqueda`.
 *
 * Definiciones (todas sobre la lista de ids que devuelve el sistema, sin repetidos y en su orden):
 * - recall@k: relevantes (de cualquier grado) dentro de los k primeros ÷ total de relevantes de la consulta.
 * - acierto@5: 1 si hay al menos un relevante entre los 5 primeros (no se castiga por no traer los 10 que pide el oro).
 * - MRR: 1 ÷ posición del primer relevante (0 si no sale ninguno).
 * - nDCG@10 graduado: ganancia 2^grado − 1 (exacto 3, aceptable 1), descuento 1 ÷ log2(posición + 1), normalizado
 *   por el orden ideal (los exactos primero).
 */

export type Grado = 1 | 2;
export type Relevante = { id: string; grado: Grado };

export type ConsultaOro = { id: string; categoria: string; texto: string; relevantes: Relevante[]; nota: string };
export type FotoOro = { id: string; numero: number; archivo: string; esperado: string; parecidos: string[]; nota: string };
export type OroBusqueda = { version: number; descripcion: string; consultas: ConsultaOro[]; fotos: FotoOro[] };

export type Metricas = { recall5: number; recall10: number; acierto5: number; mrr: number; ndcg10: number };

export const METRICAS_VACIAS: Metricas = { recall5: 0, recall10: 0, acierto5: 0, mrr: 0, ndcg10: 0 };
export const NOMBRES_METRICA: ReadonlyArray<{ clave: keyof Metricas; titulo: string }> = [
  { clave: "recall5", titulo: "recall@5" },
  { clave: "recall10", titulo: "recall@10" },
  { clave: "acierto5", titulo: "acierto@5" },
  { clave: "mrr", titulo: "MRR" },
  { clave: "ndcg10", titulo: "nDCG@10" },
];

/** Un sistema que no se puede usar todavía (por ejemplo, el RAG sin índice): la evaluación lo marca y sigue. */
export class SistemaNoDisponible extends Error {}

export interface SistemaBusqueda {
  nombre: string;
  /** Los ids de la biblioteca más parecidos al texto, el mejor primero (como mucho `limite`). */
  buscarTexto(texto: string, limite: number): Promise<string[]> | string[];
  /** Lo mismo con una foto (nombre del archivo del oro); los sistemas solo de texto no la implementan. */
  buscarFoto?(archivo: string, limite: number): Promise<string[]> | string[];
}

const sinRepetidos = (ids: readonly string[]): string[] => [...new Set(ids)];
const ganancia = (grado: number): number => 2 ** grado - 1;
const descuento = (posicion: number): number => 1 / Math.log2(posicion + 1);

export function metricasDeConsulta(devueltos: readonly string[], relevantes: readonly Relevante[]): Metricas {
  if (!relevantes.length) return { ...METRICAS_VACIAS };
  const lista = sinRepetidos(devueltos);
  const grados = new Map(relevantes.map((r) => [r.id, r.grado]));
  const aciertosHasta = (k: number) => lista.slice(0, k).filter((id) => grados.has(id)).length;
  const primero = lista.findIndex((id) => grados.has(id));
  const dcg = lista.slice(0, 10).reduce((suma, id, i) => suma + ganancia(grados.get(id) ?? 0) * descuento(i + 1), 0);
  const ideal = [...relevantes].sort((a, b) => b.grado - a.grado).slice(0, 10).reduce((suma, r, i) => suma + ganancia(r.grado) * descuento(i + 1), 0);
  return {
    recall5: aciertosHasta(5) / relevantes.length,
    recall10: aciertosHasta(10) / relevantes.length,
    acierto5: aciertosHasta(5) > 0 ? 1 : 0,
    mrr: primero >= 0 ? 1 / (primero + 1) : 0,
    ndcg10: ideal > 0 ? dcg / ideal : 0,
  };
}

export function promediar(metricas: readonly Metricas[]): Metricas {
  if (!metricas.length) return { ...METRICAS_VACIAS };
  const media = (clave: keyof Metricas) => metricas.reduce((suma, m) => suma + m[clave], 0) / metricas.length;
  return { recall5: media("recall5"), recall10: media("recall10"), acierto5: media("acierto5"), mrr: media("mrr"), ndcg10: media("ndcg10") };
}

/** Lo que se le pregunta al sistema: texto o foto, con lo que debería devolver. */
export type ConsultaEvaluable = { id: string; categoria: string; texto: string; relevantes: Relevante[]; foto?: string };

export const consultasDeTexto = (oro: OroBusqueda): ConsultaEvaluable[] => oro.consultas.map(({ id, categoria, texto, relevantes }) => ({ id, categoria, texto, relevantes }));

/** Cada foto del dueño: su item (exacto) y los parecidos (aceptables). */
export const consultasDeFoto = (oro: OroBusqueda): ConsultaEvaluable[] =>
  oro.fotos.map((f) => ({
    id: f.id,
    categoria: "foto",
    texto: f.archivo,
    foto: f.archivo,
    relevantes: [{ id: f.esperado, grado: 2 }, ...f.parecidos.filter((id) => id !== f.esperado).map((id): Relevante => ({ id, grado: 1 }))],
  }));

export type ResultadoConsulta = { id: string; categoria: string; texto: string; relevantes: Relevante[]; devueltos: string[]; metricas: Metricas; error?: string };
export type ResultadoSistema = { sistema: string; consultas: ResultadoConsulta[]; promedio: Metricas; errores: number };

const LIMITE = 10;

/**
 * Corre las consultas contra el sistema. Una consulta que falla cuenta como cero y se anota, salvo `SistemaNoDisponible`,
 * que corta toda la corrida (si no está disponible para una, no lo está para ninguna).
 */
export async function evaluarSistema(sistema: SistemaBusqueda, consultas: readonly ConsultaEvaluable[]): Promise<ResultadoSistema> {
  const resultados: ResultadoConsulta[] = [];
  for (const c of consultas) {
    const base = { id: c.id, categoria: c.categoria, texto: c.texto, relevantes: c.relevantes };
    try {
      const devueltos = c.foto !== undefined ? await buscarPorFoto(sistema, c.foto) : await sistema.buscarTexto(c.texto, LIMITE);
      const ids = sinRepetidos(devueltos).slice(0, LIMITE);
      resultados.push({ ...base, devueltos: ids, metricas: metricasDeConsulta(ids, c.relevantes) });
    } catch (e) {
      if (e instanceof SistemaNoDisponible) throw e;
      resultados.push({ ...base, devueltos: [], metricas: { ...METRICAS_VACIAS }, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { sistema: sistema.nombre, consultas: resultados, promedio: promediar(resultados.map((r) => r.metricas)), errores: resultados.filter((r) => r.error).length };
}

async function buscarPorFoto(sistema: SistemaBusqueda, archivo: string): Promise<string[]> {
  if (!sistema.buscarFoto) throw new SistemaNoDisponible(`«${sistema.nombre}» no busca por foto`);
  return sistema.buscarFoto(archivo, LIMITE);
}

const porcentaje = (n: number): string => `${(n * 100).toFixed(1)}%`;
const decimal = (n: number): string => n.toFixed(3);

/** La tabla comparativa (Markdown): una fila por sistema, con las métricas promedio y los errores. `null` = no disponible. */
export function tablaComparativa(titulo: string, resultados: ReadonlyArray<{ sistema: string; resultado: ResultadoSistema | null; motivo?: string }>): string {
  const cabecera = `| ${titulo} | n | ${NOMBRES_METRICA.map((m) => m.titulo).join(" | ")} | errores |`;
  const separador = `|${"---|".repeat(NOMBRES_METRICA.length + 3)}`;
  const filas = resultados.map(({ sistema, resultado, motivo }) => {
    if (!resultado) return `| ${sistema} | - | ${NOMBRES_METRICA.map(() => "n/d").join(" | ")} | ${motivo ?? "no disponible"} |`;
    const celdas = NOMBRES_METRICA.map(({ clave }) => (clave === "mrr" || clave === "ndcg10" ? decimal(resultado.promedio[clave]) : porcentaje(resultado.promedio[clave])));
    return `| ${sistema} | ${resultado.consultas.length} | ${celdas.join(" | ")} | ${resultado.errores} |`;
  });
  return [cabecera, separador, ...filas].join("\n");
}

/** Desglose por categoría de consulta (la primera palabra antes del guion: «estructura-color» cuenta en «estructura»). */
export function desglosePorCategoria(resultado: ResultadoSistema): Array<{ categoria: string; n: number; metricas: Metricas }> {
  const grupos = new Map<string, Metricas[]>();
  for (const r of resultado.consultas) {
    for (const categoria of new Set(r.categoria.split("-"))) grupos.set(categoria, [...(grupos.get(categoria) ?? []), r.metricas]);
  }
  return [...grupos.entries()].map(([categoria, ms]) => ({ categoria, n: ms.length, metricas: promediar(ms) })).sort((a, b) => a.categoria.localeCompare(b.categoria));
}

/** Las peores consultas: menor nDCG@10, y a igual nDCG, menor recall@10. */
export function peoresConsultas(resultado: ResultadoSistema, cuantas: number): ResultadoConsulta[] {
  return [...resultado.consultas]
    .sort((a, b) => a.metricas.ndcg10 - b.metricas.ndcg10 || a.metricas.recall10 - b.metricas.recall10 || a.id.localeCompare(b.id))
    .slice(0, cuantas);
}
