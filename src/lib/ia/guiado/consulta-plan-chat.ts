import { esEstructuraOficialId, ESTRUCTURAS_OFICIALES } from "@/lib/plan/estructuras-oficiales";
import { FEMENINAS } from "@/lib/plan/piezas-individuales";
import type { PlanActualGuiado } from "@/lib/ia/contracts/asistente-guiado-v1";
import { detectarConsultaPlan, type ConsultaPlan } from "./edicion-plan-chat";
import { planActualDesdePlan } from "./instruccion-plan";
import { AVISO_CANTIDAD_APROXIMADA, detalleDeIdea, esGloboDeIdea, type DetalleIdea } from "@/lib/biblioteca-sempertex/detalle-idea";

/**
 * R del CRUD por chat (dueño, 2026-10-07): «¿qué lleva mi plan?», «¿cuántos globos tiene la columna izquierda?», «¿de
 * qué color es la guirnalda?». La respuesta sale del plan firmado que se ve (las cantidades que contó Python), sin
 * modelo y sin cambiar nada. La vista la responde en el acto; `detectarConsultaPlan` (en el servidor) deja al modelo
 * sin herramientas si la pregunta llega hasta allí.
 *
 * Puro: lo usan la vista y las pruebas.
 */

type PiezaLeida = { id: string; nombre: string; oficial: string | null; medidas: { ancho_m?: number; alto_m?: number; largo_m?: number }; globos: number; colores: Array<{ color: string; globos: number }> };

type PlanLeible = {
  plan: { estructuras: ReadonlyArray<{ estructura_id: string; nombre: string; estructura_oficial?: string; medidas: { ancho_m?: number; alto_m?: number; largo_m?: number } }> };
  estructuras: ReadonlyArray<{ estructura_id: string; lineas: ReadonlyArray<{ color?: string | null } & Record<string, unknown>> }>;
};

function leerPiezas(plan: PlanLeible): PiezaLeida[] {
  return plan.plan.estructuras.map((estructura) => {
    const lineas = plan.estructuras.find((item) => item.estructura_id === estructura.estructura_id)?.lineas ?? [];
    const porColor = new Map<string, number>();
    let globos = 0;
    for (const linea of lineas) {
      const unidades = typeof linea.unidades === "number" ? linea.unidades : 0;
      globos += unidades;
      const color = (linea.color ?? "").trim().toLocaleLowerCase("es") || "otro color";
      porColor.set(color, (porColor.get(color) ?? 0) + unidades);
    }
    return {
      id: estructura.estructura_id, nombre: estructura.nombre, oficial: estructura.estructura_oficial ?? null, medidas: estructura.medidas, globos,
      colores: [...porColor].map(([color, cantidad]) => ({ color, globos: cantidad })).sort((a, b) => b.globos - a.globos),
    };
  });
}

function lista(elementos: readonly string[]): string {
  if (elementos.length <= 1) return elementos[0] ?? "";
  return `${elementos.slice(0, -1).join(", ")} y ${elementos.at(-1)}`;
}

function metros(valor: number): string {
  return `${String(Math.round(valor * 100) / 100).replace(".", ",")} m`;
}

/** «la columna izquierda», «el semiarco orgánico». */
function conArticulo(pieza: PiezaLeida): string {
  const femenina = pieza.oficial !== null && esEstructuraOficialId(pieza.oficial) && FEMENINAS.has(pieza.oficial);
  return `${femenina ? "la" : "el"} ${pieza.nombre.toLocaleLowerCase("es")}`;
}

function conMayuscula(texto: string): string {
  return texto.charAt(0).toLocaleUpperCase("es") + texto.slice(1);
}

/** «2,4 m de largo», «2 m de alto», «2,4 × 2,2 m». */
function medidasDe(pieza: PiezaLeida): string | null {
  const { ancho_m: ancho, alto_m: alto, largo_m: largo } = pieza.medidas;
  const tipo = pieza.oficial && esEstructuraOficialId(pieza.oficial) ? ESTRUCTURAS_OFICIALES[pieza.oficial].tipoBase : null;
  if (largo && (tipo === "guirnalda" || (!ancho && !alto))) return `${metros(largo)} de largo`;
  if (tipo === "columna" && alto) return `${metros(alto)} de alto`;
  if (ancho && alto) return `${metros(ancho).replace(" m", "")} × ${metros(alto)} (ancho × alto)`;
  if (alto) return `${metros(alto)} de alto`;
  if (ancho) return `${metros(ancho)} de ancho`;
  return null;
}

function globosEnTexto(cantidad: number): string {
  return `${cantidad} ${cantidad === 1 ? "globo" : "globos"}`;
}

function coloresEnTexto(pieza: PiezaLeida): string {
  return lista(pieza.colores.map((item, indice) => `${item.color} (${indice === 0 ? globosEnTexto(item.globos) : item.globos})`));
}

export type RespuestaConsulta = { consulta: ConsultaPlan; texto: string };

/**
 * La respuesta a una pregunta sobre el plan, con sus cifras; null si el texto no es una pregunta sobre el plan (o pide
 * un cambio, o el precio). Sin piezas nombradas, del plan entero.
 */
export function responderConsultaPlan(texto: string, plan: PlanLeible, planActual?: PlanActualGuiado | null): RespuestaConsulta | null {
  // Un plan del motor 3D trae su proyección exacta; el de Python se lee del plan (`planActualDesdePlan`).
  const actual = planActual ?? planActualDesdePlan(plan);
  if (!actual) return null;
  const consulta = detectarConsultaPlan(texto, actual);
  if (!consulta) return null;
  const piezas = leerPiezas(plan);
  const pedidas = consulta.piezas.length ? piezas.filter((pieza) => consulta.piezas.includes(pieza.nombre)) : [];
  const total = piezas.reduce((suma, pieza) => suma + pieza.globos, 0);
  const colores = [...new Set(piezas.flatMap((pieza) => pieza.colores.map((item) => item.color)))];
  const detalle = (pieza: PiezaLeida) => {
    const medida = medidasDe(pieza);
    return `${conArticulo(pieza)} (${[medida, globosEnTexto(pieza.globos)].filter(Boolean).join(", ")})`;
  };
  switch (consulta.tipo) {
    case "globos": {
      if (!pedidas.length) return { consulta, texto: `Tu plan lleva ${globosEnTexto(total)} en total: ${lista(piezas.map((pieza) => `${pieza.globos} en ${conArticulo(pieza)}`))}.` };
      const [primera, ...resto] = pedidas;
      return { consulta, texto: `${conMayuscula(conArticulo(primera!))} lleva ${globosEnTexto(primera!.globos)}${resto.length ? `, ${lista(resto.map((pieza) => `${conArticulo(pieza)}, ${pieza.globos}`))}` : ""}.` };
    }
    case "colores": {
      if (!pedidas.length) return { consulta, texto: `Tu plan va en ${lista(colores)}.` };
      return { consulta, texto: pedidas.map((pieza) => `${conMayuscula(conArticulo(pieza))} va en ${coloresEnTexto(pieza)}.`).join(" ") };
    }
    case "medidas": {
      const cuales = pedidas.length ? pedidas : piezas;
      return { consulta, texto: cuales.map((pieza) => { const medida = medidasDe(pieza); return medida ? `${conMayuscula(conArticulo(pieza))} mide ${medida}.` : `${conMayuscula(conArticulo(pieza))} no se mide en metros.`; }).join(" ") };
    }
    case "resumen": {
      if (pedidas.length) return { consulta, texto: pedidas.map((pieza) => `${conMayuscula(conArticulo(pieza))}${medidasDe(pieza) ? ` mide ${medidasDe(pieza)} y` : ""} lleva ${globosEnTexto(pieza.globos)}: ${coloresEnTexto(pieza)}.`).join(" ") };
      return { consulta, texto: `Tu plan lleva ${piezas.length === 1 ? "una pieza" : `${piezas.length} piezas`}: ${lista(piezas.map(detalle))}. En total son ${globosEnTexto(total)}, en ${lista(colores)}.` };
    }
  }
}

/**
 * Juez 2026-10-11, D1: con una idea elegida y sin plan, «¿cuántos globos lleva?» recibía la pregunta de negocio o uso
 * personal. Se responde con los números de la tarjeta de la idea (`detalles-ideas.json`: los globos que suma `resumenIdea`),
 * dichos como aproximados porque el plan que arma el cliente los cuenta de nuevo. Sin modelo, sin cambiar nada.
 */
export function responderConsultaIdea(texto: string, decoracionId: string): RespuestaConsulta | null {
  const detalle = detalleDeIdea(decoracionId);
  if (!detalle || !hablaDeEstaIdea(texto)) return null;
  const consulta = detectarConsultaPlan(texto, planDetectableDeIdea(detalle));
  if (!consulta) return null;
  const limpio = plegarTexto(texto);
  // «¿qué hay de…?» pide ideas; «qué tamaño de globos» y «qué medidas tiene mi salón» no son la medida de la pieza.
  if (consulta.tipo === "resumen" && /\bque hay\b/.test(limpio)) return null;
  if (consulta.tipo === "medidas" && /\b(?:globos?|salon|mi|lugar|espacio|sala|techo|pared)\b/.test(limpio)) return null;
  const piezas = piezasDeIdea(detalle);
  const pedidas = consulta.piezas.length ? piezas.filter((pieza) => consulta.piezas.includes(pieza.nombre)) : [];
  const globosIdea = [...detalle.piezas.flatMap((pieza) => pieza.lineas), ...(detalle.lineasSinPieza ?? [])].filter(esGloboDeIdea).reduce((suma, linea) => suma + linea.unidades, 0);
  const aviso = ` ${AVISO_CANTIDAD_APROXIMADA}`;
  const enteras = pedidas.length === 0;
  const cuales = enteras ? piezas : pedidas;
  switch (consulta.tipo) {
    case "globos": {
      if (enteras) return { consulta, texto: `Esta idea lleva aprox. ${globosEnTexto(globosIdea)} Sempertex${piezas.length > 1 ? `: ${lista(piezas.map((pieza) => `${pieza.globos} en ${conArticulo(pieza)}`))}` : ""}.${aviso}` };
      return { consulta, texto: `${cuales.map((pieza) => `${conMayuscula(conArticulo(pieza))} lleva aprox. ${globosEnTexto(pieza.globos)}`).join(". ")}.${aviso}` };
    }
    case "colores": {
      return { consulta, texto: `${cuales.map((pieza) => `${conMayuscula(conArticulo(pieza))} va en ${coloresEnTexto(pieza)}`).join(". ")}.${aviso}` };
    }
    case "medidas":
      return { consulta, texto: cuales.map((pieza) => { const medida = medidasDe(pieza); return medida ? `${conMayuscula(conArticulo(pieza))} mide ${medida}.` : `${conMayuscula(conArticulo(pieza))} no se mide en metros.`; }).join(" ") };
    case "resumen": {
      const detallePieza = (pieza: PiezaLeida) => `${conArticulo(pieza)} (${[medidasDe(pieza)?.replace(" (ancho × alto)", ""), `aprox. ${globosEnTexto(pieza.globos)}`].filter(Boolean).join(", ")})`;
      const encabezado = enteras ? `Esta idea lleva ${piezas.length === 1 ? "una pieza" : `${piezas.length} piezas`}` : "Esto lleva";
      return { consulta, texto: `${encabezado}: ${lista(cuales.map(detallePieza))}.${enteras ? ` En total son aprox. ${globosEnTexto(globosIdea)}.` : ""}${aviso}` };
    }
  }
}

function plegarTexto(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
}

/**
 * Sin plan, la pregunta es por la idea elegida solo si no es genérica, hipotética ni de otra idea: sin números ni
 * medidas escritas, sin «un/una», sin condicionales («si…», «necesito») ni «la segunda» / «la de frozen».
 */
function hablaDeEstaIdea(texto: string): boolean {
  const limpio = plegarTexto(texto);
  return !/\d|\b(?:un|una|unos|unas|si|necesito|necesitaria|necesitaria|primer[ao]s?|segund[ao]s?|tercer[ao]s?|cuart[ao]s?|quint[ao]s?|sext[ao]s?|ultim[ao]s?|otra|otro|la de|el de|las de|los de)\b/.test(limpio);
}

/** Las piezas de la idea tal como las muestra su tarjeta: los globos y sus productos Sempertex, sin repartir de nuevo. */
function piezasDeIdea(detalle: DetalleIdea): PiezaLeida[] {
  return detalle.piezas.map((pieza) => {
    const porProducto = new Map<string, number>();
    for (const linea of pieza.lineas) if (esGloboDeIdea(linea)) porProducto.set(linea.producto, (porProducto.get(linea.producto) ?? 0) + linea.unidades);
    const colores = [...porProducto].map(([color, globos]) => ({ color, globos })).sort((a, b) => b.globos - a.globos);
    const globos = colores.length ? colores.reduce((suma, item) => suma + item.globos, 0) : pieza.total;
    return { id: pieza.id, nombre: pieza.nombre, oficial: pieza.estructura, medidas: pieza.medidas, globos, colores };
  });
}

/** Solo para detectar la pregunta y las piezas nombradas: el plan de `detectarConsultaPlan` pide al menos un color. */
function planDetectableDeIdea(detalle: DetalleIdea): PlanActualGuiado {
  const colores = [...new Set(detalle.piezas.flatMap((pieza) => pieza.colores))].slice(0, 8);
  return {
    piezas: detalle.piezas.map((pieza) => ({ estructura: pieza.estructura, cantidad: pieza.repeticiones, nombre: pieza.nombre })),
    colores: colores.length ? colores : ["otro color"],
  };
}
