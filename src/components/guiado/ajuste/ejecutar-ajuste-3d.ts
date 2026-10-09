import type { CambioPanelV1 } from "@/lib/globos3d/motor/v1";
import type { TurnoEdicion } from "@/lib/guiada-motor/editar-contrato";
import { avisosDelCambio, type DependenciasEdicion3d } from "../edicion-motor3d";
import type { CambioPlan, GloboParaPlan, PlanGuiado } from "./ajuste-plan-guiado";
import type { PlanFirmado } from "./ejecutar-ajuste";

/**
 * Un cambio de «Ajustar mi plan» sobre un plan del motor 3D (REQ-007, fase 5). El navegador no cuenta nada: manda el cambio
 * del panel (sin lo que solo existe en el catálogo de Python) y el servidor lo aplica a la espec firmada, rearma, cotiza y
 * devuelve el plan nuevo. Lo que el servidor no pudo hacer llega como `FalloPlanEditar` («No pude: …»).
 */
export type CambioHecho3d = PlanFirmado & {
  /** La línea corta de «Último ajuste: …». */
  descripcion: string;
  /** Lo que dice el panel al terminar, con lo que hay que saber (colores sustituidos, medidas acotadas, lo que no se pudo). */
  confirmacion: string;
  avisos: string[];
  turno: TurnoEdicion;
};

const CODIGO_SEMPERTEX = /^\d{3}$/;

/** El color de un globo elegido del catálogo del 3D: su código Sempertex (los `variantIds` de ese catálogo son códigos) o su nombre. */
function colorDelGlobo(globo: GloboParaPlan): string {
  return globo.variantIds.find((id) => CODIGO_SEMPERTEX.test(id)) ?? globo.color;
}

/** El cambio del panel como lo entiende el servidor del 3D. El `switch` es exhaustivo: un tipo nuevo del panel no compila sin su equivalente. */
export function aCambioPanel(cambio: CambioPlan): CambioPanelV1 {
  switch (cambio.tipo) {
    case "protagonismo":
    case "cantidad":
    case "tamano":
    case "quitar-color":
    case "tamano-globos":
    case "tamano-todo":
    case "quitar-pieza":
      return cambio;
    case "medidas":
      return { tipo: "medidas", estructuraId: cambio.estructuraId, medidas: cambio.medidas, ...(cambio.pareja ? { pareja: true } : {}) };
    case "agregar-color":
      return { tipo: "agregar-color", color: cambio.globo ? colorDelGlobo(cambio.globo) : cambio.color, ...(cambio.estructuraIds?.length ? { estructuraIds: cambio.estructuraIds } : {}) };
    case "reemplazar-color":
      return { tipo: "reemplazar-color", color: cambio.color, nuevo: colorDelGlobo(cambio.globo), ...(cambio.estructuraIds?.length ? { estructuraIds: cambio.estructuraIds } : {}) };
  }
}

export async function ejecutarCambio3d(cambio: CambioPlan, base: PlanGuiado, dependencias: DependenciasEdicion3d): Promise<CambioHecho3d> {
  const hecho = await dependencias.editar(base, { tipo: "cambio", cambio: aCambioPanel(cambio) });
  const avisos = avisosDelCambio(base, hecho);
  return {
    plan: hecho.plan, cotizacion: hecho.cotizacion, piezas: hecho.tocadas,
    descripcion: hecho.descripcion, confirmacion: [hecho.confirmacion, ...avisos].join(" "), avisos, turno: hecho.turno,
  };
}
