import "server-only";
import { createHash } from "node:crypto";
import {
  isPythonAdapterError,
  llamarPythonGuirnaldaReferencia,
  type PythonGuirnaldaReferenciaElemento,
  type PythonGuirnaldaReferenciaInput,
  type PythonGuirnaldaReferenciaLectura,
  type PythonGuirnaldaReferenciaOtra,
} from "@/lib/ia/nucleo/python-adapter";
import type { ImagenEtiquetada } from "@/lib/ia/nucleo/tipos";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import type { LecturaGuirnalda } from "@/lib/plan/armado-guirnalda";
import { identificarEstructuraOficial } from "@/lib/plan/estructuras-oficiales";
import { crearCacheLectura, leerCompartido, type CacheLectura } from "./deteccion-compartida";

/**
 * Cómo está armada cada guirnalda de la foto (ADR-0032, E4).
 *
 * Corre después del análisis de Amaterasu, en paralelo con las demás lecturas:
 * Python lee cada guirnalda con el prompt y la validación del submódulo
 * `estructuras/guirnalda.py` y devuelve soporte, forma, racimos, relleno y
 * remates; aquí solo se arma la petición con lo que el análisis ya encontró y
 * se guarda cada lectura en su elemento (`appearance.armado_guirnalda`). Nada
 * de esto es comercial: al confirmar el plan las lecturas viajan a Python, que
 * decide si las usa y nunca cambia con ellas lo que se compra.
 *
 * Se leen las guirnaldas y también los arcos y semiarcos (una guirnalda
 * colgada puede salir del reconocedor como arco; si no lo es, la lectura trae
 * confianza 0 y no se usa); las demás piezas de globos de la foto viajan como
 * posibles anfitrionas de una guirnalda que va sobre ellas; un arco o semiarco
 * que se lee también puede serlo (revisión 6/13: Python y el adaptador aceptan
 * la anfitriona de las dos listas, nunca la propia guirnalda). Nunca rompe el
 * análisis: cualquier fallo se registra con los ids de la petición y el
 * blueprint sale sin lecturas.
 */

const MAX_ELEMENTOS_POR_FOTO = 12;
/** Techo propio de la lectura: corre después del análisis, dentro del mismo `maxDuration` de la ruta. */
export const DEADLINE_GUIRNALDA_REFERENCIA_MS = 25_000;
/** Estructuras oficiales que se leen como guirnalda posible. */
const LEIDAS = new Set(["guirnalda", "arco", "arco_asimetrico", "arco_no_denso", "semiarco", "semiarco_asimetrico"]);

type MimeFoto = PythonGuirnaldaReferenciaInput["imagen"]["mimeType"];
const MIMES: ReadonlySet<string> = new Set<MimeFoto>(["image/png", "image/jpeg", "image/webp"]);

function esMimeFoto(mime: string): mime is MimeFoto {
  return MIMES.has(mime);
}

export type CacheLecturaGuirnalda = CacheLectura<PythonGuirnaldaReferenciaLectura>;

export function crearCacheLecturaGuirnalda(maximo?: number): CacheLecturaGuirnalda {
  return crearCacheLectura<PythonGuirnaldaReferenciaLectura>(maximo);
}

const CACHE_DEL_PROCESO = crearCacheLecturaGuirnalda();

export type ContextoLecturaGuirnalda = {
  requestId: string;
  correlationId: string;
  signal?: AbortSignal;
  /** Epoch ms en que la ruta tiene que haber respondido; acota el deadline de la llamada. */
  vencimiento?: number;
  /** "Reintentar" de la UI (`sin_cache`): no reutiliza una lectura guardada. */
  sinCache?: boolean;
  /** Solo pruebas: una caché propia en lugar de la del proceso. */
  cache?: CacheLecturaGuirnalda;
};

export type PeticionGuirnaldasFoto = { elementos: PythonGuirnaldaReferenciaElemento[]; otras: PythonGuirnaldaReferenciaOtra[] };

/**
 * Por foto, las guirnaldas (y arcos y semiarcos) aprobadas a leer y las demás
 * estructuras de globos, que pueden sostener una. Es la misma decisión que
 * toma el chat (`identificarEstructuraOficial`); un techo de globos no es una
 * guirnalda por partes. Una foto sin guirnaldas, arcos ni semiarcos no aparece.
 */
export function elementosGuirnalda(blueprint: ReferenceBlueprintV2): Map<string, PeticionGuirnaldasFoto> {
  const porFoto = new Map<string, PeticionGuirnaldasFoto>();
  for (const elemento of blueprint.elements) {
    const semantica = elemento.visual_semantics;
    if (!elemento.approved || elemento.category !== "balloon_structure" || !semantica) continue;
    const oficial = identificarEstructuraOficial({
      tipo: semantica.structure_type,
      densidad: semantica.density,
      ubicacion: semantica.placement,
      nombre: elemento.appearance.shape,
    });
    const peticion = porFoto.get(elemento.source_image_id) ?? { elementos: [], otras: [] };
    if (oficial && LEIDAS.has(oficial.id)) {
      if (peticion.elementos.length >= MAX_ELEMENTOS_POR_FOTO) continue;
      peticion.elementos.push({ elementId: elemento.element_id, bbox: elemento.reference_bbox, coloresObservados: elemento.appearance.observed_colors });
    } else {
      if (peticion.otras.length >= MAX_ELEMENTOS_POR_FOTO) continue;
      peticion.otras.push({ elementId: elemento.element_id, tipo: semantica.structure_type, bbox: elemento.reference_bbox });
    }
    porFoto.set(elemento.source_image_id, peticion);
  }
  for (const [imageId, peticion] of porFoto) if (peticion.elementos.length === 0) porFoto.delete(imageId);
  return porFoto;
}

function conGuirnaldas(blueprint: ReferenceBlueprintV2, lecturas: ReadonlyMap<string, LecturaGuirnalda>): ReferenceBlueprintV2 {
  if (lecturas.size === 0) return blueprint;
  return {
    ...blueprint,
    elements: blueprint.elements.map((elemento) => {
      const lectura = lecturas.get(elemento.element_id);
      return lectura ? { ...elemento, appearance: { ...elemento.appearance, armado_guirnalda: lectura } } : elemento;
    }),
  };
}

/** Copia del blueprint con cada lectura en su elemento; nunca modifica el recibido. */
export function adjuntarLecturasGuirnalda(blueprint: ReferenceBlueprintV2, lecturas: readonly PythonGuirnaldaReferenciaLectura[]): ReferenceBlueprintV2 {
  return conGuirnaldas(blueprint, new Map(lecturas.map(({ element_id, ...lectura }) => [element_id, lectura] as const)));
}

/**
 * `destino` con la lectura de guirnalda que `fuente` tiene en cada elemento.
 * Las lecturas de la foto corren en paralelo sobre el mismo blueprint y cada
 * una devuelve su copia; esto las junta. Sin lecturas en `fuente` devuelve
 * `destino` tal cual (el mismo objeto).
 */
export function conGuirnaldasDe(destino: ReferenceBlueprintV2, fuente: ReferenceBlueprintV2): ReferenceBlueprintV2 {
  return conGuirnaldas(destino, new Map(fuente.elements.flatMap((elemento) => elemento.appearance.armado_guirnalda ? [[elemento.element_id, elemento.appearance.armado_guirnalda] as const] : [])));
}

function registrarOmision(contexto: ContextoLecturaGuirnalda, imageId: string, motivo: Record<string, unknown>): void {
  console.warn("[references/analyze] lectura de guirnalda omitida", JSON.stringify({
    request_id: contexto.requestId,
    correlation_id: contexto.correlationId,
    image_id: imageId,
    ...motivo,
  }));
}

/** La petición a Python entera: la foto (bytes y tipo) y lo que se le pregunta de ella. */
function claveLectura(referencia: ImagenEtiquetada & { mime: MimeFoto }, peticion: PeticionGuirnaldasFoto): string {
  return createHash("sha256").update(referencia.mime).update("\0").update(referencia.base64).update("\0").update(JSON.stringify(peticion)).digest("hex");
}

function lecturasDeFoto(
  referencia: ImagenEtiquetada & { mime: MimeFoto },
  peticion: PeticionGuirnaldasFoto,
  contexto: ContextoLecturaGuirnalda,
): Promise<PythonGuirnaldaReferenciaLectura[]> {
  return leerCompartido<PythonGuirnaldaReferenciaLectura>({
    cache: contexto.cache ?? CACHE_DEL_PROCESO,
    clave: claveLectura(referencia, peticion),
    sinCache: contexto.sinCache,
    signal: contexto.signal,
    vencimiento: contexto.vencimiento,
    techoMs: DEADLINE_GUIRNALDA_REFERENCIA_MS,
    llamar: async (deadlineMs, signal) => {
      const resultado = await llamarPythonGuirnaldaReferencia({
        imagen: { mimeType: referencia.mime, dataBase64: referencia.base64 },
        elementos: peticion.elementos,
        otras: peticion.otras,
        requestId: contexto.requestId,
        correlationId: contexto.correlationId,
        deadlineMs,
        parentSignal: signal,
      });
      // Modelo, versión del prompt y uso reportado por el proveedor (AGENTS.md).
      console.info("[references/analyze] guirnalda leída", JSON.stringify({
        request_id: contexto.requestId,
        correlation_id: contexto.correlationId,
        image_id: referencia.id,
        modelo: resultado.modelo,
        prompt_version: resultado.promptVersion,
        usage: resultado.usage,
        elementos: peticion.elementos.length,
        otras: peticion.otras.length,
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
 * Lee cómo están armadas las guirnaldas de cada foto (una llamada por foto con
 * guirnaldas, arcos o semiarcos, en paralelo) y devuelve el blueprint con las
 * lecturas. Sin ellas no llama; ante un fallo devuelve el blueprint recibido.
 */
export async function leerGuirnaldasReferencia(
  blueprint: ReferenceBlueprintV2,
  referencias: readonly ImagenEtiquetada[],
  contexto: ContextoLecturaGuirnalda,
): Promise<ReferenceBlueprintV2> {
  const llamadas = [...elementosGuirnalda(blueprint)].flatMap(([imageId, peticion]) => {
    const referencia = referencias.find((item) => item.id === imageId);
    if (!referencia || !esMimeFoto(referencia.mime)) return [];
    return [lecturasDeFoto({ ...referencia, mime: referencia.mime }, peticion, contexto)];
  });
  if (llamadas.length === 0) return blueprint;
  const conLecturas = adjuntarLecturasGuirnalda(blueprint, (await Promise.all(llamadas)).flat());
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
