import { z } from "zod";
import { tramosPorTamano, type TramoTamano } from "@/components/plan/BarraTamanos";
import type { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { ESTRUCTURAS_OFICIALES_IDS, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { tonoCliente } from "@/lib/plan/presentacion-cliente";
import { hexDelCatalogo } from "@/lib/plan/referencia-sempertex";
import { HEX_COLORES_V2, PALETA_COLORES_V2 } from "@/lib/rag/taxonomy/v2";
import { colorCliente, conMayuscula } from "./formato";

/**
 * Lo que «Tu plan» (y la tarjeta de una idea) muestran de cada pieza: sus globos por color y por tamaño. Solo agrupa
 * y ordena lo que Python ya resolvió (`plan.estructuras[].lineas`) o lo que fijó la biblioteca: nunca cuenta, nunca
 * reparte y nunca calcula consumo. Sin React, para poder probarlo sin navegador (`scripts/test/test-tabla-globos.ts`).
 */

type PlanGuiado = z.infer<typeof PlanGuiadoSchema>;

/** Un tamaño de globo tal como se le dice al cliente. `pulgadas` solo en los redondos (los que dibuja la barra). */
export type TamanoGlobo = { clave: string; etiqueta: string; descripcion: string; orden: number; pulgadas: number | null };

/** Una línea de globos ya lista para mostrar: color (palabra del plan), su muestra Sempertex y cuántos lleva. */
export type LineaGlobo = {
  /** El color tal como lo escribe el plan («dorado», «rosa claro»). */
  color: string;
  /** El color de la paleta, si lo es. */
  paleta: string | null;
  /** «Dorado», «Rosa claro»: lo que lee el cliente. */
  etiqueta: string;
  /** El tono Sempertex del catálogo para ese color y acabado (o el de la paleta). */
  hex: string;
  /** Palabra de acabado del catálogo o el título del producto: con ella se pinta el globo (reflex, perlado…). */
  acabado: string | null;
  /** Un globo liso (sin impresos ni figuras). */
  liso: boolean;
  tamano: TamanoGlobo;
  unidades: number;
};

export type PiezaVista = {
  id: string;
  nombre: string;
  oficial: EstructuraOficialId | null;
  repeticiones: number;
  medidas: { ancho_m?: number; alto_m?: number; largo_m?: number };
  lineas: LineaGlobo[];
};

export type FilaTabla = { clave: string; color: string; etiqueta: string; hex: string; acabado: string | null; pulgadas: number | null; celdas: number[]; total: number };
export type TablaGlobos = { columnas: TamanoGlobo[]; filas: FilaTabla[]; totalesColumna: number[]; total: number };

const GRIS = "#9ca3af";
/** Lo que no es un globo liso: impresos, figuras, frases, números y letras. Misma idea que la regla del plan guiado. */
const GLOBO_NO_LISO = /impres|estampad|feliz|happy|te amo|love|infinity|bal[oó]n|f[uú]tbol|n[uú]mero|letra|personaje|figura|cortina|confeti/i;

/** Del código o del diámetro de una línea a su tamaño para el cliente; los no redondos tienen su propio grupo. */
export function tamanoDeLinea(linea: { diam_pulg?: number | null; tamano_codigo?: string | null; forma?: string | null }): TamanoGlobo {
  const codigo = (linea.tamano_codigo ?? "").trim().toUpperCase();
  const forma = (linea.forma ?? "").trim().toLowerCase();
  const numero = (texto: string): number | null => {
    const valor = Number.parseFloat(texto.replace(",", "."));
    return Number.isFinite(valor) && valor > 0 ? valor : null;
  };
  const link = /^LOL\s*-?\s*(\d+(?:[.,]\d+)?)/.exec(codigo);
  if (link || /link|eslab/.test(forma)) {
    const n = (link ? numero(link[1]!) : null) ?? linea.diam_pulg ?? 0;
    return { clave: `LOL-${n}`, etiqueta: n ? `Link ${n}″` : "Link", descripcion: n ? `Link de ${n} pulgadas` : "Globo link", orden: 100 + n, pulgadas: null };
  }
  const corazon = /^(?:C|CORAZ[OÓ]N)\s*-?\s*(\d+(?:[.,]\d+)?)/.exec(codigo);
  if (corazon || /coraz/.test(forma)) {
    const n = (corazon ? numero(corazon[1]!) : null) ?? linea.diam_pulg ?? 0;
    return { clave: `C-${n}`, etiqueta: n ? `Corazón ${n}″` : "Corazón", descripcion: n ? `Corazón de ${n} pulgadas` : "Globo corazón", orden: 200 + n, pulgadas: null };
  }
  if (/^T\s*-?\s*\d{3}/.test(codigo) || /model|tubit|largo/.test(forma)) {
    return { clave: "TUBITO", etiqueta: "Tubito", descripcion: "Globo largo para modelar", orden: 300, pulgadas: null };
  }
  const metalizado = /^(\d+(?:[.,]\d+)?)\s*(?:IN|")/.exec(codigo);
  if (metalizado || /metaliz|foil/.test(forma)) {
    const n = (metalizado ? numero(metalizado[1]!) : null) ?? linea.diam_pulg ?? 0;
    return { clave: `MET-${n}`, etiqueta: n ? `Metalizado ${n}″` : "Metalizado", descripcion: n ? `Metalizado de ${n} pulgadas` : "Globo metalizado", orden: 400 + n, pulgadas: null };
  }
  const redondo = /^R\s*-?\s*(\d+(?:[.,]\d+)?)/.exec(codigo);
  const pulgadas = linea.diam_pulg && linea.diam_pulg > 0 ? linea.diam_pulg : redondo ? numero(redondo[1]!) : null;
  if (pulgadas !== null && (forma === "" || forma === "redondo" || redondo)) {
    return { clave: `R-${pulgadas}`, etiqueta: `${pulgadas}″`, descripcion: `${pulgadas} pulgadas`, orden: pulgadas, pulgadas };
  }
  return { clave: "OTROS", etiqueta: "Otros", descripcion: "Otros globos", orden: 999, pulgadas: null };
}

function enPaleta(color: string): (typeof PALETA_COLORES_V2)[number] | null {
  const clave = color.trim().toLocaleLowerCase("es");
  return (PALETA_COLORES_V2 as readonly string[]).includes(clave) ? clave as (typeof PALETA_COLORES_V2)[number] : null;
}

/** El tono de un color: el del catálogo Sempertex para ese acabado si lo hay; si no, el de la paleta; si no, gris. */
export function hexColor(color: string, opciones: { titulo?: string | null; acabado?: string | null } = {}): string {
  if (color.startsWith("#") && /^#[0-9a-f]{6}$/i.test(color)) return color;
  const paleta = enPaleta(color);
  const tono = opciones.titulo ? tonoCliente(color, opciones.titulo) : color;
  const delCatalogo = hexDelCatalogo(tono, opciones.acabado ?? null);
  return delCatalogo ?? (paleta ? HEX_COLORES_V2[paleta] : null) ?? GRIS;
}

/**
 * Una línea de globos a partir de sus datos crudos (los de Python o los de la biblioteca). `null` si no tiene
 * unidades: una línea en 0 no se muestra.
 */
export function lineaGlobo(datos: { color?: string | null; diam_pulg?: number | null; tamano_codigo?: string | null; forma?: string | null; titulo?: string | null; acabado?: string | null; unidades: number }): LineaGlobo | null {
  if (!Number.isFinite(datos.unidades) || datos.unidades <= 0) return null;
  const color = datos.color?.trim() || "otro color";
  const paleta = enPaleta(color);
  const titulo = datos.titulo?.trim() || null;
  return {
    color,
    paleta,
    etiqueta: conMayuscula(paleta ? colorCliente(color) : color),
    hex: hexColor(color, { titulo, acabado: datos.acabado ?? null }),
    acabado: datos.acabado?.trim() || titulo,
    liso: !GLOBO_NO_LISO.test(`${titulo ?? ""} ${datos.forma ?? ""}`),
    tamano: tamanoDeLinea(datos),
    unidades: datos.unidades,
  };
}

const LineaPlanSchema = z.object({
  color: z.string().nullish(),
  diam_pulg: z.number().nullish(),
  tamano_codigo: z.string().nullish(),
  forma: z.string().nullish(),
  titulo: z.string().nullish(),
  acabado: z.string().nullish(),
  unidades: z.number(),
}).passthrough();

/** Las líneas de una pieza tal como las resolvió Python (con sus repeticiones ya contadas). */
export function lineasDePieza(plan: PlanGuiado, estructuraId: string): LineaGlobo[] {
  const crudas = plan.estructuras.find((estructura) => estructura.estructura_id === estructuraId)?.lineas ?? [];
  return crudas.flatMap((cruda) => {
    const leida = LineaPlanSchema.safeParse(cruda);
    const linea = leida.success ? lineaGlobo(leida.data) : null;
    return linea ? [linea] : [];
  });
}

/** Cuántos globos de cada color, en el orden en que aparecen (el de los chips de siempre). */
export function globosPorColor(lineas: readonly LineaGlobo[]): Array<{ color: string; etiqueta: string; hex: string; acabado: string | null; pulgadas: number | null; cantidad: number }> {
  const porColor = new Map<string, { color: string; etiqueta: string; hex: string; acabado: string | null; pulgadas: number | null; cantidad: number; mayor: number }>();
  for (const linea of lineas) {
    const actual = porColor.get(linea.color);
    if (!actual) {
      porColor.set(linea.color, { color: linea.color, etiqueta: linea.etiqueta, hex: linea.hex, acabado: linea.acabado, pulgadas: linea.tamano.pulgadas, cantidad: linea.unidades, mayor: linea.unidades });
      continue;
    }
    actual.cantidad += linea.unidades;
    // La muestra del chip es la del tamaño que más lleva de ese color.
    if (linea.unidades > actual.mayor) Object.assign(actual, { pulgadas: linea.tamano.pulgadas, mayor: linea.unidades });
  }
  return [...porColor.values()].map((globo) => ({ color: globo.color, etiqueta: globo.etiqueta, hex: globo.hex, acabado: globo.acabado, pulgadas: globo.pulgadas, cantidad: globo.cantidad }));
}

/** Los tramos de la barra de tamaños (solo los redondos, que son los que tienen pulgadas). */
export function tramosDe(lineas: readonly LineaGlobo[]): TramoTamano[] {
  return tramosPorTamano(lineas.filter((linea) => linea.tamano.pulgadas !== null).map((linea) => ({ pulgadas: linea.tamano.pulgadas, unidades: linea.unidades })));
}

/** La tabla de una pieza: filas = colores (orden de aparición), columnas = solo los tamaños presentes (ordenados). */
export function tablaGlobos(lineas: readonly LineaGlobo[]): TablaGlobos {
  const columnas = [...new Map(lineas.map((linea) => [linea.tamano.clave, linea.tamano])).values()].sort((a, b) => a.orden - b.orden);
  const indice = new Map(columnas.map((columna, posicion) => [columna.clave, posicion]));
  const filas = new Map<string, FilaTabla>();
  for (const linea of lineas) {
    let fila = filas.get(linea.color);
    if (!fila) {
      fila = { clave: linea.color, color: linea.color, etiqueta: linea.etiqueta, hex: linea.hex, acabado: linea.acabado, pulgadas: linea.tamano.pulgadas, celdas: columnas.map(() => 0), total: 0 };
      filas.set(linea.color, fila);
    }
    fila.celdas[indice.get(linea.tamano.clave)!]! += linea.unidades;
    fila.total += linea.unidades;
  }
  const lista = [...filas.values()];
  const totalesColumna = columnas.map((_, posicion) => lista.reduce((suma, fila) => suma + fila.celdas[posicion]!, 0));
  return { columnas, filas: lista, totalesColumna, total: totalesColumna.reduce((suma, valor) => suma + valor, 0) };
}

export function idOficial(valor: unknown): EstructuraOficialId | null {
  return typeof valor === "string" && (ESTRUCTURAS_OFICIALES_IDS as readonly string[]).includes(valor) ? valor as EstructuraOficialId : null;
}

/** Las piezas de «Tu plan», en el orden del plan, con sus globos tal como los resolvió Python. */
export function piezasVistaDePlan(plan: PlanGuiado): PiezaVista[] {
  return plan.plan.estructuras.map((pieza) => ({
    id: pieza.estructura_id,
    nombre: pieza.nombre,
    oficial: idOficial(pieza.estructura_oficial),
    repeticiones: pieza.repeticiones,
    medidas: {
      ...(pieza.medidas.ancho_m !== undefined ? { ancho_m: pieza.medidas.ancho_m } : {}),
      ...(pieza.medidas.alto_m !== undefined ? { alto_m: pieza.medidas.alto_m } : {}),
      ...(pieza.medidas.largo_m !== undefined ? { largo_m: pieza.medidas.largo_m } : {}),
    },
    lineas: lineasDePieza(plan, pieza.estructura_id),
  }));
}
