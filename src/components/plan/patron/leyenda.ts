import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import type { LineaMaterial } from "@/lib/plan/resuelto";
import type { PatronColorResuelto } from "@/lib/plan/patron-color";
import { acabadoCliente, muestraColor, nombreColorCliente, productoCliente, tonoCliente, type MuestraColor } from "@/lib/plan/presentacion-cliente";
import { HEX_COLORES_V2 } from "@/lib/rag/taxonomy/v2";

/**
 * Leyenda numerada de un patrón, como en la gráfica del curso Sempertex:
 * 1 = primer material de la estructura, 2 = el segundo… El número es el índice
 * del material + 1 (el patrón apunta a `materiales` por índice). El color de
 * cada número lo decide Python (`conteo[].color` y `acabado`, ADR-0028 §8):
 * tras un reemplazo es lo que se compra, no lo declarado. Solo presentación:
 * nombres y muestras salen de `presentacion-cliente.ts`; nada de aquí expande
 * ni cuenta un patrón.
 */

export type BrilloGlobo = "mate" | "cromado" | "perlado" | "transparente" | "multicolor";

export type ColorLeyenda = {
  indice: number;
  numero: number;
  /** "Azul cromado", con mayúscula inicial. */
  etiqueta: string;
  muestra: MuestraColor;
  /** Color base de los dibujos SVG: un `fill` no admite los degradados CSS de la muestra. */
  hex: string;
  brillo: BrilloGlobo;
  /** El número va en claro sobre las muestras oscuras. */
  numeroClaro: boolean;
};

type MaterialLeyenda = { product_id: string; color?: string; acabado?: string };
/** Lo que Python dice de cada número: el color y el acabado que se compran. */
type ConteoLeyenda = ReadonlyArray<Pick<PatronColorResuelto["conteo"][number], "material" | "color" | "acabado">>;

const HEX_PALETA: Readonly<Record<string, string>> = HEX_COLORES_V2;
const HEX_DESCONOCIDO = "#9ca3af";

function mayusculaInicial(texto: string): string {
  return texto ? `${texto.charAt(0).toUpperCase()}${texto.slice(1)}` : texto;
}

/** Luminancia relativa (WCAG) de un `#rrggbb`. */
function luminancia(hex: string): number {
  const canal = (inicio: number) => {
    const valor = Number.parseInt(hex.slice(inicio, inicio + 2), 16) / 255;
    return valor <= 0.03928 ? valor / 12.92 : ((valor + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

function brilloDe(color: string, acabado: string | null): BrilloGlobo {
  if (color === "multicolor") return "multicolor";
  if (color === "transparente" || acabado === "transparente") return "transparente";
  if (acabado === "cromado" || acabado === "metalizado") return "cromado";
  if (acabado === "perlado" || acabado === "satinado") return "perlado";
  return "mate";
}

/** Línea resuelta que da el tono ("verde selva") de un color: la de ese color y acabado, mejor si es del mismo producto. */
function lineaDelColor(lineas: readonly LineaMaterial[], productId: string, color: string, acabado: string | null): LineaMaterial | undefined {
  const delColor = lineas.filter((item) => item.color === color && (!acabado || !item.acabado || item.acabado === acabado));
  return delColor.find((item) => item.product_id === productId) ?? delColor[0];
}

function mismoColor(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/**
 * Una entrada por material, en el orden de `materiales`. Con `conteo` (el del
 * patrón resuelto por Python) cada número lleva el color y el acabado que
 * Python le dio, que tras un reemplazo es lo que se compra; solo sin él (una
 * vista sin patrón resuelto) se nombra el material declarado. El tono y el
 * acabado que falten se leen de una línea resuelta de ese color (su título
 * dice "verde selva", "reflex"…). Si ninguna dice ese color y Python no lo
 * renombró, de la línea del propio producto: la resolución la reetiqueta con
 * el color real de la variante ("azul" declarado, "azul rey" comprado).
 */
export function leyendaPatron(materiales: readonly MaterialLeyenda[], lineas: readonly LineaMaterial[] = [], conteo?: ConteoLeyenda | null): ColorLeyenda[] {
  return materiales.map((material, indice) => {
    const dePython = conteo?.find((fila) => fila.material === indice);
    // Python nombra lo que se compra; sin su conteo, lo declarado.
    const nombrado = dePython ? { color: dePython.color, acabado: dePython.acabado } : { color: material.color ?? null, acabado: material.acabado ?? null };
    const renombrado = dePython !== undefined && !mismoColor(dePython.color, material.color);
    const delProducto = () => lineas.find((item) => item.product_id === material.product_id);
    const linea = nombrado.color
      ? lineaDelColor(lineas, material.product_id, nombrado.color, nombrado.acabado) ?? (renombrado ? undefined : delProducto())
      : delProducto();
    const color = nombrado.color ?? linea?.color ?? null;
    const acabado = acabadoCliente(nombrado.acabado ?? linea?.acabado, linea?.titulo);
    const tono = color && linea ? tonoCliente(color, linea.titulo) : color ? nombreColorCliente(color) : undefined;
    const muestra = muestraColor(color ?? "", acabado, tono);
    const hex = HEX_PALETA[muestra.color] ?? HEX_DESCONOCIDO;
    const brillo = brilloDe(muestra.color, acabado);
    const etiqueta = color ? mayusculaInicial(muestra.etiqueta) : linea ? productoCliente(linea.titulo) : `Color ${indice + 1}`;
    return {
      indice,
      numero: indice + 1,
      etiqueta,
      muestra: { ...muestra, etiqueta },
      hex,
      brillo,
      // 0,18: punto en que el blanco y el negro dan el mismo contraste (WCAG).
      numeroClaro: brillo !== "transparente" && luminancia(hex) < 0.18,
    };
  });
}

/**
 * Color y acabado de una línea tal como se compra ("Rojo mate", "Verde selva
 * cromado"); sin color, el producto. `clave` agrupa las líneas que se ven igual.
 */
export function colorDeLinea(linea: Pick<LineaMaterial, "color" | "acabado" | "titulo">): { clave: string; muestra: MuestraColor } {
  if (!linea.color) {
    const producto = productoCliente(linea.titulo);
    return { clave: `producto:${producto}`, muestra: { color: "", etiqueta: producto, fondo: HEX_DESCONOCIDO, conBorde: false } };
  }
  const muestra = muestraColor(linea.color, acabadoCliente(linea.acabado, linea.titulo), tonoCliente(linea.color, linea.titulo));
  return { clave: `color:${muestra.etiqueta}`, muestra: { ...muestra, etiqueta: mayusculaInicial(muestra.etiqueta) } };
}

/** Entrada de un índice que la leyenda no conoce (no debería pasar): gris, sin nombre de color. */
export function colorDe(leyenda: readonly ColorLeyenda[], indice: number): ColorLeyenda {
  return leyenda[indice] ?? {
    indice,
    numero: indice + 1,
    etiqueta: `Color ${indice + 1}`,
    muestra: { color: "", etiqueta: `Color ${indice + 1}`, fondo: HEX_DESCONOCIDO, conBorde: false },
    hex: HEX_DESCONOCIDO,
    brillo: "mate",
    numeroClaro: false,
  };
}

/** Racimos (columnas, arcos…) o filas (paredes): así se nombra cada línea de la rejilla. */
export function unidadesFila(geometria: PatronColorResuelto["geometria"]): { singular: string; plural: string; posicion: string } {
  return geometria === "rejilla"
    ? { singular: "Fila", plural: "Filas", posicion: "globo" }
    : { singular: "Racimo", plural: "Racimos", posicion: "posición" };
}

/**
 * Dónde empieza y dónde termina la rejilla (ADR-0028 §2: fila 0 es la base de
 * la columna, el pie izquierdo del arco…). `baseAbajo` pone la fila 1 abajo en
 * la gráfica, como se arma.
 */
export function extremosFilas(tipo: string, oficialId?: EstructuraOficialId | string): { inicio: string; fin: string; baseAbajo: boolean } {
  if (oficialId === "aro_circular") return { inicio: "Inicio, abajo", fin: "Cierre", baseAbajo: false };
  switch (tipo) {
    case "columna": return { inicio: "Base", fin: "Arriba", baseAbajo: true };
    case "semiarco": return { inicio: "Base", fin: "Punta", baseAbajo: true };
    case "centro_mesa": return { inicio: "Sobre la mesa", fin: "Arriba", baseAbajo: true };
    case "arco": return { inicio: "Pie izquierdo", fin: "Pie derecho", baseAbajo: false };
    case "guirnalda": return { inicio: "Extremo izquierdo", fin: "Extremo derecho", baseAbajo: false };
    case "pared": return { inicio: "Arriba", fin: "Abajo", baseAbajo: false };
    default: return { inicio: "Inicio", fin: "Final", baseAbajo: false };
  }
}

const NOMBRES_RACIMO: Readonly<Record<number, string>> = { 1: "globo suelto", 2: "pareja", 3: "trío", 4: "cuarteto", 5: "quinteto", 6: "sexteto" };

/** "cuarteto", "pareja"; "racimo de 7" fuera de la jerga habitual. */
export function nombreRacimo(globos: number): string {
  return NOMBRES_RACIMO[globos] ?? `racimo de ${globos}`;
}

/** "Racimos 1–3" / "Racimo 4" / "Filas 2–5". */
export function rangoFilas(geometria: PatronColorResuelto["geometria"], desde: number, hasta: number): string {
  const unidades = unidadesFila(geometria);
  return desde === hasta ? `${unidades.singular} ${desde}` : `${unidades.plural} ${desde}–${hasta}`;
}
