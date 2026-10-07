"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
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

type Grafica = z.infer<typeof GraficaSchema>;

/**
 * Pide al motor el mismo SVG que usa el plan clásico; no calcula ni dibuja geometría en el navegador.
 * Distingue «cargando» (brillo), «fallo» (silueta de la estructura, atenuada) y «lista» (el dibujo entra suave).
 */
export function GraficaMotorGuiada({ plan, pieza, mezclaReal, id, nombre, className = "size-full" }: { plan: unknown; pieza: Record<string, unknown>; mezclaReal?: unknown; id: EstructuraOficialId; nombre: string; className?: string }) {
  // El resultado recuerda para qué pieza se pidió: si la pieza cambia, vuelve a «cargando» sin un setState síncrono.
  const [resultado, setResultado] = useState<{ pieza: Record<string, unknown>; grafica: Grafica | null } | null>(null);
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
      .then((grafica) => { if (!controller.signal.aborted) setResultado({ pieza, grafica }); })
      .catch(() => { if (!controller.signal.aborted) setResultado({ pieza, grafica: null }); });
    return () => controller.abort();
  }, [plan, pieza, mezclaReal]);

  const estado: "cargando" | "lista" | "fallo" = resultado?.pieza !== pieza ? "cargando" : resultado.grafica ? "lista" : "fallo";
  if (estado === "cargando") return <span className={`brillo-carga block rounded-lg ${className}`} role="img" aria-label={`Dibujando ${nombre}`} />;
  if (estado === "fallo" || !resultado?.grafica) return <span className={`grid place-items-center text-acento/60 ${className}`}><IconoEstructura id={id} className="h-3/5 w-3/5" /></span>;
  const grafica = resultado.grafica;
  return (
    <motion.span className={`block ${className}`} initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}>
      <VistaMotor svg={grafica.svg} lienzo={grafica.lienzo ?? grafica.ancho ?? 600} alto={grafica.alto} etiqueta={`${nombre}, dibujo de armado`} className="size-full" />
    </motion.span>
  );
}
