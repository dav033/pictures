import { CATALOGO_ERRORES_UI_V1, leerUiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";
import { PatronColorResueltoSchema, type PatronColor, type PatronColorResuelto } from "./patron-color";
import { esCancelacion, FalloPlanEditar, mensajeErrorRespuesta } from "./peticion-plan-editar";
import type { PlanResuelto } from "./resuelto";

/**
 * Vista previa del editor de patrones: el navegador manda el patrón
 * declarativo a /api/plan-patron y recibe la rejilla, el conteo y los textos
 * que escribe Python (ADR-0028 §10). Aquí no se expande ni se cuenta nada; la
 * respuesta se valida con el mismo esquema que viaja en `plan_resuelto`.
 *
 * Errores con el estilo de `peticion-plan-editar.ts`: nunca el texto técnico
 * del navegador ni el `error` crudo del servidor. Un patrón que Python rechaza
 * (`patron_invalido`) trae `motivo` estable y `mensaje` en español para el
 * decorador ("Negro no aparece en el patrón"): ese mensaje sí se muestra, tal
 * cual, junto al borrador. Lo mismo al aplicarlo (acción `patron` de
 * /api/plan-editar). Sin React.
 */

export const RESPALDO_VISTA_PATRON = "No pude dibujar el patrón. Intenta de nuevo en un momento.";
/** Rechazo del patrón que llega sin la frase de Python (un servidor anterior o un cuerpo recortado). */
export const MENSAJE_PATRON_INVALIDO = "Ese patrón no se puede armar así en esta pieza: cambia el estilo o sus colores.";

export type PeticionVistaPatron = {
  plan: PlanResuelto["plan"];
  estructura_id: string;
  /** `null` pide la sugerencia de Python para una estructura sin patrón. */
  patron_color: PatronColor | null;
  /**
   * Deslizador de colores sobre un confeti, mientras se arrastra (con
   * `patron_color: null`): Python dibuja el mismo reparto que guardará la
   * edición `repartir`, sin guardarlo.
   */
  participaciones?: number[];
};

/**
 * Fallo de /api/plan-patron o de la acción `patron` de /api/plan-editar cuyo
 * `message` ya se puede mostrar al decorador. Es un `FalloPlanEditar`: quien
 * ya sabe mostrar esos fallos (`mensajeFalloPlanEditar`) muestra también este.
 */
export class FalloPlanPatron extends FalloPlanEditar {
  /** Python rechazó el patrón: el borrador sigue editable, reintentar daría lo mismo y el mensaje dice qué corregir. */
  readonly patronInvalido: boolean;
  /** Motivo estable del rechazo (`material_sin_uso`…), si el cuerpo lo trae. */
  readonly motivo: string | null;

  constructor(mensajeCliente: string, opciones: { patronInvalido?: boolean; motivo?: string | null; cause?: unknown } = {}) {
    super(mensajeCliente, { cause: opciones.cause });
    this.name = "FalloPlanPatron";
    this.motivo = opciones.motivo ?? null;
    this.patronInvalido = opciones.patronInvalido ?? this.motivo !== null;
  }
}

const LARGO_MAXIMO_MENSAJE = 400;
const CODIGO_PATRON_INVALIDO = "patron_invalido";
const CAUSA_PATRON_INVALIDO = "PATRON_INVALIDO";

function campoTexto(valor: unknown, clave: string): string | undefined {
  if (typeof valor !== "object" || valor === null || !(clave in valor)) return undefined;
  const campo = (valor as Record<string, unknown>)[clave];
  return typeof campo === "string" && campo.trim() ? campo.trim() : undefined;
}

export type ErrorPatronLeido = { mensaje: string; motivo: string | null; patronInvalido: boolean };

/**
 * Lee un cuerpo de error de /api/plan-patron o /api/plan-editar. El rechazo
 * del patrón se reconoce venga como venga: `motivo` y `mensaje` en el nivel
 * superior, `error: "patron_invalido"`, `causa: "PATRON_INVALIDO"` o solo el
 * `ui_error` (su `detalles_dev.causa`; el motivo va en `codigo_origen`,
 * "PATRON_INVALIDO:material_sin_uso"). El texto: el `mensaje` de Python, si
 * no el `ui_error` válido y, sin él, `MENSAJE_PATRON_INVALIDO` o el respaldo
 * de quien llama.
 */
export function leerErrorPatron(datos: unknown, respaldo: string): ErrorPatronLeido {
  const ui = leerUiErrorV1(datos);
  const motivoPlano = campoTexto(datos, "motivo");
  const mensajePlano = campoTexto(datos, "mensaje");
  const mensajePython = mensajePlano && mensajePlano.length <= LARGO_MAXIMO_MENSAJE ? mensajePlano : undefined;
  const origenUi = ui?.detalles_dev.causa === CAUSA_PATRON_INVALIDO ? ui.detalles_dev.codigo_origen : undefined;
  const motivoUi = origenUi?.startsWith(`${CAUSA_PATRON_INVALIDO}:`) ? origenUi.slice(CAUSA_PATRON_INVALIDO.length + 1) || undefined : undefined;
  const patronInvalido = Boolean(motivoPlano && mensajePython)
    || campoTexto(datos, "error") === CODIGO_PATRON_INVALIDO
    || campoTexto(datos, "causa") === CAUSA_PATRON_INVALIDO
    || ui?.detalles_dev.causa === CAUSA_PATRON_INVALIDO;
  if (!patronInvalido) return { mensaje: mensajeErrorRespuesta(datos, respaldo), motivo: null, patronInvalido: false };
  return {
    mensaje: mensajePython ?? mensajeErrorRespuesta(datos, MENSAJE_PATRON_INVALIDO),
    motivo: motivoPlano ?? motivoUi ?? null,
    patronInvalido: true,
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
    throw new FalloPlanPatron(CATALOGO_ERRORES_UI_V1.SIN_CONEXION.mensaje_usuario, { cause: error });
  }
  let datos: unknown;
  try {
    datos = await respuesta.json();
  } catch (error) {
    if (esCancelacion(error)) throw error;
    throw new FalloPlanPatron(respaldo, { cause: error });
  }
  if (!respuesta.ok) {
    const { mensaje, motivo, patronInvalido } = leerErrorPatron(datos, respaldo);
    throw new FalloPlanPatron(mensaje, { motivo, patronInvalido });
  }
  return datos;
}

/**
 * POST a /api/plan-patron. Devuelve el `PatronColorResuelto` validado de la
 * estructura pedida. Una cancelación se relanza tal cual para que el llamador
 * la ignore; cualquier otro fallo es un `FalloPlanPatron`.
 */
export async function pedirVistaPatron(
  cuerpo: PeticionVistaPatron,
  opciones: { signal?: AbortSignal; fetcher?: typeof fetch; respaldo?: string } = {},
): Promise<PatronColorResuelto> {
  const respaldo = opciones.respaldo ?? RESPALDO_VISTA_PATRON;
  const datos = await publicar("/api/plan-patron", cuerpo, respaldo, opciones);
  const patron = typeof datos === "object" && datos !== null ? (datos as Record<string, unknown>).patron : undefined;
  const validado = PatronColorResueltoSchema.safeParse(patron);
  // Una respuesta que no es un patrón resuelto, o que es de otra estructura, no se dibuja.
  if (!validado.success || validado.data.estructura_id !== cuerpo.estructura_id) {
    throw new FalloPlanPatron(respaldo, { cause: validado.success ? undefined : validado.error });
  }
  return validado.data;
}

/**
 * POST a /api/plan-editar para la acción `patron` (ADR-0028 §9). Misma firma
 * y mismo resultado que `pedirPlanEditar` (el cuerpo 2xx sin validar), pero un
 * rechazo del patrón llega con la frase de Python y `patronInvalido`, no con
 * el mensaje genérico de la edición.
 */
export async function pedirPlanEditarPatron(
  cuerpo: unknown,
  respaldo: string,
  opciones: { signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<unknown> {
  return publicar("/api/plan-editar", cuerpo, respaldo, opciones);
}

/** Texto para el decorador de cualquier fallo capturado: el de `FalloPlanPatron` o el respaldo. */
export function mensajeFalloPlanPatron(error: unknown, respaldo = RESPALDO_VISTA_PATRON): string {
  return error instanceof FalloPlanPatron ? error.message : respaldo;
}
