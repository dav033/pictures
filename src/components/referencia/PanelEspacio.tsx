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
 * The customer's venue photo (maqueta EspacioAnalisis). Zones and
 * measurements appear only when they are real data: anchors detected on this
 * photo and `espacio` measured from the photo. Otherwise it shows the photo
 * with an honest sentence and no invented numbers.
 */
export function PanelEspacio({ foto, espacio, className = "" }: Props) {
  const reducir = useReducedMotion();
  const zonas = anclasDe(espacio);
  const medidas = medidasEspacioCliente(espacio);
  const medidasDeFoto = espacio?.fuente === "foto" && medidas.length > 0;
  const texto = medidasDeFoto
    ? `Medí tu espacio desde la foto: unos ${unir(medidas)}.`
    : espacio?.fuente === "cliente" && medidas.length > 0
      ? `Usé las medidas que me diste: ${unir(medidas)}.`
      : "Usaré esta foto como tu espacio. No saqué medidas de la foto, así que la propuesta usa medidas estándar; si sabes el ancho de la pared, dímelo y la ajusto.";

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
          {medidasDeFoto && (
            <ul className="absolute bottom-2.5 left-2.5 flex flex-wrap gap-1.5" aria-label="Medidas tomadas de la foto">
              {medidas.map((medida, indice) => (
                <motion.li
                  key={medida}
                  initial={reducir ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: reducir ? 0 : 0.6 + indice * 0.2 }}
                  className="rounded-full bg-superficie px-2.5 py-1 text-xs font-semibold text-texto shadow-[0_6px_18px_rgb(0_0_0/0.25)]"
                >
                  ≈ {medida}
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="px-4 pb-5 pt-4 text-[15px] leading-snug text-texto sm:px-5.5">{texto}</p>
    </motion.section>
  );
}
