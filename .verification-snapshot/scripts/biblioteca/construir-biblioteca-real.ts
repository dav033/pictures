/**
 * Genera biblioteca real de decoraciones desde una carpeta de referencias.
 *
 * Ejecución con gasto: `npx tsx --conditions=react-server scripts/biblioteca/construir-biblioteca-real.ts --ejecutar`
 * Usa una llamada al análisis clásico por imagen. Requiere backend Python local (`PYTHON_BACKEND_URL` o :8080).
 * Las fotos se convierten a JPG local de hasta 800 px. Nunca se versionan originales.
 * Sin gasto: `--ejecutar --solo-resolver [--ids=03,08] [--sin-publicar]` re-resuelve con Python los análisis guardados
 * (desde `data/biblioteca-real/correcciones-auditoria.json`); `--ejecutar --solo-publicar` solo publica.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "../../src/lib/ia/referencia/reference-blueprint";
import { DENSIDADES, PlanDecoracionSchema, type PlanDecoracion } from "../../src/lib/plan/tipos";
import { resolverPlan } from "../../src/lib/plan/resolver-backend";
import { llamarPythonListaMateriales, llamarPythonOmoikaneCompletarArmados } from "../../src/lib/ia/nucleo/python-adapter";
import { ListaMaterialesRequestSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { DecoracionSempertexSchema, type OrigenCantidad } from "../../src/lib/biblioteca-sempertex/esquemas";
import { pasosParaCliente } from "../../src/lib/ia/guiado/pasos-cliente";
import type { PistaConteo } from "../../src/lib/plan/conteo-referencia";
import { ESTRUCTURAS_OFICIALES, ESTRUCTURAS_OFICIALES_IDS, esEstructuraOficialId, type EstructuraOficialId } from "../../src/lib/plan/estructuras-oficiales";
import { TAMANOS_LEIDOS, type PistaTamanos } from "../../src/lib/plan/patron-color";
import { ArmadoColumnaV1Schema, REMATES_COLUMNA, TAMANOS_COLUMNA, type ArmadoColumnaV1, type PistaRemate } from "../../src/lib/plan/armado-columna";
import { aplicarArmadosCompletados } from "../../src/lib/plan/armado-estructura-ia";

const ENTRADA = process.env.BIBLIOTECA_REAL_ENTRADA ?? "C:/Users/davidt/Downloads/hola";
const DATOS = path.join(process.cwd(), "data", "biblioteca-real");
const ANALISIS = path.join(DATOS, "analisis");
/**
 * Correcciones de la auditoría de fotos (2026-10-06) por análisis «real-NN-…»: qué estructura es cada pieza, qué tamaños
 * se ven, su remate o sus capas, y el producto Sempertex de cada color con las tallas de la foto. Con corrección, el plan
 * se arma desde ella (y no desde la heurística de color de abajo, que solo ofrecía R-12 y elegía el tono por orden
 * alfabético); Python sigue siendo el único dueño de las cantidades. Los «extras» son accesorios que Python no modela
 * (cortinas, foil, confeti, acentos dibujados), contados a mano en la foto y publicados como «estimado_foto».
 */
const CORRECCIONES = path.join(DATOS, "correcciones-auditoria.json");
/**
 * Decoraciones curadas a mano sobre fotos oficiales de Sempertex (deco-real-21…31, 2026-10-06): sus análisis viven en
 * analisis/nueva-*.json y sus cantidades mezclan el plan de Python con conteos sobre la foto (origenCantidad). Este
 * script no las re-resuelve (su heurística es solo R-12) y al publicar las conserva tal cual desde aquí.
 */
const CURADAS = path.join(DATOS, "nuevas");
/** Solo los análisis que este script generó («real-NN-…»); los «nueva-*» son de las curadas. */
const DEL_SCRIPT = /^real-\d{2}-/;
const FOTOS = path.join(process.cwd(), "public", "biblioteca-sempertex", "referencias");
const EXTENSIONES = new Set([".jpg", ".jpeg", ".webp", ".avif", ".gif"]);

const COLOR_EQUIVALENTE: Readonly<Record<string, string>> = {
  pink: "rosado", rosa: "rosado", rosado: "rosado", fucsia: "fucsia", fuchsia: "fucsia", magenta: "fucsia",
  gold: "dorado", dorado: "dorado", "rose gold": "dorado rosa", "dorado rosa": "dorado rosa",
  black: "negro", negro: "negro", white: "blanco", blanco: "blanco", blue: "azul", azul: "azul",
  navy: "azul marino", "navy blue": "azul marino", "dark navy blue": "azul marino", "azul marino": "azul marino",
  "light blue": "azul", "royal blue": "azul", "bright blue": "azul", "chrome blue": "azul", "dark royal blue": "azul marino",
  silver: "plateado", plateado: "plateado", plata: "plateado",
  purple: "morado", morado: "morado", violet: "violeta", violeta: "violeta", lilac: "lila", lila: "lila",
  green: "verde", verde: "verde", red: "rojo", rojo: "rojo", yellow: "amarillo", amarillo: "amarillo",
  turquoise: "turquesa", turquesa: "turquesa", teal: "turquesa",
  orange: "naranja", naranja: "naranja", beige: "beige", tan: "beige", brown: "cafe", cafe: "cafe",
  "light brown": "cafe", cream: "crema", crema: "crema", coral: "coral", transparent: "transparente",
};
const EXCLUIR_COMO_GLOBO: ReadonlyArray<RegExp> = [
  /\b(?:print|printed|impres[oa]s?|2 caras|filigree|grado|infinity)\b/i,
  /\b(?:confetti|foil|star|heart|skull|ribbon|number|letter|letra|n[uú]mero)\b/i,
];
const TIPO_OFICIAL: Readonly<Record<string, { tipo: string; oficial: string; nombre: string; ubicacion: string; medidas: Record<string, number> }>> = {
  arco: { tipo: "arco", oficial: "arco", nombre: "Arco de globos", ubicacion: "arco_central", medidas: { ancho_m: 2.4, alto_m: 2.2 } },
  semiarco: { tipo: "semiarco", oficial: "semiarco", nombre: "Semiarco orgánico", ubicacion: "fondo_pared", medidas: { ancho_m: 1.7, alto_m: 2.0 } },
  columna: { tipo: "columna", oficial: "columna", nombre: "Columna de globos", ubicacion: "lateral_izquierdo", medidas: { ancho_m: 0.55, alto_m: 2.0 } },
  guirnalda: { tipo: "guirnalda", oficial: "guirnalda", nombre: "Guirnalda orgánica", ubicacion: "fondo_pared", medidas: { largo_m: 2.4 } },
  bouquet: { tipo: "kit", oficial: "bouquet", nombre: "Bouquet de globos", ubicacion: "sobre_mesa_principal", medidas: {} },
  centro_mesa: { tipo: "centro_mesa", oficial: "centro_mesa", nombre: "Centro de mesa con globos", ubicacion: "mesas_invitados", medidas: {} },
};
const FICHAS_CLIENTE = [
  { titulo: "Arco de entrada en blanco y negro", tematica: "Elegante blanco y negro", eventos: ["Cumpleaños", "Graduación", "Fiesta de empresa"], edad: { min: 18, max: 70 } },
  { titulo: "Arco naranja y negro para fiesta de disfraces", tematica: "Infantil naranja y negro", eventos: ["Halloween", "Cumpleaños"], edad: { min: 3, max: 16 } },
  { titulo: "Semiarco azul y plateado con centros de mesa", tematica: "Azul y plateado", eventos: ["Baby shower", "Cumpleaños"], edad: { min: 0, max: 14 } },
  { titulo: "Semiarco selvático de dinosaurios", tematica: "Infantil de dinosaurios", eventos: ["Cumpleaños"], edad: { min: 2, max: 12 } },
  { titulo: "Semiarco rosa y oro rosa para mamá", tematica: "Romántico rosa y dorado", eventos: ["Día de la Madre", "Cumpleaños"], edad: { min: 18, max: 80 } },
  { titulo: "Columna arcoíris con cinta dorada", tematica: "Infantil colorida", eventos: ["Cumpleaños"], edad: { min: 1, max: 12 } },
  { titulo: "Dos columnas rosa, lila y dorado", tematica: "Rosa y lila", eventos: ["Cumpleaños", "XV años"], edad: { min: 8, max: 25 } },
  { titulo: "Columnas negras y doradas", tematica: "Elegante negro y dorado", eventos: ["Cumpleaños", "Graduación", "Fiesta de empresa"], edad: { min: 18, max: 70 } },
  { titulo: "Guirnalda rosa y dorada de cumpleaños", tematica: "Rosa y dorado", eventos: ["Cumpleaños"], edad: { min: 1, max: 30 } },
  { titulo: "Semiarco azul, blanco y plateado", tematica: "Azul y plateado", eventos: ["Baby shower", "Cumpleaños"], edad: { min: 0, max: 14 } },
  { titulo: "Guirnalda pastel rosa, lila y aguamarina", tematica: "Baby shower niña", eventos: ["Baby shower", "Primer cumpleaños"], edad: { min: 0, max: 8 } },
  { titulo: "Semiarco lila y morado", tematica: "Lila y morado", eventos: ["XV años", "Cumpleaños"], edad: { min: 12, max: 30 } },
  { titulo: "Semiarco blanco y oro rosa", tematica: "Romántico rosa y dorado", eventos: ["Boda", "Cumpleaños"], edad: { min: 18, max: 60 } },
  { titulo: "Arco de entrada blanco y negro", tematica: "Elegante blanco y negro", eventos: ["Graduación", "Cumpleaños"], edad: { min: 16, max: 70 } },
  { titulo: "Semiarco rojo, crema y dorado", tematica: "Infantil colorida", eventos: ["Cumpleaños"], edad: { min: 1, max: 16 } },
  { titulo: "Guirnalda azul para cumpleaños", tematica: "Azul y plateado", eventos: ["Cumpleaños"], edad: { min: 1, max: 16 } },
  { titulo: "Semiarco oro rosa, dorado y amarillo pastel", tematica: "Romántico rosa y dorado", eventos: ["Boda", "XV años"], edad: { min: 15, max: 60 } },
  { titulo: "Guirnalda rosa pastel y dorado", tematica: "Baby shower niña", eventos: ["Baby shower", "Primer cumpleaños"], edad: { min: 0, max: 8 } },
  { titulo: "Guirnalda rosa, fucsia, rojo y dorado", tematica: "Rosa y dorado", eventos: ["Cumpleaños", "XV años"], edad: { min: 12, max: 40 } },
  { titulo: "Semiarco azul ilusión", tematica: "Azul y plateado", eventos: ["Baby shower", "Cumpleaños"], edad: { min: 0, max: 16 } },
] as const;

function exigirEjecucionExplicita(): void {
  if (!process.argv.includes("--ejecutar")) {
    throw new Error("Este script puede llamar servicios de IA con costo. Confirma ejecución pasando --ejecutar.");
  }
}

function nombreSeguro(nombre: string): string {
  return path.basename(nombre, path.extname(nombre))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "referencia";
}

function colorCatalogo(valor: string): string | undefined {
  const normalizado = valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
  return COLOR_EQUIVALENTE[normalizado];
}

function coloresComposicion(texto: string): Array<{ color: string; share: number }> {
  const colores: Array<{ color: string; share: number }> = [];
  const porcentajes = [...texto.matchAll(/(\d+(?:\.\d+)?)\s*%\s*([\s\S]*?)(?=\s*(?:,?\s+and\s+)?\d+(?:\.\d+)?\s*%|[.;]|$)/gi)];
  for (const [, porcentaje, segmento] of porcentajes) {
    if (!porcentaje || !segmento) continue;
    if (/silver\s+confetti/i.test(segmento)) {
      colores.push({ color: "plateado", share: Number(porcentaje) / 100 });
      continue;
    }
    if (EXCLUIR_COMO_GLOBO.some((patron) => patron.test(segmento))) continue;
    const normalizado = segmento.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en");
    const alias = Object.keys(COLOR_EQUIVALENTE).sort((a, b) => b.length - a.length)
      .filter((nombre) => new RegExp(`(?:^|\\b)${nombre.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?:\\b|$)`, "i").test(normalizado));
    const coloresSegmento: string[] = [];
    for (const nombre of alias) {
      const expresion = new RegExp(`(?:^|\\b)${nombre.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?:\\b|$)`, "i");
      const coincidencia = expresion.exec(normalizado);
      if (!coincidencia || coincidencia.index === undefined) continue;
      const inicio = coincidencia.index + (coincidencia[0].startsWith(" ") ? 1 : 0);
      const fin = inicio + coincidencia[0].trim().length;
      if (alias.some((previo) => {
        if (previo === nombre) return false;
        const otra = new RegExp(`(?:^|\\b)${previo.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?:\\b|$)`, "i").exec(normalizado);
        if (!otra || otra.index === undefined) return false;
        const otroInicio = otra.index + (otra[0].startsWith(" ") ? 1 : 0);
        const otroFin = otroInicio + otra[0].trim().length;
        return otroInicio <= inicio && otroFin >= fin;
      })) continue;
      const color = colorCatalogo(nombre);
      if (color && !coloresSegmento.includes(color)) coloresSegmento.push(color);
    }
    for (const color of coloresSegmento) colores.push({ color, share: Number(porcentaje) / 100 / coloresSegmento.length });
  }
  return colores;
}

function coloresElemento(elemento: { appearance: { measured_colors?: Array<{ color?: string; share: number }>; observed_colors: string[]; composition?: string; patron_color?: { colores?: string[]; pesos?: number[] } } }): Array<{ color: string; share: number }> {
  const appearance = elemento.appearance;
  const composicion = coloresComposicion(appearance.composition ?? "");
  const patron = appearance.patron_color;
  const fuentes = composicion.length ? composicion : patron?.pesos?.length && patron.colores?.length
    ? patron.colores.map((color, indice) => ({ color: colorCatalogo(color), share: patron.pesos?.[indice] ?? 0 })).filter((color): color is { color: string; share: number } => color.color !== undefined && color.share > 0)
    : appearance.measured_colors?.map((color) => ({ color: colorCatalogo(color.color ?? ""), share: color.share }))
      .filter((color): color is { color: string; share: number } => color.color !== undefined && color.share > 0) ?? [];
  const suma = new Map<string, number>();
  for (const item of fuentes) {
    if (EXCLUIR_COMO_GLOBO.some((patronExcluir) => patronExcluir.test(item.color))) continue;
    suma.set(item.color, (suma.get(item.color) ?? 0) + item.share);
  }
  // Si blueprint enumera colores pero no da pesos, frecuencia de patrón aporta proporción reproducible.
  if (!composicion.length && !patron?.pesos?.length && patron?.colores?.length) {
    suma.clear();
    for (const nombre of patron.colores) {
      const color = colorCatalogo(nombre);
      if (color && !EXCLUIR_COMO_GLOBO.some((patronExcluir) => patronExcluir.test(nombre))) suma.set(color, (suma.get(color) ?? 0) + 1);
    }
  }
  // Observados nombrados no deben desaparecer porque lector de píxeles solo midió color dominante.
  const observados = appearance.observed_colors.map((nombre) => ({ nombre, color: colorCatalogo(nombre) }))
    .filter((dato): dato is { nombre: string; color: string } => dato.color !== undefined && !EXCLUIR_COMO_GLOBO.some((patronExcluir) => patronExcluir.test(dato.nombre)));
  for (const { color } of observados) if (!suma.has(color)) suma.set(color, Math.max(0.03, ...suma.values()) * 0.12);
  if (/silver\s+confetti/i.test(appearance.observed_colors.join(" ")) && !suma.has("plateado")) {
    const shareConfetti = appearance.composition?.match(/(\d+(?:\.\d+)?)\s*%\s*clear(?:\s+with\s+silver)?\s+confetti/i)?.[1];
    if (shareConfetti) suma.set("plateado", Number(shareConfetti) / 100);
  }
  const total = [...suma.values()].reduce((a, b) => a + b, 0);
  return [...suma].map(([color, share]) => ({ color, share: share / (total || 1) })).sort((a, b) => b.share - a.share);
}

function uuidDeterminista(valor: string): string {
  const hex = createHash("sha256").update(valor).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  const texto = hex.join("");
  return `${texto.slice(0, 8)}-${texto.slice(8, 12)}-${texto.slice(12, 16)}-${texto.slice(16, 20)}-${texto.slice(20)}`;
}

function record(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor as Record<string, unknown> : {};
}

const TallaSchema = z.union(TAMANOS_COLUMNA.map((talla) => z.literal(talla)) as unknown as [z.ZodLiteral<5>, z.ZodLiteral<9>, z.ZodLiteral<12>, z.ZodLiteral<18>, z.ZodLiteral<24>, z.ZodLiteral<36>]);
type Talla = z.infer<typeof TallaSchema>;
const IdCatalogo = z.string().regex(/^\d{10,}$/);
const MaterialCorreccionSchema = z.object({
  product_id: IdCatalogo,
  /** El color en palabras de cliente: es el que va en la nota del material. */
  color: z.string().trim().min(1).max(60),
  participacion: z.number().positive().max(1),
  /**
   * Tallas de este color, cuando no son las de la pieza (las columnas por capas, con su remate). Sin ellas: R-12 en una
   * pieza de un solo tamaño y, en las orgánicas, las tallas de la foto (`tamanos_foto`). Python reparte las tallas
   * entre los colores según la mezcla: cada color necesita todas las de la pieza o su parte se queda sin cubrir.
   */
  tamanos: z.array(TallaSchema).min(1).optional(),
  /** Variantes exactas, cuando el paquete de por defecto no es el que toca (un centro de mesa de 4 globos). */
  variantes: z.array(IdCatalogo).min(1).optional(),
}).strict().refine((material) => material.tamanos === undefined || material.variantes === undefined, { message: "Un material lleva «tamanos» o «variantes», no las dos." });
const CapaCorreccionSchema = z.object({
  tamano: TallaSchema,
  materiales: z.array(z.number().int().min(0).max(11)).min(3).max(6),
  /** Cuántas capas iguales seguidas (por defecto, 1). */
  veces: z.number().int().min(1).max(60).optional(),
  /** Con `veces`: cuántos puestos gira cada capa sobre la anterior (la espiral de 2 + 2 gira 1). */
  girar: z.number().int().min(0).max(5).optional(),
}).strict();
const PiezaCorreccionSchema = z.object({
  /** El elemento del análisis que materializa; `null` = una pieza que el análisis no separó (se dice en `porque`). */
  elemento: z.string().trim().min(1).nullable(),
  estructura_oficial: z.enum(ESTRUCTURAS_OFICIALES_IDS),
  ubicacion: z.string().trim().min(1).optional(),
  medidas: z.object({ ancho_m: z.number().positive().max(12).optional(), alto_m: z.number().positive().max(12).optional(), largo_m: z.number().positive().max(12).optional() }).strict().optional(),
  densidad: z.enum(DENSIDADES).optional(),
  /** Lo que la foto muestra de los tamaños: viaja a Python como pista y él elige la mezcla. */
  tamanos: z.enum(TAMANOS_LEIDOS),
  /** Columna: el remate de la foto, con su talla medida contra los globos del cuerpo. Lo valida el motor de Python. */
  remate: z.object({
    tipo: z.enum(REMATES_COLUMNA),
    material: z.number().int().min(0).max(11),
    tamano: TallaSchema,
    cantidad: z.number().int().min(3).max(5).optional(),
  }).strict().optional(),
  /** Columna: las capas de abajo arriba tal como se cuentan en la foto (modo «capas» del motor). */
  capas: z.array(CapaCorreccionSchema).min(1).optional(),
  materiales: z.array(MaterialCorreccionSchema).min(1).max(8),
  porque: z.string().trim().min(1),
}).strict();
const ExtraCorreccionSchema = z.object({
  variant_id: IdCatalogo,
  cantidad: z.number().int().positive().max(200),
  color: z.string().trim().min(1).max(60),
  detalle: z.string().trim().regex(/^estimado a partir de la foto: /),
}).strict();
const CorreccionSchema = z.object({
  auditoria: z.string().trim().min(1),
  /** Las tallas que se ven en la foto: van al plan como tamaños obligatorios y son las de cada color de las piezas orgánicas. */
  tamanos_foto: z.array(TallaSchema).min(1).optional(),
  piezas: z.array(PiezaCorreccionSchema).min(1),
  descartar: z.array(z.object({ elemento: z.string().trim().min(1), motivo: z.string().trim().min(1) }).strict()).optional(),
  extras: z.array(ExtraCorreccionSchema).optional(),
  supuestos: z.array(z.string().trim().min(1)).optional(),
}).strict();
type Correccion = z.infer<typeof CorreccionSchema>;
type PiezaCorreccion = z.infer<typeof PiezaCorreccionSchema>;
const CorreccionesSchema = z.record(z.string(), z.unknown()).transform((crudo, contexto) => {
  const salida = new Map<string, Correccion>();
  for (const [clave, valor] of Object.entries(crudo)) {
    if (clave.startsWith("$")) continue;
    if (!DEL_SCRIPT.test(clave)) { contexto.addIssue({ code: "custom", message: `Clave de corrección no es un análisis del script: ${clave}` }); continue; }
    const leida = CorreccionSchema.safeParse(valor);
    if (!leida.success) { contexto.addIssue({ code: "custom", message: `${clave}: ${leida.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}` }); continue; }
    salida.set(clave, leida.data);
  }
  return salida;
});

async function leerCorrecciones(): Promise<Map<string, Correccion>> {
  if (!existsSync(CORRECCIONES)) return new Map();
  return CorreccionesSchema.parse(JSON.parse(await readFile(CORRECCIONES, "utf8")) as unknown);
}

/** Una variante del snapshot vigente, con lo que hace falta para elegirla y nombrarla. */
type FilaCatalogo = {
  product_id: string; titulo: string; variant_id: string; variante: string; sku: string | null;
  diam: number | null; paq: number | null; colores_variante: string[]; colores_producto: unknown;
};
/** El paquete de cada talla redonda que se usa por defecto: el de 50 en las chicas, el más chico en las grandes. */
const PAQUETE_POR_TALLA: Readonly<Record<Talla, number>> = { 5: 50, 9: 50, 12: 50, 18: 6, 24: 3, 36: 2 };

function tallaDeVariante(fila: FilaCatalogo): number | null {
  const codigo = /^R-(\d{1,2})\s*\//.exec(fila.variante)?.[1];
  return codigo ? Number(codigo) : null;
}

/** La variante de una talla redonda de un producto: la del paquete de por defecto o, si no hay, la más cercana. */
function varianteDeTalla(filas: readonly FilaCatalogo[], productId: string, talla: Talla): FilaCatalogo {
  const candidatas = filas.filter((fila) => fila.product_id === productId && tallaDeVariante(fila) === talla);
  const preferido = PAQUETE_POR_TALLA[talla];
  const elegida = [...candidatas].sort((a, b) => Math.abs((a.paq ?? 0) - preferido) - Math.abs((b.paq ?? 0) - preferido) || (b.paq ?? 0) - (a.paq ?? 0))[0];
  if (!elegida) throw new Error(`El producto ${productId} no tiene R-${talla} disponible en el snapshot vigente.`);
  return elegida;
}

/**
 * El color con el que Python cubre la variante: el propio de la variante o, si no tiene, el del producto. Un producto
 * sin ningún color en el catálogo (Pastel Dusk Lavanda) no lo puede cubrir Python por color: entonces se le pide con
 * el color de catálogo de un producto del mismo tono y la variante exacta va como `variant_override` (ver `portadores`).
 */
function colorDeCatalogoDe(fila: FilaCatalogo): string | null {
  const propios = fila.colores_variante.filter((color) => color && color !== "multicolor");
  if (propios.length) return propios[0]!;
  const delProducto = Array.isArray(fila.colores_producto) ? fila.colores_producto.filter((color): color is string => typeof color === "string" && color !== "multicolor") : [];
  return delProducto.at(-1) ?? null;
}

/**
 * Productos sin color en el catálogo y el producto del mismo tono que los «porta» ante Python (el override cambia la
 * variante comprada, no el color). Pastel Dusk Lavanda (malva apagado) va con Pastel Mate Lila.
 */
const PORTADORES: Readonly<Record<string, string>> = { "8634309804327": "8634258424103" };

function productosDeCorreccion(correccion: Correccion): Set<string> {
  const productos = new Set<string>();
  for (const pieza of correccion.piezas) for (const material of pieza.materiales) {
    productos.add(material.product_id);
    if (PORTADORES[material.product_id]) productos.add(PORTADORES[material.product_id]!);
  }
  return productos;
}

async function filasDeCatalogo(pool: PoolRag, snapshot: string, productos: readonly string[], variantes: readonly string[]): Promise<FilaCatalogo[]> {
  const consulta = await pool.query<FilaCatalogo>(
    `SELECT p.product_id, p.title AS titulo, v.variant_id, v.title AS variante, v.sku, v.diam_pulg::float AS diam,
            v.unidades_paq::int AS paq, COALESCE(v.derived_colors, ARRAY[]::text[]) AS colores_variante,
            COALESCE(p.derived->'colors', '[]'::jsonb) AS colores_producto
       FROM catalog_products p
       JOIN catalog_variants v ON v.source_snapshot_id = p.source_snapshot_id AND v.product_id = p.product_id
      WHERE p.source_snapshot_id = $1 AND p.status = 'ACTIVE' AND p.available = TRUE AND v.available = TRUE
        AND v.currency = 'COP' AND v.price > 0
        AND (p.product_id = ANY($2::text[]) OR v.variant_id = ANY($3::text[]))
      ORDER BY p.product_id, v.variant_id`,
    [snapshot, [...productos], [...variantes]],
  );
  return consulta.rows;
}

type MaterialPlan = { product_id: string; variant_id: string; color: string; participacion: number; rol_material: "principal" | "secundario" | "acento" };
type OverridePlan = { objetivo_variant_id: string; product_id: string; variant_id: string; color: string };
/** Lo que una pieza corregida le pide a Python: sus materiales, sus overrides y la lista de variantes permitidas. */
type MaterialesPieza = { materiales: MaterialPlan[]; overrides: OverridePlan[]; allowlist: Map<string, Set<string>>; colorCliente: Map<string, string> };

/** Las tallas por defecto de una pieza: R-12 si es de un solo tamaño; si no, las de la foto (o las de la mezcla orgánica). */
function tallasDePieza(pieza: PiezaCorreccion, tamanosFoto: readonly Talla[] | undefined): readonly Talla[] {
  return pieza.tamanos === "un_solo_tamano" ? [12] : tamanosFoto ?? [5, 9, 12, 18, 24];
}

function materialesDePieza(pieza: PiezaCorreccion, tamanosFoto: readonly Talla[] | undefined, filas: readonly FilaCatalogo[]): MaterialesPieza {
  const suma = pieza.materiales.reduce((total, material) => total + material.participacion, 0);
  const allowlist = new Map<string, Set<string>>();
  const permitir = (productId: string, variantId: string) => allowlist.set(productId, (allowlist.get(productId) ?? new Set<string>()).add(variantId));
  const colorCliente = new Map<string, string>();
  const overrides: OverridePlan[] = [];
  const materiales = pieza.materiales.map((material, indice): MaterialPlan => {
    const portador = PORTADORES[material.product_id];
    // Una talla de la pieza que el producto (o su portador) no tiene la sirve Python con la contigua de su lista.
    const tiene = (productId: string, talla: Talla) => filas.some((fila) => fila.product_id === productId && tallaDeVariante(fila) === talla);
    const elegidas = material.variantes
      ? material.variantes.map((variantId) => {
        const fila = filas.find((candidata) => candidata.variant_id === variantId);
        if (!fila || fila.product_id !== material.product_id) throw new Error(`La variante ${variantId} no es del producto ${material.product_id} o no está disponible.`);
        return fila;
      })
      : (material.tamanos ?? tallasDePieza(pieza, tamanosFoto))
        .filter((talla) => material.tamanos !== undefined || (tiene(material.product_id, talla) && (!portador || tiene(portador, talla))))
        .map((talla) => varianteDeTalla(filas, material.product_id, talla));
    if (!elegidas.length) throw new Error(`${material.product_id} no tiene ninguna de las tallas de la pieza.`);
    const base = elegidas.find((fila) => tallaDeVariante(fila) === 12) ?? elegidas[0]!;
    const rol = indice === 0 ? "principal" : indice === 1 ? "secundario" : "acento";
    const participacion = Math.round((material.participacion / suma) * 1000) / 1000;
    for (const fila of elegidas) colorCliente.set(fila.variant_id, material.color);
    if (portador) {
      // Python cubre por color: el portador pone el color de catálogo y cada talla compra la variante real.
      const conPortador = elegidas.map((fila) => ({ fila, portadora: varianteDeTalla(filas, portador, tallaDeVariante(fila) as Talla) }));
      const color = colorDeCatalogoDe(conPortador[0]!.portadora);
      if (!color) throw new Error(`El portador ${portador} tampoco tiene color en el catálogo.`);
      for (const { fila, portadora } of conPortador) {
        permitir(portador, portadora.variant_id);
        permitir(fila.product_id, fila.variant_id);
        overrides.push({ objetivo_variant_id: portadora.variant_id, product_id: fila.product_id, variant_id: fila.variant_id, color });
      }
      const basePortadora = conPortador.find(({ fila }) => fila === base)!.portadora;
      return { product_id: portador, variant_id: basePortadora.variant_id, color, participacion, rol_material: rol };
    }
    const color = colorDeCatalogoDe(base);
    if (!color) throw new Error(`${material.product_id} no tiene color en el catálogo y no tiene portador declarado.`);
    for (const fila of elegidas) permitir(fila.product_id, fila.variant_id);
    return { product_id: material.product_id, variant_id: base.variant_id, color, participacion, rol_material: rol };
  });
  return { materiales, overrides, allowlist, colorCliente };
}

/**
 * Si las tallas de la foto pueden ir al plan como obligatorias: solo cuando cada color de cada pieza orgánica las tiene
 * todas. Una talla obligatoria no se sustituye, así que un color sin ella quedaría sin cubrir; entonces no se declaran y
 * Python sirve la talla que falta con la contigua de ese color (y la mezcla deja fuera las que la foto no muestra porque
 * ningún color las ofrece).
 */
function tallasObligatorias(correccion: Correccion, tamanosFoto: readonly Talla[], filas: readonly FilaCatalogo[]): boolean {
  const tiene = (productId: string, talla: Talla) => filas.some((fila) => fila.product_id === productId && tallaDeVariante(fila) === talla);
  return correccion.piezas.every((pieza) => pieza.tamanos === "un_solo_tamano" || pieza.capas !== undefined || pieza.materiales.every((material) =>
    material.tamanos === undefined && material.variantes === undefined && tamanosFoto.every((talla) => tiene(material.product_id, talla) && (!PORTADORES[material.product_id] || tiene(PORTADORES[material.product_id]!, talla)))));
}

/** Expande las capas de la corrección («veces» con su giro) a las capas del armado de columna. */
function capasDeCorreccion(capas: NonNullable<PiezaCorreccion["capas"]>): ArmadoColumnaV1["capas"] {
  return capas.flatMap((capa) => Array.from({ length: capa.veces ?? 1 }, (_, vuelta) => {
    const giro = ((capa.girar ?? 0) * vuelta) % capa.materiales.length;
    return { tamano: capa.tamano, materiales: [...capa.materiales.slice(giro), ...capa.materiales.slice(0, giro)] };
  }));
}

const TIPO_OFICIAL_DE_BASE: Readonly<Record<string, keyof typeof TIPO_OFICIAL>> = { arco: "arco", semiarco: "semiarco", columna: "columna", guirnalda: "guirnalda", kit: "bouquet", centro_mesa: "centro_mesa" };

type ResueltaConCorreccion = { plan: PlanDecoracion; allowlist: Map<string, Set<string>>; colorCliente: Map<string, string>; pistasTamanos: PistaTamanos[]; conteos: PistaConteo[]; remates: Array<{ estructura_id: string; tamano: number; cantidad: number; color: string; tipo: string }> };

/** El plan declarado de una decoración corregida: piezas, materiales reales por talla, pistas de tamaño y conteo. */
function planDeCorreccion(idAnalisis: string, correccion: Correccion, blueprint: ReferenceBlueprintV2, filas: readonly FilaCatalogo[]): ResueltaConCorreccion {
  const aprobados = blueprint.elements.filter((elemento) => elemento.approved && elemento.category === "balloon_structure");
  const cubiertos = new Set([...correccion.piezas.flatMap((pieza) => pieza.elemento ? [pieza.elemento] : []), ...(correccion.descartar ?? []).map((item) => item.elemento)]);
  const sinCubrir = aprobados.filter((elemento) => !cubiertos.has(elemento.element_id)).map((elemento) => elemento.element_id);
  if (sinCubrir.length) throw new Error(`${idAnalisis}: la corrección no dice qué hacer con ${sinCubrir.join(", ")}.`);
  const allowlist = new Map<string, Set<string>>();
  const colorCliente = new Map<string, string>();
  const pistasTamanos: PistaTamanos[] = [];
  const conteos: PistaConteo[] = [];
  const remates: ResueltaConCorreccion["remates"] = [];
  let extra = 0;
  const estructuras = correccion.piezas.map((pieza, indice) => {
    const oficial = ESTRUCTURAS_OFICIALES[pieza.estructura_oficial as EstructuraOficialId];
    const ficha = TIPO_OFICIAL[TIPO_OFICIAL_DE_BASE[oficial.tipoBase] ?? "bouquet"]!;
    const elemento = pieza.elemento ? aprobados.find((candidato) => candidato.element_id === pieza.elemento) : undefined;
    if (pieza.elemento && !elemento) throw new Error(`${idAnalisis}: ${pieza.elemento} no es un elemento de globos aprobado del análisis.`);
    const referencia = elemento?.element_id ?? `REF_01_EXTRA_${String((extra += 1)).padStart(2, "0")}`;
    const { materiales, overrides, allowlist: permitidas, colorCliente: colores } = materialesDePieza(pieza, correccion.tamanos_foto, filas);
    for (const [producto, variantes] of permitidas) allowlist.set(producto, new Set([...(allowlist.get(producto) ?? []), ...variantes]));
    for (const [variante, color] of colores) colorCliente.set(variante, color);
    pistasTamanos.push({ referencia_element_id: referencia, tamanos: pieza.tamanos, confianza: 1 });
    const lectura = elemento?.appearance.conteo;
    if (lectura && !pieza.capas && lectura.confianza >= 0.5 && (lectura.exacto || lectura.estimado_total !== null || lectura.racimos !== null)) {
      conteos.push({ ...lectura, referencia_element_id: referencia });
    }
    const tipo = oficial.tipoBase === "kit" ? "kit" : oficial.tipoBase;
    const estructuraId = `EST_${String(indice + 1).padStart(2, "0")}_${pieza.estructura_oficial.toLocaleUpperCase("es")}`;
    const esKit = pieza.estructura_oficial === "bouquet" || pieza.estructura_oficial === "centro_mesa";
    if (pieza.remate) {
      const material = materiales[pieza.remate.material];
      if (!material) throw new Error(`${idAnalisis}: el remate apunta al material ${pieza.remate.material}, que la pieza no tiene.`);
      remates.push({ estructura_id: estructuraId, tamano: pieza.remate.tamano, cantidad: pieza.remate.tipo === "racimo" ? pieza.remate.cantidad ?? 3 : 1, color: pieza.materiales[pieza.remate.material]!.color, tipo: pieza.remate.tipo });
    }
    return {
      estructura_id: estructuraId, nombre: oficial.nombre, tipo, estructura_oficial: pieza.estructura_oficial,
      rol_escena: indice === 0 ? "focal" : "soporte", ubicacion: pieza.ubicacion ?? ficha.ubicacion,
      medidas: pieza.medidas ?? ficha.medidas, repeticiones: 1, densidad: pieza.densidad ?? "media", mezcla: "clasica", materiales,
      ...(overrides.length ? { variant_overrides: overrides } : {}),
      ...(esKit ? { unidades_declaradas: lectura?.exacto ? Math.max(5, lectura.globos_visibles) : Math.max(5, lectura?.globos_visibles ?? 12) } : {}),
      referencia_element_id: referencia,
      colores_referencia: [...new Set(materiales.map((material) => material.color))],
      porque: pieza.porque,
    };
  });
  const plan = PlanDecoracionSchema.parse({
    plan_version: "1.0", plan_id: uuidDeterminista(idAnalisis),
    concepto: { titulo: idAnalisis, descripcion: "Plan de estructuras y materiales derivado de una decoración de referencia.", paleta: [...new Set(estructuras.flatMap((pieza) => pieza.colores_referencia))].slice(0, 8), estilo: "orgánico" },
    espacio: { tipo: "fondo de celebración", fuente: "foto" }, estructuras,
    supuestos: ["Las medidas en metros parten de un tamaño frecuente y se ajustan con la lectura de la foto.", "Los tamaños son los que se ven en la foto (auditoría 2026-10-06).", ...(correccion.supuestos ?? [])],
    ...(correccion.tamanos_foto && tallasObligatorias(correccion, correccion.tamanos_foto, filas) ? { restricciones: { estructuras: [], colores: [], acabados: [], tamanos: correccion.tamanos_foto.map((talla) => ({ valor: `R-${talla}`, procedencia: "inferido", texto_original: `Tamaño visto en la foto: R-${talla}`, polaridad: "obligatorio" })) } } : {}),
  });
  return { plan, allowlist, colorCliente, pistasTamanos, conteos, remates };
}

/**
 * Las columnas con remate o con capas contadas en la foto pasan por el motor de Python, como en la vista guiada: primero
 * la receta (con el remate leído), luego el armado de la foto (capas y talla del remate) que el motor revalida contra la
 * pieza. Si el motor no acepta el de la foto, se detiene: no se publica una columna que Python no armó.
 */
async function conArmadosDeColumna(idAnalisis: string, correccion: Correccion, plan: PlanDecoracion, pistasTamanos: readonly PistaTamanos[], requestId: string): Promise<PlanDecoracion> {
  const conMotor = correccion.piezas.map((pieza, indice) => ({ pieza, estructura: plan.estructuras[indice]! })).filter(({ pieza }) => pieza.remate || pieza.capas);
  if (!conMotor.length) return plan;
  const remates: PistaRemate[] = conMotor.flatMap(({ pieza, estructura }) => pieza.remate && estructura.referencia_element_id
    ? [{ referencia_element_id: estructura.referencia_element_id, tipo: pieza.remate.tipo, color: estructura.materiales[pieza.remate.material]!.color }] : []);
  const receta = await llamarPythonOmoikaneCompletarArmados({ plan, remates, tamanosLeidos: [...pistasTamanos], requestId, correlationId: requestId });
  const propuestos = conMotor.map(({ pieza, estructura }) => {
    const completado = receta.armados.find((armado) => armado.estructura_id === estructura.estructura_id);
    if (!completado || completado.clave !== "armado_columna") throw new Error(`${idAnalisis}: el motor no devolvió armado de columna para ${estructura.estructura_id}.`);
    const base = ArmadoColumnaV1Schema.parse(completado.armado);
    const capas = pieza.capas ? capasDeCorreccion(pieza.capas) : base.capas;
    // En modo «capas» cada capa nombra posiciones de `materiales` del armado: con la lista en el orden de la pieza, la
    // posición es el índice del material, que es como lo escribe la corrección.
    const armado: ArmadoColumnaV1 = {
      ...base, origen: "referencia",
      ...(pieza.capas ? { modo: "capas" as const, capas, materiales: estructura.materiales.map((_, indice) => indice).slice(0, 8) } : {}),
      ...(pieza.remate ? { remate: { ...base.remate, tipo: pieza.remate.tipo, material: pieza.remate.material, tamano: pieza.remate.tamano, ...(pieza.remate.cantidad ? { cantidad: pieza.remate.cantidad } : {}) } } : {}),
    };
    return { estructura_id: estructura.estructura_id, tipo: "columna" as const, armado };
  });
  const validados = await llamarPythonOmoikaneCompletarArmados({ plan, armados: propuestos, remates, tamanosLeidos: [...pistasTamanos], requestId, correlationId: requestId });
  for (const propuesto of propuestos) {
    const vuelta = validados.armados.find((armado) => armado.estructura_id === propuesto.estructura_id);
    if (!vuelta || vuelta.origen !== "modelo") throw new Error(`${idAnalisis}: el motor no aceptó el armado de la foto de ${propuesto.estructura_id} (${vuelta?.origen ?? "sin armado"}: ${vuelta?.avisos.join("; ") ?? ""}).`);
  }
  return aplicarArmadosCompletados(plan, validados.armados.filter((armado) => propuestos.some((propuesto) => propuesto.estructura_id === armado.estructura_id)));
}

type PoolRag = ReturnType<typeof import("../../src/lib/rag/db").getRagPool>;

/** Resuelve con Python una decoración corregida y guarda su .plan.json con lo que la publicación necesita. */
async function resolverConCorreccion(pool: PoolRag, snapshot: string, idAnalisis: string, correccion: Correccion, blueprint: ReferenceBlueprintV2): Promise<void> {
  const extras = correccion.extras ?? [];
  const filas = await filasDeCatalogo(pool, snapshot, [...productosDeCorreccion(correccion)], [
    ...extras.map((extra) => extra.variant_id),
    ...correccion.piezas.flatMap((pieza) => pieza.materiales.flatMap((material) => material.variantes ?? [])),
  ]);
  const { plan, allowlist, colorCliente, pistasTamanos, conteos, remates } = planDeCorreccion(idAnalisis, correccion, blueprint, filas);
  const requestId = uuidDeterminista(`${idAnalisis}:request`);
  const planConArmados = await conArmadosDeColumna(idAnalisis, correccion, plan, pistasTamanos, requestId);
  const resolucion = await resolverPlan({
    plan: planConArmados, allowlist: [...allowlist].map(([product_id, variant_ids]) => ({ product_id, variant_ids: [...variant_ids] })),
    catalogSnapshotId: snapshot, pistasTamanos, completarConteos: conteos.length > 0, pistasConteo: conteos,
    requestId, correlationId: requestId,
  });
  const materiales = resolucion.materialEstimate.purchases.map((linea) => ({ variant_id: linea.variant_id, cantidad: linea.design_quantity }));
  const entradaLista = ListaMaterialesRequestSchema.parse({ schema_version: "lista-materiales.v1", materiales });
  const cotizacion = await llamarPythonListaMateriales({ entrada: entradaLista, requestId, correlationId: requestId });
  const extrasFoto = extras.map((extra) => {
    const fila = filas.find((candidata) => candidata.variant_id === extra.variant_id);
    if (!fila) throw new Error(`${idAnalisis}: el accesorio ${extra.variant_id} no está disponible en el snapshot vigente.`);
    const codigo = /^([RC]-\d{1,2}|T\d{3}|LOL\s?\d{1,2})\s*\//.exec(fila.variante)?.[1] ?? /(\d{1,2})\s*IN\b/i.exec(fila.variante)?.[0]?.replace(/\s+/, " ").toUpperCase() ?? null;
    return {
      variantId: fila.variant_id, sku: fila.sku, cantidad: extra.cantidad,
      nota: [`${fila.titulo} — ${fila.variante}`, codigo, extra.color].filter(Boolean).join(" · "),
      detalleCantidad: extra.detalle,
    };
  });
  const resuelto = {
    estado: "resuelto", snapshot, correccion_auditoria: correccion.auditoria, descartadas: (correccion.descartar ?? []).map((item) => `${item.elemento}: ${item.motivo}`),
    plan_declarado: plan, plan_resuelto: resolucion.resuelto, material_estimate: resolucion.materialEstimate, quote: resolucion.cotizacion, lista_materiales: cotizacion,
    pistas_tamanos: pistasTamanos, pistas_conteo: conteos, remates, colores_cliente: Object.fromEntries(colorCliente), extras_foto: extrasFoto,
  };
  await writeFile(path.join(ANALISIS, `${idAnalisis}.plan.json`), `${JSON.stringify(resuelto, null, 2)}\n`);
  const compras = resolucion.resuelto.compras;
  console.log(`${idAnalisis}: ${resolucion.resuelto.estructuras.length} piezas, ${compras.reduce((n, compra) => n + compra.unidades_necesarias, 0)} globos de Python + ${extrasFoto.reduce((n, extra) => n + extra.cantidad, 0)} contados en la foto`);
  for (const compra of compras) console.log(`  ${compra.unidades_necesarias} × ${compra.titulo} · ${colorCliente.get(compra.variant_id) ?? compra.color ?? "?"}`);
  for (const aviso of resolucion.resuelto.advertencias) console.log(`  aviso: ${aviso}`);
  for (const cambio of resolucion.resuelto.sustituciones) console.log(`  sustitución ${cambio.estructura_id}: ${cambio.pedido} → ${cambio.entregado} (${cambio.motivo})`);
  for (const falta of resolucion.resuelto.sin_cobertura) console.log(`  sin cobertura ${falta.estructura_id}: ${falta.product_id} ${falta.tamano}`);
  for (const conteo of resolucion.resuelto.conteos_referencia ?? []) console.log(`  conteo ${conteo.estructura_id}: ${conteo.decision} (foto ${conteo.globos_foto ?? "?"}, antes ${conteo.globos_antes}, después ${conteo.globos_despues})`);
  for (const estructura of resolucion.resuelto.plan.estructuras) console.log(`  ${estructura.estructura_id}: ${estructura.estructura_oficial ?? estructura.tipo} ${JSON.stringify(estructura.medidas)} ${estructura.densidad} ${estructura.mezcla}`);
}

async function construirPlanesGuardados(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL falta; no se puede comprobar snapshot ni resolver planes reales.");
  process.env.DATABASE_URL = databaseUrl;
  const { getRagPool } = await import("../../src/lib/rag/db");
  const pool = getRagPool();
  try {
    const consulta = await pool.query<{
      source_snapshot_id: string; product_id: string; variant_id: string; sku: string | null;
      titulo: string; color: string; unidades_paq: number;
    }>(
      `WITH snapshot AS (
         SELECT source_snapshot_id FROM rag_source_snapshots
          WHERE source_kind = 'products_catalog' AND status = 'published'
          ORDER BY published_at DESC NULLS LAST, fetched_at DESC LIMIT 1
       )
       SELECT s.source_snapshot_id, p.product_id, v.variant_id, v.sku, p.title AS titulo,
              v.derived_colors[1] AS color, v.unidades_paq::int AS unidades_paq
         FROM snapshot s
         JOIN catalog_products p ON p.source_snapshot_id = s.source_snapshot_id
         JOIN catalog_variants v ON v.source_snapshot_id = s.source_snapshot_id AND v.product_id = p.product_id
        WHERE p.status = 'ACTIVE' AND p.available = TRUE AND v.available = TRUE
          AND v.currency = 'COP' AND v.price > 0 AND v.unidades_paq = 50 AND v.diam_pulg = 12
          AND (cardinality(v.derived_colors) = 1 OR p.title ILIKE '%Azul Turquesa%')
          AND v.title ILIKE 'R-12%'
          AND p.title ILIKE '%Globo Latex Redondo%'
          AND p.title !~* '(infinity|filigree|grado|2 caras|4 caras|mascara|neon|cumple|bautizo|navidad|love|mami|papa|niña|niño|te amo|corazon|welcome|print|estampad|impres|confetti|foil|estrella|skull|ribbon)'
        ORDER BY CASE
          WHEN p.title ILIKE '%Globo Latex Redondo Fashion%' THEN 0
          WHEN p.title ILIKE '%Globo Latex Redondo Pastel Mate%' THEN 1
          WHEN p.title ILIKE '%Globo Latex Redondo Reflex%' THEN 2
          WHEN p.title ILIKE '%Globo Latex Redondo Satin%' THEN 3
          WHEN p.title ILIKE '%Globo Latex Redondo Metal%' THEN 4 ELSE 5 END,
          p.title, v.variant_id`,
    );
    const snapshot = consulta.rows[0]?.source_snapshot_id;
    if (!snapshot) throw new Error("Snapshot publicado de productos no disponible.");
    const porColor = new Map<string, (typeof consulta.rows)[number][]>();
    for (const fila of consulta.rows) {
      const color = /azul\s*(?:marino|naval|noche|oscuro)|navy/i.test(fila.titulo) ? "azul marino"
        : /turquesa/i.test(fila.titulo) ? "turquesa" : fila.color;
      porColor.set(color, [...(porColor.get(color) ?? []), fila]);
    }
    const { readdir: leerDirectorio } = await import("node:fs/promises");
    const correcciones = await leerCorrecciones();
    // `--ids=03,08`: re-resolver solo esas (las demás conservan su .plan.json); se publica siempre todo.
    const soloIds = process.argv.find((argumento) => argumento.startsWith("--ids="))?.slice("--ids=".length).split(",").map((numero) => numero.trim().padStart(2, "0"));
    const archivos = (await leerDirectorio(ANALISIS)).filter((nombre) => DEL_SCRIPT.test(nombre) && nombre.endsWith(".json") && !nombre.endsWith(".plan.json"))
      .filter((nombre) => !soloIds || soloIds.includes(nombre.slice("real-".length, "real-".length + 2))).sort();
    for (const archivo of archivos) {
      const raw = record(JSON.parse(await readFile(path.join(ANALISIS, archivo), "utf8")) as unknown);
      const respuesta = record(raw.respuesta);
      const blueprint = ReferenceBlueprintV2Schema.safeParse(respuesta.blueprint);
      if (!blueprint.success || raw.status !== 200) {
        await writeFile(path.join(ANALISIS, `${String(raw.id)}.plan.json`), `${JSON.stringify({ estado: "descartada", razon: "El analizador no produjo blueprint válido." }, null, 2)}\n`);
        continue;
      }
      const correccion = correcciones.get(String(raw.id));
      if (correccion) {
        await resolverConCorreccion(pool, snapshot, String(raw.id), correccion, blueprint.data);
        continue;
      }
      console.warn(`${String(raw.id)}: sin corrección auditada; se resuelve con la heurística de color y solo R-12.`);
      const piezas: Array<Record<string, unknown>> = [];
      const descartadas: string[] = [];
      const conteos: PistaConteo[] = [];
      for (const elemento of blueprint.data.elements) {
        if (!elemento.approved || elemento.category !== "balloon_structure") continue;
        const tipoOriginal = elemento.visual_semantics?.structure_type ?? "";
        const tipo = tipoOriginal === "kit" ? (elemento.appearance.shape?.toLowerCase().includes("table") ? "centro_mesa" : "bouquet") : tipoOriginal;
        const ficha = TIPO_OFICIAL[tipo];
        if (!ficha) { descartadas.push(`${elemento.element_id}: estructura ${tipoOriginal || "sin tipo"} no identificable`); continue; }
        const lectura = elemento.appearance.conteo;
        if (!lectura && (tipo === "bouquet" || tipo === "centro_mesa")) { descartadas.push(`${elemento.element_id}: sin conteo para pieza de unidades declaradas`); continue; }
        const coloresUnicos = coloresElemento(elemento)
          .filter((color) => porColor.has(color.color));
        if (!coloresUnicos.length) { descartadas.push(`${elemento.element_id}: sin color medido con variante R-12 en snapshot`); continue; }
        const suma = coloresUnicos.reduce((total, item) => total + item.share, 0);
        const materiales = coloresUnicos.map((item, indice) => {
          const colorCatalogoElegido = item.color;
          const candidatos = porColor.get(colorCatalogoElegido)!;
          const observados = elemento.appearance.observed_colors.join(" ").toLocaleLowerCase("en");
          const variante = [...candidatos].sort((a, b) => {
            const titulo = (fila: typeof a) => fila.titulo.toLocaleLowerCase("es");
            const puntaje = (fila: typeof a) => {
              const t = titulo(fila);
              if (item.color === "plateado" && /(silver|plata)/.test(observados)) return (t.includes("reflex") ? 0 : t.includes("satin") ? 1 : 2);
              if (item.color === "blanco" && /pearl white/.test(observados)) return (t.includes("satin") ? 0 : 1);
              if (item.color === "verde" && /metallic green/.test(observados)) return (t.includes("metal") ? 0 : t.includes("reflex") ? 1 : 2);
              if (item.color === "turquesa" && /chrome teal/.test(observados)) return (t.includes("reflex") ? 0 : t.includes("metal") ? 1 : 2);
              if (item.color === "turquesa" && /(turquoise|teal|turquesa)/.test(observados)) return (t.includes("turquesa") ? 0 : 1);
              if (item.color === "azul" && /(chrome blue|metallic blue)/.test(observados)) return (t.includes("reflex") ? 0 : t.includes("metal") ? 1 : 2);
              if ((item.color === "dorado" || item.color === "dorado rosa") && /(chrome gold|chrome rose gold)/.test(observados)) return (t.includes("reflex") ? 0 : t.includes("metal") ? 1 : 2);
              if ((item.color === "dorado" || item.color === "dorado rosa") && /(metallic gold|metallic rose gold)/.test(observados)) return (t.includes("metal") ? 0 : t.includes("reflex") ? 1 : 2);
              return (t.includes("fashion") ? 0 : t.includes("pastel mate") ? 1 : 2);
            };
            return puntaje(a) - puntaje(b) || a.titulo.localeCompare(b.titulo, "es");
          })[0]!;
          return { product_id: variante.product_id, variant_id: variante.variant_id, color: item.color === "turquesa" ? "azul" : colorCatalogoElegido, participacion: item.share / suma, rol_material: indice === 0 ? "principal" : indice === 1 ? "secundario" : "acento" };
        });
        const indicePieza = piezas.length + 1;
        const estructuraId = `EST_${String(indicePieza).padStart(2, "0")}_${tipo.toLocaleUpperCase("es")}`;
        piezas.push({
          estructura_id: estructuraId, nombre: ficha.nombre, tipo: ficha.tipo, estructura_oficial: ficha.oficial,
          rol_escena: indicePieza === 1 ? "focal" : "soporte", ubicacion: ficha.ubicacion,
          medidas: ficha.medidas, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales,
          ...(tipo === "bouquet" || tipo === "centro_mesa" ? { unidades_declaradas: lectura?.exacto ? Math.max(5, lectura.globos_visibles) : 12 } : {}),
          referencia_element_id: elemento.element_id,
          colores_referencia: coloresUnicos.map((item) => item.color),
          porque: `Recreación de referencia ${elemento.element_id}, con color y forma observados.`,
        });
        if (lectura && lectura.confianza >= 0.5 && (lectura.exacto || lectura.estimado_total !== null || lectura.racimos !== null)) {
          conteos.push({ ...lectura, referencia_element_id: elemento.element_id });
        }
      }
      if (!piezas.length) {
        await writeFile(path.join(ANALISIS, `${String(raw.id)}.plan.json`), `${JSON.stringify({ estado: "descartada", razon: descartadas.join("; ") || "No hay estructura de globos aprobada." }, null, 2)}\n`);
        continue;
      }
      const nombresColor = [...new Set(piezas.flatMap((pieza) => pieza.colores_referencia as string[]))];
      const paleta = nombresColor.slice(0, 8);
      const plan = PlanDecoracionSchema.parse({
        plan_version: "1.0", plan_id: uuidDeterminista(String(raw.id)),
        concepto: { titulo: String(raw.id), descripcion: "Plan de estructuras y materiales derivado de una decoración de referencia.", paleta, estilo: "orgánico" },
        espacio: { tipo: "fondo de celebración", fuente: "foto" }, estructuras: piezas,
        supuestos: ["Las medidas en metros parten de un tamaño frecuente y se ajustan con la lectura de la foto.", "Se usan globos redondos R-12 disponibles en el snapshot vigente."],
      });
      const productosUsados = new Map<string, Set<string>>();
      for (const pieza of piezas) {
        for (const material of pieza.materiales as Array<{ product_id: string; variant_id: string }>) {
          const variantes = productosUsados.get(material.product_id) ?? new Set<string>();
          variantes.add(material.variant_id);
          productosUsados.set(material.product_id, variantes);
        }
      }
      const requestId = uuidDeterminista(`${String(raw.id)}:request`);
      const resolucion = await resolverPlan({
        plan, allowlist: [...productosUsados].map(([product_id, variant_ids]) => ({ product_id, variant_ids: [...variant_ids] })),
        catalogSnapshotId: snapshot, completarConteos: conteos.length > 0, pistasConteo: conteos,
        requestId, correlationId: requestId,
      });
      const materiales = resolucion.materialEstimate.purchases.map((linea) => ({ variant_id: linea.variant_id, cantidad: linea.design_quantity }));
      const entradaLista = ListaMaterialesRequestSchema.parse({ schema_version: "lista-materiales.v1", materiales });
      const cotizacion = await llamarPythonListaMateriales({ entrada: entradaLista, requestId, correlationId: requestId });
      const resuelto = {
        estado: "resuelto", snapshot, plan_declarado: plan, plan_resuelto: resolucion.resuelto,
        material_estimate: resolucion.materialEstimate, quote: resolucion.cotizacion, lista_materiales: cotizacion,
        descartadas,
      };
      await writeFile(path.join(ANALISIS, `${String(raw.id)}.plan.json`), `${JSON.stringify(resuelto, null, 2)}\n`);
      console.log(`${String(raw.id)}: ${resolucion.resuelto.estructuras.length} piezas, ${resolucion.resuelto.compras.reduce((n, compra) => n + compra.unidades_necesarias, 0)} globos, Python y cotización OK`);
    }
  } finally {
    await pool.end();
  }
  if (!process.argv.includes("--sin-publicar")) await publicarBibliotecaReal();
}

type RematePasos = { tamano: number; cantidad: number; color: string; tipo: string };
type DatosPasos = { oficiales: readonly string[]; tallas: readonly number[]; patron: string; remates: readonly RematePasos[]; accesorios: readonly string[] };

/** «de 5, 12 y 18 pulgadas»: las tallas redondas de la decoración, en palabras de cliente. */
function tallasEnPalabras(tallas: readonly number[]): string {
  const orden = [...new Set(tallas)].sort((a, b) => a - b).map(String);
  return orden.length <= 1 ? `de ${orden[0] ?? "12"} pulgadas` : `de ${orden.slice(0, -1).join(", ")} y ${orden.at(-1)!} pulgadas`;
}

/** Qué añadir al final, dicho al cliente, a partir de los accesorios contados en la foto. */
function accesoriosEnPalabras(notas: readonly string[]): string[] {
  const frases: Array<[RegExp, string]> = [
    [/cara|calavera/i, "los globitos de acento con su cara dibujada"],
    [/Tubito/i, "los adornos hechos con globos para modelar"],
    [/Infinity/i, "los globos impresos"],
    [/Confetti/i, "el confeti dentro de los globos transparentes"],
    [/Estrella/i, "las estrellas metalizadas"],
    [/Cortina/i, "la cortina metálica de fondo"],
  ];
  return [...new Set(notas.flatMap((nota) => frases.filter(([patron]) => patron.test(nota)).map(([, frase]) => frase).slice(0, 1)))];
}

function enumerar(partes: readonly string[]): string {
  return partes.length <= 1 ? partes[0] ?? "" : `${partes.slice(0, -1).join(", ")} y ${partes.at(-1)!}`;
}

/** Los pasos de una decoración del script, ya en palabras de cliente (sin «R-12» ni «patrón»), como los muestra la vista guiada. */
function pasosDe({ oficiales, tallas, patron, remates, accesorios }: DatosPasos): Array<{ orden: number; texto: string }> {
  const familia = oficiales.some((oficial) => oficial.startsWith("columna")) ? "columna" : oficiales.includes("guirnalda") ? "guirnalda" : oficiales.every((oficial) => oficial === "bouquet" || oficial === "centro_mesa") ? "kit" : "arco";
  const organica = new Set(tallas).size > 1;
  const patronTexto = patron ? `Sigue el patrón ${patron} y alterna los colores según la foto.` : "Alterna los colores de la paleta para conservar el balance de la foto.";
  const primero = familia === "columna" ? "Fija una base pesada y arma el soporte vertical." : familia === "guirnalda" ? "Marca los puntos de anclaje y prepara la tira de soporte." : familia === "kit" ? "Prepara el soporte de mesa y asegúralo para que no se vuelque." : "Arma y asegura el soporte con la forma del arco o semiarco.";
  const globos = `Infla los globos ${tallasEnPalabras(tallas)}`;
  const segundo = organica ? `${globos} y arma racimos mezclando tamaños: los chicos rellenan los huecos y los grandes dan volumen.` : familia === "columna" ? `${globos} y agrúpalos en cuartetos parejos.` : familia === "guirnalda" ? `${globos} y forma grupos compactos de cuatro.` : `${globos} con tamaño uniforme.`;
  const tercero = familia === "columna" ? "Monta los grupos desde la base." : familia === "guirnalda" ? "Sujeta los grupos a la tira y da forma a la curva." : "Distribuye los grupos por toda la estructura.";
  const pasos = [primero, segundo, `${tercero} ${patronTexto}`];
  const remate = remates[0];
  if (remate) {
    const cada = remates.length > 1 ? "cada columna" : "la columna";
    pasos.push(remate.tipo === "racimo"
      ? `Corona ${cada} con un racimo de ${remate.cantidad} globos ${remate.color} de ${remate.tamano} pulgadas.`
      : `Corona ${cada} con un globo ${remate.color} de ${remate.tamano} pulgadas, sin inflarlo del todo para que guarde proporción con el cuerpo.`);
  }
  const extras = accesoriosEnPalabras(accesorios);
  pasos.push(extras.length ? `Añade ${enumerar(extras)}, y revisa que no queden huecos grandes.` : "Añade los globos de acento y revisa que no queden huecos grandes.");
  pasos.push("Asegura cada pieza, comprueba la estabilidad y ajusta la forma antes de recibir a tus invitados.");
  return pasosParaCliente(pasos.map((texto, indice) => ({ orden: indice + 1, texto })));
}

async function publicarBibliotecaReal(): Promise<void> {
  const { writeFile: guardar } = await import("node:fs/promises");
  const salida: unknown[] = [];
  const archivos = (await readdir(ANALISIS)).filter((nombre) => DEL_SCRIPT.test(nombre) && nombre.endsWith(".plan.json")).sort();
  for (const archivo of archivos) {
    const planCrudo = record(JSON.parse(await readFile(path.join(ANALISIS, archivo), "utf8")) as unknown);
    if (planCrudo.estado !== "resuelto") continue;
    const idAnalisis = archivo.replace(/\.plan\.json$/, "");
    const indice = Number(/^real-(\d{2})-/.exec(idAnalisis)?.[1] ?? "0") - 1;
    const ficha = FICHAS_CLIENTE[indice];
    if (!ficha) throw new Error(`Falta ficha de cliente para ${idAnalisis}.`);
    const raw = record(JSON.parse(await readFile(path.join(ANALISIS, `${idAnalisis}.json`), "utf8")) as unknown);
    const respuesta = record(raw.respuesta);
    const blueprint = ReferenceBlueprintV2Schema.parse(respuesta.blueprint);
    const planResuelto = record(planCrudo.plan_resuelto);
    const compras = Array.isArray(planResuelto.compras) ? planResuelto.compras.map(record) : [];
    const estructuras = Array.isArray(planResuelto.estructuras) ? planResuelto.estructuras.map(record) : [];
    const coloresDeclarados = new Map<string, string>();
    const planDeclarado = record(planCrudo.plan_declarado);
    for (const estructura of Array.isArray(planDeclarado.estructuras) ? planDeclarado.estructuras.map(record) : []) {
      const materialesDeclarados = Array.isArray(estructura.materiales) ? estructura.materiales.map(record) : [];
      const coloresReferencia = Array.isArray(estructura.colores_referencia) ? estructura.colores_referencia : [];
      for (const [indice, material] of materialesDeclarados.entries()) {
        const color = typeof coloresReferencia[indice] === "string" ? coloresReferencia[indice] : material.color;
        if (typeof material.variant_id === "string" && typeof color === "string") coloresDeclarados.set(material.variant_id, color);
      }
    }
    // El color en palabras de cliente que la corrección dio a cada variante (si la hay), y lo que Python resolvió por pieza.
    const coloresCliente = record(planCrudo.colores_cliente);
    // Qué piezas llevan cada variante («la columna», «las 2 columnas»), con el nombre oficial de la pieza.
    const oficialDe = new Map((Array.isArray(record(planResuelto.plan).estructuras) ? (record(planResuelto.plan).estructuras as unknown[]).map(record) : [])
      .map((estructura) => [String(estructura.estructura_id), String(estructura.estructura_oficial ?? "")] as const));
    const piezasDeVariante = new Map<string, Set<string>>();
    for (const estructura of estructuras) {
      for (const linea of Array.isArray(estructura.lineas) ? estructura.lineas.map(record) : []) {
        if (typeof linea.variant_id === "string" && Number(linea.unidades) > 0) piezasDeVariante.set(linea.variant_id, (piezasDeVariante.get(linea.variant_id) ?? new Set<string>()).add(String(estructura.estructura_id)));
      }
    }
    const nombrePiezas = (variantId: string): string => {
      const cuenta = new Map<string, number>();
      for (const estructuraId of piezasDeVariante.get(variantId) ?? []) {
        const oficial = oficialDe.get(estructuraId) ?? "";
        cuenta.set(oficial, (cuenta.get(oficial) ?? 0) + 1);
      }
      const partes = [...cuenta].map(([oficial, veces]) => {
        const nombre = (esEstructuraOficialId(oficial) ? ESTRUCTURAS_OFICIALES[oficial].nombre : "pieza").toLocaleLowerCase("es");
        return veces > 1 ? `${nombre} (${veces} piezas)` : nombre;
      });
      return partes.length ? enumerar(partes) : "la pieza";
    };
    type MaterialPublicado = { variantId: string; sku: string | null; cantidad: number; nota: string; origenCantidad: OrigenCantidad; detalleCantidad: string };
    const materiales = compras.filter((linea) => typeof linea.variant_id === "string" && Number(linea.unidades_necesarias) > 0).map((linea): MaterialPublicado => {
      const cantidad = Number(linea.unidades_necesarias);
      const color = coloresCliente[String(linea.variant_id)] ?? coloresDeclarados.get(String(linea.variant_id)) ?? linea.color;
      return {
        variantId: String(linea.variant_id), sku: typeof linea.sku === "string" ? linea.sku : null, cantidad,
        nota: [linea.titulo, linea.tamano_codigo ? String(linea.tamano_codigo) : "R-12", color].filter(Boolean).join(" · "),
        origenCantidad: "plan_python",
        detalleCantidad: `${cantidad} de ${nombrePiezas(String(linea.variant_id))} (plan resuelto por Python) [data/biblioteca-real/analisis/${archivo}]`,
      };
    });
    // Accesorios que Python no modela (cortinas, foil, confeti, impresos, acentos dibujados), contados en la foto.
    const extrasFoto = Array.isArray(planCrudo.extras_foto) ? planCrudo.extras_foto.map(record) : [];
    for (const extra of extrasFoto) {
      const variantId = String(extra.variantId);
      const cantidad = Number(extra.cantidad);
      const detalle = String(extra.detalleCantidad);
      const dePython = materiales.find((material) => material.variantId === variantId);
      if (dePython) {
        Object.assign(dePython, { cantidad: dePython.cantidad + cantidad, origenCantidad: "plan_python_y_foto", detalleCantidad: `${dePython.detalleCantidad.replace(/ \[data\/.+\]$/, "")} + ${cantidad} ${detalle} [data/biblioteca-real/analisis/${archivo}]` });
        continue;
      }
      materiales.push({ variantId, sku: typeof extra.sku === "string" ? extra.sku : null, cantidad, nota: String(extra.nota), origenCantidad: "estimado_foto", detalleCantidad: detalle });
    }
    const piezasPorEstructura = new Map<string, number>();
    for (const estructura of estructuras) {
      const oficial = String(record(estructura.plan).estructura_oficial ?? estructura.estructura_oficial ?? "");
      if (oficial) piezasPorEstructura.set(oficial, (piezasPorEstructura.get(oficial) ?? 0) + Number(estructura.repeticiones ?? 1));
    }
    // Python can return `estructuras` with its declarative piece under `plan`; use that plan field when present.
    if (!piezasPorEstructura.size) {
      const plan = record(planResuelto.plan);
      const declaradas = Array.isArray(plan.estructuras) ? plan.estructuras.map(record) : [];
      for (const estructura of declaradas) {
        const oficial = String(estructura.estructura_oficial ?? "");
        if (oficial) piezasPorEstructura.set(oficial, (piezasPorEstructura.get(oficial) ?? 0) + Number(estructura.repeticiones ?? 1));
      }
    }
    const referenciasDePlan = new Set<string>();
    for (const pieza of Array.isArray(planDeclarado.estructuras) ? planDeclarado.estructuras.map(record) : []) {
      if (typeof pieza.referencia_element_id === "string") referenciasDePlan.add(pieza.referencia_element_id);
    }
    const paletaMedida = record(respuesta.analisis_color);
    const lecturas = Array.isArray(paletaMedida.piezas) ? paletaMedida.piezas.map(record) : [];
    const hexes = lecturas.filter((pieza) => referenciasDePlan.has(String(pieza.elementId))).flatMap((pieza) =>
      (Array.isArray(pieza.colores) ? pieza.colores.map(record) : []).map((color) => color.hex),
    ).filter((hex): hex is string => typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex));
    const coloresPlan = [...new Set(hexes)].slice(0, 5);
    const paleta = coloresPlan;
    const elementos = blueprint.elements.filter((elemento) => referenciasDePlan.has(elemento.element_id));
    const patron = elementos.map((elemento) => elemento.appearance.patron_color?.modo).find((valor) => valor !== undefined) ?? "orgánico";
    const tallas = compras.flatMap((linea) => {
      const talla = /^R-(\d{1,2})$/.exec(String(linea.tamano_codigo ?? ""))?.[1];
      return talla && Number(linea.unidades_necesarias) > 0 ? [Number(talla)] : [];
    });
    const remates = (Array.isArray(planCrudo.remates) ? planCrudo.remates.map(record) : []).map((remate) => ({ tamano: Number(remate.tamano), cantidad: Number(remate.cantidad), color: String(remate.color), tipo: String(remate.tipo) }));
    const tallasRemate = new Set(remates.map((remate) => remate.tamano));
    const tallasCuerpo = tallas.filter((talla) => !tallasRemate.has(talla) || remates.every((remate) => remate.tipo === "racimo"));
    const pasos = pasosDe({
      oficiales: [...piezasPorEstructura.keys()], tallas: tallasCuerpo.length ? tallasCuerpo : tallas, patron, remates,
      accesorios: extrasFoto.map((extra) => `${String(extra.nota)} ${String(extra.detalleCantidad)}`),
    });
    const fuente = typeof raw.fuente === "string" ? raw.fuente : `${idAnalisis}.jpg`;
    const fotoUrl = `/biblioteca-sempertex/referencias/${idAnalisis}.jpg`;
    const piezas = [...piezasPorEstructura].map(([estructura, cantidad]) => ({ estructura, cantidad }));
    const decoracion = DecoracionSempertexSchema.parse({
      id: `deco-real-${idAnalisis.slice("real-".length)}`, origen: "referencia_real", titulo: ficha.titulo, tematica: ficha.tematica,
      eventos: [...ficha.eventos], edad: ficha.edad,
      fotos: [{ url: fotoUrl, fuente, licencia: "referencia_web_sin_licencia" }], video: null,
      piezas, materiales, pasos, shopifyHandle: null, ...(paleta.length ? { paleta } : {}), fotoRepresentativa: true,
    });
    salida.push(decoracion);
  }
  if (salida.length !== FICHAS_CLIENTE.length) throw new Error(`Biblioteca incompleta: ${salida.length}/${FICHAS_CLIENTE.length} resoluciones publicables.`);
  const destino = path.join(process.cwd(), "src", "lib", "biblioteca-sempertex", "decoraciones.json");
  const existentes: unknown = JSON.parse(await readFile(destino, "utf8"));
  const otros = Array.isArray(existentes) ? existentes.filter((dato) => record(dato).origen !== "referencia_real") : [];
  const curadas = existsSync(CURADAS)
    ? await Promise.all((await readdir(CURADAS)).filter((nombre) => nombre.endsWith(".json")).sort().map(async (nombre) => DecoracionSempertexSchema.parse(JSON.parse(await readFile(path.join(CURADAS, nombre), "utf8")) as unknown)))
    : [];
  await guardar(destino, `${JSON.stringify([...otros, ...salida, ...curadas], null, 2)}\n`);
  console.log(`Publicadas ${salida.length} decoraciones reales y ${curadas.length} curadas; ${otros.length} entradas previas preservadas.`);
  // El detalle de cada idea (piezas y globos Sempertex por producto y tamaño) sale de esta misma biblioteca: se regenera
  // aquí, en un proceso aparte, porque `detalles-ideas` importa componentes de React que no cargan con la condición
  // `react-server` con la que corre este script (React.createContext no existe ahí).
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), path.join("scripts", "biblioteca", "precomputar-detalles-ideas.ts")], { stdio: "inherit" });
}

async function main(): Promise<void> {
  exigirEjecucionExplicita();
  for (const archivo of [".env.local", ".env"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
  const databaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  process.env.PYTHON_BACKEND_URL ??= "http://127.0.0.1:8080";
  await mkdir(ANALISIS, { recursive: true });
  await mkdir(FOTOS, { recursive: true });

  const nombres = (await readdir(ENTRADA, { withFileTypes: true }))
    .filter((entrada) => entrada.isFile() && EXTENSIONES.has(path.extname(entrada.name).toLocaleLowerCase("en")))
    .map((entrada) => entrada.name)
    .sort((a, b) => a.localeCompare(b, "es"));
  const { POST } = await import("../../src/app/api/references/analyze/route");
  const resultados: Array<{ id: string; fuente: string; estado: string }> = [];
  for (const [indice, fuente] of nombres.entries()) {
    const id = `real-${String(indice + 1).padStart(2, "0")}-${nombreSeguro(fuente)}`;
    const salidaFoto = path.join(FOTOS, `${id}.jpg`);
    const original = await readFile(path.join(ENTRADA, fuente));
    const metadatosOriginales = await sharp(original, { animated: false }).metadata();
    const { data: jpeg, info } = await sharp(original, { animated: false })
      .rotate()
      .resize(800, 800, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    await writeFile(salidaFoto, jpeg);

    const imagen = {
      base64: jpeg.toString("base64"),
      mime: "image/jpeg",
      ancho: info.width,
      alto: info.height,
      originalAncho: metadatosOriginales.width ?? info.width,
      originalAlto: metadatosOriginales.height ?? info.height,
    };
    const response = await POST(new Request("http://localhost/api/references/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ images: [imagen], sin_cache: true, proveedor: "gemini" }),
    }));
    const cuerpo: unknown = await response.json();
    await writeFile(path.join(ANALISIS, `${id}.json`), `${JSON.stringify({ id, fuente, imagen_local: `/biblioteca-sempertex/referencias/${id}.jpg`, status: response.status, respuesta: cuerpo }, null, 2)}\n`);
    const estado = response.ok ? "analizada" : `error-${response.status}`;
    resultados.push({ id, fuente, estado });
    console.log(`${id}: ${estado}`);
  }
  await writeFile(path.join(DATOS, "manifiesto.json"), `${JSON.stringify({ version: 1, entrada: "carpeta local privada; solo nombres de archivo", imagenes: resultados }, null, 2)}\n`);
  if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
  await construirPlanesGuardados();
  console.log(`Procesadas ${resultados.length} imágenes en serie. Blueprints, planes y cotizaciones guardados.`);
}

async function ejecutar(): Promise<void> {
  exigirEjecucionExplicita();
  if (process.argv.includes("--solo-resolver")) {
    for (const archivo of [".env.local", ".env"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
    process.env.PYTHON_BACKEND_URL ??= "http://127.0.0.1:8080";
    await construirPlanesGuardados();
    return;
  }
  if (process.argv.includes("--solo-publicar")) {
    await publicarBibliotecaReal();
    return;
  }
  await main();
}

void ejecutar().catch((error: unknown) => {
  const dato = record(error);
  const detalles = Object.fromEntries(["name", "code", "status", "domainCode", "domainDetails", ...(dato.name === "ZodError" || dato.name === "Error" ? ["message"] : [])].filter((clave) => dato[clave] !== undefined).map((clave) => [clave, dato[clave]]));
  console.error(Object.keys(detalles).length ? JSON.stringify(detalles) : error instanceof Error ? error.message : "Error desconocido al construir biblioteca real.");
  process.exitCode = 1;
});
