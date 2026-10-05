import "server-only";
import {
  isPythonAdapterError,
  llamarPythonLecturaUnica,
  type PythonLecturaUnicaElemento,
  type PythonLecturaUnicaResult,
} from "@/lib/ia/nucleo/python-adapter";
import type { ImagenEtiquetada } from "@/lib/ia/nucleo/tipos";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { reubicarGuirnaldas } from "@/lib/ia/referencia/reference-structure";
import { adjuntarLecturasBouquet } from "./bouquet-referencia";
import { adjuntarLecturasConteo } from "./conteo-referencia";
import { adjuntarLecturasGuirnalda } from "./guirnalda-referencia";
import { adjuntarPistasPatron } from "./patron-referencia";
import { deadlineLectura } from "./deteccion-compartida";

/**
 * Las cuatro lecturas de la foto cuando las devuelve el propio análisis
 * (variante `v17-lectura-unica`, bandera `LECTURA_UNICA_REFERENCIA_ENABLED`).
 *
 * No hay ninguna llamada de visión aquí: la única IA que miró la imagen fue el
 * análisis, y esto reparte lo que escribió. Python valida cada bloque con el
 * validador de la lectura de producción que lo posee
 * (`app/amaterasu/lectura_unica.py`) y aquí se adjunta cada lectura a su
 * elemento con las MISMAS funciones que usa el camino de cuatro llamadas
 * (`adjuntarPistasPatron`, `adjuntarLecturasConteo`, `adjuntarLecturasBouquet`,
 * `adjuntarLecturasGuirnalda`), así que el blueprint que sale es de la misma
 * forma byte a byte.
 *
 * Nunca rompe el análisis: cualquier fallo se registra con los ids de la
 * petición y el blueprint sale sin lecturas, el mismo objeto que entró.
 */

/** Elementos por foto que admite `lectura-unica.v1`, el mismo que las cuatro lecturas. */
const MAX_ELEMENTOS_POR_FOTO = 12;
/** Techo propio: es validación en Python, sin proveedor detrás; no necesita el de una lectura. */
export const DEADLINE_LECTURA_UNICA_MS = 10_000;

type MimeFoto = Parameters<typeof llamarPythonLecturaUnica>[0]["imagen"]["mimeType"];
const MIMES: ReadonlySet<string> = new Set<MimeFoto>(["image/png", "image/jpeg", "image/webp"]);

function esMimeFoto(mime: string): mime is MimeFoto {
  return MIMES.has(mime);
}

export type ContextoLecturaUnica = {
  requestId: string;
  correlationId: string;
  signal?: AbortSignal;
  /** Epoch ms en que la ruta tiene que haber respondido; acota el deadline de la llamada. */
  vencimiento?: number;
};

/** Las cuatro lecturas crudas por `element_id`, tal como las devolvió el análisis. */
export type LecturasCrudasPorElemento = Readonly<Record<string, Record<string, unknown>>>;

function bloque(raw: Record<string, unknown> | undefined, clave: string): Record<string, unknown> | undefined {
  const valor = raw?.[clave];
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor as Record<string, unknown> : undefined;
}

/**
 * `anfitriona_elemento` con el nombre de otra pieza → `anfitriona_element_id`.
 *
 * En la llamada del análisis los `element_id` todavía no existen, así que el
 * modelo nombra a la anfitriona igual que en `relationships` y en
 * `mirrors_element`: por su `name`. Esto lo resuelve con la misma regla que
 * `buildBlueprint` (nombre en minúsculas). Un nombre que no resuelve se cae: un
 * id inventado lo rechazaría el adaptador y tumbaría las cuatro lecturas de esa
 * foto, no solo esta.
 */
function conAnfitriona(armado: Record<string, unknown>, idsPorNombre: ReadonlyMap<string, string>, elementId: string): Record<string, unknown> {
  const { anfitriona_elemento: nombre, ...resto } = armado;
  if (typeof nombre !== "string") return resto;
  const id = idsPorNombre.get(nombre.trim().toLowerCase());
  return id && id !== elementId ? { ...resto, anfitriona_element_id: id } : resto;
}

/**
 * Por foto, los elementos a validar: cada estructura de globos aprobada que
 * traiga al menos un bloque, y las demás como posibles anfitrionas de una
 * guirnalda (`sobre_estructura`), que es lo que hoy manda `otras`. Las que
 * traen lectura van primero: si la foto tiene más de `MAX_ELEMENTOS_POR_FOTO`
 * piezas, lo que se pierde es una anfitriona, no una lectura.
 */
export function elementosLecturaUnica(
  blueprint: ReferenceBlueprintV2,
  lecturas: LecturasCrudasPorElemento,
): Map<string, PythonLecturaUnicaElemento[]> {
  const idsPorNombre = new Map(blueprint.elements.map((elemento) => [elemento.name.trim().toLowerCase(), elemento.element_id]));
  const conLectura = new Map<string, PythonLecturaUnicaElemento[]>();
  const anfitrionas = new Map<string, PythonLecturaUnicaElemento[]>();
  for (const elemento of blueprint.elements) {
    const semantica = elemento.visual_semantics;
    if (!elemento.approved || elemento.category !== "balloon_structure" || !semantica) continue;
    const raw = lecturas[elemento.element_id];
    const patron = bloque(raw, "patron_color");
    const conteo = bloque(raw, "conteo");
    const armadoBouquet = bloque(raw, "armado_bouquet");
    const armadoGuirnaldaCrudo = bloque(raw, "armado_guirnalda");
    const armadoGuirnalda = armadoGuirnaldaCrudo && conAnfitriona(armadoGuirnaldaCrudo, idsPorNombre, elemento.element_id);
    const base: PythonLecturaUnicaElemento = {
      elementId: elemento.element_id,
      tipo: semantica.structure_type,
      // Una pieza que el modelo NO leyó como guirnalda puede sostener una.
      ...(armadoGuirnalda ? {} : { anfitrionaPosible: true }),
      ...(patron ? { patron } : {}),
      ...(conteo ? { conteo } : {}),
      ...(armadoBouquet ? { armadoBouquet } : {}),
      ...(armadoGuirnalda ? { armadoGuirnalda } : {}),
    };
    const destino = patron || conteo || armadoBouquet || armadoGuirnalda ? conLectura : anfitrionas;
    const lista = destino.get(elemento.source_image_id) ?? [];
    lista.push(base);
    destino.set(elemento.source_image_id, lista);
  }
  const porFoto = new Map<string, PythonLecturaUnicaElemento[]>();
  for (const [imageId, lista] of conLectura) {
    const hueco = MAX_ELEMENTOS_POR_FOTO - lista.length;
    porFoto.set(imageId, [...lista.slice(0, MAX_ELEMENTOS_POR_FOTO), ...(anfitrionas.get(imageId) ?? []).slice(0, Math.max(0, hueco))]);
  }
  return porFoto;
}

/** Copia del blueprint con las cuatro lecturas de una foto en sus elementos. */
export function adjuntarLecturaUnica(blueprint: ReferenceBlueprintV2, resultado: PythonLecturaUnicaResult): ReferenceBlueprintV2 {
  const conPatron = adjuntarPistasPatron(blueprint, resultado.pistas);
  const conConteo = adjuntarLecturasConteo(conPatron, resultado.conteos);
  const conBouquet = adjuntarLecturasBouquet(conConteo, resultado.armadosBouquet);
  return adjuntarLecturasGuirnalda(conBouquet, resultado.armadosGuirnalda);
}

function registrarOmision(contexto: ContextoLecturaUnica, imageId: string, motivo: Record<string, unknown>): void {
  console.warn("[references/analyze] lectura unica omitida", JSON.stringify({
    request_id: contexto.requestId,
    correlation_id: contexto.correlationId,
    image_id: imageId,
    ...motivo,
  }));
}

/**
 * Valida y adjunta las cuatro lecturas que el análisis devolvió (una llamada a
 * Python por foto con elementos, en paralelo) y refina la ubicación de las
 * guirnaldas con sus lecturas y los muebles, igual que el camino de cuatro
 * llamadas. Sin lecturas crudas no llama; ante un fallo devuelve el blueprint
 * recibido, el mismo objeto.
 */
export async function leerLecturaUnica(
  blueprint: ReferenceBlueprintV2,
  lecturas: LecturasCrudasPorElemento | undefined,
  referencias: readonly ImagenEtiquetada[],
  contexto: ContextoLecturaUnica,
): Promise<ReferenceBlueprintV2> {
  if (!lecturas || Object.keys(lecturas).length === 0) return blueprint;
  const deadlineMs = deadlineLectura(contexto.vencimiento, DEADLINE_LECTURA_UNICA_MS);
  if (deadlineMs === undefined) {
    registrarOmision(contexto, "*", { motivo: "sin_tiempo" });
    return blueprint;
  }
  const llamadas = [...elementosLecturaUnica(blueprint, lecturas)].flatMap(([imageId, elementos]) => {
    const referencia = referencias.find((item) => item.id === imageId);
    if (!referencia || !esMimeFoto(referencia.mime) || elementos.length === 0) return [];
    const mime = referencia.mime;
    return [(async (): Promise<PythonLecturaUnicaResult | undefined> => {
      try {
        const resultado = await llamarPythonLecturaUnica({
          imagen: { mimeType: mime, dataBase64: referencia.base64 },
          elementos,
          requestId: contexto.requestId,
          correlationId: contexto.correlationId,
          deadlineMs,
          parentSignal: contexto.signal,
        });
        // Qué validó y qué quedó: nunca la foto. El modelo, la versión del
        // prompt y el uso son del análisis, que ya los registró.
        console.info("[references/analyze] lectura unica validada", JSON.stringify({
          request_id: contexto.requestId,
          correlation_id: contexto.correlationId,
          image_id: referencia.id,
          validador_version: resultado.validadorVersion,
          elementos: elementos.length,
          patron: resultado.pistas.length,
          conteo: resultado.conteos.length,
          bouquet: resultado.armadosBouquet.length,
          guirnalda: resultado.armadosGuirnalda.length,
        }));
        return resultado;
      } catch (error) {
        registrarOmision(contexto, referencia.id, isPythonAdapterError(error)
          ? { code: error.code, domain_code: error.domainCode ?? null, provider_detail: error.providerDetail ?? null }
          : { code: "ERROR_INESPERADO", mensaje: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) });
        return undefined;
      }
    })()];
  });
  if (llamadas.length === 0) return blueprint;
  const resultados = (await Promise.all(llamadas)).filter((resultado): resultado is PythonLecturaUnicaResult => resultado !== undefined);
  if (resultados.length === 0) return blueprint;
  const conLecturas = resultados.reduce(adjuntarLecturaUnica, blueprint);
  if (conLecturas === blueprint) return blueprint;
  // El blueprint viaja después al chat y a la generación, que lo validan con
  // este esquema: uno que no lo pase aquí no se entrega.
  const validado = ReferenceBlueprintV2Schema.safeParse(reubicarGuirnaldas(conLecturas));
  if (!validado.success) {
    registrarOmision(contexto, "*", { code: "BLUEPRINT_INVALIDO", issues: validado.error.issues.slice(0, 3).map((issue) => issue.path.join(".")) });
    return blueprint;
  }
  return validado.data;
}
