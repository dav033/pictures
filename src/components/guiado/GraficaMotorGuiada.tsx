"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { IconoEstructura } from "@/components/plan/IconoEstructura";
import { VistaMotor } from "@/components/plan/motor/VistaMotor";
import { HEX_COLORES_V2 } from "@/lib/rag/taxonomy/v2";
import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";

const GraficaSchema = z.object({ svg: z.string().min(1), lienzo: z.number().positive().optional(), ancho: z.number().positive().optional(), alto: z.number().positive().optional() }).passthrough();
const MOTORES = [
  ["armado_arco_organico", "/api/plan-armado-arco-organico"], ["armado_columna_organica", "/api/plan-armado-columna-organica"],
  ["armado_guirnalda_organica", "/api/plan-armado-guirnalda-organica"], ["armado_arco", "/api/plan-armado-arco"],
  ["armado_columna", "/api/plan-armado-columna"], ["armado_guirnalda", "/api/plan-armado-guirnalda"],
  ["armado_bouquet", "/api/plan-armado-bouquet"],
] as const;

/** Pide al motor el mismo SVG que usa el plan clásico; no calcula ni dibuja geometría en el navegador. */
export function GraficaMotorGuiada({ plan, pieza, mezclaReal, id, nombre }: { plan: unknown; pieza: Record<string, unknown>; mezclaReal?: unknown; id: EstructuraOficialId; nombre: string }) {
  const [grafica, setGrafica] = useState<z.infer<typeof GraficaSchema> | null>(null);
  useEffect(() => {
    const motor = MOTORES.find(([campo]) => pieza[campo] !== undefined);
    const [campo, ruta] = motor ?? ["", "/api/plan-dibujo-estructura"];
    const materiales = Array.isArray(pieza.materiales) ? pieza.materiales : [];
    const colores = materiales.flatMap((valor) => {
      if (typeof valor !== "object" || valor === null || !("color" in valor) || typeof valor.color !== "string") return [];
      const hex = valor.color.startsWith("#") ? valor.color : HEX_COLORES_V2[valor.color as keyof typeof HEX_COLORES_V2];
      return hex ? [hex] : [];
    });
    const controller = new AbortController();
    const cuerpo = { plan, estructura_id: pieza.estructura_id, ...(motor ? { [campo]: pieza[campo] ?? null, ...(colores.length ? { colores } : {}) } : { ...(mezclaReal ? { mezcla_real: mezclaReal } : {}) }) };
    void fetch(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo), signal: controller.signal })
      .then(async (respuesta) => {
        if (!respuesta.ok) return null;
        const cuerpo: unknown = await respuesta.json();
        if (typeof cuerpo !== "object" || cuerpo === null || !("grafica" in cuerpo)) return null;
        const parseada = GraficaSchema.safeParse(cuerpo.grafica);
        return parseada.success ? parseada.data : null;
      })
      .then((vista) => { if (!controller.signal.aborted) setGrafica(vista); })
      .catch(() => { if (!controller.signal.aborted) setGrafica(null); });
    return () => controller.abort();
  }, [plan, pieza, mezclaReal]);

  if (!grafica) return <IconoEstructura id={id} className="h-10 w-11" />;
  return <VistaMotor svg={grafica.svg} lienzo={grafica.lienzo ?? grafica.ancho ?? 600} alto={grafica.alto} etiqueta={`${nombre}, dibujo de armado del motor`} className="h-12 w-12" />;
}
