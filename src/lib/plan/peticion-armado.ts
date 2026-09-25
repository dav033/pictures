import { CATALOGO_ERRORES_UI_V1, leerUiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";
import type { PythonPlanArmadoGlobo } from "@/lib/ia/nucleo/python-adapter";
import { z } from "zod";
import { ArmadoBouquetResueltoSchema, DISPOSICIONES_NUMERO, VARIANTES_BOUQUET, type ArmadoBouquetResuelto, type ArmadoBouquetV1, type DisposicionNumero, type VarianteBouquet } from "./armado-bouquet";
import { esCancelacion, FalloPlanEditar, mensajeErrorRespuesta } from "./peticion-plan-editar";
import type { PlanResuelto } from "./resuelto";

/**
 * Vista previa del editor de armado de bouquets (ADR-0030): el navegador manda
 * el armado declarativo (o `null` para pedir la receta) a
 * /api/plan-armado-bouquet y recibe la leyenda, los niveles, los insumos y los
 * textos que escribe Python. Aquí no se cuenta ni se valida nada del armado;
 * la respuesta se valida con el mismo esquema que viaja en `plan_resuelto`.
 *
 * Errores con el estilo de `peticion-patron.ts`: un armado que Python rechaza
 * (`armado_invalido`) trae `motivo` estable y `mensaje` en español para el
 * decorador; ese mensaje se muestra tal cual. El rechazo trae además los
 * estilos y las disposiciones que Python admite para la pieza. Sin React.
 */

export const RESPALDO_VISTA_ARMADO = "No pude dibujar el armado. Intenta de nuevo en un momento.";
/** Rechazo del armado que llega sin la frase de Python (un servidor anterior o un cuerpo recortado). */
export const MENSAJE_ARMADO_INVALIDO = "Ese armado no se puede hacer con los globos de esta pieza: cambia el estilo o sus globos.";

/** Lo que la vista previa sabe de cada globo de la pieza (contrato `plan-armado-bouquet`). */
export type GloboVistaArmado = PythonPlanArmadoGlobo;

export type PeticionVistaArmado = {
  plan: PlanResuelto["plan"];
  estructura_id: string;
  /** `null` pide la receta de Python para la pieza. */
  armado_bouquet: ArmadoBouquetV1 | null;
  /** Los globos de la pieza, de sus líneas resueltas: clasifican, nunca cuentan. */
  globos: readonly GloboVistaArmado[];
  /** Con `armado_bouquet: null`: el estilo que eligió el decorador. */
  variante?: VarianteBouquet;
  /** Con `armado_bouquet: null`: dónde puso los números. */
  disposicion?: DisposicionNumero;
};

/** Estilos y disposiciones que Python admite para la pieza. */
export type OpcionesArmado = { variantes: VarianteBouquet[]; disposiciones: DisposicionNumero[] };

/** La vista previa con las opciones que Python admite para la pieza. */
export type VistaArmado = { armado: ArmadoBouquetResuelto; opciones: OpcionesArmado };

/** Solo los campos del contrato: la ruta es estricta y una `LineaMaterial` trae muchos más. */
export function globoVistaArmado(globo: GloboVistaArmado): GloboVistaArmado {
  return {
    product_id: globo.product_id,
    variant_id: globo.variant_id,
    titulo: globo.titulo,
    ...(globo.forma === undefined ? {} : { forma: globo.forma }),
    ...(globo.diam_pulg === undefined ? {} : { diam_pulg: globo.diam_pulg }),
    ...(globo.tamano_codigo === undefined ? {} : { tamano_codigo: globo.tamano_codigo }),
    ...(globo.color === undefined ? {} : { color: globo.color }),
    ...(globo.acabado === undefined ? {} : { acabado: globo.acabado }),
  };
}

function cuerpoVistaArmado(cuerpo: PeticionVistaArmado): PeticionVistaArmado {
  return { ...cuerpo, globos: cuerpo.globos.map(globoVistaArmado) };
}

/**
 * Fallo de /api/plan-armado-bouquet o de la acción `armado` de /api/plan-editar
 * cuyo `message` ya se puede mostrar al decorador. Es un `FalloPlanEditar`.
 */
export class FalloPlanArmado extends FalloPlanEditar {
  /** Python rechazó el armado: reintentar daría lo mismo y el mensaje dice qué corregir. */
  readonly armadoInvalido: boolean;
  /** Motivo estable del rechazo, si el cuerpo lo trae. */
  readonly motivo: string | null;
  /** Estilos y disposiciones que Python admite para la pieza, si el rechazo los trae. */
  readonly opciones: OpcionesArmado | null;

  constructor(mensajeCliente: string, opciones: { armadoInvalido?: boolean; motivo?: string | null; opciones?: OpcionesArmado | null; cause?: unknown } = {}) {
    super(mensajeCliente, { cause: opciones.cause });
    this.name = "FalloPlanArmado";
    this.motivo = opciones.motivo ?? null;
    this.armadoInvalido = opciones.armadoInvalido ?? this.motivo !== null;
    this.opciones = opciones.opciones ?? null;
  }
}

const LARGO_MAXIMO_MENSAJE = 400;
const CODIGO_ARMADO_INVALIDO = "armado_invalido";
const CAUSA_ARMADO_INVALIDO = "ARMADO_INVALIDO";
const VariantesSchema = z.array(z.enum(VARIANTES_BOUQUET)).max(VARIANTES_BOUQUET.length);
const DisposicionesSchema = z.array(z.enum(DISPOSICIONES_NUMERO)).max(DISPOSICIONES_NUMERO.length);
const OpcionesSchema = z.object({ variantes_admitidas: VariantesSchema, disposiciones_admitidas: DisposicionesSchema });

function campoTexto(valor: unknown, clave: string): string | undefined {
  if (typeof valor !== "object" || valor === null || !(clave in valor)) return undefined;
  const campo = (valor as Record<string, unknown>)[clave];
  return typeof campo === "string" && campo.trim() ? campo.trim() : undefined;
}

/** Las opciones de la pieza si el cuerpo trae las dos listas completas; si no, ninguna. */
function opcionesDe(datos: unknown): OpcionesArmado | null {
  const leidas = OpcionesSchema.safeParse(datos);
  return leidas.success ? { variantes: leidas.data.variantes_admitidas, disposiciones: leidas.data.disposiciones_admitidas } : null;
}

export type ErrorArmadoLeido = { mensaje: string; motivo: string | null; armadoInvalido: boolean; opciones: OpcionesArmado | null };

/**
 * Lee un cuerpo de error de /api/plan-armado-bouquet o /api/plan-editar. El
 * rechazo del armado se reconoce venga como venga: `motivo` y `mensaje` en el
 * nivel superior, `error: "armado_invalido"`, `causa: "ARMADO_INVALIDO"` o solo
 * el `ui_error` (su `detalles_dev.causa`; el motivo va en `codigo_origen`,
 * "ARMADO_INVALIDO:helio_con_latex_chico"). El texto: el `mensaje` de Python,
 * si no el `ui_error` válido y, sin él, `MENSAJE_ARMADO_INVALIDO` o el respaldo.
 */
export function leerErrorArmado(datos: unknown, respaldo: string): ErrorArmadoLeido {
  const ui = leerUiErrorV1(datos);
  const motivoPlano = campoTexto(datos, "motivo");
  const mensajePlano = campoTexto(datos, "mensaje");
  const mensajePython = mensajePlano && mensajePlano.length <= LARGO_MAXIMO_MENSAJE ? mensajePlano : undefined;
  const origenUi = ui?.detalles_dev.causa === CAUSA_ARMADO_INVALIDO ? ui.detalles_dev.codigo_origen : undefined;
  const motivoUi = origenUi?.startsWith(`${CAUSA_ARMADO_INVALIDO}:`) ? origenUi.slice(CAUSA_ARMADO_INVALIDO.length + 1) || undefined : undefined;
  const armadoInvalido = Boolean(motivoPlano && mensajePython)
    || campoTexto(datos, "error") === CODIGO_ARMADO_INVALIDO
    || campoTexto(datos, "causa") === CAUSA_ARMADO_INVALIDO
    || ui?.detalles_dev.causa === CAUSA_ARMADO_INVALIDO;
  if (!armadoInvalido) return { mensaje: mensajeErrorRespuesta(datos, respaldo), motivo: null, armadoInvalido: false, opciones: null };
  return {
    mensaje: mensajePython ?? mensajeErrorRespuesta(datos, MENSAJE_ARMADO_INVALIDO),
    motivo: motivoPlano ?? motivoUi ?? null,
    armadoInvalido: true,
    opciones: opcionesDe(datos),
  };
}

/** POST JSON con los errores de este módulo; devuelve el cuerpo de una respuesta 2xx sin validar. */
async function publicar(url: string, cuerpo: unknown, respaldo: string, opciones: { signal?: AbortSignal; fetcher?: typeof fetch }): Promise<unknown> {
  const fetcher = opciones.fetcher ?? fetch;
  let respuesta: Response;
  try {
    respuesta = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: opciones.signal,
      body: JSON.stringify(cuerpo),
    });
  } catch (error) {
    if (esCancelacion(error)) throw error;
    throw new FalloPlanArmado(CATALOGO_ERRORES_UI_V1.SIN_CONEXION.mensaje_usuario, { cause: error });
  }
  let datos: unknown;
  try {
    datos = await respuesta.json();
  } catch (error) {
    if (esCancelacion(error)) throw error;
    throw new FalloPlanArmado(respaldo, { cause: error });
  }
  if (!respuesta.ok) {
    const { mensaje, motivo, armadoInvalido, opciones: admitidas } = leerErrorArmado(datos, respaldo);
    throw new FalloPlanArmado(mensaje, { motivo, armadoInvalido, opciones: admitidas });
  }
  return datos;
}

/**
 * POST a /api/plan-armado-bouquet. Devuelve el `ArmadoBouquetResuelto`
 * validado de la estructura pedida y las opciones que Python admite para la
 * pieza. Una cancelación se relanza tal cual; cualquier otro fallo es un
 * `FalloPlanArmado`.
 */
export async function pedirVistaArmado(
  cuerpo: PeticionVistaArmado,
  opciones: { signal?: AbortSignal; fetcher?: typeof fetch; respaldo?: string } = {},
): Promise<VistaArmado> {
  const respaldo = opciones.respaldo ?? RESPALDO_VISTA_ARMADO;
  const datos = await publicar("/api/plan-armado-bouquet", cuerpoVistaArmado(cuerpo), respaldo, opciones);
  const objeto = typeof datos === "object" && datos !== null ? (datos as Record<string, unknown>) : {};
  const armado = ArmadoBouquetResueltoSchema.safeParse(objeto.armado);
  const admitidas = opcionesDe(objeto);
  // Una respuesta que no es un armado resuelto, o que es de otra estructura, no se dibuja.
  if (!armado.success || !admitidas || armado.data.estructura_id !== cuerpo.estructura_id) {
    throw new FalloPlanArmado(respaldo, { cause: armado.success ? undefined : armado.error });
  }
  return { armado: armado.data, opciones: admitidas };
}

/**
 * POST a /api/plan-editar para la acción `armado` (ADR-0030). Misma firma y
 * mismo resultado que `pedirPlanEditar` (el cuerpo 2xx sin validar), pero un
 * rechazo del armado llega con la frase de Python y `armadoInvalido`.
 */
export async function pedirPlanEditarArmado(
  cuerpo: unknown,
  respaldo: string,
  opciones: { signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<unknown> {
  return publicar("/api/plan-editar", cuerpo, respaldo, opciones);
}

/** Texto para el decorador de cualquier fallo capturado: el de `FalloPlanArmado` o el respaldo. */
export function mensajeFalloPlanArmado(error: unknown, respaldo = RESPALDO_VISTA_ARMADO): string {
  return error instanceof FalloPlanArmado ? error.message : respaldo;
}
