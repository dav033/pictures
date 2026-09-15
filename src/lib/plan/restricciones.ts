import type { Brief } from "@/lib/types";
import type { ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import { ALCANCE_POR_CATEGORIA_REFERENCIA } from "@/lib/rag/taxonomy/alcance-referencia";
import type { ACABADOS_CATALOGO_V2 } from "@/lib/rag/taxonomy/v2";
import { CREATIVIDAD_POR_DEFECTO, perfilCreatividad, type NivelCreatividad } from "@/lib/ia/creatividad";
import { tieneEstructurasDeGlobos } from "@/lib/ia/reference-structure";
import { coloresDominantesReferencia } from "./colores-referencia";
import { identificarEstructuraOficial } from "./estructuras-oficiales";
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

/**
 * Finishes a customer can make mandatory. The catalog taxonomy
 * (`ACABADOS_CATALOGO_V2`) owns what a finish is, and the type below keeps this
 * list inside it. Material types are not finishes: "látex" is the
 * `globo_latex` category, so it must never become a finish restriction that no
 * `material.acabado` can satisfy.
 */
const ACABADOS_EXPLICITOS: ReadonlyArray<(typeof ACABADOS_CATALOGO_V2)[number]> = ["reflex", "satin", "metal", "metalizado", "fashion"];

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Same bound as `texto_original` in `RestriccionesUsuarioSchema`. */
export const MAX_TEXTO_ORIGINAL = 240;
const MARCA_RECORTE = "…";

type Coincidencia = { indice: number; largo: number };

/**
 * `texto_original` is evidence of what the customer literally said, not a
 * copy of the whole conversation. The chat joins every user turn into one
 * request (up to the ~16 000-char history window), so the complete text
 * cannot fit the plan contract. Rule:
 * - text of at most MAX_TEXTO_ORIGINAL chars (trimmed) is kept verbatim;
 * - longer text keeps a MAX_TEXTO_ORIGINAL-char window around the fragment
 *   that justified the restriction, with MARCA_RECORTE on every cut side;
 * - without a located fragment (budget inferred from the brief, or a
 *   normalization that changed string length) the window starts at the
 *   beginning of the text.
 * Extraction itself still runs over the complete text.
 */
function evidenciaTextoOriginal(texto: string, coincidencia?: Coincidencia): string {
  const completo = texto.trim();
  if (!completo) return "solicitud del cliente";
  if (completo.length <= MAX_TEXTO_ORIGINAL) return completo;
  const mapa = coincidencia && indiceOriginal(texto, coincidencia);
  const cuerpo = MAX_TEXTO_ORIGINAL - 2 * MARCA_RECORTE.length;
  let inicio = texto.length - texto.trimStart().length;
  if (mapa) {
    const holgura = Math.max(0, cuerpo - (mapa.fin - mapa.inicio));
    inicio = Math.max(0, mapa.inicio - Math.floor(holgura / 2));
  }
  let fin = Math.min(texto.length, inicio + cuerpo);
  inicio = Math.max(0, fin - cuerpo);
  // Never split a surrogate pair at either edge.
  if (inicio > 0 && esSurrogateBajo(texto.charCodeAt(inicio))) inicio += 1;
  if (fin < texto.length && esSurrogateBajo(texto.charCodeAt(fin))) fin -= 1;
  const prefijo = texto.slice(0, inicio).trim() ? MARCA_RECORTE : "";
  const sufijo = texto.slice(fin).trim() ? MARCA_RECORTE : "";
  return `${prefijo}${texto.slice(inicio, fin).trim()}${sufijo}`;
}

function esSurrogateBajo(codigo: number): boolean {
  return codigo >= 0xdc00 && codigo <= 0xdfff;
}

/** Maps a match found in `normalizar(texto)` back to offsets in `texto`. */
function indiceOriginal(texto: string, coincidencia: Coincidencia): { inicio: number; fin: number } | null {
  const origen: number[] = [];
  let normalizado = "";
  let offset = 0;
  for (const caracter of texto) {
    const parte = normalizar(caracter);
    for (let i = 0; i < parte.length; i += 1) origen.push(offset);
    normalizado += parte;
    offset += caracter.length;
  }
  origen.push(texto.length);
  // Per-character normalization can differ from whole-string normalization
  // (context-sensitive lowercasing); offsets are then unreliable.
  if (normalizado !== normalizar(texto)) return null;
  const fin = coincidencia.indice + coincidencia.largo;
  if (coincidencia.indice < 0 || fin > normalizado.length) return null;
  return { inicio: origen[coincidencia.indice]!, fin: fin === normalizado.length ? texto.length : origen[fin]! };
}

function colorCanonico(valor: string): string {
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
}

function numero(raw: string): number | null {
  const limpio = normalizar(raw).replace(/\s/g, "");
  if (NUMEROS[limpio]) return NUMEROS[limpio];
  const parsed = Number(limpio.replace(/\.(?=\d{3}(?:\D|$))/g, ""));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function extraerTecho(texto: string): { valor: number; coincidencia: Coincidencia } | null {
  const normalizado = normalizar(texto);
  const monto = (match: RegExpMatchArray, raw: string, sufijo?: string): { valor: number; coincidencia: Coincidencia } | null => {
    const base = Number(raw.replace(/\./g, ""));
    if (!Number.isFinite(base) || base <= 0) return null;
    return { valor: Math.round(base * (sufijo ? 1000 : 1)), coincidencia: { indice: match.index ?? 0, largo: match[0].length } };
  };
  // "entre X y Z" es tan común como "de X a Z"; sin la `y` el rango no se
  // reconocía y caía al patrón de abajo, que tomaba el piso como techo.
  const rango = normalizado.match(/\$?\s*([\d.]+)\s*(mil|k)?\s*(?:a|hasta|y|-)\s*\$?\s*([\d.]+)\s*(mil|k)?/i);
  if (rango) return monto(rango, rango[3]!, rango[4]);
  // Los conectores entre la palabra clave y el monto son la forma NORMAL de
  // decirlo en español ("mi presupuesto es de 50k"), y sin ellos el techo se
  // perdía en silencio: el plan se diseñaba sin restricción y el sobrecosto
  // recién aparecía al cotizar.
  const conector = "(?:\\s+(?:es|era|seria|sera|anda|ronda|de|en|por|como|mas|menos|o|:|,)){0,3}";
  const match = normalizado.match(new RegExp(`(?:hasta|tope|presupuesto|maximo|limite|no mas de|menos de)${conector}\\s*\\$?\\s*([\\d.]+)\\s*(mil|k)?`, "i"));
  if (match) return monto(match, match[1]!, match[2]);
  // Sin palabra clave, un monto solo cuenta si viene marcado como dinero:
  // "$50.000", "50k pesos", "50 mil cop". Un número suelto es ambiguo
  // (invitados, metros, fecha) y no debe tomarse como techo.
  const conMoneda = normalizado.match(/\$\s*([\d.]+)\s*(mil|k)?|([\d.]+)\s*(mil|k)\s*(?:cop|pesos)/i);
  if (conMoneda) return monto(conMoneda, conMoneda[1] ?? conMoneda[3]!, conMoneda[2] ?? conMoneda[4]);
  return null;
}

function extraerLista(texto: string, aliases: string[], limite = 8): Array<{ valor: string; coincidencia: Coincidencia }> {
  const normalized = normalizar(texto);
  const resultado: Array<{ valor: string; coincidencia: Coincidencia }> = [];
  for (const alias of aliases.slice().sort((a, b) => b.length - a.length)) {
    const valor = normalizar(alias);
    const encontrado = new RegExp(`(?:^|[\\s,;])${valor}(?:$|[\\s,;.!?])`, "i").exec(normalized);
    const prohibido = normalized.includes(`sin ${valor}`) || normalized.includes(`no ${valor}`) || normalized.includes(`sin color ${valor}`);
    if (!encontrado || prohibido) continue;
    const canonico = valor === "rosado" || valor === "rosa" ? "rosa" : valor === "plata" || valor === "plateado" ? "plateado" : valor;
    if (!resultado.some((item) => item.valor === canonico)) {
      resultado.push({ valor: canonico, coincidencia: { indice: encontrado.index, largo: encontrado[0].length } });
    }
    if (resultado.length >= limite) break;
  }
  return resultado;
}

export function extraerRestriccionesUsuario(texto: string, brief: Brief = {}): RestriccionesUsuario {
  const estructuras: RestriccionesUsuario["estructuras"] = [];
  for (const estructura of ESTRUCTURAS) {
    const aliases = estructura.aliases.map(normalizar).sort((a, b) => b.length - a.length).join("|");
    const patron = new RegExp(`(?:\\b(\\d+|${Object.keys(NUMEROS).join("|")})\\s+(?:${aliases})\\b|\\b(?:${aliases})\\s+(\\d+|${Object.keys(NUMEROS).join("|")})\\b)`, "i");
    const match = normalizar(texto).match(patron);
    if (!match) continue;
    const cantidad = numero(match[1] ?? match[2] ?? "1") ?? 1;
    const textoOriginal = evidenciaTextoOriginal(texto, { indice: match.index ?? 0, largo: match[0].length });
    estructuras.push({ tipo: estructura.tipo, repeticiones: Math.min(24, cantidad), procedencia: "explicito", texto_original: textoOriginal, polaridad: "obligatorio" });
  }

  // A numeric brief may have been inferred by Gemini. It is not a customer
  // constraint unless the original message contains the amount as well.
  const presupuestoEnTexto = extraerTecho(texto);
  const presupuesto = presupuestoEnTexto?.valor ?? (typeof brief.presupuesto === "number" ? brief.presupuesto : extraerTecho(String(brief.presupuesto ?? ""))?.valor);
  const presupuestoExplicito = presupuestoEnTexto !== null;
  const colores = extraerLista(texto, [
    "dorado", "dorada", "dorados", "doradas", "plateado", "plateada", "plateados", "plateadas", "plata",
    "rosado", "rosada", "rosados", "rosadas", "rosa", "rojo", "roja", "rojos", "rojas", "negro", "negra", "negros", "negras",
    "blanco", "blanca", "blancos", "blancas", "azul", "azules", "verde", "verdes", "morado", "morada", "morados", "moradas", "lila", "nude",
  ])
    .map(({ valor, coincidencia }) => ({ valor: colorCanonico(valor), coincidencia }))
    .filter((item, index, values) => values.findIndex((otro) => otro.valor === item.valor) === index)
    .map(({ valor, coincidencia }) => ({ valor, procedencia: "explicito" as const, texto_original: evidenciaTextoOriginal(texto, coincidencia), polaridad: "obligatorio" as const }));
  const tamanos = [...normalizar(texto).matchAll(/\br[- ]?(5|9|12|18|24|36|40)\b|\b(5|9|12|18|24|36|40)\s*(?:pulgadas?|in)\b/gi)]
    .flatMap((match) => {
      const valor = match[1] ?? match[2];
      if (!valor) return [];
      const textoOriginal = evidenciaTextoOriginal(texto, { indice: match.index ?? 0, largo: match[0].length });
      return [{ valor: `R-${valor}`, procedencia: "explicito" as const, texto_original: textoOriginal, polaridad: "obligatorio" as const }];
    });
  const acabados = extraerLista(texto, [...ACABADOS_EXPLICITOS])
    .map(({ valor, coincidencia }) => ({ valor, procedencia: "explicito" as const, texto_original: evidenciaTextoOriginal(texto, coincidencia), polaridad: "obligatorio" as const }));
  // Budget inferred from the brief has no fragment in the text; its evidence
  // falls back to the leading excerpt, as documented in evidenciaTextoOriginal.
  const presupuestoTextoOriginal = evidenciaTextoOriginal(texto, presupuestoEnTexto?.coincidencia);

  return {
    ...(presupuesto ? { presupuesto: { techo_cop: Math.round(presupuesto), procedencia: presupuestoExplicito ? "explicito" as const : "inferido" as const, texto_original: presupuestoTextoOriginal } } : {}),
    estructuras,
    colores,
    tamanos,
    acabados,
  };
}

/** Nombre en español de un tipo de estructura, en singular o plural. */
const NOMBRE_ESTRUCTURA: Record<TipoEstructura, readonly [string, string]> = {
  arco: ["arco", "arcos"],
  semiarco: ["semiarco", "semiarcos"],
  guirnalda: ["guirnalda", "guirnaldas"],
  columna: ["columna", "columnas"],
  pared: ["pared de globos", "paredes de globos"],
  centro_mesa: ["centro de mesa", "centros de mesa"],
  backdrop: ["fondo decorativo", "fondos decorativos"],
  kit: ["kit", "kits"],
  accesorio: ["accesorio", "accesorios"],
};

function cantidadEstructura(tipo: TipoEstructura, cantidad: number): string {
  const [singular, plural] = NOMBRE_ESTRUCTURA[tipo];
  return `${cantidad} ${cantidad === 1 ? singular : plural}`;
}

/**
 * Incumplimientos de lo que el cliente pidió explícitamente. Los mensajes
 * están redactados para el cliente (sin códigos ni ids): el modelo los usa
 * para corregir el plan y `mensaje_cliente` los reutiliza tal cual.
 */
export function validarRestriccionesPlan(plan: PlanDecoracion, restricciones: RestriccionesUsuario): string[] {
  const errores: string[] = [];
  for (const requerida of restricciones.estructuras) {
    const total = plan.estructuras.filter((estructura) => estructura.tipo === requerida.tipo)
      .reduce((sum, estructura) => sum + estructura.repeticiones, 0);
    if (total !== requerida.repeticiones) errores.push(`Pediste ${cantidadEstructura(requerida.tipo, requerida.repeticiones)} y la propuesta tiene ${cantidadEstructura(requerida.tipo, total)}.`);
  }
  if (restricciones.colores.filter((color) => color.polaridad === "obligatorio").length) {
    const coloresPlan = new Set(plan.estructuras.flatMap((estructura) => estructura.materiales.map((material) => normalizar(material.color ?? ""))).filter(Boolean));
    for (const color of restricciones.colores.filter((item) => item.polaridad === "obligatorio")) {
      const requerido = normalizar(color.valor).replace("plata", "plateado");
      const cubierto = [...coloresPlan].some((disponible) => disponible === requerido || disponible.includes(requerido) || requerido.includes(disponible));
      if (!cubierto) errores.push(`Pediste el color ${color.valor} y la propuesta todavía no lo incluye.`);
    }
  }
  if (restricciones.acabados.filter((acabado) => acabado.polaridad === "obligatorio").length) {
    const acabadosPlan = new Set(plan.estructuras.flatMap((estructura) => estructura.materiales.map((material) => normalizar(material.acabado ?? ""))).filter(Boolean));
    for (const acabado of restricciones.acabados.filter((item) => item.polaridad === "obligatorio")) {
      const requerido = normalizar(acabado.valor);
      const cubierto = [...acabadosPlan].some((disponible) => disponible === requerido || disponible.includes(requerido) || requerido.includes(disponible));
      if (!cubierto) errores.push(`Pediste el acabado ${acabado.valor} y la propuesta todavía no lo incluye.`);
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
 * Copies into each structure the dominant colors of the reference element it
 * materializes (audit finding Alta #3, rule in colores-referencia.ts). With
 * several photos each structure takes the palette of its own element. Any value
 * the model sent is discarded: the field is server-owned.
 */
export function aplicarColoresReferencia<T extends PlanDecoracion>(plan: T, blueprint: ReferenceBlueprintV2 | undefined): T {
  const elementos = new Map((blueprint?.elements ?? []).filter((element) => element.approved).map((element) => [element.element_id, element]));
  return {
    ...plan,
    estructuras: plan.estructuras.map((estructura) => {
      const elemento = estructura.referencia_element_id ? elementos.get(estructura.referencia_element_id) : undefined;
      const colores = elemento ? coloresDominantesReferencia(elemento.appearance.observed_colors) : [];
      const resto = { ...estructura };
      delete resto.colores_referencia;
      return colores.length ? { ...resto, colores_referencia: colores } : resto;
    }),
  };
}

/**
 * Evento abierto necesita composición mínima para no cotizar un único
 * elemento genérico. El mínimo se cuenta en instancias (un par de columnas
 * con `repeticiones: 2` son dos piezas) y no aplica cuando el cliente pidió
 * una pieza única, fijó la composición ("2 arcos y 3 columnas") o puso un
 * presupuesto explícito: con techo manda lo que cabe (BLOQUE_PLAN, "EL TECHO
 * MANDA"). Antes estas tres situaciones hacían reintentar al modelo en bucle.
 * Productos deben seguir saliendo de whitelist RAG.
 */
export function validarCardinalidadEventoAbierto(
  plan: PlanDecoracion,
  // EventIntentV2 keeps this compatibility field extensible for persisted
  // payloads; parser currently emits only `open`/`wedding`. Keep validator
  // compatible with that schema and reject every non-open value below.
  eventType: string,
  solicitudOriginal: string,
  hayCandidatosCatalogo: boolean,
  referenceBlueprint?: ReferenceBlueprintV2,
  /** Structure range of the creativity level (creatividad.ts); 3–5 by default. */
  rango: { min: number; max: number } = { min: 3, max: 5 },
): string[] {
  if (eventType !== "open" || !hayCandidatosCatalogo) return [];
  return validarRangoEstructuras(plan, solicitudOriginal, referenceBlueprint, rango);
}

/**
 * Shared range rule. The minimum counts instances (a pair of columns with
 * `repeticiones: 2` is two pieces) and the maximum counts structures. A single
 * piece, an explicit composition, an explicit budget or a photo with balloons
 * only keep the maximum.
 */
function validarRangoEstructuras(
  plan: PlanDecoracion,
  solicitudOriginal: string,
  referenceBlueprint: ReferenceBlueprintV2 | undefined,
  rango: { min: number; max: number },
): string[] {
  const palabra = (numero: number) => NUMERO_EN_PALABRAS[numero] ?? String(numero);
  const demasiadas = `Para decorar el evento completo conviene armar entre ${rango.min} y ${rango.max} decoraciones coordinadas, y la propuesta tiene más de ${palabra(rango.max)}.`;
  const source = normalizar(solicitudOriginal);
  const piezaUnica = /\b(?:solo|solamente|unicamente|una sola|una pieza|un arco|una columna|un backdrop|un accesorio)\b/.test(source);
  const composicionExplicita = (plan.restricciones?.estructuras.length ?? 0) > 0;
  const presupuestoExplicito = plan.restricciones?.presupuesto?.procedencia === "explicito";
  // Con una foto de referencia, la composición la fija la foto: pedir 3–5
  // piezas empujaba al modelo a inventar estructuras que la foto no tiene.
  const composicionDeReferencia = referenciaDefineComposicion(referenceBlueprint);
  const instancias = plan.estructuras.reduce((total, estructura) => total + Math.max(1, estructura.repeticiones), 0);
  if (piezaUnica || composicionExplicita || presupuestoExplicito || composicionDeReferencia) {
    return plan.estructuras.length > rango.max && !composicionExplicita ? [demasiadas] : [];
  }
  if (instancias < rango.min) {
    return [`Para decorar el evento completo conviene armar entre ${rango.min} y ${rango.max} decoraciones coordinadas, y la propuesta tiene menos.`];
  }
  if (plan.estructuras.length > rango.max) return [demasiadas];
  return [];
}

/**
 * Structure range of the creativity level on the confirmed plan (creatividad.ts).
 * Regression (2026-09-14): level 4 (4–7 structures) confirmed a wedding with 3,
 * because the range was only checked for open events.
 *
 * Decision: a rejection the model can correct (not a warning), for every event
 * type, whenever the customer picked a level other than the default. Level 2
 * keeps the historical rule (`validarCardinalidadEventoAbierto`, open events
 * only). A reference photo with balloons decides the composition instead, and a
 * single piece, an explicit composition or an explicit budget only keep the
 * maximum. Without catalog candidates there is nothing to design yet.
 */
export function validarRangoCreatividad(
  plan: PlanDecoracion,
  opciones: {
    nivel: NivelCreatividad | undefined;
    solicitudOriginal: string;
    hayCandidatosCatalogo: boolean;
    referenceBlueprint?: ReferenceBlueprintV2;
  },
): string[] {
  const perfil = perfilCreatividad(opciones.nivel);
  if (perfil.nivel === CREATIVIDAD_POR_DEFECTO || !opciones.hayCandidatosCatalogo) return [];
  return validarRangoEstructuras(plan, opciones.solicitudOriginal, opciones.referenceBlueprint, perfil.rangoEstructuras);
}

const NUMERO_EN_PALABRAS: Record<number, string> = { 1: "una", 2: "dos", 3: "tres", 4: "cuatro", 5: "cinco", 6: "seis", 7: "siete", 8: "ocho" };

/**
 * Una referencia fija la composición cuando tiene alguna estructura de globos
 * aprobada. The rule has one owner (`tieneEstructurasDeGlobos` in
 * reference-structure.ts, also read by the UI); this name stays for plan callers.
 */
export function referenciaDefineComposicion(blueprint: ReferenceBlueprintV2 | undefined): boolean {
  return tieneEstructurasDeGlobos(blueprint);
}

/** Pieces a customer can name; "pared" alone is usually the room wall, so only "pared de globos" counts. */
const PIEZAS_NOMBRADAS = /\b(?:arcos?|semiarcos?|columnas?|guirnaldas?|paredes? de globos|centros? de mesa|backdrops?|telon(?:es)?|bouquets?|ramilletes?|figuras?|esculturas?|techos? de globos|aros?|kits?)\b/;

export const MENSAJE_CLIENTE_REFERENCIA_SIN_GLOBOS = "Tu foto no tiene decoración con globos. ¿Qué piezas te gustaría, por ejemplo un arco, columnas o centros de mesa? También puedes elegir una de las fotos de ejemplo para empezar.";

/**
 * Photo without balloon structures (audit finding Media #4). Regression: a
 * flowers-only photo at creativity "Fiel" became a half arch nobody asked for,
 * without saying the photo had no balloons.
 *
 * Decision (user): the assistant asks before building. It applies when a
 * reference photo is present, none of its approved elements is a balloon
 * structure, the customer did not name any piece, and the creativity level
 * allows no extra pieces over the photo (levels 0–2). A venue-only photo
 * (`venue_base`) is where to decorate, not a design, so it does not count. Levels that allow extras
 * may propose their own pieces. The tool refuses with this error so the model
 * asks which pieces or suggests picking an example photo.
 */
export function validarReferenciaSinGlobos(
  blueprint: ReferenceBlueprintV2 | undefined,
  solicitudOriginal: string,
  extrasPermitidas: number,
): string[] {
  if (!blueprint || extrasPermitidas > 0 || tieneEstructurasDeGlobos(blueprint)) return [];
  // A photo of the customer's own venue is where to decorate, not a design to copy.
  if (blueprint.source_images.every((imagen) => imagen.approved_roles.every((rol) => rol === "venue_base"))) return [];
  if (PIEZAS_NOMBRADAS.test(normalizar(solicitudOriginal))) return [];
  return ["La foto de referencia no tiene piezas de globos y todavía no sabemos qué piezas quieres."];
}

const TIPOS_CON_GLOBOS_REFERENCIA = new Set<TipoEstructura>(["arco", "semiarco", "guirnalda", "columna", "pared", "centro_mesa"]);

/**
 * Sin estructuras inventadas con referencia (I3): cuando la foto fija la
 * composición, cada estructura de globos del plan debe materializar un
 * elemento de la foto (`referencia_element_id`), salvo que el cliente haya
 * nombrado ese tipo de pieza en su pedido ("y un centro de mesa").
 * Regresión: con dos piezas separadas en la foto el plan agregó una guirnalda
 * de piso que las unía en forma de U.
 */
export function validarEstructurasFueraDeReferencia(
  plan: PlanDecoracion,
  blueprint: ReferenceBlueprintV2 | undefined,
  solicitudOriginal: string,
  /** Accent pieces the creativity level allows beyond the photo (creatividad.ts). */
  extrasPermitidas = 0,
): string[] {
  if (!referenciaDefineComposicion(blueprint)) return [];
  const texto = normalizar(solicitudOriginal);
  const nombradoPorCliente = (tipo: TipoEstructura) => ESTRUCTURAS
    .find((estructura) => estructura.tipo === tipo)?.aliases
    .some((alias) => new RegExp(`\\b${normalizar(alias)}\\b`).test(texto)) ?? false;
  const inventadas = new Map<TipoEstructura, number>();
  for (const estructura of plan.estructuras) {
    if (!TIPOS_CON_GLOBOS_REFERENCIA.has(estructura.tipo) || estructura.referencia_element_id || nombradoPorCliente(estructura.tipo)) continue;
    inventadas.set(estructura.tipo, (inventadas.get(estructura.tipo) ?? 0) + Math.max(1, estructura.repeticiones));
  }
  const totalInventadas = [...inventadas.values()].reduce((suma, cantidad) => suma + cantidad, 0);
  if (totalInventadas <= Math.max(0, extrasPermitidas)) return [];
  const piezas = [...inventadas].map(([tipo, cantidad]) => NOMBRE_ESTRUCTURA[tipo][cantidad === 1 ? 0 : 1]);
  const lista = piezas.length === 1 ? piezas[0] : `${piezas.slice(0, -1).join(", ")} y ${piezas.at(-1)}`;
  return [`La foto de referencia no tiene ${inventadas.size === 1 && [...inventadas.values()][0] === 1 ? "esta pieza" : "estas piezas"}: ${lista}. ${extrasPermitidas > 0 ? `Con el nivel de creatividad elegido la propuesta puede sumar hasta ${extrasPermitidas === 1 ? "1 pieza" : `${extrasPermitidas} piezas`} extra, y trae más.` : "La propuesta debe llevar solo las piezas de la foto, salvo que pidas algo más."}`];
}

/** Categorías del catálogo (taxonomía v2) que aportan globos a la decoración. */
const CATEGORIAS_CON_GLOBOS = new Set(["globo_latex", "globo_metalizado", "globo_numero_letra", "kit", "guirnalda_arco"]);

const PALABRAS_GLOBOS = /\b(?:globos?|bombas?|arcos?|semiarcos?|guirnaldas?|columnas?|paredes? de globos|bouquets?|ramilletes?)\b/;
const NEGACION_GLOBOS = /\b(?:sin globos|no (?:quiero |queremos |uses |pongas )?globos|nada de globos)\b/;
const SOLO_ACCESORIOS = /\b(?:solo|solamente|unicamente)\s+(?:(?:unas?|unos?|las|los|el|la)\s+)?(?:serpentinas?|velas?|banderolas?|carteles?|letreros?|manteles?|vasos?|platos?|servilletas?|desechables?|pinatas?|cortinas?|accesorios?|confeti|decoracion de mesa)\b/;
const ARTICULOS_SIN_GLOBOS = /\b(?:serpentinas?|velas?|banderolas?|carteles?|letreros?|manteles?|vasos?|platos?|servilletas?|desechables?|pinatas?|cortinas?|confeti)\b/;

/**
 * El cliente no quiere globos cuando lo dice ("sin globos"), cuando pide
 * explícitamente solo accesorios, o cuando nombra artículos que no son globos
 * sin mencionar globos ni estructuras de globos ("banderolas de feliz
 * cumpleaños"). En cualquier otro caso una propuesta de decoración lleva globos.
 */
export function permitePropuestaSinGlobos(solicitudOriginal: string): boolean {
  const texto = normalizar(solicitudOriginal);
  if (NEGACION_GLOBOS.test(texto) || SOLO_ACCESORIOS.test(texto)) return true;
  return ARTICULOS_SIN_GLOBOS.test(texto) && !PALABRAS_GLOBOS.test(texto);
}

/**
 * Regla "propuesta sin globos" (A5, docs/mejoras/PLAN-ESTRUCTURAS-Y-UX.md).
 * Regresión: unos XV años en rosa, dorado y plateado salieron solo con
 * serpentinas plateadas. La categoría sale del catálogo recuperado en el
 * turno, no de lo que declara el modelo. Una categoría desconocida no bloquea:
 * sin evidencia de que no hay globos no se rechaza el plan.
 */
export function validarPresenciaGlobos(
  plan: PlanDecoracion,
  categoriaPorProducto: ReadonlyMap<string, string | null>,
  solicitudOriginal: string,
): string[] {
  if (permitePropuestaSinGlobos(solicitudOriginal)) return [];
  const categorias = plan.estructuras.flatMap((estructura) => estructura.materiales.map((material) => categoriaPorProducto.get(material.product_id) ?? null));
  if (categorias.length === 0 || categorias.some((categoria) => categoria === null || CATEGORIAS_CON_GLOBOS.has(categoria))) return [];
  return ["La propuesta no tiene globos: solo lleva accesorios. Para esta decoración hace falta al menos una pieza de globos en los colores que pediste."];
}

/** Catalog category of balloons sold loose by the package: the only one whose units are balloons. */
const CATEGORIA_GLOBOS_SUELTOS = "globo_latex";

/**
 * Declared units of pieces without geometry (audit finding Alta #1). Regression:
 * two ~2 m figures with 4 materials were declared with `unidades_declaradas: 1`
 * and quoted as one black balloon.
 *
 * Meaning (tool schema in herramientas.ts): catalog sale units for the whole
 * piece, all repetitions included — balloons when the piece is built with loose
 * balloons, pieces for a packaged kit, a backdrop or an accessory.
 * - Every declared material is a purchase, so the units must reach the number
 *   of materials (the resolvers also give each material at least 1).
 * - An official structure with `unidadesMinimasPorInstancia` needs that many
 *   balloons per repetition when all its materials are loose latex balloons.
 *   A packaged kit, a foil or number balloon, or an unknown category counts in
 *   pieces and does not block, like the other catalog-category rules here.
 */
export function validarUnidadesDeclaradas(
  plan: PlanDecoracion,
  categoriaPorProducto: ReadonlyMap<string, string | null>,
): string[] {
  const errores: string[] = [];
  for (const estructura of plan.estructuras) {
    if (estructura.unidades_declaradas === undefined) continue;
    const unidades = estructura.unidades_declaradas;
    const oficial = identificarEstructuraOficial(estructura);
    const nombre = oficial?.nombre ?? NOMBRE_ESTRUCTURA[estructura.tipo][0];
    const materiales = estructura.materiales.length;
    if (unidades < materiales) {
      errores.push(`${primeraMayuscula(nombre)} lleva ${materiales} productos distintos y la propuesta compra ${unidades === 1 ? "una sola unidad" : `solo ${unidades} unidades`}: cada producto necesita al menos una.`);
      continue;
    }
    const minimo = oficial?.unidadesMinimasPorInstancia;
    if (!minimo) continue;
    const soloGlobosSueltos = estructura.materiales.every((material) => categoriaPorProducto.get(material.product_id) === CATEGORIA_GLOBOS_SUELTOS);
    const repeticiones = Math.max(1, estructura.repeticiones);
    const requeridas = minimo * repeticiones;
    if (soloGlobosSueltos && unidades < requeridas) {
      errores.push(`${oficial.nombre} necesita al menos ${minimo} globos por pieza: para ${repeticiones === 1 ? "una pieza" : `${repeticiones} piezas`} son ${requeridas} y la propuesta cuenta ${unidades}.`);
    }
  }
  return [...new Set(errores)];
}

function primeraMayuscula(texto: string): string {
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`;
}

/**
 * Cada estructura oficial es una estructura de globos (estructuras-oficiales.ts).
 * Regresión (2026-09-14): una "Figura con globos" se materializó solo con una
 * banderola metalizada; la tarjeta la llamó figura de globos y el prompt pidió
 * "a balloon sculpture figure metallized foil pennant garland". Como en
 * `validarPresenciaGlobos`, la categoría sale del catálogo del turno y una
 * categoría desconocida no bloquea.
 */
export function validarEstructurasDeGlobosConGlobos(
  plan: PlanDecoracion,
  categoriaPorProducto: ReadonlyMap<string, string | null>,
): string[] {
  const errores: string[] = [];
  for (const estructura of plan.estructuras) {
    const oficial = identificarEstructuraOficial(estructura);
    if (!oficial || estructura.materiales.length === 0) continue;
    const categorias = estructura.materiales.map((material) => categoriaPorProducto.get(material.product_id) ?? null);
    if (categorias.some((categoria) => categoria === null || CATEGORIAS_CON_GLOBOS.has(categoria))) continue;
    errores.push(`${oficial.nombre} necesita globos, pero la propuesta la arma solo con accesorios.`);
  }
  return [...new Set(errores)];
}
