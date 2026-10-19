"use client";

/* The venue photo is a local data URL of the customer's attachment. */
/* eslint-disable @next/next/no-img-element */

import { motion, useReducedMotion } from "motion/react";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { metrosCliente } from "@/lib/plan/presentacion-cliente";
import { urlImagen } from "./recorte";

type Espacio = PlanResuelto["plan"]["espacio"];
type Ancla = { ancla_id: string; tipo: string; procedencia: string; evidencia: string; bbox?: { x: number; y: number; width: number; height: number } };

const NOMBRE_ANCLA: Readonly<Record<string, string>> = {
  puerta: "Puerta",
  pared: "Pared",
  mesa: "Mesa",
  arbol: "Árbol",
  techo: "Techo",
  piso: "Piso",
  fachada: "Fachada",
  esquina: "Esquina",
  mobiliario_existente: "Mobiliario",
};

type Props = {
  foto: { base64: string; mime: string };
  espacio?: Espacio;
  className?: string;
};

function anclasDe(espacio: Espacio | undefined): Ancla[] {
  const anclas = espacio && "anclas" in espacio ? (espacio.anclas as Ancla[] | undefined) : undefined;
  return (anclas ?? []).filter((ancla) => ancla.procedencia === "foto_espacio" && ancla.bbox);
}

/** Measurements in words, only those that exist: "unos 6 m de ancho y 3 m de alto". */
export function medidasEspacioCliente(espacio: Espacio | undefined): string[] {
  if (!espacio) return [];
  const partes: string[] = [];
  if (espacio.ancho_m != null) partes.push(`${metrosCliente(espacio.ancho_m)} de ancho`);
  if (espacio.largo_m != null) partes.push(`${metrosCliente(espacio.largo_m)} de largo`);
  if (espacio.alto_m != null) partes.push(`${metrosCliente(espacio.alto_m)} de alto`);
  return partes;
}

function unir(partes: string[]): string {
  return partes.length <= 1 ? partes[0] ?? "" : `${partes.slice(0, -1).join(", ")} y ${partes.at(-1)}`;
}

/**
 * Where the venue measurements come from, for the customer (contract of
 * `fix-backend`, iteración 4, D2): the backend normalizes `fuente: "foto"`
 * with numbers to `"supuesto"` and only uses `"cliente"` when the customer's
 * text or brief gave them. The UI applies the same rule defensively, so an
 * older plan with "3 × 3 × 2,5 m" and `fuente: "foto"` on a huge hall is
 * never presented as measured.
 * - "cliente": the customer gave them (the only real measurements).
 * - "estimadas": any other number, an estimate for the proposal.
 * - "ninguna": no numbers at all.
 */
export type OrigenMedidasEspacio = "cliente" | "estimadas" | "ninguna";

export function origenMedidasEspacio(espacio: Espacio | undefined): OrigenMedidasEspacio {
  if (!espacio || medidasEspacioCliente(espacio).length === 0) return "ninguna";
  return espacio.fuente === "cliente" ? "cliente" : "estimadas";
}

/** Sentence under the venue photo. It never claims the assistant measured anything. */
export function textoEspacioCliente(espacio: Espacio | undefined): string {
  const medidas = unir(medidasEspacioCliente(espacio));
  switch (origenMedidasEspacio(espacio)) {
    case "cliente":
      return `Usé las medidas que me diste: ${medidas}.`;
    case "estimadas":
      return `Medidas estimadas para la propuesta: unos ${medidas}. Confírmalas o dime las reales.`;
    default:
      return "Usaré esta foto como tu espacio. La propuesta usa medidas estándar; si sabes el ancho de la pared, dímelo y la ajusto.";
  }
}

/**
 * The customer's venue photo (maqueta EspacioAnalisis). Zones and
 * measurements are never drawn as if they were measured: zones are anchors
 * detected on this photo, and numbers stay in the sentence, labeled as the
 * customer's or as estimates.
 */
export function PanelEspacio({ foto, espacio, className = "" }: Props) {
  const reducir = useReducedMotion();
  const zonas = anclasDe(espacio);
  const texto = textoEspacioCliente(espacio);

  return (
    <motion.section
      aria-label="Foto de tu espacio"
      initial={reducir ? false : { opacity: 0, y: 14, filter: "blur(5px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
      className={`overflow-hidden rounded-[20px] border border-borde-suave bg-superficie shadow-[0_1px_2px_var(--sombra),0_12px_32px_var(--sombra)] ${className}`}
    >
      <div className="relative flex justify-center overflow-hidden bg-superficie-2">
        <img src={urlImagen(foto)} alt="" aria-hidden="true" draggable={false} className="absolute inset-0 size-full scale-110 object-cover opacity-70 blur-2xl" />
        <div className="relative inline-block max-w-full overflow-hidden">
          <img src={urlImagen(foto)} alt="Foto de tu espacio" draggable={false} className="block h-auto max-h-[min(480px,60vh)] w-auto max-w-full" />
          {zonas.map((zona, indice) => (
            <motion.div
              key={zona.ancla_id}
              className="absolute rounded-xl border-2 border-dashed border-white/90"
              style={{ left: `${zona.bbox!.x * 100}%`, top: `${zona.bbox!.y * 100}%`, width: `${zona.bbox!.width * 100}%`, height: `${zona.bbox!.height * 100}%` }}
              initial={reducir ? false : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: reducir ? 0 : 0.3 + indice * 0.25 }}
            >
              <span className="absolute left-1.5 top-1.5 rounded-full bg-superficie px-2 py-0.5 text-[11px] font-semibold text-texto shadow-sm">{NOMBRE_ANCLA[zona.tipo] ?? "Zona"}</span>
            </motion.div>
          ))}
        </div>
      </div>
      <p className="px-4 pb-5 pt-4 text-[15px] leading-snug text-texto sm:px-5.5">{texto}</p>
    </motion.section>
  );
}
