import "server-only";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import { exigirEscritura } from "@/lib/feedback-ia/acceso";
import { conLimite, guardarImagenLista, marcarImagenEnCurso, marcarImagenFallida, solicitudImagenDe, type ConsultorPg, type ResultadoEscritura } from "@/lib/generacion/imagen-recuperable";
import type { ImagenAligerada, ImagenBase64 } from "@/lib/generacion/imagen-liviana";
import { especHashDe, svgDeArmada, VERSION_MOTOR, type DescripcionImagen, type EspecClienteV1, type ResultadoMotorV1 } from "@/lib/globos3d/motor/v1";
import type { TomaDeFoto } from "@/lib/globos3d/tope-fotos-hora";
import { capturaDesdeSvg, esRechazo, prepararCaptura, type CapturaPreparada } from "./captura-imagen";
import { CuerpoImagenSchema, MAX_CARACTERES_CUERPO_IMAGEN } from "./imagen-contrato";
import { huellaDeNavegador } from "./plan-motor";
import { promptImagenGuiada } from "./render-ia-guiada";
import { verificarPlanFirmado, type RechazoPlan } from "./verificar-plan";

/**
 * Lógica de `POST /api/guiada/motor/imagen` (REQ-007, fase 4): «Ver cómo quedaría» de un plan armado por el motor 3D. Es la
 * ruta que PAGA una imagen (FLUX.1 Kontext max, ~US$0,08), así que las comprobaciones baratas van antes del cupo y el cupo
 * antes de la llamada.
 *
 * Qué manda y qué no:
 * - el plan se prueba como en la ruta de la armada: sesión, mismo origen y token `globos3d` atado a ESTE navegador, con la
 *   espec firmada (`verificar-plan.ts`); un token de Python, de otro navegador o con la espec cambiada responde 409;
 * - el texto que va a FLUX sale SOLO de esa espec firmada, vuelta a armar y contada por el motor (`descripcionImagenDeEspec`) y
 *   del texto fijo de `render-ia-guiada.ts`: nada de lo que el navegador escribió (nombres de piezas o de colores, el pedido
 *   del cliente) llega al prompt. Del navegador entran píxeles: la captura del visor, que se reabre y se recodifica;
 * - el plan debe ser de la versión vigente del motor (si no, la escena contada podría no ser la que el cliente vio): 409.
 *
 * Qué no hace: no cotiza, no llama a Python ni a un modelo de texto, y no mira la bandera (un plan 3D en pantalla se sigue
 * dibujando aunque la bandera cambie). El servidor no guarda la imagen (pedido del dueño, 2026-10-07):
 * `ALMACENAR_IMAGEN_EN_SERVIDOR` enciende la misma recuperación de `imagen-recuperable.ts` que usa /api/generate, apagada igual
 * que allá.
 */
export const ALMACENAR_IMAGEN_EN_SERVIDOR: boolean = false;

export type CodigoImagenMotor = RechazoPlan["codigo"] | "CUERPO_INVALIDO" | "SESION_REQUERIDA" | "CAPTURA_INVALIDA" | "PLAN_NO_REPRESENTABLE" | "TOPE_DE_IMAGENES" | "NO_SE_PUDO_DIBUJAR";

export type DependenciasImagen = {
  describir: (espec: EspecClienteV1) => DescripcionImagen;
  /** Solo para la imagen base sin captura: la armada que se proyecta a SVG. */
  armar: (espec: EspecClienteV1) => Pick<ResultadoMotorV1, "armada">;
  /** FLUX.1 Kontext max con la imagen base y el texto; la señal corta la llamada si el navegador se va. */
  generar: (prompt: string, base: CapturaPreparada, senal: AbortSignal) => Promise<ImagenBase64>;
  aligerar: (imagen: ImagenBase64) => Promise<ImagenAligerada>;
  /** El cupo por hora compartido con el Taller y el estudio de módulos. */
  tomarFoto: () => TomaDeFoto;
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
  return acceso.conCookie(await atender(request, deps, huellaDeNavegador(acceso.usuarioId)));
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

  const toma = deps.tomarFoto();
  if (!toma.ok) {
    deps.auditar("regla:render_3d_tope", "tope de imágenes por hora (imagen del plan 3D de la guiada)", { usadas: toma.usadas, tope: toma.tope }, { entrada });
    return error("TOPE_DE_IMAGENES", "Se alcanzó el límite de imágenes por hora. Inténtalo más tarde.", 429);
  }

  const prompt = promptImagenGuiada(descripcion.descripcion, cuerpo.ambiente);
  deps.auditar("regla:imagen_guiada_3d_prompt", "texto e imagen base que van a FLUX desde la guiada (plan 3D)", {
    prompt, largo: prompt.length, ambiente: cuerpo.ambiente, camino: "flux1_kontext_max", origenBase: cuerpo.captura ? "captura_del_navegador" : "svg_del_servidor", bytesBase: base.bytes, ancho: base.ancho, alto: base.alto,
  }, { entrada });

  const solicitudId = solicitudImagenDe(request.headers);
  const db = solicitudId && deps.almacen ? deps.almacen() : null;
  const guardar = db && solicitudId ? { db, solicitudId, planHash: cuerpo.plan_hash } : null;
  const enCurso = guardar ? marcarImagenEnCurso(guardar.db, guardar) : null;
  try {
    const hecha = await deps.generar(prompt, base, request.signal);
    const liviana = await deps.aligerar(hecha);
    if (guardar) {
      await enCurso?.catch(() => undefined);
      const guardada = await conLimite(guardarImagenLista(guardar.db, { ...guardar, mime: liviana.mime, bytes: liviana.bytes }), 5_000, ESCRITURA_VENCIDA);
      deps.auditar("regla:imagen_recuperable_guardada", "la imagen del plan 3D quedó guardada para recuperarla si la respuesta se corta", guardada.ok ? "guardada" : "no_guardada", { entrada: { solicitudId }, ...(guardada.ok ? {} : { motivo: guardada.error }) });
    }
    return Response.json({ imagen: `data:${liviana.mime};base64,${liviana.base64}`, motorImagen: "flux-kontext-max" }, { headers: SIN_CACHE });
  } catch (causa) {
    const mensaje = causa instanceof Error ? causa.message : String(causa);
    deps.auditar("regla:render_3d_error", "FLUX no devolvió la imagen del plan 3D", { mensaje: mensaje.slice(0, 300) }, { entrada });
    if (guardar) {
      await enCurso?.catch(() => undefined);
      await conLimite(marcarImagenFallida(guardar.db, guardar), 3_000, ESCRITURA_VENCIDA);
    }
    return error("NO_SE_PUDO_DIBUJAR", "No pude generar la imagen ahora. Vuelve a intentarlo en un momento.", 502);
  }
}
