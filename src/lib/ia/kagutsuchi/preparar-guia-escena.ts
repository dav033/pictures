import "server-only";
import { createHash } from "node:crypto";
import type { PeticionImagen } from "@/lib/ia/nucleo/tipos";
import type { ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { GUIA_ESCENA_ASPECTO_CAJA, type PlanGuiaEscenaRequestV1, type PlanGuiaEscenaResultV1 } from "@/lib/plan/guia-escena";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { aplicarArmadosCompletados, CLAVES_FUERA_DEL_MODELO, TIPOS_ARMADO_MOTOR } from "@/lib/plan/armado-estructura-ia";
import { llamarPythonOmoikaneCompletarArmados } from "@/lib/ia/nucleo/python-adapter";
import type { PlanDecoracion } from "@/lib/plan/tipos";
import { OFICIALES_CON_DIBUJO_ESQUEMATICO } from "@/lib/plan/dibujo-estructura";
import { OFICIALES_SIN_MOTOR, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { costeEntradasUsdEstimado, elegirCaptionConGuia, tamanoGuia } from "./guia-estructura";
import { instanciasAEscala, instanciasDeEscena, proporcionDeLaFoto, reencuadrar, svgGuiaEscena, type ApoyoGuia, type InstanciaGuia } from "./guia-escena";
import { rasterizarSvg } from "./rasterizar-guia";
import { imageSizeFor, reservaNotaGuiaEscena, type ImagenGuiaFlux } from "./flux";

/**
 * La guía de escena para una generación (`GUIA_ESCENA_V1`): pide a Python los discos de cada pieza, los compone
 * en el encuadre de salida con las cajas de la foto (o, sin foto, cada pieza a su escala real:
 * `GUIA_ESCENA_SIN_FOTO_V1`), rasteriza el PNG y elige el caption que cabe con su nota. Una pieza de motor sin
 * armado se dibuja con la receta de su motor, la misma que enseña la gráfica del plan (`planConRecetas`).
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

type EstructuraDelPlan = PlanResuelto["plan"]["estructuras"][number];

/**
 * Las piezas que un motor arma y que llegan SIN su armado guardado: un arco, semiarco, columna o guirnalda que no es
 * un aro ni una pieza sin motor (`motorDePieza` de la gráfica guiada usa la misma regla) y que no trae ninguno de los
 * armados del motor ni el `armado_guirnalda` de su foto (ADR-0032), que Python ya sabe dibujar.
 */
export function piezasSinArmadoDelMotor(estructuras: readonly EstructuraDelPlan[]): string[] {
  return estructuras.filter((estructura) => {
    if (!(TIPOS_ARMADO_MOTOR as readonly string[]).includes(estructura.tipo)) return false;
    const oficial = ("estructura_oficial" in estructura ? estructura.estructura_oficial : undefined) as EstructuraOficialId | undefined;
    if (oficial && (OFICIALES_CON_DIBUJO_ESQUEMATICO.has(oficial) || OFICIALES_SIN_MOTOR.has(oficial))) return false;
    const campos = estructura as Partial<Record<(typeof CLAVES_FUERA_DEL_MODELO)[number] | "armado_guirnalda", unknown>>;
    return ![...CLAVES_FUERA_DEL_MODELO, "armado_guirnalda" as const].some((clave) => campos[clave] !== undefined && campos[clave] !== null);
  }).map((estructura) => estructura.estructura_id);
}

/** De dónde salió el dibujo de cada pieza que pasó por la receta, para el registro. */
export type RecetasDeLaGuia = { pedidas: string[]; usadas: string[]; motivo?: string };

/** Cómo quedó cada instancia en la guía (para `regla:guia_escena`): su caja en fracciones del lienzo. */
export type CajaDeLaGuia = { estructura_id: string; instancia: number; fuente: InstanciaGuia["fuente"]; apoyo: ApoyoGuia; espejo: boolean; caja: { x: number; y: number; width: number; height: number } };

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
  /** `foto`: cada pieza en la caja de su elemento; `escala`: sin foto, cada pieza a su escala real (`instanciasAEscala`). */
  composicion: "foto" | "escala";
  cajas: CajaDeLaGuia[];
  /** Con `composicion: "escala"`: píxeles por metro y lo que enseña el lienzo. */
  escala?: { px_por_m: number; ancho_visible_m: number; alto_visible_m: number };
  /** Las piezas sin armado que se dibujaron con la receta de su motor (la de la gráfica del plan). */
  recetas?: RecetasDeLaGuia;
};

const redondear3 = (valor: number): number => Math.round(valor * 1000) / 1000;

/**
 * `CompletarRecetas` con el Python de verdad: la MISMA puerta que la confirmación del plan (`omoikane completar`,
 * ADR-0034) y que la gráfica cuando la pieza no trae armado; se escribe la receta solo en las piezas `ids`. Un plan
 * 1.1 se devuelve tal cual (la operación recibe planes 1.0).
 */
export function recetasDelMotorPython(ids: { requestId: string; correlationId: string; signal?: AbortSignal }): CompletarRecetas {
  return async (plan, piezas) => {
    if (plan.plan_version !== "1.0") return plan;
    const declarado: PlanDecoracion = plan;
    const respuesta = await llamarPythonOmoikaneCompletarArmados({
      plan: declarado,
      requestId: ids.requestId,
      correlationId: ids.correlationId,
      ...(ids.signal ? { parentSignal: ids.signal } : {}),
    });
    const pedidas = new Set(piezas);
    return aplicarArmadosCompletados(declarado, respuesta.armados.filter((armado) => pedidas.has(armado.estructura_id)));
  };
}

/**
 * El plan con la receta del motor en cada pieza que no trae su armado (`piezasSinArmadoDelMotor`): es el dibujo que
 * la gráfica del plan enseña de esa pieza (`motorDePieza`: «una sin armado, con la receta del mismo motor»), y sin él
 * Python no tiene globos que dibujar (`sin_dibujo`: el semiarco orgánico de una idea, guiada-20261007-071126-x7w4dx).
 * Solo para la guía: el plan, su cotización y su `plan_hash` no cambian. Si la receta no llega, la pieza sigue como
 * estaba (con su dibujo de siempre o solo con texto) y `recetas.motivo` lo dice; una cancelación se relanza.
 */
async function planConRecetas(
  plan: PlanResuelto["plan"],
  completar: CompletarRecetas | undefined,
  signal: AbortSignal | undefined,
): Promise<{ plan: PlanResuelto["plan"]; recetas?: RecetasDeLaGuia }> {
  const pedidas = completar ? piezasSinArmadoDelMotor(plan.estructuras) : [];
  if (!completar || !pedidas.length) return { plan };
  try {
    const completado = await completar(plan, pedidas);
    const usadas = pedidas.filter((id) => !piezasSinArmadoDelMotor(completado.estructuras.filter((estructura) => estructura.estructura_id === id)).length);
    return { plan: completado, recetas: { pedidas, usadas } };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { plan, recetas: { pedidas, usadas: [], motivo: (error instanceof Error ? error.message : "error desconocido").slice(0, 200) } };
  }
}

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
  /** `foto` (cajas de la foto) o `escala` (sin foto: cada pieza a su escala real). */
  composicion?: GuiaEscenaPreparada["composicion"];
  cajas?: CajaDeLaGuia[];
  escala?: GuiaEscenaPreparada["escala"];
  recetas?: RecetasDeLaGuia;
  coste_entradas_extra_usd_estimado: number;
};

/** Pide la receta del motor de las piezas `ids` y devuelve el plan con ella escrita (solo para la guía). */
export type CompletarRecetas = (plan: PlanResuelto["plan"], ids: readonly string[]) => Promise<PlanResuelto["plan"]>;

export async function prepararGuiaEscena(entrada: {
  plan: PlanResuelto;
  foto: ReferenceBlueprintV2 | undefined;
  aspecto: PeticionImagen["aspecto"];
  pedirDiscos: (plan: PlanResuelto["plan"], mezclas: readonly MezclaDePieza[]) => Promise<PlanGuiaEscenaResultV1>;
  /** La receta del motor para las piezas sin armado (`planConRecetas`). Sin ella, cada pieza como venga. */
  completarRecetas?: CompletarRecetas;
  signal?: AbortSignal;
}): Promise<GuiaEscenaPreparada> {
  const { plan } = entrada;
  const tamano = tamanoGuia(imageSizeFor(entrada.aspecto));
  // Las cajas de la foto pasan al lienzo con la forma de la foto y la decoración encuadrada (`reencuadrar`).
  const deLaFoto = reencuadrar(instanciasDeEscena(plan.plan.estructuras, entrada.foto), proporcionDeLaFoto(plan.plan.estructuras, entrada.foto), tamano);
  const conFoto = deLaFoto.some((instancia) => instancia.fuente === "foto");
  const { plan: paraDibujar, recetas } = await planConRecetas(plan.plan, entrada.completarRecetas, entrada.signal);
  const discos = await entrada.pedirDiscos(paraDibujar, datosDePiezas(plan, deLaFoto, tamano));
  if (!discos.piezas.length) throw new Error("GUIA_ESCENA_INVALIDA: ninguna pieza del plan tiene motor ni dibujo.");
  // Sin ninguna caja de la foto, cada pieza a su escala real con las medidas de lo que Python dibujó: las cajas del
  // plan (`cajasDeEstructuras`) estiraban cada pieza a su ubicación (una guirnalda de 2,4 m, de pared a pared).
  const aEscala = conFoto ? undefined : instanciasAEscala(plan.plan.estructuras, discos.piezas, tamano);
  const instancias = aEscala?.instancias ?? deLaFoto;
  const png = await rasterizarSvg(svgGuiaEscena(discos.piezas, instancias, tamano, aEscala ? { lineaPiso: aEscala.lineaPiso } : {}), tamano);
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
    composicion: aEscala ? "escala" : "foto",
    cajas: colocadas.map((instancia) => ({
      estructura_id: instancia.estructura_id,
      instancia: instancia.instancia,
      fuente: instancia.fuente,
      apoyo: discos.piezas.find((pieza) => pieza.estructura_id === instancia.estructura_id)?.anclaje ?? instancia.apoyo,
      espejo: instancia.espejo,
      caja: { x: redondear3(instancia.caja.x), y: redondear3(instancia.caja.y), width: redondear3(instancia.caja.width), height: redondear3(instancia.caja.height) },
    })),
    ...(aEscala ? { escala: { px_por_m: redondear3(aEscala.pxPorMetro), ancho_visible_m: redondear3(aEscala.anchoVisibleM), alto_visible_m: redondear3(aEscala.altoVisibleM) } } : {}),
    ...(recetas ? { recetas } : {}),
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
  completarRecetas?: CompletarRecetas;
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
    composicion: preparada.composicion,
    cajas: preparada.cajas,
    ...(preparada.escala ? { escala: preparada.escala } : {}),
    ...(preparada.recetas ? { recetas: preparada.recetas } : {}),
    coste_entradas_extra_usd_estimado: costeEntradasUsdEstimado(elegido ? 1 : 0),
  };
  return elegido ? { imagenes: elegido.imagenes, compilacion: elegido.compilacion, resumen, preparada } : { resumen, preparada };
}
