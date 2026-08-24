import type { Brief } from "@/lib/types";
import type { ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import type { PlanDecoracion, RestriccionesUsuario, TipoEstructura } from "./tipos";

const NUMEROS: Record<string, number> = {
  un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10,
};

const ESTRUCTURAS: Array<{ tipo: TipoEstructura; aliases: string[] }> = [
  { tipo: "arco", aliases: ["arco", "arcos"] },
  { tipo: "columna", aliases: ["columna", "columnas"] },
  { tipo: "guirnalda", aliases: ["guirnalda", "guirnaldas"] },
  { tipo: "semiarco", aliases: ["semiarco", "semiarcos"] },
  { tipo: "pared", aliases: ["pared", "paredes"] },
  { tipo: "centro_mesa", aliases: ["centro de mesa", "centros de mesa"] },
  { tipo: "backdrop", aliases: ["backdrop", "telon", "telón"] },
];

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function numero(raw: string): number | null {
  const limpio = normalizar(raw).replace(/\s/g, "");
  if (NUMEROS[limpio]) return NUMEROS[limpio];
  const parsed = Number(limpio.replace(/\.(?=\d{3}(?:\D|$))/g, ""));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function extraerTecho(texto: string): number | null {
  const normalizado = normalizar(texto);
  const monto = (raw: string, sufijo?: string): number | null => {
    const base = Number(raw.replace(/\./g, ""));
    if (!Number.isFinite(base) || base <= 0) return null;
    return Math.round(base * (sufijo ? 1000 : 1));
  };
  const rango = normalizado.match(/\$?\s*([\d.]+)\s*(mil|k)?\s*(?:a|hasta|-)\s*\$?\s*([\d.]+)\s*(mil|k)?/i);
  if (rango) return monto(rango[3]!, rango[4]);
  const match = normalizado.match(/(?:hasta|tope|presupuesto|maximo|no mas de|menos de)\s*\$?\s*([\d.]+)\s*(mil|k)?/i);
  return match ? monto(match[1]!, match[2]) : null;
}

function extraerLista(texto: string, aliases: string[], limite = 8): string[] {
  const normalized = normalizar(texto);
  const resultado: string[] = [];
  for (const alias of aliases.slice().sort((a, b) => b.length - a.length)) {
    const valor = normalizar(alias);
    const encontrado = new RegExp(`(?:^|[\\s,;])${valor}(?:$|[\\s,;.!?])`, "i").test(normalized);
    const prohibido = normalized.includes(`sin ${valor}`) || normalized.includes(`no ${valor}`) || normalized.includes(`sin color ${valor}`);
    if (!encontrado || prohibido) continue;
    const canonico = valor === "rosado" || valor === "rosa" ? "rosa" : valor === "plata" || valor === "plateado" ? "plateado" : valor;
    if (!resultado.includes(canonico)) resultado.push(canonico);
    if (resultado.length >= limite) break;
  }
  return resultado;
}

export function extraerRestriccionesUsuario(texto: string, brief: Brief = {}): RestriccionesUsuario {
  const source = texto.trim() || "solicitud del cliente";
  const estructuras: RestriccionesUsuario["estructuras"] = [];
  for (const estructura of ESTRUCTURAS) {
    const aliases = estructura.aliases.map(normalizar).sort((a, b) => b.length - a.length).join("|");
    const patron = new RegExp(`(?:\\b(\\d+|${Object.keys(NUMEROS).join("|")})\\s+(?:${aliases})\\b|\\b(?:${aliases})\\s+(\\d+|${Object.keys(NUMEROS).join("|")})\\b)`, "i");
    const match = normalizar(texto).match(patron);
    if (!match) continue;
    const cantidad = numero(match[1] ?? match[2] ?? "1") ?? 1;
    estructuras.push({ tipo: estructura.tipo, repeticiones: Math.min(24, cantidad), procedencia: "explicito", texto_original: source, polaridad: "obligatorio" });
  }

  // A numeric brief may have been inferred by Gemini. It is not a customer
  // constraint unless the original message contains the amount as well.
  const presupuestoEnTexto = extraerTecho(texto);
  const presupuesto = presupuestoEnTexto ?? (typeof brief.presupuesto === "number" ? brief.presupuesto : extraerTecho(String(brief.presupuesto ?? "")));
  const presupuestoExplicito = presupuestoEnTexto !== null;
  const colores = extraerLista(texto, ["dorado", "plateado", "plata", "rosado", "rosa", "rojo", "negro", "blanco", "azul", "verde", "morado", "lila", "nude"])
    .map((valor) => ({ valor, procedencia: "explicito" as const, texto_original: source, polaridad: "obligatorio" as const }));
  const tamanos = [...normalizar(texto).matchAll(/\br[- ]?(5|9|12|18|24|36|40)\b|\b(5|9|12|18|24|36|40)\s*(?:pulgadas?|in)\b/gi)]
    .map((match) => match[1] ?? match[2])
    .filter((valor): valor is string => Boolean(valor))
    .map((valor) => ({ valor: `R-${valor}`, procedencia: "explicito" as const, texto_original: source, polaridad: "obligatorio" as const }));
  const acabados = extraerLista(texto, ["reflex", "satin", "metal", "metalizado", "fashion", "latex"])
    .map((valor) => ({ valor, procedencia: "explicito" as const, texto_original: source, polaridad: "obligatorio" as const }));

  return {
    ...(presupuesto ? { presupuesto: { techo_cop: Math.round(presupuesto), procedencia: presupuestoExplicito ? "explicito" as const : "inferido" as const, texto_original: source } } : {}),
    estructuras,
    colores,
    tamanos,
    acabados,
  };
}

export function validarRestriccionesPlan(plan: PlanDecoracion, restricciones: RestriccionesUsuario): string[] {
  const errores: string[] = [];
  for (const requerida of restricciones.estructuras) {
    const total = plan.estructuras.filter((estructura) => estructura.tipo === requerida.tipo)
      .reduce((sum, estructura) => sum + estructura.repeticiones, 0);
    if (total !== requerida.repeticiones) errores.push(`Se solicitaron ${requerida.repeticiones} ${requerida.tipo}(s) y el plan declara ${total}.`);
  }
  if (restricciones.colores.filter((color) => color.polaridad === "obligatorio").length) {
    const coloresPlan = new Set(plan.estructuras.flatMap((estructura) => estructura.materiales.map((material) => normalizar(material.color ?? ""))).filter(Boolean));
    for (const color of restricciones.colores.filter((item) => item.polaridad === "obligatorio")) {
      const requerido = normalizar(color.valor).replace("plata", "plateado");
      const cubierto = [...coloresPlan].some((disponible) => disponible === requerido || disponible.includes(requerido) || requerido.includes(disponible));
      if (!cubierto) errores.push(`Falta el color explícito ${color.valor}.`);
    }
  }
  if (restricciones.acabados.filter((acabado) => acabado.polaridad === "obligatorio").length) {
    const acabadosPlan = new Set(plan.estructuras.flatMap((estructura) => estructura.materiales.map((material) => normalizar(material.acabado ?? ""))).filter(Boolean));
    for (const acabado of restricciones.acabados.filter((item) => item.polaridad === "obligatorio")) {
      const requerido = normalizar(acabado.valor);
      const cubierto = [...acabadosPlan].some((disponible) => disponible === requerido || disponible.includes(requerido) || requerido.includes(disponible));
      if (!cubierto) errores.push(`Falta el acabado explícito ${acabado.valor}.`);
    }
  }
  return errores;
}

/**
 * Cobertura referencia→plan (R4): con un blueprint de referencia en el
 * turno, cada elemento APROBADO debe quedar cubierto por
 * `estructuras[].referencia_element_id` o declarado en
 * `referencia_omitida` con un motivo. Sin blueprint no hay nada que
 * validar. Devuelve los `element_id` que ninguna de las dos listas cubrió.
 */
export function validarCoberturaReferencia(plan: PlanDecoracion, blueprint: ReferenceBlueprintV2 | undefined): string[] {
  if (!blueprint) return [];
  const aprobados = blueprint.elements.filter((element) => element.approved).map((element) => element.element_id);
  if (aprobados.length === 0) return [];
  const cubiertos = new Set([
    ...plan.estructuras.map((estructura) => estructura.referencia_element_id).filter((id): id is string => Boolean(id)),
    ...plan.referencia_omitida.map((item) => item.element_id),
  ]);
  return aprobados.filter((id) => !cubiertos.has(id));
}
