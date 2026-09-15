import { UBICACIONES, type Ubicacion } from "./composicion";
import { esParLateral } from "./ubicaciones";
import { ESTRUCTURAS_OFICIALES, identificarEstructuraOficial, UBICACION_PARA_CLIENTE, type EstructuraOficialId } from "./estructuras-oficiales";
import { ambientDecorSelection } from "@/lib/ia/reference-structure";
import type { ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import { clasificarAcabados, type PALETA_COLORES_V2 } from "@/lib/rag/taxonomy/v2";

/**
 * Textos de la tarjeta del plan para el cliente final (C2,
 * docs/mejoras/PLAN-ESTRUCTURAS-Y-UX.md): sin `estructura_id`, sin códigos de
 * tamaño sueltos, sin slugs ni inglés y sin repetir una misma sustitución por
 * instancia. Solo presentación: los nombres de estructura salen de
 * `estructuras-oficiales.ts` y las cantidades del `PlanResuelto`; aquí no se
 * decide nada comercial. Puro: sin React. El modo dev sigue mostrando los
 * datos crudos.
 */

const NUMERO = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

function unirNatural(partes: readonly string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

function minusculaInicial(texto: string): string {
  return texto ? `${texto.charAt(0).toLowerCase()}${texto.slice(1)}` : texto;
}

/** "1 globo", "3 globos". */
export function contar(cantidad: number, singular: string, plural: string): string {
  return `${NUMERO.format(cantidad)} ${cantidad === 1 ? singular : plural}`;
}

/** "R-24" → "24 pulgadas"; un código sin número se deja tal cual. */
export function pulgadasCliente(tamano: string): string {
  const numero = /(\d+(?:[.,]\d+)?)/.exec(tamano)?.[1];
  return numero ? `${numero} pulgadas` : tamano;
}

/** "globos de 5, 9 y 12 pulgadas"; null sin tamaños. */
export function tamanosCliente(mezcla: ReadonlyArray<{ diam_pulg: number }>): string | null {
  const tamanos = [...new Set(mezcla.map((linea) => linea.diam_pulg))].sort((a, b) => a - b);
  if (!tamanos.length) return null;
  return `globos de ${unirNatural(tamanos.map((valor) => NUMERO.format(valor)))} pulgadas`;
}

/** "2,2 m". */
export function metrosCliente(valor: number): string {
  return `${NUMERO.format(valor)} m`;
}

/** "12,7 cm". */
export function centimetrosCliente(valor: number): string {
  return `${NUMERO.format(valor)} cm`;
}

/** "R-5" y 12,7 → "5 pulgadas (12,7 cm)"; sin centímetros, solo las pulgadas. */
export function pulgadasConCentimetrosCliente(tamano: string, diamCm: number | null | undefined): string {
  const pulgadas = pulgadasCliente(tamano);
  return diamCm != null ? `${pulgadas} (${centimetrosCliente(diamCm)})` : pulgadas;
}

/** En arcos, semiarcos y columnas `largo_m` es la profundidad de la estructura, no un largo. */
const TIPOS_LARGO_ES_FONDO = new Set(["arco", "semiarco", "columna"]);

/** Medidas con su dimensión en palabras: "2,4 m de ancho × 2,2 m de alto". */
export function medidasCliente(tipo: string, medidas: { ancho_m?: number; alto_m?: number; largo_m?: number } | undefined): string | null {
  if (!medidas) return null;
  // Una guirnalda se describe y se calcula por su largo (geometria.ts: largo || ancho);
  // "1,5 m de ancho × 3,5 m de largo × 0,4 m de alto" confundía sobre una mesa.
  if (tipo === "guirnalda") {
    const largo = medidas.largo_m ?? medidas.ancho_m;
    return largo != null ? `${metrosCliente(largo)} de largo` : null;
  }
  const partes: string[] = [];
  if (medidas.ancho_m != null) partes.push(`${metrosCliente(medidas.ancho_m)} de ${tipo === "centro_mesa" ? "diámetro" : "ancho"}`);
  if (medidas.largo_m != null) partes.push(`${metrosCliente(medidas.largo_m)} de ${TIPOS_LARGO_ES_FONDO.has(tipo) ? "fondo" : "largo"}`);
  if (medidas.alto_m != null) partes.push(`${metrosCliente(medidas.alto_m)} de alto`);
  return partes.length ? partes.join(" × ") : null;
}

const TIPOS_CON_GLOBOS = new Set(["arco", "semiarco", "guirnalda", "columna", "pared", "centro_mesa"]);

/** Tipos que el backend mide en globos; el resto (telón, kit, accesorio) son piezas. */
export function esEstructuraDeGlobos(tipo: string): boolean {
  return TIPOS_CON_GLOBOS.has(tipo);
}

/** "unos 120 globos", "2 iguales · unos 40 globos cada una". */
export function cantidadCliente(total: number, repeticiones: number, tipo: string): string {
  const [singular, plural] = esEstructuraDeGlobos(tipo) ? ["globo", "globos"] : ["pieza", "piezas"];
  const veces = Math.max(1, repeticiones);
  if (veces === 1) return total === 1 ? contar(total, singular, plural) : `unos ${contar(total, singular, plural)}`;
  const base = Math.floor(total / veces);
  const resto = total % veces;
  const cada = resto === 0 ? contar(base, singular, plural) : `${NUMERO.format(base)} o ${contar(base + 1, singular, plural)}`;
  return `${veces} iguales · unos ${cada} cada una`;
}

type Genero = "m" | "f";

/** Artículo y plural de cada nombre oficial; completo por tipo para no olvidar ninguno. */
const GRAMATICA_OFICIAL: Readonly<Record<EstructuraOficialId, { genero: Genero; plural: string }>> = {
  arco: { genero: "m", plural: "arcos" },
  arco_asimetrico: { genero: "m", plural: "arcos asimétricos" },
  arco_no_denso: { genero: "m", plural: "arcos no densos" },
  semiarco: { genero: "m", plural: "semiarcos" },
  semiarco_asimetrico: { genero: "m", plural: "semiarcos asimétricos" },
  columna: { genero: "f", plural: "columnas" },
  columna_asimetrica: { genero: "f", plural: "columnas asimétricas" },
  columna_no_densa: { genero: "f", plural: "columnas no densas" },
  pared_densa: { genero: "f", plural: "paredes de globos densas" },
  pared_no_densa: { genero: "f", plural: "paredes de globos no densas" },
  guirnalda: { genero: "f", plural: "guirnaldas" },
  centro_mesa: { genero: "m", plural: "centros de mesa con globos" },
  bouquet: { genero: "m", plural: "bouquets de globos" },
  figura: { genero: "f", plural: "figuras con globos" },
  aro_circular: { genero: "m", plural: "aros circulares" },
  techo_globos: { genero: "m", plural: "techos de globos" },
};

const CARDINALES = ["", "", "dos", "tres", "cuatro", "cinco", "seis"];

export type EstructuraParaDescribir = {
  oficialId?: EstructuraOficialId;
  nombre: string;
  ubicacion: string;
  repeticiones: number;
};

function esUbicacion(valor: string): valor is Ubicacion {
  return (UBICACIONES as readonly string[]).includes(valor);
}

/** Ubicación legible: un par lateral va a ambos lados (regla dueña en `ubicaciones.ts`). */
export function ubicacionCliente(estructura: { ubicacion: string; repeticiones: number }): string {
  const { ubicacion, repeticiones } = estructura;
  if (esUbicacion(ubicacion) && esParLateral({ ubicacion, repeticiones })) return "a ambos lados";
  return UBICACION_PARA_CLIENTE[ubicacion] ?? "en el espacio";
}

/**
 * "un semiarco asimétrico a la derecha", "las dos columnas a ambos lados".
 * Una pieza sin estructura oficial (telón, kit) usa el nombre del plan sin
 * artículo porque su género no se puede deducir.
 */
export function describirEstructuraCliente(estructura: EstructuraParaDescribir, articulo: "definido" | "indefinido"): string {
  const ubicacion = ubicacionCliente(estructura);
  const veces = Math.max(1, estructura.repeticiones);
  if (!estructura.oficialId) return `${minusculaInicial(estructura.nombre.trim())} ${ubicacion}`;
  const oficial = ESTRUCTURAS_OFICIALES[estructura.oficialId];
  const gramatica = GRAMATICA_OFICIAL[estructura.oficialId];
  if (veces > 1) {
    const cantidad = CARDINALES[veces] ?? String(veces);
    const determinante = articulo === "definido" ? `${gramatica.genero === "f" ? "las" : "los"} ` : "";
    return `${determinante}${cantidad} ${gramatica.plural} ${ubicacion}`;
  }
  const determinante = articulo === "definido" ? (gramatica.genero === "f" ? "la" : "el") : gramatica.genero === "f" ? "una" : "un";
  return `${determinante} ${minusculaInicial(oficial.nombre)} ${ubicacion}`;
}

/** Colores del catálogo en palabras del cliente (la paleta ya está en español). */
const NOMBRE_COLOR: ReadonlyMap<string, string> = new Map<(typeof PALETA_COLORES_V2)[number], string>([
  ["dorado rosa", "oro rosa"],
  ["cafe", "café"],
  ["champagne", "champán"],
]);

export function nombreColorCliente(color: string): string {
  const clave = color.trim().toLowerCase();
  return NOMBRE_COLOR.get(clave) ?? clave;
}

/**
 * Muestra visual por color de la paleta del catálogo. Aproximación de
 * pantalla, no un color de fabricante: sirve para reconocer la paleta.
 */
const MUESTRA_HEX_PALETA: Readonly<Record<(typeof PALETA_COLORES_V2)[number], string>> = {
  dorado: "#c9a227",
  "dorado rosa": "#d4a59a",
  plateado: "#b8bcc4",
  rojo: "#d32f2f",
  azul: "#1f4fbf",
  rosado: "#f2a7c3",
  verde: "#2e9d57",
  blanco: "#ffffff",
  negro: "#1b1b1b",
  morado: "#7b3fa0",
  naranja: "#f28c28",
  amarillo: "#f5d33a",
  fucsia: "#d6247a",
  transparente: "#ffffff",
  multicolor: "#ffffff",
  lila: "#c7a4e0",
  turquesa: "#1fb5b0",
  beige: "#e6d3b3",
  cafe: "#7a4b2a",
  champagne: "#e8d3a2",
  violeta: "#8a4fd1",
  coral: "#f6765e",
  menta: "#a6e3c8",
  crema: "#f6ecd2",
  nude: "#e0b89c",
  burdeos: "#7d1d34",
};
const MUESTRA_HEX: ReadonlyMap<string, string> = new Map(Object.entries(MUESTRA_HEX_PALETA));

/** Acabado del catálogo en palabras del cliente. */
const ACABADO_CLIENTE: Readonly<Record<string, string>> = {
  reflex: "cromado",
  metal: "metalizado",
  metalizado: "metalizado",
  perlado: "perlado",
  satin: "satinado",
  fashion: "mate",
  mate: "mate",
  transparente: "transparente",
};

/** Acabado legible de una línea; si el catálogo no lo trae, se lee del nombre del producto. */
export function acabadoCliente(acabado: string | null | undefined, titulo?: string): string | null {
  const directo = acabado ? ACABADO_CLIENTE[acabado.trim().toLowerCase()] : undefined;
  if (directo) return directo;
  const inferido = titulo ? clasificarAcabados(titulo) : undefined;
  const valor = inferido?.status === "known" ? inferido.values[0] : undefined;
  return valor ? ACABADO_CLIENTE[valor] ?? null : null;
}

export type MuestraColor = {
  /** Color canónico del catálogo. */
  color: string;
  /** "azul cromado", "blanco mate". */
  etiqueta: string;
  /** Valor CSS de `background` para el círculo. */
  fondo: string;
  /** Colores claros o transparentes necesitan borde para verse. */
  conBorde: boolean;
};

const PALABRAS_NO_TONO = new Set(["fashion", "reflex", "pastel", "mate", "satin", "metal", "metalizado", "perlado", "silk", "cristal", "neon", "dusk", "globo", "latex", "redondo", "paquete", "x"]);

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Tono del producto a partir de su título: "Globo Latex Redondo Fashion Verde
 * Selva" con color verde → "verde selva". Regresión (2026-09-14): dos verdes
 * distintos (Verde Selva y Verde Lima) salían los dos como "verde mate".
 * Sin un tono reconocible devuelve el color tal cual.
 */
export function tonoCliente(color: string, titulo: string): string {
  const base = nombreColorCliente(color);
  const palabras = titulo.split(/\s+[—-]\s+/)[0]!.split(/\s+/).filter(Boolean);
  const colorPalabras = sinTildes(color).split(/\s+/);
  const inicio = palabras.findIndex((_, indice) => colorPalabras.every((parte, desplazamiento) => sinTildes(palabras[indice + desplazamiento] ?? "") === parte));
  if (inicio < 0) return base;
  const extra: string[] = [];
  for (const palabra of palabras.slice(inicio + colorPalabras.length, inicio + colorPalabras.length + 2)) {
    const limpia = sinTildes(palabra).replace(/[^a-zñ]/g, "");
    if (!limpia || PALABRAS_NO_TONO.has(limpia) || MUESTRA_HEX.has(limpia) || /\d/.test(palabra)) break;
    extra.push(palabra.toLowerCase());
  }
  return extra.length ? `${base} ${extra.join(" ")}` : base;
}

export function muestraColor(color: string, acabado: string | null, tono?: string): MuestraColor {
  const clave = color.trim().toLowerCase();
  const hex = MUESTRA_HEX.get(clave) ?? "#9ca3af";
  const brillo = acabado === "cromado" || acabado === "metalizado";
  let fondo: string = hex;
  if (clave === "multicolor") fondo = "conic-gradient(#d32f2f, #f5d33a, #2e9d57, #1f4fbf, #7b3fa0, #d32f2f)";
  else if (clave === "transparente") fondo = "radial-gradient(circle at 35% 30%, #ffffff 0 25%, rgba(200,210,220,0.35) 60%)";
  else if (brillo) fondo = `radial-gradient(circle at 32% 28%, #ffffff 0 12%, ${hex} 45%, #00000055 100%)`;
  else if (acabado === "perlado") fondo = `radial-gradient(circle at 35% 30%, #ffffffcc 0 20%, ${hex} 70%)`;
  const conBorde = ["blanco", "transparente", "crema", "multicolor", "plateado", "beige"].includes(clave);
  return { color: clave, etiqueta: [tono ?? nombreColorCliente(color), acabado].filter(Boolean).join(" "), fondo, conBorde };
}

/** Colores de una estructura agrupados por color y acabado, del más usado al menos usado. */
export function coloresCliente(lineas: ReadonlyArray<{ color: string | null; acabado: string | null; titulo: string; unidades: number }>): MuestraColor[] {
  const grupos = new Map<string, { color: string; tono: string; acabado: string | null; unidades: number; orden: number }>();
  lineas.forEach((linea, orden) => {
    if (!linea.color) return;
    const acabado = acabadoCliente(linea.acabado, linea.titulo);
    const tono = tonoCliente(linea.color, linea.titulo);
    const clave = `${tono}|${acabado ?? ""}`;
    const previo = grupos.get(clave);
    if (previo) previo.unidades += linea.unidades;
    else grupos.set(clave, { color: linea.color, tono, acabado, unidades: linea.unidades, orden });
  });
  return [...grupos.values()]
    .sort((a, b) => b.unidades - a.unidades || a.orden - b.orden)
    .map((grupo) => muestraColor(grupo.color, grupo.acabado, grupo.tono));
}

/**
 * Línea de resumen derivada de las estructuras reales del plan (no de la
 * descripción libre del concepto): "Un semiarco asimétrico a la derecha y una
 * columna a la izquierda, en azul, blanco y dorado."
 */
export function resumenPlanCliente(estructuras: readonly EstructuraParaDescribir[], colores: readonly string[]): string {
  const piezas = estructuras.map((estructura) => describirEstructuraCliente(estructura, "indefinido"));
  if (!piezas.length) return "";
  const nombres = [...new Set(colores.map((color) => nombreColorCliente(color)))];
  const texto = `${unirNatural(piezas)}${nombres.length ? `, en ${unirNatural(nombres)}` : ""}.`;
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`;
}

/**
 * Una frase por par pedido/entregado, agrupando las estructuras afectadas.
 * Antes: "⚠ EST_01_SEMIARCO: R-18 → R-12" repetido por instancia.
 * `descripciones` va de `estructura_id` a "el semiarco asimétrico a la derecha".
 */
export function sustitucionesCliente(
  sustituciones: ReadonlyArray<{ estructura_id: string; pedido: string; entregado: string }>,
  descripciones: ReadonlyMap<string, string>,
): string[] {
  const grupos = new Map<string, { pedido: string; entregado: string; estructuras: string[] }>();
  for (const item of sustituciones) {
    const clave = `${item.pedido}|${item.entregado}`;
    const grupo = grupos.get(clave) ?? { pedido: item.pedido, entregado: item.entregado, estructuras: [] };
    const descripcion = descripciones.get(item.estructura_id) ?? "la decoración";
    if (!grupo.estructuras.includes(descripcion)) grupo.estructuras.push(descripcion);
    grupos.set(clave, grupo);
  }
  return [...grupos.values()].map((grupo) =>
    `Para ${unirNatural(grupo.estructuras)} no hay globos de ${pulgadasCliente(grupo.pedido)} en ese color; usamos globos de ${pulgadasCliente(grupo.entregado)}.`);
}

export function faltantesCliente(
  sinCobertura: ReadonlyArray<{ estructura_id: string; tamano: string }>,
  descripciones: ReadonlyMap<string, string>,
): string[] {
  const grupos = new Map<string, string[]>();
  for (const item of sinCobertura) {
    const estructuras = grupos.get(item.tamano) ?? [];
    const descripcion = descripciones.get(item.estructura_id) ?? "la decoración";
    if (!estructuras.includes(descripcion)) estructuras.push(descripcion);
    grupos.set(item.tamano, estructuras);
  }
  return [...grupos.entries()].map(([tamano, estructuras]) =>
    `Todavía no tenemos globos de ${pulgadasCliente(tamano)} para ${unirNatural(estructuras)}.`);
}

const SUPUESTO_MEDIDAS = /^medidas asumidas para ([a-z_]+):\s*(.+?)\s*—\s*(.+)$/i;

/**
 * Supuestos del resolvedor en palabras del cliente. Next y Python escriben
 * "medidas asumidas para semiarco: 2.4 m × 2.2 m — no nos diste…"; aquí se
 * cambia el tipo por su nombre oficial y el punto decimal por coma.
 */
export function supuestoCliente(supuesto: string): string {
  const coincidencia = SUPUESTO_MEDIDAS.exec(supuesto.trim());
  if (!coincidencia) return supuesto.replace(/_/g, " ");
  const [, tipo, valores, motivo] = coincidencia;
  const oficial = Object.values(ESTRUCTURAS_OFICIALES).find((estructura) => estructura.id === tipo);
  const nombre = oficial ? minusculaInicial(oficial.nombre) : tipo!.replace(/_/g, " ");
  const medidas = valores!.replace(/(\d)\.(\d)/g, "$1,$2");
  return `Usé medidas estándar para ${nombre} (${medidas}) porque ${motivo!.replace(/^no nos/, "no me")}.`;
}

/**
 * Producto del catálogo sin el prefijo comercial interno ni el sufijo de
 * tamaño y paquete, que la tarjeta ya muestra aparte:
 * "B2b Globo Latex Redondo Fashion Azul Rey — R-5 / PAQUETE X 12" → "Globo Latex Redondo Fashion Azul Rey".
 */
export function productoCliente(titulo: string): string {
  const limpio = titulo
    .replace(/^\s*b2b\s+/i, "")
    .replace(/\s*[—–-]\s*R-\d+\b.*$/i, "")
    .replace(/\s*\/\s*paquete\s*x\s*\d+\s*$/i, "")
    .trim();
  return limpio || titulo.trim();
}

/**
 * Producto con su tamaño, para nombres accesibles, títulos y textos
 * alternativos: distingue dos líneas del mismo producto en tamaños distintos
 * sin mostrar códigos. "Globo Latex Redondo Fashion Blanco de 5 pulgadas".
 */
export function productoConTamanoCliente(titulo: string, tamano: string | null | undefined): string {
  const producto = productoCliente(titulo);
  return tamano ? `${producto} de ${pulgadasCliente(tamano)}` : producto;
}

const AMBIENTACION_POR_PALABRA: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:light|lights|lighting|fairy|string|lantern|candle)s?\b/, "Luces"],
  [/\b(?:leaf|leaves|foliage|monstera|palm|plant|plants|greenery|fern)\b/, "Hojas y plantas"],
  [/\b(?:flower|flowers|floral|rose|roses|bouquet)\b/, "Flores"],
  [/\b(?:bag|bags|basket|baskets|box|boxes|gift|gifts)\b/, "Bolsas y cajas decorativas"],
  [/\b(?:rug|carpet|mat)\b/, "Alfombra"],
  [/\b(?:table|chair|chairs|bench|stool|furniture|sofa)\b/, "Mobiliario"],
  [/\b(?:plinth|pedestal|stand|cylinder)s?\b/, "Bases"],
  [/\b(?:cake|dessert|plate|plates|cup|cups|glass|tableware)s?\b/, "Mesa de postres"],
];

const AMBIENTACION_POR_CATEGORIA: Readonly<Record<string, string>> = {
  lighting: "Luces",
  floral: "Flores",
  furniture: "Mobiliario",
  plinth: "Bases",
  tableware: "Mesa de postres",
};

/**
 * Chips en español de la ambientación de la referencia que la imagen dibuja
 * sin cotizar. La selección es la de `ambientDecorSelection` (dueña de la
 * regla, la misma que usa /api/generate); aquí solo se nombra cada elemento
 * elegido en palabras del cliente.
 */
export function ambientacionCliente(blueprint: ReferenceBlueprintV2, materializados: ReadonlySet<string>): string[] {
  const elegidos = new Map(ambientDecorSelection(blueprint, materializados).map((item) => [item.elementId, item.name]));
  const etiquetas: string[] = [];
  for (const elemento of blueprint.elements) {
    const nombre = elegidos.get(elemento.element_id);
    if (nombre === undefined) continue;
    const etiqueta = AMBIENTACION_POR_PALABRA.find(([patron]) => patron.test(nombre))?.[1]
      ?? AMBIENTACION_POR_CATEGORIA[elemento.category]
      ?? "Detalles decorativos";
    if (!etiquetas.includes(etiqueta)) etiquetas.push(etiqueta);
  }
  return etiquetas;
}

/**
 * Estructuras de globos que el análisis vio en la foto, en palabras del
 * cliente ("un semiarco asimétrico a la derecha"). Usa la misma identificación
 * oficial que el chat (`serializeReferenceBlueprint`); los elementos sin
 * estructura detectada no se nombran.
 */
export function estructurasVistasEnReferencia(blueprint: ReferenceBlueprintV2): string[] {
  const descripciones: string[] = [];
  for (const elemento of blueprint.elements) {
    const semantica = elemento.visual_semantics;
    if (!elemento.approved || !semantica) continue;
    const oficial = identificarEstructuraOficial({ tipo: semantica.structure_type, densidad: semantica.density, ubicacion: semantica.placement, nombre: elemento.appearance.shape });
    if (!oficial) continue;
    descripciones.push(describirEstructuraCliente({ oficialId: oficial.id, nombre: oficial.nombre, ubicacion: semantica.placement, repeticiones: 1 }, "indefinido"));
  }
  return descripciones;
}

/** "Veo un semiarco asimétrico a la derecha y una columna a la izquierda." o null. */
export function resumenReferenciaCliente(blueprint: ReferenceBlueprintV2): string | null {
  const descripciones = estructurasVistasEnReferencia(blueprint);
  return descripciones.length ? `Veo ${unirNatural(descripciones)}.` : null;
}
