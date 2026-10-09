import { PREFIJO_NO_PUDE } from "./prefijo-no-pude";
import { ErrorHerramienta, resolverColorFlexible, resolverColorOrganico } from "../herramientas-escena-colores";
import { FEMENINAS } from "@/lib/plan/piezas-individuales";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { clasificarColores, plegarTexto } from "@/lib/rag/taxonomy/v2";
import { coloresDePalabra, nombreClienteDeReferencia, normalizarPesos, type ColorResuelto } from "./colores-espec";
import type { ColorEspec, EspecClienteV1, PiezaEspec } from "./espec-cliente-v1";

/**
 * Lo que comparten las operaciones de edición de la espec (`ediciones-*.ts`): el resultado honesto de cada una, cómo se
 * eligen las piezas y cómo se leen los colores que dice el cliente. Puro: sin red, sin hora y sin azar.
 */
export type ResultadoEdicion = {
  /** La espec editada; si nada se pudo hacer, la misma que entró. */
  espec: EspecClienteV1;
  /** Lo que el cliente debe saber además de lo hecho (un color sustituido, una medida acotada, una pieza que se saltó). */
  avisos: string[];
  /** Lo que se hizo, en pasado y en palabras de cliente («puse más dorado en la columna izquierda»). Vacío si no se hizo nada. */
  descripcion: string;
  /** Las piezas cuya espec cambió. */
  tocadas: string[];
  /** «No pude: …», en palabras de cliente: la operación no cambió nada y dice por qué (D-023). */
  noAplicado?: string;
};


export function noAplicado(espec: EspecClienteV1, motivo: string, avisos: string[] = []): ResultadoEdicion {
  return { espec, avisos, descripcion: "", tocadas: [], noAplicado: `${PREFIJO_NO_PUDE}${motivo}` };
}

/** Las piezas de la espec con ids nuevos (`cambios`), en su orden y con el origen puesto en «edición». */
export function conPiezasCambiadas(espec: EspecClienteV1, cambios: ReadonlyMap<string, PiezaEspec>): EspecClienteV1 {
  return { ...espec, origen: origenEditado(espec), piezas: espec.piezas.map((pieza) => cambios.get(pieza.id) ?? pieza) };
}

export function origenEditado(espec: EspecClienteV1): EspecClienteV1["origen"] {
  return { tipo: "edicion", ...(espec.origen.ideaIds ? { ideaIds: espec.origen.ideaIds } : {}) };
}

export const plegar = (texto: string): string => plegarTexto(texto);

export function listaNatural(elementos: readonly string[]): string {
  if (elementos.length <= 1) return elementos[0] ?? "";
  return `${elementos.slice(0, -1).join(", ")} y ${elementos.at(-1)}`;
}

/** «la columna izquierda», «el semiarco orgánico». */
export function conArticulo(pieza: Pick<PiezaEspec, "oficial" | "nombre">): string {
  return `${FEMENINAS.has(pieza.oficial) ? "la" : "el"} ${pieza.nombre.toLocaleLowerCase("es")}`;
}

/** Dónde pasó el cambio: «en la columna izquierda y la columna derecha», o «en todo el plan» si tocó todas las piezas. */
export function enPiezas(espec: EspecClienteV1, tocadas: readonly PiezaEspec[]): string {
  if (tocadas.length === espec.piezas.length && tocadas.length > 1) return "en todo el plan";
  return `en ${listaNatural(tocadas.map(conArticulo))}`;
}

export type Seleccion = { piezas: PiezaEspec[] } | { faltan: string[] };

/** Las piezas con esos ids (todas si no se dice ninguno). Un id que el plan no tiene se dice, no se ignora. */
export function seleccionar(espec: EspecClienteV1, ids: readonly string[] | undefined): Seleccion {
  if (!ids?.length) return { piezas: [...espec.piezas] };
  const faltan = ids.filter((id) => !espec.piezas.some((pieza) => pieza.id === id));
  if (faltan.length) return { faltan };
  return { piezas: espec.piezas.filter((pieza) => ids.includes(pieza.id)) };
}

export const MOTIVO_PIEZA_AUSENTE = "no encontré esa pieza en tu plan.";

// --- Colores ----------------------------------------------------------------------------------------------------

/** Un color como lo dice el cliente: el código Sempertex de tres cifras o una palabra del catálogo de colores. */
export function resolverColorDicho(texto: string): ColorResuelto[] {
  const limpio = texto.trim();
  if (/^\d{3}$/.test(limpio)) {
    const referencia = referenciaPorCodigo(limpio);
    return referencia ? [{ codigo: referencia.codigo, nombre: nombreClienteDeReferencia(referencia) }] : [];
  }
  return coloresDePalabra(limpio);
}

export const nombreDeCodigo = (codigo: string): string => {
  const referencia = referenciaPorCodigo(codigo);
  return referencia ? nombreClienteDeReferencia(referencia) : codigo;
};

const minuscula = (texto: string): string => texto.toLocaleLowerCase("es");
export const nombreColor = (color: Pick<ColorEspec, "nombre">): string => minuscula(color.nombre);

const familiaDe = (texto: string): string | null => clasificarColores(texto).values[0] ?? null;

/**
 * Los lugares donde una pieza lleva el color que dice `ref` (código o palabra): primero el mismo código o el mismo nombre;
 * si la pieza no lo lleva así, los de su misma familia («azul» sirve para un «Fashion Azul Rey»). Vacío si no lo lleva.
 */
export function indicesDeColor(pieza: Pick<PiezaEspec, "colores">, ref: string): number[] {
  const limpio = ref.trim();
  const plegado = plegar(limpio);
  const exactos = pieza.colores.flatMap((color, indice) => (color.codigo === limpio || plegar(color.nombre) === plegado ? [indice] : []));
  if (exactos.length) return exactos;
  const delPedido = resolverColorDicho(limpio).map((color) => color.codigo);
  const porCodigo = pieza.colores.flatMap((color, indice) => (delPedido.includes(color.codigo) ? [indice] : []));
  if (porCodigo.length) return porCodigo;
  const familia = familiaDe(limpio);
  return familia === null ? [] : pieza.colores.flatMap((color, indice) => (familiaDe(color.nombre) === familia ? [indice] : []));
}

const TRENZA = new Set(["arco", "columna", "guirnalda"]);

/** Los formatos con que se arma el cuerpo de una pieza de cuartetos o de malla; null si es orgánica (varios tamaños). */
function formatosDeCuerpo(pieza: Pick<PiezaEspec, "oficial" | "tamanos">): readonly string[] | null {
  if (pieza.oficial === "pared_densa") return ["LOL-12"];
  if (pieza.oficial === "bouquet" || pieza.oficial === "racimo_pared" || pieza.oficial === "techo_globos") return ["R-12"];
  return TRENZA.has(pieza.oficial) && pieza.tamanos === "clasica" ? ["R-12"] : null;
}

/**
 * El mismo color, o el más parecido que sí se fabrica en los globos de esa pieza, diciéndolo. Así la espec guarda lo que
 * de verdad se compra y nada se sustituye en silencio al armar. `formatos` fuerza otro tamaño (las flores, de 5″).
 */
export function colorFabricable(color: ColorResuelto, pieza: Pick<PiezaEspec, "oficial" | "nombre" | "tamanos">, avisos: string[], formatos?: readonly string[]): ColorResuelto {
  const notas: string[] = [];
  let codigo = color.codigo;
  try {
    const propios = formatos ?? formatosDeCuerpo(pieza);
    codigo = propios ? resolverColorFlexible(color.codigo, propios, notas) : resolverColorOrganico(color.codigo, notas).codigo;
  } catch (error) {
    if (!(error instanceof ErrorHerramienta)) throw error;
    return color;
  }
  if (codigo === color.codigo) return color;
  const nombre = nombreDeCodigo(codigo);
  avisos.push(`«${color.nombre}» no se fabrica en los globos de ${formatos ? "las flores" : conArticulo(pieza)}: puse «${nombre}», el más parecido.`);
  return { codigo, nombre };
}

/** Los colores de una pieza con pesos que suman 1 (tres decimales), en el orden recibido. */
export function conPesosNormalizados(colores: ReadonlyArray<Pick<ColorEspec, "codigo" | "nombre"> & { peso: number }>): ColorEspec[] {
  const pesos = normalizarPesos(colores.map((color) => color.peso));
  return colores.map((color, indice) => ({ codigo: color.codigo, nombre: color.nombre, peso: pesos[indice]! }));
}

export const mismosColores = (a: readonly ColorEspec[], b: readonly ColorEspec[]): boolean => (
  a.length === b.length && a.every((color, indice) => color.codigo === b[indice]!.codigo && Math.abs(color.peso - b[indice]!.peso) < 0.0005)
);
