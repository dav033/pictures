import type { Brief } from "@/lib/types";
import type { ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import { ALCANCE_POR_CATEGORIA_REFERENCIA } from "@/lib/rag/taxonomy/alcance-referencia";
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
  // "entre X y Z" es tan común como "de X a Z"; sin la `y` el rango no se
  // reconocía y caía al patrón de abajo, que tomaba el piso como techo.
  const rango = normalizado.match(/\$?\s*([\d.]+)\s*(mil|k)?\s*(?:a|hasta|y|-)\s*\$?\s*([\d.]+)\s*(mil|k)?/i);
  if (rango) return monto(rango[3]!, rango[4]);
  // Los conectores entre la palabra clave y el monto son la forma NORMAL de
  // decirlo en español ("mi presupuesto es de 50k"), y sin ellos el techo se
  // perdía en silencio: el plan se diseñaba sin restricción y el sobrecosto
  // recién aparecía al cotizar.
  const conector = "(?:\\s+(?:es|era|seria|sera|anda|ronda|de|en|por|como|mas|menos|o|:|,)){0,3}";
  const match = normalizado.match(new RegExp(`(?:hasta|tope|presupuesto|maximo|limite|no mas de|menos de)${conector}\\s*\\$?\\s*([\\d.]+)\\s*(mil|k)?`, "i"));
  if (match) return monto(match[1]!, match[2]);
  // Sin palabra clave, un monto solo cuenta si viene marcado como dinero:
  // "$50.000", "50k pesos", "50 mil cop". Un número suelto es ambiguo
  // (invitados, metros, fecha) y no debe tomarse como techo.
  const conMoneda = normalizado.match(/\$\s*([\d.]+)\s*(mil|k)?|([\d.]+)\s*(mil|k)\s*(?:cop|pesos)/i);
  if (conMoneda) return monto(conMoneda[1] ?? conMoneda[3]!, conMoneda[2] ?? conMoneda[4]);
  return null;
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
  const colores = extraerLista(texto, [
    "dorado", "dorada", "dorados", "doradas", "plateado", "plateada", "plateados", "plateadas", "plata",
    "rosado", "rosada", "rosados", "rosadas", "rosa", "rojo", "roja", "rojos", "rojas", "negro", "negra", "negros", "negras",
    "blanco", "blanca", "blancos", "blancas", "azul", "azules", "verde", "verdes", "morado", "morada", "morados", "moradas", "lila", "nude",
  ])
    .map((valor) => {
      if (/^dorad/.test(valor)) return "dorado";
      if (/^platead|^plata$/.test(valor)) return "plateado";
      if (/^rosad|^rosa$/.test(valor)) return "rosa";
      if (/^roj/.test(valor)) return "rojo";
      if (/^negr/.test(valor)) return "negro";
      if (/^blanc/.test(valor)) return "blanco";
      if (/^azul/.test(valor)) return "azul";
      if (/^verd/.test(valor)) return "verde";
      if (/^morad/.test(valor)) return "morado";
      return valor;
    })
    .filter((valor, index, values) => values.indexOf(valor) === index)
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
  const aprobados = blueprint.elements.filter((element) => element.approved);
  if (aprobados.length === 0) return [];
  const elementosPorId = new Map(blueprint.elements.map((element) => [element.element_id, element]));
  const cubiertos = new Set<string>();
  const invalidos = new Set<string>();

  for (const estructura of plan.estructuras) {
    const elementId = estructura.referencia_element_id;
    if (!elementId) continue;
    const elemento = elementosPorId.get(elementId);
    if (!elemento || !elemento.approved) {
      invalidos.add(elementId);
      continue;
    }
    const alcance = ALCANCE_POR_CATEGORIA_REFERENCIA[elemento.category];
    // Mobiliario, flores, iluminacion, soportes y elementos desconocidos nunca
    // se emulan con globos ni pueden declararse incluidos.
    // Una reinterpretacion emulable queda como propuesta pendiente; no entra
    // en estructuras del primer plan sin respuesta afirmativa del cliente.
    if (alcance.alcance === "fuera_de_catalogo" || alcance.alcance === "emulable") {
      invalidos.add(elementId);
      continue;
    }
    cubiertos.add(elementId);
  }

  for (const item of plan.referencia_omitida) {
    const elemento = elementosPorId.get(item.element_id);
    if (!elemento || !elemento.approved) continue;
    const alcance = ALCANCE_POR_CATEGORIA_REFERENCIA[elemento.category];
    if (item.motivo_tipo === "fuera_de_catalogo" && alcance.alcance !== "fuera_de_catalogo") {
      invalidos.add(item.element_id);
      continue;
    }
    if ((item.motivo_tipo === "emulacion_propuesta" || item.motivo_tipo === "emulacion_rechazada") && alcance.alcance !== "emulable") {
      invalidos.add(item.element_id);
      continue;
    }
    cubiertos.add(item.element_id);
  }

  return aprobados
    .map((element) => element.element_id)
    .filter((id) => invalidos.has(id) || !cubiertos.has(id));
}

/**
 * Evento abierto necesita composición mínima para no cotizar un único
 * elemento genérico. Se permite pieza única solo cuando cliente lo pidió de
 * forma explícita; productos deben seguir saliendo de whitelist RAG.
 */
export function validarCardinalidadEventoAbierto(
  plan: PlanDecoracion,
  // EventIntentV2 keeps this compatibility field extensible for persisted
  // payloads; parser currently emits only `open`/`wedding`. Keep validator
  // compatible with that schema and reject every non-open value below.
  eventType: string,
  solicitudOriginal: string,
  hayCandidatosCatalogo: boolean,
): string[] {
  if (eventType !== "open" || !hayCandidatosCatalogo) return [];
  const source = normalizar(solicitudOriginal);
  const piezaUnica = /\b(?:solo|solamente|unicamente|una sola|una pieza|un arco|una columna|un backdrop|un accesorio)\b/.test(source);
  if (piezaUnica) return [];
  if (plan.estructuras.length < 3) {
    return ["Evento abierto requiere 3–5 estructuras coordinadas cuando hay candidatos de catálogo; el plan declara menos."];
  }
  if (plan.estructuras.length > 5) {
    return ["Evento abierto admite 3–5 estructuras coordinadas; el plan declara más de cinco."];
  }
  return [];
}
