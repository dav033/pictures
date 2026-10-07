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
  const nucleo = `${cantidad === 1 ? "one small balloon flower" : `${cantidad} small balloon flowers`} of ${pulgadas}${petalos ? `${petalos} ` : ""}petals`;
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
  const leidas = FloresLeidasSchema.safeParse({
    cantidad: Number.isFinite(cantidad) ? Math.min(MAX_FLORES_PIEZA, cantidad) : cantidad,
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

/** El material de la pieza de ese color, o `null`. */
function materialDeColor(materiales: readonly MaterialPieza[], color: string): MaterialPieza | null {
  const buscado = colorCanonico(color);
  if (!buscado) return null;
  return materiales.find((material) => colorCanonico(material.color) === buscado) ?? null;
}

function materialFlor(material: MaterialPieza, color: string | undefined): MaterialFlor {
  const nombre = material.color ?? color;
  return { product_id: material.product_id, ...(nombre ? { color: nombre } : {}) };
}

/**
 * Las flores de la foto como adorno de la pieza: los pétalos con el globo de la pieza del color que se leyó (el mismo
 * producto, así que el mismo acabado: un pétalo perlado sale del perlado de la pieza, no de un mate) y el centro con el
 * de su color, si la pieza lo lleva. Sin un globo de la pieza del color de los pétalos no se inventa ninguno: `null`, y
 * quien llama lo deja dicho. Por debajo de `CONFIANZA_MINIMA_FLORES`, tampoco.
 */
export function floresDesdeLectura(materiales: readonly MaterialPieza[], leidas: FloresLeidas): FloresPieza | null {
  if (leidas.confianza < CONFIANZA_MINIMA_FLORES) return null;
  const petalo = materialDeColor(materiales, leidas.color_petalo);
  if (!petalo) return null;
  const centro = leidas.color_centro ? materialDeColor(materiales, leidas.color_centro) : null;
  return {
    cantidad: leidas.cantidad,
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

/** Qué hizo `aplicarFloresDeFoto` con cada pieza: para el registro de la decisión. */
export type FloresDeFoto<P> = {
  plan: P;
  aplicadas: Array<{ estructura_id: string; referencia: string; flores: FloresPieza }>;
  /** La foto vio flores y la pieza no lleva un globo del color de sus pétalos (o la lectura no era fiable). */
  omitidas: Array<{ estructura_id: string; referencia: string; leidas: FloresLeidas; motivo: string }>;
};

/**
 * Al confirmar un plan con foto: cada pieza que materializa un elemento en el que la lectura vio flores de globo las
 * lleva como adorno (`floresDesdeLectura`). Una pieza que ya trae `flores` (las puso el decorador o la biblioteca) no se
 * toca. Puro; quien llama valida el plan y registra la decisión.
 */
export function aplicarFloresDeFoto<P extends { estructuras: ReadonlyArray<{ estructura_id: string; referencia_element_id?: string | undefined; materiales: readonly MaterialPieza[]; flores?: FloresPieza | undefined }> }>(
  plan: P,
  blueprint: BlueprintConFlores,
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
    const flores = floresDesdeLectura(estructura.materiales, leidas);
    if (!flores) {
      omitidas.push({
        estructura_id: estructura.estructura_id,
        referencia,
        leidas,
        motivo: leidas.confianza < CONFIANZA_MINIMA_FLORES ? "lectura poco fiable" : `la pieza no lleva globos ${leidas.color_petalo} para los pétalos`,
      });
      return estructura;
    }
    aplicadas.push({ estructura_id: estructura.estructura_id, referencia, flores });
    return { ...estructura, flores };
  });
  return { plan: aplicadas.length ? { ...plan, estructuras } : plan, aplicadas, omitidas };
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
 * principal de la pieza; el centro del color pedido o, sin él, el segundo color de la pieza. Devuelve el motivo en
 * palabras de cliente cuando no se puede (ningún globo del plan es de ese color).
 */
export function edicionFloresDePedido(
  plan: PlanConMateriales,
  estructuraId: string,
  pedido: PedidoFlores,
): { ok: true; edicion: EdicionFloresPedida } | { ok: false; motivo: string } {
  const pieza = plan.estructuras.find((estructura) => estructura.estructura_id === estructuraId);
  if (!pieza) return { ok: false, motivo: "No encontré esa pieza en tu plan." };
  if (pedido.quitar) {
    if (!pieza.flores) return { ok: false, motivo: "Esa pieza no lleva flores." };
    return { ok: true, edicion: { accion: "flores", estructura_id: estructuraId, flores: null } };
  }
  const todos = [...pieza.materiales, ...plan.estructuras.filter((estructura) => estructura !== pieza).flatMap((estructura) => estructura.materiales)];
  const petalo = pedido.colorPetalo ? materialDeColor(todos, pedido.colorPetalo) : pieza.materiales[0] ?? null;
  if (!petalo) return { ok: false, motivo: `Tu plan no lleva globos ${pedido.colorPetalo}; agrega primero ese color y luego las flores.` };
  const centro = pedido.colorCentro
    ? materialDeColor(todos, pedido.colorCentro)
    : pieza.materiales.find((material) => colorCanonico(material.color) !== colorCanonico(petalo.color)) ?? null;
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
