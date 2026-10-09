import "server-only";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import { exigirEscritura } from "@/lib/feedback-ia/acceso";
import { svgDeArmada, type ArmadaCompactaV1, type EspecClienteV1, type ResultadoMotorV1 } from "@/lib/globos3d/motor/v1";
import { CuerpoArmadaSchema } from "./armada-contrato";
import { huellaDeNavegador } from "./plan-motor";
import { verificarPlanFirmado } from "./verificar-plan";

/**
 * Lógica de `POST /api/guiada/motor/armada` (REQ-007, fase 3): la armada compacta del plan 3D que el navegador tiene en
 * pantalla, para dibujarla en su visor. Es la ruta de la vista, no del precio: no cotiza, no llama a Python ni a un modelo.
 *
 * Por qué una ruta aparte y no la armada dentro de la respuesta del plan: la armada pesa hasta 30 KB y el plan se guarda en
 * la sesión del navegador y se reenvía entero como `base` en cada suma o rehacer; llevarla ahí la guardaría y la mandaría de
 * ida y vuelta sin que nadie la use. Aparte se pide solo cuando la tarjeta se ve, y se guarda por `especHash`.
 *
 * - misma identidad que la ruta del plan: sesión, mismo origen y token `globos3d` atado a ESTE navegador; un token de
 *   Python, de otro navegador o con la espec cambiada responde 409 (`verificar-plan.ts`);
 * - no mira la bandera: un plan del 3D que ya está en pantalla se sigue viendo aunque la bandera cambie;
 * - la armada es determinista (misma espec y versión, mismos bytes): se guarda en una caché de servidor por `especHash`,
 *   acotada. No guarda recursos de GPU (esos viven en cada visor, D-017): solo números.
 */
export type CacheArmada = { leer: (hash: string) => ArmadaCompactaV1 | undefined; guardar: (hash: string, armada: ArmadaCompactaV1) => void };

/** Una caché con tope: al pasarse, sale la menos usada (el `Map` conserva el orden de inserción). */
export function crearCacheArmada(tope: number): CacheArmada {
  const guardadas = new Map<string, ArmadaCompactaV1>();
  return {
    leer(hash) {
      const armada = guardadas.get(hash);
      if (armada) { guardadas.delete(hash); guardadas.set(hash, armada); }
      return armada;
    },
    guardar(hash, armada) {
      guardadas.delete(hash);
      guardadas.set(hash, armada);
      while (guardadas.size > tope) guardadas.delete(guardadas.keys().next().value as string);
    },
  };
}

export type DependenciasArmada = {
  armar: (espec: EspecClienteV1) => Pick<ResultadoMotorV1, "armada" | "especHash">;
  cache: CacheArmada;
  auditar: (quien: string, que: string, resultado: unknown, extra?: { entrada?: unknown; motivo?: string }) => void;
};

/** ¿La pieza existe y tiene algún globo, tubito o flor que dibujar? */
function tieneDibujo(armada: ArmadaCompactaV1, piezaId: string): boolean {
  const pieza = armada.piezas.find((p) => p.id === piezaId);
  return Boolean(pieza && pieza.globos[1] + pieza.tubos[1] + pieza.flores[1] > 0);
}

const SIN_CACHE = { "Cache-Control": "no-store" } as const;
const MAX_CARACTERES_CUERPO = 400_000;

function error(codigo: string, mensaje: string, estado: number): Response {
  return Response.json({ error: mensaje, codigo }, { status: estado, headers: SIN_CACHE });
}

export async function atenderArmadaMotor(request: Request, deps: DependenciasArmada): Promise<Response> {
  if (!isAuthenticatedRequest(request)) return error("SESION_REQUERIDA", "Sesión requerida.", 401);
  const acceso = exigirEscritura(request);
  if ("respuesta" in acceso) return acceso.respuesta;
  return acceso.conCookie(await atender(request, deps, huellaDeNavegador(acceso.usuarioId)));
}

async function atender(request: Request, deps: DependenciasArmada, navegador: string): Promise<Response> {
  // Un cuerpo enorme se rechaza por su cabecera, sin leerlo.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_CARACTERES_CUERPO) return error("CUERPO_INVALIDO", "Cuerpo inválido.", 400);
  const texto = await request.text().catch(() => "");
  if (!texto || texto.length > MAX_CARACTERES_CUERPO) return error("CUERPO_INVALIDO", "Cuerpo inválido.", 400);
  let json: unknown;
  try { json = JSON.parse(texto); } catch { return error("CUERPO_INVALIDO", "El cuerpo debe ser JSON válido.", 400); }
  const leido = CuerpoArmadaSchema.safeParse(json);
  if (!leido.success) return error("CUERPO_INVALIDO", "La solicitud no tiene un formato válido.", 400);
  const cuerpo = leido.data;

  const verificado = verificarPlanFirmado(cuerpo, navegador);
  if ("codigo" in verificado) {
    deps.auditar("regla:motor_guiada", "armada de la vista 3D: el plan que mandó el navegador no se acepta", { razon: verificado.codigo, motivo: verificado.motivo }, { entrada: { salida: cuerpo.salida }, motivo: verificado.mensaje });
    return error(verificado.codigo, verificado.mensaje, verificado.estado);
  }

  try {
    let armada = deps.cache.leer(cuerpo.plan_hash);
    if (!armada) {
      const resultado = deps.armar(verificado.espec);
      // El hash ya se comprobó contra el token; el que arma el motor es el mismo salvo que la versión del motor cambie entre medias.
      if (resultado.especHash !== cuerpo.plan_hash) return error("PLAN_ALTERADO", "El plan es de otra versión del motor: vuelve a pedirlo.", 409);
      armada = resultado.armada;
      deps.cache.guardar(cuerpo.plan_hash, armada);
    }
    if (cuerpo.salida === "svg") {
      // Una pieza que no existe o no tiene nada que dibujar no es un cuadro gris: el cliente se queda con el icono de la pieza.
      if (cuerpo.pieza && !tieneDibujo(armada, cuerpo.pieza)) return error("PIEZA_SIN_DIBUJO", "Esa pieza no tiene nada que dibujar.", 404);
      const svg = svgDeArmada(armada, { vista: cuerpo.vista ?? "frente", ...(cuerpo.pieza ? { pieza: cuerpo.pieza } : {}), titulo: "Vista de tu decoración" });
      return new Response(svg, { headers: { ...SIN_CACHE, "Content-Type": "image/svg+xml; charset=utf-8", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } });
    }
    return Response.json({ armada, especHash: cuerpo.plan_hash }, { headers: SIN_CACHE });
  } catch (causa) {
    console.warn("[guiada-motor] no se pudo armar la vista del plan 3D", causa instanceof Error ? causa.message : causa);
    return error("ERROR_DEL_MOTOR", "No pude armar la vista del plan.", 500);
  }
}
