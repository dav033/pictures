import { z } from "zod";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { paraGoogleSchema } from "@/lib/ia/nucleo/esquema-google";
import { FORMATOS_GLOBO, NOMBRE_FAMILIA, coloresDelFormato, formatoPorId } from "./formatos";
import { OCASIONES, TIPOS_ITEM, insertarEnEscena, dentroDeSala, type TipoItem } from "./biblioteca";
import {
  ErrorHerramienta, FAMILIAS_POR_PALABRA, codigosDePedido, coloresDeDato, conAcabado, fallar, nombreColor, nombreDe, palabras, referenciaDePedido, resolverColor, resolverColorFlexible, resolverColorOrganico, resolverColores,
} from "./herramientas-escena-colores";
import {
  COLORES_FOIL, FIGURAS, FORMAS_METALIZADO, MODELOS, NOMBRE_TIPO, RANGOS_ESTRUCTURA, TECNICAS, TIPOS_ESTRUCTURA,
  ajustarOrganico, coloresOrganicosPedidos, crearEstructura, type LugarPieza,
} from "./herramientas-escena-estructuras";
import { coloresDePieza, recolorearConPaleta, recolorearConPedidos } from "./herramientas-escena-recolor";
import { IDS_SILUETA, TIPOS_FOLLAJE } from "./herramientas-escena-trazo";
import { ACCIONES_TAMANO, FORMATOS_AJUSTABLES, ajustarTamanos, esPiezaOrganica, textoConteo } from "./herramientas-escena-tamanos";
import { DESCRIPCION_EDITAR_GLOBOS, ESQUEMA_EDITAR_GLOBOS, editarGlobos } from "./herramientas-escena-editar";
import { ZONAS_ORGANICAS } from "./zonas-organicas";
import { SILUETAS_TRAZO, cajaTrazo } from "./trazo-organico";
import { buscarEnBiblioteca, describirItem, itemDeBiblioteca } from "./herramientas-escena-biblioteca";
import { DESCRIPCION_BUSCAR_EN_ESCENA, DESCRIPCION_VER_PIEZA, ESQUEMA_BUSCAR_EN_ESCENA, ESQUEMA_VER_PIEZA, buscarEnEscena, contenidoCompacto, verPieza } from "./herramientas-escena-inventario";
import { PATRONES_COLUMNA, type PatronColumna } from "./columnas";
import { PATRONES_MALLA, type PatronMalla } from "./paredes";
import type { FormaArco } from "./arcos";
import { DECORACIONES_PREDEFINIDAS, decoracionPredefinida } from "./figuras";
import { COLUMNA_QUINCE_AZUL } from "./organico-presets";
import { CATALOGO_DECORACIONES } from "./catalogo-fotos";
import { reemplazarColor } from "./recolorear";
import { nombreForma, type ColoresForma, type OpcionesForma } from "./formas";
import { opcionesArcoOrganico } from "./formas-escena";
import { COLORES_METALIZADO, PULGADAS_METALIZADO, nombreMetalizado } from "./metalizados";
import { armarPieza, type Pieza, type PiezaArmada, type TipoPieza } from "./piezas";
import { armarEscena, descendientes, duplicarNodo, idNuevo, marcoDePared, quitarNodo, NOMBRE_PARED, type Colocacion, type ColocacionSobre, type Escena, type EscenaArmada, type NodoEscena, type ParedSala, type Sala } from "./escena";
import { aceptaDecoraciones, colocacionSobre, describirSobre, moverCopia, radioLateral, separarCopia, sitioDescrito, type SitioDescrito } from "./lienzo-escena";
import { ESCENAS_PREDEFINIDAS, arcoOrganico, columnaClasica, escenaPredefinida, guirnaldaFeston, piezaNueva } from "./escenas-presets";
import { HERRAMIENTAS_EXTRA, NOMBRES_EXTRA, declaracionesExtra } from "./herramientas-escena-extra";

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
 *
 * Además (2026-10-08, lo que pidió el usuario tras probar la IA):
 * - Crear de cero cualquier estructura que el taller sabe armar (`TIPOS_ESTRUCTURA` en herramientas-escena-estructuras.ts:
 *   columna/guirnalda/semiarco/aro/marco orgánicos, pared de trenzas, formas, letras, metalizados, murales, techo,
 *   árboles, globo suelto) con sus parámetros; «columna» a secas es la clásica y `columna_organica` la orgánica.
 * - `reemplazar_pieza`: la corrección («no normales, orgánicas») en una llamada: mismo id, sitio, colores y alto.
 * - `recolorear_escena`: «todo a rojo y verde» recolorea todas (o las indicadas) respetando el patrón de cada una
 *   (herramientas-escena-recolor.ts); nunca agrega ni quita piezas.
 * - `buscar_en_biblioteca` e `insertar_de_biblioteca` (herramientas-escena-biblioteca.ts): cualquier item de la
 *   biblioteca como base, puesto como nodos normales que luego cambia `cambiar_pieza` (un orgánico se estira con
 *   alto/ancho/grosor y lo que va sobre él lo acompaña).
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

/** Todos los tipos de pieza del taller (los que puede traer una escena, también la de la biblioteca). */
export const TIPOS_PIEZA = [
  "columna", "arco", "pared_malla", "pared_trenzas", "organico", "decoracion", "arco_organico", "guirnalda", "escenografia", "globo",
  "forma", "letras", "metalizado", "mural", "techo", "arbol_globos",
] as const satisfies readonly TipoPieza[];

/** Los tipos con su pieza de partida aquí; los demás de `TIPOS_ESTRUCTURA` los arma `crearEstructura`. */
const TIPOS_CLASICOS = ["columna", "arco", "arco_organico", "guirnalda", "pared_malla", "decoracion"] as const;
type TipoClasico = (typeof TIPOS_CLASICOS)[number];
/** Todo lo que la IA puede crear de cero (y poner en lugar de otra pieza). */
const TIPOS_NUEVOS = [...TIPOS_CLASICOS, ...TIPOS_ESTRUCTURA] as const;
type TipoNuevo = (typeof TIPOS_NUEVOS)[number];
const esClasico = (t: TipoNuevo): t is TipoClasico => (TIPOS_CLASICOS as readonly string[]).includes(t);
const PATRONES_TRENZA_IDS = PATRONES_COLUMNA.map((p) => p.id);
const PATRONES_MALLA_IDS = PATRONES_MALLA.map((p) => p.id);
const PATRONES = [...PATRONES_TRENZA_IDS, ...PATRONES_MALLA_IDS.filter((p) => !(PATRONES_TRENZA_IDS as readonly string[]).includes(p))] as [string, ...string[]];
const DECORACION_IDS = DECORACIONES_PREDEFINIDAS.map((d) => d.id) as [string, ...string[]];
const PRESET_IDS = ESCENAS_PREDEFINIDAS.map((p) => p.id) as [string, ...string[]];
const CATALOGO_IDS = CATALOGO_DECORACIONES.map((d) => d.id) as [string, ...string[]];

/** Qué es cada tipo que se puede crear (para la descripción de la herramienta). */
const QUE_ES_TIPO: Readonly<Record<TipoNuevo, string>> = {
  columna: "columna CLÁSICA de cuartetos (trenza recta y lisa; NO es orgánica)",
  arco: "arco CLÁSICO de cuartetos",
  arco_organico: "arco orgánico de dos patas (globos de varios tamaños)",
  guirnalda: "guirnalda CLÁSICA (trenza de cuartetos) en festón o recta",
  pared_malla: "pared/mural de Link-O-Loon",
  decoracion: "flor/moño/estrella de globos (decoracion_id)",
  columna_organica: "columna ORGÁNICA (globos de varios tamaños, gruesa abajo; inclinacion_cm la inclina)",
  guirnalda_organica: "guirnalda ORGÁNICA (racimo de varios tamaños) en festón; va en pared",
  semiarco_organico: "semiarco orgánico (sube del piso y se curva hacia un lado)",
  aro_organico: "aro orgánico (círculo de globos, ancho_cm = diámetro)",
  marco_organico: "marco orgánico rectangular (arco cuadrado de patas rectas)",
  trazo_organico: "guirnalda ORGÁNICA de silueta libre en la pared (la de Pinterest): por «silueta» (feston, arco_pared, esquina_derecha, esquina_izquierda, semiarco_izquierdo, semiarco_derecho, arco_asimetrico, diagonal) con ancho_cm, alto_cm y grosor_cm, o por «puntos» exactos; más gruesa donde carga. TAMBIÉN las columnas orgánicas por tipo: «columna irregular» = silueta columna_recta (la silueta de una columna normal, empacada orgánica); «columna de forma libre / rara» = columna_racimos (racimos apilados que se corren a los lados), columna_s (en S) o columna_inclinada; van de pie en el piso",
  pared_trenzas: "pared de trenzas de cuartetos",
  forma: "forma de globos: figura corazon/estrella/circulo/aro/ancla/cruz/nube/castillo rellena (tecnica celdas, malla u organico), o esfera, o cono",
  letras: "letras o números de globos (texto; tecnica cuartetos, hilera o tubito)",
  metalizado: "globo metalizado de foil (forma_metalizado, texto, pulgadas, color_metalizado)",
  mural: "mural pixelado (modelo)",
  techo: "decoración de techo (modelo: festones, red de racimos, tiras, helio)",
  arbol: "palmera o árbol de globos (modelo)",
  globo: "globo suelto (formato, un color)",
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
  .describe("Colores en orden: código Sempertex («609») o nombre, con acabado si se quiere («rosado pastel», «dorado», «rojo metal», «verde reflex»). En columna, arco, guirnalda y pared_malla solo valen los que se fabrican en su formato; en lo demás, si no viene se usa el más parecido y se avisa.");

const PropiedadesSchema = z.object({
  nombre: z.string().min(1).max(60).optional().describe("Nombre visible en la lista («Columna izquierda»)"),
  formato: z.string().optional().describe("columna/arco: R-5, R-9, R-12 o R-18; guirnalda: R-5, R-9 o R-12; pared_malla: LOL-12 o LOL-6; forma: celdas R-9 por defecto, malla LOL-12, esfera/cono R-12; letras R-5; globo R-24 por defecto"),
  alto_cm: z.number().optional().describe("columna 60–500; arco 100–350; arco_organico 150–320; columna_organica 80–320; semiarco_organico 100–300; marco_organico 150–320; pared 100–300; forma 40–300; cono 40–250; letras (alto de cada letra) 20–200; arbol 100–400; una pieza orgánica que ya existe 40–400 (se estira)"),
  ancho_cm: z.number().optional().describe("arco 100–500; arco_organico (entre patas) 150–500; guirnalda y guirnalda_organica (de punta a punta) 100–800; semiarco_organico 60–300; aro_organico (diámetro) 80–300; marco_organico 120–500; pared 100–600; forma 40–300; esfera (diámetro) 30–200; una pieza orgánica que ya existe 30–800"),
  caida_cm: z.number().optional().describe("guirnalda y guirnalda_organica: cuánto cuelga en el medio, 0–150 (0 = recta)"),
  grosor_cm: z.number().optional().describe("orgánicas: diámetro del cuerpo de globos (columna_organica 30–120, 70 por defecto; guirnalda_organica 20–90; semiarco 30–110; aro 20–70; marco 30–100; arco_organico y piezas orgánicas que ya existen 20–120)"),
  inclinacion_cm: z.number().optional().describe("columna_organica: cuánto se corre la punta a la derecha (− a la izquierda), −120 a 120; 0 = recta"),
  tamanos: z.array(z.string()).max(5).optional().describe("orgánicas: SOLO estos tamaños de globo (reemplaza toda la mezcla), de R-24, R-18, R-12, R-9, R-5 (p. ej. [\"R-18\",\"R-12\",\"R-5\"]); si falta, los que caben en el grosor. Para «más/menos R-24», «un 40 % de R-18» o «R-24 solo abajo» en una pieza que ya existe usa ajustar_tamanos"),
  acabado: z.string().max(20).optional().describe("acabado para los colores que no traen uno: pastel, fashion, metal, reflex, satin, silk, neon, cristal"),
  texto: z.string().max(24).optional().describe("letras: lo que dicen («FELIZ», «ANA»); metalizado: número o letras («5», «15», «HBD»)"),
  figura: z.enum(FIGURAS).optional().describe("forma: corazon, estrella, circulo, aro, ancla, cruz, nube, castillo (rellenas), esfera o cono"),
  tecnica: z.enum(TECNICAS).optional().describe("forma rellena: celdas (por defecto), malla u organico; letras: cuartetos (por defecto), hilera o tubito"),
  forma_metalizado: z.enum(FORMAS_METALIZADO).optional().describe("metalizado: numero, letra, letras, corazon, estrella, redondo, luna, flor, nube"),
  pulgadas: z.number().optional().describe(`metalizado: ${PULGADAS_METALIZADO.join(", ")}`),
  color_metalizado: z.enum(COLORES_FOIL).optional().describe("metalizado: color del foil (o pásalo en colores y se elige el foil más parecido)"),
  modelo: z.enum(MODELOS).optional().describe("mural, techo o arbol: el modelo de partida, que luego se recolorea con colores"),
  forma: z.enum(["redondo", "parabolico", "rectangular"]).optional().describe("arco clásico"),
  patron: z.enum(PATRONES).optional().describe("trenza (columna, arco, guirnalda): un_color (1 color), dos_colores (2), espiral (4), salvavidas (bloques, 2+), zigzag (4); pared_malla: un_color, damero (2), rombos (4), franjas (4). Si falta se deduce del número de colores."),
  colores: ColoresSchema.optional(),
  pesos: z.array(z.number()).max(6).optional().describe("orgánicas (arco_organico, columna_organica, guirnalda_organica… y piezas orgánicas que ya existen) y formas: proporción de cada color 0–100, en el orden de «colores»"),
  flores: z.boolean().optional().describe("orgánicas: flores artificiales en los huecos"),
  silueta: z.enum(IDS_SILUETA).optional().describe("trazo_organico: la silueta (" + SILUETAS_TRAZO.map((x) => `${x.id} = ${x.descripcion}`).join(" ") + ")"),
  puntos: z.array(z.object({ x_cm: z.number(), y_cm: z.number().describe("altura del eje desde el piso"), grosor_cm: z.number().describe("diámetro del cuerpo de globos en ese punto, 20–140") })).min(2).max(40).optional()
    .describe("trazo_organico: en vez de silueta, el recorrido exacto en el plano de la pared (x a la derecha desde el centro de la pieza, y hacia arriba desde el piso), en orden; un extremo con y ≤ grosor/2 nace del piso"),
  follaje: z.array(z.string().min(3).max(30)).min(1).max(4).optional().describe(`trazo_organico: flores y hojas de tela entre los globos (${TIPOS_FOLLAJE.join(", ")}), con color opcional («monstera», «palma dorada», «rosa marfil», «hoja_seca beige»); el primero es el que más se ve`),
  racimos: z.number().min(0).max(1).optional().describe("trazo_organico: 0 = cuerpo parejo, 1 = muy abultado en racimos (0,35 por defecto)"),
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
    tipo: z.enum(TIPOS_NUEVOS).describe(TIPOS_NUEVOS.map((t) => `${t}: ${QUE_ES_TIPO[t]}`).join("; ")),
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
  reemplazar_pieza: PropiedadesSchema.extend({
    id: IdSchema.describe("id de la pieza que se cambia por otra"),
    tipo: z.enum(TIPOS_NUEVOS).describe("el tipo nuevo (los mismos de agregar_pieza)"),
  }),
  recolorear_escena: z.object({
    colores: ColoresSchema.optional().describe("la paleta nueva: en cada pieza, el color que más globos lleva pasa al primero, el segundo al segundo… (si la paleta es más corta, se reparte en orden y el patrón se mantiene)"),
    reemplazar: z.array(z.object({ de: z.string().min(1).max(60), a: z.string().min(1).max(60) })).max(6).optional().describe("en vez de paleta: cambia un color por otro donde aparezca («rosado» → «azul»)"),
    ids: z.array(IdSchema).max(80).optional().describe("solo estas piezas (por defecto, todas las que tienen globos)"),
    acabado: z.string().max(20).optional().describe("acabado para los colores que no traen uno (metal, pastel, reflex…)"),
  }),
  buscar_en_biblioteca: z.object({
    texto: z.string().max(80).optional().describe("lo que se busca, en palabras («arco orgánico», «columna con flores», «calabaza halloween»)"),
    tipo: z.enum(TIPOS_ITEM.map((t) => t.id) as [TipoItem, ...TipoItem[]]).optional().describe("escena (completa), conjunto (estructura con sus decoraciones), estructura (sola), decoracion, utileria"),
    ocasion: z.enum(OCASIONES as [string, ...string[]]).optional(),
    colores: z.array(z.string().min(1).max(60)).max(4).optional().describe("que lleve estos colores (nombre o código)"),
    tipo_pieza: z.enum(TIPOS_PIEZA).optional().describe("el tipo de su estructura (organico = columnas, arcos, guirnaldas y semiarcos orgánicos de las ideas)"),
    limite: z.number().int().min(1).max(15).optional().describe("cuántos (8 por defecto)"),
  }),
  ajustar_tamanos: z.object({
    id: IdSchema.describe("id de la pieza orgánica (arco orgánico, columna/guirnalda/semiarco/aro/marco orgánicos, trazo orgánico, orgánicos de la biblioteca)"),
    cambios: z.array(z.object({
      formato: z.enum(FORMATOS_AJUSTABLES).describe("tamaño de globo"),
      accion: z.enum(ACCIONES_TAMANO).describe("mas: clara subida (al menos +60 %, o hasta cantidad/porcentaje); menos: la mitad (o hasta cantidad/porcentaje); quitar: ninguno (en la zona); poner: exactamente cantidad o porcentaje"),
      cantidad: z.number().int().min(0).max(3000).optional().describe("cuántos globos de ese tamaño deben quedar al final en la zona (no cuántos sumar)"),
      porcentaje: z.number().min(0).max(95).optional().describe("qué parte (0–95 %) de los globos de estructura de la zona (sin el relleno) es de ese tamaño al final"),
      donde: z.enum(ZONAS_ORGANICAS).optional().describe("todo (por defecto); abajo/arriba = tercio de abajo/arriba de la altura; inicio/medio/fin = tercios del recorrido (en un arco, inicio = las patas)"),
      solo_ahi: z.boolean().optional().describe("con donde: ese tamaño se quita del resto de la pieza («R-24 solo abajo»)"),
    })).max(6).optional().describe("cambios de tamaños, en orden"),
    colores_por_tamano: z.array(z.object({
      formatos: z.array(z.enum(FORMATOS_AJUSTABLES)).min(1).max(6).describe("los tamaños que toman estos colores"),
      colores: ColoresSchema.describe("colores de esos tamaños (nombre o código; con acabado)"),
      pesos: z.array(z.number()).max(6).optional().describe("proporción de cada color entre esos tamaños"),
      exclusivo: z.boolean().optional().describe("true: esos colores salen de los demás tamaños («el azul solo en los R-24»)"),
    })).max(4).optional().describe("«los R-24 en azul reflex», «los grandes dorados»: esos tamaños solo con esos colores; los demás tamaños siguen con los suyos"),
    acabado: z.string().max(20).optional().describe("acabado para los colores que no traen uno"),
    densidad: z.enum(["mas", "menos"]).optional().describe("más tupida (más globos de estructura por metro, ×1,3) o menos (×0,75)"),
    densidad_factor: z.number().min(0.4).max(2.5).optional().describe("en vez de densidad: multiplica la densidad actual"),
    racimos: z.enum(["mas", "menos"]).optional().describe("más abultada (racimos que sobresalen, bultos y cinturas) o más pareja"),
    racimos_valor: z.number().min(0).max(1).optional().describe("en vez de racimos: 0 = cuerpo parejo, 1 = muy abultado"),
    engrosar: z.boolean().optional().describe("true (por defecto): si un tamaño no cabe en el cuerpo (un R-24 necesita ~60 cm de grosor), se engruesa el cuerpo donde va; false: devuelve error"),
  }),
  editar_globos: ESQUEMA_EDITAR_GLOBOS,
  insertar_de_biblioteca: z.object({
    id: z.string().min(1).max(160).describe("id del item (los da buscar_en_biblioteca)"),
    donde: DondeSchema.optional().describe("dónde va la pieza principal; si falta, donde estaba en su escena"),
    nombre: z.string().min(1).max(60).optional().describe("nombre para la pieza principal"),
  }),
  ver_pieza: ESQUEMA_VER_PIEZA,
  buscar_en_escena: ESQUEMA_BUSCAR_EN_ESCENA,
} as const;

export { resolverColor, type ColorResuelto } from "./herramientas-escena-colores";

export type NombreHerramienta = keyof typeof ESQUEMAS;
const NOMBRES_PROPIOS = Object.keys(ESQUEMAS) as NombreHerramienta[];
/** Todas: las de este archivo y las registradas en herramientas-escena-extra.ts (grupos, disposición, preguntar_usuario). */
export const NOMBRES_HERRAMIENTAS: readonly string[] = [...NOMBRES_PROPIOS, ...NOMBRES_EXTRA];

const DESCRIPCIONES: Readonly<Record<NombreHerramienta, string>> = {
  ver_escena: "Lista la sala y cada pieza de la escena: id, tipo, medidas, colores y dónde está (en las orgánicas, además, cuántos globos hay de cada tamaño y color y sus partes; en las demás, de qué formatos, colores y partes está hecha). Úsala antes de cambiar algo que ya existe.",
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
  reemplazar_pieza: "Cambia una pieza por otra de OTRO tipo en una sola llamada: mismo sitio, mismo id (lo que cuelga de ella se queda) y sus mismos colores si no se pasan otros. Para «no normales, orgánicas»: reemplazar_pieza con tipo columna_organica en cada columna.",
  recolorear_escena: "Recolorea TODAS las piezas (o las de ids) de una vez respetando el patrón de cada una, o cambia un color por otro en todo. Nunca agrega ni quita piezas. Para «todo a rojo y verde» o «cambia el rosado por azul».",
  buscar_en_biblioteca: "Busca en la Biblioteca del taller (escenas, estructuras con sus decoraciones, estructuras, decoraciones, utilería, ideas Sempertex): devuelve una lista corta con id y resumen. No cambia la escena.",
  ajustar_tamanos: "Edición PRECISA de una pieza orgánica: más/menos/quitar/poner un tamaño de globo (R-36…R-5) en toda la pieza o en una zona (abajo, arriba, inicio, medio, fin), con cantidad o porcentaje exactos; colores por tamaño («los R-24 en azul»); más o menos tupida (densidad) y abultada (racimos). Arma la pieza y devuelve cuántos globos de cada tamaño había y cuántos hay. Úsala para «más R-24», «menos globos chicos», «los grandes azules», «más tupida», «más abultada».",
  ver_pieza: DESCRIPCION_VER_PIEZA,
  buscar_en_escena: DESCRIPCION_BUSCAR_EN_ESCENA,
  editar_globos: DESCRIPCION_EDITAR_GLOBOS,
  insertar_de_biblioteca: "Pone un item de la biblioteca en la escena como piezas normales y editables (una estructura con sus decoraciones, una pieza o una escena entera). Devuelve los ids: después se cambia con cambiar_pieza (más alta, otro color, con flores…).",
};

/** Una declaración de función para Gemini (`functionDeclarations` con `parametersJsonSchema`). */
export type DeclaracionHerramienta = { name: string; description: string; parametersJsonSchema: Record<string, unknown> };

export const DECLARACIONES_ESCENA: readonly DeclaracionHerramienta[] = [
  ...NOMBRES_PROPIOS.map((nombre) => ({
    name: nombre,
    description: DESCRIPCIONES[nombre],
    parametersJsonSchema: paraGoogleSchema(z.toJSONSchema(ESQUEMAS[nombre], { target: "draft-7" })) as Record<string, unknown>,
  })),
  ...declaracionesExtra(),
];

// ----------------------------------------------------------------------------------------------------------
// Lectura de la escena
// ----------------------------------------------------------------------------------------------------------

const r0 = (n: number) => Math.round(n);

function medidasDe(p: Pieza): string {
  switch (p.tipo) {
    case "columna": return `${p.formatoId} · alto ${r0(p.alturaCm)} cm · ${p.patron}`;
    case "arco": return `${p.formatoId} · ${p.forma} · ${r0(p.anchoCm)}×${r0(p.altoCm)} cm (ancho×alto) · ${p.patron}`;
    case "arco_organico": return `${r0(p.arco.anchoCm)}×${r0(p.arco.altoCm)} cm (ancho entre patas×alto) · ${p.arco.flores ? "con flores" : "sin flores"}${conteoOrganico(p)}`;
    case "guirnalda": return `${p.guirnalda.formatoId} · ${p.guirnalda.recorrido ? "curva libre" : `largo ${r0(p.guirnalda.anchoCm)} cm, caída ${r0(p.guirnalda.caidaCm)} cm`} · ${p.guirnalda.patron}`;
    case "pared_malla": return `${p.formatoId} · ${r0(p.anchoCm)}×${r0(p.altoCm)} cm · ${p.patron}`;
    case "pared_trenzas": return `${r0(p.opciones.anchoCm)}×${r0(p.opciones.altoCm)} cm · ${p.opciones.patron}`;
    case "organico": return `${medidasCaja(p)}${p.flores ? " · con flores" : ""}${conteoOrganico(p)}`;
    case "decoracion": return `${p.decoracion.tipo}`;
    case "escenografia": return `escenografía (${p.elementos.length} elementos, sin globos)`;
    case "globo": return `${p.formatoId} · ${r0(p.infladoCm)} cm`;
    case "forma": return `${nombreForma(p.forma)} · ${medidasCaja(p)}`;
    case "letras": return `«${p.letras.texto}» · ${r0(p.letras.altoCm)} cm de alto cada letra · ${p.letras.tecnica} ${p.letras.formatoId}`;
    case "metalizado": return `${nombreMetalizado(p.metalizado)} (foil, no es látex)`;
    case "mural": return `mural ${p.mural.matriz.filas[0]?.length ?? 0}×${p.mural.matriz.filas.length} celdas · ${p.mural.disposicion} · ${p.mural.grande.formatoId}`;
    case "techo": return `techo: ${p.techo.elementos.map((e) => e.tipo).join(", ")}`;
    case "arbol_globos": return `${p.arbol.copa.tipo === "palmera" ? "palmera" : "árbol de racimos"} · tronco ${r0(p.arbol.tronco.altoCm)} cm`;
    case "modulo": return `${p.modulo} de ${p.formatoId} · ${r0(p.infladoCm)} cm`;
  }
}

/** Piezas ya armadas por su JSON (para no rehacer un arco orgánico en cada llamada que necesita la geometría). */
const CACHE_ARMADO = new Map<string, PiezaArmada>();

function armadaDe(p: Pieza): PiezaArmada {
  const clave = JSON.stringify(p);
  let armada = CACHE_ARMADO.get(clave);
  if (!armada) {
    armada = armarPieza(p);
    CACHE_ARMADO.set(clave, armada);
    while (CACHE_ARMADO.size > 300) { const primera = CACHE_ARMADO.keys().next().value; if (primera === undefined) break; CACHE_ARMADO.delete(primera); }
  }
  return armada;
}

/** Los globos de un orgánico por tamaño y color (lo que la IA necesita para «más R-24» o «los grandes azules»). */
function conteoOrganico(p: Pieza): string {
  try { return ` · ${textoConteo(armadaDe(p).materiales)}`; } catch { return ""; }
}

/** Alto y ancho de la pieza armada (lo que no tiene medidas propias: orgánicos, formas). */
function medidasCaja(p: Pieza): string {
  try {
    const { min, max } = armadaDe(p).caja;
    return `${r0(max.y - min.y)} cm de alto × ${r0(max.x - min.x)} cm de ancho`;
  } catch { return "sin medidas"; }
}

function coloresTexto(p: Pieza): string {
  if (p.tipo === "arco_organico" || p.tipo === "organico") {
    const colores = p.tipo === "arco_organico" ? p.arco.colores : p.opciones.colores;
    const total = colores.reduce((s, c) => s + c.peso, 0) || 1;
    return colores.map((c) => `${nombreColor(c.codigo)} ${Math.round((c.peso / total) * 100)}%`).join(", ");
  }
  if (p.tipo === "metalizado") return `foil ${COLORES_METALIZADO[p.metalizado.color].nombre}`;
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
    ...escena.nodos.map((n) => `- ${n.id} · «${n.nombre}» · ${n.pieza.tipo} (${NOMBRE_TIPO[n.pieza.tipo]}) · ${medidasDe(n.pieza)} · colores: ${coloresTexto(n.pieza) || "—"} · ${dondeTexto(n.colocacion, escena, armada)}${copias(n)}${contenidoCompacto(n.pieza, armadaDe)}`),
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
  if (c.en !== "piso" && c.en !== "pared") return;
  const porCaja = () => { const { min, max } = armadaDe(pieza).caja; return max.y - min.y; };
  const alto = pieza.tipo === "columna" ? pieza.alturaCm : pieza.tipo === "arco" || pieza.tipo === "pared_malla" ? pieza.altoCm : pieza.tipo === "arco_organico" ? pieza.arco.altoCm : pieza.tipo === "pared_trenzas" ? pieza.opciones.altoCm
    : pieza.tipo === "decoracion" || pieza.tipo === "escenografia" || pieza.tipo === "techo" ? 0 : porCaja();
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

/** Comprueba que una propiedad aplica a la pieza (sin tipos: solo vale al crear). */
function soloPara(props: Propiedades, campo: keyof Propiedades, tipos: readonly TipoPieza[], tipo: TipoPieza) {
  if (props[campo] === undefined || tipos.includes(tipo)) return;
  if (!tipos.length) fallar(`«${campo}» solo se usa al crear una pieza (agregar_pieza o reemplazar_pieza), no al cambiarla.`);
  fallar(`«${campo}» no aplica a una ${NOMBRE_TIPO[tipo]} (vale en: ${tipos.map((t) => NOMBRE_TIPO[t]).join(", ")}).`);
}

/** Recolorea una pieza sin lista simple de colores (decoración, pared de trenzas, mural…): sus colores en orden. */
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

/** Los colores de la pieza en su orden (la lista de una trenza tal cual, con sus repeticiones). */
function listaColores(p: Pieza): string[] {
  if (p.tipo === "columna" || p.tipo === "arco" || p.tipo === "pared_malla") return [...p.colores];
  if (p.tipo === "guirnalda") return [...p.guirnalda.colores];
  if (p.tipo === "arco_organico") return p.arco.colores.map((c) => c.codigo);
  if (p.tipo === "organico") return p.opciones.colores.map((c) => c.codigo);
  return coloresDePieza(p, "aparicion").map((c) => c.codigo);
}

/**
 * El acabado («hazla metalizada»): con colores, se le pone a los que no traen uno; sin colores, cada color de la
 * pieza pasa a su mismo tono con ese acabado (sin cambiar patrón ni pesos).
 */
function conAcabadoPedido(base: Pieza, props: Propiedades): Propiedades {
  if (!props.acabado) return props;
  if (props.colores) return { ...props, colores: props.colores.map((c) => conAcabado(c, props.acabado)) };
  const colores = listaColores(base).map((c) => `${referenciaPorCodigo(c)?.nombre ?? c} ${props.acabado}`);
  const patron = base.tipo === "columna" || base.tipo === "arco" || base.tipo === "pared_malla" ? base.patron : base.tipo === "guirnalda" ? base.guirnalda.patron : undefined;
  const pesos = base.tipo === "arco_organico" ? base.arco.colores.map((c) => c.peso) : base.tipo === "organico" ? base.opciones.colores.map((c) => c.peso) : undefined;
  return { ...props, colores, ...(patron && !props.patron ? { patron } : {}), ...(pesos && !props.pesos ? { pesos } : {}) };
}

/** Los colores pedidos para una forma, en su formato principal; el patrón se conserva si ya mezclaba. */
function coloresDeForma(f: OpcionesForma, pedidos: readonly string[], pesos: readonly number[] | undefined, notas: string[]): OpcionesForma {
  const formato = f.clase === "rellena" ? (f.tecnica.tipo === "organico" ? null : f.tecnica.formatoId) : f.clase === "esfera" ? f.globo.formatoId : f.clase === "cono" ? f.formatoId : null;
  const codigos = [...new Set(pedidos.map((c) => (formato ? resolverColorFlexible(c, [formato], notas) : resolverColorOrganico(c, notas).codigo)))];
  if (pesos && pesos.length !== codigos.length) fallar(`pesos tiene ${pesos.length} valores y colores ${codigos.length}: deben ir uno por color.`);
  const cambiar = (actual: ColoresForma): ColoresForma => ({
    ...actual, codigos,
    patron: codigos.length === 1 ? "un_color" : actual.patron === "un_color" ? "mezcla" : actual.patron,
    ...(pesos ? { pesos: pesos.map(r0) } : codigos.length > 1 && actual.patron === "un_color" ? { pesos: codigos.map(() => 1), semilla: 11 } : {}),
  });
  if (f.clase === "arbol") return { ...f, copa: { ...f.copa, colores: cambiar(f.copa.colores) } };
  if (f.clase === "aerostatico") return { ...f, globo: { ...f.globo, colores: cambiar(f.globo.colores) } };
  return { ...f, colores: cambiar(f.colores) };
}

/** Las medidas de una forma: contorno predefinido (ancho y alto), esfera (diámetro) o cono (alto). */
function medidasDeForma(f: OpcionesForma, props: Propiedades): OpcionesForma {
  if (props.alto_cm === undefined && props.ancho_cm === undefined) return f;
  const R = RANGOS_ESTRUCTURA;
  if (f.clase === "rellena" && f.contorno.tipo === "predefinido") {
    return { ...f, contorno: { ...f.contorno, ...(props.ancho_cm !== undefined ? { anchoCm: enRango(props.ancho_cm, R.forma.ancho_cm, "ancho_cm") } : {}), ...(props.alto_cm !== undefined ? { altoCm: enRango(props.alto_cm, R.forma.alto_cm, "alto_cm") } : {}) } };
  }
  if (f.clase === "esfera") return { ...f, diametroCm: enRango(props.ancho_cm ?? props.alto_cm ?? f.diametroCm, R.esfera.diametro_cm, "diámetro (ancho_cm)") };
  if (f.clase === "cono" && props.alto_cm !== undefined) return { ...f, altoCm: enRango(props.alto_cm, R.cono.alto_cm, "alto_cm") };
  return fallar("Esta forma no cambia de medida aquí (solo las figuras predefinidas, la esfera y el cono): reemplázala con reemplazar_pieza.");
}

/** El texto de un metalizado (si es de número o letras). */
function textoMetalizado(m: Extract<Pieza, { tipo: "metalizado" }>["metalizado"]): string | undefined {
  return m.forma.tipo === "numero" ? String(m.forma.valor) : m.forma.tipo === "letra" ? m.forma.valor : m.forma.tipo === "letras" ? m.forma.texto : undefined;
}

/** Aplica las propiedades pedidas a una pieza (nueva o existente). Solo cambia lo que viene. */
function aplicarPropiedades(base: Pieza, entrada: Propiedades, notas: string[]): Pieza {
  const t = base.tipo;
  soloPara(entrada, "formato", ["columna", "arco", "guirnalda", "pared_malla", "globo"], t);
  soloPara(entrada, "alto_cm", ["columna", "arco", "arco_organico", "pared_malla", "pared_trenzas", "organico", "forma", "letras", "arbol_globos"], t);
  soloPara(entrada, "ancho_cm", ["arco", "arco_organico", "guirnalda", "pared_malla", "pared_trenzas", "organico", "forma"], t);
  soloPara(entrada, "caida_cm", ["guirnalda"], t);
  soloPara(entrada, "forma", ["arco"], t);
  soloPara(entrada, "patron", ["columna", "arco", "guirnalda", "pared_malla"], t);
  soloPara(entrada, "pesos", ["arco_organico", "organico", "forma"], t);
  soloPara(entrada, "flores", ["arco_organico", "organico"], t);
  soloPara(entrada, "grosor_cm", ["arco_organico", "organico"], t);
  soloPara(entrada, "tamanos", ["arco_organico", "organico"], t);
  soloPara(entrada, "decoracion_id", ["decoracion"], t);
  soloPara(entrada, "texto", ["letras", "metalizado"], t);
  soloPara(entrada, "pulgadas", ["metalizado"], t);
  soloPara(entrada, "color_metalizado", ["metalizado"], t);
  soloPara(entrada, "forma_metalizado", ["metalizado"], t);
  for (const campo of ["figura", "tecnica", "modelo", "inclinacion_cm"] as const) soloPara(entrada, campo, [], t);
  const props = conAcabadoPedido(base, entrada);

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
      if (props.grosor_cm !== undefined) { const g = enRango(props.grosor_cm, RANGOS_ESTRUCTURA.organico.grosor_cm, "grosor_cm"); a.radioBaseCm = g / 2; a.radioPuntaCm = Math.round(g * 0.34); }
      if (props.colores) a.colores = coloresOrganicosPedidos(props.colores, props.pesos, notas);
      else if (props.pesos) {
        if (props.pesos.length !== a.colores.length) fallar(`pesos tiene ${props.pesos.length} valores y el arco ${a.colores.length} colores.`);
        a.colores = a.colores.map((c, i) => ({ ...c, peso: r0(props.pesos![i]!) }));
      }
      if (props.flores !== undefined) Object.assign(a, props.flores ? { flores: structuredClone(COLUMNA_QUINCE_AZUL.flores), huecosFlores: 14 } : { flores: null, huecosFlores: 0 });
      // Con tamaños de globo propios deja de ser el arco por medidas: pasa a pieza orgánica con esos tamaños.
      if (props.tamanos?.length) return ajustarOrganico({ tipo: "organico", opciones: opcionesArcoOrganico(a), flores: a.flores }, { tamanos: props.tamanos }, notas);
      return { ...base, arco: a };
    }
    case "organico":
      return ajustarOrganico(base, props, notas);
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
    case "forma": {
      let forma = medidasDeForma(base.forma, props);
      if (props.colores) forma = coloresDeForma(forma, props.colores, props.pesos, notas);
      else if (props.pesos) fallar("pesos va con colores en una forma.");
      return { ...base, forma };
    }
    case "letras": {
      const l = { ...base.letras };
      if (props.texto !== undefined) l.texto = props.texto.trim() || fallar("El texto de las letras no puede quedar vacío.");
      if (props.alto_cm !== undefined) l.altoCm = enRango(props.alto_cm, RANGOS_ESTRUCTURA.letras.alto_cm, "alto_cm");
      if (props.colores) {
        l.colores = [...new Set(props.colores.map((c) => resolverColorFlexible(c, [l.formatoId], notas)))];
        l.patron = l.colores.length === 1 ? "un_color" : l.patron === "un_color" ? "por_letra" : l.patron;
      }
      return { ...base, letras: l };
    }
    case "metalizado": {
      const m = base.metalizado;
      const cambiaForma = props.texto !== undefined || props.forma_metalizado !== undefined;
      const nueva = crearEstructura("metalizado", {
        texto: props.texto ?? textoMetalizado(m), forma_metalizado: props.forma_metalizado ?? (props.texto !== undefined ? undefined : m.forma.tipo),
        pulgadas: props.pulgadas ?? m.pulgadas, ...(props.color_metalizado || props.colores ? { color_metalizado: props.color_metalizado, colores: props.colores } : { color_metalizado: m.color }),
      }, notas).pieza;
      if (nueva.tipo !== "metalizado") return base;
      const cambio = cambiaForma || nueva.metalizado.pulgadas !== m.pulgadas || nueva.metalizado.color !== m.color;
      // El producto de la tienda deja de ser ese si cambian su forma, su talla o su color.
      return { ...base, metalizado: { ...m, forma: nueva.metalizado.forma, pulgadas: nueva.metalizado.pulgadas, color: nueva.metalizado.color, ...(cambio ? { producto: null } : {}) } };
    }
    case "arbol_globos": {
      let p: Pieza = base;
      if (props.alto_cm !== undefined) p = { ...base, arbol: { ...base.arbol, tronco: { ...base.arbol.tronco, altoCm: enRango(props.alto_cm, RANGOS_ESTRUCTURA.arbol.alto_cm, "alto_cm") } } };
      return props.colores ? recolorearConPaleta(p, props.colores, notas, "aparicion").pieza : p;
    }
    case "globo": {
      const g = { ...base };
      if (props.formato && props.formato !== g.formatoId) {
        g.formatoId = (formatoPorId(props.formato) ?? fallar(`El formato «${props.formato}» no existe. Formatos: ${FORMATOS_GLOBO.map((f) => f.id).join(", ")}.`)).id;
        g.infladoCm = formatoPorId(g.formatoId)!.infladoDecoracionCm;
        if (!props.colores) g.codigo = resolverColorFlexible(g.codigo, [g.formatoId], notas);
      }
      if (props.colores?.[0]) g.codigo = resolverColorFlexible(props.colores[0], [g.formatoId], notas);
      return g;
    }
    case "escenografia":
      // No es globo de látex: no tiene colores Sempertex que cambiar.
      return base;
    case "mural":
    case "techo":
      return props.colores ? recolorearEnOrden(base, props.colores, notas) : base;
    case "modulo": {
      if (!props.colores?.length) return base;
      const pedidos = props.colores.map((c) => resolverColorFlexible(c, [base.formatoId], notas));
      return { ...base, colores: base.colores.map((_, i) => pedidos[i % pedidos.length]!) };
    }
  }
}

/** La pieza de partida de cada tipo clásico (la de «Añadir», con los valores del preset del dueño). */
function piezaBase(tipo: TipoClasico): Pieza {
  switch (tipo) {
    case "columna": return columnaClasica();
    case "arco": return piezaNueva("arco").pieza;
    case "arco_organico": return arcoOrganico();
    case "guirnalda": return guirnaldaFeston(300, 30);
    case "pared_malla": return piezaNueva("pared").pieza;
    case "decoracion": return piezaNueva("decoracion").pieza;
  }
}

const NOMBRE_BASE: Readonly<Record<TipoClasico, string>> = {
  columna: "Columna", arco: "Arco", arco_organico: "Arco orgánico", guirnalda: "Guirnalda", pared_malla: "Pared de globos", decoracion: "Flor de globos",
};

/** Una pieza nueva de cualquier tipo que la IA puede crear, con lo pedido, su nombre y dónde suele ir. */
function crearPieza(tipo: TipoNuevo, props: Propiedades, notas: string[]): { pieza: Pieza; nombre: string; lugar: LugarPieza } {
  if (esClasico(tipo)) {
    const pieza = aplicarPropiedades(piezaBase(tipo), props, notas);
    const lugar: LugarPieza = tipo === "decoracion" ? "techo" : tipo === "guirnalda" || tipo === "pared_malla" ? "pared" : "piso";
    return { pieza, nombre: NOMBRE_BASE[tipo], lugar };
  }
  for (const campo of ["patron", "forma", "decoracion_id"] as const) if (props[campo] !== undefined) fallar(`«${campo}» no aplica a ${tipo} (vale en ${campo === "decoracion_id" ? "decoracion" : campo === "forma" ? "arco" : "columna, arco, guirnalda o pared_malla"}).`);
  return crearEstructura(tipo, props, notas);
}

/** Alto (y ancho de arco a arco) que la pieza nueva toma de la que reemplaza, si no se piden y caben en su rango. */
const RANGO_ALTO_REEMPLAZO: Partial<Record<TipoNuevo, Rango>> = {
  columna: RANGOS.columna.alto_cm, arco: RANGOS.arco.alto_cm, arco_organico: RANGOS.arco_organico.alto_cm, columna_organica: RANGOS_ESTRUCTURA.columna_organica.alto_cm,
  semiarco_organico: RANGOS_ESTRUCTURA.semiarco_organico.alto_cm, marco_organico: RANGOS_ESTRUCTURA.marco_organico.alto_cm,
};
const RANGO_ANCHO_ARCO: Partial<Record<TipoNuevo, Rango>> = { arco: RANGOS.arco.ancho_cm, arco_organico: RANGOS.arco_organico.ancho_cm, marco_organico: RANGOS_ESTRUCTURA.marco_organico.ancho_cm };

function medidasHeredadas(vieja: Pieza, a: { tipo: TipoNuevo; alto_cm?: number; ancho_cm?: number }): Partial<Propiedades> {
  const salida: Partial<Propiedades> = {};
  const dentro = (v: number, r: Rango | undefined) => (r && v >= r[0] && v <= r[1] ? r0(v) : undefined);
  if (a.alto_cm === undefined && RANGO_ALTO_REEMPLAZO[a.tipo]) {
    const alto = vieja.tipo === "columna" ? vieja.alturaCm : vieja.tipo === "arco" ? vieja.altoCm : vieja.tipo === "arco_organico" ? vieja.arco.altoCm : (() => { try { const { min, max } = armadaDe(vieja).caja; return max.y - min.y; } catch { return NaN; } })();
    const v = dentro(alto, RANGO_ALTO_REEMPLAZO[a.tipo]);
    if (v !== undefined) salida.alto_cm = v;
  }
  const anchoViejo = vieja.tipo === "arco" ? vieja.anchoCm : vieja.tipo === "arco_organico" ? vieja.arco.anchoCm : undefined;
  if (a.ancho_cm === undefined && anchoViejo !== undefined) {
    const v = dentro(anchoViejo, RANGO_ANCHO_ARCO[a.tipo]);
    if (v !== undefined) salida.ancho_cm = v;
  }
  return salida;
}

/** Dónde va por defecto una pieza nueva según su lugar (la de «Añadir» del panel). */
function colocacionDeLugar(lugar: LugarPieza, pieza: Pieza): Colocacion {
  if (lugar === "techo") return { en: "techo", xCm: 0, zCm: 0, cuelgaCm: pieza.tipo === "decoracion" ? 60 : 0, giroGrados: 0, volteada: pieza.tipo === "decoracion" };
  if (lugar === "pared") {
    // El trazo trae su altura (sus puntos van desde el piso); las de pared (por silueta) cuelgan a 1,3 m.
    if (pieza.tipo === "organico" && pieza.generador?.tipo === "trazo") return { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: Math.round(cajaTrazo(pieza.generador.trazo).minY) };
    return { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: pieza.tipo === "guirnalda" || (pieza.tipo === "organico" && !pieza.opciones.suelo) ? 180 : pieza.tipo === "letras" ? 80 : 0 };
  }
  return { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 };
}

// ----------------------------------------------------------------------------------------------------------
// Aplicar una llamada
// ----------------------------------------------------------------------------------------------------------

export type ResultadoHerramienta =
  | { ok: true; escena: Escena; resumen: string; consulta: boolean }
  | { ok: false; escena: Escena; error: string };

/**
 * Lo que va SOBRE una pieza tiene su punto en el espacio de ella: si ella cambia de medida (más alta, más gruesa, otra
 * forma), ese punto se lleva a la misma posición relativa de su caja (el R-24 de la punta sigue en la punta).
 */
function reubicarSobre(escena: Escena, id: string, vieja: Pieza, nueva: Pieza): Escena {
  if (!escena.nodos.some((n) => n.colocacion.en === "sobre" && n.colocacion.padreId === id)) return escena;
  let antes: PiezaArmada["caja"], despues: PiezaArmada["caja"];
  try { antes = armadaDe(vieja).caja; despues = armadaDe(nueva).caja; } catch { return escena; }
  const eje = (v: number, k: "x" | "y" | "z") => {
    const largo = antes.max[k] - antes.min[k];
    return largo > 1 ? Math.round((despues.min[k] + ((v - antes.min[k]) * (despues.max[k] - despues.min[k])) / largo) * 10) / 10 : v;
  };
  return {
    ...escena,
    nodos: escena.nodos.map((n) => {
      const c = n.colocacion;
      if (c.en !== "sobre" || c.padreId !== id) return n;
      return { ...n, colocacion: { ...c, puntoCm: { x: eje(c.puntoCm.x, "x"), y: eje(c.puntoCm.y, "y"), z: eje(c.puntoCm.z, "z") } } };
    }),
  };
}

/** Máximo de piezas de una escena (las de la biblioteca traen varias). */
export const MAX_NODOS = 150;

/** ¿El código es el color que se nombra («rosado» → Pastel Mate Rosado)? */
function usaColor(codigo: string, de: string): boolean {
  if (de.match(/\b(\d{3})\b/)?.[1] === codigo) return true;
  const r = referenciaPorCodigo(codigo);
  return !!r && palabras(r.nombreCompleto).join(" ").includes(palabras(de).join(" "));
}

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

    case "ver_pieza":
      return { escena, resumen: verPieza(escena, ESQUEMAS.ver_pieza.parse(argumentos).id, armadaDe), consulta: true };

    case "buscar_en_escena":
      return { escena, resumen: buscarEnEscena(escena, ESQUEMAS.buscar_en_escena.parse(argumentos), armadaDe), consulta: true };

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
      if (escena.nodos.length >= MAX_NODOS) fallar(`La escena ya tiene ${escena.nodos.length} piezas (máximo ${MAX_NODOS}).`);
      const hecho = crearPieza(a.tipo, a, notas);
      const pieza = hecho.pieza;
      const id = idNuevo(escena, a.tipo.replace(/_/g, "-"));
      const colocacion = a.donde ? colocacionDe(a.donde, escena, null, pieza, id) : colocacionDeLugar(hecho.lugar, pieza);
      comprobarAltura(pieza, colocacion, escena.sala);
      const nodo: NodoEscena = { id, nombre: a.nombre ?? hecho.nombre, pieza, colocacion };
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
        const deCodigo = de.match(/\b(\d{3})\b/)?.[1] ?? usados.find((u) => usaColor(u.codigo, de))?.codigo;
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
      return { escena: reubicarSobre(reemplazar(escena, nodoNuevo), nodo.id, nodo.pieza, pieza), resumen: conNotas(`Cambié «${nodoNuevo.nombre}» (${nodo.id}): ${NOMBRE_TIPO[pieza.tipo]} ${medidasDe(pieza)}, colores ${coloresTexto(pieza)}.`, notas) };
    }

    case "ajustar_tamanos": {
      const a = ESQUEMAS.ajustar_tamanos.parse(argumentos);
      const nodo = nodoPorId(escena, a.id);
      const organica = esPiezaOrganica(nodo.pieza) ? nodo.pieza : fallar(`«${nodo.nombre}» es ${NOMBRE_TIPO[nodo.pieza.tipo]}: ajustar_tamanos es para piezas orgánicas (de varios tamaños). Para las demás usa cambiar_pieza.`);
      const hecho = ajustarTamanos(organica, a, notas);
      comprobarAltura(hecho.pieza, nodo.colocacion, escena.sala);
      const nodoNuevo: NodoEscena = { ...nodo, pieza: hecho.pieza };
      return { escena: reubicarSobre(reemplazar(escena, nodoNuevo), nodo.id, nodo.pieza, hecho.pieza), resumen: conNotas(`Ajusté «${nodo.nombre}» (${nodo.id}): ${hecho.resumen}`, notas) };
    }

    case "editar_globos": {
      const hecho = editarGlobos(escena, argumentos);
      let nueva = hecho.escena;
      for (const { nodo, nueva: pieza } of hecho.editadas) {
        comprobarAltura(pieza, nodo.colocacion, escena.sala);
        nueva = reubicarSobre(nueva, nodo.id, nodo.pieza, pieza);
      }
      return { escena: nueva, resumen: hecho.resumen };
    }

    case "reemplazar_pieza": {
      const a = ESQUEMAS.reemplazar_pieza.parse(argumentos);
      const nodo = nodoPorId(escena, a.id);
      // Sin colores pedidos, la nueva hereda los de la vieja (las orgánicas, con pesos por cuántos globos llevaba).
      const viejos = nodo.pieza.tipo === "metalizado" || nodo.pieza.tipo === "escenografia" ? [] : coloresDePieza(nodo.pieza, "uso").slice(0, 6);
      const hereda = !a.colores && viejos.length > 0;
      const organica = ["arco_organico", "columna_organica", "guirnalda_organica", "semiarco_organico", "aro_organico", "marco_organico"].includes(a.tipo);
      const conColores: Propiedades = hereda && organica ? { ...a, colores: viejos.map((c) => c.codigo), pesos: viejos.map((c) => Math.max(1, c.cantidad)) } : a;
      const hecho = crearPieza(a.tipo, { ...conColores, ...medidasHeredadas(nodo.pieza, a) }, notas);
      let pieza = hecho.pieza;
      if (hereda && !organica) pieza = recolorearConPaleta(pieza, viejos.map((c) => c.codigo), notas, "uso").pieza;
      // El mismo sitio: si la nueva va en otra superficie (una guirnalda en la pared), a la misma altura de la sala.
      const c = nodo.colocacion;
      const mismoSitio = c.en === hecho.lugar || c.en === "ancla" || c.en === "sobre" || c.en === "libre";
      let colocacion: Colocacion = mismoSitio ? c : colocacionDeLugar(hecho.lugar, pieza);
      if (!mismoSitio && c.en === "piso" && colocacion.en === "pared") colocacion = { ...colocacion, aLoLargoCm: Math.max(-escena.sala.anchoCm / 2, Math.min(escena.sala.anchoCm / 2, c.xCm)) };
      if (!mismoSitio && c.en === "pared" && colocacion.en === "piso") colocacion = c.pared === "fondo" ? { ...colocacion, xCm: c.aLoLargoCm, zCm: r0(-escena.sala.fondoCm / 2 + 100) } : colocacion;
      comprobarAltura(pieza, colocacion, escena.sala);
      const resto = nodo.nombre.replace(/^(columna|arco|guirnalda|pared|flor|semiarco|aro|marco)(\s+(de globos|de cuartetos|clásica|clásico|orgánica|orgánico|normal))?\b/i, "").trim();
      const nombre = a.nombre ?? (resto ? `${hecho.nombre} ${resto}` : hecho.nombre);
      const colgadas = escena.nodos.filter((n) => (n.colocacion.en === "ancla" || n.colocacion.en === "sobre") && n.colocacion.padreId === nodo.id).map((n) => n.id);
      if (colgadas.length) notas.push(`lo que va en ella (${colgadas.join(", ")}) sigue con ella; revisa que encaje`);
      const nodoNuevo: NodoEscena = { id: nodo.id, nombre, pieza, colocacion };
      const nueva = reubicarSobre(reemplazar(escena, nodoNuevo), nodo.id, nodo.pieza, pieza);
      return { escena: nueva, resumen: conNotas(`Cambié «${nodo.nombre}» (${NOMBRE_TIPO[nodo.pieza.tipo]}) por «${nombre}» (mismo id ${nodo.id}): ${NOMBRE_TIPO[pieza.tipo]} ${medidasDe(pieza)}, colores ${coloresTexto(pieza)}, ${dondeTexto(colocacion, nueva)}.`, notas) };
    }

    case "recolorear_escena": {
      const a = ESQUEMAS.recolorear_escena.parse(argumentos);
      if (!a.colores && !a.reemplazar?.length) fallar("Pasa colores (la paleta nueva) o reemplazar (de → a).");
      for (const id of a.ids ?? []) nodoPorId(escena, id);
      const paleta = a.colores?.map((c) => conAcabado(c, a.acabado));
      for (const c of [...(paleta ?? []), ...(a.reemplazar ?? []).map((r) => r.a)]) if (!referenciaDePedido(c)) fallar(`No encontré el color «${c}» en la tabla Sempertex.`);
      const reglas = (a.reemplazar ?? []).map((r) => ({ de: r.de, codigos: codigosDePedido(r.de), a: conAcabado(r.a, a.acabado) }));
      const regla = (viejo: string) => reglas.find((r) => r.codigos.includes(viejo) || usaColor(viejo, r.de))?.a ?? null;
      let nodos = escena.nodos;
      const hechas: string[] = [];
      for (const n of escena.nodos) {
        if (a.ids && !a.ids.includes(n.id)) continue;
        const r = paleta ? recolorearConPaleta(n.pieza, paleta, notas, "uso")
          : n.pieza.tipo === "metalizado" ? { pieza: n.pieza, cambios: 0, detalle: [] } : recolorearConPedidos(n.pieza, regla, notas);
        if (!r.cambios) continue;
        nodos = nodos.map((x) => (x.id === n.id ? { ...x, pieza: r.pieza } : x));
        hechas.push(`${n.id}: ${r.detalle.slice(0, 4).join(", ")}`);
      }
      if (!hechas.length) {
        if (a.reemplazar?.length) fallar(`Ninguna pieza ${a.ids ? "de esas " : ""}usa ${a.reemplazar.map((r) => `«${r.de}»`).join(" ni ")}. Mira los colores con ver_escena.`);
        return { escena, resumen: "Ya tenían esos colores: no cambió nada." };
      }
      const unicas = [...new Set(notas)];
      notas.length = 0;
      notas.push(...unicas.slice(0, 6));
      return { escena: { ...escena, nodos }, resumen: conNotas(`Recoloreé ${hechas.length} pieza${hechas.length === 1 ? "" : "s"} sin agregar ni quitar nada (${escena.nodos.length} piezas en la escena): ${hechas.join(" | ")}.`, notas) };
    }

    case "buscar_en_biblioteca": {
      const a = ESQUEMAS.buscar_en_biblioteca.parse(argumentos);
      const colores = a.colores?.map((c) => { const codigos = codigosDePedido(c); return codigos.length ? codigos : fallar(`No encontré el color «${c}» en la tabla Sempertex.`); });
      const lista = buscarEnBiblioteca({ texto: a.texto, tipo: a.tipo, ocasion: a.ocasion, colores, tipoPieza: a.tipo_pieza, limite: a.limite });
      return {
        escena, consulta: true,
        resumen: lista.length ? `${lista.length} de la biblioteca (ponlo con insertar_de_biblioteca y su id):\n${lista.map(describirItem).join("\n")}` : "No hay nada en la biblioteca con eso: prueba con menos palabras, sin filtros o con otro tipo.",
      };
    }

    case "insertar_de_biblioteca": {
      const a = ESQUEMAS.insertar_de_biblioteca.parse(argumentos);
      const item = itemDeBiblioteca(a.id) ?? fallar(`No hay ningún item «${a.id}» en la biblioteca: búscalo con buscar_en_biblioteca y usa el id que da.`);
      const c = item.contenido;
      // Una escena entera en una sala vacía trae también su sala; si no, sus piezas se ajustan a la sala de ahora.
      const base: Escena = c.tipo === "escena" && escena.nodos.length === 0 ? { ...escena, sala: structuredClone(c.escena.sala) } : escena;
      const raizPieza = c.tipo === "conjunto" ? c.conjunto.raiz.pieza : c.tipo === "pieza" ? c.pieza : null;
      if (a.donde && !raizPieza) notas.push("una escena entera va con sus posiciones: «donde» no se usó");
      const donde = a.donde && raizPieza ? colocacionDe(a.donde, base, null, raizPieza, null) : undefined;
      const hecho = insertarEnEscena(base, item, donde);
      const nuevos = new Set(hecho.ids);
      let nodos = hecho.escena.nodos.map((n) => (nuevos.has(n.id) && (n.colocacion.en === "piso" || n.colocacion.en === "pared" || n.colocacion.en === "techo" || n.colocacion.en === "libre") ? { ...n, colocacion: dentroDeSala(n.colocacion, base.sala) } : n));
      if (a.nombre && hecho.raizId) nodos = nodos.map((n) => (n.id === hecho.raizId ? { ...n, nombre: a.nombre! } : n));
      if (nodos.length > MAX_NODOS) fallar(`La escena quedaría con ${nodos.length} piezas y el máximo es ${MAX_NODOS}: quita algo antes o elige un item más chico (una estructura en vez de la escena entera).`);
      for (const n of nodos) if (nuevos.has(n.id)) comprobarAltura(n.pieza, n.colocacion, base.sala);
      const nueva: Escena = { ...base, nodos };
      const raiz = nodos.find((n) => n.id === hecho.raizId);
      const otros = hecho.ids.filter((id) => id !== hecho.raizId);
      const principal = raiz ? `Principal: ${raiz.id} · «${raiz.nombre}» · ${NOMBRE_TIPO[raiz.pieza.tipo]} · ${medidasDe(raiz.pieza)} · colores ${coloresTexto(raiz.pieza)} · ${dondeTexto(raiz.colocacion, nueva)}.` : "";
      const lista = otros.length ? ` Con ella: ${otros.slice(0, 14).map((id) => { const n = nodos.find((x) => x.id === id)!; return `${id} (${n.pieza.tipo})`; }).join(", ")}${otros.length > 14 ? ` y ${otros.length - 14} más` : ""}.` : "";
      const sala = base !== escena ? " Tomé también su sala." : "";
      return { escena: nueva, resumen: conNotas(`Puse de la biblioteca «${item.nombre}» (${item.id}) como ${hecho.ids.length} pieza${hecho.ids.length === 1 ? "" : "s"} normales y editables.${sala} ${principal}${lista} Para cambiarla usa cambiar_pieza con su id.`, notas) };
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
  if (!NOMBRES_HERRAMIENTAS.includes(nombre)) return { ok: false, escena, error: `No existe la herramienta «${nombre}». Hay: ${NOMBRES_HERRAMIENTAS.join(", ")}.` };
  try {
    const extra = HERRAMIENTAS_EXTRA[nombre];
    const hecho = extra ? extra.aplicar(escena, argumentos ?? {}) : ejecutar(escena, nombre as NombreHerramienta, argumentos ?? {});
    return { ok: true, escena: hecho.escena, resumen: hecho.resumen, consulta: hecho.consulta ?? false };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, escena, error: errorDeZod(error) };
    if (error instanceof ErrorHerramienta) return { ok: false, escena, error: error.message };
    return { ok: false, escena, error: `No se pudo aplicar ${nombre}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Los ids de las piezas, para el primer mensaje al modelo. */
export function idsDeEscena(escena: Escena): string {
  return escena.nodos.length ? escena.nodos.map((n) => `${n.id} (${NOMBRE_TIPO[n.pieza.tipo]}, «${n.nombre}»)`).join(", ") : "ninguna (sala vacía)";
}
