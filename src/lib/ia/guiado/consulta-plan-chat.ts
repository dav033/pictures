import { esEstructuraOficialId, ESTRUCTURAS_OFICIALES } from "@/lib/plan/estructuras-oficiales";
import { FEMENINAS } from "@/lib/plan/piezas-individuales";
import type { PlanActualGuiado } from "@/lib/ia/contracts/asistente-guiado-v1";
import { detectarConsultaPlan, type ConsultaPlan } from "./edicion-plan-chat";
import { planActualDesdePlan } from "./instruccion-plan";

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
