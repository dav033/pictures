import type { z } from "zod";
import type { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import type { VistaArmada } from "@/lib/guiada-motor/armada-contrato";
import { RUTA_IMAGEN_MOTOR, type CuerpoImagenEntrada } from "@/lib/guiada-motor/imagen-contrato";
import { ErrorImagen, pedirImagenConRecuperacion, type DependenciasImagen, type ImagenObtenida } from "@/lib/generacion/pedir-imagen";
import { firmaDePlan, vistaDelPlan } from "./motor3d/firma-plan";
import type { FirmaPlan, GestorVista } from "./motor3d/gestor-vista";
import { piezasVistaDePlan } from "./piezas-vista";

type PlanGuiado = z.infer<typeof PlanGuiadoSchema>;

/**
 * «Ver cómo quedaría» de un plan del motor 3D, del lado del navegador (REQ-007, fase 4). La imagen base de FLUX es lo que el
 * cliente está viendo: la misma cámara fija de su tarjeta (`vistaDelPlan`) y la sala completa, dibujadas por el visor compartido
 * de la página, a 1024 px (la tarjeta lo muestra a 768). Si el navegador no puede con WebGL el servidor rasteriza la proyección
 * SVG del plan (es lo mismo que el cliente ve en ese caso), así que la captura es opcional.
 *
 * El gestor del visor (three.js) entra por `import()`: este módulo está en la primera carga de /asistente y no la engorda
 * (`test-motor3d-frontera.ts`). Las pruebas inyectan el gestor y el `fetch`.
 */
export const LADO_CAPTURA_IMAGEN = 1024;
export const AMBIENTE_IMAGEN_PLAN_3D = "igual_visor" as const;
/** Lo más que se espera al visor compartido: con la hoja que gira abierta tiene los pedidos en pausa, y sin tope la imagen no saldría nunca. */
export const ESPERA_CAPTURA_MS = 10_000;
/**
 * Cada petición paga una imagen en el servidor: Kontext espera hasta 100 s a fal y baja el resultado con otros 15 s de margen (115 s, bajo el
 * `maxDuration` de 120 s de la ruta) y, si sigue en curso, responde «en curso» para retomarla. El cliente espera más que el servidor, o
 * pagaría una imagen que tira. El proxy del VPS debe leer al menos 120 s por petición.
 */
export const LIMITE_INTENTO_3D_MS = 125_000;

export type GestorCaptura = Pick<GestorVista, "modo" | "imagen">;
const gestorDeLaPagina = async (): Promise<GestorCaptura> => (await import("./motor3d/gestor-vista")).gestorDeLaPagina();

/** La captura (data URL PNG) del visor compartido, o `null` si el navegador no dibuja en WebGL o el visor falló. */
export async function capturaDelVisor(firma: FirmaPlan, vista: VistaArmada, gestor: () => Promise<GestorCaptura> = gestorDeLaPagina): Promise<string | null> {
  const visor = await gestor();
  if (visor.modo() !== "webgl") return null;
  const imagen = await visor.imagen(firma, { vista, lado: LADO_CAPTURA_IMAGEN });
  return imagen.modo === "webgl" ? imagen.url : null;
}

export type OpcionesImagenPlan3D = {
  plan: PlanGuiado;
  senal: AbortSignal;
  limiteIntentoMs: number;
  alEvento?: (evento: string, datos: Record<string, unknown>) => void;
  gestor?: () => Promise<GestorCaptura>;
  /** Para las pruebas; por defecto `ESPERA_CAPTURA_MS`. */
  esperaCapturaMs?: number;
  dependencias?: Partial<DependenciasImagen>;
};

export async function pedirImagenPlan3D(opciones: OpcionesImagenPlan3D): Promise<ImagenObtenida> {
  const { plan, senal } = opciones;
  const firma = firmaDePlan(plan);
  if (!firma) throw new ErrorImagen("rechazo", "El plan del motor 3D no trae su especificación firmada.");
  const vista = vistaDelPlan(piezasVistaDePlan(plan));
  let captura: string | null = null;
  try {
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const vencida = new Promise<null>((resolver) => { reloj = setTimeout(() => resolver(null), opciones.esperaCapturaMs ?? ESPERA_CAPTURA_MS); });
    try { captura = await Promise.race([capturaDelVisor(firma, vista, opciones.gestor), vencida]); } finally { clearTimeout(reloj); }
    if (captura === null) opciones.alEvento?.("imagen.captura_no_disponible", { motivo: "sin captura del visor" });
  } catch (causa) {
    // Sin captura el servidor rasteriza la proyección SVG: la imagen se hace igual.
    opciones.alEvento?.("imagen.captura_no_disponible", { motivo: causa instanceof Error ? causa.message.slice(0, 200) : String(causa).slice(0, 200) });
  }
  if (senal.aborted) throw new ErrorImagen("cancelada", "Se canceló la imagen.");
  const cuerpo: CuerpoImagenEntrada = {
    approval_token: firma.approval_token, plan_hash: firma.plan_hash, motor: firma.motor, espec: firma.espec,
    ambiente: AMBIENTE_IMAGEN_PLAN_3D,
    ...(captura ? { captura } : { vista }),
  };
  opciones.alEvento?.("imagen.pedir_motor_3d", { plan_hash: plan.plan_hash, vista, conCaptura: captura !== null, ambiente: AMBIENTE_IMAGEN_PLAN_3D });
  return pedirImagenConRecuperacion({
    ruta: RUTA_IMAGEN_MOTOR, cuerpo, planHash: plan.plan_hash, senal, limiteIntentoMs: Math.max(opciones.limiteIntentoMs, LIMITE_INTENTO_3D_MS), reintentoSilencioso: false,
    ...(opciones.alEvento ? { alEvento: opciones.alEvento } : {}),
    ...(opciones.dependencias ? { dependencias: opciones.dependencias } : {}),
  });
}
