"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { z } from "zod";
import { IconoEstructura } from "@/components/plan/IconoEstructura";
import { VistaMotor } from "@/components/plan/motor/VistaMotor";
import { HEX_COLORES_V2 } from "@/lib/rag/taxonomy/v2";
import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { motorDePieza } from "./motor-pieza";

const GraficaSchema = z.object({ svg: z.string().min(1), lienzo: z.number().positive().optional(), ancho: z.number().positive().optional(), alto: z.number().positive().optional() }).passthrough();
const HEX = /^#[0-9a-fA-F]{6}$/;

type Grafica = z.infer<typeof GraficaSchema>;

/** Los tonos con que pinta el motor: los de la leyenda (Sempertex) si llegan; si no, los de la paleta del plan. */
function tonosDe(pieza: Record<string, unknown>, colores: readonly string[] | undefined): string[] {
  if (colores?.length) return colores.filter((color) => HEX.test(color)).slice(0, 6);
  const materiales = Array.isArray(pieza.materiales) ? pieza.materiales : [];
  return materiales.flatMap((valor) => {
    if (typeof valor !== "object" || valor === null || !("color" in valor) || typeof valor.color !== "string") return [];
    const hex = valor.color.startsWith("#") ? valor.color : HEX_COLORES_V2[valor.color as keyof typeof HEX_COLORES_V2];
    return hex && HEX.test(hex) ? [hex] : [];
  }).slice(0, 6);
}

async function pedirGrafica(ruta: string, cuerpo: unknown, signal: AbortSignal): Promise<Grafica | null> {
  for (let intento = 0; intento < 2; intento += 1) {
    const respuesta = await fetch(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo), signal });
    // El motor atiende pocos dibujos a la vez (429 con `Retry-After`): uno más tarde, una sola vez.
    if (respuesta.status === 429 && intento === 0) {
      await new Promise((listo) => setTimeout(listo, 1200));
      if (signal.aborted) return null;
      continue;
    }
    if (!respuesta.ok) return null;
    const datos: unknown = await respuesta.json();
    if (typeof datos !== "object" || datos === null || !("grafica" in datos)) return null;
    const parseada = GraficaSchema.safeParse(datos.grafica);
    return parseada.success ? parseada.data : null;
  }
  return null;
}

/**
 * Pide al motor el mismo SVG que usa el plan clásico; no calcula ni dibuja geometría en el navegador. Una pieza con
 * su armado se dibuja con él; una sin armado, con la receta del mismo motor (`motorDePieza`), que es con la que abre
 * su editor en «Modificar». Pared, aro, techo y centro de mesa van al dibujo esquemático; lo que ningún dibujo
 * representa (bouquet, figura) muestra su icono sin pedir nada.
 * Distingue «cargando» (brillo), «fallo» (silueta de la estructura, atenuada) y «lista» (el dibujo entra suave).
 */
export function GraficaMotorGuiada({ plan, pieza, mezclaReal, id, nombre, colores, className = "size-full" }: {
  plan: unknown;
  pieza: Record<string, unknown>;
  mezclaReal?: unknown;
  id: EstructuraOficialId;
  nombre: string;
  /** Tonos `#rrggbb` de la pieza (uno por material, en su orden): pintan, nunca cuentan. */
  colores?: readonly string[];
  className?: string;
}) {
  // El resultado recuerda para qué pieza se pidió: si la pieza cambia, vuelve a «cargando» sin un setState síncrono.
  const [resultado, setResultado] = useState<{ pieza: Record<string, unknown>; grafica: Grafica | null } | null>(null);
  // Un arreglo nuevo en cada render no debe volver a pedir el dibujo: se compara por su contenido.
  const firmaTonos = tonosDe(pieza, colores).join(",");
  const sinDibujo = motorDePieza(pieza) === null;

  useEffect(() => {
    const elegido = motorDePieza(pieza);
    if (!elegido) return;
    const tonos = firmaTonos ? firmaTonos.split(",") : [];
    const cuerpo = elegido.tipo === "motor"
      ? { plan, estructura_id: pieza.estructura_id, [elegido.campo]: elegido.armado, ...(tonos.length ? { colores: tonos } : {}) }
      : { plan, estructura_id: pieza.estructura_id, ...(mezclaReal ? { mezcla_real: mezclaReal } : {}) };
    const ruta = elegido.tipo === "motor" ? elegido.ruta : "/api/plan-dibujo-estructura";
    const controller = new AbortController();
    void pedirGrafica(ruta, cuerpo, controller.signal)
      .then((grafica) => { if (!controller.signal.aborted) setResultado({ pieza, grafica }); })
      .catch(() => { if (!controller.signal.aborted) setResultado({ pieza, grafica: null }); });
    return () => controller.abort();
  }, [plan, pieza, mezclaReal, firmaTonos]);

  const estado: "cargando" | "lista" | "fallo" = sinDibujo ? "fallo" : resultado?.pieza !== pieza ? "cargando" : resultado.grafica ? "lista" : "fallo";
  if (estado === "cargando") return <span className={`brillo-carga block rounded-lg ${className}`} role="img" aria-label={`Dibujando ${nombre}`} />;
  if (estado === "fallo" || !resultado?.grafica) return <span className={`grid place-items-center text-acento/60 ${className}`}><IconoEstructura id={id} className="h-3/5 w-3/5" /></span>;
  const grafica = resultado.grafica;
  return (
    // El SVG va absoluto dentro de una caja fija: con alto automático, un lienzo alto (la columna, 600 × 720) se salía
    // del marco y se veía recortado.
    <motion.span className={`relative block ${className}`} initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}>
      <VistaMotor svg={grafica.svg} lienzo={grafica.lienzo ?? grafica.ancho ?? 600} alto={grafica.alto} etiqueta={`${nombre}, dibujo de armado`} className="absolute inset-0 size-full" />
    </motion.span>
  );
}
