import type { z } from "zod";
import { PlanActualGuiadoSchema, type PlanActualGuiado, type PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { ESTRUCTURAS_OFICIALES, ESTRUCTURAS_OFICIALES_IDS, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { generarPasosPlan } from "./generar-pasos-plan";
import { listaNatural, piezaEnPalabras } from "./propuesta-composicion";

/**
 * Instrucciones y resúmenes con los que la vista guiada pide el plan a /api/chat y lo deja en el historial.
 * Importable desde el cliente: sin «server-only», núcleo de IA ni adaptador de Python.
 */

type PropuestaGuiada = z.infer<typeof PropuestaComposicionSchema>;
export type BriefPlanGuiado = { evento?: string; edad?: number; tematica?: string };

/** Piezas que solo se ven orgánicas si mezclan tamaños: sin la orden explícita el plan salía todo en 12". */
export const ESTRUCTURAS_ORGANICAS: ReadonlySet<EstructuraOficialId> = new Set<EstructuraOficialId>([
  "arco_asimetrico", "semiarco_asimetrico", "columna_asimetrica", "pared_organica", "guirnalda", "racimo_pared",
]);

const SIN_TEMATICA = /^(?:pendiente|por[ _-]?definir|sin definir|ninguna|no s[eé])$/i;

function limpio(valor: string | undefined): string | undefined {
  const texto = valor?.trim();
  return texto && !SIN_TEMATICA.test(texto) ? texto : undefined;
}

function esCumpleanos(evento: string | undefined): boolean {
  return Boolean(evento && /cumple/i.test(evento.normalize("NFD").replace(/[̀-ͯ]/g, "")));
}

function contextoEvento(brief: BriefPlanGuiado): string {
  const evento = limpio(brief.evento) ?? "una celebración";
  const edad = esCumpleanos(brief.evento) && brief.edad && brief.edad > 0 ? `, de ${brief.edad} años` : "";
  const tematica = limpio(brief.tematica);
  return `${evento}${edad}${tematica ? `, temática ${tematica}` : ""}`;
}

function nombreOficial(estructura: EstructuraOficialId): string {
  return ESTRUCTURAS_OFICIALES[estructura].nombre;
}

/** estructura_id con el formato que exige el plan (EST_01_ARCO_ASIMETRICO): un id mal formado hacía fallar el primer confirmar. */
function estructuraId(indice: number, estructura: EstructuraOficialId): string {
  return `EST_${String(indice + 1).padStart(2, "0")}_${estructura.toUpperCase()}`;
}

export function instruccionPlanGuiado(propuesta: PropuestaGuiada, brief: BriefPlanGuiado, opciones?: { reintento?: boolean; planAnterior?: PlanActualGuiado }): string {
  const piezas = propuesta.piezas.map((pieza, indice) => `- ${pieza.cantidad} × ${nombreOficial(pieza.estructura)} (estructura_oficial: ${pieza.estructura}; estructura_id: ${estructuraId(indice, pieza.estructura)}; repeticiones: ${pieza.cantidad})`);
  const organicas = [...new Set(propuesta.piezas.filter((pieza) => ESTRUCTURAS_ORGANICAS.has(pieza.estructura)).map((pieza) => nombreOficial(pieza.estructura)))];
  const lineas = [
    "Resuelve ahora el plan exacto de esta decoración con confirmar_plan_decoracion. El cliente ya la eligió: no le preguntes nada ni le pidas que la acepte; confirma el plan en este mismo turno.",
    "Piezas (usa exactamente estas, con su estructura_oficial y su estructura_id):",
    ...piezas,
    `Colores: usa EXACTAMENTE estos colores: ${propuesta.colores.join(", ")}; no agregues otros; si uno no tiene cobertura usa el tono más cercano de ese mismo color. Todos deben aparecer en el plan.`,
    ...(organicas.length ? [`Mezcla de tamaños: en ${listaNatural(organicas)} mezcla al menos 3 tamaños (5", 12" y 18") de cada color; una pieza orgánica nunca va en un solo tamaño.`] : []),
    "No pongas letras, números ni frases de globos.",
    `Contexto: ${contextoEvento(brief)}.`,
    // Sin describir el plan anterior: /api/chat lee las cantidades del texto como restricciones («2 columnas») y las volvía a
    // meter en un plan que el cliente pidió sin columnas (recorrido 2, 2026-10-06).
    ...(opciones?.planAnterior ? ["Es un cambio que pidió el cliente sobre su plan anterior: el plan nuevo lleva SOLO las piezas de esta lista, ni una más."] : []),
    "Cuando el plan quede confirmado, responde al cliente con una sola frase corta, sin repetir cantidades ni precios.",
    ...(opciones?.reintento ? ['El intento anterior no se pudo confirmar: busca cada color en 5", 12" y 18" antes de confirmar y usa solo variantes con cobertura.'] : []),
  ];
  return lineas.join("\n");
}

export function instruccionPlanFoto(opciones?: { reintento?: boolean }): string {
  return [
    "Sí, armémoslo. Prepara el plan para reproducir las piezas de globos aprobadas en la foto y sus colores, usando la lectura de referencia, y confírmalo con confirmar_plan_decoracion en este mismo turno sin preguntarme nada.",
    "No pongas letras, números ni frases de globos. Cuando el plan quede confirmado, responde con una sola frase corta, sin repetir cantidades ni precios.",
    ...(opciones?.reintento ? ['El intento anterior no se pudo confirmar: busca cada color en 5", 12" y 18" antes de confirmar y usa solo variantes con cobertura.'] : []),
  ].join("\n");
}

/** Brief de chat-v1 a partir de lo que ya sabe la vista guiada. Omite cadenas vacías: el briefSchema exige min(1). */
export function briefChatGuiado(propuesta: PropuestaGuiada | null, brief: BriefPlanGuiado): { tipo_evento?: string; colores?: string[]; estilo?: string } {
  const tipoEvento = limpio(brief.evento);
  const estilo = limpio(brief.tematica);
  const colores = propuesta?.colores.map((color) => color.trim()).filter((color) => color.length > 0) ?? [];
  return { ...(tipoEvento ? { tipo_evento: tipoEvento } : {}), ...(colores.length ? { colores } : {}), ...(estilo ? { estilo } : {}) };
}

function numero(valor: number): string {
  return String(Math.round(valor * 100) / 100).replace(".", ",");
}

function medidasPieza(medidas: { ancho_m?: number; alto_m?: number; largo_m?: number }): string {
  const { ancho_m: ancho, alto_m: alto, largo_m: largo } = medidas;
  if (ancho && alto) return `de ${numero(ancho)} × ${numero(alto)} m`;
  if (alto) return `de ${numero(alto)} m`;
  if (largo) return `de ${numero(largo)} m`;
  if (ancho) return `de ${numero(ancho)} m`;
  return "";
}

function esIdOficial(valor: string | undefined): valor is EstructuraOficialId {
  return valor !== undefined && (ESTRUCTURAS_OFICIALES_IDS as readonly string[]).includes(valor);
}

type PiezaPlanLeida = { oficial?: EstructuraOficialId; nombre: string; repeticiones: number; medidas: { ancho_m?: number; alto_m?: number; largo_m?: number } };

function leerPlan(plan: unknown): { piezas: PiezaPlanLeida[]; colores: string[]; total: number } | null {
  try {
    const desglose = generarPasosPlan(plan);
    const estructuras = (plan as { plan: { estructuras: Array<{ nombre: string; estructura_oficial?: string; repeticiones: number; medidas: { ancho_m?: number; alto_m?: number; largo_m?: number } }> } }).plan.estructuras;
    const piezas = estructuras.map((pieza) => ({ ...(esIdOficial(pieza.estructura_oficial) ? { oficial: pieza.estructura_oficial } : {}), nombre: pieza.nombre, repeticiones: pieza.repeticiones, medidas: pieza.medidas ?? {} }));
    const colores = [...new Set(desglose.globos.map((globo) => globo.color.trim().toLocaleLowerCase("es")).filter((color) => color.length > 0 && color !== "color indicado en el plan"))];
    return { piezas, colores, total: desglose.total };
  } catch {
    return null;
  }
}

function piezaResumen(pieza: PiezaPlanLeida): string {
  const nombre = pieza.oficial
    ? piezaEnPalabras(pieza.oficial, pieza.repeticiones).replace(/^(?:un|una|dos|tres|cuatro|\d+) /, "")
    : pieza.nombre.toLocaleLowerCase("es");
  const medidas = medidasPieza(pieza.medidas);
  return `${pieza.repeticiones} ${nombre}${medidas ? ` ${medidas}` : ""}`;
}

/**
 * Texto del mensaje del plan (viaja en el historial, así «Cambiar algo» sabe qué hay). Ej.: «Tu plan: 1 arco orgánico de
 * 2 × 2,2 m y 2 columnas de 2,4 m, en azul, blanco y dorado; 180 globos en total.». Máximo 400 caracteres, sin ids ni SKU.
 */
export function resumenPlanGuiado(plan: unknown): string {
  const leido = leerPlan(plan);
  if (!leido || !leido.piezas.length) return "Tu plan está listo.";
  const colores = leido.colores.length ? `, en ${listaNatural(leido.colores)}` : "";
  const total = leido.total > 0 ? `; ${leido.total} globos en total` : "";
  const completo = `Tu plan: ${listaNatural(leido.piezas.map(piezaResumen))}${colores}${total}.`;
  if (completo.length <= 400) return completo;
  const sinMedidas = `Tu plan: ${listaNatural(leido.piezas.map((pieza) => piezaResumen({ ...pieza, medidas: {} })))}${colores}${total}.`;
  return sinMedidas.length <= 400 ? sinMedidas : `${sinMedidas.slice(0, 398).trimEnd()}….`.slice(0, 400);
}

function describirPlanActual(plan: PlanActualGuiado): string {
  const piezas = plan.piezas.map((pieza) => `${pieza.cantidad} ${pieza.nombre ?? nombreOficial(pieza.estructura)}`);
  return `${listaNatural(piezas)} en ${listaNatural(plan.colores)}`;
}

/** Resumen estructurado del plan para `estadoGuiado.planActual`. Null si el plan no trae piezas oficiales ni colores. */
export function planActualDesdePlan(plan: unknown): PlanActualGuiado | null {
  const leido = leerPlan(plan);
  if (!leido) return null;
  const piezas = leido.piezas.flatMap((pieza) => pieza.oficial
    ? [{ estructura: pieza.oficial, cantidad: Math.min(12, Math.max(1, Math.trunc(pieza.repeticiones))), nombre: pieza.nombre.slice(0, 120) }]
    : []).slice(0, 6);
  const colores = leido.colores.map((color) => color.slice(0, 40)).slice(0, 8);
  const candidato = { piezas, colores, totalGlobos: leido.total, resumen: resumenPlanGuiado(plan) };
  const valido = PlanActualGuiadoSchema.safeParse(candidato);
  return valido.success ? valido.data : null;
}

/** Texto para el sistema del asistente guiado: el resumen si existe, o las piezas y colores. */
export function textoPlanActual(plan: PlanActualGuiado): string {
  return plan.resumen ?? `${describirPlanActual(plan)}${plan.totalGlobos ? `; ${plan.totalGlobos} globos en total` : ""}.`;
}
