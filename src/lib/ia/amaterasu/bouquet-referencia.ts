import "server-only";
import { createHash } from "node:crypto";
import {
  isPythonAdapterError,
  llamarPythonBouquetReferencia,
  type PythonBouquetReferenciaElemento,
  type PythonBouquetReferenciaInput,
  type PythonBouquetReferenciaLectura,
} from "@/lib/ia/nucleo/python-adapter";
import type { ImagenEtiquetada } from "@/lib/ia/nucleo/tipos";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import type { LecturaArmado } from "@/lib/plan/armado-bouquet";
import { identificarEstructuraOficial } from "@/lib/plan/estructuras-oficiales";
import { crearCacheLectura, leerCompartido, type CacheLectura } from "./deteccion-compartida";

/**
 * Armado de los bouquets de la foto (ADR-0030).
 *
 * Corre después del análisis de Amaterasu, en paralelo con la lectura del
 * patrón de color: Python lee cada bouquet con el prompt y la validación del
 * submódulo `estructuras/bouquet.py` y devuelve cómo está armado; aquí solo se
 * arma la petición con los bouquets que el análisis ya encontró y se guarda
 * cada lectura en su elemento (`appearance.armado_bouquet`). Nada de esto es
 * comercial: al confirmar el plan las lecturas viajan a Python, que decide si
 * las usa sin cambiar lo que se compra.
 *
 * Nunca rompe el análisis: cualquier fallo se registra con los ids de la
 * petición y el blueprint sale sin lecturas.
 */

const MAX_ELEMENTOS_POR_FOTO = 12;
/** Techo propio de la lectura: corre después del análisis, dentro del mismo `maxDuration` de la ruta. */
export const DEADLINE_BOUQUET_REFERENCIA_MS = 25_000;

type MimeFoto = PythonBouquetReferenciaInput["imagen"]["mimeType"];
const MIMES: ReadonlySet<string> = new Set<MimeFoto>(["image/png", "image/jpeg", "image/webp"]);

function esMimeFoto(mime: string): mime is MimeFoto {
  return MIMES.has(mime);
}

export type CacheLecturaBouquet = CacheLectura<PythonBouquetReferenciaLectura>;

export function crearCacheLecturaBouquet(maximo?: number): CacheLecturaBouquet {
  return crearCacheLectura<PythonBouquetReferenciaLectura>(maximo);
}

const CACHE_DEL_PROCESO = crearCacheLecturaBouquet();

export type ContextoLecturaBouquet = {
  requestId: string;
  correlationId: string;
  signal?: AbortSignal;
  /** Epoch ms en que la ruta tiene que haber respondido; acota el deadline de la llamada. */
  vencimiento?: number;
  /** "Reintentar" de la UI (`sin_cache`): no reutiliza una lectura guardada. */
  sinCache?: boolean;
  /** Solo pruebas: una caché propia en lugar de la del proceso. */
  cache?: CacheLecturaBouquet;
};

/**
 * Bouquets aprobados del blueprint, por la foto en la que aparecen. Es la misma
 * decisión que toma el chat al proponer la estructura oficial
 * (`identificarEstructuraOficial` sobre el tipo y la forma detectados).
 *
 * También los centros de mesa (2026-09-25): el reconocedor v16 llama "centro de
 * mesa" a las piezas chicas con pocos globos y duda entre corridas sobre la
 * misma foto (una pieza de 3 látex con un "80" salió bouquet una vez y centro
 * de mesa otra). Leerlos cuesta una llamada más por foto con centros de mesa;
 * si la pieza termina como bouquet (por el chat o por el cliente), la foto
 * manda con su cantidad y sus colores. Si queda como centro de mesa, la lectura
 * no se usa: `_assign_assemblies` solo mira bouquets.
 */
export function elementosBouquet(blueprint: ReferenceBlueprintV2): Map<string, PythonBouquetReferenciaElemento[]> {
  const porFoto = new Map<string, PythonBouquetReferenciaElemento[]>();
  for (const elemento of blueprint.elements) {
    const semantica = elemento.visual_semantics;
    if (!elemento.approved || elemento.category !== "balloon_structure" || !semantica) continue;
    const oficial = identificarEstructuraOficial({
      tipo: semantica.structure_type,
      densidad: semantica.density,
      ubicacion: semantica.placement,
      nombre: elemento.appearance.shape,
    });
    if (oficial?.id !== "bouquet" && oficial?.id !== "centro_mesa") continue;
    const lista = porFoto.get(elemento.source_image_id) ?? [];
    if (lista.length >= MAX_ELEMENTOS_POR_FOTO) continue;
    lista.push({
      elementId: elemento.element_id,
      bbox: elemento.reference_bbox,
      coloresObservados: elemento.appearance.observed_colors,
    });
    porFoto.set(elemento.source_image_id, lista);
  }
  return porFoto;
}

/** Copia del blueprint con cada lectura en su elemento; nunca modifica el recibido. */
export function adjuntarLecturasBouquet(blueprint: ReferenceBlueprintV2, lecturas: readonly PythonBouquetReferenciaLectura[]): ReferenceBlueprintV2 {
  const porElemento = new Map<string, LecturaArmado>();
  for (const { element_id, ...lectura } of lecturas) porElemento.set(element_id, lectura);
  if (porElemento.size === 0) return blueprint;
  return {
    ...blueprint,
    elements: blueprint.elements.map((elemento) => {
      const lectura = porElemento.get(elemento.element_id);
      return lectura ? { ...elemento, appearance: { ...elemento.appearance, armado_bouquet: lectura } } : elemento;
    }),
  };
}

/**
 * `destino` con el armado que `fuente` leyó en cada elemento. Las dos lecturas
 * de la foto corren en paralelo sobre el mismo blueprint del análisis y cada una
 * devuelve su propia copia; esto las junta sin tocar ninguna.
 */
export function conArmadosDe(destino: ReferenceBlueprintV2, fuente: ReferenceBlueprintV2): ReferenceBlueprintV2 {
  const armados = new Map(fuente.elements.flatMap((elemento) => elemento.appearance.armado_bouquet ? [[elemento.element_id, elemento.appearance.armado_bouquet] as const] : []));
  if (armados.size === 0) return destino;
  return {
    ...destino,
    elements: destino.elements.map((elemento) => {
      const armado = armados.get(elemento.element_id);
      return armado ? { ...elemento, appearance: { ...elemento.appearance, armado_bouquet: armado } } : elemento;
    }),
  };
}

function registrarOmision(contexto: ContextoLecturaBouquet, imageId: string, motivo: Record<string, unknown>): void {
  console.warn("[references/analyze] lectura de bouquet omitida", JSON.stringify({
    request_id: contexto.requestId,
    correlation_id: contexto.correlationId,
    image_id: imageId,
    ...motivo,
  }));
}

function claveLectura(referencia: ImagenEtiquetada & { mime: MimeFoto }, elementos: readonly PythonBouquetReferenciaElemento[]): string {
  return createHash("sha256").update(referencia.mime).update("\0").update(referencia.base64).update("\0").update(JSON.stringify(elementos)).digest("hex");
}

function lecturasDeFoto(
  referencia: ImagenEtiquetada & { mime: MimeFoto },
  elementos: PythonBouquetReferenciaElemento[],
  contexto: ContextoLecturaBouquet,
): Promise<PythonBouquetReferenciaLectura[]> {
  return leerCompartido<PythonBouquetReferenciaLectura>({
    cache: contexto.cache ?? CACHE_DEL_PROCESO,
    clave: claveLectura(referencia, elementos),
    sinCache: contexto.sinCache,
    signal: contexto.signal,
    vencimiento: contexto.vencimiento,
    techoMs: DEADLINE_BOUQUET_REFERENCIA_MS,
    llamar: async (deadlineMs, signal) => {
      const resultado = await llamarPythonBouquetReferencia({
        imagen: { mimeType: referencia.mime, dataBase64: referencia.base64 },
        elementos,
        requestId: contexto.requestId,
        correlationId: contexto.correlationId,
        deadlineMs,
        parentSignal: signal,
      });
      // Modelo, versión del prompt y uso reportado por el proveedor (AGENTS.md).
      console.info("[references/analyze] armado de bouquet leído", JSON.stringify({
        request_id: contexto.requestId,
        correlation_id: contexto.correlationId,
        image_id: referencia.id,
        modelo: resultado.modelo,
        prompt_version: resultado.promptVersion,
        usage: resultado.usage,
        elementos: elementos.length,
        lecturas: resultado.lecturas.length,
      }));
      return resultado.lecturas;
    },
    alOmitir: (motivo) => registrarOmision(contexto, referencia.id, "motivo" in motivo
      ? motivo
      : isPythonAdapterError(motivo.error)
        ? { code: motivo.error.code, domain_code: motivo.error.domainCode ?? null, provider_detail: motivo.error.providerDetail ?? null }
        : { code: "ERROR_INESPERADO", mensaje: motivo.error instanceof Error ? motivo.error.message.slice(0, 200) : String(motivo.error).slice(0, 200) }),
  });
}

/**
 * Lee el armado de los bouquets de cada foto (una llamada por foto con
 * bouquets, en paralelo) y devuelve el blueprint con las lecturas. Sin bouquets
 * no llama.
 */
export async function leerArmadosReferencia(
  blueprint: ReferenceBlueprintV2,
  referencias: readonly ImagenEtiquetada[],
  contexto: ContextoLecturaBouquet,
): Promise<ReferenceBlueprintV2> {
  const llamadas = [...elementosBouquet(blueprint)].flatMap(([imageId, elementos]) => {
    const referencia = referencias.find((item) => item.id === imageId);
    if (!referencia || !esMimeFoto(referencia.mime)) return [];
    return [lecturasDeFoto({ ...referencia, mime: referencia.mime }, elementos, contexto)];
  });
  if (llamadas.length === 0) return blueprint;
  const conLecturas = adjuntarLecturasBouquet(blueprint, (await Promise.all(llamadas)).flat());
  if (conLecturas === blueprint) return blueprint;
  // El blueprint viaja después al chat y a la generación, que lo validan con
  // este esquema: uno que no lo pase aquí no se entrega.
  const validado = ReferenceBlueprintV2Schema.safeParse(conLecturas);
  if (!validado.success) {
    registrarOmision(contexto, "*", { code: "BLUEPRINT_INVALIDO", issues: validado.error.issues.slice(0, 3).map((issue) => issue.path.join(".")) });
    return blueprint;
  }
  return validado.data;
}
