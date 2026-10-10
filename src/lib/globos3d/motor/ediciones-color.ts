import { PARTICIPACION_MINIMA_REPARTO } from "@/lib/plan/edicion-esquemas";
import { PREFIJO_NO_PUDE } from "@/lib/prefijo-no-pude";
import { colorConPesos } from "./colores-espec";
import { coloresNombrados } from "./color-en-pieza";
import {
  colorEnPalabras, colorFabricable, conArticulo, conPesosNormalizados, conPiezasCambiadas, enPiezas, listaNatural,
  MOTIVO_PIEZA_AUSENTE, mismosColores, nombreColor, noAplicado, resolverColorDicho, seleccionar, type ResultadoEdicion,
} from "./ediciones-comunes";
import type { EdicionEspecV1 } from "./edicion-espec-v1";
import { MAX_COLORES_PIEZA, type ColorEspec, type EspecClienteV1, type PiezaEspec } from "./espec-cliente-v1";

/**
 * Las ediciones de COLOR de la espec: cambiar un color por otro, sumar o quitar uno, y mover su proporción. Cada pieza
 * conserva todo lo demás (medidas, tamaños, nombre); los pesos de los colores suman siempre 1.
 */
export const PASO_PROPORCION = 0.1;
export const PROPORCION_MINIMA = PARTICIPACION_MINIMA_REPARTO;
const TOLERANCIA_IGUAL = 0.005;

type Op<T extends EdicionEspecV1["op"]> = Extract<EdicionEspecV1, { op: T }>;

/**
 * Entrega el resultado de recorrer las piezas: lo cambiado, lo saltado y por qué. Las piezas donde no se sabe qué color dijo
 * el cliente (`dudas`) no se tocan: si nada cambió son el motivo; si algo cambió, van en `sinHacer` como «No pude: …», que
 * llega entero al cliente (los avisos se recortan).
 */
function resultado(espec: EspecClienteV1, cambios: Map<string, PiezaEspec>, avisos: string[], dudas: readonly string[], descripcion: (tocadas: PiezaEspec[]) => string, sinCambio: string): ResultadoEdicion {
  if (!cambios.size) {
    // Sin cambio, se dice el motivo (la duda, o el genérico) y, detrás, el aviso que explica por qué (el máximo de colores, una pieza que no lo admite).
    const motivo = dudas.length ? `${dudas.join("; ")}.` : sinCambio;
    return noAplicado(espec, avisos.length ? `${motivo} ${avisos.map((aviso) => aviso.charAt(0).toLocaleUpperCase("es") + aviso.slice(1)).join(" ")}` : motivo, avisos);
  }
  const nueva = conPiezasCambiadas(espec, cambios);
  const tocadas = nueva.piezas.filter((pieza) => cambios.has(pieza.id));
  return {
    espec: nueva, avisos, descripcion: descripcion(tocadas), tocadas: tocadas.map((pieza) => pieza.id),
    ...(dudas.length ? { sinHacer: dudas.map((duda) => `${PREFIJO_NO_PUDE}${duda}.`) } : {}),
  };
}

type Nombrados = ReturnType<typeof coloresNombrados>;

const dudasDe = (nombrados: Nombrados): string[] => [...nombrados.values()].flatMap((nombrado) => (nombrado.duda ? [nombrado.duda.texto] : []));

/**
 * Lo que no está. Si la tarjeta lo llama con otra palabra de la paleta, se pregunta si es esa («no encontré «azul claro»;
 * tu plan lleva azul: ¿es ese?», o «¿es alguno de esos?» si son varias); si no hay nada parecido, se dice que el plan no lo lleva.
 */
function noLleva(dicho: string, enEsasPiezas: boolean, nombrados: Nombrados): string {
  const parecidos = [...new Set([...nombrados.values()].flatMap((nombrado) => nombrado.parecidos.map((nombre) => nombreColor({ nombre }))))];
  const enPiezas = enEsasPiezas ? " en esas piezas" : "";
  if (!parecidos.length) return `tu plan no lleva ${colorEnPalabras(dicho)}${enPiezas}.`;
  return `no encontré «${colorEnPalabras(dicho)}»${enPiezas}; tu plan lleva ${listaNatural(parecidos)}: ${parecidos.length > 1 ? "¿es alguno de esos?" : "¿es ese?"}`;
}

export function reemplazarColor(espec: EspecClienteV1, edicion: Op<"reemplazar_color">): ResultadoEdicion {
  const seleccion = seleccionar(espec, edicion.piezas);
  if ("faltan" in seleccion) return noAplicado(espec, MOTIVO_PIEZA_AUSENTE);
  const destino = resolverColorDicho(edicion.a);
  if (!destino.length) return noAplicado(espec, `no reconozco el color «${edicion.a}».`);
  const avisos: string[] = [];
  const cambios = new Map<string, PiezaEspec>();
  const queEntra = seleccion.piezas.flatMap((pieza) => destino.map((color) => colorFabricable(color, pieza, []).codigo));
  const nombrados = coloresNombrados(espec, seleccion.piezas, edicion.de, queEntra);
  let saleNombre: string | null = null;
  for (const pieza of seleccion.piezas) {
    const salen = nombrados.get(pieza.id)!.indices;
    if (!salen.length) continue;
    saleNombre ??= nombreColor(pieza.colores[salen[0]!]!);
    const entran = destino.map((color) => colorFabricable(color, pieza, avisos));
    const total = salen.reduce((suma, indice) => suma + pieza.colores[indice]!.peso, 0);
    const colores: Array<Pick<ColorEspec, "codigo" | "nombre"> & { peso: number }> = [];
    pieza.colores.forEach((color, indice) => {
      if (!salen.includes(indice)) colores.push(color);
      else if (indice === salen[0]) colores.push(...entran.map((nuevo) => ({ ...nuevo, peso: total / entran.length })));
    });
    const nuevos = colorConPesos(colores, MAX_COLORES_PIEZA, avisos);
    if (mismosColores(pieza.colores, nuevos)) continue;
    cambios.set(pieza.id, { ...pieza, colores: nuevos });
  }
  const sinCambio = saleNombre ? `tu plan ya lleva ${nombreColor(destino[0]!)} donde estaba ${saleNombre}.` : noLleva(edicion.de, Boolean(edicion.piezas?.length), nombrados);
  return resultado(espec, cambios, avisos, dudasDe(nombrados), (tocadas) => `cambié ${saleNombre} por ${listaNatural(destino.map(nombreColor))} ${enPiezas(espec, tocadas)}`, sinCambio);
}

export function agregarColor(espec: EspecClienteV1, edicion: Op<"agregar_color">): ResultadoEdicion {
  const seleccion = seleccionar(espec, edicion.piezas);
  if ("faltan" in seleccion) return noAplicado(espec, MOTIVO_PIEZA_AUSENTE);
  const colores = resolverColorDicho(edicion.color);
  if (!colores.length) return noAplicado(espec, `no reconozco el color «${edicion.color}».`);
  const avisos: string[] = [];
  const cambios = new Map<string, PiezaEspec>();
  for (const pieza of seleccion.piezas) {
    const nuevos = colores.map((color) => colorFabricable(color, pieza, avisos)).filter((color) => !pieza.colores.some((actual) => actual.codigo === color.codigo));
    if (!nuevos.length) { avisos.push(`${conArticulo(pieza)} ya lleva ${nombreColor(colores[0]!)}.`); continue; }
    const caben = MAX_COLORES_PIEZA - pieza.colores.length;
    if (caben <= 0) { avisos.push(`${conArticulo(pieza)} ya lleva el máximo de ${MAX_COLORES_PIEZA} colores.`); continue; }
    const agregados = nuevos.slice(0, caben);
    const cuantos = pieza.colores.length + agregados.length;
    const lista = [...pieza.colores.map((color) => ({ ...color, peso: color.peso * (pieza.colores.length / cuantos) })), ...agregados.map((color) => ({ ...color, peso: 1 / cuantos }))];
    cambios.set(pieza.id, { ...pieza, colores: conPesosNormalizados(lista) });
  }
  return resultado(espec, cambios, avisos, [], (tocadas) => `añadí ${listaNatural(colores.map(nombreColor))} ${enPiezas(espec, tocadas)}`, "esas piezas ya llevan ese color o no admiten otro más.");
}

export function quitarColor(espec: EspecClienteV1, edicion: Op<"quitar_color">): ResultadoEdicion {
  const seleccion = seleccionar(espec, edicion.piezas);
  if ("faltan" in seleccion) return noAplicado(espec, MOTIVO_PIEZA_AUSENTE);
  const avisos: string[] = [];
  const cambios = new Map<string, PiezaEspec>();
  const nombrados = coloresNombrados(espec, seleccion.piezas, edicion.color);
  let quitado = colorEnPalabras(edicion.color);
  let lleva = false;
  for (const pieza of seleccion.piezas) {
    const salen = nombrados.get(pieza.id)!.indices;
    if (!salen.length) continue;
    lleva = true;
    const quedan = pieza.colores.filter((_, indice) => !salen.includes(indice));
    if (!quedan.length) { avisos.push(`${conArticulo(pieza)} necesita al menos un color: puedes cambiarlo por otro.`); continue; }
    quitado = nombreColor(pieza.colores[salen[0]!]!);
    cambios.set(pieza.id, { ...pieza, colores: conPesosNormalizados(quedan) });
  }
  const sinCambio = lleva ? "cada pieza necesita al menos un color: puedes cambiarlo por otro." : noLleva(edicion.color, Boolean(edicion.piezas?.length), nombrados);
  return resultado(espec, cambios, avisos, dudasDe(nombrados), (tocadas) => `quité ${quitado} ${enPiezas(espec, tocadas)}`, sinCambio);
}

export function proporcionColor(espec: EspecClienteV1, edicion: Op<"proporcion_color">): ResultadoEdicion {
  const pieza = espec.piezas.find((item) => item.id === edicion.pieza);
  if (!pieza) return noAplicado(espec, MOTIVO_PIEZA_AUSENTE);
  if (edicion.pesos.length !== pieza.colores.length) return noAplicado(espec, `${conArticulo(pieza)} lleva ${pieza.colores.length} colores y me diste ${edicion.pesos.length} proporciones.`);
  const avisos: string[] = [];
  const total = edicion.pesos.reduce((suma, peso) => suma + peso, 0);
  const pedidos = edicion.pesos.map((peso) => peso / total);
  if (pedidos.some((peso) => peso < PROPORCION_MINIMA)) avisos.push(`Cada color lleva al menos ${Math.round(PROPORCION_MINIMA * 100)} % de ${conArticulo(pieza)}: subí los más pequeños.`);
  const colores = conPesosNormalizados(repartoConMinimo(pedidos).map((peso, indice) => ({ ...pieza.colores[indice]!, peso })));
  if (mismosColores(pieza.colores, colores)) return noAplicado(espec, `${conArticulo(pieza)} ya lleva esa proporción de colores.`, avisos);
  const cambios = new Map([[pieza.id, { ...pieza, colores }]]);
  return resultado(espec, cambios, avisos, [], () => `dejé ${conArticulo(pieza)} con ${listaNatural(colores.map((color) => `${Math.round(color.peso * 100)} % ${nombreColor(color)}`))}`, "");
}

/** Pesos que suman 1 y ninguno bajo el mínimo: lo que falta a los pequeños se lo quita a los demás en proporción. */
function repartoConMinimo(pesos: readonly number[]): number[] {
  let fijos = new Set<number>();
  for (let vuelta = 0; vuelta <= pesos.length; vuelta += 1) {
    const libres = pesos.flatMap((peso, indice) => (fijos.has(indice) ? [] : [peso]));
    const sumaLibres = libres.reduce((suma, peso) => suma + peso, 0);
    const resto = 1 - fijos.size * PROPORCION_MINIMA;
    const escala = sumaLibres > 0 ? resto / sumaLibres : 0;
    const nuevos = new Set(pesos.flatMap((peso, indice) => (!fijos.has(indice) && peso * escala < PROPORCION_MINIMA ? [indice] : [])));
    if (!nuevos.size) return pesos.map((peso, indice) => (fijos.has(indice) ? PROPORCION_MINIMA : peso * escala));
    fijos = new Set([...fijos, ...nuevos]);
  }
  return pesos.map(() => 1 / pesos.length);
}

export function masMenosColor(espec: EspecClienteV1, edicion: Op<"mas_menos_color">): ResultadoEdicion {
  const seleccion = seleccionar(espec, edicion.piezas);
  if ("faltan" in seleccion) return noAplicado(espec, MOTIVO_PIEZA_AUSENTE);
  const avisos: string[] = [];
  const cambios = new Map<string, PiezaEspec>();
  const nombrados = coloresNombrados(espec, seleccion.piezas, edicion.color);
  let nombre = colorEnPalabras(edicion.color);
  let lleva = false;
  for (const pieza of seleccion.piezas) {
    const indices = nombrados.get(pieza.id)!.indices;
    if (!indices.length) continue;
    lleva = true;
    nombre = nombreColor(pieza.colores[indices[0]!]!);
    if (pieza.colores.length < 2) { avisos.push(`${conArticulo(pieza)} lleva un solo color: para variar la proporción añade otro.`); continue; }
    const pedidos = pieza.colores.map((color, indice) => (indices.includes(indice) ? color.peso + edicion.direccion * PASO_PROPORCION / indices.length : color.peso));
    const pesos = nuevosPesos(pieza.colores.map((color) => color.peso), indices, pedidos);
    if (pesos.every((peso, indice) => Math.abs(peso - pieza.colores[indice]!.peso) < TOLERANCIA_IGUAL)) {
      avisos.push(`${conArticulo(pieza)} ya lleva ${edicion.direccion > 0 ? "todo el" : "lo mínimo de"} ${nombre} que admite.`);
      continue;
    }
    cambios.set(pieza.id, { ...pieza, colores: conPesosNormalizados(pieza.colores.map((color, indice) => ({ ...color, peso: pesos[indice]! }))) });
  }
  const sinCambio = lleva ? `esas piezas ya llevan ${edicion.direccion > 0 ? "todo el" : "lo mínimo de"} ${nombre} que admiten, o llevan un solo color.` : noLleva(edicion.color, Boolean(edicion.piezas?.length), nombrados);
  return resultado(espec, cambios, avisos, dudasDe(nombrados), (tocadas) => `puse ${edicion.direccion > 0 ? "más" : "menos"} ${nombre} ${enPiezas(espec, tocadas)}`, sinCambio);
}

/** El color (o colores) que se mueve toma `pedidos`, acotado; los demás se reparten lo que queda, cada uno en proporción a lo que tenía. */
function nuevosPesos(actuales: readonly number[], movidos: readonly number[], pedidos: readonly number[]): number[] {
  const otros = actuales.length - movidos.length;
  if (otros <= 0) return [...actuales];
  const maximoMovidos = 1 - otros * PROPORCION_MINIMA;
  const sumaMovidos = movidos.reduce((suma, indice) => suma + pedidos[indice]!, 0);
  const objetivo = Math.min(maximoMovidos, Math.max(movidos.length * PROPORCION_MINIMA, sumaMovidos));
  const sumaOtrosAntes = actuales.reduce((suma, peso, indice) => (movidos.includes(indice) ? suma : suma + peso), 0);
  const parcial = actuales.map((peso, indice) => (movidos.includes(indice) ? objetivo * (pedidos[indice]! / sumaMovidos) : peso * ((1 - objetivo) / sumaOtrosAntes)));
  return repartoConMinimo(parcial);
}
