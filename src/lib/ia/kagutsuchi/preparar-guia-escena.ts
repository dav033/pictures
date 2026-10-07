import "server-only";
import { createHash } from "node:crypto";
import type { PeticionImagen } from "@/lib/ia/nucleo/tipos";
import type { ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { GUIA_ESCENA_ASPECTO_CAJA, type PlanGuiaEscenaRequestV1, type PlanGuiaEscenaResultV1 } from "@/lib/plan/guia-escena";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { costeEntradasUsdEstimado, elegirCaptionConGuia, tamanoGuia } from "./guia-estructura";
import { instanciasDeEscena, proporcionDeLaFoto, reencuadrar, svgGuiaEscena, type InstanciaGuia } from "./guia-escena";
import { rasterizarSvg } from "./rasterizar-guia";
import { imageSizeFor, reservaNotaGuiaEscena, type ImagenGuiaFlux } from "./flux";

/**
 * La guía de escena para una generación (`GUIA_ESCENA_V1`): pide a Python los discos de cada pieza, los compone
 * en el encuadre de salida con las cajas de la foto, rasteriza el PNG y elige el caption que cabe con su nota.
 *
 * Es el caso de uso que llama `/api/generate`; vive aquí para que la ruta solo decida y traduzca, y para poder
 * probar entero lo que llega a fal con dobles de `fetch`. Nunca falla en silencio: si la guía no se puede hacer o
 * su nota no cabe, la generación sigue sin ella y `resumen` lo dice (`usada: false` y `motivo`). Una cancelación
 * sí se relanza: no es un fallo de la guía.
 */

/** Lo que la resolución ya sabe de una pieza y el plan no dice (`mezclas[]` de `plan-guia-escena.v1`). */
export type MezclaDePieza = NonNullable<PlanGuiaEscenaRequestV1["mezclas"]>[number];

/** Topes de `mezclas[]` en el contrato: se recorta aquí para que una línea larga no tumbe la guía entera. */
const MAX_LINEAS = 72;
const recortar = (valor: string | null, maximo: number): string | null => (valor === null ? null : valor.slice(0, maximo));

/**
 * Los datos de cada pieza para Python: su `mezcla_real`, el catálogo de sus líneas (qué globo es cada material),
 * la leyenda de su armado de bouquet si la resolución la escribió, y la proporción de la caja de la foto donde va
 * (alto sobre ancho en píxeles de la guía), solo si la caja salió de la foto: la del plan no dice nada de la forma.
 * Todo es de la resolución o de la foto: aquí solo se recorta a la forma del contrato, nunca se calcula un globo.
 */
export function datosDePiezas(plan: PlanResuelto, instancias: readonly InstanciaGuia[], tamano: { ancho: number; alto: number }): MezclaDePieza[] {
  const leyendas = new Map((plan.armados_bouquet ?? []).map((armado) => [armado.estructura_id, armado.leyenda] as const));
  return plan.estructuras.map((estructura) => {
    const caja = instancias.find((instancia) => instancia.estructura_id === estructura.estructura_id && instancia.fuente === "foto")?.caja;
    const aspecto = caja ? (caja.height * tamano.alto) / (caja.width * tamano.ancho) : undefined;
    // Un arco que se apoya en la pared es un aro que la foto muestra colgado (`aroColgadoEnLaFoto`).
    const colgada = estructura.tipo === "arco" && instancias.some((instancia) => instancia.estructura_id === estructura.estructura_id && instancia.apoyo === "pared");
    const leyenda = leyendas.get(estructura.estructura_id);
    return {
      estructura_id: estructura.estructura_id,
      mezcla_real: estructura.mezcla_real,
      // Solo el cuerpo de la pieza: los globos de sus flores (adorno, flores-pieza.ts) no son la mezcla que se dibuja.
      lineas: estructura.lineas.filter((linea) => linea.adorno !== "flor").slice(0, MAX_LINEAS).map((linea) => ({
        product_id: linea.product_id,
        variant_id: linea.variant_id,
        titulo: linea.titulo.slice(0, 500),
        color: recortar(linea.color, 160),
        tamano_codigo: recortar(linea.tamano_codigo, 80),
        diam_pulg: linea.diam_pulg,
        forma: recortar(linea.forma, 80),
        acabado: recortar(linea.acabado, 80),
      })),
      ...(leyenda ? { leyenda: leyenda.map((entrada) => ({ material: entrada.material, tipo_globo: entrada.tipo_globo, tamano_pulg: entrada.tamano_pulg, digito: entrada.digito })) } : {}),
      ...(aspecto !== undefined && Number.isFinite(aspecto) ? { aspecto_caja: Math.min(GUIA_ESCENA_ASPECTO_CAJA.max, Math.max(GUIA_ESCENA_ASPECTO_CAJA.min, aspecto)) } : {}),
      ...(colgada ? { colgada: true as const } : {}),
    };
  });
}

export type GuiaEscenaPreparada = {
  imagen: ImagenGuiaFlux;
  /** Hash del PNG: lo único de la guía que va a registros y a la respuesta. */
  sha256: string;
  bytes: number;
  piezas: number;
  discos: number;
  omitidas: PlanGuiaEscenaResultV1["omitidas"];
  cajasDeLaFoto: number;
  cajasDelPlan: number;
};

/** Lo que la respuesta de `/api/generate` cuenta de la guía de escena (campo `guiaEscena`, aditivo). */
export type ResumenGuiaEscena = {
  usada: boolean;
  motivo?: string;
  /** La guía viajó con el caption sin las frases de forma de Python (`compilarSinFrases`): no cabían con su nota. */
  caption_sin_frases_de_forma?: boolean;
  guia_sha256?: string;
  piezas?: number;
  discos?: number;
  omitidas?: PlanGuiaEscenaResultV1["omitidas"];
  cajas_de_la_foto?: number;
  cajas_del_plan?: number;
  coste_entradas_extra_usd_estimado: number;
};

export async function prepararGuiaEscena(entrada: {
  plan: PlanResuelto;
  foto: ReferenceBlueprintV2 | undefined;
  aspecto: PeticionImagen["aspecto"];
  pedirDiscos: (plan: PlanResuelto["plan"], mezclas: readonly MezclaDePieza[]) => Promise<PlanGuiaEscenaResultV1>;
}): Promise<GuiaEscenaPreparada> {
  const { plan } = entrada;
  const tamano = tamanoGuia(imageSizeFor(entrada.aspecto));
  // Las cajas de la foto pasan al lienzo con la forma de la foto y la decoración encuadrada (`reencuadrar`).
  const instancias = reencuadrar(instanciasDeEscena(plan.plan.estructuras, entrada.foto), proporcionDeLaFoto(plan.plan.estructuras, entrada.foto), tamano);
  const discos = await entrada.pedirDiscos(plan.plan, datosDePiezas(plan, instancias, tamano));
  if (!discos.piezas.length) throw new Error("GUIA_ESCENA_INVALIDA: ninguna pieza del plan tiene motor ni dibujo.");
  const png = await rasterizarSvg(svgGuiaEscena(discos.piezas, instancias, tamano), tamano);
  const conPieza = new Set(discos.piezas.map((pieza) => pieza.estructura_id));
  const colocadas = instancias.filter((instancia) => conPieza.has(instancia.estructura_id));
  return {
    imagen: {
      id: "SCENE_GUIDE", role: "scene_guide", base64: png.toString("base64"), mime: "image/png",
      // La nota que acompaña a la guía nombra el aro y su poste solo si la guía los dibuja (`notaGuiaEscena`).
      conEstructura: discos.piezas.some((pieza) => Boolean(pieza.trazos?.length || pieza.rellenos?.length)),
    },
    sha256: createHash("sha256").update(png).digest("hex"),
    bytes: png.byteLength,
    piezas: discos.piezas.length,
    discos: discos.total_discos,
    omitidas: discos.omitidas,
    cajasDeLaFoto: colocadas.filter((instancia) => instancia.fuente === "foto").length,
    cajasDelPlan: colocadas.filter((instancia) => instancia.fuente === "plan").length,
  };
}

function motivoDe(error: unknown): string {
  const mensaje = error instanceof Error ? error.message : "error desconocido";
  return `no se pudo construir la guía de escena: ${mensaje.slice(0, 200)}`;
}

/**
 * La guía de escena y el caption con su nota, o `{}` si la generación no la admite. `compilar` recibe el
 * presupuesto del caption con la nota ya descontada (`reservaNotaGuiaEscena`), y `cabe` es el preflight del
 * prompt final, el que recibe fal.
 */
export async function guiaEscenaParaGeneracion<T>(entrada: {
  admite: boolean;
  plan: PlanResuelto;
  foto: ReferenceBlueprintV2 | undefined;
  aspecto: PeticionImagen["aspecto"];
  pedirDiscos: (plan: PlanResuelto["plan"], mezclas: readonly MezclaDePieza[]) => Promise<PlanGuiaEscenaResultV1>;
  maximo: number;
  compilar: (maxLength: number) => T;
  /**
   * El caption sin las frases de forma y de patrón que Python escribe por pieza (el motor orgánico, los
   * patrones de color). Esas frases viajan literales y no se compactan: con dos piezas del motor ocupan
   * ~500 caracteres y, con la nota de la guía, el prompt base pasaba de 1000 y la guía se caía entera
   * (2026-10-04, "no cabe en el presupuesto del caption"). La guía DIBUJA esa forma y esos colores, así que
   * es lo prescindible cuando hay guía; se intenta solo si el caption completo no cabe.
   */
  compilarSinFrases?: (maxLength: number) => T;
  cabe: (compilacion: T, imagenes: readonly ImagenGuiaFlux[]) => boolean;
  largo: (compilacion: T) => number;
  signal?: AbortSignal;
}): Promise<{ imagenes?: readonly ImagenGuiaFlux[]; compilacion?: T; resumen?: ResumenGuiaEscena; preparada?: GuiaEscenaPreparada }> {
  if (!entrada.admite) return {};
  let preparada: GuiaEscenaPreparada;
  try {
    preparada = await prepararGuiaEscena(entrada);
  } catch (error) {
    if (entrada.signal?.aborted) throw error;
    return { resumen: { usada: false, motivo: motivoDe(error), coste_entradas_extra_usd_estimado: 0 } };
  }
  const elegirCon = (compilar: (maxLength: number) => T) => elegirCaptionConGuia<T, ImagenGuiaFlux>({
    imagenes: [preparada.imagen],
    maximo: entrada.maximo,
    reserva: () => reservaNotaGuiaEscena(),
    compilar,
    cabe: entrada.cabe,
    largo: entrada.largo,
  });
  const completo = elegirCon(entrada.compilar);
  const sinFrases = completo || !entrada.compilarSinFrases ? null : elegirCon(entrada.compilarSinFrases);
  const elegido = completo ?? sinFrases;
  const resumen: ResumenGuiaEscena = {
    usada: Boolean(elegido),
    ...(elegido ? {} : { motivo: "la nota de la guía de escena no cabe en el presupuesto del caption" }),
    ...(sinFrases ? { caption_sin_frases_de_forma: true } : {}),
    guia_sha256: preparada.sha256,
    piezas: preparada.piezas,
    discos: preparada.discos,
    omitidas: preparada.omitidas,
    cajas_de_la_foto: preparada.cajasDeLaFoto,
    cajas_del_plan: preparada.cajasDelPlan,
    coste_entradas_extra_usd_estimado: costeEntradasUsdEstimado(elegido ? 1 : 0),
  };
  return elegido ? { imagenes: elegido.imagenes, compilacion: elegido.compilacion, resumen, preparada } : { resumen, preparada };
}
