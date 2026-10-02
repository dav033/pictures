import { z } from "zod";
import type { LoraModeSlug } from "@/lib/lora/schema";
import { DIAMETROS_REDONDOS_CATALOGO_V2 } from "@/lib/rag/taxonomy/v2";
import { productoCliente, pulgadasCliente } from "@/lib/plan/presentacion-cliente";
import type { LineaMaterial } from "@/lib/plan/resuelto";
import { coloresDeBusqueda, familiaDeColores, nombreDeFamilia, ordenDeFamilia, type FamiliaDelCatalogo, type FamiliaId } from "./familias-color";

/**
 * Lógica pura del modal «Ajusta la propuesta»: arma las peticiones al explorador del catálogo, convierte lo que
 * devuelve en tarjetas y decide qué se puede aplicar. No hay React, ni red, ni reglas comerciales: qué globo se
 * puede vender, su precio y su color son del catálogo de Python; aquí solo se presenta y se valida lo que el
 * cliente escribió.
 */

export type ModoAjuste = "agregar" | "reemplazar";

/**
 * Tarjetas que se piden la primera vez (dos filas de cinco), cuántas más cada «Cargar más» y el tope que acepta el
 * servidor. Pocas al abrir: cada tarjeta es una foto y una fila del catálogo, y lo demás se pide si se quiere.
 */
export const LIMITE_INICIAL = 10;
export const PASO_LIMITE = 10;
export const LIMITE_MAXIMO = 40;

const VarianteDelServidorSchema = z.object({
  variantId: z.string().min(1),
  titulo: z.string().nullable(),
  disponible: z.boolean(),
  codigoTamano: z.string().nullable(),
  diamPulg: z.number().finite().nullable(),
  forma: z.string().nullable(),
  colores: z.array(z.string()),
});

/** Lo que `/api/plan-editar` devuelve por producto (`serializarCandidatos`); lo demás que trae no se usa aquí. */
const CandidatoDelServidorSchema = z.object({
  productId: z.string().min(1),
  titulo: z.string().min(1),
  imagen: z.string().nullable(),
  variantes: z.array(VarianteDelServidorSchema),
});

export type CandidatoDelServidor = z.infer<typeof CandidatoDelServidorSchema>;
type VarianteDelServidor = z.infer<typeof VarianteDelServidorSchema>;

const RespuestaBusquedaSchema = z.object({
  candidatos: z.array(CandidatoDelServidorSchema),
  hayMas: z.boolean().optional(),
});

const RespuestaColoresSchema = z.object({
  colores: z.array(z.object({ valor: z.string().min(1), total: z.number().int().nonnegative() })),
});

export type ColorCatalogo = { valor: string; total: number };

/** La respuesta de una búsqueda, validada en el borde: null si no tiene la forma que esta pantalla necesita. */
export function leerRespuestaBusqueda(datos: unknown): { candidatos: CandidatoDelServidor[]; hayMas: boolean } | null {
  const leido = RespuestaBusquedaSchema.safeParse(datos);
  return leido.success ? { candidatos: leido.data.candidatos, hayMas: leido.data.hayMas ?? false } : null;
}

/** La lista de colores del catálogo con cuántos globos lleva cada uno, validada en el borde. */
export function leerRespuestaColores(datos: unknown): ColorCatalogo[] | null {
  const leido = RespuestaColoresSchema.safeParse(datos);
  return leido.success ? leido.data.colores : null;
}

/** Tope de colores y de tamaños que el servidor acepta en una misma búsqueda. */
export const MAX_COLORES_BUSQUEDA = 8;
export const MAX_TAMANOS_BUSQUEDA = 8;

/** Diámetros de globo redondo que vende el catálogo (los mismos que acepta el filtro de tamaño). */
export const TAMANOS_PULGADAS: readonly number[] = DIAMETROS_REDONDOS_CATALOGO_V2;

/** Sin texto ni filtros se muestra el catálogo entero: una búsqueda de la palabra que todos los globos llevan. */
export const CONSULTA_CATALOGO_COMPLETO = "globo";

export const PARTICIPACION_MINIMA = 2;
export const PARTICIPACION_MAXIMA = 79;
export const PARTICIPACION_INICIAL = "20";

export type LineaObjetivo = { forma: string | null; diam_pulg: number | null };

export type EntradaBusqueda = {
  texto: string;
  colores: readonly string[];
  tamanos: readonly number[];
  limite: number;
  /** Sin token la búsqueda no queda fijada al catálogo de la propuesta (una propuesta sin procedencia firmada). */
  approvalToken?: string;
  loraMode?: LoraModeSlug;
  /** Línea que se cambia: un globo solo admite globos de su misma forma. */
  lineaObjetivo?: LineaObjetivo;
};

export type CuerpoBuscar = {
  modo: "buscar";
  consulta: string;
  approval_token?: string;
  loraMode?: LoraModeSlug;
  filtros?: { colores?: string[]; tamanos_pulgadas?: number[] };
  limite: number;
  linea_objetivo?: LineaObjetivo;
};

export type CuerpoColores = { modo: "colores"; approval_token?: string; loraMode?: LoraModeSlug };

function acotarLimite(limite: number): number {
  return Math.min(LIMITE_MAXIMO, Math.max(1, Math.floor(limite)));
}

/** La petición de `/api/plan-editar` que llena la grilla: el texto, los colores y tamaños elegidos y cuántas tarjetas. */
export function armarBusqueda(entrada: EntradaBusqueda): CuerpoBuscar {
  const texto = entrada.texto.trim();
  const colores = [...new Set(entrada.colores)].slice(0, MAX_COLORES_BUSQUEDA);
  const tamanos = [...new Set(entrada.tamanos)].slice(0, MAX_TAMANOS_BUSQUEDA);
  const hayFiltros = colores.length > 0 || tamanos.length > 0;
  const consulta = texto.length >= 2 ? texto : hayFiltros ? "" : CONSULTA_CATALOGO_COMPLETO;
  return {
    modo: "buscar",
    consulta,
    ...(entrada.approvalToken === undefined ? {} : { approval_token: entrada.approvalToken }),
    ...(entrada.loraMode === undefined ? {} : { loraMode: entrada.loraMode }),
    ...(hayFiltros ? { filtros: { ...(colores.length ? { colores } : {}), ...(tamanos.length ? { tamanos_pulgadas: tamanos } : {}) } } : {}),
    limite: acotarLimite(entrada.limite),
    ...(entrada.lineaObjetivo ? { linea_objetivo: entrada.lineaObjetivo } : {}),
  };
}

export function armarPeticionColores(approvalToken: string | undefined, loraMode?: LoraModeSlug): CuerpoColores {
  return { modo: "colores", ...(approvalToken === undefined ? {} : { approval_token: approvalToken }), ...(loraMode === undefined ? {} : { loraMode }) };
}

/** Forma y tamaño de la línea que se cambia; una línea sin diámetro (telón, kit) admite cualquier producto. */
export function lineaObjetivoDe(linea: Pick<LineaMaterial, "forma" | "diam_pulg"> | undefined): LineaObjetivo | undefined {
  if (!linea || linea.diam_pulg == null) return undefined;
  return { forma: linea.forma ?? null, diam_pulg: linea.diam_pulg };
}

/** Tamaño de la línea que se cambia como filtro de entrada, si el catálogo lo vende. */
export function tamanoInicialDe(linea: Pick<LineaMaterial, "diam_pulg"> | undefined): number[] {
  const diametro = linea?.diam_pulg;
  return diametro != null && TAMANOS_PULGADAS.includes(diametro) ? [diametro] : [];
}

/** Clave estable de una búsqueda sin el límite: dos peticiones con la misma clave piden lo mismo, solo que más o menos. */
export function claveFiltros(cuerpo: CuerpoBuscar): string {
  return JSON.stringify([cuerpo.consulta, cuerpo.filtros ?? null, cuerpo.linea_objetivo ?? null]);
}

export function siguienteLimite(actual: number): number {
  return acotarLimite(actual + PASO_LIMITE);
}

/** «Cargar más» solo si el servidor dice que hay más y todavía se puede pedir más. */
export function puedeCargarMas(limite: number, hayMas: boolean): boolean {
  return hayMas && limite < LIMITE_MAXIMO;
}

/**
 * Una opción que el cliente puede elegir de un producto: un tamaño y un color. Las presentaciones del mismo
 * producto que solo difieren en cuántas unidades trae el paquete (x12, x50…) son UNA opción: el cliente decide
 * tamaño y color, y qué paquetes se compran lo decide Python al calcular las compras de toda la propuesta.
 */
export type OpcionElegible = {
  /** La variante que representa a la opción: el paquete más pequeño disponible. Es el id de la opción en pantalla. */
  variantId: string;
  productId: string;
  /** Todas las variantes disponibles que colapsaron en esta opción, el paquete más pequeño primero (incluye `variantId`). */
  variantIds: string[];
  /** "12 pulgadas", o null si el catálogo no trae tamaño. */
  tamano: string | null;
  /** "12″" para las etiquetas cortas. */
  tamanoCorto: string | null;
  diamPulg: number | null;
  colores: string[];
};

export type TarjetaGlobo = {
  productId: string;
  nombre: string;
  imagen: string | null;
  /** Colores de sus opciones, sin repetir, en el orden en que aparecen. */
  colores: string[];
  opciones: OpcionElegible[];
};

/** Unidades del paquete según el título de la variante ("R-12 / PAQUETE X 50"); solo para decidir cuál es el más pequeño. */
function unidadesDelPaquete(variante: VarianteDelServidor): number {
  const unidades = /paquete\s*x\s*(\d+)/i.exec(variante.titulo ?? "")?.[1];
  return unidades ? Number(unidades) : Infinity;
}

function claveDeOpcion(variante: VarianteDelServidor): string {
  const colores = variante.colores.map((color) => color.trim().toLowerCase()).filter(Boolean).sort();
  return JSON.stringify([variante.diamPulg, variante.forma, colores]);
}

/**
 * Lo que devolvió la búsqueda como tarjetas. Solo cuentan las variantes disponibles (una agotada ni aparece ni
 * esconde a otra); las que comparten tamaño, forma y colores se juntan en una opción, representada por la de
 * paquete más pequeño (empate: el id menor, para que sea siempre la misma). Las opciones van de menor a mayor
 * tamaño; un producto sin opciones no es una tarjeta.
 */
export function tarjetasDeCandidatos(candidatos: readonly CandidatoDelServidor[]): TarjetaGlobo[] {
  const tarjetas: TarjetaGlobo[] = [];
  for (const candidato of candidatos) {
    const grupos = new Map<string, VarianteDelServidor[]>();
    for (const variante of candidato.variantes) {
      if (!variante.disponible) continue;
      const clave = claveDeOpcion(variante);
      grupos.set(clave, [...(grupos.get(clave) ?? []), variante]);
    }
    const opciones: OpcionElegible[] = [...grupos.values()].map((variantes) => {
      const ordenadas = [...variantes].sort((a, b) => unidadesDelPaquete(a) - unidadesDelPaquete(b) || a.variantId.localeCompare(b.variantId));
      const representante = ordenadas[0]!;
      return {
        variantId: representante.variantId,
        productId: candidato.productId,
        variantIds: ordenadas.map((variante) => variante.variantId),
        tamano: representante.codigoTamano ? pulgadasCliente(representante.codigoTamano) : representante.diamPulg != null ? `${representante.diamPulg} pulgadas` : null,
        tamanoCorto: representante.diamPulg != null ? `${representante.diamPulg}″` : null,
        diamPulg: representante.diamPulg,
        colores: representante.colores,
      };
    });
    opciones.sort((a, b) => (a.diamPulg ?? Infinity) - (b.diamPulg ?? Infinity) || a.colores.join(",").localeCompare(b.colores.join(",")) || a.variantId.localeCompare(b.variantId));
    if (!opciones.length) continue;
    tarjetas.push({
      productId: candidato.productId,
      nombre: productoCliente(candidato.titulo),
      imagen: candidato.imagen,
      colores: [...new Set(opciones.flatMap((opcion) => opcion.colores))],
      opciones,
    });
  }
  return tarjetas;
}

/**
 * La variante con que se aplica la edición: si la propuesta ya compra alguna presentación de esta opción, esa
 * misma (así no entra a la propuesta ninguna variante que no tuviera); si no, la del paquete más pequeño.
 * Siempre es una variante real y disponible de la opción. Cuántos paquetes se compran de cada presentación no lo
 * decide esto: Python lo recalcula para toda la propuesta con las presentaciones que la propuesta admite.
 */
export function varianteParaAplicar(opcion: Pick<OpcionElegible, "variantId" | "variantIds">, variantIdsDelPlan: ReadonlySet<string>): string {
  return opcion.variantIds.find((variantId) => variantIdsDelPlan.has(variantId)) ?? opcion.variantId;
}

export type ConsultaExplorador = {
  /** La familia de color que esta búsqueda trae; null si no se eligió ninguna (todo el catálogo). */
  familia: FamiliaId | null;
  cuerpo: CuerpoBuscar;
};

/**
 * Las búsquedas que llenan la pantalla. Sin familia elegida, una sola sobre todo el catálogo. Con familias elegidas,
 * una por familia, con los colores exactos que el cliente marcó dentro de ella (o todos los de la familia): así cada
 * familia trae sus propios globos y el tope de ocho colores por búsqueda no recorta a ninguna. Una familia elegida
 * que el catálogo no tiene no genera búsqueda.
 */
export function armarConsultas(entrada: Omit<EntradaBusqueda, "colores"> & {
  familias: readonly FamiliaId[];
  exactos: readonly string[];
  catalogo: readonly FamiliaDelCatalogo[];
}): ConsultaExplorador[] {
  const { familias, exactos, catalogo, ...resto } = entrada;
  const elegidas = catalogo.filter((familia) => familias.includes(familia.id));
  if (elegidas.length === 0) return [{ familia: null, cuerpo: armarBusqueda({ ...resto, colores: [] }) }];
  return elegidas.map((familia) => ({ familia: familia.id, cuerpo: armarBusqueda({ ...resto, colores: coloresDeBusqueda(familia, exactos) }) }));
}

/**
 * Lo que el cliente tiene filtrado, en pocas palabras ("Dorados", "12″"): las familias elegidas (o, si marcó colores
 * exactos dentro de una, esos colores) y los tamaños. Es el resumen que queda a la vista cuando los filtros se pliegan.
 */
export function resumenFiltros(entrada: {
  familias: readonly FamiliaId[];
  exactos: readonly string[];
  tamanos: readonly number[];
  catalogo: readonly FamiliaDelCatalogo[];
}): string[] {
  const partes: string[] = [];
  for (const familia of entrada.catalogo.filter((item) => entrada.familias.includes(item.id))) {
    const propios = familia.colores.map((color) => color.valor);
    const marcados = propios.filter((valor) => entrada.exactos.includes(valor));
    partes.push(...(marcados.length > 0 ? marcados.map((valor) => `${valor.charAt(0).toUpperCase()}${valor.slice(1)}`) : [familia.nombre]));
  }
  partes.push(...[...entrada.tamanos].sort((a, b) => a - b).map((tamano) => `${tamano}″`));
  return partes;
}

export type GrupoFamilia = { familia: FamiliaId; nombre: string; tarjetas: TarjetaGlobo[] };

/** Las tarjetas de una búsqueda sin color elegido, repartidas por la familia de sus colores (varias familias: «Multicolor»). */
export function agruparPorFamilia(tarjetas: readonly TarjetaGlobo[]): GrupoFamilia[] {
  const grupos = new Map<FamiliaId, TarjetaGlobo[]>();
  for (const tarjeta of tarjetas) {
    const familia = familiaDeColores(tarjeta.colores);
    grupos.set(familia, [...(grupos.get(familia) ?? []), tarjeta]);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => ordenDeFamilia(a) - ordenDeFamilia(b))
    .map(([familia, lista]) => ({ familia, nombre: nombreDeFamilia(familia), tarjetas: lista }));
}

export type GrupoTamano = {
  /** null: el catálogo no trae tamaño. */
  diamPulg: number | null;
  /** "12″", o "Sin tamaño". */
  etiqueta: string;
  /** Cada producto con solo sus opciones de este tamaño (una por color). */
  tarjetas: TarjetaGlobo[];
};

/** Las tarjetas de una familia subdivididas por tamaño, de menor a mayor; lo que no trae tamaño va al final. */
export function agruparPorTamano(tarjetas: readonly TarjetaGlobo[]): GrupoTamano[] {
  const grupos = new Map<number | null, TarjetaGlobo[]>();
  for (const tarjeta of tarjetas) {
    const tamanos = [...new Set(tarjeta.opciones.map((opcion) => opcion.diamPulg))];
    for (const tamano of tamanos) {
      const opciones = tarjeta.opciones.filter((opcion) => opcion.diamPulg === tamano);
      grupos.set(tamano, [...(grupos.get(tamano) ?? []), { ...tarjeta, opciones }]);
    }
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity))
    .map(([diamPulg, lista]) => ({ diamPulg, etiqueta: diamPulg === null ? "Sin tamaño" : `${diamPulg}″`, tarjetas: lista }));
}

/** La foto del catálogo pedida al tamaño en que se ve: el CDN de Shopify recorta con `width`; otra URL queda igual. */
export function miniaturaDeCatalogo(url: string, ancho: number): string {
  let direccion: URL;
  try {
    direccion = new URL(url);
  } catch {
    return url;
  }
  if (direccion.hostname !== "cdn.shopify.com" || direccion.searchParams.has("width")) return url;
  direccion.searchParams.set("width", String(ancho));
  return direccion.toString();
}

/** Color con el que arranca la variante elegida: el único que tiene, o el que el cliente ya filtró; si no, ninguno. */
export function colorInicial(variante: Pick<OpcionElegible, "colores">, coloresFiltrados: readonly string[]): string {
  if (variante.colores.length === 1) return variante.colores[0]!;
  return variante.colores.find((color) => coloresFiltrados.includes(color)) ?? "";
}

export type ParticipacionValida = { ok: true; fraccion: number } | { ok: false; mensaje: string };

export const MENSAJE_PARTICIPACION = `La participación debe estar entre ${PARTICIPACION_MINIMA}% y ${PARTICIPACION_MAXIMA}%.`;

/** El deslizador guarda texto; la edición lleva la fracción. 2–79 %, como la regla que ya tenía el editor. */
export function validarParticipacion(texto: string): ParticipacionValida {
  const porcentaje = Number(texto);
  if (!texto.trim() || !Number.isFinite(porcentaje) || porcentaje < PARTICIPACION_MINIMA || porcentaje > PARTICIPACION_MAXIMA) {
    return { ok: false, mensaje: MENSAJE_PARTICIPACION };
  }
  return { ok: true, fraccion: porcentaje / 100 };
}

export type EstadoAplicar = {
  modo: ModoAjuste;
  /** El globo que se cambia (solo en «Cambiar»). */
  objetivoVariantId: string | null;
  elegido: Pick<OpcionElegible, "variantId"> | null;
  participacion: string;
};

/** Por qué todavía no se puede guardar, dicho para el cliente; null si ya se puede. */
export function motivoNoAplicable(estado: EstadoAplicar): string | null {
  if (estado.modo === "reemplazar" && !estado.objetivoVariantId) return "Elige primero el globo que quieres cambiar.";
  if (!estado.elegido) return estado.modo === "agregar" ? "Elige un globo del catálogo para agregarlo." : "Elige el globo nuevo del catálogo.";
  if (estado.modo === "agregar") {
    const participacion = validarParticipacion(estado.participacion);
    if (!participacion.ok) return participacion.mensaje;
  }
  return null;
}

/** El cuerpo de la edición que entiende `/api/plan-editar` (modo `aplicar`); null mientras `motivoNoAplicable` diga algo. */
export type EdicionAjuste = {
  accion: ModoAjuste;
  estructura_id: string;
  objetivo_variant_id?: string;
  variante: { product_id: string; variant_id: string; color?: string };
  participacion?: number;
};

export function armarEdicion(entrada: EstadoAplicar & { estructuraId: string; elegido: Pick<OpcionElegible, "variantId" | "productId">; color: string }): EdicionAjuste | null {
  if (motivoNoAplicable(entrada) !== null) return null;
  const color = entrada.color.trim();
  const participacion = entrada.modo === "agregar" ? validarParticipacion(entrada.participacion) : null;
  return {
    accion: entrada.modo,
    estructura_id: entrada.estructuraId,
    ...(entrada.modo === "reemplazar" && entrada.objetivoVariantId ? { objetivo_variant_id: entrada.objetivoVariantId } : {}),
    variante: { product_id: entrada.elegido.productId, variant_id: entrada.elegido.variantId, ...(color ? { color } : {}) },
    ...(participacion?.ok ? { participacion: participacion.fraccion } : {}),
  };
}

export function avisoAplicado(modo: ModoAjuste): string {
  return modo === "agregar" ? "Listo, agregué el globo." : "Listo, cambié el globo.";
}

/** "Globo Latex Redondo Rojo · 12 pulgadas · rojo": una línea de la pieza como la ve el cliente. */
export function describirLinea(linea: Pick<LineaMaterial, "titulo" | "tamano_codigo" | "color">): string {
  return [productoCliente(linea.titulo), linea.tamano_codigo ? pulgadasCliente(linea.tamano_codigo) : null, linea.color].filter(Boolean).join(" · ");
}
