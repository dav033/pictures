"use client";

import { RefineFrame, type RefineFrameStage } from "@/components/ui/reactbits";

/** Etapas reales de «Foto realista»: cada una se marca cuando ocurre (captura lista, respuesta del servidor, guardado en el navegador). */
export const ETAPAS_FOTO_REALISTA = [
  { id: "capturando", name: "Capturando el visor" },
  { id: "generando", name: "Generando la foto" },
  { id: "guardando", name: "Guardando en este navegador" },
] as const satisfies readonly RefineFrameStage[];

export type EtapaFotoRealista = (typeof ETAPAS_FOTO_REALISTA)[number]["id"];

export function EtapasFotoRealista({ etapa }: { etapa: EtapaFotoRealista | null }) {
  return <RefineFrame label="Progreso de la foto realista" stages={ETAPAS_FOTO_REALISTA} current={etapa} />;
}
