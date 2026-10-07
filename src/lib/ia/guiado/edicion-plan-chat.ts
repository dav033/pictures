import { z } from "zod";
import type { IdeaVisibleGuiada, PlanActualGuiado } from "@/lib/ia/contracts/asistente-guiado-v1";
import { ESTRUCTURAS_OFICIALES, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { coloresConTonosDelCliente } from "@/lib/plan/tonos-color";
import { ALIAS_COLORES_V2, COLORES_PROPUESTA_V2, familiaDeColorPropuesta, plegarTexto, tonoClaroDe, TONOS_CLAROS_V2, TONOS_V2, type ColorPropuestaV2 } from "@/lib/rag/taxonomy/v2";

/**
 * Editar el plan vigente POR CHAT en la vista guiada, sin rehacerlo (probador 104, 2026-10-07): «el azul cámbialo por
 * celeste clarito en las dos columnas, el resto igual» llamaba `proponer_composicion` y /api/chat rehacía el plan desde
 * cero (título, acabados y cantidades nuevos; el ajuste anterior perdido; las dos columnas distintas). Ahora:
 *
 * 1. Las REGLAS de aquí leen el pedido del cliente (`detectarPedidoEdicion`) y deciden qué herramientas tiene el modelo en
 *    ese turno: con un cambio puntual, solo la de edición (no puede rehacer el plan).
 * 2. El modelo llama una herramienta de edición (`herramientasEdicionPlan`); el servidor valida sus argumentos contra el
 *    plan y las reglas (`pedidoDesdeHerramienta`) y devuelve un `PedidoEdicionPlan`.
 * 3. La vista lo convierte en los MISMOS cambios del editor «Ajustar mi plan» (`ajuste/edicion-chat-guiada.ts`) y
 *    `/api/plan-editar` los aplica sobre el plan firmado: Python vuelve a contar y a firmar, y lo demás queda igual.
 *
 * Elegir una idea por chat («me quedo con el primero, el semiarco con centros de mesa») va por el mismo camino:
 * `detectarEleccionIdea` + la herramienta `elegir_idea` → la vista hace lo mismo que «Me gusta esta».
 *
 * Puro (sin servidor, red ni modelo): lo importan la ruta del asistente, la vista y las pruebas.
 */

// --- Contrato del pedido --------------------------------------------------------------------------------------------

const MAX_PIEZAS = 8;
const NombrePiezaSchema = z.string().trim().min(1).max(120);
const ColorDelPlanSchema = z.string().trim().min(1).max(40);
const ColorNuevoSchema = z.enum(COLORES_PROPUESTA_V2);
const DireccionSchema = z.union([z.literal(1), z.literal(-1)]);
const MedidasPedidasSchema = z.object({
  ancho_m: z.number().positive().max(100).optional(),
  alto_m: z.number().positive().max(100).optional(),
  largo_m: z.number().positive().max(100).optional(),
}).strict();

/**
 * Lo que la vista aplica sobre el plan firmado. `piezas` son los nombres de las piezas tal como los tiene el plan
 * («Columna izquierda»); vacío = todas las que llevan ese color (o, en un cambio de tamaño, toda la decoración).
 * `color` es el color del plan (su familia del catálogo: «azul»); `colorNuevo`, el que pidió el cliente («celeste»).
 */
export const PedidoEdicionPlanSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("reemplazar_color"), color: ColorDelPlanSchema, colorNuevo: ColorNuevoSchema, piezas: z.array(NombrePiezaSchema).max(MAX_PIEZAS) }).strict(),
  z.object({ tipo: z.literal("agregar_color"), colores: z.array(ColorNuevoSchema).min(1).max(2), piezas: z.array(NombrePiezaSchema).max(MAX_PIEZAS) }).strict(),
  z.object({ tipo: z.literal("quitar_color"), color: ColorDelPlanSchema, piezas: z.array(NombrePiezaSchema).max(MAX_PIEZAS) }).strict(),
  z.object({ tipo: z.literal("protagonismo"), color: ColorDelPlanSchema, direccion: DireccionSchema, piezas: z.array(NombrePiezaSchema).max(MAX_PIEZAS) }).strict(),
  z.object({ tipo: z.literal("quitar_pieza"), piezas: z.array(NombrePiezaSchema).min(1).max(MAX_PIEZAS - 1) }).strict(),
  z.object({ tipo: z.literal("tamano"), direccion: DireccionSchema, piezas: z.array(NombrePiezaSchema).max(MAX_PIEZAS) }).strict(),
  z.object({ tipo: z.literal("medidas"), medidas: MedidasPedidasSchema, piezas: z.array(NombrePiezaSchema).min(1).max(MAX_PIEZAS) }).strict(),
]);
export type PedidoEdicionPlan = z.infer<typeof PedidoEdicionPlanSchema>;

/** La idea que el cliente eligió por chat: la vista hace lo mismo que «Me gusta esta». */
export const IdeaElegidaSchema = z.object({ id: z.string().regex(/^(?:ej|deco)-[a-z0-9-]+$/), titulo: z.string().min(1).max(160), posicion: z.number().int().min(1).max(12) }).strict();
export type IdeaElegida = z.infer<typeof IdeaElegidaSchema>;

export const HERRAMIENTAS_EDICION = ["cambiar_color_plan", "agregar_color_plan", "quitar_color_plan", "mas_o_menos_color", "quitar_pieza_plan", "cambiar_tamano_plan"] as const;
export type HerramientaEdicion = (typeof HERRAMIENTAS_EDICION)[number];
export const HERRAMIENTA_ELEGIR_IDEA = "elegir_idea";

const HERRAMIENTA_DE_TIPO: Readonly<Record<PedidoEdicionPlan["tipo"], HerramientaEdicion>> = {
  reemplazar_color: "cambiar_color_plan",
  agregar_color: "agregar_color_plan",
  quitar_color: "quitar_color_plan",
  protagonismo: "mas_o_menos_color",
  quitar_pieza: "quitar_pieza_plan",
  tamano: "cambiar_tamano_plan",
  medidas: "cambiar_tamano_plan",
};

export function esHerramientaEdicion(nombre: string): nombre is HerramientaEdicion {
  return (HERRAMIENTAS_EDICION as readonly string[]).includes(nombre);
}

// --- Las piezas y los colores del plan, como los ve el chat ---------------------------------------------------------

type GrupoPieza = "semiarco" | "arco" | "columna" | "guirnalda" | "pared" | "centro de mesa" | "bouquet" | "techo" | "aro" | "figura";

/** Palabra del cliente → grupo de piezas. El semiarco va antes que el arco y se tapa al buscar el arco. */
const GRUPOS: ReadonlyArray<{ grupo: GrupoPieza; patron: RegExp; ids: readonly EstructuraOficialId[] }> = [
  { grupo: "semiarco", patron: /\b(?:semiarcos?|medios? arcos?)\b/g, ids: ["semiarco", "semiarco_asimetrico"] },
  { grupo: "centro de mesa", patron: /\bcentros? de mesa\b/g, ids: ["centro_mesa"] },
  { grupo: "arco", patron: /\barcos?\b/g, ids: ["arco", "arco_asimetrico", "arco_no_denso"] },
  { grupo: "columna", patron: /\b(?:columnas?|torres?)\b/g, ids: ["columna", "columna_asimetrica", "columna_no_densa"] },
  { grupo: "guirnalda", patron: /\bguirnaldas?\b/g, ids: ["guirnalda"] },
  { grupo: "pared", patron: /\b(?:paredes?|muros?|fondos?)\b/g, ids: ["pared_densa", "pared_no_densa", "pared_organica", "racimo_pared"] },
  { grupo: "bouquet", patron: /\b(?:bouquets?|ramos?|ramilletes?)\b/g, ids: ["bouquet"] },
  { grupo: "techo", patron: /\btechos?\b/g, ids: ["techo_globos"] },
  { grupo: "aro", patron: /\baros?\b/g, ids: ["aro_circular"] },
  { grupo: "figura", patron: /\bfiguras?\b/g, ids: ["figura"] },
];

function grupoDe(estructura: EstructuraOficialId): GrupoPieza | null {
  return GRUPOS.find((item) => item.ids.includes(estructura))?.grupo ?? null;
}

export type PiezaChat = {
  /** Como la tiene el plan y la ve el cliente («Columna izquierda»). */
  nombre: string;
  clave: string;
  estructura: EstructuraOficialId;
  grupo: GrupoPieza | null;
  lado: "izquierda" | "derecha" | null;
  /** Familias de color que lleva (las de Python). */
  colores: string[];
};

function plegar(texto: string): string {
  return plegarTexto(texto);
}

/** Las piezas del plan vigente para el chat (nombre, grupo, lado y colores). */
export function piezasDelPlanActual(plan: PlanActualGuiado): PiezaChat[] {
  return plan.piezas.map((pieza) => {
    const nombre = (pieza.nombre?.trim() || ESTRUCTURAS_OFICIALES[pieza.estructura].nombre).slice(0, 120);
    const clave = plegar(nombre);
    const lado = pieza.ubicacion === "lateral_izquierdo" || / izquierd[ao]$/.test(clave) ? "izquierda" : pieza.ubicacion === "lateral_derecho" || / derech[ao]$/.test(clave) ? "derecha" : null;
    const colores = [...new Set((pieza.participacion?.map((parte) => parte.color) ?? plan.colores).map(plegar).filter(Boolean))];
    return { nombre, clave, estructura: pieza.estructura, grupo: grupoDe(pieza.estructura), lado, colores };
  });
}

/** Las familias de color del plan (plegadas: «azul», «dorado rosa»). */
export function coloresDelPlanActual(plan: PlanActualGuiado): string[] {
  return [...new Set([...plan.colores, ...plan.piezas.flatMap((pieza) => pieza.participacion?.map((parte) => parte.color) ?? [])].map(plegar).filter(Boolean))];
}

// --- Colores nombrados, con su lugar en el texto --------------------------------------------------------------------

type MencionColor = { color: ColorPropuestaV2; familia: string; inicio: number; fin: number };

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Los tonos van primero: «celeste» es un tono aunque la familia azul también lo tenga como alias. */
const ENTRADAS_COLOR: ReadonlyArray<{ alias: string; color: ColorPropuestaV2 }> = [
  ...TONOS_CLAROS_V2.flatMap((tono) => TONOS_V2[tono].aliases.map((alias) => ({ alias: plegar(alias), color: tono as ColorPropuestaV2 }))),
  ...ALIAS_COLORES_V2.flatMap((item) => item.aliases.map((alias) => ({ alias: plegar(alias), color: item.value as ColorPropuestaV2 }))),
].filter((entrada) => entrada.alias.length > 0);

function mencionesDeColor(texto: string): MencionColor[] {
  const hallados: Array<MencionColor & { orden: number }> = [];
  ENTRADAS_COLOR.forEach((entrada, orden) => {
    const patron = new RegExp(`(?:^| )(${escapar(entrada.alias)})(?= |$)`, "g");
    for (const coincidencia of texto.matchAll(patron)) {
      const inicio = (coincidencia.index ?? 0) + coincidencia[0].length - entrada.alias.length;
      hallados.push({ color: entrada.color, familia: familiaDeColorPropuesta(entrada.color), inicio, fin: inicio + entrada.alias.length, orden });
    }
  });
  hallados.sort((a, b) => a.inicio - b.inicio || (b.fin - b.inicio) - (a.fin - a.inicio) || a.orden - b.orden);
  const elegidos: MencionColor[] = [];
  for (const hallado of hallados) {
    if (!elegidos.some((otro) => hallado.inicio < otro.fin && otro.inicio < hallado.fin)) elegidos.push({ color: hallado.color, familia: hallado.familia, inicio: hallado.inicio, fin: hallado.fin });
  }
  return elegidos.sort((a, b) => a.inicio - b.inicio);
}

/** «celeste clarito» → «celeste claro»; ñ y tildes fuera; signos como espacios. */
function normalizarPedido(texto: string): string {
  return plegar(texto.replace(/clarit[oa]s?/gi, "claro").replace(/\bpastelit[oa]s?/gi, "pastel"));
}

// --- Piezas nombradas -----------------------------------------------------------------------------------------------

type PiezasNombradas = { nombres: string[]; ambigua: boolean; ajenas: GrupoPieza[]; primera: number; antesDeLaPrimera: string };

const PLURAL_ANTES = /(?:las dos|los dos|ambas|ambos|todas las|todos los|cada|las|los|2)\s*$/;
const LADO_DESPUES = /^\s*(?:de la |del lado |de |)(izquierd[ao]|derech[ao])\b/;

/**
 * Qué piezas nombra un trozo del pedido: por su nombre exacto, por su grupo («las dos columnas» son todas; «la columna»
 * con dos columnas es ambigua) o por su lado. `primera`: dónde empieza la primera mención, en el mismo texto (para
 * saber si se nombra antes una pieza o un color); `ajenas`: grupos que el plan no tiene («agrégale un arco»).
 */
function piezasNombradas(texto: string, piezas: readonly PiezaChat[]): PiezasNombradas {
  const nombres = new Set<string>();
  let ambigua = false;
  const ajenas = new Set<GrupoPieza>();
  let primera = Number.POSITIVE_INFINITY;
  // Con un espacio a cada lado: los índices de aquí son los del texto + 1.
  let tapado = ` ${texto} `;
  const anotar = (indice: number) => { primera = Math.min(primera, Math.max(0, indice - 1)); };
  // 1) Por su nombre exacto («columna izquierda», «semiarco organico»).
  for (const pieza of [...piezas].sort((a, b) => b.clave.length - a.clave.length)) {
    const indice = tapado.indexOf(` ${pieza.clave} `);
    if (indice < 0) continue;
    nombres.add(pieza.nombre);
    anotar(indice + 1);
    tapado = `${tapado.slice(0, indice + 1)}${"_".repeat(pieza.clave.length)}${tapado.slice(indice + 1 + pieza.clave.length)}`;
  }
  // 2) Por su grupo («las dos columnas», «la columna derecha», «el semiarco»).
  for (const { grupo, patron } of GRUPOS) {
    patron.lastIndex = 0;
    for (const coincidencia of [...tapado.matchAll(patron)]) {
      const indice = coincidencia.index ?? 0;
      const palabra = coincidencia[0];
      tapado = `${tapado.slice(0, indice)}${"_".repeat(palabra.length)}${tapado.slice(indice + palabra.length)}`;
      anotar(indice);
      const delGrupo = piezas.filter((pieza) => pieza.grupo === grupo);
      if (!delGrupo.length) { ajenas.add(grupo); continue; }
      const plural = /s$/.test(palabra.split(" ")[0]!) || PLURAL_ANTES.test(tapado.slice(Math.max(0, indice - 14), indice));
      const lado = LADO_DESPUES.exec(tapado.slice(indice + palabra.length))?.[1];
      if (lado) {
        const conLado = delGrupo.filter((pieza) => pieza.lado === (lado.startsWith("izquierd") ? "izquierda" : "derecha"));
        if (conLado.length) { conLado.forEach((pieza) => nombres.add(pieza.nombre)); continue; }
      }
      if (!plural && delGrupo.length > 1) ambigua = true;
      delGrupo.forEach((pieza) => nombres.add(pieza.nombre));
    }
  }
  // 3) Solo el lado («la de la izquierda»): si una sola pieza está a ese lado.
  for (const coincidencia of tapado.matchAll(/\b(?:la|el|los|las) (?:de la |del lado )?(izquierd[ao]|derech[ao])\b/g)) {
    const lado = coincidencia[1]!.startsWith("izquierd") ? "izquierda" : "derecha";
    const conLado = piezas.filter((pieza) => pieza.lado === lado);
    if (conLado.length === 1) { nombres.add(conLado[0]!.nombre); anotar(coincidencia.index ?? 0); }
  }
  return {
    nombres: piezas.filter((pieza) => nombres.has(pieza.nombre)).map((pieza) => pieza.nombre),
    ambigua, ajenas: [...ajenas], primera,
    antesDeLaPrimera: Number.isFinite(primera) ? texto.slice(0, primera) : texto,
  };
}

// --- Qué pide el cliente (reglas) -----------------------------------------------------------------------------------

export type DeteccionEdicion =
  | { estado: "edicion"; herramienta: HerramientaEdicion; pedido: PedidoEdicionPlan; motivo: string }
  | { estado: "incompleta"; herramienta: HerramientaEdicion; motivo: string }
  | { estado: "no_cabe"; motivo: string }
  | { estado: "ninguna" };

/** Pedidos que cambian el plan entero: no caben en una edición puntual y van por `proponer_composicion`. */
const NO_CABE = /\b(?:mas sencill\w*|menos globos|mas globos|mas barat\w*|menos car\w*|economic\w*|otros colores|otro estilo|otra tematica|otro tema|cambia(?:lo|la|r)? todo|todo nuevo|toda nueva|desde cero|otra propuesta|otro plan|otra decoracion|mas elegante|mas llamativ\w*|mas complet\w*)\b/;
const QUITAR = /\b(?:quita\w*|quitar|saca\w*|sacar|elimina\w*|eliminar|borra\w*|borrar|retira\w*|retirar|remueve|remover)\b/;
/** «sin la columna derecha», «ya no quiero el dorado»: solo si lo que se quita va JUSTO después («sin tocar…» no quita nada). */
const QUITAR_DIRECTO = /\b(?:sin|ya no quiero|no quiero)\s+(?:el |la |los |las )?/g;
const CAMBIAR = /\b(?:cambia\w*|cambie\w*|cambiar|cambio|reemplaza\w*|reemplace\w*|reemplazar|sustitu\w*|en vez|en lugar|convierte\w*|convertir)\b/;
const PONER = /\b(?:pon|ponle|ponles|ponlo|ponla|ponlos|ponlas|poner|ponga\w*|agrega\w*|anade\w*|mete\w*)\b/;
const AGREGAR = /\b(?:agrega\w*|agregue\w*|agregar|anade\w*|anadir|anada\w*|suma\w*|sumar|incluy\w*|incluir|mete\w*|meter|ponle|ponles|ponga\w*|tambien|un toque de|algo de|un poco de)\b/;
const GRANDE = /\b(?:mas grandes?|agrand\w*|mas alt[oa]s?|mas larg[oa]s?|mas anch[oa]s?|aument\w*|crezca\w*|crecer)\b/;
const PEQUENA = /\b(?:mas pequen[oa]s?|mas chic[oa]s?|mas chiquit[oa]s?|achic\w*|reduc\w*|mas baj[oa]s?|mas cort[oa]s?|mas angost[oa]s?|menos alt[oa]s?|disminu\w*)\b/;
/** «con globos más grandes» habla del tamaño de los globos, no del de la pieza. */
const GLOBOS_GRANDES = /\bglobos? (?:mas )?(?:grandes?|pequen\w*|chic\w*)\b/;
const MEDIDA = /(\d+(?:[.,]\d+)?)\s*(m|mt|mts|metro|metros|cm|cms|centimetros?)\b/;
/** Lo que va antes de una pieza cuando se pide una MÁS («agrégale una columna», «otro arco»). */
const PIEZA_NUEVA = /\b(?:un|una|otr[ao]s?|dos|tres|cuatro|mas)\s*$/;

/** «2,5 m» → 2.5; «180 cm» → 1.8. Fuera de 0,3–12 m no es una medida de pieza. */
function medidaEnMetros(texto: string): number | null {
  const coincidencia = MEDIDA.exec(texto.toLocaleLowerCase("es"));
  if (!coincidencia) return null;
  const valor = Number.parseFloat(coincidencia[1]!.replace(",", "."));
  const metros = /^c/.test(coincidencia[2]!) ? valor / 100 : valor;
  return Number.isFinite(metros) && metros >= 0.3 && metros <= 12 ? Math.round(metros * 100) / 100 : null;
}

type CampoMedida = "ancho_m" | "alto_m" | "largo_m";

/** La medida que se nombra, o la natural de la pieza: una columna se mide en alto, una guirnalda en largo, un arco en ancho. */
function campoMedida(texto: string, piezas: readonly PiezaChat[]): CampoMedida {
  if (/\b(?:alto|alta|altos|altas|altura)\b/.test(texto)) return "alto_m";
  if (/\b(?:ancho|ancha|anchos|anchas|anchura)\b/.test(texto)) return "ancho_m";
  if (/\b(?:largo|larga|largos|largas)\b/.test(texto)) return "largo_m";
  const grupos = new Set(piezas.map((pieza) => pieza.grupo));
  if ([...grupos].every((grupo) => grupo === "columna")) return "alto_m";
  if ([...grupos].every((grupo) => grupo === "guirnalda" || grupo === "techo")) return "largo_m";
  return "ancho_m";
}

const PREPOSICION_DESTINO = /^(?:\s*(?:el|la|los|las|un|una|uno|color|tono|de|en))*\s*$/;

/** Un color distinto del que se cambia: otra familia, o un tono claro de la misma («azul» → «celeste»). */
function distinto(de: MencionColor, a: MencionColor): boolean {
  return de.familia !== a.familia || (tonoClaroDe(a.color) !== null && a.color !== de.color);
}

/**
 * De qué color a qué color: «el azul cámbialo por celeste», «cámbialo a celeste», «que el azul sea celeste», «en vez
 * del azul, celeste», «quita el azul y pon celeste». El de origen tiene que estar en el plan.
 */
function reemplazoNombrado(texto: string, menciones: readonly MencionColor[], coloresPlan: ReadonlySet<string>): { de: MencionColor; a: MencionColor } | null {
  if (menciones.length < 2) return null;
  const enPlan = (mencion: MencionColor) => coloresPlan.has(mencion.familia);
  // «X por Y», «X a Y», «que X sea Y»: el destino va justo después del conector.
  let conConector = false;
  for (const conector of texto.matchAll(/\b(?:por|a|sea|sean|quede|queden)\b/g)) {
    const fin = (conector.index ?? 0) + conector[0].length;
    const a = menciones.find((mencion) => mencion.inicio >= fin && PREPOSICION_DESTINO.test(texto.slice(fin, mencion.inicio)));
    if (!a) continue;
    conConector = true;
    const de = [...menciones].reverse().find((mencion) => mencion.fin <= (conector.index ?? 0) && enPlan(mencion) && distinto(mencion, a));
    if (de) return { de, a };
  }
  // «en vez del azul, celeste» / «celeste en lugar del azul».
  const enVez = /\b(?:en vez|en lugar)\b/.exec(texto);
  if (enVez) {
    const de = menciones.find((mencion) => mencion.inicio > (enVez.index ?? 0) && enPlan(mencion));
    const a = de ? menciones.find((mencion) => mencion !== de && distinto(de, mencion)) : undefined;
    if (de && a) return { de, a };
  }
  // «quita el azul y pon celeste»: lo que se quita y lo que se pone.
  const quita = QUITAR.exec(texto);
  const pon = quita ? PONER.exec(texto.slice((quita.index ?? 0) + quita[0].length)) : null;
  if (quita && pon) {
    const finQuita = (quita.index ?? 0) + quita[0].length;
    const inicioPon = finQuita + (pon.index ?? 0) + pon[0].length;
    const de = menciones.find((mencion) => mencion.inicio >= finQuita && mencion.inicio < inicioPon && enPlan(mencion));
    const a = menciones.find((mencion) => mencion.inicio >= inicioPon);
    if (de && a && distinto(de, a)) return { de, a };
  }
  // Sin conector: dos colores y uno solo es del plan, ese es el que se cambia.
  if (conConector) return null;
  const delPlan = menciones.filter((mencion) => enPlan(mencion) && tonoClaroDe(mencion.color) === null);
  const otros = menciones.filter((mencion) => !delPlan.includes(mencion));
  if (menciones.length === 2 && delPlan.length === 1 && otros.length === 1 && distinto(delPlan[0]!, otros[0]!)) return { de: delPlan[0]!, a: otros[0]! };
  return null;
}

/** Las piezas que llevan un color (todas si el plan no dice los colores de cada una). */
function conColor(piezas: readonly PiezaChat[], nombres: readonly string[], familia: string): string[] {
  return piezas.filter((pieza) => nombres.includes(pieza.nombre) && (!pieza.colores.length || pieza.colores.includes(familia))).map((pieza) => pieza.nombre);
}

function edicion(pedido: PedidoEdicionPlan, motivo: string): DeteccionEdicion {
  return { estado: "edicion", herramienta: HERRAMIENTA_DE_TIPO[pedido.tipo], pedido, motivo };
}

/** Quitar: lo primero que se nombra después del verbo dice si se quita un color o una pieza. */
function pedidoQuitar(resto: string, piezas: readonly PiezaChat[], coloresPlan: ReadonlySet<string>, directo: boolean): DeteccionEdicion | null {
  const color = mencionesDeColor(resto)[0];
  const enResto = piezasNombradas(resto, piezas);
  // «sin…», «ya no quiero…»: solo si el color o la pieza va justo después.
  if (directo && !(color?.inicio === 0 || enResto.primera === 0)) return null;
  if (color && color.inicio <= enResto.primera) {
    if (!coloresPlan.has(color.familia)) return { estado: "incompleta", herramienta: "quitar_color_plan", motivo: `quiere quitar ${color.color}, que el plan no lleva` };
    return edicion({ tipo: "quitar_color", color: color.familia, piezas: conColor(piezas, enResto.nombres, color.familia) }, "quitar un color");
  }
  if (enResto.ajenas.length && !enResto.nombres.length) return { estado: "incompleta", herramienta: "quitar_pieza_plan", motivo: `nombra una pieza que el plan no tiene (${enResto.ajenas.join(", ")})` };
  if (!enResto.nombres.length) return null;
  if (enResto.ambigua) return { estado: "incompleta", herramienta: "quitar_pieza_plan", motivo: "no dice cuál de las piezas iguales quitar" };
  if (enResto.nombres.length >= piezas.length) return { estado: "incompleta", herramienta: "quitar_pieza_plan", motivo: "quitaría todas las piezas" };
  return edicion({ tipo: "quitar_pieza", piezas: enResto.nombres }, "quitar piezas nombradas");
}

/**
 * Lo que pide el cliente sobre su plan vigente, por reglas: una edición completa (se aplica tal cual), una edición a la
 * que le falta algo (el modelo pregunta o completa con la herramienta), un pedido que no cabe en una edición (rehacer
 * con `proponer_composicion`) o ninguno. Orden: cambiar un color por otro, quitar, más/menos de un color, añadir un
 * color, medida escrita, más grande o más pequeña.
 */
export function detectarPedidoEdicion(texto: string, plan: PlanActualGuiado): DeteccionEdicion {
  const limpio = normalizarPedido(texto);
  if (!limpio) return { estado: "ninguna" };
  if (NO_CABE.test(limpio)) return { estado: "no_cabe", motivo: "pide cambiar el plan entero (más sencillo, más barato, otros colores u otro estilo)" };
  const piezas = piezasDelPlanActual(plan);
  const coloresPlan = new Set(coloresDelPlanActual(plan));
  const menciones = mencionesDeColor(limpio);
  const nombradas = piezasNombradas(limpio, piezas);
  const piezasPedidas = nombradas.nombres;

  // Cambiar un color por otro (también «quita el azul y pon celeste»).
  const conCambio = CAMBIAR.test(limpio) || /\b(?:por|en vez|en lugar|sea|sean)\b/.test(limpio) || (QUITAR.test(limpio) && PONER.test(limpio));
  const reemplazo = conCambio ? reemplazoNombrado(limpio, menciones, coloresPlan) : null;
  if (reemplazo) {
    const piezasDelColor = piezasPedidas.length ? conColor(piezas, piezasPedidas, reemplazo.de.familia) : [];
    if (piezasPedidas.length && !piezasDelColor.length) return { estado: "incompleta", herramienta: "cambiar_color_plan", motivo: `las piezas nombradas no llevan ${reemplazo.de.familia}` };
    if (nombradas.ambigua) return { estado: "incompleta", herramienta: "cambiar_color_plan", motivo: "no dice en cuál de las piezas iguales" };
    return edicion({ tipo: "reemplazar_color", color: reemplazo.de.familia, colorNuevo: reemplazo.a.color, piezas: piezasDelColor }, "cambiar un color por otro, con colores y piezas nombrados");
  }

  const quitar = QUITAR.exec(limpio);
  if (quitar) {
    const resultado = pedidoQuitar(limpio.slice((quitar.index ?? 0) + quitar[0].length).trim(), piezas, coloresPlan, false);
    if (resultado) return resultado;
  }
  for (const directo of limpio.matchAll(QUITAR_DIRECTO)) {
    const resultado = pedidoQuitar(limpio.slice((directo.index ?? 0) + directo[0].length), piezas, coloresPlan, true);
    if (resultado) return resultado;
  }

  if (CAMBIAR.test(limpio) && menciones.length) {
    const delPlan = menciones.filter((mencion) => coloresPlan.has(mencion.familia));
    if (!delPlan.length) {
      // «cámbialo a rosado» con un plan de un solo color: ese color. Con varios, «cambiemos a rosado y dorado» es otra paleta.
      if (coloresPlan.size === 1 && menciones.length === 1) {
        const [unico] = [...coloresPlan] as [string];
        return edicion({ tipo: "reemplazar_color", color: unico, colorNuevo: menciones[0]!.color, piezas: [] }, "el plan lleva un solo color: ese es el que se cambia");
      }
      return { estado: "no_cabe", motivo: "pide otros colores sin decir cuál cambia: es una paleta nueva" };
    }
    return { estado: "incompleta", herramienta: "cambiar_color_plan", motivo: "pide cambiar un color sin decir cuál por cuál" };
  }

  // Más o menos de un color.
  for (const coincidencia of limpio.matchAll(/\b(mas|menos) (?:de )?(?:color )?/g)) {
    const fin = (coincidencia.index ?? 0) + coincidencia[0].length;
    const color = menciones.find((mencion) => mencion.inicio === fin);
    if (!color) continue;
    if (!coloresPlan.has(color.familia)) return { estado: "incompleta", herramienta: "agregar_color_plan", motivo: `pide más ${color.color}, que el plan no lleva` };
    if (nombradas.ambigua) return { estado: "incompleta", herramienta: "mas_o_menos_color", motivo: "no dice en cuál de las piezas iguales" };
    return edicion({ tipo: "protagonismo", color: color.familia, direccion: coincidencia[1] === "mas" ? 1 : -1, piezas: conColor(piezas, piezasPedidas, color.familia) }, "más o menos de un color del plan");
  }

  // Añadir un color (añadir una pieza no cabe en una edición).
  const agregar = AGREGAR.exec(limpio);
  if (agregar) {
    const resto = limpio.slice((agregar.index ?? 0) + agregar[0].length).trim();
    const enResto = piezasNombradas(resto, piezas);
    const nuevos = mencionesDeColor(resto).filter((mencion) => !coloresPlan.has(mencion.familia) || tonoClaroDe(mencion.color) !== null);
    const piezaPrimero = enResto.primera < (nuevos[0]?.inicio ?? Number.POSITIVE_INFINITY);
    if (piezaPrimero && (enResto.ajenas.length || PIEZA_NUEVA.test(enResto.antesDeLaPrimera))) return { estado: "no_cabe", motivo: "pide agregar una pieza" };
    if (nuevos.length) {
      if (enResto.ambigua) return { estado: "incompleta", herramienta: "agregar_color_plan", motivo: "no dice en cuál de las piezas iguales" };
      return edicion({ tipo: "agregar_color", colores: [...new Set(nuevos.map((mencion) => mencion.color))].slice(0, 2), piezas: enResto.nombres }, "añadir un color que el plan no lleva");
    }
  }

  // Una medida escrita («que las columnas midan 2,5 m»).
  const metros = medidaEnMetros(texto);
  if (metros !== null) {
    const destino = piezasPedidas.length ? piezas.filter((pieza) => piezasPedidas.includes(pieza.nombre)) : piezas.length === 1 ? piezas : [];
    if (!destino.length) return { estado: "incompleta", herramienta: "cambiar_tamano_plan", motivo: "da una medida sin decir de qué pieza" };
    return edicion({ tipo: "medidas", medidas: { [campoMedida(limpio, destino)]: metros }, piezas: destino.map((pieza) => pieza.nombre) }, "una medida escrita para piezas nombradas");
  }

  // Más grande o más pequeña (sin piezas nombradas: toda la decoración).
  const grande = GRANDE.test(limpio);
  const pequena = PEQUENA.test(limpio);
  if (grande !== pequena && !GLOBOS_GRANDES.test(limpio)) {
    return edicion({ tipo: "tamano", direccion: grande ? 1 : -1, piezas: piezasPedidas }, piezasPedidas.length ? "cambiar el tamaño de piezas nombradas" : "cambiar el tamaño de toda la decoración");
  }
  return { estado: "ninguna" };
}

// --- Herramientas del modelo -----------------------------------------------------------------------------------------

export type DefinicionHerramienta = { nombre: string; descripcion: string; esquema: Record<string, unknown> };

/** Las herramientas de edición con los nombres de las piezas y los colores de ESTE plan como únicos valores posibles. */
export function herramientasEdicionPlan(plan: PlanActualGuiado): DefinicionHerramienta[] {
  const nombres = [...new Set(piezasDelPlanActual(plan).map((pieza) => pieza.nombre))];
  const colores = coloresDelPlanActual(plan);
  const piezas = { type: "array", description: "Piezas del plan, con su nombre exacto. Vacío: todas las que llevan ese color.", items: { type: "string", enum: nombres }, maxItems: MAX_PIEZAS };
  const colorPlan = { type: "string", enum: colores };
  const colorNuevo = { type: "string", enum: [...COLORES_PROPUESTA_V2], description: "Usa el tono que dijo el cliente si es uno de los claros (celeste, rosa pastel, durazno), no su familia." };
  return [
    { nombre: "cambiar_color_plan", descripcion: "Cambia un color del plan vigente por otro globo del catálogo, en todas las piezas que lo llevan o solo en las que nombre el cliente. Medidas, demás colores, piezas y título quedan igual.", esquema: { type: "object", properties: { color_actual: colorPlan, color_nuevo: colorNuevo, piezas }, required: ["color_actual", "color_nuevo"], additionalProperties: false } },
    { nombre: "agregar_color_plan", descripcion: "Añade un color nuevo al plan vigente (en todas las piezas que lo admiten o solo en las nombradas). Lo demás queda igual.", esquema: { type: "object", properties: { color: colorNuevo, piezas }, required: ["color"], additionalProperties: false } },
    { nombre: "quitar_color_plan", descripcion: "Quita un color del plan vigente (de todas las piezas o de las nombradas); los otros colores toman su lugar y las medidas quedan igual.", esquema: { type: "object", properties: { color: colorPlan, piezas }, required: ["color"], additionalProperties: false } },
    { nombre: "mas_o_menos_color", descripcion: "Pone más o menos de un color que el plan ya lleva («más rosado», «menos dorado»), en todas las piezas o en las nombradas.", esquema: { type: "object", properties: { color: colorPlan, direccion: { type: "string", enum: ["mas", "menos"] }, piezas }, required: ["color", "direccion"], additionalProperties: false } },
    { nombre: "quitar_pieza_plan", descripcion: "Quita una o varias piezas concretas del plan vigente; las demás quedan exactamente igual.", esquema: { type: "object", properties: { piezas: { ...piezas, description: "Las piezas que se quitan, con su nombre exacto.", minItems: 1 } }, required: ["piezas"], additionalProperties: false } },
    { nombre: "cambiar_tamano_plan", descripcion: "Agranda o achica piezas del plan vigente (un 10 %), o les pone una medida en metros. Sin piezas: toda la decoración.", esquema: { type: "object", properties: { cambio: { type: "string", enum: ["agrandar", "achicar", "medida"] }, piezas: { ...piezas, description: "Piezas que cambian, con su nombre exacto. Vacío: todas." }, alto_m: { type: "number", minimum: 0.3, maximum: 12 }, ancho_m: { type: "number", minimum: 0.3, maximum: 12 }, largo_m: { type: "number", minimum: 0.3, maximum: 12 } }, required: ["cambio"], additionalProperties: false } },
  ];
}

const ArgsPiezas = z.array(z.string().trim().min(1).max(120)).max(MAX_PIEZAS).nullish();
const ArgsSchemas = {
  cambiar_color_plan: z.object({ color_actual: z.string().trim().min(1).max(40), color_nuevo: z.string().trim().min(1).max(40), piezas: ArgsPiezas }).strict(),
  agregar_color_plan: z.object({ color: z.string().trim().min(1).max(40), piezas: ArgsPiezas }).strict(),
  quitar_color_plan: z.object({ color: z.string().trim().min(1).max(40), piezas: ArgsPiezas }).strict(),
  mas_o_menos_color: z.object({ color: z.string().trim().min(1).max(40), direccion: z.enum(["mas", "menos"]), piezas: ArgsPiezas }).strict(),
  quitar_pieza_plan: z.object({ piezas: z.array(z.string().trim().min(1).max(120)).min(1).max(MAX_PIEZAS) }).strict(),
  cambiar_tamano_plan: z.object({ cambio: z.enum(["agrandar", "achicar", "medida"]), piezas: ArgsPiezas, alto_m: z.number().nullish(), ancho_m: z.number().nullish(), largo_m: z.number().nullish() }).strict(),
} as const;

export type ResultadoHerramientaEdicion =
  | { ok: true; pedido: PedidoEdicionPlan; origen: "reglas" | "modelo"; correcciones: string[] }
  | { ok: false; motivo: string; accion_requerida: string };

function falla(motivo: string, accion: string): ResultadoHerramientaEdicion {
  return { ok: false, motivo, accion_requerida: accion };
}

/** El nombre de pieza del modelo → el del plan (sin tildes ni mayúsculas; «izquierda» sola vale si es única). */
function nombreDelPlan(nombre: string, piezas: readonly PiezaChat[]): string | null {
  const clave = plegar(nombre);
  const exacta = piezas.find((pieza) => pieza.clave === clave);
  if (exacta) return exacta.nombre;
  const contenida = piezas.filter((pieza) => pieza.clave.includes(clave) || clave.includes(pieza.clave));
  return contenida.length === 1 ? contenida[0]!.nombre : null;
}

/** Color del plan que nombra el modelo («Azul», «celeste» cuando el plan dice azul) → su familia, si el plan la lleva. */
function colorDelPlan(color: string, coloresPlan: ReadonlySet<string>): string | null {
  const plegado = plegar(color);
  if (coloresPlan.has(plegado)) return plegado;
  const familia = plegar(familiaDeColorPropuesta(plegado));
  if (coloresPlan.has(familia)) return familia;
  const nombrado = mencionesDeColor(plegado)[0];
  return nombrado && coloresPlan.has(nombrado.familia) ? nombrado.familia : null;
}

function colorPermitido(color: string): ColorPropuestaV2 | null {
  const plegado = plegar(color);
  const exacto = COLORES_PROPUESTA_V2.find((valor) => valor === plegado);
  if (exacto) return exacto;
  return mencionesDeColor(plegado)[0]?.color ?? null;
}

/**
 * Los argumentos que mandó el modelo → el pedido que aplica la vista. Si las reglas ya leyeron una edición completa de
 * la MISMA herramienta, mandan las reglas (son las palabras del cliente; el modelo puede equivocar la pieza o el tono).
 * Si no, se valida lo del modelo contra el plan: piezas y colores que existen, el tono que dijo el cliente y que no se
 * quede sin piezas. Un error vuelve al modelo como `ok: false` con qué hacer.
 */
export function pedidoDesdeHerramienta(nombre: HerramientaEdicion, args: unknown, contexto: { plan: PlanActualGuiado; ultimoUsuario: string; deteccion: DeteccionEdicion }): ResultadoHerramientaEdicion {
  const { plan, ultimoUsuario, deteccion } = contexto;
  if (deteccion.estado === "edicion" && deteccion.herramienta === nombre) return { ok: true, pedido: deteccion.pedido, origen: "reglas", correcciones: [] };
  const piezas = piezasDelPlanActual(plan);
  const coloresPlan = new Set(coloresDelPlanActual(plan));
  const listaPiezas = piezas.map((pieza) => `«${pieza.nombre}»`).join(", ");
  const correcciones: string[] = [];
  const resolverPiezas = (pedidas: readonly string[] | null | undefined): string[] | null => {
    const nombres: string[] = [];
    for (const pedida of pedidas ?? []) {
      const delPlan = nombreDelPlan(pedida, piezas);
      if (!delPlan) return null;
      if (!nombres.includes(delPlan)) nombres.push(delPlan);
    }
    return nombres;
  };
  const tonoDelCliente = (color: ColorPropuestaV2): ColorPropuestaV2 => {
    const conTono = coloresConTonosDelCliente([color], [ultimoUsuario])[0] ?? color;
    if (conTono !== color) correcciones.push(`${color} → ${conTono} (lo que dijo el cliente)`);
    return conTono as ColorPropuestaV2;
  };
  switch (nombre) {
    case "cambiar_color_plan": {
      const entrada = ArgsSchemas.cambiar_color_plan.parse(args);
      const color = colorDelPlan(entrada.color_actual, coloresPlan);
      if (!color) return falla("color_no_esta_en_el_plan", `El plan lleva ${[...coloresPlan].join(", ")}: pregunta cuál quiere cambiar.`);
      const permitido = colorPermitido(entrada.color_nuevo);
      if (!permitido) return falla("color_nuevo_no_disponible", "Ese color no está en la paleta: ofrece uno parecido de la paleta.");
      const colorNuevo = tonoDelCliente(permitido);
      if (plegar(familiaDeColorPropuesta(colorNuevo)) === color && !tonoClaroDe(colorNuevo)) return falla("mismo_color", "Es el mismo color que ya lleva: pregunta por cuál lo quiere cambiar.");
      const nombres = resolverPiezas(entrada.piezas);
      if (!nombres) return falla("pieza_desconocida", `Las piezas del plan son ${listaPiezas}: usa esos nombres.`);
      const delColor = nombres.length ? conColor(piezas, nombres, color) : [];
      if (nombres.length && !delColor.length) return falla("piezas_sin_ese_color", `Esas piezas no llevan ${color}.`);
      return { ok: true, pedido: { tipo: "reemplazar_color", color, colorNuevo, piezas: delColor }, origen: "modelo", correcciones };
    }
    case "agregar_color_plan": {
      const entrada = ArgsSchemas.agregar_color_plan.parse(args);
      const permitido = colorPermitido(entrada.color);
      if (!permitido) return falla("color_no_disponible", "Ese color no está en la paleta: ofrece uno parecido de la paleta.");
      const color = tonoDelCliente(permitido);
      if (coloresPlan.has(plegar(color)) && !tonoClaroDe(color)) return falla("ya_lo_lleva", "El plan ya lleva ese color: ofrece poner más con mas_o_menos_color o cambiar otro color por él.");
      const nombres = resolverPiezas(entrada.piezas);
      if (!nombres) return falla("pieza_desconocida", `Las piezas del plan son ${listaPiezas}: usa esos nombres.`);
      return { ok: true, pedido: { tipo: "agregar_color", colores: [color], piezas: nombres }, origen: "modelo", correcciones };
    }
    case "quitar_color_plan": {
      const entrada = ArgsSchemas.quitar_color_plan.parse(args);
      const color = colorDelPlan(entrada.color, coloresPlan);
      if (!color) return falla("color_no_esta_en_el_plan", `El plan lleva ${[...coloresPlan].join(", ")}.`);
      const nombres = resolverPiezas(entrada.piezas);
      if (!nombres) return falla("pieza_desconocida", `Las piezas del plan son ${listaPiezas}: usa esos nombres.`);
      return { ok: true, pedido: { tipo: "quitar_color", color, piezas: nombres.length ? conColor(piezas, nombres, color) : [] }, origen: "modelo", correcciones };
    }
    case "mas_o_menos_color": {
      const entrada = ArgsSchemas.mas_o_menos_color.parse(args);
      const color = colorDelPlan(entrada.color, coloresPlan);
      if (!color) return falla("color_no_esta_en_el_plan", `El plan lleva ${[...coloresPlan].join(", ")}; para un color nuevo usa agregar_color_plan.`);
      const nombres = resolverPiezas(entrada.piezas);
      if (!nombres) return falla("pieza_desconocida", `Las piezas del plan son ${listaPiezas}: usa esos nombres.`);
      return { ok: true, pedido: { tipo: "protagonismo", color, direccion: entrada.direccion === "mas" ? 1 : -1, piezas: nombres.length ? conColor(piezas, nombres, color) : [] }, origen: "modelo", correcciones };
    }
    case "quitar_pieza_plan": {
      const entrada = ArgsSchemas.quitar_pieza_plan.parse(args);
      const nombres = resolverPiezas(entrada.piezas);
      if (!nombres?.length) return falla("pieza_desconocida", `Las piezas del plan son ${listaPiezas}: pregunta cuál quiere quitar.`);
      if (nombres.length >= piezas.length) return falla("quitaria_todo", "El plan necesita al menos una pieza: pregunta qué quiere conservar.");
      return { ok: true, pedido: { tipo: "quitar_pieza", piezas: nombres }, origen: "modelo", correcciones };
    }
    case "cambiar_tamano_plan": {
      const entrada = ArgsSchemas.cambiar_tamano_plan.parse(args);
      const nombres = resolverPiezas(entrada.piezas);
      if (!nombres) return falla("pieza_desconocida", `Las piezas del plan son ${listaPiezas}: usa esos nombres.`);
      if (entrada.cambio !== "medida") return { ok: true, pedido: { tipo: "tamano", direccion: entrada.cambio === "agrandar" ? 1 : -1, piezas: nombres }, origen: "modelo", correcciones };
      const medidas = Object.fromEntries((["alto_m", "ancho_m", "largo_m"] as const).flatMap((campo) => {
        const valor = entrada[campo];
        return typeof valor === "number" && valor >= 0.3 && valor <= 12 ? [[campo, Math.round(valor * 100) / 100]] : [];
      }));
      if (!Object.keys(medidas).length) return falla("sin_medida", "Pregunta la medida en metros (entre 0,3 y 12).");
      const destino = nombres.length ? nombres : piezas.length === 1 ? [piezas[0]!.nombre] : [];
      if (!destino.length) return falla("sin_pieza", `Pregunta a qué pieza le pone esa medida: ${listaPiezas}.`);
      return { ok: true, pedido: { tipo: "medidas", medidas, piezas: destino }, origen: "modelo", correcciones };
    }
  }
}

// --- Lo que se dice del pedido ---------------------------------------------------------------------------------------

function nombreColor(color: string): string {
  const tono = tonoClaroDe(color);
  return tono ? TONOS_V2[tono].nombre.toLocaleLowerCase("es") : color;
}

function lista(elementos: readonly string[]): string {
  if (elementos.length <= 1) return elementos[0] ?? "";
  return `${elementos.slice(0, -1).join(", ")} y ${elementos.at(-1)}`;
}

function enPiezas(piezas: readonly string[]): string {
  return piezas.length ? ` en ${lista(piezas.map((pieza) => pieza.toLocaleLowerCase("es")))}` : "";
}

/** «Cambio el azul por celeste en columna izquierda y columna derecha; lo demás queda igual.» (respaldo de la respuesta). */
export function fraseDelPedido(pedido: PedidoEdicionPlan): string {
  switch (pedido.tipo) {
    case "reemplazar_color": return `Cambio el ${nombreColor(pedido.color)} por ${nombreColor(pedido.colorNuevo)}${enPiezas(pedido.piezas)}; lo demás queda igual.`;
    case "agregar_color": return `Añado ${lista(pedido.colores.map(nombreColor))}${enPiezas(pedido.piezas)}; medidas y demás colores quedan igual.`;
    case "quitar_color": return `Quito el ${nombreColor(pedido.color)}${enPiezas(pedido.piezas)}; lo demás queda igual.`;
    case "protagonismo": return `Pongo ${pedido.direccion > 0 ? "más" : "menos"} ${nombreColor(pedido.color)}${enPiezas(pedido.piezas)}; lo demás queda igual.`;
    case "quitar_pieza": return `Quito ${lista(pedido.piezas.map((pieza) => pieza.toLocaleLowerCase("es")))}; lo demás queda igual.`;
    case "tamano": return `${pedido.direccion > 0 ? "Agrando" : "Achico"} ${pedido.piezas.length ? lista(pedido.piezas.map((pieza) => pieza.toLocaleLowerCase("es"))) : "tu decoración"} un poco; lo demás queda igual.`;
    case "medidas": return `Ajusto ${lista(pedido.piezas.map((pieza) => pieza.toLocaleLowerCase("es")))} a ${Object.values(pedido.medidas).map((valor) => `${String(valor).replace(".", ",")} m`).join(" × ")}; lo demás queda igual.`;
  }
}

/** Las piezas y colores del plan para el estado del modelo: así nombra las piezas igual que el plan. */
export function textoPiezasParaModelo(plan: PlanActualGuiado): string {
  return piezasDelPlanActual(plan).map((pieza) => `«${pieza.nombre}»${pieza.colores.length ? ` (${pieza.colores.join(", ")})` : ""}`).join("; ");
}

// --- Elegir una idea por chat ----------------------------------------------------------------------------------------

/** Elegir de verdad («me quedo con», «elijo», «me gusta»): con ellos basta nombrar el título. */
const ELECCION_FUERTE = /\b(?:me quedo|quedo con|me quedare|nos quedamos|elijo|escojo|escogo|elegimos|escogemos|prefiero|preferimos|me gusta|me gusto|me gustan|me encanta|me encanto|vamos con|voy con)\b/;
/** «Quiero la primera», «dame la segunda»: con ellos hace falta la posición. */
const ELECCION_DEBIL = /\b(?:quiero|queremos|dame|mejor)\b/;
const NEGACION = /\b(?:no me gusta\w*|no me gusto|no quiero|ninguna|ninguno|no me convence\w*)\b/;
/** Pedir más ideas o editar el plan no es elegir una idea («muéstrame otras como la primera», «quita la primera columna»). */
const NO_ES_ELECCION = /\b(?:quita\w*|saca\w*|elimina\w*|cambia\w*|agrega\w*|anade\w*|agrand\w*|achic\w*|otras|otros|muestra\w*|ensena\w*|parecid\w*|ver)\b/;
const ARTICULO = "(?:el|la|lo|los|las|con|por)\\s+";
const ORDINALES: ReadonlyArray<readonly [RegExp, number]> = [
  [new RegExp(`\\b${ARTICULO}(?:primer[oa]?|1ra|1ro|1a|1o)\\b(?! vez)`), 1],
  [new RegExp(`\\b${ARTICULO}(?:segund[oa]|2da|2do)\\b(?! vez)`), 2],
  [new RegExp(`\\b${ARTICULO}(?:tercer[oa]?|3ra|3ro)\\b(?! vez)`), 3],
  [new RegExp(`\\b${ARTICULO}(?:cuart[oa]|4ta|4to)\\b`), 4],
  [new RegExp(`\\b${ARTICULO}(?:quint[oa]|5ta|5to)\\b`), 5],
  [new RegExp(`\\b${ARTICULO}(?:sext[oa]|6ta|6to)\\b`), 6],
];
const NUMERO_IDEA = /\b(?:idea|opcion|numero|la|el)\s+(?:#\s*)?(\d|uno|dos|tres|cuatro|cinco|seis)\b(?! (?:columnas?|arcos?|piezas?|globos?))/;
const PALABRA_NUMERO: Readonly<Record<string, number>> = { uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };
const PALABRAS_VACIAS = new Set(["de", "del", "con", "y", "para", "en", "el", "la", "los", "las", "un", "una", "globos", "globo", "decoracion", "idea", "estilo", "tu", "mi", "sus"]);

function posicionNombrada(texto: string, total: number): number | null {
  if (new RegExp(`\\b${ARTICULO}ultim[oa]\\b`).test(texto)) return total;
  if (new RegExp(`\\b${ARTICULO}penultim[oa]\\b`).test(texto)) return total > 1 ? total - 1 : null;
  for (const [patron, posicion] of ORDINALES) if (patron.test(texto)) return posicion <= total ? posicion : null;
  const numero = NUMERO_IDEA.exec(texto)?.[1];
  if (!numero) return null;
  const posicion = PALABRA_NUMERO[numero] ?? Number.parseInt(numero, 10);
  return Number.isInteger(posicion) && posicion >= 1 && posicion <= total ? posicion : null;
}

/** La idea cuyo título nombra el cliente: la que más palabras de su título repite (al menos dos, o todas si tiene una). */
function ideaPorTitulo(texto: string, ideas: readonly IdeaVisibleGuiada[]): number | null {
  const palabras = new Set(texto.split(" "));
  const tiene = (palabra: string) => palabras.has(palabra) || palabras.has(`${palabra}s`) || (palabra.endsWith("s") && palabras.has(palabra.slice(0, -1)));
  const puntajes = ideas.map((idea) => {
    const propias = [...new Set(plegar(idea.titulo).split(" ").filter((palabra) => palabra.length >= 3 && !PALABRAS_VACIAS.has(palabra)))];
    const dichas = propias.filter(tiene).length;
    return { dichas, completa: propias.length > 0 && dichas === propias.length };
  });
  const mejor = Math.max(0, ...puntajes.map((puntaje) => puntaje.dichas));
  if (mejor === 0) return null;
  const empatadas = puntajes.flatMap((puntaje, indice) => (puntaje.dichas === mejor ? [indice] : []));
  if (empatadas.length !== 1) return null;
  const indice = empatadas[0]!;
  return mejor >= 2 || puntajes[indice]!.completa ? indice + 1 : null;
}

export type DeteccionIdea = { idea: IdeaVisibleGuiada; posicion: number; por: "posicion" | "titulo" | "ambas"; motivo: string };

/**
 * «Me quedo con el primero, el semiarco con centros de mesa»: la idea que elige el cliente entre las que tiene a la
 * vista, por su posición o por su título. Si dice las dos y no coinciden, manda el título (es más preciso). Null si no
 * elige ninguna o si en realidad pide editar el plan.
 */
export function detectarEleccionIdea(texto: string, ideas: readonly IdeaVisibleGuiada[]): DeteccionIdea | null {
  const limpio = plegar(texto);
  const fuerte = ELECCION_FUERTE.test(limpio);
  if (!ideas.length || !limpio || !(fuerte || ELECCION_DEBIL.test(limpio)) || NEGACION.test(limpio) || NO_ES_ELECCION.test(limpio)) return null;
  const porPosicion = posicionNombrada(limpio, ideas.length);
  // El título solo con un verbo de elegir: «quiero algo rosado con columnas» describe, no elige.
  const porTitulo = fuerte ? ideaPorTitulo(limpio, ideas) : null;
  const posicion = porTitulo ?? porPosicion;
  if (!posicion) return null;
  const por = porTitulo && porPosicion ? "ambas" : porTitulo ? "titulo" : "posicion";
  const motivo = porTitulo && porPosicion && porTitulo !== porPosicion ? `nombró la posición ${porPosicion} y el título de la ${porTitulo}: manda el título` : `eligió por ${por === "ambas" ? "posición y título" : por}`;
  return { idea: ideas[posicion - 1]!, posicion, por, motivo };
}

export function herramientaElegirIdea(ideas: readonly IdeaVisibleGuiada[]): DefinicionHerramienta {
  return {
    nombre: HERRAMIENTA_ELEGIR_IDEA,
    descripcion: "Elige una de las ideas del catálogo que el cliente tiene a la vista, cuando la nombra con palabras («me quedo con la primera», «la del semiarco»). Hace lo mismo que si la tocara.",
    esquema: { type: "object", properties: { posicion: { type: "integer", minimum: 1, maximum: ideas.length }, titulo: { type: "string", enum: ideas.map((idea) => idea.titulo) } }, additionalProperties: false },
  };
}

/** Lo que mandó el modelo → la idea, validada contra las que se ven (y contra las reglas, si ya la leyeron). */
export function ideaDesdeHerramienta(args: unknown, ideas: readonly IdeaVisibleGuiada[], deteccion: DeteccionIdea | null): { ok: true; idea: IdeaElegida; origen: "reglas" | "modelo" } | { ok: false; motivo: string; accion_requerida: string } {
  if (deteccion) return { ok: true, idea: { id: deteccion.idea.id, titulo: deteccion.idea.titulo, posicion: deteccion.posicion }, origen: "reglas" };
  const entrada = z.object({ posicion: z.number().int().nullish(), titulo: z.string().trim().max(200).nullish() }).strict().parse(args);
  const porTitulo = entrada.titulo ? ideas.findIndex((idea) => plegar(idea.titulo) === plegar(entrada.titulo!)) : -1;
  const indice = porTitulo >= 0 ? porTitulo : entrada.posicion && entrada.posicion >= 1 && entrada.posicion <= ideas.length ? entrada.posicion - 1 : -1;
  if (indice < 0) return { ok: false, motivo: "idea_no_identificada", accion_requerida: `Pregunta cuál de estas ideas quiere: ${ideas.map((idea, posicion) => `${posicion + 1}. «${idea.titulo}»`).join(", ")}.` };
  const idea = ideas[indice]!;
  return { ok: true, idea: { id: idea.id, titulo: idea.titulo, posicion: indice + 1 }, origen: "modelo" };
}

// --- Las herramientas del turno ----------------------------------------------------------------------------------------

/**
 * Las herramientas del modelo en un turno, por reglas: las de siempre más las de edición (con plan vigente) y
 * `elegir_idea` (con ideas a la vista). Con un cambio puntual del plan, SOLO las de edición (la que leyeron las reglas,
 * o todas si falta un dato): sin `proponer_composicion` el modelo ya no puede rehacer el plan entero. Con una idea
 * elegida con palabras, solo `elegir_idea`. `motivo`: por qué se restringió (null si no).
 */
export function herramientasConEdicion(entrada: { base: readonly DefinicionHerramienta[]; plan: PlanActualGuiado | null | undefined; ideas: readonly IdeaVisibleGuiada[]; deteccion: DeteccionEdicion; eleccion: DeteccionIdea | null }): { herramientas: DefinicionHerramienta[]; motivo: string | null } {
  const { base, plan, ideas, deteccion, eleccion } = entrada;
  const deEdicion = plan ? herramientasEdicionPlan(plan) : [];
  if (plan && (deteccion.estado === "edicion" || deteccion.estado === "incompleta")) {
    const permitidas: readonly string[] = deteccion.estado === "edicion" ? [deteccion.herramienta] : HERRAMIENTAS_EDICION;
    return { herramientas: deEdicion.filter((herramienta) => permitidas.includes(herramienta.nombre)), motivo: `cambio puntual del plan (${deteccion.estado}): solo herramientas de edición` };
  }
  if (eleccion && ideas.length) return { herramientas: [herramientaElegirIdea(ideas)], motivo: "eligió una idea con palabras: solo elegir_idea" };
  return { herramientas: [...base, ...deEdicion, ...(ideas.length ? [herramientaElegirIdea(ideas)] : [])], motivo: null };
}

/** Las ideas a la vista para el estado del modelo: «1. «Semiarco con centros de mesa»; 2. …». */
export function textoIdeasParaModelo(ideas: readonly IdeaVisibleGuiada[]): string {
  return ideas.map((idea, indice) => `${indice + 1}. «${idea.titulo}»`).join("; ");
}
