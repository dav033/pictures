import type { z } from "zod";
import type { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { CATALOGO_ERRORES_UI_V1 } from "@/lib/ia/contracts/ui-error-v1";
import {
  FalloEditarMotorSchema, RespuestaEditarMotorSchema, RUTA_EDITAR_MOTOR,
  type CuerpoEditarMotor, type EdicionDelCliente, type RespuestaEditarMotor,
} from "@/lib/guiada-motor/editar-contrato";
import { unirNoPude } from "@/lib/guiada-motor/mensajes-cliente";
import { esCancelacion, FalloPlanEditar, MENSAJE_EDICION_LENTA, PLAZO_EDICION_MS } from "@/lib/plan/peticion-plan-editar";

type PlanGuiado = z.infer<typeof PlanGuiadoSchema>;
type Red = typeof fetch;

/**
 * Los cambios de un plan del motor 3D, vistos desde el navegador (`/api/guiada/motor/editar`, REQ-007 fase 5). Sin React y
 * sin el motor: el navegador manda el plan vigente y lo que el cliente pidió; el servidor aplica, rearma, cotiza y devuelve el
 * plan nuevo. Lo que el servidor no hizo llega como `FalloPlanEditar` con el mensaje para el cliente («No pude: …»), igual
 * que las ediciones de Python, para que el chat y el panel lo muestren por el mismo camino.
 */
export type DependenciasEdicion3d = {
  editar: (base: PlanGuiado, edicion: EdicionDelCliente, opciones?: { turnoId?: string }) => Promise<RespuestaEditarMotor>;
};

/** El motor 3D está apagado ahora (la bandera dice `python`): el plan en pantalla ya no se edita con él. */
export class FalloMotor3dApagado extends FalloPlanEditar {
  readonly razon = "bandera_python" as const;
  constructor(options?: { cause?: unknown }) {
    super(TEXTO_MOTOR_3D_APAGADO, options);
    this.name = "FalloMotor3dApagado";
  }
}

export const TEXTO_MOTOR_3D_APAGADO = "No pude: por ahora no puedo cambiar este plan porque la vista 3D no está disponible. Tu plan sigue como estaba; si quieres, pídeme armarlo de nuevo.";
const RESPALDO = "No pude: no logré hacer ese cambio. Tu plan sigue como estaba.";

/** El color que el servidor no pudo leer: un 400 de validación cuya ruta apunta a un campo de color, con el nombre que escribió el cliente. */
function colorQueNoSeLee(datos: unknown, edicion: EdicionDelCliente): string | null {
  const detalles = (datos as { detalles?: Array<{ ruta?: string }> } | null)?.detalles ?? [];
  const campo = detalles.map((detalle) => detalle.ruta?.split(".").pop() ?? "").find((nombre) => nombre === "colorNuevo" || nombre === "color");
  if (!campo || edicion.tipo !== "pedido") return null;
  const valor: unknown = (edicion.pedido as Record<string, unknown>)[campo];
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

export function crearDependenciasEdicion3d(opciones: { signal?: AbortSignal; red?: Red; plazoMs?: number } = {}): DependenciasEdicion3d {
  return {
    async editar(base, edicion, extra = {}) {
      const red = opciones.red ?? ((...argumentos: Parameters<Red>) => fetch(...argumentos));
      const plazo = AbortSignal.timeout(opciones.plazoMs ?? PLAZO_EDICION_MS);
      const signal = opciones.signal ? AbortSignal.any([opciones.signal, plazo]) : plazo;
      const vencio = (): boolean => plazo.aborted && !opciones.signal?.aborted;
      const cuerpo: CuerpoEditarMotor = { plan: base, edicion, ...(extra.turnoId ? { turnoId: extra.turnoId } : {}) };
      let respuesta: Response;
      try {
        respuesta = await red(RUTA_EDITAR_MOTOR, { method: "POST", headers: { "Content-Type": "application/json" }, signal, body: JSON.stringify(cuerpo) });
      } catch (error) {
        if (vencio()) throw new FalloPlanEditar(MENSAJE_EDICION_LENTA, { cause: error });
        if (esCancelacion(error)) throw error;
        throw new FalloPlanEditar(CATALOGO_ERRORES_UI_V1.SIN_CONEXION.mensaje_usuario, { cause: error });
      }
      let datos: unknown;
      try {
        datos = await respuesta.json();
      } catch (error) {
        if (vencio()) throw new FalloPlanEditar(MENSAJE_EDICION_LENTA, { cause: error });
        if (esCancelacion(error)) throw error;
        throw new FalloPlanEditar(RESPALDO, { cause: error });
      }
      if (!respuesta.ok) {
        const fallo = FalloEditarMotorSchema.safeParse(datos);
        if (fallo.success && fallo.data.fallback?.razon === "bandera_python") throw new FalloMotor3dApagado();
        const colorNoLeido = colorQueNoSeLee(datos, edicion);
        if (respuesta.status === 400 && colorNoLeido) throw new FalloPlanEditar(`No pude: no reconozco el color «${colorNoLeido}». Tu plan sigue como estaba.`);
        // 409, 422 y 429 traen frases pensadas para el cliente; lo demás (400, 401, 500) es técnico y se dice con el respaldo.
        // Un 422 puede traer varias razones (una tanda parcial): se dicen todas, en palabras de cliente.
        if (!fallo.success || ![409, 422, 429].includes(respuesta.status)) throw new FalloPlanEditar(RESPALDO);
        throw new FalloPlanEditar(fallo.data.noAplicadas?.length ? unirNoPude(fallo.data.noAplicadas) : fallo.data.error);
      }
      const leida = RespuestaEditarMotorSchema.safeParse(datos);
      if (!leida.success) throw new FalloPlanEditar(RESPALDO);
      return leida.data;
    },
  };
}

/**
 * Lo que se le dice al cliente además de lo hecho: los avisos del cambio (un color sustituido, una medida acotada) y lo que
 * el armado dice ahora y no decía antes (`avisos` del plan nuevo menos los del plan que tenía).
 */
export function avisosDelCambio(base: PlanGuiado, hecho: RespuestaEditarMotor): string[] {
  const antes = new Set((base as PlanGuiado & { avisos?: unknown }).avisos as string[] | undefined ?? []);
  const delArmado = (((hecho.plan as PlanGuiado & { avisos?: unknown }).avisos as string[] | undefined) ?? []).filter((aviso) => !antes.has(aviso));
  return [...new Set([...hecho.avisos, ...delArmado])].slice(0, 3);
}
