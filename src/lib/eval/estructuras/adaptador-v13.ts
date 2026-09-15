import { createHash } from "node:crypto";
import { analizarReferenciasV2, type PaseObservado } from "@/lib/ia/analizar-referencias-v2";
import { mergeCandidates, object, parseCandidates } from "@/lib/ia/candidatos-referencia";
import { stableElementId } from "@/lib/ia/reference-blueprint";
import type { ChatPort } from "@/lib/ia/tipos";
import type { DeteccionV1 } from "./prediccion";
import type { Analizador, ItemSuite, PaseResultado, ResultadoAnalisis } from "./runner";

/**
 * Adapter that runs the production v13 recognizer (`analizarReferenciasV2`,
 * perceptual mode, as /api/references/analyze calls it) for the runner.
 *
 * The blueprint merges detector types (hoop→arco, sculpture/bouquet/cluster→kit),
 * so detections are rebuilt from the observed raw tool arguments with the same
 * production parsers (`parseCandidates`, `mergeCandidates`) and paired by index
 * with the blueprint elements. Any drift between both makes the analysis fail
 * loudly instead of producing silently wrong predictions.
 */

const ID_IMAGEN = "REF_01";

export type ImagenLeida = { base64: string; mime: "image/jpeg" | "image/png" | "image/webp" };

export function detectarDetecciones(
  pasesObservados: readonly PaseObservado[],
  elementos: ReadonlyArray<{ element_id: string; approved: boolean; reference_bbox: DeteccionV1["bbox"]; visual_semantics?: unknown }>,
): DeteccionV1[] {
  const ultimoValido = (capacidad: PaseObservado["capacidad"]) =>
    [...pasesObservados].reverse().find((pase) => pase.capacidad === capacidad && pase.args !== null)?.args ?? null;
  const inventario = ultimoValido("analisis_referencia_inventario");
  if (!inventario) throw new Error("adaptador v13: no hay inventario válido observado para un análisis ok");
  // A twice-malformed audit is skipped by production with `{ images: [] }`.
  const auditoria = ultimoValido("analisis_referencia_auditoria") ?? { images: [] };
  // Single-image suites: production maps every image id to REF_01 in that case.
  const candidatosDe = (raw: Record<string, unknown>) => (Array.isArray(raw.images) ? raw.images : []).flatMap((valor) => parseCandidates(ID_IMAGEN, object(valor)));
  const candidatos = mergeCandidates(candidatosDe(inventario), candidatosDe(auditoria));
  if (candidatos.length !== elementos.length) {
    throw new Error(`adaptador v13: ${candidatos.length} candidatos frente a ${elementos.length} elementos del blueprint`);
  }
  return elementos.flatMap((elemento, indice): DeteccionV1[] => {
    const candidato = candidatos[indice]!;
    if (elemento.element_id !== stableElementId(ID_IMAGEN, indice)) throw new Error(`adaptador v13: id ${elemento.element_id} fuera de orden en ${indice}`);
    const mismaCaja = (["x", "y", "width", "height"] as const).every((eje) => Math.abs(candidato.reference_bbox[eje] - elemento.reference_bbox[eje]) < 1e-9);
    if (!mismaCaja) throw new Error(`adaptador v13: caja distinta en ${elemento.element_id}`);
    // Same rule as production semantics: approved balloon structures with a typed structure.
    if (!elemento.approved || !candidato.structure || !elemento.visual_semantics) return [];
    return [{ elementId: elemento.element_id, bbox: { ...elemento.reference_bbox }, structure: candidato.structure }];
  });
}

export function crearAnalizadorV13(dependencias: {
  chat: ChatPort;
  leerImagen: (item: ItemSuite) => Promise<ImagenLeida>;
  /** Stores the raw provider output privately (never in git) and returns its sha256. */
  guardarSalidaCruda: (contenido: string) => Promise<string>;
}): Analizador {
  return async (item, signal): Promise<ResultadoAnalisis> => {
    const imagen = await dependencias.leerImagen(item);
    const real = createHash("sha256").update(Buffer.from(imagen.base64, "base64")).digest("hex");
    if (real !== item.image_sha256) throw new Error(`adaptador v13: la imagen leída no coincide con ${item.image_sha256.slice(0, 12)}`);
    const observados: PaseObservado[] = [];
    const inicio = Date.now();
    const aPases = (): PaseResultado[] => observados.map((pase) => ({
      capacidad: pase.capacidad,
      intento: pase.intento,
      ms: pase.ms,
      uso: { entrada: pase.uso.entrada, salida: pase.uso.salida, pensamiento: pase.uso.pensamiento ?? 0, cacheados: pase.uso.cacheados ?? 0 },
      ...(pase.finishReason ? { finishReason: pase.finishReason } : {}),
      malformado: pase.args === null,
    }));
    let resultado;
    try {
      resultado = await analizarReferenciasV2(
        dependencias.chat,
        [{ id: ID_IMAGEN, mime: imagen.mime, base64: imagen.base64, descripcion: "Evaluation reference image." }],
        [],
        "perceptual",
        { superficie: "evaluacion/estructuras" },
        signal,
        { forzarNuevoAnalisis: true, observarPase: (pase) => { observados.push(pase); } },
      );
    } catch (error) {
      const nombre = error instanceof Error ? error.name : "";
      const causa = signal.aborted ? (signal.reason instanceof Error && signal.reason.name === "TimeoutError" ? "timeout" : "cancelado") : nombre === "TimeoutError" ? "timeout" : "error";
      return { resultado: causa, pases: aPases(), msTotal: Date.now() - inicio };
    }
    const detecciones = detectarDetecciones(observados, resultado.blueprint.elements);
    const crudo = JSON.stringify({ pases: observados.map((pase) => ({ capacidad: pase.capacidad, intento: pase.intento, args: pase.args })) });
    const rawOutputSha256 = await dependencias.guardarSalidaCruda(crudo);
    return { resultado: "ok", detecciones, pases: aPases(), rawOutputSha256, msTotal: Date.now() - inicio };
  };
}
