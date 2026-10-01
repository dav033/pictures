import "server-only";
import { createHash } from "node:crypto";
import {
  isPythonAdapterError,
  llamarPythonConteoReferencia,
  type PythonConteoReferenciaElemento,
  type PythonConteoReferenciaInput,
  type PythonConteoReferenciaLectura,
} from "@/lib/ia/nucleo/python-adapter";
import type { ImagenEtiquetada } from "@/lib/ia/nucleo/tipos";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import type { LecturaConteo } from "@/lib/plan/conteo-referencia";
import { identificarEstructuraOficial } from "@/lib/plan/estructuras-oficiales";
import { crearCacheLectura, leerCompartido, type CacheLectura } from "./deteccion-compartida";

/**
 * Conteo de globos de cada pieza de la foto (ADR-0031, E1).
 *
 * Corre después del análisis de Amaterasu, en paralelo con las lecturas del
 * patrón y del armado del bouquet: Python cuenta cada estructura de globos con
 * el prompt de `conteo_referencia.py` y las reglas por tipo del registro
 * (`estructuras/<tipo>.py`, `como_contar`); aquí solo se arma la petición con lo
 * que el análisis ya encontró y se guarda cada lectura en su elemento
 * (`appearance.conteo`). Nada de esto es comercial y ningún plan lo usa todavía.
 *
 * Nunca rompe el análisis: cualquier fallo se registra con los ids de la
 * petición y el blueprint sale sin lecturas.
 */

/** Elementos por foto que admite `conteo-referencia.v1`. */
const MAX_ELEMENTOS_POR_FOTO = 12;
/** Tope de `piezas` en `conteo-referencia.v1` (el de `quantity` del blueprint). */
const MAX_PIEZAS = 999;
/** Techo propio de la lectura: corre después del análisis, dentro del mismo `maxDuration` de la ruta. */
export const DEADLINE_CONTEO_REFERENCIA_MS = 25_000;

type MimeFoto = PythonConteoReferenciaInput["imagen"]["mimeType"];
const MIMES: ReadonlySet<string> = new Set<MimeFoto>(["image/png", "image/jpeg", "image/webp"]);

function esMimeFoto(mime: string): mime is MimeFoto {
  return MIMES.has(mime);
}

export type CacheLecturaConteo = CacheLectura<PythonConteoReferenciaLectura>;

export function crearCacheLecturaConteo(maximo?: number): CacheLecturaConteo {
  return crearCacheLectura<PythonConteoReferenciaLectura>(maximo);
}

const CACHE_DEL_PROCESO = crearCacheLecturaConteo();

export type ContextoLecturaConteo = {
  requestId: string;
  correlationId: string;
  signal?: AbortSignal;
  /** Epoch ms en que la ruta tiene que haber respondido; acota el deadline de la llamada. */
  vencimiento?: number;
  /** "Reintentar" de la UI (`sin_cache`): no reutiliza una lectura guardada. */
  sinCache?: boolean;
  /** Solo pruebas: una caché propia en lugar de la del proceso. */
  cache?: CacheLecturaConteo;
};

/** Piezas iguales que representa el elemento ("2 columnas"), solo si son más de una. */
function piezasDe(elemento: ReferenceBlueprintV2["elements"][number]): number | undefined {
  if (elemento.quantity_semantics !== "physical_instances") return undefined;
  const piezas = Math.min(elemento.quantity.max, MAX_PIEZAS);
  return piezas > 1 ? piezas : undefined;
}

/**
 * Todas las estructuras de globos aprobadas del blueprint, por la foto en la que
 * aparecen: arcos, semiarcos, columnas, guirnaldas, paredes, centros de mesa,
 * techos, bouquets, figuras y kits. Cada una lleva su tipo y la estructura
 * oficial que le daría el chat (la misma `identificarEstructuraOficial`), para
 * que Python elija cómo contarla.
 */
export function elementosConteo(blueprint: ReferenceBlueprintV2): Map<string, PythonConteoReferenciaElemento[]> {
  const porFoto = new Map<string, PythonConteoReferenciaElemento[]>();
  for (const elemento of blueprint.elements) {
    if (!elemento.approved || elemento.category !== "balloon_structure") continue;
    const lista = porFoto.get(elemento.source_image_id) ?? [];
    if (lista.length >= MAX_ELEMENTOS_POR_FOTO) continue;
    const semantica = elemento.visual_semantics;
    const oficial = semantica
      ? identificarEstructuraOficial({
          tipo: semantica.structure_type,
          densidad: semantica.density,
          ubicacion: semantica.placement,
          nombre: elemento.appearance.shape,
        })
      : undefined;
    const piezas = piezasDe(elemento);
    lista.push({
      elementId: elemento.element_id,
      tipo: semantica?.structure_type ?? "desconocido",
      ...(oficial ? { estructuraOficial: oficial.id } : {}),
      bbox: elemento.reference_bbox,
      ...(piezas === undefined ? {} : { piezas }),
    });
    porFoto.set(elemento.source_image_id, lista);
  }
  return porFoto;
}

function conteoPorElemento(elementos: ReferenceBlueprintV2["elements"]): Map<string, LecturaConteo> {
  return new Map(elementos.flatMap((elemento) => elemento.appearance.conteo ? [[elemento.element_id, elemento.appearance.conteo] as const] : []));
}

function conConteos(blueprint: ReferenceBlueprintV2, conteos: ReadonlyMap<string, LecturaConteo>): ReferenceBlueprintV2 {
  if (conteos.size === 0) return blueprint;
  return {
    ...blueprint,
    elements: blueprint.elements.map((elemento) => {
      const conteo = conteos.get(elemento.element_id);
      return conteo ? { ...elemento, appearance: { ...elemento.appearance, conteo } } : elemento;
    }),
  };
}

/** Copia del blueprint con cada lectura en su elemento; nunca modifica el recibido. */
export function adjuntarLecturasConteo(blueprint: ReferenceBlueprintV2, lecturas: readonly PythonConteoReferenciaLectura[]): ReferenceBlueprintV2 {
  return conConteos(blueprint, new Map(lecturas.map(({ element_id, ...lectura }) => [element_id, lectura] as const)));
}

/**
 * `destino` con el conteo que `fuente` leyó en cada elemento. Las lecturas de la
 * foto corren en paralelo sobre el mismo blueprint del análisis y cada una
 * devuelve su propia copia; esto las junta sin tocar ninguna. Sin conteos en
 * `fuente` devuelve `destino` tal cual (el mismo objeto).
 */
export function conConteosDe(destino: ReferenceBlueprintV2, fuente: ReferenceBlueprintV2): ReferenceBlueprintV2 {
  return conConteos(destino, conteoPorElemento(fuente.elements));
}

function registrarOmision(contexto: ContextoLecturaConteo, imageId: string, motivo: Record<string, unknown>): void {
  console.warn("[references/analyze] conteo de globos omitido", JSON.stringify({
    request_id: contexto.requestId,
    correlation_id: contexto.correlationId,
    image_id: imageId,
    ...motivo,
  }));
}

/** La petición a Python entera: la foto (bytes y tipo) y lo que se le pregunta de ella. */
function claveLectura(referencia: ImagenEtiquetada & { mime: MimeFoto }, elementos: readonly PythonConteoReferenciaElemento[]): string {
  return createHash("sha256").update(referencia.mime).update("\0").update(referencia.base64).update("\0").update(JSON.stringify(elementos)).digest("hex");
}

function lecturasDeFoto(
  referencia: ImagenEtiquetada & { mime: MimeFoto },
  elementos: PythonConteoReferenciaElemento[],
  contexto: ContextoLecturaConteo,
): Promise<PythonConteoReferenciaLectura[]> {
  return leerCompartido<PythonConteoReferenciaLectura>({
    cache: contexto.cache ?? CACHE_DEL_PROCESO,
    clave: claveLectura(referencia, elementos),
    sinCache: contexto.sinCache,
    signal: contexto.signal,
    vencimiento: contexto.vencimiento,
    techoMs: DEADLINE_CONTEO_REFERENCIA_MS,
    llamar: async (deadlineMs, signal) => {
      const resultado = await llamarPythonConteoReferencia({
        imagen: { mimeType: referencia.mime, dataBase64: referencia.base64 },
        elementos,
        requestId: contexto.requestId,
        correlationId: contexto.correlationId,
        deadlineMs,
        parentSignal: signal,
      });
      // Modelo, versión del prompt y uso reportado por el proveedor (AGENTS.md).
      console.info("[references/analyze] conteo de globos leído", JSON.stringify({
        request_id: contexto.requestId,
        correlation_id: contexto.correlationId,
        image_id: referencia.id,
        modelo: resultado.modelo,
        prompt_version: resultado.promptVersion,
        usage: resultado.usage,
        elementos: elementos.length,
        lecturas: resultado.lecturas.length,
        // Las clases de tamaño que vio la foto, que son lo que decide si la
        // pieza se cotiza clásica u orgánica. Sin esto, cuando un arco de
        // cuartetos salía dibujado como orgánico no se podía saber si la foto
        // se leyó mal o el plan eligió mal; son cuatro números, ni imagen ni
        // dato de cliente.
        tamanos: resultado.lecturas.map((lectura) => ({
          elemento: lectura.element_id,
          clases: lectura.por_tamano.map((item) => `${item.clase} ${Math.round(item.proporcion * 100)}%`),
          racimos: lectura.racimos,
          por_racimo: lectura.globos_por_racimo,
        })),
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
 * Cuenta los globos de las estructuras de cada foto (una llamada por foto con
 * estructuras de globos, en paralelo) y devuelve el blueprint con las lecturas.
 * Sin estructuras de globos no llama; ante un fallo devuelve el blueprint
 * recibido, el mismo objeto.
 */
export async function leerConteosReferencia(
  blueprint: ReferenceBlueprintV2,
  referencias: readonly ImagenEtiquetada[],
  contexto: ContextoLecturaConteo,
): Promise<ReferenceBlueprintV2> {
  const llamadas = [...elementosConteo(blueprint)].flatMap(([imageId, elementos]) => {
    const referencia = referencias.find((item) => item.id === imageId);
    if (!referencia || !esMimeFoto(referencia.mime)) return [];
    return [lecturasDeFoto({ ...referencia, mime: referencia.mime }, elementos, contexto)];
  });
  if (llamadas.length === 0) return blueprint;
  const conLecturas = adjuntarLecturasConteo(blueprint, (await Promise.all(llamadas)).flat());
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
