import type { Brief } from "@/lib/types";
import { ALIAS_COLORES_CLIENTE, ALIAS_ESTRUCTURAS_CLIENTE, canonizarColorCliente, extraerRestriccionesUsuario, MAX_TEXTO_ORIGINAL } from "./restricciones";
import type { RestriccionesUsuario, TipoEstructura } from "./tipos";

/**
 * Customer restrictions of a whole conversation (E2E 2026-09-15, D3). The chat
 * joins every customer message into one request, so the silver of the first
 * message ("en azul y plateado") stayed mandatory after "¿puedes cambiar el
 * plateado por blanco?": the plan was refused three times ("Pediste el color
 * plateado…") and the assistant still claimed the change.
 *
 * Rule (deterministic, messages in order, later messages win):
 * - A color or structure is "withdrawn" by a message that says so:
 *   "cambia/cambiar/reemplaza/sustituye X por Y", "en vez de X", "en lugar de X",
 *   "sin X", "quita/saca/elimina/retira X", "no quiero/no uses/no pongas X",
 *   "nada de X". Articles, "color", "globos", "detalles"… may sit between the verb
 *   and X. After a change verb X may be a list ("cambia los azules y plateados
 *   por blancos"); after a negation only "ni" continues it ("sin negro ni
 *   rosado"), because in "dorado, sin negro y rosado" the pink is wanted.
 * - Any other mention of a color or structure in a message (Y above included)
 *   adds it back.
 * - A withdrawn color leaves the mandatory colors; for structures, the count of
 *   the latest message that names the type wins and a withdrawn type leaves the
 *   mandatory structures.
 * Budget, sizes and finishes keep the rule of `extraerRestriccionesUsuario` over
 * the joined text. Pure.
 */

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function alternativas(aliases: readonly string[]): string {
  return [...aliases].map(normalizar).sort((a, b) => b.length - a.length).join("|");
}

const DETERMINANTES = "(?:(?:el|la|los|las|lo|un|una|unos|unas|todo|toda|todos|todas|del|de|al|mi|mis|\\d+)\\s+)*";
const RELLENO = "(?:(?:colou?r(?:es)?|globos?|tonos?|detalles?|partes?|piezas?|elementos?|toques?)\\s+)*";
/** Verbs that replace or remove what follows; a list after them is withdrawn whole ("cambia los azules y plateados por…"). */
const VERBOS_CAMBIO = "(?:cambia\\w*|cambie\\w*|reemplaza\\w*|remplaza\\w*|sustitu\\w*|quita\\w*|quite\\w*|saca\\w*|saque\\w*|elimina\\w*|elimine\\w*|retira\\w*|retire\\w*|en\\s+(?:vez|lugar)\\s+del?)";
/** Negations; only "ni" continues them ("sin negro ni rosado"): in "dorado, sin negro y rosado" the pink is wanted. */
const NEGACIONES = "(?:sin|nada\\s+de|no\\s+(?:quiero|queremos|me\\s+gustan?|uses|usen|pongas|pongan|incluyas|incluyan|lleve|lleven))";

function patronRetiro(aliases: readonly string[]): RegExp {
  const alias = `(?:${alternativas(aliases)})`;
  const siguiente = (conectores: string) => `(?:\\s*(?:${conectores})\\s*${DETERMINANTES}${RELLENO}${alias})*`;
  const cambio = `${VERBOS_CAMBIO}\\s+${DETERMINANTES}${RELLENO}${DETERMINANTES}(${alias}${siguiente(",|\\by\\b|\\be\\b|\\bni\\b")})`;
  const negacion = `${NEGACIONES}\\s+${DETERMINANTES}${RELLENO}${DETERMINANTES}(${alias}${siguiente("\\bni\\b")})`;
  return new RegExp(`\\b(?:${cambio}|${negacion})(?![\\p{L}])`, "gu");
}

const RETIRO_COLOR = patronRetiro(ALIAS_COLORES_CLIENTE);
const ALIAS_ESTRUCTURA_PLANO = ALIAS_ESTRUCTURAS_CLIENTE.flatMap((estructura) => estructura.aliases);
const RETIRO_ESTRUCTURA = patronRetiro(ALIAS_ESTRUCTURA_PLANO);

type Retiro = { valores: string[]; texto: string };

/** Withdrawn words of one message and the message with those words blanked out. */
function separarRetiros(mensaje: string, patron: RegExp, aliases: readonly string[]): Retiro {
  const texto = normalizar(mensaje);
  const valores: string[] = [];
  let blanqueado = texto;
  const alias = new RegExp(`(?<![\\p{L}])(?:${alternativas(aliases)})(?![\\p{L}])`, "gu");
  for (const coincidencia of texto.matchAll(patron)) {
    const lista = coincidencia[1] ?? coincidencia[2] ?? "";
    const inicio = (coincidencia.index ?? 0) + coincidencia[0].length - lista.length;
    for (const palabra of lista.matchAll(alias)) valores.push(palabra[0]);
    blanqueado = `${blanqueado.slice(0, inicio)}${" ".repeat(lista.length)}${blanqueado.slice(inicio + lista.length)}`;
  }
  return { valores, texto: blanqueado };
}

/** Mandatory colors in force after the whole conversation (restriction values, e.g. "rosa", "plateado"). */
export function coloresVigentes(mensajes: readonly string[]): { vigentes: string[]; retirados: string[] } {
  const vigentes: string[] = [];
  const retirados = new Set<string>();
  for (const mensaje of mensajes) {
    const { valores, texto } = separarRetiros(mensaje, RETIRO_COLOR, ALIAS_COLORES_CLIENTE);
    for (const valor of valores.map(canonizarColorCliente)) {
      const indice = vigentes.indexOf(valor);
      if (indice >= 0) vigentes.splice(indice, 1);
      retirados.add(valor);
    }
    for (const color of extraerRestriccionesUsuario(texto).colores) {
      if (!vigentes.includes(color.valor)) vigentes.push(color.valor);
      retirados.delete(color.valor);
    }
  }
  return { vigentes, retirados: [...retirados] };
}

function tipoDeAlias(palabra: string): TipoEstructura | undefined {
  return ALIAS_ESTRUCTURAS_CLIENTE.find((estructura) => estructura.aliases.some((alias) => normalizar(alias) === palabra))?.tipo;
}

function estructurasVigentes(mensajes: readonly string[]): RestriccionesUsuario["estructuras"] {
  const vigentes = new Map<TipoEstructura, RestriccionesUsuario["estructuras"][number]>();
  for (const mensaje of mensajes) {
    const { valores, texto } = separarRetiros(mensaje, RETIRO_ESTRUCTURA, ALIAS_ESTRUCTURA_PLANO);
    for (const palabra of valores) {
      const tipo = tipoDeAlias(palabra);
      if (tipo) vigentes.delete(tipo);
    }
    for (const estructura of extraerRestriccionesUsuario(texto).estructuras) {
      // Evidence is the customer's own message, not the blanked copy.
      vigentes.set(estructura.tipo, { ...estructura, texto_original: extraerRestriccionesUsuario(mensaje).estructuras.find((item) => item.tipo === estructura.tipo)?.texto_original ?? estructura.texto_original });
    }
  }
  return [...vigentes.values()];
}

export function extraerRestriccionesConversacion(mensajes: readonly string[], brief: Brief = {}): RestriccionesUsuario {
  const base = extraerRestriccionesUsuario(mensajes.join(" "), brief);
  const { vigentes } = coloresVigentes(mensajes);
  const colores = [
    ...base.colores.filter((color) => vigentes.includes(color.valor)),
    ...vigentes.filter((valor) => !base.colores.some((color) => color.valor === valor)).map((valor) => ({
      valor,
      procedencia: "explicito" as const,
      // Named again after a "sin X" elsewhere: evidence is the latest message that names it.
      texto_original: evidenciaColor(mensajes, valor),
      polaridad: "obligatorio" as const,
    })),
  ];
  return { ...base, estructuras: estructurasVigentes(mensajes), colores };
}

function evidenciaColor(mensajes: readonly string[], valor: string): string {
  for (let indice = mensajes.length - 1; indice >= 0; indice -= 1) {
    const { texto } = separarRetiros(mensajes[indice]!, RETIRO_COLOR, ALIAS_COLORES_CLIENTE);
    if (extraerRestriccionesUsuario(texto).colores.some((color) => color.valor === valor)) {
      return extraerRestriccionesUsuario(mensajes[indice]!).colores.find((color) => color.valor === valor)?.texto_original
        ?? mensajes[indice]!.trim().slice(0, MAX_TEXTO_ORIGINAL);
    }
  }
  return "solicitud del cliente";
}
