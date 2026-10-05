import "server-only";
import { createHash } from "node:crypto";
import {
  isPythonAdapterError,
  llamarPythonPatronReferencia,
  type PythonPatronReferenciaElemento,
  type PythonPatronReferenciaInput,
  type PythonPatronReferenciaPista,
} from "@/lib/ia/nucleo/python-adapter";
import type { RemateLeido } from "@/lib/plan/armado-columna";
import type { ImagenEtiquetada } from "@/lib/ia/nucleo/tipos";
import { crearCacheLectura, leerCompartido, type CacheLectura } from "./deteccion-compartida";
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
/**
 * Por debajo de esta confianza la lectura de que la pieza es de un solo color no se guarda: la misma barra que
 * cualquier otra lectura de la foto (`CONFIANZA_MINIMA_PISTA` de `patron_color.py`, que también aplica
 * `validar_pistas` a la monocroma).
 */
const CONFIANZA_MINIMA_COLOR_UNICO = 0.5;
/** Techo propio de la detección: va después del análisis, dentro del mismo `maxDuration` de la ruta. */
export const DEADLINE_PATRON_REFERENCIA_MS = 25_000;

type MimeFoto = PythonPatronReferenciaInput["imagen"]["mimeType"];
const MIMES: ReadonlySet<string> = new Set<MimeFoto>(["image/png", "image/jpeg", "image/webp"]);

function esMimeFoto(mime: string): mime is MimeFoto {
  return MIMES.has(mime);
}

/**
 * Detecciones ya pagadas, por petición idéntica a Python (misma foto, mismos
 * elementos). Cada detección es una llamada de visión a Gemini con la foto
 * entera; sin esto, un análisis que sale de la caché o una foto de la galería
 * (que no llaman a ningún proveedor) la volvían a pagar en cada petición. Las
 * detecciones en vuelo se comparten como `enVuelo` en `analizar-referencias-v2`.
 * Vive en el proceso de Next: un despliegue (app y `ai-api` juntos) la vacía.
 * Solo guarda respuestas válidas de Python; un fallo se vuelve a intentar.
 */
export type CacheDeteccionPatron = CacheLectura<PythonPatronReferenciaPista>;

export function crearCacheDeteccionPatron(maximo?: number): CacheDeteccionPatron {
  return crearCacheLectura<PythonPatronReferenciaPista>(maximo);
}

const CACHE_DEL_PROCESO = crearCacheDeteccionPatron();

export type ContextoDeteccionPatron = {
  requestId: string;
  correlationId: string;
  signal?: AbortSignal;
  /** Epoch ms en que la ruta tiene que haber respondido; acota el deadline de la llamada. */
  vencimiento?: number;
  /** "Reintentar" de la UI (`sin_cache`): no reutiliza una detección guardada; la nueva la reemplaza. */
  sinCache?: boolean;
  /** Solo pruebas: una caché propia en lugar de la del proceso. */
  cache?: CacheDeteccionPatron;
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

/**
 * Copia campo a campo, así que CADA campo nuevo del contrato hay que añadirlo
 * aquí: `zonas` se perdió justo así cuando ADR-0036 lo añadió, y el elemento
 * quedaba con `modo: "zonas"` y sin una sola mancha. Lo que impide que vuelva a
 * pasar es la prueba de `scripts/test/test-patron-referencia.ts`, que exige que
 * una pista con manchas llegue entera hasta `pistas_patron`.
 */
function patronDePista(pista: PythonPatronReferenciaPista): PatronColorReferencia | undefined {
  // Ni "ninguno" (no se distingue) ni "monocromo" (un solo color) son disposiciones: no hay patrón que
  // guardar. El color de la monocroma viaja aparte, en `color_unico`.
  if (pista.modo === "ninguno" || pista.modo === "monocromo" || pista.colores.length === 0) return undefined;
  return {
    modo: pista.modo,
    colores: pista.colores,
    ...(pista.globos_por_racimo === undefined ? {} : { globos_por_racimo: pista.globos_por_racimo }),
    ...(pista.pesos === undefined ? {} : { pesos: pista.pesos }),
    // Solo con `modo: "zonas"`. El lector de Python adjunta las manchas para
    // CUALQUIER modo, y solo `_base_de_zonas_de_pista` las lee: mandarlas con
    // otro modo es ruido que ninguna etapa usa. (El 2026-09-30 esto se creyó la
    // causa del 422 de producción y no lo era: la causa estaba en `PistaPatron`
    // de `plan.py`, un modelo a mano que se quedó sin `zonas` y sin ese literal
    // cuando nació el modo. Se arregló allí; esta guarda se queda por higiene.)
    ...(pista.modo === "zonas" && pista.zonas !== undefined ? { zonas: pista.zonas } : {}),
    // El eje y la simetría que la foto leyó (ADR-0039). Viajan para cualquier modo: qué direcciones admite la
    // pieza y si lleva espejo lo decide `patron_color` con la tabla de `modos_admitidos`, y lo que no admite
    // lo descarta sin tumbar la lectura. El lector no manda la longitudinal, que es el valor de partida.
    ...(pista.motas === undefined || pista.motas.length === 0 ? {} : { motas: pista.motas }),
    ...(pista.direccion === undefined ? {} : { direccion: pista.direccion }),
    ...(pista.simetria === undefined ? {} : { simetria: pista.simetria }),
    confianza: pista.confianza,
  };
}

/**
 * Copia del blueprint con cada pista en su elemento: el patrón de color en
 * `appearance.patron_color` y, en una columna, lo que la corona en
 * `appearance.remate_columna` (ADR-0039). Una pista "ninguno" no deja patrón,
 * **pero sí puede dejar remate**: una columna de un solo color lleva su globo
 * igual. Una pista de un elemento que no existe no deja nada. Nunca modifica el
 * blueprint recibido: puede ser el resultado cacheado del análisis.
 */
export function adjuntarPistasPatron(blueprint: ReferenceBlueprintV2, pistas: readonly PythonPatronReferenciaPista[]): ReferenceBlueprintV2 {
  const patrones = new Map<string, PatronColorReferencia>();
  const remates = new Map<string, RemateLeido>();
  const unicos = new Map<string, string>();
  const tamanos = new Map<string, NonNullable<PythonPatronReferenciaPista["tamanos"]>>();
  for (const pista of pistas) {
    const patron = patronDePista(pista);
    if (patron) patrones.set(pista.element_id, patron);
    if (pista.remate) remates.set(pista.element_id, { ...pista.remate });
    // Los tamaños, como el remate, se guardan aunque el modo sea "ninguno" o "monocromo": no son una
    // disposición de color. Es el caso que los motivó.
    if (pista.tamanos) tamanos.set(pista.element_id, pista.tamanos);
    // Un color no tiene disposición, así que no hay patrón que guardar: lo que vale es el color. Y solo con
    // una lectura confiable: `color_unico` manda sobre las etiquetas y sobre la medida
    // (`coloresDominantesReferencia`), así que una monocroma dicha con 0,2 de confianza dejaba una columna
    // dorada, blanca y negra comprada solo en dorado (2026-10-05). Python ya la degrada a "ninguno"
    // (`validar_pistas`); esto la para también si llega de una detección guardada de antes.
    if (pista.modo === "monocromo" && pista.colores[0] && pista.confianza >= CONFIANZA_MINIMA_COLOR_UNICO) unicos.set(pista.element_id, pista.colores[0]);
  }
  if (patrones.size === 0 && remates.size === 0 && unicos.size === 0 && tamanos.size === 0) return blueprint;
  return {
    ...blueprint,
    elements: blueprint.elements.map((elemento) => {
      const patron = patrones.get(elemento.element_id);
      const remate = remates.get(elemento.element_id);
      const unico = unicos.get(elemento.element_id);
      const tamano = tamanos.get(elemento.element_id);
      if (!patron && !remate && !unico && !tamano) return elemento;
      return {
        ...elemento,
        appearance: {
          ...elemento.appearance,
          ...(patron ? { patron_color: patron } : {}),
          ...(remate ? { remate_columna: remate } : {}),
          ...(unico ? { color_unico: unico } : {}),
          ...(tamano ? { tamanos_leidos: tamano } : {}),
        },
      };
    }),
  };
}

function registrarOmision(contexto: ContextoDeteccionPatron, imageId: string, motivo: Record<string, unknown>): void {
  console.warn("[references/analyze] detección de patrón omitida", JSON.stringify({
    request_id: contexto.requestId,
    correlation_id: contexto.correlationId,
    image_id: imageId,
    ...motivo,
  }));
}

/** La petición a Python entera: la foto (bytes y tipo) y lo que se le pregunta de ella. */
function claveDeteccion(referencia: ImagenEtiquetada & { mime: MimeFoto }, elementos: readonly PythonPatronReferenciaElemento[]): string {
  return createHash("sha256").update(referencia.mime).update("\0").update(referencia.base64).update("\0").update(JSON.stringify(elementos)).digest("hex");
}

function pistasDeFoto(
  referencia: ImagenEtiquetada & { mime: MimeFoto },
  elementos: PythonPatronReferenciaElemento[],
  contexto: ContextoDeteccionPatron,
): Promise<PythonPatronReferenciaPista[]> {
  return leerCompartido<PythonPatronReferenciaPista>({
    cache: contexto.cache ?? CACHE_DEL_PROCESO,
    clave: claveDeteccion(referencia, elementos),
    sinCache: contexto.sinCache,
    signal: contexto.signal,
    vencimiento: contexto.vencimiento,
    techoMs: DEADLINE_PATRON_REFERENCIA_MS,
    llamar: async (deadlineMs, signal) => {
      const resultado = await llamarPythonPatronReferencia({
        imagen: { mimeType: referencia.mime, dataBase64: referencia.base64 },
        elementos,
        requestId: contexto.requestId,
        correlationId: contexto.correlationId,
        deadlineMs,
        parentSignal: signal,
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
    },
    alOmitir: (motivo) => registrarOmision(contexto, referencia.id, "motivo" in motivo
      ? motivo
      : isPythonAdapterError(motivo.error)
        ? { code: motivo.error.code, domain_code: motivo.error.domainCode ?? null, provider_detail: motivo.error.providerDetail ?? null }
        : { code: "ERROR_INESPERADO", mensaje: motivo.error instanceof Error ? motivo.error.message.slice(0, 200) : String(motivo.error).slice(0, 200) }),
  });
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
