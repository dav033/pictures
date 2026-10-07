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

/** Piezas que solo se ven orgánicas si mezclan tamaños: sin la orden explícita el plan salía todo en 12". */
export const ESTRUCTURAS_ORGANICAS: ReadonlySet<EstructuraOficialId> = new Set<EstructuraOficialId>([
  "arco_asimetrico", "semiarco_asimetrico", "columna_asimetrica", "pared_organica", "guirnalda", "racimo_pared",
]);

/** Lo que no es un globo liso (impresos, Infinity, dos caras, balones, frases) no va en una pieza del plan guiado. */
const GLOBO_NO_LISO = /impres|estampad|2 caras|dos caras|feliz|cumplea|happy|birthday|infinity|bal[oó]n|f[uú]tbol|\bcopa\b/i;

/** Orden de globos lisos. Sin la palabra «látex»: en el texto del cliente bloquea la categoría en la búsqueda del catálogo. */
const SOLO_LISOS = "Usa solo globos lisos de un solo color: nada estampado, impreso ni con dibujos, letras, números o frases.";

const REINTENTO = 'El intento anterior no sirvió: busca cada color en los tamaños que existan (5", 12", 18"), solo globos lisos de un solo color, incluye TODOS los colores pedidos y usa solo variantes con cobertura antes de confirmar.';

function nombreOficial(estructura: EstructuraOficialId): string {
  return ESTRUCTURAS_OFICIALES[estructura].nombre;
}

/** estructura_id con el formato que exige el plan (EST_01_ARCO_ASIMETRICO): un id mal formado hacía fallar el primer confirmar. */
function estructuraId(indice: number, estructura: EstructuraOficialId): string {
  return `EST_${String(indice + 1).padStart(2, "0")}_${estructura.toUpperCase()}`;
}

function listaColores(colores: readonly string[]): string[] {
  return [...new Set(colores.map((color) => color.trim().toLocaleLowerCase("es")).filter((color) => color.length > 0))];
}

/**
 * Globo liso redondo con el que se busca cada color. Sin la pista el modelo usaba el MISMO producto (un transparente) para
 * «transparente» y «plateado»; el servidor le devolvía al material su color real y la validación rechazaba el plan 3 veces
 * por «falta el plateado» (producción, 2026-10-06).
 */
const BUSQUEDA_COLOR: Readonly<Record<string, string>> = {
  // Sin nombres de acabado (Reflex, Satin, Fashion): /api/chat los lee como acabados obligatorios y rechaza el plan.
  plateado: "globo redondo plata",
  dorado: "globo redondo oro",
  transparente: "globo redondo cristal",
  blanco: "globo redondo blanco",
  negro: "globo redondo negro",
  rosado: "globo redondo rosado",
  "dorado rosa": "globo redondo oro rosa",
};

function lineaColores(colores: readonly string[]): string {
  const pistas = colores.filter((color) => BUSQUEDA_COLOR[color]).map((color) => `${color} → ${BUSQUEDA_COLOR[color]}`);
  return [
    `Colores: usa EXACTAMENTE estos colores: ${colores.join(", ")}; no agregues otros; si uno no tiene cobertura usa el tono más cercano de ese mismo color. Todos deben aparecer en el plan.`,
    `Busca cada color por separado y usa un producto distinto para cada uno, cuyo color de catálogo sea ese color (nunca el mismo product_id para dos colores).${pistas.length ? ` Búsquedas sugeridas: ${pistas.join("; ")}.` : ""}`,
  ].join("\n");
}

/**
 * Instrucción con la que la vista guiada pide el plan a /api/chat. NO lleva el evento ni la temática: /api/chat toma este
 * mensaje como lo que dijo el cliente y vuelve la ocasión un filtro duro del catálogo. Con «Cumpleaños» solo quedaban globos
 * impresos de cumpleaños (balón de fútbol, copa dorada, «feliz cumpleaños»), todos de 12", y el arco orgánico salía de un
 * solo tamaño (verificación del 2026-10-06: 4 de 4 planes de cumpleaños). Las piezas y los colores ya están decididos, y la
 * imagen recibe el evento y la temática por su propio brief.
 */
export function instruccionPlanGuiado(propuesta: PropuestaGuiada, opciones?: { reintento?: boolean; planAnterior?: PlanActualGuiado }): string {
  const piezas = propuesta.piezas.map((pieza, indice) => `- ${pieza.cantidad} × ${nombreOficial(pieza.estructura)} (estructura_oficial: ${pieza.estructura}; estructura_id: ${estructuraId(indice, pieza.estructura)}; repeticiones: ${pieza.cantidad})`);
  const organicas = [...new Set(propuesta.piezas.filter((pieza) => ESTRUCTURAS_ORGANICAS.has(pieza.estructura)).map((pieza) => nombreOficial(pieza.estructura)))];
  const lineas = [
    "Resuelve ahora el plan exacto de esta decoración con confirmar_plan_decoracion. El cliente ya la eligió: no le preguntes nada ni le pidas que la acepte; confirma el plan en este mismo turno.",
    "Piezas (usa exactamente estas, con su estructura_oficial y su estructura_id):",
    ...piezas,
    lineaColores(listaColores(propuesta.colores)),
    // «de cada color» era imposible para colores con pocos tamaños lisos (plateado): el modelo lo quitaba, la validación
    // rechazaba el plan 3 veces y la guiada mostraba «No pude terminar este plan» (producción, 2026-10-06).
    ...(organicas.length ? [`Mezcla de tamaños: en ${listaNatural(organicas)} mezcla al menos 3 tamaños (por ejemplo 5", 12" y 18") en la pieza; no hace falta que cada color tenga todos los tamaños: un color con pocos tamaños disponibles va en los que tenga, pero ningún color se quita. Una pieza orgánica nunca va en un solo tamaño.`] : []),
    SOLO_LISOS,
    // Sin describir el plan anterior: /api/chat lee las cantidades del texto como restricciones («2 columnas») y las volvía a
    // meter en un plan que el cliente pidió sin columnas (recorrido 2, 2026-10-06).
    ...(opciones?.planAnterior ? ["Es un cambio que pidió el cliente sobre su plan anterior: el plan nuevo lleva SOLO las piezas de esta lista, ni una más."] : []),
    "Cuando el plan quede confirmado, responde al cliente con una sola frase corta, sin repetir cantidades ni precios.",
    ...(opciones?.reintento ? [REINTENTO] : []),
  ];
  return lineas.join("\n");
}

/**
 * «Sí, armémoslo» con una foto. `colores` son los que la lectura le mostró al cliente («Veo un arco en dorado, blanco, azul
 * y rosa»): sin ellos el plan seguía al análisis crudo y perdía el azul que el cliente vio y aprobó.
 */
export function instruccionPlanFoto(opciones?: { reintento?: boolean; colores?: readonly string[] }): string {
  const colores = listaColores(opciones?.colores ?? []);
  return [
    "Sí, armémoslo. Prepara el plan para reproducir las piezas de globos aprobadas en la foto y sus colores, usando la lectura de referencia, y confírmalo con confirmar_plan_decoracion en este mismo turno sin preguntarme nada.",
    ...(colores.length ? [lineaColores(colores)] : []),
    `${SOLO_LISOS} Cuando el plan quede confirmado, responde con una sola frase corta, sin repetir cantidades ni precios.`,
    ...(opciones?.reintento ? [REINTENTO] : []),
  ].join("\n");
}

/** Brief de chat-v1 del plan: solo los colores, sin evento ni temática (ver instruccionPlanGuiado). El briefSchema exige min(1). */
export function briefChatGuiado(colores: readonly string[]): { colores?: string[] } {
  const lista = listaColores(colores);
  return lista.length ? { colores: lista } : {};
}

type LineaPlanRevisada = { titulo?: string; diam_pulg?: number | null; tamano_codigo?: string | null; unidades?: number };
type PlanRevisado = {
  plan?: { estructuras?: Array<{ estructura_id?: string; estructura_oficial?: string; nombre?: string }> };
  estructuras?: Array<{ estructura_id?: string; lineas?: LineaPlanRevisada[] }>;
  compras?: Array<{ titulo?: string }>;
};

/**
 * Por qué un plan confirmado no sirve para la vista guiada (una pieza orgánica en un solo tamaño o globos que no son lisos),
 * o null si sirve. No toca cantidades, que son de Python: solo decide si se gasta el reintento automático en pedirlo otra vez.
 */
export function defectoPlanGuiado(plan: unknown, cotizacion?: unknown): string | null {
  if (!plan || typeof plan !== "object") return null;
  const leido = plan as PlanRevisado;
  for (const pieza of leido.plan?.estructuras ?? []) {
    if (!esIdOficial(pieza.estructura_oficial) || !ESTRUCTURAS_ORGANICAS.has(pieza.estructura_oficial)) continue;
    const lineas = leido.estructuras?.find((estructura) => estructura.estructura_id === pieza.estructura_id)?.lineas ?? [];
    const tamanos = new Set(lineas.filter((linea) => (linea.unidades ?? 1) > 0).map((linea) => linea.diam_pulg ?? linea.tamano_codigo).filter((tamano) => tamano != null));
    if (tamanos.size < 2) return `la pieza orgánica «${pieza.nombre ?? pieza.estructura_oficial}» salió en un solo tamaño`;
  }
  const lineasCotizacion = (cotizacion as { lineas?: Array<{ nombre?: unknown }> } | null | undefined)?.lineas ?? [];
  const titulos = [
    ...(leido.estructuras ?? []).flatMap((estructura) => estructura.lineas ?? []).map((linea) => linea.titulo),
    ...(leido.compras ?? []).map((compra) => compra.titulo),
    ...lineasCotizacion.map((linea) => linea.nombre),
  ].filter((titulo): titulo is string => typeof titulo === "string");
  const noLiso = titulos.find((titulo) => GLOBO_NO_LISO.test(titulo));
  return noLiso ? `trae globos que no son lisos («${noLiso}»)` : null;
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
