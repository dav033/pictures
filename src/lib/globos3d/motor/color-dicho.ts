import { codigosDePedido, FAMILIAS_POR_PALABRA, palabras } from "../herramientas-escena-colores";
import { referenciaPorCodigo, TABLA_SEMPERTEX } from "@/lib/plan/referencia-sempertex";
import { clasificarColores, plegarTexto, TONOS_CLAROS_V2, TONOS_V2, type ColorPropuestaV2 } from "@/lib/rag/taxonomy/v2";
import { claveDePaleta, claveDeTono, CODIGOS_POR_PALABRA_EXTRA, coloresDePalabra, nombreClienteDeReferencia, type ColorResuelto } from "./colores-espec";

/**
 * **Lo que el cliente quiere decir con un color**, contra la lámina Sempertex: una frase («dorado», «dorado metal», «verde
 * salvia», «Pastel Mate Rosado», «970») da dos cosas distintas.
 * - `compra`: el color que se pone si lo pide como color nuevo (el que vende la tienda para esa palabra);
 * - `nombra`: TODOS los colores de la lámina que la frase puede ser, para buscarlos entre los que lleva una pieza. «dorado»
 *   es el Reflex Dorado que se compra, pero en una pieza nombra también el Metal Dorado y el Silk Dorado.
 * Puro: sin red, sin hora y sin azar.
 *
 * El orden importa y va de lo más preciso a lo más amplio: un código; el nombre completo («Reflex Dorado Rosa»); un tono
 * con nombre propio («verde salvia»); una palabra de la paleta o un tono claro («dorado», «rosa pastel»); el nombre propio
 * de un color que no se repite («moca»); un tono con su acabado («dorado metal», «rojo reflex»); y por último una palabra
 * de la paleta dentro de la frase («un azul bonito»). Con acabado, el acabado manda: «dorado metal» no es el Reflex.
 */
export type ColorInterpretado = {
  compra: ColorResuelto[];
  nombra: string[];
  /**
   * Si la frase es una palabra de la paleta, un tono o un sinónimo («azul», «rosa», «oro», «azul pastel»): nombra muchos
   * colores de la lámina. Un código, un nombre de la lámina o un tono con su acabado no lo son.
   */
  amplio: boolean;
};

const nada = (): ColorInterpretado => ({ compra: [], nombra: [], amplio: false });

function colorDeCodigo(codigo: string): ColorResuelto | null {
  const referencia = referenciaPorCodigo(codigo);
  return referencia ? { codigo, nombre: nombreClienteDeReferencia(referencia) } : null;
}

function deCodigo(codigo: string): ColorInterpretado {
  const color = colorDeCodigo(codigo);
  return color ? { compra: [color], nombra: [codigo], amplio: false } : nada();
}

const POR_NOMBRE_COMPLETO: ReadonlyMap<string, string> = new Map(TABLA_SEMPERTEX.referencias.map((r) => [plegarTexto(r.nombreCompleto), r.codigo]));

/** Los nombres propios que solo tiene un color de la lámina («moca», «gris», «frambuesa»); «azul» o «rosado» los tienen varios. */
const POR_NOMBRE_UNICO: ReadonlyMap<string, string> = (() => {
  const porNombre = new Map<string, string[]>();
  for (const r of TABLA_SEMPERTEX.referencias) porNombre.set(plegarTexto(r.nombre), [...(porNombre.get(plegarTexto(r.nombre)) ?? []), r.codigo]);
  return new Map([...porNombre].flatMap(([nombre, codigos]) => (codigos.length === 1 ? [[nombre, codigos[0]!] as const] : [])));
})();

/** Una línea que ni el cromado, ni el metal, ni el neón, ni el cristal pueden ser un tono claro (como en `plan/tonos-color.ts`). */
const NO_ES_CLARA = new Set(["reflex", "metal", "neon", "cristal"]);

/**
 * Los colores de la lámina que son de cada tono de la paleta: por su nombre («Metal Dorado» es dorado) y, si el nombre no
 * dice un color, por su nombre base en inglés («Eucalipto» es «sage green», un verde). Los tonos claros salen de los
 * nombres base que la taxonomía les da (`TONOS_V2`).
 */
const REFERENCIAS_DE_TONO: ReadonlyMap<string, readonly string[]> = (() => {
  const mapa = new Map<string, string[]>();
  const anotar = (clave: string, codigo: string): void => {
    const lista = mapa.get(clave) ?? [];
    if (!lista.includes(codigo)) mapa.set(clave, [...lista, codigo]);
  };
  for (const r of TABLA_SEMPERTEX.referencias) {
    const porNombre = clasificarColores(r.nombre).values;
    for (const clave of porNombre.length ? porNombre : clasificarColores(r.nombreBase).values) anotar(clave, r.codigo);
    if (NO_ES_CLARA.has(r.familia)) continue;
    for (const tono of TONOS_CLAROS_V2) if (TONOS_V2[tono].basesSempertex.includes(r.nombreBase)) anotar(tono, r.codigo);
  }
  return mapa;
})();

/** Un tono de la paleta: se compra el color de la tienda y se nombran todos los de ese tono, y siempre el que se compra. */
function deTono(clave: ColorPropuestaV2, texto: string): ColorInterpretado {
  const compra = coloresDePalabra(texto);
  const comprado = compra.length === 1 ? [compra[0]!.codigo] : [];
  return { compra, nombra: [...new Set([...comprado, ...(REFERENCIAS_DE_TONO.get(clave) ?? [])])], amplio: true };
}

const nombraAcabado = (texto: string): boolean => palabras(texto).some((palabra) => FAMILIAS_POR_PALABRA[palabra] !== undefined);

/**
 * Los colores de la línea que dice el acabado que son del tono que queda al quitarle las palabras de acabado («rosado dusk»:
 * la lámina llama «Rosa» al Pastel Dusk Rosa y la búsqueda por nombre no lo une con «rosado»; el tono sí). Con dos palabras
 * de acabado («pastel mate») valen las líneas que ambas admiten.
 */
function delTonoEnLinea(texto: string): string[] {
  const dichas = palabras(texto);
  const acabados = dichas.flatMap((palabra) => (FAMILIAS_POR_PALABRA[palabra] ? [FAMILIAS_POR_PALABRA[palabra]!] : []));
  const comunes = acabados.reduce((lineas, otras) => lineas.filter((linea) => otras.includes(linea)));
  const lineas = comunes.length ? comunes : acabados.flat();
  const tono = dichas.filter((palabra) => !FAMILIAS_POR_PALABRA[palabra]).join(" ");
  const clave = claveDeTono(tono) ?? claveDePaleta(tono);
  const delTono = clave ? REFERENCIAS_DE_TONO.get(clave) ?? [] : [];
  return delTono.filter((codigo) => lineas.includes(referenciaPorCodigo(codigo)?.familia ?? ""));
}

/**
 * Un tono con su acabado: los colores de esa línea que tienen ese tono y no otro más largo («dorado metal» es el 570, no el
 * 568 «Dorado Rosa»). Si la lámina no tiene ninguno («dorado mate»), no nombra a nadie en una pieza, y como color nuevo
 * se queda con el tono de la tienda, como antes.
 */
function conAcabado(texto: string): ColorInterpretado {
  const porNombre = codigosDePedido(texto);
  const codigos = porNombre.length ? porNombre : delTonoEnLinea(texto);
  const comprado = codigos.length ? colorDeCodigo(codigos[0]!) : null;
  return comprado ? { compra: [comprado], nombra: codigos, amplio: false } : { compra: coloresDePalabra(texto), nombra: [], amplio: false };
}

export function interpretarColor(texto: string): ColorInterpretado {
  const limpio = texto.trim();
  if (/^\d{3}$/.test(limpio)) return deCodigo(limpio);
  const plegado = plegarTexto(limpio);
  if (!plegado) return nada();
  const completo = POR_NOMBRE_COMPLETO.get(plegado);
  if (completo) return deCodigo(completo);
  const propio = CODIGOS_POR_PALABRA_EXTRA[plegado];
  if (propio) return { compra: coloresDePalabra(limpio), nombra: [...propio], amplio: false };
  const tono = claveDeTono(limpio);
  if (tono) return deTono(tono, limpio);
  const unico = POR_NOMBRE_UNICO.get(plegado);
  if (unico) return deCodigo(unico);
  if (nombraAcabado(limpio)) return conAcabado(limpio);
  const palabra = claveDePaleta(limpio);
  return palabra ? deTono(palabra, limpio) : nada();
}
