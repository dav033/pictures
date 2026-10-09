/**
 * Piezas de la evaluación del refinado contra la foto (REQ-001 paso 9), usadas por `evaluar-foto-a-escena.ts --refinar`:
 * las medidas de una escena contra la foto (parecido de imagen por embedding y reparto de tamaños contra el de la lectura
 * hecha a mano) y el bucle de refinado de verdad (captura sin cabeza + `/api/escena-ia` de un servidor de desarrollo).
 * Quien llama pone el tope de gasto: aquí cada ronda devuelve su coste estimado.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Escena } from "../../src/lib/globos3d/escena";
import type { LecturaFoto } from "../../src/lib/globos3d/lectura-foto";
import { encuadreDeLectura } from "../../src/lib/globos3d/encuadre-foto";
import { distanciaFormatos, escalonesDe, globosOrganicosPorFormato, type Escalones } from "../../src/lib/globos3d/mezcla-escena";
import { pesosDeLectura } from "../../src/lib/globos3d/mezcla-lectura";
import { refinarConFoto, type ResultadoRefinado } from "../../src/lib/globos3d/refinado/bucle";
import { crearEvaluadorDeRonda } from "../../src/lib/globos3d/refinado/evaluador";
import { pedirRondaHttp, pedirVeredictoHttp } from "../../src/components/tres-d/refinado-http";
import { embeberImagen } from "../../src/lib/rag/embeddings";
import { normalizarFoto } from "../../src/lib/taller/normalizar-foto";
import type { CapturadorSinCabeza } from "./lib-captura-sin-cabeza";

/** US$ por embedding de imagen (gemini-embedding-2, ~US$0,0001 cada una). */
export const COSTE_EMBEDDING_USD = 0.0001;

export type Medidas = {
  /** Coseno entre el embedding de la foto y el de la captura de la escena (más alto = más parecida). */
  similitud: number | null;
  escalones: Escalones;
  /** Distancia de variación total entre el reparto de tamaños (por formato) de lo orgánico de la escena y el de la lectura a mano (0 = igual). */
  distanciaMezcla: number | null;
  globos: Record<string, number>;
  captura: string | null;
};

export type RondaEval = { ronda: number; diferencias: Array<{ aspecto: string; descripcion: string; significativa: boolean }>; significativas: number | null; cambios: number; respuesta: string; motivo: string; despues: Medidas };

export type ResultadoRefinadoEval = {
  antes: Medidas;
  despues: Medidas;
  rondas: RondaEval[];
  motivo: ResultadoRefinado["motivo"];
  error?: string;
  costeRondasUsd: number;
  /** Lo que costó cada llamada a la ruta (una por ronda hecha). */
  costesPorRonda: number[];
  costeEmbeddingsUsd: number;
  /** Con el criterio de aceptación: el veredicto del servidor de cada ronda evaluada (parecido medido, motivo y coste). */
  veredictos: Array<{ ronda: number; aceptada: boolean; motivo: string | null; antes: number | null; despues: number | null }>;
  escenaFinal: Escena;
};

const coseno = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { s += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return na && nb ? s / Math.sqrt(na * nb) : 0;
};
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Los pesos por formato de lo orgánico de una lectura (el de las piezas orgánicas, parejo entre ellas), o null si no hay piezas orgánicas. */
export function formatosDeLectura(l: LecturaFoto): Record<string, number> | null {
  const piezas = l.piezas.filter((p) => p.tipo === "guirnalda_organica" || p.tipo === "columna_organica");
  if (!piezas.length) return null;
  const suma: Record<string, number> = {};
  for (const p of piezas) for (const [f, w] of Object.entries(pesosDeLectura(p as never, l.escala.altoImagenCm))) suma[f] = (suma[f] ?? 0) + w / piezas.length;
  return suma;
}

/** El reparto grande / mediano / chico de lo orgánico de una lectura. */
export const escalonesDeLectura = (l: LecturaFoto): Escalones | null => { const f = formatosDeLectura(l); return f ? escalonesDe(f) : null; };

export type ContextoMedida = {
  capturador: CapturadorSinCabeza;
  /** Vector del embedding de la foto (calculado una vez). */
  vectorFoto: number[];
  /** Los pesos por formato de la lectura a mano, contra los que se mide el reparto de tamaños (y la lectura de la IA, que da el encuadre). */
  meta: Record<string, number> | null;
  lectura: LecturaFoto;
  carpeta: string;
  prefijo: string;
  contarEmbeddings: () => void;
};

/** Mide una escena: la captura con la cámara de la foto, su parecido con la foto y su reparto de tamaños. */
export async function medirEscena(escena: Escena, etiqueta: string, c: ContextoMedida): Promise<Medidas> {
  const globos = globosOrganicosPorFormato(escena);
  const escalones = escalonesDe(globos);
  const distanciaMezcla = c.meta ? distanciaFormatos(globos, c.meta) : null;
  let similitud: number | null = null, captura: string | null = null;
  try {
    const foto = await c.capturador.capturar(escena, encuadreDeLectura(c.lectura));
    const bytes = new Uint8Array(Buffer.from(foto.base64, "base64"));
    mkdirSync(c.carpeta, { recursive: true });
    captura = path.join(c.carpeta, `${c.prefijo}-${etiqueta}.jpg`);
    writeFileSync(captura, bytes);
    similitud = r3(coseno(c.vectorFoto, await embeberImagen(bytes, "image/jpeg", { superficie: "exp/evaluar-refinado" })));
    c.contarEmbeddings();
  } catch (error) {
    console.log(`    (sin captura de ${etiqueta}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)})`);
  }
  return { similitud, escalones: { grandes: r3(escalones.grandes), medianos: r3(escalones.medianos), chicos: r3(escalones.chicos) }, distanciaMezcla, globos, captura };
}

/** El embedding de la foto como lo vería la comparación (1024 px). */
export async function vectorDeFoto(original: Uint8Array): Promise<number[]> {
  return embeberImagen(await normalizarFoto(original), "image/jpeg", { superficie: "exp/evaluar-refinado" });
}

/**
 * Corre el refinado sobre la escena armada de la foto: mide antes, hasta 2 rondas con la captura sin cabeza y la ruta real
 * del servidor, y mide después de cada ronda. `parar(gasto de esta foto)` se consulta antes de cada ronda (tope de gasto).
 */
export async function evaluarRefinado(entrada: { escena: Escena; foto: { mime: string; base64: string }; lectura: LecturaFoto; metaMezcla: Record<string, number> | null; original: Uint8Array; urlBase: string; capturador: CapturadorSinCabeza; carpeta: string; prefijo: string; maxRondas?: number; parar: (gastoDeEstaFoto: number) => boolean; criterio?: boolean }): Promise<ResultadoRefinadoEval> {
  let embeddings = 0;
  const contexto: ContextoMedida = { capturador: entrada.capturador, vectorFoto: await vectorDeFoto(entrada.original), meta: entrada.metaMezcla, lectura: entrada.lectura, carpeta: entrada.carpeta, prefijo: entrada.prefijo, contarEmbeddings: () => { embeddings += 1; } };
  embeddings += 1;
  const antes = await medirEscena(entrada.escena, "r0", contexto);
  let costeRondasUsd = 0;
  const costesPorRonda: number[] = [];
  const control = new AbortController();
  const resultado = await refinarConFoto(
    { escena: entrada.escena, foto: entrada.foto, lectura: entrada.lectura, encuadre: encuadreDeLectura(entrada.lectura) },
    {
      capturar: async (e, enc) => { if (entrada.parar(costeRondasUsd)) control.abort(); return entrada.capturador.capturar(e, enc); },
      pedir: async (cuerpo, signal) => {
        const r = await pedirRondaHttp(cuerpo, signal, {}, entrada.urlBase.replace(/\/$/, ""));
        if (r.ok) { const c = r.datos.uso?.costeEstimadoUsd ?? 0; costeRondasUsd += c; costesPorRonda.push(r3(c)); }
        return r;
      },
      // Con `criterio` la ronda pasa por el mismo veredicto del servidor que en el taller (la foto ya viene a 1024 px).
      ...(entrada.criterio ? { evaluar: crearEvaluadorDeRonda({ capturar: entrada.capturador.capturar, reducirFoto: async (f) => f, veredicto: pedirVeredictoHttp({}, entrada.urlBase.replace(/\/$/, "")) }) } : {}),
      alProgreso: ({ ronda }) => console.log(`    ronda ${ronda}…`),
      signal: control.signal,
      ...(entrada.maxRondas !== undefined ? { maxRondas: entrada.maxRondas } : {}),
    },
  );
  const rondas: RondaEval[] = [];
  for (const r of resultado.rondas) {
    const despuesDeRonda = await medirEscena(r.escena, `r${r.ronda}`, contexto);
    rondas.push({ ronda: r.ronda, diferencias: r.resultado.diferencias, significativas: r.resultado.significativas, cambios: r.cambios.length, respuesta: r.respuesta, motivo: r.resultado.motivo, despues: despuesDeRonda });
  }
  const despues = rondas.length ? rondas[rondas.length - 1]!.despues : antes;
  return { antes, despues, rondas, motivo: resultado.motivo, ...(resultado.error ? { error: resultado.error } : {}), costeRondasUsd: r3(costeRondasUsd), costesPorRonda, costeEmbeddingsUsd: r3(embeddings * COSTE_EMBEDDING_USD + resultado.evaluaciones.reduce((suma, e) => suma + e.veredicto.costeEstimadoUsd, 0)), veredictos: resultado.evaluaciones.map((e) => ({ ronda: e.ronda, aceptada: e.veredicto.aceptada, motivo: e.veredicto.motivo, antes: e.veredicto.similitud?.antes ?? null, despues: e.veredicto.similitud?.despues ?? null })), escenaFinal: resultado.escena };
}
