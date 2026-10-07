"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { IconoEstructura } from "@/components/plan/IconoEstructura";
import { VistaMotor } from "@/components/plan/motor/VistaMotor";
import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { colorSempertex } from "./color-sempertex";
import { claveGrafica, graficaGuardada, huella, pedirGrafica, type GraficaMotor } from "./grafica-motor-cola";
import { motorDePieza } from "./motor-pieza";

const HEX = /^#[0-9a-fA-F]{6}$/;

type Grafica = GraficaMotor;

/** Sin `plan_hash` (un llamador que no lo pasa), la versión del plan es la huella de su contenido, una vez por objeto. */
const versionPorPlan = new WeakMap<object, string>();
function versionDe(plan: unknown): string {
  if (typeof plan !== "object" || plan === null) return "sin-plan";
  const guardada = versionPorPlan.get(plan);
  if (guardada) return guardada;
  const nueva = `h${huella(JSON.stringify(plan))}`;
  versionPorPlan.set(plan, nueva);
  return nueva;
}

/** Los tonos con que pinta el motor: los de la leyenda (Sempertex) si llegan; si no, los de la paleta del plan. */
function tonosDe(pieza: Record<string, unknown>, colores: readonly string[] | undefined): string[] {
  if (colores?.length) return colores.filter((color) => HEX.test(color)).slice(0, 6);
  const materiales = Array.isArray(pieza.materiales) ? pieza.materiales : [];
  return materiales.flatMap((valor) => {
    if (typeof valor !== "object" || valor === null || !("color" in valor) || typeof valor.color !== "string") return [];
    const hex = valor.color.startsWith("#") ? valor.color : colorSempertex(valor.color).hex;
    return hex && HEX.test(hex) ? [hex] : [];
  }).slice(0, 6);
}

/**
 * Pide al motor el mismo SVG que usa el plan clásico; no calcula ni dibuja geometría en el navegador. Una pieza con
 * su armado se dibuja con él; una sin armado, con la receta del mismo motor (`motorDePieza`), que es con la que abre
 * su editor en «Modificar». Pared, aro, techo y centro de mesa van al dibujo esquemático; lo que ningún dibujo
 * representa (bouquet, figura) muestra su icono sin pedir nada.
 * Distingue «cargando» (brillo), «fallo» (silueta de la estructura, atenuada) y «lista» (el dibujo entra suave).
 *
 * El dibujo se pide UNA vez por pieza y versión del plan (`grafica-motor-cola.ts`): un re-render, un remontaje o la
 * misma pieza en otra tarjeta usan el que ya está (o el que va en camino), y nunca se cancela uno en curso.
 */
export function GraficaMotorGuiada({ plan, version, pieza, mezclaReal, id, nombre, colores, className = "size-full" }: {
  plan: unknown;
  /** La versión del plan (`plan_hash`): con la pieza, su armado y sus tonos, la clave del dibujo. */
  version?: string;
  pieza: Record<string, unknown>;
  mezclaReal?: unknown;
  id: EstructuraOficialId;
  nombre: string;
  /** Tonos `#rrggbb` de la pieza (uno por material, en su orden): pintan, nunca cuentan. */
  colores?: readonly string[];
  className?: string;
}) {
  // Un arreglo nuevo en cada render no debe volver a pedir el dibujo: se compara por su contenido.
  const firmaTonos = tonosDe(pieza, colores).join(",");
  const elegido = motorDePieza(pieza);
  const ruta = elegido === null ? null : elegido.tipo === "motor" ? elegido.ruta : "/api/plan-dibujo-estructura";
  const estructuraId = typeof pieza.estructura_id === "string" ? pieza.estructura_id : String(pieza.estructura_id ?? "");
  const versionPlan = version ?? versionDe(plan);
  const armado = elegido?.tipo === "motor" ? elegido.armado : undefined;
  const clave = useMemo(
    () => (ruta ? claveGrafica({ ruta, version: versionPlan, estructuraId, armado, tonos: firmaTonos, ...(elegido?.tipo === "dibujo" ? { mezclaReal } : {}) }) : null),
    [ruta, versionPlan, estructuraId, armado, firmaTonos, elegido?.tipo, mezclaReal],
  );
  // El resultado recuerda para qué clave llegó: si la pieza cambia, vuelve a «cargando» sin un setState síncrono.
  const [resultado, setResultado] = useState<{ clave: string; grafica: Grafica | null } | null>(null);
  const guardada = clave ? graficaGuardada(clave) : undefined;

  useEffect(() => {
    if (!clave || !ruta || guardada !== undefined) return;
    const motor = motorDePieza(pieza);
    if (!motor) return;
    let atento = true;
    const tonos = firmaTonos ? firmaTonos.split(",") : [];
    const cuerpo = () => motor.tipo === "motor"
      ? { plan, estructura_id: pieza.estructura_id, [motor.campo]: motor.armado, ...(tonos.length ? { colores: tonos } : {}) }
      : { plan, estructura_id: pieza.estructura_id, ...(mezclaReal ? { mezcla_real: mezclaReal } : {}) };
    // Sin abortar: si este componente se va, la petición termina igual y su dibujo queda para el siguiente.
    void pedirGrafica(clave, ruta, cuerpo).then((grafica) => { if (atento) setResultado({ clave, grafica }); });
    return () => { atento = false; };
  }, [clave, ruta, guardada, plan, pieza, mezclaReal, firmaTonos]);

  const grafica = guardada !== undefined ? guardada : resultado?.clave === clave ? resultado.grafica : undefined;
  const estado: "cargando" | "lista" | "fallo" = elegido === null ? "fallo" : grafica === undefined ? "cargando" : grafica ? "lista" : "fallo";
  if (estado === "cargando") return <span className={`brillo-carga block rounded-lg ${className}`} role="img" aria-label={`Dibujando ${nombre}`} />;
  if (estado === "fallo" || !grafica) return <span className={`grid place-items-center text-acento/60 ${className}`}><IconoEstructura id={id} className="h-3/5 w-3/5" /></span>;
  return (
    // El SVG va absoluto dentro de una caja fija: con alto automático, un lienzo alto (la columna, 600 × 720) se salía
    // del marco y se veía recortado.
    <motion.span className={`relative block ${className}`} initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}>
      <VistaMotor svg={grafica.svg} lienzo={grafica.lienzo ?? grafica.ancho ?? 600} alto={grafica.alto} etiqueta={`${nombre}, dibujo de armado`} className="absolute inset-0 size-full" />
    </motion.span>
  );
}
