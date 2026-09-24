import "server-only";
import {
  isPythonAdapterError,
  llamarPythonPatronReferencia,
  type PythonPatronReferenciaElemento,
  type PythonPatronReferenciaInput,
  type PythonPatronReferenciaPista,
} from "@/lib/ia/nucleo/python-adapter";
import type { ImagenEtiquetada } from "@/lib/ia/nucleo/tipos";
import { ReferenceBlueprintV2Schema, type PatronColorReferencia, type ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";

/**
 * Patrón de color de las estructuras de globos de la foto (ADR-0028 §11).
 *
 * Corre después del análisis de Amaterasu, cuyo prompt sigue congelado: Python
 * lee la foto con sus propios prompt y esquema y devuelve una pista por
 * estructura; aquí solo se arma la petición con lo que el análisis ya encontró
 * y se guarda cada pista en su elemento (`appearance.patron_color`). Nada de
 * esto es comercial: al confirmar el plan las pistas viajan a Python, que
 * decide si las usa.
 *
 * Nunca rompe el análisis. Cualquier fallo (Python caído, deadline, respuesta
 * fuera de contrato) se registra con los ids de la petición y el blueprint sale
 * sin pistas: el plan cae al preset de cada estructura.
 */

/** Elementos por foto que admite `patron-referencia.v1`. */
const MAX_ELEMENTOS_POR_FOTO = 12;
/** Techo propio de la detección: va después del análisis, dentro del mismo `maxDuration` de la ruta. */
export const DEADLINE_PATRON_REFERENCIA_MS = 25_000;
/** Con menos tiempo que esto antes del vencimiento de la ruta no vale la pena llamar. */
const DEADLINE_MINIMO_MS = 3_000;
/** Holgura para serializar y responder después de la detección. */
const HOLGURA_RESPUESTA_MS = 2_000;

type MimeFoto = PythonPatronReferenciaInput["imagen"]["mimeType"];
const MIMES: ReadonlySet<string> = new Set<MimeFoto>(["image/png", "image/jpeg", "image/webp"]);

function esMimeFoto(mime: string): mime is MimeFoto {
  return MIMES.has(mime);
}

export type ContextoDeteccionPatron = {
  requestId: string;
  correlationId: string;
  signal?: AbortSignal;
  /** Epoch ms en que la ruta tiene que haber respondido; acota el deadline de la llamada. */
  vencimiento?: number;
};

/** Estructuras de globos aprobadas del blueprint, por la foto en la que aparecen. */
export function elementosParaDeteccion(blueprint: ReferenceBlueprintV2): Map<string, PythonPatronReferenciaElemento[]> {
  const porFoto = new Map<string, PythonPatronReferenciaElemento[]>();
  for (const elemento of blueprint.elements) {
    if (!elemento.approved || elemento.category !== "balloon_structure") continue;
    const lista = porFoto.get(elemento.source_image_id) ?? [];
    if (lista.length >= MAX_ELEMENTOS_POR_FOTO) continue;
    lista.push({
      elementId: elemento.element_id,
      tipo: elemento.visual_semantics?.structure_type ?? "desconocido",
      bbox: elemento.reference_bbox,
      coloresObservados: elemento.appearance.observed_colors,
    });
    porFoto.set(elemento.source_image_id, lista);
  }
  return porFoto;
}

function patronDePista(pista: PythonPatronReferenciaPista): PatronColorReferencia | undefined {
  if (pista.modo === "ninguno" || pista.colores.length === 0) return undefined;
  return {
    modo: pista.modo,
    colores: pista.colores,
    ...(pista.globos_por_racimo === undefined ? {} : { globos_por_racimo: pista.globos_por_racimo }),
    ...(pista.pesos === undefined ? {} : { pesos: pista.pesos }),
    confianza: pista.confianza,
  };
}

/**
 * Copia del blueprint con cada pista en su elemento. Una pista "ninguno" o de un
 * elemento que no existe no deja nada. Nunca modifica el blueprint recibido:
 * puede ser el resultado cacheado del análisis.
 */
export function adjuntarPistasPatron(blueprint: ReferenceBlueprintV2, pistas: readonly PythonPatronReferenciaPista[]): ReferenceBlueprintV2 {
  const patrones = new Map<string, PatronColorReferencia>();
  for (const pista of pistas) {
    const patron = patronDePista(pista);
    if (patron) patrones.set(pista.element_id, patron);
  }
  if (patrones.size === 0) return blueprint;
  return {
    ...blueprint,
    elements: blueprint.elements.map((elemento) => {
      const patron = patrones.get(elemento.element_id);
      return patron ? { ...elemento, appearance: { ...elemento.appearance, patron_color: patron } } : elemento;
    }),
  };
}

function deadlineDeteccion(vencimiento: number | undefined): number | undefined {
  if (vencimiento === undefined) return DEADLINE_PATRON_REFERENCIA_MS;
  const restante = vencimiento - Date.now() - HOLGURA_RESPUESTA_MS;
  return restante < DEADLINE_MINIMO_MS ? undefined : Math.min(DEADLINE_PATRON_REFERENCIA_MS, restante);
}

function registrarOmision(contexto: ContextoDeteccionPatron, imageId: string, motivo: Record<string, unknown>): void {
  console.warn("[references/analyze] detección de patrón omitida", JSON.stringify({
    request_id: contexto.requestId,
    correlation_id: contexto.correlationId,
    image_id: imageId,
    ...motivo,
  }));
}

async function pistasDeFoto(
  referencia: ImagenEtiquetada & { mime: MimeFoto },
  elementos: PythonPatronReferenciaElemento[],
  contexto: ContextoDeteccionPatron,
): Promise<PythonPatronReferenciaPista[]> {
  const deadlineMs = deadlineDeteccion(contexto.vencimiento);
  if (deadlineMs === undefined) {
    registrarOmision(contexto, referencia.id, { motivo: "sin_tiempo" });
    return [];
  }
  try {
    const resultado = await llamarPythonPatronReferencia({
      imagen: { mimeType: referencia.mime, dataBase64: referencia.base64 },
      elementos,
      requestId: contexto.requestId,
      correlationId: contexto.correlationId,
      deadlineMs,
      ...(contexto.signal ? { parentSignal: contexto.signal } : {}),
    });
    // Modelo, versión del prompt y uso reportado por el proveedor (AGENTS.md).
    console.info("[references/analyze] patrón de color detectado", JSON.stringify({
      request_id: contexto.requestId,
      correlation_id: contexto.correlationId,
      image_id: referencia.id,
      modelo: resultado.modelo,
      prompt_version: resultado.promptVersion,
      usage: resultado.usage,
      elementos: elementos.length,
      pistas: resultado.pistas.filter((pista) => pista.modo !== "ninguno").length,
    }));
    return resultado.pistas;
  } catch (error) {
    registrarOmision(contexto, referencia.id, isPythonAdapterError(error)
      ? { code: error.code, domain_code: error.domainCode ?? null, provider_detail: error.providerDetail ?? null }
      : { code: "ERROR_INESPERADO", mensaje: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) });
    return [];
  }
}

/**
 * Pide a Python el patrón de las estructuras de globos de cada foto (una
 * llamada por foto con estructuras, en paralelo: son a lo sumo tres) y devuelve
 * el blueprint con las pistas. Sin estructuras de globos no llama.
 */
export async function detectarPatronesReferencia(
  blueprint: ReferenceBlueprintV2,
  referencias: readonly ImagenEtiquetada[],
  contexto: ContextoDeteccionPatron,
): Promise<ReferenceBlueprintV2> {
  const porFoto = elementosParaDeteccion(blueprint);
  const llamadas = [...porFoto].flatMap(([imageId, elementos]) => {
    const referencia = referencias.find((item) => item.id === imageId);
    if (!referencia || !esMimeFoto(referencia.mime)) return [];
    return [pistasDeFoto({ ...referencia, mime: referencia.mime }, elementos, contexto)];
  });
  if (llamadas.length === 0) return blueprint;
  const pistas = (await Promise.all(llamadas)).flat();
  const conPistas = adjuntarPistasPatron(blueprint, pistas);
  if (conPistas === blueprint) return blueprint;
  // El blueprint viaja después al chat y a la generación, que lo validan con
  // este esquema: uno que no lo pase aquí no se entrega.
  const validado = ReferenceBlueprintV2Schema.safeParse(conPistas);
  if (!validado.success) {
    registrarOmision(contexto, "*", { code: "BLUEPRINT_INVALIDO", issues: validado.error.issues.slice(0, 3).map((issue) => issue.path.join(".")) });
    return blueprint;
  }
  return validado.data;
}
