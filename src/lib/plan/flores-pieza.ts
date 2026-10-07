import { z } from "zod";
import { clasificarColores, PALETA_COLORES_EN_V2, plegarTexto } from "@/lib/rag/taxonomy/v2";

/**
 * **Flores de globo como adorno de cualquier pieza** (dueño, 2026-10-07: «hacer que se soporte como tipo estructuritas
 * como flores de globo en todas las estructuras, hacer algo simple, ese tipo de flores: agrupaciones de 3 globos R5 y
 * poco más»).
 *
 * Una flor es un grupito de globos de 5″: `petalos` globos de un color (3 por defecto, hasta 6) y, si se pide, un globo
 * de centro de otro color. Se suman `cantidad` veces a una pieza (arco, columna, guirnalda, aro, pared…), por pieza:
 * con `repeticiones: 2` cada columna lleva las suyas.
 *
 * Este módulo es el **dueño del contrato** (`flores` de una estructura del plan, `x-reglas-flores` del esquema
 * exportado) y de las piezas puras que lo usan: el texto de la tarjeta, las flores que lee la foto y la regla del chat
 * («ponle flores»). **No cuenta**: los globos de las flores, su talla real (R-5 o la más cercana que haya) y su compra
 * por paquete los decide `services/ai-api/app/flores_pieza.py` al resolver, y la tarjeta solo lee las líneas que Python
 * marcó con `adorno: "flor"`.
 *
 * Puro: sin red, servidor ni React.
 */

/** La talla de un globo de flor: R-5, la que pidió el dueño. */
export const PULGADAS_FLOR = 5;
/** Pétalos de una flor cuando el plan no dice cuántos: «agrupaciones de 3 globos». */
export const PETALOS_FLOR_POR_DEFECTO = 3;
export const MIN_PETALOS_FLOR = 3;
export const MAX_PETALOS_FLOR = 6;
/** Flores por pieza como mucho: más ya no es un adorno, es otra pieza. */
export const MAX_FLORES_PIEZA = 24;
/** El valor de `adorno` con que Python marca las líneas de las flores (`plan-resuelto.v1`). */
export const ADORNO_FLOR = "flor" as const;
export const ADORNOS_LINEA = [ADORNO_FLOR] as const;

/**
 * El globo de una parte de la flor: un producto del plan (sus variantes ya están en la allowlist firmada) y el color con
 * que se pide. Sin `variant_id`: la talla la elige Python (R-5, o la más cercana del mismo producto si no hay R-5).
 */
export const MaterialFlorSchema = z.object({
  product_id: z.string().trim().min(1).max(160),
  color: z.string().trim().min(1).max(80).optional(),
}).strict();

export const FloresPiezaV1Schema = z.object({
  /** Flores por pieza (con `repeticiones: 2`, cada una de las dos lleva estas). */
  cantidad: z.number().int().min(1).max(MAX_FLORES_PIEZA),
  /** Globos-pétalo de cada flor; sin él, `PETALOS_FLOR_POR_DEFECTO`. */
  petalos: z.number().int().min(MIN_PETALOS_FLOR).max(MAX_PETALOS_FLOR).optional(),
  petalo: MaterialFlorSchema,
  /** El globo del centro, de otro color; sin él, la flor es solo de pétalos. */
  centro: MaterialFlorSchema.optional(),
}).strict();

export type MaterialFlor = z.infer<typeof MaterialFlorSchema>;
export type FloresPieza = z.infer<typeof FloresPiezaV1Schema>;

/** Las reglas que Python lee del contrato (`x-reglas-flores`): una sola copia, la de aquí. */
export function reglasFlores(): { pulgadas: number; petalos_por_defecto: number; adorno: typeof ADORNO_FLOR } {
  return { pulgadas: PULGADAS_FLOR, petalos_por_defecto: PETALOS_FLOR_POR_DEFECTO, adorno: ADORNO_FLOR };
}

export function petalosDe(flores: Pick<FloresPieza, "petalos">): number {
  return flores.petalos ?? PETALOS_FLOR_POR_DEFECTO;
}

// --- Lo que muestra la tarjeta ----------------------------------------------------------------------------------------

type LineaConAdorno = { adorno?: unknown; unidades?: unknown; diam_pulg?: unknown; [clave: string]: unknown };

/** Las flores de una pieza tal como las resolvió Python: cuántas (las del plan × repeticiones), sus globos y sus tallas. */
export type ResumenFlores = { flores: number; globos: number; pulgadas: number[] };

export function esLineaDeFlor(linea: LineaConAdorno): boolean {
  return linea.adorno === ADORNO_FLOR;
}

/**
 * Lo que la tarjeta dice de las flores de una pieza. Los globos y las tallas son los de las líneas que Python marcó como
 * flor (nunca se cuentan aquí); el número de flores, el que declara el plan por pieza por sus repeticiones. `null` sin
 * flores o sin una sola línea de flor (sin compra no se promete ninguna).
 */
export function resumenFlores(
  estructura: { flores?: Pick<FloresPieza, "cantidad"> | undefined; repeticiones?: number | undefined },
  lineas: readonly LineaConAdorno[],
): ResumenFlores | null {
  if (!estructura.flores) return null;
  const deFlor = lineas.filter(esLineaDeFlor);
  const globos = deFlor.reduce((suma, linea) => suma + (typeof linea.unidades === "number" && Number.isFinite(linea.unidades) ? linea.unidades : 0), 0);
  if (globos <= 0) return null;
  const pulgadas = [...new Set(deFlor.flatMap((linea) => (typeof linea.diam_pulg === "number" && linea.diam_pulg > 0 ? [linea.diam_pulg] : [])))].sort((a, b) => a - b);
  return { flores: estructura.flores.cantidad * Math.max(1, estructura.repeticiones ?? 1), globos, pulgadas };
}

function lista(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;
}

/** «+ 4 flores (16 globos de 5″)», «+ 1 flor (4 globos de 5″)». */
export function textoFlores(resumen: ResumenFlores): string {
  const flores = `${resumen.flores} ${resumen.flores === 1 ? "flor" : "flores"}`;
  const tallas = resumen.pulgadas.length ? ` de ${lista(resumen.pulgadas.map((pulgadas) => `${pulgadas}″`))}` : "";
  return `+ ${flores} (${resumen.globos} ${resumen.globos === 1 ? "globo" : "globos"}${tallas})`;
}

// --- Lo que dice el caption de la imagen ------------------------------------------------------------------------------

/** El acabado que se VE en el globo, leído del título del catálogo de su línea; vacío si el título no lo dice. */
function acabadoVisibleFlor(titulo: unknown): string {
  const texto = typeof titulo === "string" ? plegarTexto(titulo) : "";
  if (/\b(?:silk|satin|perla|perlad|nacar|pearl)/.test(texto)) return "pearl";
  if (/\breflex\b|\bcromad/.test(texto)) return "chrome";
  if (/\bmetal\b|\bmetaliz/.test(texto)) return "metallic";
  if (/\bpastel\b/.test(texto)) return "pastel";
  if (/\bfashion\b|\bmate\b/.test(texto)) return "matte";
  return "";
}

function colorEnIngles(color: unknown): string {
  if (typeof color !== "string" || !color.trim()) return "";
  const canonico = colorCanonico(color);
  return (PALETA_COLORES_EN_V2 as Readonly<Record<string, string>>)[canonico] ?? "";
}

type LineaFlorCaption = LineaConAdorno & { color?: unknown; titulo?: unknown; product_id?: unknown };

/**
 * La frase del caption FLUX para las flores de una pieza, corta y sin comas (el compilador acorta las frases de forma
 * por fragmentos separados por coma; esta va delante y entera): «with 4 small balloon flowers of 5-inch pearl white
 * petals around chrome gold centers». Los colores y el acabado salen de las líneas que Python compró para las flores
 * (su título del catálogo), la cantidad del plan por pieza. `null` sin flores o sin una línea de flor.
 */
export function fraseFloresFlux(
  estructura: { flores?: FloresPieza | undefined; repeticiones?: number | undefined },
  lineas: readonly LineaFlorCaption[],
): string | null {
  const flores = estructura.flores;
  const resumen = resumenFlores(estructura, lineas);
  if (!flores || !resumen) return null;
  const deFlor = lineas.filter(esLineaDeFlor);
  const describir = (material: MaterialFlor | undefined): string => {
    if (!material) return "";
    const linea = deFlor.find((item) => item.product_id === material.product_id) ?? deFlor.find((item) => colorCanonico(typeof item.color === "string" ? item.color : undefined) === colorCanonico(material.color));
    const color = colorEnIngles(material.color ?? linea?.color);
    return [acabadoVisibleFlor(linea?.titulo), color].filter(Boolean).join(" ");
  };
  const pulgadas = resumen.pulgadas.length ? `${resumen.pulgadas[0]}-inch ` : "";
  const cantidad = flores.cantidad;
  const cada = (estructura.repeticiones ?? 1) > 1 ? "each with " : "with ";
  const petalos = describir(flores.petalo);
  const centro = describir(flores.centro);
  // Pétalos de 12″ o más: flores grandes, como las de la foto; con un número de pétalos distinto del de siempre, se dice.
  const tamano = (resumen.pulgadas[0] ?? 5) >= 12 ? "large" : "small";
  const NUMEROS = ["", "one", "two", "three", "four", "five", "six"] as const;
  const cuantosPetalos = flores.petalos !== undefined && flores.petalos !== PETALOS_FLOR_POR_DEFECTO ? `${NUMEROS[flores.petalos] ?? flores.petalos} ` : "";
  const nucleo = `${cantidad === 1 ? `one ${tamano} balloon flower` : `${cantidad} ${tamano} balloon flowers`} of ${cuantosPetalos}${pulgadas}${petalos ? `${petalos} ` : ""}petals`;
  return `${cada}${nucleo}${flores.centro ? ` around ${centro ? `${centro} ` : ""}${cantidad === 1 ? "center" : "centers"}` : ""}`;
}

// --- Las flores que lee la foto ---------------------------------------------------------------------------------------

/**
 * Las flores de globo que la lectura vio en una pieza de la foto (`appearance.flores` del blueprint): cuántas, el color
 * de sus pétalos y el de su centro, en la paleta del catálogo. Es una lectura, no una compra: al confirmar el plan,
 * `floresDesdeLectura` la convierte en el adorno `flores` de la pieza que materializa ese elemento.
 */
export const FloresLeidasSchema = z.object({
  cantidad: z.number().int().min(1).max(MAX_FLORES_PIEZA),
  /** Globos-pétalo de UNA flor que contó la lectura; sin él, `PETALOS_FLOR_POR_DEFECTO`. */
  petalos: z.number().int().min(MIN_PETALOS_FLOR).max(MAX_PETALOS_FLOR).optional(),
  color_petalo: z.string().trim().min(1).max(40),
  color_centro: z.string().trim().min(1).max(40).optional(),
  confianza: z.number().min(0).max(1),
}).strict();
export type FloresLeidas = z.infer<typeof FloresLeidasSchema>;

/** Por debajo, un decorador no se fiaría de la lectura (la misma vara que las demás lecturas de la foto). */
export const CONFIANZA_MINIMA_FLORES = 0.5;

/**
 * Lo que el modelo escribió en `lecturas.flores` (sin validar) → `FloresLeidas`, o `null` si no sirve. La cantidad se
 * acota al tope en vez de tirar la lectura: «30 flores» sigue siendo «muchas flores».
 */
export function floresLeidasDeCrudo(crudo: unknown): FloresLeidas | null {
  if (!crudo || typeof crudo !== "object") return null;
  const valor = crudo as Record<string, unknown>;
  const cantidad = typeof valor.cantidad === "number" && Number.isFinite(valor.cantidad) ? Math.round(valor.cantidad) : NaN;
  // Los pétalos se acotan como la cantidad («8 pétalos» sigue siendo una flor llena); ilegibles, la flor sigue sin ellos.
  const petalos = typeof valor.petalos === "number" && Number.isFinite(valor.petalos)
    ? Math.min(MAX_PETALOS_FLOR, Math.max(MIN_PETALOS_FLOR, Math.round(valor.petalos)))
    : null;
  const leidas = FloresLeidasSchema.safeParse({
    cantidad: Number.isFinite(cantidad) ? Math.min(MAX_FLORES_PIEZA, cantidad) : cantidad,
    ...(petalos === null ? {} : { petalos }),
    color_petalo: valor.color_petalo,
    ...(typeof valor.color_centro === "string" && valor.color_centro.trim() ? { color_centro: valor.color_centro } : {}),
    confianza: valor.confianza,
  });
  return leidas.success ? leidas.data : null;
}

type MaterialPieza = { product_id: string; color?: string | undefined };

function colorCanonico(color: string | undefined): string {
  if (!color) return "";
  const plegado = plegarTexto(color);
  return clasificarColores(plegado).values[0] ?? plegado;
}

/**
 * Lo que se sabe de la forma de un producto del plan: `"redondo"` (tiene un globo redondo con diámetro, el único con que
 * Python arma una flor: `flores_pieza.elegir_talla`), `"otra"` (un metalizado, una letra, un kit: Python lo deja en
 * `sin_cobertura` y la confirmación rechaza el plan entero) o `undefined` (no se sabe).
 */
export type FormaProducto = (productId: string) => "redondo" | "otra" | undefined;

/**
 * El primer material de ese color que puede ser un globo de flor, o `null`. Con `forma`, nunca uno que no es redondo y,
 * antes que uno de forma desconocida, uno redondo; sin ella, el primero del color.
 */
function materialDeColor(materiales: readonly MaterialPieza[], color: string, forma?: FormaProducto): MaterialPieza | null {
  const buscado = colorCanonico(color);
  if (!buscado) return null;
  const delColor = materiales.filter((material) => colorCanonico(material.color) === buscado && forma?.(material.product_id) !== "otra");
  return delColor.find((material) => forma?.(material.product_id) === "redondo") ?? delColor[0] ?? null;
}

/**
 * La forma de cada producto según las líneas del CUERPO de un plan ya resuelto (las de las flores no cuentan): redondo
 * si alguna de sus líneas es un globo redondo con diámetro, «otra» si tiene líneas y ninguna lo es.
 */
export function formaDeLineas(estructuras: ReadonlyArray<{ lineas: ReadonlyArray<Record<string, unknown>> }>): FormaProducto {
  const formas = new Map<string, "redondo" | "otra">();
  for (const linea of estructuras.flatMap((estructura) => estructura.lineas)) {
    if (esLineaDeFlor(linea) || typeof linea.product_id !== "string") continue;
    const redondo = linea.forma === "redondo" && typeof linea.diam_pulg === "number" && linea.diam_pulg > 0;
    if (redondo || !formas.has(linea.product_id)) formas.set(linea.product_id, redondo ? "redondo" : "otra");
  }
  return (productId) => formas.get(productId);
}

function materialFlor(material: MaterialPieza, color: string | undefined): MaterialFlor {
  const nombre = material.color ?? color;
  return { product_id: material.product_id, ...(nombre ? { color: nombre } : {}) };
}

/**
 * Las flores de la foto como adorno de la pieza: los pétalos con el globo del color que se leyó (el mismo producto, así
 * que el mismo acabado: un pétalo perlado sale del perlado de la pieza, no de un mate), el centro con el de su color y
 * los pétalos que contó la lectura. `materiales` va en orden de preferencia (los de la pieza primero; quien llama puede
 * sumar los de las otras piezas del plan, que también están en la allowlist firmada). Sin un globo del color de los
 * pétalos no se inventa ninguno: `null`, y quien llama lo deja dicho. Por debajo de `CONFIANZA_MINIMA_FLORES`, tampoco.
 * Con `forma`, nunca un producto que no es un globo redondo (un metalizado dorado no es el centro de una flor).
 */
export function floresDesdeLectura(materiales: readonly MaterialPieza[], leidas: FloresLeidas, forma?: FormaProducto): FloresPieza | null {
  if (leidas.confianza < CONFIANZA_MINIMA_FLORES) return null;
  const petalo = materialDeColor(materiales, leidas.color_petalo, forma);
  if (!petalo) return null;
  const centro = leidas.color_centro ? materialDeColor(materiales, leidas.color_centro, forma) : null;
  return {
    cantidad: leidas.cantidad,
    ...(leidas.petalos ? { petalos: leidas.petalos } : {}),
    petalo: materialFlor(petalo, leidas.color_petalo),
    ...(centro && centro.product_id !== petalo.product_id ? { centro: materialFlor(centro, leidas.color_centro) } : {}),
  };
}

/**
 * Las flores de una pieza de una idea de la biblioteca (`decoraciones.json`, `piezas[].flores`), contadas a mano sobre
 * su foto: cuántas por pieza, cuántos pétalos y de qué colores. Como la lectura, nombra colores y no productos: el
 * plan EXACTO de la idea (`precomputar-planes-ideas.ts`) las arma con los globos de esa pieza (`floresDeIdea`).
 */
export const FloresIdeaSchema = z.object({
  cantidad: z.number().int().min(1).max(MAX_FLORES_PIEZA),
  petalos: z.number().int().min(MIN_PETALOS_FLOR).max(MAX_PETALOS_FLOR).optional(),
  color_petalo: z.string().trim().min(1).max(40),
  color_centro: z.string().trim().min(1).max(40).optional(),
}).strict();
export type FloresIdea = z.infer<typeof FloresIdeaSchema>;

/** Las flores de una idea como adorno de su pieza, con los globos de la pieza; null si la pieza no lleva el color de los pétalos. */
export function floresDeIdea(materiales: readonly MaterialPieza[], idea: FloresIdea): FloresPieza | null {
  const flores = floresDesdeLectura(materiales, { cantidad: idea.cantidad, color_petalo: idea.color_petalo, ...(idea.color_centro ? { color_centro: idea.color_centro } : {}), confianza: 1 });
  return flores ? { ...flores, ...(idea.petalos ? { petalos: idea.petalos } : {}) } : null;
}

type BlueprintConFlores ={ elements: ReadonlyArray<{ element_id: string; approved: boolean; appearance: { flores?: FloresLeidas | undefined } }> } | undefined;

/** Qué hizo `aplicarFloresDeFoto` con cada pieza: para el registro de la decisión y el aviso al cliente. */
export type FloresDeFoto<P> = {
  plan: P;
  /** `centro_omitido`: el color del centro que leyó la foto y que ningún globo del plan tiene (la flor va sin centro). */
  aplicadas: Array<{ estructura_id: string; referencia: string; flores: FloresPieza; centro_omitido?: string }>;
  /** La foto vio flores y ningún globo redondo del plan es del color de sus pétalos (o la lectura no era fiable). */
  omitidas: Array<{ estructura_id: string; referencia: string; leidas: FloresLeidas; motivo: string }>;
};

/**
 * Al confirmar un plan con foto: cada pieza que materializa un elemento en el que la lectura vio flores de globo las
 * lleva como adorno (`floresDesdeLectura`), con los globos de la pieza o, si la pieza no lleva ese color, los de otra
 * pieza del plan (como el chat, `edicionFloresDePedido`). Una pieza que ya trae `flores` (las puso el decorador o la
 * biblioteca) no se toca. `forma` (la del catálogo de cada producto) deja fuera lo que no es un globo redondo. Puro;
 * quien llama valida el plan, registra la decisión y le dice al cliente lo que no salió (`avisosClienteFloresDeFoto`).
 */
export function aplicarFloresDeFoto<P extends { estructuras: ReadonlyArray<{ estructura_id: string; referencia_element_id?: string | undefined; materiales: readonly MaterialPieza[]; flores?: FloresPieza | undefined }> }>(
  plan: P,
  blueprint: BlueprintConFlores,
  forma?: FormaProducto,
): FloresDeFoto<P> {
  const aplicadas: FloresDeFoto<P>["aplicadas"] = [];
  const omitidas: FloresDeFoto<P>["omitidas"] = [];
  if (!blueprint) return { plan, aplicadas, omitidas };
  const leidasPorElemento = new Map(blueprint.elements.flatMap((elemento) => (elemento.approved && elemento.appearance.flores ? [[elemento.element_id, elemento.appearance.flores] as const] : [])));
  if (!leidasPorElemento.size) return { plan, aplicadas, omitidas };
  const estructuras = plan.estructuras.map((estructura) => {
    const referencia = estructura.referencia_element_id;
    const leidas = referencia ? leidasPorElemento.get(referencia) : undefined;
    if (!referencia || !leidas || estructura.flores) return estructura;
    const todos = [...estructura.materiales, ...plan.estructuras.filter((otra) => otra !== estructura).flatMap((otra) => otra.materiales)];
    const flores = floresDesdeLectura(todos, leidas, forma);
    if (!flores) {
      omitidas.push({
        estructura_id: estructura.estructura_id,
        referencia,
        leidas,
        motivo: leidas.confianza < CONFIANZA_MINIMA_FLORES ? "lectura poco fiable" : `el plan no lleva globos ${leidas.color_petalo} redondos para los pétalos`,
      });
      return estructura;
    }
    const centroOmitido = leidas.color_centro && !flores.centro && colorCanonico(leidas.color_centro) !== colorCanonico(flores.petalo.color)
      ? leidas.color_centro
      : undefined;
    aplicadas.push({ estructura_id: estructura.estructura_id, referencia, flores, ...(centroOmitido ? { centro_omitido: centroOmitido } : {}) });
    return { ...estructura, flores };
  });
  return { plan: aplicadas.length ? { ...plan, estructuras } : plan, aplicadas, omitidas };
}

/**
 * Lo que el cliente debe saber de las flores de su foto que el plan no lleva enteras: la tarjeta de la lectura ya le
 * prometió «con 2 flores de globo rosado» y, sin esto, el plan salía sin ellas (o sin su centro) en silencio. Solo las
 * que la tarjeta prometió: una lectura poco fiable no se enseñó. `nombres`: el nombre de cada pieza del plan.
 */
export function avisosClienteFloresDeFoto(
  floresFoto: Pick<FloresDeFoto<unknown>, "aplicadas" | "omitidas">,
  nombres: ReadonlyMap<string, string>,
): string[] {
  const pieza = (estructuraId: string) => nombres.get(estructuraId) ?? estructuraId;
  const sinFlores = floresFoto.omitidas
    .filter((omitida) => omitida.leidas.confianza >= CONFIANZA_MINIMA_FLORES)
    .map(({ estructura_id, leidas }) => avisoSinFlores(leidas, pieza(estructura_id)));
  const sinCentro = floresFoto.aplicadas.flatMap(({ estructura_id, centro_omitido }) => (centro_omitido ? [avisoSinCentro(centro_omitido, pieza(estructura_id))] : []));
  return [...sinFlores, ...sinCentro];
}

function avisoSinFlores(leidas: Pick<FloresLeidas, "cantidad" | "color_petalo">, pieza: string): string {
  return `Tu foto tiene ${leidas.cantidad === 1 ? "una flor" : `${leidas.cantidad} flores`} de globo ${leidas.color_petalo} en «${pieza}», pero tu plan no lleva globos ${leidas.color_petalo}: va sin ${leidas.cantidad === 1 ? "esa flor" : "esas flores"} (puedes pedirlas en otro color).`;
}

function avisoSinCentro(color: string, pieza: string): string {
  return `Las flores de «${pieza}» van sin el centro ${color} de tu foto: tu plan no lleva globos ${color}.`;
}

/**
 * Los mismos avisos para la tarjeta de la guiada, que no enseña el texto del modelo (la tarjeta lo dice todo, así que
 * `avisos_cliente` no le llega): la lectura de la foto contra el plan firmado. Una pieza que materializa un elemento con
 * flores (las que la tarjeta de la lectura prometió) y va sin ellas, o sin su centro, cuando el plan no lleva globos de
 * ese color; si los lleva, el cliente las quitó o las cambió a propósito y no se dice nada. Puro.
 */
export function avisosFloresFotoSinComprar(
  blueprint: BlueprintConFlores,
  plan: { estructuras: ReadonlyArray<{ estructura_id: string; nombre: string; referencia_element_id?: string | undefined; materiales: readonly MaterialPieza[]; flores?: FloresPieza | undefined }> } | null | undefined,
): string[] {
  if (!blueprint || !plan) return [];
  const colores = new Set(plan.estructuras.flatMap((estructura) => estructura.materiales.map((material) => colorCanonico(material.color))));
  const lleva = (color: string) => colores.has(colorCanonico(color));
  return plan.estructuras.flatMap((estructura) => {
    const elemento = blueprint.elements.find((item) => item.approved && item.element_id === estructura.referencia_element_id);
    const leidas = elemento?.appearance.flores;
    if (!leidas || leidas.confianza < CONFIANZA_MINIMA_FLORES) return [];
    if (!estructura.flores) return lleva(leidas.color_petalo) ? [] : [avisoSinFlores(leidas, estructura.nombre)];
    const centro = leidas.color_centro;
    return centro && !estructura.flores.centro && colorCanonico(centro) !== colorCanonico(estructura.flores.petalo.color) && !lleva(centro)
      ? [avisoSinCentro(centro, estructura.nombre)]
      : [];
  });
}

// --- La regla del chat: «ponle flores» --------------------------------------------------------------------------------

/**
 * Un pedido de flores por chat, ya leído: `quitar` («quítale las flores»), o cuántas (null = no lo dijo) y de qué
 * colores (null = los de la pieza). `piezas` son las palabras que nombran la pieza («la columna»); vacío = no la nombró.
 */
export type PedidoFlores = {
  tipo: "flores";
  quitar: boolean;
  cantidad: number | null;
  colorPetalo: string | null;
  colorCentro: string | null;
};

const FLOR = /\bflor(?:es|ecitas?)?\b/;
const QUITAR = /\b(?:quita\w*|saca\w*|elimina\w*|borra\w*|sin)\b[^.?!]*\bflor/;
const NUMEROS: Readonly<Record<string, number>> = { una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12 };

function cantidadDelTexto(texto: string): number | null {
  const cifra = /\b(\d{1,2})\s+(?:\w+\s+)?flor/.exec(texto);
  if (cifra) return Math.max(1, Math.min(MAX_FLORES_PIEZA, Number(cifra[1])));
  const palabra = /\b(una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce)\s+(?:\w+\s+)?flor/.exec(texto);
  return palabra ? NUMEROS[palabra[1]!] ?? null : null;
}

/**
 * La regla del chat: ¿el cliente pide flores (o quitarlas)? «ponle flores», «agrega 3 flores doradas a la columna»,
 * «flores blancas con centro dorado», «quítale las flores». `null` si el texto no habla de flores de globo. Los colores
 * salen de la paleta del catálogo (`clasificarColores`): el que va después de «centro» es el del centro.
 */
export function pedidoFloresDeTexto(textoCliente: string): PedidoFlores | null {
  const texto = plegarTexto(textoCliente);
  if (!FLOR.test(texto)) return null;
  if (QUITAR.test(texto)) return { tipo: "flores", quitar: true, cantidad: null, colorPetalo: null, colorCentro: null };
  const [antes = "", despues] = texto.split(/\bcentros?\b/, 2);
  const colorPetalo = clasificarColores(antes).values[0] ?? null;
  const colorCentro = despues === undefined ? null : clasificarColores(despues).values[0] ?? null;
  return { tipo: "flores", quitar: false, cantidad: cantidadDelTexto(texto), colorPetalo, colorCentro };
}

/** Flores que lleva una pieza cuando el cliente no dijo cuántas. */
export const FLORES_POR_DEFECTO = 3;

/** La edición `flores` que aplica `/api/plan-editar` (Python la pone o la quita y vuelve a contar). */
export type EdicionFloresPedida = { accion: "flores"; estructura_id: string; flores: FloresPieza | null };

type PlanConMateriales = { estructuras: ReadonlyArray<{ estructura_id: string; materiales: readonly MaterialPieza[]; flores?: FloresPieza | undefined }> };

/**
 * El pedido del chat convertido en la edición de UNA pieza, con productos que el plan ya compra (la allowlist firmada los
 * tiene): los pétalos del color pedido —de esta pieza o, si no lo lleva, de otra del plan— o, sin color, el globo
 * principal de la pieza; el centro del color pedido o, sin él, el segundo color de la pieza. Con `forma` (la de las
 * líneas del plan resuelto, `formaDeLineas`), nunca un globo que no es redondo: Python no arma una flor con un
 * metalizado y el plan quedaba con `sin_cobertura`. Devuelve el motivo en palabras de cliente cuando no se puede
 * (ningún globo del plan es de ese color).
 */
export function edicionFloresDePedido(
  plan: PlanConMateriales,
  estructuraId: string,
  pedido: PedidoFlores,
  forma?: FormaProducto,
): { ok: true; edicion: EdicionFloresPedida } | { ok: false; motivo: string } {
  const pieza = plan.estructuras.find((estructura) => estructura.estructura_id === estructuraId);
  if (!pieza) return { ok: false, motivo: "No encontré esa pieza en tu plan." };
  if (pedido.quitar) {
    if (!pieza.flores) return { ok: false, motivo: "Esa pieza no lleva flores." };
    return { ok: true, edicion: { accion: "flores", estructura_id: estructuraId, flores: null } };
  }
  const todos = [...pieza.materiales, ...plan.estructuras.filter((estructura) => estructura !== pieza).flatMap((estructura) => estructura.materiales)];
  const propios = pieza.materiales.filter((material) => forma?.(material.product_id) !== "otra");
  const petalo = pedido.colorPetalo ? materialDeColor(todos, pedido.colorPetalo, forma) : propios[0] ?? null;
  if (!petalo) {
    return { ok: false, motivo: pedido.colorPetalo ? `Tu plan no lleva globos ${pedido.colorPetalo}; agrega primero ese color y luego las flores.` : "Esa pieza no lleva globos redondos para armar flores; dime de qué color las quieres." };
  }
  const centro = pedido.colorCentro
    ? materialDeColor(todos, pedido.colorCentro, forma)
    : propios.find((material) => colorCanonico(material.color) !== colorCanonico(petalo.color)) ?? null;
  if (pedido.colorCentro && !centro) return { ok: false, motivo: `Tu plan no lleva globos ${pedido.colorCentro} para el centro; agrega primero ese color.` };
  const anterior = pieza.flores;
  const flores: FloresPieza = {
    cantidad: pedido.cantidad ?? anterior?.cantidad ?? FLORES_POR_DEFECTO,
    ...(anterior?.petalos ? { petalos: anterior.petalos } : {}),
    petalo: materialFlor(petalo, pedido.colorPetalo ?? undefined),
    ...(centro && colorCanonico(centro.color) !== colorCanonico(petalo.color) ? { centro: materialFlor(centro, pedido.colorCentro ?? undefined) } : {}),
  };
  return { ok: true, edicion: { accion: "flores", estructura_id: estructuraId, flores } };
}
