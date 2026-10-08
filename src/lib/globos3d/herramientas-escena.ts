import { z } from "zod";
import { TABLA_SEMPERTEX, referenciaPorCodigo, type ReferenciaSempertex } from "@/lib/plan/referencia-sempertex";
import { labDeRgb } from "@/lib/rag/catalog/similitud-color";
import { paraGoogleSchema } from "@/lib/ia/nucleo/esquema-google";
import { FORMATOS_GLOBO, NOMBRE_FAMILIA, coloresDelFormato, formatoPorId } from "./formatos";
import { PATRONES_COLUMNA, type PatronColumna } from "./columnas";
import { PATRONES_MALLA, type PatronMalla } from "./paredes";
import type { FormaArco } from "./arcos";
import { DECORACIONES_PREDEFINIDAS, decoracionPredefinida } from "./figuras";
import { COLUMNA_QUINCE_AZUL } from "./organico-presets";
import { CATALOGO_DECORACIONES } from "./catalogo-fotos";
import { reemplazarColor } from "./recolorear";
import type { ColorOrganico } from "./organico";
import { nombreForma } from "./formas";
import { nombreMetalizado } from "./metalizados";
import type { Pieza, PiezaArmada, TipoPieza } from "./piezas";
import { armarEscena, descendientes, duplicarNodo, idNuevo, marcoDePared, quitarNodo, NOMBRE_PARED, type Colocacion, type ColocacionSobre, type Escena, type EscenaArmada, type NodoEscena, type ParedSala, type Sala } from "./escena";
import { aceptaDecoraciones, colocacionSobre, describirSobre, moverCopia, radioLateral, separarCopia, sitioDescrito, type SitioDescrito } from "./lienzo-escena";
import { ESCENAS_PREDEFINIDAS, arcoOrganico, columnaClasica, escenaPredefinida, guirnaldaFeston, piezaNueva } from "./escenas-presets";

/**
 * **Herramientas para que una IA construya la escena** del taller 3D (pestaña «Escena») por function calling.
 * Puro y sin red: el catálogo de herramientas con su esquema JSON (`DECLARACIONES_ESCENA`) y `aplicarHerramienta`,
 * que aplica UNA llamada a una `Escena` y devuelve la escena nueva con un resumen en español de lo hecho, o un
 * error claro (formato que no existe, color que no viene en ese formato —con el más parecido que sí—, medida fuera
 * de rango, id que no está) sin tocar nada.
 *
 * Es CRUD, no «rehacer»: agregar suma un nodo, cambiar/mover/girar tocan solo el nodo indicado, quitar quita solo
 * ese (y lo que cuelga de él, si se pide). Solo `usar_preset` reemplaza la escena entera.
 *
 * La estructura como lienzo (`poner_sobre`, `mover_sobre`, `separar_copia`): una decoración va en cualquier punto
 * de una columna, un arco, un aro, una guirnalda o una pared de globos, descrito con lo que un modelo razona bien
 * (estructura + altura desde el piso + lado o ángulo alrededor + corrimiento a lo ancho); se apoya en la superficie
 * mirando hacia fuera (colocación `sobre`). Una copia de un reparto en anclas se puede separar y mover sola.
 *
 * Medidas en cm. Colores por código Sempertex («609») o por nombre («rosado pastel», «dorado»): se buscan en la
 * tabla oficial y solo valen los que se fabrican en el formato de la pieza.
 */

// ----------------------------------------------------------------------------------------------------------
// Rangos y opciones
// ----------------------------------------------------------------------------------------------------------

type Rango = readonly [number, number];

/** Rangos (cm) que acepta cada medida: los de los deslizadores del panel, con algo de holgura donde el catálogo lo pide. */
export const RANGOS = {
  columna: { alto_cm: [60, 500] },
  arco: { ancho_cm: [100, 500], alto_cm: [100, 350] },
  arco_organico: { ancho_cm: [150, 500], alto_cm: [150, 320] },
  guirnalda: { ancho_cm: [100, 800], caida_cm: [0, 150] },
  pared_malla: { ancho_cm: [100, 600], alto_cm: [100, 300] },
  pared_trenzas: { ancho_cm: [100, 600], alto_cm: [100, 300] },
  sala: { ancho_cm: [300, 1200], fondo_cm: [300, 1000], alto_cm: [240, 600] },
} as const satisfies Record<string, Record<string, Rango>>;

/** Formatos que admite cada pieza de trenza o malla (los de los botones del panel). */
export const FORMATOS_POR_TIPO: Readonly<Partial<Record<TipoPieza, readonly string[]>>> = {
  columna: ["R-5", "R-9", "R-12", "R-18"],
  arco: ["R-5", "R-9", "R-12", "R-18"],
  guirnalda: ["R-5", "R-9", "R-12"],
  pared_malla: ["LOL-12", "LOL-6"],
};

/** Formatos que usa el arco orgánico (`INFLADOS_ORGANICO` de formas-escena.ts). */
const FORMATOS_ORGANICO = ["R-5", "R-9", "R-12", "R-18", "R-24"] as const;

const TIPOS_NUEVOS = ["columna", "arco", "arco_organico", "guirnalda", "pared_malla", "decoracion"] as const;
const PATRONES_TRENZA_IDS = PATRONES_COLUMNA.map((p) => p.id);
const PATRONES_MALLA_IDS = PATRONES_MALLA.map((p) => p.id);
const PATRONES = [...PATRONES_TRENZA_IDS, ...PATRONES_MALLA_IDS.filter((p) => !(PATRONES_TRENZA_IDS as readonly string[]).includes(p))] as [string, ...string[]];
const DECORACION_IDS = DECORACIONES_PREDEFINIDAS.map((d) => d.id) as [string, ...string[]];
const PRESET_IDS = ESCENAS_PREDEFINIDAS.map((p) => p.id) as [string, ...string[]];
const CATALOGO_IDS = CATALOGO_DECORACIONES.map((d) => d.id) as [string, ...string[]];

const NOMBRE_TIPO: Readonly<Record<TipoPieza, string>> = {
  columna: "columna", arco: "arco", pared_malla: "pared de malla", pared_trenzas: "pared de trenzas", organico: "pieza orgánica",
  decoracion: "decoración", arco_organico: "arco orgánico", guirnalda: "guirnalda", escenografia: "escenografía", globo: "globo suelto",
  forma: "forma de globos", letras: "letras de globos", metalizado: "globo metalizado",
};

// ----------------------------------------------------------------------------------------------------------
// Esquemas (Zod: validan los argumentos y de ellos sale el JSON Schema de cada herramienta)
// ----------------------------------------------------------------------------------------------------------

const DondeSchema = z.object({
  en: z.enum(["piso", "pared", "techo", "ancla"]).describe("piso: apoyada en el piso; pared: pegada a una pared; techo: colgada del techo con hilo; ancla: colgada de otra pieza (flores en una columna)"),
  x_cm: z.number().optional().describe("piso/techo: izquierda (−) a derecha (+) desde el centro de la sala"),
  z_cm: z.number().optional().describe("piso/techo: fondo (−) a frente (+); la pared del fondo está en z = −fondo/2"),
  giro_grados: z.number().optional().describe("piso/techo/ancla: giro sobre el eje vertical; 0 = de frente al público"),
  pared: z.enum(["fondo", "izquierda", "derecha"]).optional().describe("pared: cuál"),
  a_lo_largo_cm: z.number().optional().describe("pared: desde el centro de la pared, + hacia la derecha de quien la mira desde el salón"),
  altura_cm: z.number().optional().describe("pared: altura del borde de abajo de la pieza"),
  cuelga_cm: z.number().optional().describe("techo: cuánto baja el borde de arriba de la pieza desde el techo (largo del hilo)"),
  volteada: z.boolean().optional().describe("techo: cabeza abajo (una flor que mira al piso)"),
  padre_id: z.string().optional().describe("ancla: id de la pieza de la que cuelga"),
  ancla: z.number().optional().describe("ancla: índice del ancla del padre (0 = la primera)"),
  cada: z.number().optional().describe("ancla: repetir cada N anclas (0 = solo una)"),
}).describe("Dónde va la pieza (cm). Si falta, va donde suele ir ese tipo.");
type Donde = z.infer<typeof DondeSchema>;

const ColoresSchema = z.array(z.string().min(1).max(60)).min(1).max(6)
  .describe("Colores en orden: código Sempertex («609») o nombre («rosado pastel», «dorado», «blanco»). Solo valen los que se fabrican en el formato de la pieza.");

const PropiedadesSchema = z.object({
  nombre: z.string().min(1).max(60).optional().describe("Nombre visible en la lista («Columna izquierda»)"),
  formato: z.string().optional().describe("columna/arco: R-5, R-9, R-12 o R-18; guirnalda: R-5, R-9 o R-12; pared_malla: LOL-12 o LOL-6"),
  alto_cm: z.number().optional().describe("columna 60–500; arco 100–350; arco_organico 150–320; pared 100–300"),
  ancho_cm: z.number().optional().describe("arco 100–500; arco_organico (entre patas) 150–500; guirnalda (de punta a punta) 100–800; pared 100–600"),
  caida_cm: z.number().optional().describe("guirnalda: cuánto cuelga en el medio, 0–150 (0 = recta)"),
  forma: z.enum(["redondo", "parabolico", "rectangular"]).optional().describe("arco clásico"),
  patron: z.enum(PATRONES).optional().describe("trenza (columna, arco, guirnalda): un_color (1 color), dos_colores (2), espiral (4), salvavidas (bloques, 2+), zigzag (4); pared_malla: un_color, damero (2), rombos (4), franjas (4). Si falta se deduce del número de colores."),
  colores: ColoresSchema.optional(),
  pesos: z.array(z.number()).max(6).optional().describe("arco_organico: proporción de cada color, en el orden de «colores»"),
  flores: z.boolean().optional().describe("arco_organico: flores artificiales en los huecos"),
  decoracion_id: z.enum(DECORACION_IDS).optional().describe(`decoracion: cuál (${DECORACIONES_PREDEFINIDAS.map((d) => `${d.id} = ${d.nombre}`).join("; ")})`),
});
type Propiedades = z.infer<typeof PropiedadesSchema>;

const IdSchema = z.string().min(1).max(80).describe("id del nodo (los da ver_escena)");

/** Un sitio en la superficie de una estructura, como lo describe una persona. */
const SitioSchema = {
  padre_id: z.string().min(1).max(80).describe("id de la estructura donde va (columna, arco, arco orgánico/aro, guirnalda o pared de globos)"),
  altura_cm: z.number().optional().describe("altura desde el piso del punto donde va (cm); si falta, a media altura de la estructura"),
  lado: z.enum(["frente", "izquierda", "derecha", "atras"]).optional().describe("de qué lado de la estructura, visto desde el público (por defecto frente)"),
  angulo_grados: z.number().optional().describe("en vez de lado: grados alrededor de la estructura desde su frente (90 = su derecha, −90 = su izquierda, 180 = atrás); para repartir alrededor de una columna"),
  x_cm: z.number().optional().describe("corrimiento a la derecha (− a la izquierda) desde el centro de la estructura, visto desde ese lado: en un arco, una guirnalda o una pared, dónde a lo ancho (en un arco, ±ancho/2 son las patas)"),
  giro_grados: z.number().optional().describe("giro de la decoración sobre sí misma"),
};

const ESQUEMAS = {
  ver_escena: z.object({}),
  usar_preset: z.object({ id: z.enum(PRESET_IDS).describe(ESCENAS_PREDEFINIDAS.map((p) => `${p.id}: ${p.nombre}`).join("; ")) }),
  agregar_pieza: PropiedadesSchema.extend({
    tipo: z.enum(TIPOS_NUEVOS).describe("columna: columna clásica de cuartetos; arco: arco clásico de cuartetos; arco_organico: globos de varios tamaños; guirnalda: trenza en festón o recta; pared_malla: mural de Link-O-Loon; decoracion: flor/moño/estrella de globos"),
    donde: DondeSchema.optional(),
  }),
  mover_pieza: z.object({ id: IdSchema, donde: DondeSchema }),
  girar_pieza: z.object({ id: IdSchema, grados: z.number().describe("giro final en grados (−180 a 180)"), relativo: z.boolean().optional().describe("true: suma los grados al giro actual") }),
  cambiar_pieza: PropiedadesSchema.extend({
    id: IdSchema,
    reemplazar_colores: z.array(z.object({ de: z.string().min(1), a: z.string().min(1) })).max(6).optional().describe("Cambia un color por otro en toda la pieza (sirve en cualquier tipo, también decoraciones y piezas del catálogo)"),
  }),
  quitar_pieza: z.object({ id: IdSchema, quitar_colgadas: z.boolean().optional().describe("true (por defecto): también quita lo que cuelga de ella; false: lo deja en el piso") }),
  duplicar_pieza: z.object({ id: IdSchema, nombre: z.string().min(1).max(60).optional(), donde: DondeSchema.optional() }),
  cambiar_sala: z.object({
    ancho_cm: z.number().optional().describe("300–1200"),
    fondo_cm: z.number().optional().describe("300–1000"),
    alto_cm: z.number().optional().describe("altura al techo, 240–600"),
    tono_piso: z.string().optional().describe("color hex del piso (#rrggbb)"),
    tono_paredes: z.string().optional().describe("color hex de las paredes"),
    tono_techo: z.string().optional().describe("color hex del techo"),
    mostrar_piso: z.boolean().optional(),
    mostrar_fondo: z.boolean().optional().describe("pared del fondo"),
    mostrar_laterales: z.boolean().optional().describe("paredes izquierda y derecha"),
    mostrar_techo: z.boolean().optional(),
  }),
  agregar_del_catalogo: z.object({
    id: z.enum(CATALOGO_IDS).describe(CATALOGO_DECORACIONES.map((d) => `${d.id}: ${d.nombre}`).join("; ")),
    nombre: z.string().min(1).max(60).optional(),
    donde: DondeSchema.optional(),
  }),
  listar_colores: z.object({
    formato: z.string().describe(`Formato: ${FORMATOS_GLOBO.map((f) => f.id).join(", ")}`),
    buscar: z.string().max(40).optional().describe("filtra por nombre («rosado», «metal»)"),
  }),
  poner_sobre: z.object({
    decoracion_id: z.enum(DECORACION_IDS).describe("cuál decoración (las mismas de decoracion_id de agregar_pieza)"),
    ...SitioSchema,
    nombre: z.string().min(1).max(60).optional(),
    colores: ColoresSchema.optional().describe("recolorea la decoración: sus colores en orden"),
  }),
  mover_sobre: z.object({
    id: IdSchema.describe("id de la decoración que se mueve"),
    copia: z.number().int().min(0).optional().describe("si está repetida en varias anclas: cuál copia (0 = la primera; ver_escena las lista) — se separa y se mueve solo esa"),
    ...SitioSchema,
  }),
  separar_copia: z.object({
    id: IdSchema.describe("id de la decoración repetida en varias anclas"),
    copia: z.number().int().min(0).describe("cuál copia (0 = la primera; ver_escena las lista con su altura)"),
  }),
} as const;

export type NombreHerramienta = keyof typeof ESQUEMAS;
export const NOMBRES_HERRAMIENTAS = Object.keys(ESQUEMAS) as NombreHerramienta[];

const DESCRIPCIONES: Readonly<Record<NombreHerramienta, string>> = {
  ver_escena: "Lista la sala y cada pieza de la escena: id, tipo, medidas, colores y dónde está. Úsala antes de cambiar algo que ya existe.",
  usar_preset: "Reemplaza TODA la escena por una escena de partida. Solo si el usuario pide empezar de nuevo con una de ellas.",
  agregar_pieza: "Suma una pieza nueva a la escena (no toca las demás). Devuelve su id.",
  mover_pieza: "Cambia dónde está una pieza (piso, pared, techo o colgada de otra). Los campos que falten se conservan si sigue en el mismo sitio.",
  girar_pieza: "Gira una pieza del piso, del techo o colgada de otra.",
  cambiar_pieza: "Cambia medidas, formato, patrón, colores o nombre de UNA pieza existente; solo lo que se pase.",
  quitar_pieza: "Quita una pieza de la escena.",
  duplicar_pieza: "Copia una pieza (con sus medidas y colores); opcionalmente la pone en otro sitio.",
  cambiar_sala: "Cambia las medidas de la sala, sus tonos o qué superficies se ven (paredes, techo, piso).",
  agregar_del_catalogo: "Suma una decoración real digitalizada del catálogo Sempertex (no toca las demás).",
  listar_colores: "Lista los colores Sempertex que se fabrican en un formato, con código y nombre.",
  poner_sobre: "Pone una decoración nueva SOBRE una estructura (columna, arco, aro, guirnalda, pared de globos) en el punto que se describe con altura, lado o ángulo y corrimiento: queda apoyada en los globos mirando hacia fuera. No toca lo demás.",
  mover_sobre: "Mueve una decoración que ya existe a otro punto de una estructura (la misma u otra), descrito igual que en poner_sobre. Si está repetida en varias anclas, mueve solo la copia indicada (las demás se quedan).",
  separar_copia: "Separa UNA copia de una decoración repetida en varias anclas en una pieza propia (en el mismo sitio), para moverla o quitarla sola. Las demás copias se quedan.",
};

/** Una declaración de función para Gemini (`functionDeclarations` con `parametersJsonSchema`). */
export type DeclaracionHerramienta = { name: NombreHerramienta; description: string; parametersJsonSchema: Record<string, unknown> };

export const DECLARACIONES_ESCENA: readonly DeclaracionHerramienta[] = NOMBRES_HERRAMIENTAS.map((nombre) => ({
  name: nombre,
  description: DESCRIPCIONES[nombre],
  parametersJsonSchema: paraGoogleSchema(z.toJSONSchema(ESQUEMAS[nombre], { target: "draft-7" })) as Record<string, unknown>,
}));

// ----------------------------------------------------------------------------------------------------------
// Colores
// ----------------------------------------------------------------------------------------------------------

class ErrorHerramienta extends Error {}
const fallar = (mensaje: string): never => { throw new ErrorHerramienta(mensaje); };

const plegar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const VACIAS = new Set(["de", "del", "la", "el", "color", "globo", "globos", "tono", "y", "en"]);
/** Variantes de una palabra de color a la forma de la tabla. */
const VARIANTES: Readonly<Record<string, string>> = {
  rosada: "rosado", blanca: "blanco", dorada: "dorado", oro: "dorado", plateado: "plata", plateada: "plata", roja: "rojo", amarilla: "amarillo",
  negra: "negro", morado: "violeta", morada: "violeta", purpura: "violeta", anaranjado: "naranja", marron: "cafe", champagne: "champana",
  verdes: "verde", azules: "azul", rosados: "rosado", rosadas: "rosado", blancos: "blanco", blancas: "blanco", dorados: "dorado", doradas: "dorado",
};
/** Palabras de acabado: eligen la familia. */
const FAMILIAS_POR_PALABRA: Readonly<Record<string, readonly string[]>> = {
  pastel: ["pastelMate", "pastelDusk"], mate: ["pastelMate"], dusk: ["pastelDusk"], metal: ["metal"], metalico: ["metal"], metalica: ["metal"],
  metalizado: ["metal"], metalizada: ["metal"], satin: ["satin"], satinado: ["satin"], satinada: ["satin"], reflex: ["reflex"], cromado: ["reflex"],
  cromada: ["reflex"], espejo: ["reflex"], silk: ["silk"], seda: ["silk"], neon: ["neon"], fluorescente: ["neon"], fashion: ["fashion"],
};
/** Palabras que traen color y acabado a la vez. */
const PISTAS: Readonly<Record<string, { color: string; familias: readonly string[] }>> = { celeste: { color: "azul", familias: ["pastelMate"] } };
/** Ante la duda, la familia más común en decoración. */
const PRIORIDAD_FAMILIA = ["fashion", "pastelMate", "metal", "reflex", "satin", "silk", "pastelDusk", "neon", "cristal"];

const palabras = (texto: string) => plegar(texto).split(/[^a-z0-9]+/).filter((p) => p && !VACIAS.has(p)).map((p) => VARIANTES[p] ?? p);
const nombreDe = (r: Pick<ReferenciaSempertex, "codigo" | "nombreCompleto">) => `${r.codigo} ${r.nombreCompleto}`;

function distanciaLab(a: string, b: string): number {
  const lab = (hex: string) => labDeRgb(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
  const [l1, a1, b1] = lab(a), [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** El color del formato más parecido (por el color del globo inflado). */
function masParecido(ref: ReferenciaSempertex, formatoId: string): ReferenciaSempertex | undefined {
  return coloresDelFormato(formatoId).filter((r) => r.codigo !== ref.codigo).sort((x, y) => distanciaLab(ref.hexGlobo, x.hexGlobo) - distanciaLab(ref.hexGlobo, y.hexGlobo))[0];
}

/** Busca un color por nombre en toda la tabla; devuelve el mejor y los otros que también encajan igual de bien. */
function buscarPorNombre(pedido: string): { mejor: ReferenciaSempertex; otros: ReferenciaSempertex[] } | null {
  const tokens = palabras(pedido);
  const familias = new Set<string>();
  const color: string[] = [];
  for (const t of tokens) {
    const pista = PISTAS[t];
    if (pista) { color.push(pista.color); if (!tokens.some((x) => FAMILIAS_POR_PALABRA[x])) pista.familias.forEach((f) => familias.add(f)); continue; }
    const fam = FAMILIAS_POR_PALABRA[t];
    if (fam) fam.forEach((f) => familias.add(f)); else color.push(t);
  }
  if (!color.length) return null;
  const puntuadas = TABLA_SEMPERTEX.referencias.flatMap((r) => {
    if (familias.size && !familias.has(r.familia)) return [];
    const nombre = palabras(r.nombre);
    if (!color.every((c) => nombre.includes(c))) return [];
    const prioridad = PRIORIDAD_FAMILIA.indexOf(r.familia);
    return [{ r, sobra: nombre.length - color.length, puntos: (nombre.length - color.length) * 10 + (prioridad < 0 ? 9 : prioridad) }];
  }).sort((a, b) => a.puntos - b.puntos);
  const mejor = puntuadas[0];
  if (!mejor) return null;
  return { mejor: mejor.r, otros: puntuadas.slice(1).filter((p) => p.sobra === mejor.sobra).map((p) => p.r) };
}

export type ColorResuelto = { codigo: string; nota?: string };

/**
 * Un color pedido (código o nombre) → código Sempertex que se fabrica en ese formato. Error claro si no existe o
 * no viene en el formato, con el más parecido que sí viene.
 */
export function resolverColor(pedido: string, formatoId: string): ColorResuelto {
  const formato = formatoPorId(formatoId) ?? fallar(`El formato «${formatoId}» no existe. Formatos: ${FORMATOS_GLOBO.map((f) => f.id).join(", ")}.`);
  const enFormato = (codigo: string) => coloresDelFormato(formato.id).some((r) => r.codigo === codigo);
  const codigo = pedido.match(/\b(\d{3})\b/)?.[1];
  let ref: ReferenciaSempertex;
  let nota: string | undefined;
  if (codigo) {
    ref = referenciaPorCodigo(codigo) ?? fallar(`El color ${codigo} no está en la tabla oficial Sempertex. Usa listar_colores con el formato ${formato.id}.`);
  } else {
    const hallado = buscarPorNombre(pedido) ?? fallar(`No encontré el color «${pedido}» en la tabla Sempertex. Usa listar_colores con el formato ${formato.id} para ver los que hay.`);
    // Si el mejor no viene en el formato pero otro igual de bueno sí (Metal Dorado no, Reflex Dorado sí), ese.
    ref = enFormato(hallado.mejor.codigo) ? hallado.mejor : hallado.otros.find((r) => enFormato(r.codigo)) ?? hallado.mejor;
    const otros = hallado.otros.filter((r) => r.codigo !== ref.codigo && enFormato(r.codigo));
    nota = `«${pedido}» → ${nombreDe(ref)}${otros.length ? ` (también hay ${otros.slice(0, 3).map(nombreDe).join(", ")})` : ""}`;
  }
  if (!enFormato(ref.codigo)) {
    const sugerido = masParecido(ref, formato.id);
    fallar(`El color ${nombreDe(ref)} no se fabrica en ${formato.id}.${sugerido ? ` El más parecido que sí viene en ${formato.id} es ${nombreDe(sugerido)}.` : ""}`);
  }
  return nota ? { codigo: ref.codigo, nota } : { codigo: ref.codigo };
}

/** Resuelve una lista de colores y junta las notas. */
function resolverColores(pedidos: readonly string[], formatoId: string, notas: string[]): string[] {
  return pedidos.map((p) => { const r = resolverColor(p, formatoId); if (r.nota) notas.push(r.nota); return r.codigo; });
}

const nombreColor = (codigo: string) => { const r = referenciaPorCodigo(codigo); return r ? nombreDe(r) : codigo; };

/** Los colores (código y formatos donde aparece) de cualquier dato del taller, en orden de aparición. */
function coloresDeDato(valor: unknown): Array<{ codigo: string; formatos: string[] }> {
  const salida = new Map<string, Set<string>>();
  const anotar = (codigo: unknown, formatos: readonly string[]) => {
    if (typeof codigo !== "string" || !/^\d{3}$/.test(codigo)) return;
    const s = salida.get(codigo) ?? new Set<string>();
    formatos.forEach((f) => s.add(f));
    salida.set(codigo, s);
  };
  const recorrer = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(recorrer); return; }
    if (typeof v !== "object" || v === null) return;
    const o = v as Record<string, unknown>;
    const formatos = [o.formatoId, ...["grande", "chico"].map((k) => { const x = o[k]; return typeof x === "object" && x !== null ? (x as Record<string, unknown>).formatoId : undefined; })]
      .filter((f): f is string => typeof f === "string");
    for (const [clave, x] of Object.entries(o)) {
      if (clave === "codigo") anotar(x, formatos);
      else if ((clave === "codigos" || clave === "colores") && Array.isArray(x)) x.forEach((c) => (typeof c === "string" ? anotar(c, formatos) : recorrer(c)));
      else recorrer(x);
    }
  };
  recorrer(valor);
  return [...salida.entries()].map(([codigo, formatos]) => ({ codigo, formatos: [...formatos] }));
}

// ----------------------------------------------------------------------------------------------------------
// Lectura de la escena
// ----------------------------------------------------------------------------------------------------------

const r0 = (n: number) => Math.round(n);

function medidasDe(p: Pieza): string {
  switch (p.tipo) {
    case "columna": return `${p.formatoId} · alto ${r0(p.alturaCm)} cm · ${p.patron}`;
    case "arco": return `${p.formatoId} · ${p.forma} · ${r0(p.anchoCm)}×${r0(p.altoCm)} cm (ancho×alto) · ${p.patron}`;
    case "arco_organico": return `${r0(p.arco.anchoCm)}×${r0(p.arco.altoCm)} cm (ancho entre patas×alto) · ${p.arco.flores ? "con flores" : "sin flores"}`;
    case "guirnalda": return `${p.guirnalda.formatoId} · ${p.guirnalda.recorrido ? "curva libre" : `largo ${r0(p.guirnalda.anchoCm)} cm, caída ${r0(p.guirnalda.caidaCm)} cm`} · ${p.guirnalda.patron}`;
    case "pared_malla": return `${p.formatoId} · ${r0(p.anchoCm)}×${r0(p.altoCm)} cm · ${p.patron}`;
    case "pared_trenzas": return `${r0(p.opciones.anchoCm)}×${r0(p.opciones.altoCm)} cm · ${p.opciones.patron}`;
    case "organico": return "pieza orgánica armada";
    case "decoracion": return `${p.decoracion.tipo}`;
    case "escenografia": return `escenografía (${p.elementos.length} elementos, sin globos)`;
    case "globo": return `${p.formatoId} · ${r0(p.infladoCm)} cm`;
    case "forma": return nombreForma(p.forma);
    case "letras": return `«${p.letras.texto}» · ${r0(p.letras.altoCm)} cm de alto · ${p.letras.tecnica}`;
    case "metalizado": return `${nombreMetalizado(p.metalizado)} (foil, no es látex)`;
  }
}

function coloresTexto(p: Pieza): string {
  if (p.tipo === "arco_organico") {
    const total = p.arco.colores.reduce((s, c) => s + c.peso, 0) || 1;
    return p.arco.colores.map((c) => `${nombreColor(c.codigo)} ${Math.round((c.peso / total) * 100)}%`).join(", ");
  }
  const lista = p.tipo === "columna" || p.tipo === "arco" || p.tipo === "pared_malla" ? p.colores : p.tipo === "guirnalda" ? p.guirnalda.colores : coloresDeDato(p).map((c) => c.codigo);
  return lista.map(nombreColor).join(", ");
}

function dondeTexto(c: Colocacion, escena: Escena, armada?: EscenaArmada): string {
  if (c.en === "piso") return `piso x=${r0(c.xCm)} z=${r0(c.zCm)} giro=${r0(c.giroGrados)}°`;
  if (c.en === "pared") return `pared ${c.pared} a_lo_largo=${r0(c.aLoLargoCm)} altura=${r0(c.alturaCm)}`;
  if (c.en === "techo") return `techo x=${r0(c.xCm)} z=${r0(c.zCm)} cuelga=${r0(c.cuelgaCm)} giro=${r0(c.giroGrados)}°${c.volteada ? " volteada" : ""}`;
  if (c.en === "libre") return `suelta x=${r0(c.xCm)} y=${r0(c.yCm)} z=${r0(c.zCm)} giro=${r0(c.giroGrados)}°`;
  if (c.en === "sobre") return armada ? describirSobre(armada, c) : `sobre «${c.padreId}»`;
  const padre = escena.nodos.find((n) => n.id === c.padreId);
  return `colgada de «${padre?.id ?? c.padreId}» ancla=${c.ancla} cada=${c.cada}${c.omitir?.length ? ` sin_anclas=${c.omitir.join(",")}` : ""} giro=${r0(c.giroGrados)}°`;
}

/** Piezas ya armadas por su JSON (para no rehacer un arco orgánico en cada llamada que necesita la geometría). */
const CACHE_ARMADO = new Map<string, PiezaArmada>();

/** Las copias de un reparto en anclas, con su altura y su corrimiento a lo ancho (para elegir cuál separar o mover). */
function copiasTexto(armada: EscenaArmada, id: string): string {
  const puestas = armada.porNodo.find((n) => n.id === id)?.puestas ?? [];
  return puestas.map((p, i) => `#${i} a ${r0((p.caja.min.y + p.caja.max.y) / 2)} cm de altura, x=${r0((p.caja.min.x + p.caja.max.x) / 2)}`).join("; ");
}

/** La escena en pocas líneas: lo que devuelve `ver_escena`. */
export function resumenEscena(escena: Escena): string {
  const s = escena.sala;
  // La geometría solo hace falta para contar dónde va lo que está sobre otra pieza y las copias de un reparto.
  const hace = escena.nodos.some((n) => n.colocacion.en === "sobre" || (n.colocacion.en === "ancla" && n.colocacion.cada > 0));
  const armada = hace ? armarEscena(escena, CACHE_ARMADO) : undefined;
  const copias = (n: NodoEscena) => {
    if (!armada || n.colocacion.en !== "ancla") return "";
    const total = armada.porNodo.find((x) => x.id === n.id)?.puestas.length ?? 0;
    return total > 1 ? ` · ${total} copias: ${copiasTexto(armada, n.id)}` : "";
  };
  const vistas = [s.mostrar.fondo && "pared del fondo", s.mostrar.laterales && "paredes laterales", s.mostrar.techo && "techo", s.mostrar.piso && "piso"].filter(Boolean).join(", ") || "nada";
  const lineas = [
    `Sala ${r0(s.anchoCm)}×${r0(s.fondoCm)}×${r0(s.altoCm)} cm (ancho×fondo×alto): x de −${r0(s.anchoCm / 2)} a ${r0(s.anchoCm / 2)}, z de −${r0(s.fondoCm / 2)} (pared del fondo) a ${r0(s.fondoCm / 2)} (frente). Se ve: ${vistas}.`,
    escena.nodos.length ? `${escena.nodos.length} piezas:` : "La sala está vacía.",
    ...escena.nodos.map((n) => `- ${n.id} · «${n.nombre}» · ${n.pieza.tipo} · ${medidasDe(n.pieza)} · colores: ${coloresTexto(n.pieza) || "—"} · ${dondeTexto(n.colocacion, escena, armada)}${copias(n)}`),
  ];
  return lineas.join("\n");
}

// ----------------------------------------------------------------------------------------------------------
// Validación de medidas y colocaciones
// ----------------------------------------------------------------------------------------------------------

function enRango(valor: number, rango: Rango, que: string): number {
  if (!Number.isFinite(valor) || valor < rango[0] || valor > rango[1]) fallar(`${que} = ${valor} cm está fuera de rango: va de ${rango[0]} a ${rango[1]} cm.`);
  return r0(valor);
}

function nodoPorId(escena: Escena, id: string): NodoEscena {
  return escena.nodos.find((n) => n.id === id) ?? fallar(`No hay ninguna pieza con id «${id}». Ids: ${escena.nodos.map((n) => n.id).join(", ") || "(la sala está vacía)"}.`);
}

const giroNormal = (g: number) => { const x = ((((g + 180) % 360) + 360) % 360) - 180; return x === -180 ? 180 : r0(x); };

/** La colocación por defecto de un tipo (la del botón «Añadir» del panel). */
function colocacionPorDefecto(pieza: Pieza): Colocacion {
  if (pieza.tipo === "decoracion") return { en: "techo", xCm: 0, zCm: 0, cuelgaCm: 60, giroGrados: 0, volteada: true };
  if (pieza.tipo === "guirnalda") return { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 200 };
  if (pieza.tipo === "pared_malla" || pieza.tipo === "pared_trenzas") return { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 0 };
  return { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 };
}

/**
 * Lleva `donde` a una `Colocacion` válida. Si la pieza ya estaba en el mismo sitio, los campos que faltan se
 * conservan; si no, toman el valor por defecto. `id` es el del nodo (para no colgarlo de sí mismo).
 */
function colocacionDe(donde: Donde, escena: Escena, previa: Colocacion | null, pieza: Pieza, id: string | null): Colocacion {
  const s = escena.sala;
  const mismo = previa && previa.en === donde.en ? previa : null;
  const dentro = (v: number, mitad: number, que: string) => {
    if (!Number.isFinite(v) || Math.abs(v) > mitad) fallar(`${que} = ${v} cm se sale de la sala: va de −${r0(mitad)} a ${r0(mitad)} cm.`);
    return r0(v);
  };
  if (donde.en === "piso") {
    const m = mismo?.en === "piso" ? mismo : null;
    return { en: "piso", xCm: dentro(donde.x_cm ?? m?.xCm ?? 0, s.anchoCm / 2, "x_cm"), zCm: dentro(donde.z_cm ?? m?.zCm ?? 0, s.fondoCm / 2, "z_cm"), giroGrados: giroNormal(donde.giro_grados ?? m?.giroGrados ?? 0) };
  }
  if (donde.en === "pared") {
    const m = mismo?.en === "pared" ? mismo : null;
    const pared: ParedSala = donde.pared ?? m?.pared ?? "fondo";
    const largo = marcoDePared(s, pared).largoCm;
    const altura = donde.altura_cm ?? m?.alturaCm ?? (pieza.tipo === "guirnalda" ? 200 : 0);
    if (!Number.isFinite(altura) || altura < 0 || altura > s.altoCm) fallar(`altura_cm = ${altura} cm: va de 0 a ${r0(s.altoCm)} cm (el alto de la sala).`);
    return { en: "pared", pared, aLoLargoCm: dentro(donde.a_lo_largo_cm ?? (m && m.pared === pared ? m.aLoLargoCm : 0), largo / 2, `a_lo_largo_cm en la ${NOMBRE_PARED[pared].toLowerCase()}`), alturaCm: r0(altura) };
  }
  if (donde.en === "techo") {
    const m = mismo?.en === "techo" ? mismo : null;
    const cuelga = donde.cuelga_cm ?? m?.cuelgaCm ?? 40;
    const maximo = Math.max(0, s.altoCm - 40);
    if (!Number.isFinite(cuelga) || cuelga < 0 || cuelga > maximo) fallar(`cuelga_cm = ${cuelga} cm: va de 0 a ${r0(maximo)} cm en esta sala.`);
    return {
      en: "techo", xCm: dentro(donde.x_cm ?? m?.xCm ?? 0, s.anchoCm / 2, "x_cm"), zCm: dentro(donde.z_cm ?? m?.zCm ?? 0, s.fondoCm / 2, "z_cm"),
      cuelgaCm: r0(cuelga), giroGrados: giroNormal(donde.giro_grados ?? m?.giroGrados ?? 0), volteada: donde.volteada ?? m?.volteada ?? pieza.tipo === "decoracion",
    };
  }
  const m = mismo?.en === "ancla" ? mismo : null;
  const padreId = donde.padre_id ?? m?.padreId ?? fallar("Para colgarla de otra pieza falta padre_id (el id de esa pieza).");
  const padre = nodoPorId(escena, padreId);
  if (id && descendientes(escena, id).has(padre.id)) fallar(`«${padre.id}» cuelga de esta misma pieza (o es ella): no se puede colgar de ahí.`);
  if (padre.pieza.tipo === "decoracion") fallar(`«${padre.id}» es una decoración y no tiene anclas: cuélgala de una columna, arco, guirnalda o pared.`);
  const ancla = donde.ancla ?? m?.ancla ?? 0, cada = donde.cada ?? m?.cada ?? 0;
  if (ancla < 0 || cada < 0) fallar("ancla y cada van desde 0.");
  return { en: "ancla", padreId: padre.id, ancla: r0(ancla), cada: r0(cada), giroGrados: giroNormal(donde.giro_grados ?? m?.giroGrados ?? 0) };
}

function comprobarAltura(pieza: Pieza, c: Colocacion, sala: Sala) {
  const alto = pieza.tipo === "columna" ? pieza.alturaCm : pieza.tipo === "arco" || pieza.tipo === "pared_malla" ? pieza.altoCm : pieza.tipo === "arco_organico" ? pieza.arco.altoCm : pieza.tipo === "pared_trenzas" ? pieza.opciones.altoCm : 0;
  const base = c.en === "pared" ? c.alturaCm : 0;
  if ((c.en === "piso" || c.en === "pared") && alto + base > sala.altoCm) fallar(`La pieza mide ${r0(alto)} cm${base ? ` y empieza a ${r0(base)} cm` : ""}: no cabe bajo el techo de ${r0(sala.altoCm)} cm.`);
}

// ----------------------------------------------------------------------------------------------------------
// Propiedades de una pieza
// ----------------------------------------------------------------------------------------------------------

const NECESITA: Readonly<Record<string, number>> = Object.fromEntries([...PATRONES_COLUMNA, ...PATRONES_MALLA].map((p) => [p.id, p.colores]));

/** Ajusta la lista de colores al patrón: repite si faltan; error si sobran (salvo salvavidas, que admite 2 o más). */
function coloresParaPatron(patron: string, colores: string[], notas: string[]): string[] {
  const n = NECESITA[patron] ?? colores.length;
  if (patron === "salvavidas") return colores.length >= 2 ? colores : [colores[0]!, colores[0]!];
  if (colores.length > n) fallar(`El patrón ${patron} usa ${n} color${n > 1 ? "es" : ""} y se pasaron ${colores.length}. Con ${colores.length} colores usa ${colores.length === 2 ? "dos_colores o salvavidas" : colores.length === 4 ? "espiral o zigzag" : "salvavidas"}.`);
  if (colores.length < n) {
    const relleno = Array.from({ length: n }, (_, i) => colores[i % colores.length]!);
    notas.push(`el patrón ${patron} pide ${n} colores: se repitieron (${relleno.join(", ")})`);
    return relleno;
  }
  return colores;
}

function patronTrenzaPorColores(n: number): PatronColumna {
  return n >= 4 ? "espiral" : n === 3 ? "salvavidas" : n === 2 ? "dos_colores" : "un_color";
}
function patronMallaPorColores(n: number): PatronMalla {
  return n >= 4 ? "rombos" : n >= 2 ? "damero" : "un_color";
}

function formatoValido(tipo: TipoPieza, formato: string): string {
  if (!formatoPorId(formato)) fallar(`El formato «${formato}» no existe. Formatos: ${FORMATOS_GLOBO.map((f) => f.id).join(", ")}.`);
  const validos = FORMATOS_POR_TIPO[tipo] ?? [];
  if (!validos.includes(formato)) fallar(`Una ${NOMBRE_TIPO[tipo]} no se arma con ${formato}: usa ${validos.join(", ")}.`);
  return formato;
}

/** Comprueba que una propiedad aplica a la pieza. */
function soloPara(props: Propiedades, campo: keyof Propiedades, tipos: readonly TipoPieza[], tipo: TipoPieza) {
  if (props[campo] !== undefined && !tipos.includes(tipo)) fallar(`«${campo}» no aplica a una ${NOMBRE_TIPO[tipo]} (vale en: ${tipos.map((t) => NOMBRE_TIPO[t]).join(", ")}).`);
}

/** Recolorea una pieza sin lista simple de colores (decoración, pared de trenzas, orgánico): sus colores en orden. */
function recolorearEnOrden(pieza: Pieza, pedidos: readonly string[], notas: string[]): Pieza {
  const actuales = coloresDeDato(pieza);
  if (pedidos.length > actuales.length) fallar(`Esta pieza tiene ${actuales.length} color${actuales.length === 1 ? "" : "es"} (${actuales.map((c) => nombreColor(c.codigo)).join(", ")}) y se pasaron ${pedidos.length}.`);
  let valor = pieza;
  pedidos.forEach((pedido, i) => {
    const actual = actuales[i]!;
    const nuevo = resolverColor(pedido, actual.formatos[0] ?? "R-12");
    if (nuevo.nota) notas.push(nuevo.nota);
    const hecho = reemplazarColor(valor, actual.codigo, nuevo.codigo);
    valor = hecho.valor;
    if (hecho.omitidos.length) notas.push(`${nombreColor(nuevo.codigo)} no viene en ${hecho.omitidos.join(", ")}: ahí se dejó ${nombreColor(actual.codigo)}`);
  });
  return valor;
}

function coloresOrganicos(pedidos: readonly string[], pesos: readonly number[] | undefined, notas: string[]): ColorOrganico[] {
  if (pesos && pesos.length !== pedidos.length) fallar(`pesos tiene ${pesos.length} valores y colores ${pedidos.length}: deben ir uno por color.`);
  if (pesos?.some((p) => !Number.isFinite(p) || p < 0 || p > 100)) fallar("Cada peso va de 0 a 100.");
  return pedidos.map((pedido, i) => {
    const { codigo, nota } = resolverColor(pedido, "R-12");
    if (nota) notas.push(nota);
    const formatos = FORMATOS_ORGANICO.filter((f) => coloresDelFormato(f).some((r) => r.codigo === codigo));
    const peso = pesos ? r0(pesos[i]!) : pedidos.length === 1 ? 100 : i === 0 ? 40 : r0(60 / (pedidos.length - 1));
    return formatos.length < FORMATOS_ORGANICO.length ? { codigo, peso, formatos } : { codigo, peso };
  });
}

/** Aplica las propiedades pedidas a una pieza (nueva o existente). Solo cambia lo que viene. */
function aplicarPropiedades(base: Pieza, props: Propiedades, notas: string[]): Pieza {
  const t = base.tipo;
  soloPara(props, "formato", ["columna", "arco", "guirnalda", "pared_malla"], t);
  soloPara(props, "alto_cm", ["columna", "arco", "arco_organico", "pared_malla", "pared_trenzas"], t);
  soloPara(props, "ancho_cm", ["arco", "arco_organico", "guirnalda", "pared_malla", "pared_trenzas"], t);
  soloPara(props, "caida_cm", ["guirnalda"], t);
  soloPara(props, "forma", ["arco"], t);
  soloPara(props, "patron", ["columna", "arco", "guirnalda", "pared_malla"], t);
  soloPara(props, "pesos", ["arco_organico"], t);
  soloPara(props, "flores", ["arco_organico"], t);
  soloPara(props, "decoracion_id", ["decoracion"], t);

  switch (base.tipo) {
    case "columna":
    case "arco": {
      const p = { ...base };
      if (props.formato && props.formato !== p.formatoId) {
        p.formatoId = formatoValido(t, props.formato);
        p.infladoCm = formatoPorId(p.formatoId)!.infladoDecoracionCm;
        if (!props.colores) p.colores = resolverColores(p.colores, p.formatoId, notas);
      }
      if (p.tipo === "columna" && props.alto_cm !== undefined) p.alturaCm = enRango(props.alto_cm, RANGOS.columna.alto_cm, "alto_cm");
      if (p.tipo === "arco") {
        if (props.alto_cm !== undefined) p.altoCm = enRango(props.alto_cm, RANGOS.arco.alto_cm, "alto_cm");
        if (props.ancho_cm !== undefined) p.anchoCm = enRango(props.ancho_cm, RANGOS.arco.ancho_cm, "ancho_cm");
        if (props.forma) p.forma = props.forma as FormaArco;
      }
      if (props.patron && !(PATRONES_TRENZA_IDS as readonly string[]).includes(props.patron)) fallar(`El patrón ${props.patron} es de paredes de malla; en una ${NOMBRE_TIPO[t]} usa ${PATRONES_TRENZA_IDS.join(", ")}.`);
      const colores = props.colores ? resolverColores(props.colores, p.formatoId, notas) : null;
      const patron = (props.patron as PatronColumna | undefined) ?? (colores ? patronTrenzaPorColores(colores.length) : p.patron);
      if (colores || props.patron) { p.patron = patron; p.colores = coloresParaPatron(patron, colores ?? p.colores, notas); }
      return p;
    }
    case "guirnalda": {
      const g = { ...base.guirnalda };
      if (props.formato && props.formato !== g.formatoId) {
        g.formatoId = formatoValido(t, props.formato);
        g.infladoCm = formatoPorId(g.formatoId)!.infladoDecoracionCm;
        if (!props.colores) g.colores = resolverColores(g.colores, g.formatoId, notas);
      }
      if (props.ancho_cm !== undefined) { g.anchoCm = enRango(props.ancho_cm, RANGOS.guirnalda.ancho_cm, "ancho_cm"); g.recorrido = null; }
      if (props.caida_cm !== undefined) { g.caidaCm = enRango(props.caida_cm, RANGOS.guirnalda.caida_cm, "caida_cm"); g.recorrido = null; }
      if (props.patron && !(PATRONES_TRENZA_IDS as readonly string[]).includes(props.patron)) fallar(`El patrón ${props.patron} es de paredes de malla; en una guirnalda usa ${PATRONES_TRENZA_IDS.join(", ")}.`);
      const colores = props.colores ? resolverColores(props.colores, g.formatoId, notas) : null;
      const patron = (props.patron as PatronColumna | undefined) ?? (colores ? patronTrenzaPorColores(colores.length) : g.patron);
      if (colores || props.patron) { g.patron = patron; g.colores = coloresParaPatron(patron, colores ?? g.colores, notas); }
      return { ...base, guirnalda: g };
    }
    case "pared_malla": {
      const p = { ...base };
      if (props.formato && props.formato !== p.formatoId) {
        p.formatoId = formatoValido(t, props.formato);
        p.infladoCm = formatoPorId(p.formatoId)!.infladoDecoracionCm;
        if (!props.colores) p.colores = resolverColores(p.colores, p.formatoId, notas);
      }
      if (props.alto_cm !== undefined) p.altoCm = enRango(props.alto_cm, RANGOS.pared_malla.alto_cm, "alto_cm");
      if (props.ancho_cm !== undefined) p.anchoCm = enRango(props.ancho_cm, RANGOS.pared_malla.ancho_cm, "ancho_cm");
      if (props.patron && !(PATRONES_MALLA_IDS as readonly string[]).includes(props.patron)) fallar(`En una pared de malla el patrón va entre ${PATRONES_MALLA_IDS.join(", ")}.`);
      const colores = props.colores ? resolverColores(props.colores, p.formatoId, notas) : null;
      const patron = (props.patron as PatronMalla | undefined) ?? (colores ? patronMallaPorColores(colores.length) : p.patron);
      if (colores || props.patron) { p.patron = patron; p.colores = coloresParaPatron(patron, colores ?? p.colores, notas); }
      return p;
    }
    case "arco_organico": {
      const a = { ...base.arco };
      if (props.ancho_cm !== undefined) a.anchoCm = enRango(props.ancho_cm, RANGOS.arco_organico.ancho_cm, "ancho_cm");
      if (props.alto_cm !== undefined) a.altoCm = enRango(props.alto_cm, RANGOS.arco_organico.alto_cm, "alto_cm");
      if (props.colores) a.colores = coloresOrganicos(props.colores, props.pesos, notas);
      else if (props.pesos) {
        if (props.pesos.length !== a.colores.length) fallar(`pesos tiene ${props.pesos.length} valores y el arco ${a.colores.length} colores.`);
        a.colores = a.colores.map((c, i) => ({ ...c, peso: r0(props.pesos![i]!) }));
      }
      if (props.flores !== undefined) Object.assign(a, props.flores ? { flores: structuredClone(COLUMNA_QUINCE_AZUL.flores), huecosFlores: 14 } : { flores: null, huecosFlores: 0 });
      return { ...base, arco: a };
    }
    case "pared_trenzas": {
      const o = { ...base.opciones };
      if (props.alto_cm !== undefined) o.altoCm = enRango(props.alto_cm, RANGOS.pared_trenzas.alto_cm, "alto_cm");
      if (props.ancho_cm !== undefined) o.anchoCm = enRango(props.ancho_cm, RANGOS.pared_trenzas.ancho_cm, "ancho_cm");
      const p: Pieza = { ...base, opciones: o };
      return props.colores ? recolorearEnOrden(p, props.colores, notas) : p;
    }
    case "decoracion": {
      const p: Pieza = props.decoracion_id ? { tipo: "decoracion", decoracion: structuredClone(decoracionPredefinida(props.decoracion_id)) } : base;
      return props.colores ? recolorearEnOrden(p, props.colores, notas) : p;
    }
    case "organico":
      return props.colores ? recolorearEnOrden(base, props.colores, notas) : base;
    case "escenografia":
    case "metalizado":
      // No es globo de látex: no tiene colores Sempertex que cambiar.
      return base;
    case "globo":
    case "forma":
    case "letras":
      return props.colores ? recolorearEnOrden(base, props.colores, notas) : base;
  }
}

/** La pieza de partida de cada tipo nuevo (la de «Añadir», con los valores del preset del dueño). */
function piezaBase(tipo: (typeof TIPOS_NUEVOS)[number]): Pieza {
  switch (tipo) {
    case "columna": return columnaClasica();
    case "arco": return piezaNueva("arco").pieza;
    case "arco_organico": return arcoOrganico();
    case "guirnalda": return guirnaldaFeston(300, 30);
    case "pared_malla": return piezaNueva("pared").pieza;
    case "decoracion": return piezaNueva("decoracion").pieza;
  }
}

const NOMBRE_BASE: Readonly<Record<(typeof TIPOS_NUEVOS)[number], string>> = {
  columna: "Columna", arco: "Arco", arco_organico: "Arco orgánico", guirnalda: "Guirnalda", pared_malla: "Pared de globos", decoracion: "Flor de globos",
};

// ----------------------------------------------------------------------------------------------------------
// Aplicar una llamada
// ----------------------------------------------------------------------------------------------------------

export type ResultadoHerramienta =
  | { ok: true; escena: Escena; resumen: string; consulta: boolean }
  | { ok: false; escena: Escena; error: string };

const conNotas = (texto: string, notas: readonly string[]) => (notas.length ? `${texto} (${notas.join("; ")})` : texto);

function insertar(escena: Escena, nodo: NodoEscena): Escena {
  return { ...escena, nodos: [...escena.nodos, nodo] };
}
function reemplazar(escena: Escena, nodo: NodoEscena): Escena {
  return { ...escena, nodos: escena.nodos.map((n) => (n.id === nodo.id ? nodo : n)) };
}

function errorDeZod(error: z.ZodError): string {
  return `Parámetros no válidos: ${error.issues.slice(0, 4).map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")}.`;
}

function ejecutar(escena: Escena, nombre: NombreHerramienta, argumentos: unknown): { escena: Escena; resumen: string; consulta?: boolean } {
  const notas: string[] = [];
  switch (nombre) {
    case "ver_escena":
      ESQUEMAS.ver_escena.parse(argumentos ?? {});
      return { escena, resumen: resumenEscena(escena), consulta: true };

    case "listar_colores": {
      const a = ESQUEMAS.listar_colores.parse(argumentos);
      const formato = formatoPorId(a.formato.trim().toUpperCase()) ?? fallar(`El formato «${a.formato}» no existe. Formatos: ${FORMATOS_GLOBO.map((f) => f.id).join(", ")}.`);
      const filtro = a.buscar ? palabras(a.buscar) : [];
      const lista = coloresDelFormato(formato.id).filter((r) => {
        const texto = palabras(`${r.nombreCompleto} ${NOMBRE_FAMILIA[r.familia] ?? ""} ${r.codigo}`);
        return filtro.every((f) => texto.includes(f) || (FAMILIAS_POR_PALABRA[f]?.includes(r.familia) ?? false));
      });
      return { escena, consulta: true, resumen: `${formato.id} (${formato.nombre}) · ${lista.length} colores${a.buscar ? ` con «${a.buscar}»` : ""}: ${lista.map(nombreDe).join(", ") || "ninguno"}` };
    }

    case "usar_preset": {
      const a = ESQUEMAS.usar_preset.parse(argumentos);
      const preset = ESCENAS_PREDEFINIDAS.find((p) => p.id === a.id)!;
      return { escena: escenaPredefinida(a.id), resumen: `Escena reemplazada por «${preset.nombre}» (${preset.escena.nodos.length} piezas: ${preset.escena.nodos.map((n) => n.id).join(", ")}).` };
    }

    case "agregar_pieza": {
      const a = ESQUEMAS.agregar_pieza.parse(argumentos);
      const pieza = aplicarPropiedades(piezaBase(a.tipo), a, notas);
      const id = idNuevo(escena, a.tipo.replace("_", "-"));
      const colocacion = a.donde ? colocacionDe(a.donde, escena, null, pieza, id) : colocacionPorDefecto(pieza);
      comprobarAltura(pieza, colocacion, escena.sala);
      const nodo: NodoEscena = { id, nombre: a.nombre ?? NOMBRE_BASE[a.tipo], pieza, colocacion };
      const nueva = insertar(escena, nodo);
      return { escena: nueva, resumen: conNotas(`Agregué «${nodo.nombre}» (id ${id}): ${NOMBRE_TIPO[pieza.tipo]} ${medidasDe(pieza)}, colores ${coloresTexto(pieza)}, ${dondeTexto(colocacion, nueva)}.`, notas) };
    }

    case "agregar_del_catalogo": {
      const a = ESQUEMAS.agregar_del_catalogo.parse(argumentos);
      const d = CATALOGO_DECORACIONES.find((x) => x.id === a.id)!;
      const pieza = structuredClone(d.pieza);
      const id = idNuevo(escena, d.id.replace(/_/g, "-"));
      const colocacion = a.donde ? colocacionDe(a.donde, escena, null, pieza, id) : colocacionPorDefecto(pieza);
      comprobarAltura(pieza, colocacion, escena.sala);
      const nodo: NodoEscena = { id, nombre: a.nombre ?? d.nombre, pieza, colocacion };
      const nueva = insertar(escena, nodo);
      return { escena: nueva, resumen: `Agregué del catálogo «${d.nombre}» (id ${id}, ${d.fuente}), ${dondeTexto(colocacion, nueva)}.` };
    }

    case "mover_pieza": {
      const a = ESQUEMAS.mover_pieza.parse(argumentos);
      const nodo = nodoPorId(escena, a.id);
      const colocacion = colocacionDe(a.donde, escena, nodo.colocacion, nodo.pieza, nodo.id);
      comprobarAltura(nodo.pieza, colocacion, escena.sala);
      const nueva = reemplazar(escena, { ...nodo, colocacion });
      return { escena: nueva, resumen: `Moví «${nodo.nombre}» (${nodo.id}) a ${dondeTexto(colocacion, nueva)}.` };
    }

    case "girar_pieza": {
      const a = ESQUEMAS.girar_pieza.parse(argumentos);
      const nodo = nodoPorId(escena, a.id);
      const c = nodo.colocacion;
      if (c.en === "pared") return fallar(`«${nodo.nombre}» está en una pared y mira al salón: no se gira. Muévela a otra pared con mover_pieza.`);
      const giroGrados = giroNormal(a.relativo ? c.giroGrados + a.grados : a.grados);
      const colocacion: Colocacion = { ...c, giroGrados };
      return { escena: reemplazar(escena, { ...nodo, colocacion }), resumen: `Giré «${nodo.nombre}» (${nodo.id}) a ${giroGrados}°.` };
    }

    case "cambiar_pieza": {
      const a = ESQUEMAS.cambiar_pieza.parse(argumentos);
      const nodo = nodoPorId(escena, a.id);
      let pieza = aplicarPropiedades(nodo.pieza, a, notas);
      for (const { de, a: hacia } of a.reemplazar_colores ?? []) {
        const usados = coloresDeDato(pieza);
        const deCodigo = de.match(/\b(\d{3})\b/)?.[1] ?? usados.find((u) => { const r = referenciaPorCodigo(u.codigo); return r && palabras(r.nombreCompleto).join(" ").includes(palabras(de).join(" ")); })?.codigo;
        const actual = usados.find((u) => u.codigo === deCodigo) ?? fallar(`La pieza no usa el color «${de}». Usa: ${usados.map((u) => nombreColor(u.codigo)).join(", ")}.`);
        const nuevo = resolverColor(hacia, actual.formatos[0] ?? "R-12");
        if (nuevo.nota) notas.push(nuevo.nota);
        const hecho = reemplazarColor(pieza, actual.codigo, nuevo.codigo);
        pieza = hecho.valor;
        if (hecho.omitidos.length) notas.push(`${nombreColor(nuevo.codigo)} no viene en ${hecho.omitidos.join(", ")}: ahí se dejó ${nombreColor(actual.codigo)}`);
      }
      comprobarAltura(pieza, nodo.colocacion, escena.sala);
      const nodoNuevo: NodoEscena = { ...nodo, pieza, nombre: a.nombre ?? nodo.nombre };
      if (JSON.stringify(nodoNuevo) === JSON.stringify(nodo)) return { escena, resumen: conNotas(`«${nodo.nombre}» ya estaba así: no cambió nada.`, notas) };
      return { escena: reemplazar(escena, nodoNuevo), resumen: conNotas(`Cambié «${nodoNuevo.nombre}» (${nodo.id}): ${NOMBRE_TIPO[pieza.tipo]} ${medidasDe(pieza)}, colores ${coloresTexto(pieza)}.`, notas) };
    }

    case "quitar_pieza": {
      const a = ESQUEMAS.quitar_pieza.parse(argumentos);
      const nodo = nodoPorId(escena, a.id);
      const colgadas = [...descendientes(escena, nodo.id)].filter((x) => x !== nodo.id);
      if (a.quitar_colgadas === false || !colgadas.length) {
        const nueva = quitarNodo(escena, nodo.id);
        return { escena: nueva, resumen: `Quité «${nodo.nombre}» (${nodo.id})${colgadas.length ? `; lo que colgaba de ella (${colgadas.join(", ")}) quedó en el piso` : ""}.` };
      }
      const fuera = new Set([nodo.id, ...colgadas]);
      return { escena: { ...escena, nodos: escena.nodos.filter((n) => !fuera.has(n.id)) }, resumen: `Quité «${nodo.nombre}» (${nodo.id}) y lo que colgaba de ella (${colgadas.join(", ")}).` };
    }

    case "duplicar_pieza": {
      const a = ESQUEMAS.duplicar_pieza.parse(argumentos);
      const nodo = nodoPorId(escena, a.id);
      const antes = new Set(escena.nodos.map((n) => n.id));
      let nueva = duplicarNodo(escena, nodo.id);
      let copia = nueva.nodos.find((n) => !antes.has(n.id))!;
      if (a.donde || a.nombre) {
        const colocacion = a.donde ? colocacionDe(a.donde, nueva, copia.colocacion, copia.pieza, copia.id) : copia.colocacion;
        comprobarAltura(copia.pieza, colocacion, escena.sala);
        copia = { ...copia, colocacion, nombre: a.nombre ?? copia.nombre };
        nueva = reemplazar(nueva, copia);
      }
      return { escena: nueva, resumen: `Dupliqué «${nodo.nombre}»: la copia es «${copia.nombre}» (id ${copia.id}), ${dondeTexto(copia.colocacion, nueva)}.` };
    }

    case "poner_sobre": {
      const a = ESQUEMAS.poner_sobre.parse(argumentos);
      const armada = armarEscena(escena, CACHE_ARMADO);
      let pieza: Pieza = { tipo: "decoracion", decoracion: structuredClone(decoracionPredefinida(a.decoracion_id)) };
      if (a.colores) pieza = recolorearEnOrden(pieza, a.colores, notas);
      const colocacion = sitioSobreDescrito(escena, armada, a, pieza, null, giroNormal(a.giro_grados ?? 0));
      const id = idNuevo(escena, a.decoracion_id.replace(/_/g, "-"));
      const nombre = a.nombre ?? DECORACIONES_PREDEFINIDAS.find((d) => d.id === a.decoracion_id)?.nombre ?? "Decoración";
      const nueva = insertar(escena, { id, nombre, pieza, colocacion });
      return { escena: nueva, resumen: conNotas(`Puse «${nombre}» (id ${id}) ${describirSobre(armarEscena(nueva, CACHE_ARMADO), colocacion)}.`, notas) };
    }

    case "mover_sobre": {
      const a = ESQUEMAS.mover_sobre.parse(argumentos);
      const nodo = nodoPorId(escena, a.id);
      const armada = armarEscena(escena, CACHE_ARMADO);
      const copias = armada.porNodo.find((n) => n.id === nodo.id)?.puestas.length ?? 0;
      const repetida = nodo.colocacion.en === "ancla" && copias > 1;
      if (repetida && a.copia === undefined) fallar(`«${nodo.nombre}» está repetida en ${copias} anclas (${copiasTexto(armada, nodo.id)}). Indica copia (0 a ${copias - 1}) para mover solo esa, o usa mover_pieza para mover todo el reparto.`);
      if (a.copia !== undefined && a.copia >= Math.max(1, copias)) fallar(`«${nodo.nombre}» tiene ${copias} copia${copias === 1 ? "" : "s"}: copia va de 0 a ${Math.max(0, copias - 1)}.`);
      const giroActual = "giroGrados" in nodo.colocacion ? nodo.colocacion.giroGrados : 0;
      const colocacion = sitioSobreDescrito(escena, armada, a, nodo.pieza, nodo.id, giroNormal(a.giro_grados ?? giroActual));
      const hecho = moverCopia(escena, armada, nodo.id, a.copia ?? 0, colocacion) ?? fallar(`No pude mover «${nodo.nombre}» ahí.`);
      const movida = nodoPorId(hecho.escena, hecho.id);
      const separada = hecho.id !== nodo.id ? ` (separada del reparto de «${nodo.id}», que sigue con ${copias - 1} copias)` : "";
      return { escena: hecho.escena, resumen: `Moví «${movida.nombre}» (id ${movida.id})${separada} ${describirSobre(armarEscena(hecho.escena, CACHE_ARMADO), colocacion)}.` };
    }

    case "separar_copia": {
      const a = ESQUEMAS.separar_copia.parse(argumentos);
      const nodo = nodoPorId(escena, a.id);
      if (nodo.colocacion.en !== "ancla") fallar(`«${nodo.nombre}» no está repetida en anclas (${dondeTexto(nodo.colocacion, escena)}): ya es una pieza sola; muévela con mover_sobre.`);
      const armada = armarEscena(escena, CACHE_ARMADO);
      const copias = armada.porNodo.find((n) => n.id === nodo.id)?.puestas.length ?? 0;
      if (a.copia >= copias) fallar(`«${nodo.nombre}» tiene ${copias} copia${copias === 1 ? "" : "s"} (${copiasTexto(armada, nodo.id)}): copia va de 0 a ${Math.max(0, copias - 1)}.`);
      const hecho = separarCopia(escena, armada, nodo.id, a.copia) ?? fallar(`No pude separar la copia ${a.copia} de «${nodo.nombre}».`);
      const suelta = nodoPorId(hecho.escena, hecho.id);
      const lugar = suelta.colocacion.en === "sobre" ? describirSobre(armarEscena(hecho.escena, CACHE_ARMADO), suelta.colocacion) : "";
      const resumen = hecho.id === nodo.id
        ? `«${nodo.nombre}» tenía una sola copia: ahora va ${lugar}.`
        : `Separé la copia ${a.copia} de «${nodo.nombre}»: ahora es «${suelta.nombre}» (id ${suelta.id}), ${lugar}; «${nodo.id}» sigue con ${copias - 1} copias.`;
      return { escena: hecho.escena, resumen };
    }

    case "cambiar_sala": {
      const a = ESQUEMAS.cambiar_sala.parse(argumentos);
      const s = escena.sala;
      const hex = (v: string | undefined, que: string, previo: string) => {
        if (v === undefined) return previo;
        if (!/^#[0-9a-fA-F]{6}$/.test(v)) fallar(`${que} debe ser un color hex como #f1ece6.`);
        return v.toLowerCase();
      };
      const sala: Sala = {
        anchoCm: a.ancho_cm !== undefined ? enRango(a.ancho_cm, RANGOS.sala.ancho_cm, "ancho_cm") : s.anchoCm,
        fondoCm: a.fondo_cm !== undefined ? enRango(a.fondo_cm, RANGOS.sala.fondo_cm, "fondo_cm") : s.fondoCm,
        altoCm: a.alto_cm !== undefined ? enRango(a.alto_cm, RANGOS.sala.alto_cm, "alto_cm") : s.altoCm,
        tonos: { piso: hex(a.tono_piso, "tono_piso", s.tonos.piso), paredes: hex(a.tono_paredes, "tono_paredes", s.tonos.paredes), techo: hex(a.tono_techo, "tono_techo", s.tonos.techo) },
        mostrar: { piso: a.mostrar_piso ?? s.mostrar.piso, fondo: a.mostrar_fondo ?? s.mostrar.fondo, laterales: a.mostrar_laterales ?? s.mostrar.laterales, techo: a.mostrar_techo ?? s.mostrar.techo },
      };
      for (const n of escena.nodos) comprobarAltura(n.pieza, n.colocacion, sala);
      const nueva = { ...escena, sala };
      return { escena: nueva, resumen: `Sala: ${resumenEscena(nueva).split("\n")[0]}` };
    }
  }
}

/**
 * El sitio que describe la IA (estructura + altura + lado/ángulo + corrimiento) → colocación `sobre`. `id` es el de
 * la pieza que se pone ahí (para no ponerla sobre sí misma ni sobre lo que va encima de ella).
 */
function sitioSobreDescrito(escena: Escena, armada: EscenaArmada, a: { padre_id: string; altura_cm?: number; lado?: SitioDescrito["lado"]; angulo_grados?: number; x_cm?: number }, pieza: Pieza, id: string | null, giroGrados: number): ColocacionSobre {
  const padreNodo = nodoPorId(escena, a.padre_id);
  if (id && descendientes(escena, id).has(padreNodo.id)) fallar(`«${padreNodo.id}» es la misma pieza (o va sobre ella): elige otra estructura.`);
  const padre = armada.porNodo.find((n) => n.id === padreNodo.id);
  if (!padre || !aceptaDecoraciones(padreNodo, padre)) fallar(`«${padreNodo.nombre}» (${NOMBRE_TIPO[padreNodo.pieza.tipo]}) no sirve de lienzo: usa una columna, un arco, un aro u orgánico, una guirnalda o una pared de globos.`);
  const sitio = sitioDescrito(padre!, { alturaCm: a.altura_cm, lado: a.lado, anguloGrados: a.angulo_grados, xCm: a.x_cm }, radioLateral(pieza));
  if ("error" in sitio) return fallar(sitio.error);
  return colocacionSobre(padre!, sitio, giroGrados) ?? fallar(`«${padreNodo.nombre}» no está puesta en la sala.`);
}

/**
 * Aplica una llamada de herramienta a la escena. Nunca lanza: un nombre desconocido, argumentos que no valen o un
 * valor fuera de rango devuelven `ok: false` con la escena intacta y el motivo en español.
 */
export function aplicarHerramienta(escena: Escena, nombre: string, argumentos: unknown): ResultadoHerramienta {
  if (!(NOMBRES_HERRAMIENTAS as readonly string[]).includes(nombre)) return { ok: false, escena, error: `No existe la herramienta «${nombre}». Hay: ${NOMBRES_HERRAMIENTAS.join(", ")}.` };
  try {
    const hecho = ejecutar(escena, nombre as NombreHerramienta, argumentos ?? {});
    return { ok: true, escena: hecho.escena, resumen: hecho.resumen, consulta: hecho.consulta ?? false };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, escena, error: errorDeZod(error) };
    if (error instanceof ErrorHerramienta) return { ok: false, escena, error: error.message };
    return { ok: false, escena, error: `No se pudo aplicar ${nombre}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Los ids de las piezas, para el primer mensaje al modelo. */
export function idsDeEscena(escena: Escena): string {
  return escena.nodos.length ? escena.nodos.map((n) => `${n.id} (${n.pieza.tipo})`).join(", ") : "ninguna (sala vacía)";
}
