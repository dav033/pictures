import type { z } from "zod";
import { PlanActualGuiadoSchema, type PlanActualGuiado, type PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { ESTRUCTURAS_OFICIALES, ESTRUCTURAS_OFICIALES_IDS, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { ladoDeUbicacion, MAX_PIEZAS_PLAN, piezasIndividualesDePropuesta, type Lateral, type PiezaIndividual } from "@/lib/plan/piezas-individuales";
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
  // Piezas SIEMPRE individuales: una línea por pieza, con repeticiones 1, su propio id y su lado. Antes la línea era
  // «2 × Columna (…; repeticiones: 2)»: le pedíamos UNA estructura repetida y la guiada mostraba «2 × Columna», sin
  // forma de quitar solo una (registro guiada-20261006-212136-dgkw9b). Sin nombres («Columna 1» activa
  // `extraerRestriccionesUsuario`): el servidor los pone al confirmar.
  const { piezas: individuales } = piezasIndividualesDePropuesta(propuesta.piezas);
  const colores = listaColores(propuesta.colores);
  const conservadas = opciones?.planAnterior ? piezasConservadas(individuales, opciones.planAnterior, colores) : new Map<string, PiezaConservada>();
  const piezas = individuales.map((pieza) => {
    const conservada = conservadas.get(pieza.estructuraId);
    const datos = [
      `estructura_oficial: ${pieza.estructura}`,
      `estructura_id: ${pieza.estructuraId}`,
      ...(pieza.ubicacion ? [`ubicacion: ${pieza.ubicacion}`] : []),
      "repeticiones: 1",
      ...(conservada?.medidas ? [`medidas: ${conservada.medidas}`] : []),
      ...(conservada?.participacion ? [`participacion: ${conservada.participacion}`] : []),
    ];
    return `- ${nombreOficial(pieza.estructura)} (${datos.join("; ")})`;
  });
  const organicas = [...new Set(individuales.filter((pieza) => ESTRUCTURAS_ORGANICAS.has(pieza.estructura)).map((pieza) => nombreOficial(pieza.estructura)))];
  const lineas = [
    "Resuelve ahora el plan exacto de esta decoración con confirmar_plan_decoracion. El cliente ya la eligió: no le preguntes nada ni le pidas que la acepte; confirma el plan en este mismo turno.",
    "Piezas (usa exactamente estas, con su estructura_oficial, su estructura_id y su ubicacion si la trae):",
    ...piezas,
    "Cada línea es UNA pieza del plan: una estructura propia con repeticiones 1. Nunca juntes dos líneas en una estructura repetida.",
    ...(conservadas.size ? ["Las piezas que traen medidas o participacion ya están en el plan del cliente: usa EXACTAMENTE esas medidas en la estructura y esa participacion por color en sus materiales; no las cambies."] : []),
    lineaColores(colores),
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

type PiezaConservada = { medidas?: string; participacion?: string };
type PiezaAnterior = { estructura: EstructuraOficialId; ubicacion?: Lateral; medidas?: PlanActualGuiado["piezas"][number]["medidas"]; participacion?: PlanActualGuiado["piezas"][number]["participacion"] };

/** Número con punto y sin ceros de más («2.46»): el texto no lleva coma decimal, que se leería como separador. */
function decimal(valor: number): string {
  return String(Math.round(valor * 100) / 100);
}

/**
 * Lo que «Cambiar algo» conserva de cada pieza que sigue en el plan: sus medidas y la parte de cada color (de los globos
 * que Python resolvió, con los ajustes que el cliente ya hizo). Sin esto el modelo elegía medidas nuevas: tras ajustar,
 * el arco pasaba de 3 × 2,5 a 2,5 × 2,2 m y las columnas de 2,46 a 2 m (verificación de «Ajustar mi plan», 2026-10-06).
 * Cada pieza nueva toma la anterior de su misma oficial (la del mismo lado primero). La participación solo viaja si el
 * cliente no pidió colores nuevos y la pieza no lleva colores que ya no están. Sin nombres ni «una columna»: ver arriba.
 */
function piezasConservadas(individuales: readonly PiezaIndividual[], anterior: PlanActualGuiado, colores: readonly string[]): Map<string, PiezaConservada> {
  const previas: PiezaAnterior[] = anterior.piezas.flatMap((pieza) => Array.from({ length: pieza.cantidad }, (_, indice) => ({
    estructura: pieza.estructura,
    ...(pieza.cantidad === 2 ? { ubicacion: indice === 0 ? "lateral_izquierdo" as const : "lateral_derecho" as const } : pieza.ubicacion ? { ubicacion: pieza.ubicacion } : {}),
    ...(pieza.medidas ? { medidas: pieza.medidas } : {}),
    ...(pieza.participacion ? { participacion: pieza.participacion } : {}),
  })));
  const disponibles = new Set(colores);
  const anteriores = new Set(anterior.colores.map((color) => color.trim().toLocaleLowerCase("es")));
  const sinColoresNuevos = colores.every((color) => anteriores.has(color));
  const usadas = new Set<number>();
  const resultado = new Map<string, PiezaConservada>();
  for (const pieza of individuales) {
    const candidatas = previas.map((previa, indice) => ({ previa, indice })).filter(({ previa }) => previa.estructura === pieza.estructura);
    const elegida = candidatas.find(({ previa, indice }) => !usadas.has(indice) && pieza.ubicacion !== undefined && previa.ubicacion === pieza.ubicacion)
      ?? candidatas.find(({ indice }) => !usadas.has(indice))
      ?? candidatas[0];
    if (!elegida) continue;
    usadas.add(elegida.indice);
    const { medidas, participacion } = elegida.previa;
    const textoMedidas = medidas ? (["ancho_m", "alto_m", "largo_m"] as const).flatMap((campo) => (medidas[campo] ? [`${campo} ${decimal(medidas[campo])}`] : [])).join(", ") : "";
    const partes = sinColoresNuevos && participacion?.length && participacion.every((parte) => disponibles.has(parte.color.trim().toLocaleLowerCase("es")))
      ? participacion.map((parte) => `${parte.color.trim().toLocaleLowerCase("es")} ${decimal(parte.parte)}`).join(", ")
      : "";
    if (!textoMedidas && !partes) continue;
    resultado.set(pieza.estructuraId, { ...(textoMedidas ? { medidas: textoMedidas } : {}), ...(partes ? { participacion: partes } : {}) });
  }
  return resultado;
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

type MedidasLeidas = { ancho_m?: number; alto_m?: number; largo_m?: number };
type PiezaPlanLeida = { oficial?: EstructuraOficialId; nombre: string; repeticiones: number; ubicacion?: string; medidas: MedidasLeidas; participacion: Array<{ color: string; parte: number }> };
type EstructuraLeida = { estructura_id: string; nombre: string; estructura_oficial?: string; repeticiones: number; ubicacion?: string; medidas?: MedidasLeidas };
type LineasLeidas = Array<{ estructura_id?: string; lineas?: Array<{ color?: string | null; unidades?: number }> }>;

/** Partes en centésimas que suman 1 (mayor resto), de los globos por color que resolvió Python. */
function partesPorColor(lineas: ReadonlyArray<{ color?: string | null; unidades?: number }>): Array<{ color: string; parte: number }> {
  const porColor = new Map<string, number>();
  for (const linea of lineas) {
    const color = (linea.color ?? "").trim().toLocaleLowerCase("es");
    if (color && (linea.unidades ?? 0) > 0) porColor.set(color, (porColor.get(color) ?? 0) + (linea.unidades ?? 0));
  }
  const total = [...porColor.values()].reduce((suma, valor) => suma + valor, 0);
  if (total <= 0) return [];
  const exactas = [...porColor].map(([color, unidades]) => ({ color, centesimas: (unidades / total) * 100 }));
  const enteras = exactas.map((parte) => Math.floor(parte.centesimas));
  let resto = 100 - enteras.reduce((suma, valor) => suma + valor, 0);
  for (const indice of exactas.map((parte, posicion) => ({ posicion, fraccion: parte.centesimas - Math.floor(parte.centesimas) })).sort((a, b) => b.fraccion - a.fraccion).map((parte) => parte.posicion)) {
    if (resto <= 0) break;
    enteras[indice]! += 1;
    resto -= 1;
  }
  return exactas.map((parte, posicion) => ({ color: parte.color, parte: enteras[posicion]! / 100 })).filter((parte) => parte.parte > 0);
}

function leerPlan(plan: unknown): { piezas: PiezaPlanLeida[]; colores: string[]; total: number } | null {
  try {
    const desglose = generarPasosPlan(plan);
    const estructuras = (plan as { plan: { estructuras: EstructuraLeida[] } }).plan.estructuras;
    const resueltas = (plan as { estructuras?: LineasLeidas }).estructuras ?? [];
    const piezas = estructuras.map((pieza): PiezaPlanLeida => ({
      ...(esIdOficial(pieza.estructura_oficial) ? { oficial: pieza.estructura_oficial } : {}),
      nombre: pieza.nombre,
      repeticiones: pieza.repeticiones,
      ...(pieza.ubicacion ? { ubicacion: pieza.ubicacion } : {}),
      medidas: pieza.medidas ?? {},
      participacion: partesPorColor(resueltas.find((resuelta) => resuelta.estructura_id === pieza.estructura_id)?.lineas ?? []),
    }));
    const colores = [...new Set(desglose.globos.map((globo) => globo.color.trim().toLocaleLowerCase("es")).filter((color) => color.length > 0 && color !== "color indicado en el plan"))];
    return { piezas, colores, total: desglose.total };
  } catch {
    return null;
  }
}

/** Nombre individual que puso el servidor («Columna izquierda», «Centro de mesa con globos 2»). */
const NOMBRE_INDIVIDUAL = /\s(?:izquierd[ao]|derech[ao]|\d+)$/i;

function piezaResumen(pieza: PiezaPlanLeida): string {
  const medidas = medidasPieza(pieza.medidas);
  // Una pieza individual se nombra como la ve el cliente («columna izquierda de 2,4 m»): así el chat sabe cuál es cuál.
  if (pieza.oficial && pieza.repeticiones === 1 && NOMBRE_INDIVIDUAL.test(pieza.nombre.trim())) return `${pieza.nombre.trim().toLocaleLowerCase("es")}${medidas ? ` ${medidas}` : ""}`;
  const nombre = pieza.oficial
    ? piezaEnPalabras(pieza.oficial, pieza.repeticiones).replace(/^(?:un|una|dos|tres|cuatro|\d+) /, "")
    : pieza.nombre.toLocaleLowerCase("es");
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
  const piezas = leido.piezas.flatMap((pieza) => {
    if (!pieza.oficial) return [];
    const medidas = Object.fromEntries((["ancho_m", "alto_m", "largo_m"] as const).flatMap((campo) => {
      const valor = pieza.medidas[campo];
      return valor && valor > 0 && valor <= 100 ? [[campo, valor]] : [];
    }));
    const lado = ladoDeUbicacion(pieza.ubicacion);
    return [{
      estructura: pieza.oficial,
      cantidad: Math.min(12, Math.max(1, Math.trunc(pieza.repeticiones))),
      nombre: pieza.nombre.slice(0, 120),
      ...(lado ? { ubicacion: pieza.ubicacion as Lateral } : {}),
      ...(Object.keys(medidas).length ? { medidas } : {}),
      ...(pieza.participacion.length ? { participacion: pieza.participacion.slice(0, 6).map((parte) => ({ color: parte.color.slice(0, 40), parte: parte.parte })) } : {}),
    }];
  }).slice(0, MAX_PIEZAS_PLAN);
  const colores = leido.colores.map((color) => color.slice(0, 40)).slice(0, 8);
  const candidato = { piezas, colores, totalGlobos: leido.total, resumen: resumenPlanGuiado(plan) };
  const valido = PlanActualGuiadoSchema.safeParse(candidato);
  return valido.success ? valido.data : null;
}

/** Texto para el sistema del asistente guiado: el resumen si existe, o las piezas y colores. */
export function textoPlanActual(plan: PlanActualGuiado): string {
  return plan.resumen ?? `${describirPlanActual(plan)}${plan.totalGlobos ? `; ${plan.totalGlobos} globos en total` : ""}.`;
}
