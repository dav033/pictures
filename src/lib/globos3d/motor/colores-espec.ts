import { referenciaDelCatalogo, referenciaDelTitulo, referenciaPorCodigo, type ReferenciaSempertex } from "@/lib/plan/referencia-sempertex";
import { clasificarColores, clasificarTonos, COLORES_PROPUESTA_V2, plegarTexto, type ColorPropuestaV2 } from "@/lib/rag/taxonomy/v2";

/**
 * **De lo que dice el cliente, o de lo que compra el plan, a un código Sempertex.** Sin modelo y sin búsqueda: dos
 * caminos deterministas.
 *
 * - Palabras del cliente (`COLORES_PROPUESTA_V2` y los tonos claros): una tabla revisada a mano. No se deja a
 *   `referenciaDelCatalogo(«dorado», null)`, que devuelve la primera referencia de la lámina (el Silk Dorado, un
 *   perlado que casi nadie pide) y no la que la tienda vende como «dorado».
 * - Materiales de un plan (título del producto, color y acabado): `referenciaDelTitulo` y `referenciaDelCatalogo`, que
 *   son las mismas que usa la guía de escena de Python.
 *
 * Los códigos de abajo salen de `contracts/domain/v1/sempertex/tabla-color.json`; la prueba de cobertura exige que
 * existan y que cada palabra de la paleta resuelva.
 */

export type ColorResuelto = { codigo: string; nombre: string };

/** Qué código compra la tienda cuando el cliente dice cada palabra. «multicolor» son cuatro, a partes iguales. */
const CODIGOS_POR_PALABRA: Readonly<Record<ColorPropuestaV2, readonly string[]>> = {
  dorado: ["970"], // Reflex Dorado, el que usan las ideas del catálogo
  "dorado rosa": ["968"], // Reflex Dorado Rosa
  plateado: ["981"], // Reflex Plata
  rojo: ["015"],
  azul: ["040"],
  rosado: ["009"],
  verde: ["030"],
  blanco: ["005"],
  negro: ["080"],
  morado: ["051"], // Fashion Violeta
  naranja: ["061"],
  amarillo: ["020"],
  fucsia: ["012"],
  transparente: ["390"], // Cristal Transparente
  multicolor: ["015", "020", "040", "030"],
  lila: ["050"],
  turquesa: ["038"], // Azul Caribe, el turquesa vivo; el 035 es un verde petróleo
  beige: ["071"], // Fashion Arena
  cafe: ["074"],
  champagne: ["971"], // Reflex Champaña
  violeta: ["051"],
  coral: ["059"], // Fashion Coral Tropical
  menta: ["826"], // Silk Verde Menta
  crema: ["107"], // Pastel Dusk Crema
  nude: ["661"], // Pastel Mate Nude
  burdeos: ["018"], // Fashion Merlot
  celeste: ["640"], // Pastel Mate Azul («pale blue», el tono claro de TONOS_V2)
  "rosa pastel": ["609"], // Pastel Mate Rosado («light pink»)
  durazno: ["060"],
};

/** Palabras que el cliente dice y que la paleta no tiene: cada una es un tono propio de la lámina. */
const CODIGOS_POR_PALABRA_EXTRA: Readonly<Record<string, readonly string[]>> = {
  "verde salvia": ["027"], // Fashion Eucalipto: «sage green» en la lámina
  salvia: ["027"],
  eucalipto: ["027"],
  "verde eucalipto": ["027"],
  "azul rey": ["041"],
  "azul naval": ["044"],
  "azul marino": ["044"],
  marino: ["044"],
  navy: ["044"],
  "azul caribe": ["038"],
  "verde lima": ["031"],
  lima: ["031"],
  "verde selva": ["032"],
  esmeralda: ["032"],
  "palo de rosa": ["010"],
  "rosa palo": ["010"],
  mostaza: ["023"],
  chocolate: ["076"],
};

export const PALABRAS_REVISADAS: readonly string[] = [...COLORES_PROPUESTA_V2, ...Object.keys(CODIGOS_POR_PALABRA_EXTRA)];

/** Cómo se nombra una referencia al cliente: el tono, y la línea solo cuando no es la Fashion de siempre. */
export function nombreClienteDeReferencia(referencia: ReferenciaSempertex): string {
  return referencia.familia === "fashion" ? referencia.nombre : referencia.nombreCompleto;
}

function resueltos(codigos: readonly string[], palabra: string): ColorResuelto[] {
  return codigos.map((codigo) => {
    const referencia = referenciaPorCodigo(codigo);
    if (!referencia) throw new Error(`La tabla de colores revisada apunta al código ${codigo}, que no está en la lámina Sempertex.`);
    return { codigo, nombre: codigos.length > 1 ? nombreClienteDeReferencia(referencia) : palabra };
  });
}

/**
 * Una palabra de color del cliente → sus códigos (uno, o varios si es «multicolor»). `[]` si no la reconoce: el que
 * llama decide qué hacer, no se inventa un color.
 */
export function coloresDePalabra(texto: string): ColorResuelto[] {
  const plegado = plegarTexto(texto);
  if (!plegado) return [];
  const extra = CODIGOS_POR_PALABRA_EXTRA[plegado];
  if (extra) return resueltos(extra, texto.trim());
  const exacta = COLORES_PROPUESTA_V2.find((palabra) => plegarTexto(palabra) === plegado);
  if (exacta) return resueltos(CODIGOS_POR_PALABRA[exacta], texto.trim());
  const tono = clasificarTonos(texto).values[0];
  if (tono) return resueltos(CODIGOS_POR_PALABRA[tono], texto.trim());
  const color = clasificarColores(texto).values[0];
  if (color) return resueltos(CODIGOS_POR_PALABRA[color], texto.trim());
  return [];
}

export type MaterialDePlan = { titulo?: string | null; color?: string | null; acabado?: string | null };

/**
 * Lo que compra un material del plan → su código. Manda el título del producto («Fashion Azul Rey»): el color del plan
 * es la familia («azul») y la familia cae en el Azul 040, un cian. Sin título que nombre un solo tono, el color con
 * su acabado; sin acabado, la tabla revisada. Un producto que no es un tono (un surtido impreso) cae en su color.
 */
export function coloresDeMaterial(material: MaterialDePlan): ColorResuelto[] {
  const acabado = material.acabado?.trim() || null;
  const delTitulo = referenciaDelTitulo(material.titulo, acabado);
  if (delTitulo) return [{ codigo: delTitulo.codigo, nombre: nombreClienteDeReferencia(delTitulo) }];
  if (material.titulo && /\btransparente\b/i.test(material.titulo)) return resueltos(CODIGOS_POR_PALABRA.transparente, "transparente");
  const color = material.color?.trim();
  if (!color) return [];
  const delCatalogo = acabado ? referenciaDelCatalogo(color, acabado) : null;
  if (delCatalogo) return [{ codigo: delCatalogo.codigo, nombre: nombreClienteDeReferencia(delCatalogo) }];
  return coloresDePalabra(color);
}

/** Pesos que suman exactamente 1 con tres decimales (el último absorbe el redondeo), en el orden recibido. */
export function normalizarPesos(brutos: readonly number[]): number[] {
  const total = brutos.reduce((suma, p) => suma + p, 0);
  if (!(total > 0)) return brutos.map(() => 1 / Math.max(1, brutos.length));
  const redondos = brutos.map((p) => Math.max(0.001, Math.round((p / total) * 1000) / 1000));
  const resto = Math.round((1 - redondos.slice(0, -1).reduce((suma, p) => suma + p, 0)) * 1000) / 1000;
  return [...redondos.slice(0, -1), Math.max(0.001, resto)];
}

export type ColorConPeso = ColorResuelto & { peso: number };

/**
 * Colores con su peso, sin repetir códigos (los pesos de un mismo código se suman) y hasta `maximo`: los de más peso
 * se quedan y lo que se deja fuera se dice. Los pesos salen normalizados a 1.
 */
export function colorConPesos(brutos: ReadonlyArray<ColorResuelto & { peso: number }>, maximo: number, avisos: string[]): ColorConPeso[] {
  const porCodigo = new Map<string, ColorResuelto & { peso: number }>();
  for (const color of brutos) {
    const previo = porCodigo.get(color.codigo);
    porCodigo.set(color.codigo, previo ? { ...previo, peso: previo.peso + color.peso } : { ...color });
  }
  let lista = [...porCodigo.values()];
  if (lista.length > maximo) {
    avisos.push(`Una pieza lleva hasta ${maximo} colores: se dejaron fuera ${lista.length - maximo} de los de menos peso.`);
    const conservados = new Set([...lista].sort((a, b) => b.peso - a.peso).slice(0, maximo).map((c) => c.codigo));
    lista = lista.filter((c) => conservados.has(c.codigo));
  }
  const pesos = normalizarPesos(lista.map((c) => c.peso));
  return lista.map((c, i) => ({ codigo: c.codigo, nombre: c.nombre, peso: pesos[i]! }));
}

/** Las palabras de color del cliente → colores a partes iguales (una palabra que no se reconoce se dice y se omite). */
export function coloresDePalabras(palabras: readonly string[], maximo: number, avisos: string[]): ColorConPeso[] {
  const brutos = palabras.flatMap((palabra) => {
    const colores = coloresDePalabra(palabra);
    if (!colores.length) avisos.push(`No reconocí el color «${palabra}»: no se usó.`);
    return colores.map((c) => ({ ...c, peso: 1 / (palabras.length * colores.length) }));
  });
  if (!brutos.length) {
    avisos.push("Ninguno de los colores se reconoció: la pieza queda en blanco.");
    return [{ codigo: "005", nombre: "blanco", peso: 1 }];
  }
  return colorConPesos(brutos, maximo, avisos);
}
