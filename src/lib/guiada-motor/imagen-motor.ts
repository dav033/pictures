import "server-only";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import { exigirEscritura } from "@/lib/feedback-ia/acceso";
import { conLimite, guardarImagenLista, marcarImagenEnCurso, marcarImagenFallida, solicitudImagenDe, type ConsultorPg, type ResultadoEscritura } from "@/lib/generacion/imagen-recuperable";
import type { ImagenAligerada, ImagenBase64 } from "@/lib/generacion/imagen-liviana";
import { especHashDe, svgDeArmada, VERSION_MOTOR, type DescripcionImagen, type EspecClienteV1, type ResultadoMotorV1 } from "@/lib/globos3d/motor/v1";
import type { TomaDeFoto } from "@/lib/globos3d/tope-fotos-hora";
import { capturaDesdeSvg, esRechazo, prepararCaptura, type CapturaPreparada } from "./captura-imagen";
import { CuerpoImagenSchema, MAX_CARACTERES_CUERPO_IMAGEN } from "./imagen-contrato";
import { CODIGO_MOTOR_3D_CORTADO, crearAuditoriaDeCortes, drenarCuerpo, etiquetaDelCorte } from "./corte-motor3d";
import { TEXTO_DIBUJO_RECALCULO } from "./mensajes-cliente";
import { huellaDeNavegador } from "./plan-motor";
import { promptImagenGuiada } from "./render-ia-guiada";
import { devolverImagenDeNavegador, tomarImagenDeNavegador } from "./tope-imagenes-navegador";
import type { RespuestaMotor } from "./tipos";
import { verificarPlanFirmado, type RechazoPlan } from "./verificar-plan";
import { KontextEnCursoError, SolicitudKontextInvalidaError } from "@/lib/ia/kagutsuchi/kontext";
import { ambitoDeKontext, respuestaKontextEnCurso, solicitudPreviaDe } from "@/lib/ia/kagutsuchi/solicitud-kontext";
import { CODIGO_SOLICITUD_KONTEXT_INVALIDA } from "@/lib/generacion/solicitud-kontext-contrato";

/**
 * Lógica de `POST /api/guiada/motor/imagen` (REQ-007, fase 4): «Ver cómo quedaría» de un plan armado por el motor 3D. Es la
 * ruta que PAGA una imagen (FLUX.1 Kontext max, ~US$0,08), así que las comprobaciones baratas van antes del cupo y el cupo
 * antes de la llamada. Hay dos cupos por hora: el de cada navegador (`tope-imagenes-navegador.ts`, 6) y el global de la
 * instancia (30, compartido con el Taller).
 *
 * Qué manda y qué no:
 * - el plan se prueba como en la ruta de la armada: sesión, mismo origen y token `globos3d` atado a ESTE navegador, con la
 *   espec firmada (`verificar-plan.ts`); un token de Python, de otro navegador o con la espec cambiada responde 409;
 * - el texto que va a FLUX sale SOLO de esa espec firmada, vuelta a armar y contada por el motor (`descripcionImagenDeEspec`) y
 *   del texto fijo de `render-ia-guiada.ts`: nada de lo que el navegador escribió (nombres de piezas o de colores, el pedido
 *   del cliente) llega al prompt. Del navegador entran píxeles: la captura del visor, que se reabre y se recodifica;
 * - el plan debe ser de la versión vigente del motor (si no, la escena contada podría no ser la que el cliente vio): 409.
 *
 * - el corte del 3D (P-045, `fuente: "corte"`) lo frena antes de verificar nada: 409 `MOTOR_3D_CORTADO` y no se gasta cupo.
 *
 * Qué no hace: no cotiza, no llama a Python ni a un modelo de texto. Con la bandera en `python` un plan 3D en pantalla se sigue
 * dibujando. El servidor no guarda la imagen (pedido del dueño, 2026-10-07):
 * `ALMACENAR_IMAGEN_EN_SERVIDOR` enciende la misma recuperación de `imagen-recuperable.ts` que usa /api/generate, apagada igual
 * que allá.
 */
export const ALMACENAR_IMAGEN_EN_SERVIDOR: boolean = false;

export type CodigoImagenMotor = RechazoPlan["codigo"] | typeof CODIGO_MOTOR_3D_CORTADO | "CUERPO_INVALIDO" | "SESION_REQUERIDA" | "CAPTURA_INVALIDA" | "PLAN_NO_REPRESENTABLE" | "TOPE_DE_IMAGENES" | "TOPE_DE_IMAGENES_NAVEGADOR" | "NO_SE_PUDO_DIBUJAR" | typeof CODIGO_SOLICITUD_KONTEXT_INVALIDA;

export type DependenciasImagen = {
  leerBandera: (request: Request) => Promise<RespuestaMotor>;
  /** Qué conversación y plan ya quedaron registrados como cortados (una fila por cada uno). Sin él, cada rechazo se registra. */
  auditoriaCortes?: ReturnType<typeof crearAuditoriaDeCortes>;
  describir: (espec: EspecClienteV1) => DescripcionImagen;
  /** Solo para la imagen base sin captura: la armada que se proyecta a SVG. */
  armar: (espec: EspecClienteV1) => Pick<ResultadoMotorV1, "armada">;
  /**
   * FLUX.1 Kontext max con la imagen base y el texto; la señal corta la llamada si el navegador se va. Con `solicitudPrevia` retoma la
   * solicitud que ya está en curso en fal en vez de enviar otra. Si el plazo se acaba con la imagen ya pagada lanza `KontextEnCursoError`.
   */
  generar: (prompt: string, base: CapturaPreparada, senal: AbortSignal, solicitudPrevia?: string) => Promise<ImagenBase64>;
  aligerar: (imagen: ImagenBase64) => Promise<ImagenAligerada>;
  /** El cupo por hora compartido con el Taller y el estudio de módulos. */
  tomarFoto: () => TomaDeFoto;
  /** El cupo por hora de este navegador (su huella), encima del global: uno solo no puede gastarse el de todos. Se devuelve si el global se niega. */
  tomarFotoDeNavegador: (navegador: string) => TomaDeFoto;
  devolverFotoDeNavegador: (navegador: string) => void;
  /** Dónde guardar la imagen para recuperarla tras un corte, o `null` (el servidor no la guarda). */
  almacen: (() => ConsultorPg) | null;
  auditar: (quien: string, que: string, resultado: unknown, extra?: { entrada?: unknown; motivo?: string }) => void;
};

const SIN_CACHE = { "Cache-Control": "no-store" } as const;
const ESCRITURA_VENCIDA: ResultadoEscritura = { ok: false, error: "la base no respondió a tiempo" };

function error(codigo: CodigoImagenMotor, mensaje: string, estado: number): Response {
  return Response.json({ error: mensaje, codigo }, { status: estado, headers: SIN_CACHE });
}

export async function atenderImagenMotor(request: Request, deps: DependenciasImagen): Promise<Response> {
  if (!isAuthenticatedRequest(request)) return error("SESION_REQUERIDA", "Sesión requerida.", 401);
  const acceso = exigirEscritura(request);
  if ("respuesta" in acceso) return acceso.respuesta;
  // El corte se decide con la cookie y la bandera, antes de validar el cuerpo. Es intencional que también frene las
  // peticiones de retomar una imagen ya pagada en fal (token de solicitud previa): el corte manda sobre la retoma, la imagen en
  // curso se pierde para este navegador y el cliente recibe el aviso de recálculo en lugar de otra imagen.
  const bandera = await deps.leerBandera(request);
  if (bandera.fuente === "corte") return rechazoCortado(request, deps, bandera);
  return acceso.conCookie(await atender(request, deps, huellaDeNavegador(acceso.usuarioId)));
}

async function rechazoCortado(request: Request, deps: DependenciasImagen, bandera: RespuestaMotor): Promise<Response> {
  const etiqueta = await etiquetaDelCorte(request);
  if (!deps.auditoriaCortes || deps.auditoriaCortes.primeraVez(etiqueta)) {
    deps.auditar("regla:imagen_guiada_3d", "imagen del plan 3D: el motor 3D está cortado; no se dibuja ni se paga la imagen", { bandera: bandera.motor, fuente: bandera.fuente, efectivo: "ninguno", razon: "motor_3d_cortado" }, { entrada: { plan_hash: etiqueta.planHash }, motivo: TEXTO_DIBUJO_RECALCULO });
  }
  drenarCuerpo(request);
  return error(CODIGO_MOTOR_3D_CORTADO, TEXTO_DIBUJO_RECALCULO, 409);
}

async function atender(request: Request, deps: DependenciasImagen, navegador: string): Promise<Response> {
  // Un cuerpo enorme se rechaza por su cabecera, sin leerlo.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_CARACTERES_CUERPO_IMAGEN) return error("CUERPO_INVALIDO", "Cuerpo inválido.", 400);
  const texto = await request.text().catch(() => "");
  if (!texto || texto.length > MAX_CARACTERES_CUERPO_IMAGEN) return error("CUERPO_INVALIDO", "Cuerpo inválido.", 400);
  let json: unknown;
  try { json = JSON.parse(texto); } catch { return error("CUERPO_INVALIDO", "El cuerpo debe ser JSON válido.", 400); }
  const leido = CuerpoImagenSchema.safeParse(json);
  if (!leido.success) return error("CUERPO_INVALIDO", "La solicitud no tiene un formato válido.", 400);
  const cuerpo = leido.data;
  const entrada = { plan_hash: cuerpo.plan_hash, ambiente: cuerpo.ambiente, conCaptura: Boolean(cuerpo.captura) };

  const verificado = verificarPlanFirmado(cuerpo, navegador);
  if ("codigo" in verificado) {
    deps.auditar("regla:imagen_guiada_3d", "imagen del plan 3D: el plan que mandó el navegador no se acepta", { razon: verificado.codigo, motivo: verificado.motivo }, { entrada, motivo: verificado.mensaje });
    return error(verificado.codigo, verificado.mensaje, verificado.estado);
  }
  const espec = verificado.espec;
  if (especHashDe(espec, VERSION_MOTOR) !== cuerpo.plan_hash) {
    deps.auditar("regla:imagen_guiada_3d", "imagen del plan 3D: el plan es de otra versión del motor", { versionPlan: cuerpo.motor.version, versionMotor: VERSION_MOTOR }, { entrada });
    return error("PLAN_ALTERADO", "El plan es de otra versión del motor: vuelve a pedirlo.", 409);
  }

  let base: CapturaPreparada;
  let descripcion: DescripcionImagen;
  try {
    descripcion = deps.describir(espec);
    if (descripcion.noRepresentable.length) {
      deps.auditar("regla:imagen_guiada_3d", "imagen del plan 3D: hay piezas que el motor no dibuja", { piezas: descripcion.noRepresentable }, { entrada });
      return error("PLAN_NO_REPRESENTABLE", "Este plan tiene piezas que todavía no se pueden dibujar como imagen.", 422);
    }
    if (cuerpo.captura) {
      const captura = await prepararCaptura(cuerpo.captura);
      if (esRechazo(captura)) {
        deps.auditar("regla:imagen_guiada_3d", "imagen del plan 3D: la captura no sirve", { motivo: captura.motivo }, { entrada });
        return error("CAPTURA_INVALIDA", "La captura de la vista no es una imagen válida.", 400);
      }
      base = captura;
    } else {
      base = await capturaDesdeSvg(svgDeArmada(deps.armar(espec).armada, { vista: cuerpo.vista ?? "tres-cuartos", lado: 1024, titulo: "Plan 3D" }));
    }
  } catch (causa) {
    console.warn("[guiada-motor] no se pudo preparar la imagen del plan 3D", causa instanceof Error ? causa.message : causa);
    // 422 y no 500: preparar la misma espec otra vez falla igual, así que el cliente no lo reintenta solo.
    return error("NO_SE_PUDO_DIBUJAR", "No pude preparar la imagen del plan.", 422);
  }

  const prompt = promptImagenGuiada(descripcion.descripcion, cuerpo.ambiente);
  // Retomar una imagen que sigue en curso no es otra imagen: no gasta cupo. Un token que no sirve se rechaza, nunca se envía otra solicitud en silencio (sería pagar dos veces).
  // El token queda atado a este navegador, a este texto y a esta vista (la captura o la cámara): ni otro plan, ni otro navegador, ni una vista
  // distinta pueden recibir la imagen de una solicitud ajena.
  const ambito = ambitoDeKontext(navegador, prompt, cuerpo.vista, cuerpo.captura);
  const previa = solicitudPreviaDe(request.headers, ambito);
  if (previa.tipo === "invalida") {
    deps.auditar("regla:imagen_guiada_3d", "imagen del plan 3D: el token para retomar la solicitud en curso no sirve", { razon: "token_invalido_o_vencido" }, { entrada });
    return error(CODIGO_SOLICITUD_KONTEXT_INVALIDA, "No pude retomar la imagen en curso. Vuelve a pedirla.", 409);
  }
  if (previa.tipo === "ninguna") {
    const delNavegador = deps.tomarFotoDeNavegador(navegador);
    if (!delNavegador.ok) {
      deps.auditar("regla:render_3d_tope", "tope de imágenes por hora de un navegador (imagen del plan 3D de la guiada)", { usadas: delNavegador.usadas, tope: delNavegador.tope }, { entrada });
      return error("TOPE_DE_IMAGENES_NAVEGADOR", "Ya generaste varias imágenes en esta hora. Inténtalo de nuevo más tarde.", 429);
    }
    const toma = deps.tomarFoto();
    if (!toma.ok) {
      deps.devolverFotoDeNavegador(navegador);
      deps.auditar("regla:render_3d_tope", "tope de imágenes por hora (imagen del plan 3D de la guiada)", { usadas: toma.usadas, tope: toma.tope }, { entrada });
      return error("TOPE_DE_IMAGENES", "Se alcanzó el límite de imágenes por hora. Inténtalo más tarde.", 429);
    }
  }

  deps.auditar("regla:imagen_guiada_3d_prompt", "texto e imagen base que van a FLUX desde la guiada (plan 3D)", {
    prompt, largo: prompt.length, ambiente: cuerpo.ambiente, camino: "flux1_kontext_max", origenBase: cuerpo.captura ? "captura_del_navegador" : "svg_del_servidor", bytesBase: base.bytes, ancho: base.ancho, alto: base.alto,
    ...(previa.tipo === "retomar" ? { retoma: previa.requestId } : {}),
  }, { entrada });

  const solicitudId = solicitudImagenDe(request.headers);
  const db = solicitudId && deps.almacen ? deps.almacen() : null;
  const guardar = db && solicitudId ? { db, solicitudId, planHash: cuerpo.plan_hash } : null;
  const enCurso = guardar ? marcarImagenEnCurso(guardar.db, guardar) : null;
  try {
    const hecha = await deps.generar(prompt, base, request.signal, previa.tipo === "retomar" ? previa.requestId : undefined);
    const liviana = await deps.aligerar(hecha);
    if (guardar) {
      await enCurso?.catch(() => undefined);
      const guardada = await conLimite(guardarImagenLista(guardar.db, { ...guardar, mime: liviana.mime, bytes: liviana.bytes }), 5_000, ESCRITURA_VENCIDA);
      deps.auditar("regla:imagen_recuperable_guardada", "la imagen del plan 3D quedó guardada para recuperarla si la respuesta se corta", guardada.ok ? "guardada" : "no_guardada", { entrada: { solicitudId }, ...(guardada.ok ? {} : { motivo: guardada.error }) });
    }
    return Response.json({ imagen: `data:${liviana.mime};base64,${liviana.base64}`, motorImagen: "flux-kontext-max" }, { headers: SIN_CACHE });
  } catch (causa) {
    if (causa instanceof KontextEnCursoError) {
      // La solicitud sigue viva y pagada en fal: no es un fallo (la fila de la recuperación queda «en_curso»); el navegador la retoma con el token.
      deps.auditar("regla:imagen_guiada_3d_en_curso", "fal sigue generando la imagen del plan 3D: el navegador la retoma por su id, sin enviar otra", { solicitud: causa.requestId }, { entrada });
      return respuestaKontextEnCurso(causa, ambito);
    }
    if (causa instanceof SolicitudKontextInvalidaError) {
      // fal ya no tiene la solicitud (FAILED, vencida o perdida): el token no sirve y el navegador pide una imagen nueva.
      deps.auditar("regla:imagen_guiada_3d", "imagen del plan 3D: fal ya no tiene la solicitud que se quería retomar", { solicitud: causa.requestId, motivo: causa.message.slice(0, 200) }, { entrada });
      return error(CODIGO_SOLICITUD_KONTEXT_INVALIDA, "No pude retomar la imagen en curso. Vuelve a pedirla.", 409);
    }
    const mensaje = causa instanceof Error ? causa.message : String(causa);
    deps.auditar("regla:render_3d_error", "FLUX no devolvió la imagen del plan 3D", { mensaje: mensaje.slice(0, 300) }, { entrada });
    if (guardar) {
      await enCurso?.catch(() => undefined);
      await conLimite(marcarImagenFallida(guardar.db, guardar), 3_000, ESCRITURA_VENCIDA);
    }
    return error("NO_SE_PUDO_DIBUJAR", "No pude generar la imagen ahora. Vuelve a intentarlo en un momento.", 502);
  }
}
