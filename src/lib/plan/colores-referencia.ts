import type { ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { clasificarColores, PALETA_COLORES_V2, plegarTexto } from "@/lib/rag/taxonomy/v2";
import { colorCatalogoMasCercano, colorDeCompraSinVenta, LAB_COLORES } from "@/lib/rag/catalog/similitud-color";

/** Lo que una apariencia aporta al color: los nombres que el analizador escribió y, si hay foto, la medida. */
type AparienciaColor = {
  observed_colors: readonly string[];
  measured_colors?: ReadonlyArray<{ color: string; share: number }>;
  /** La pieza entera es de este color, dicho por quien miró la foto (`color_unico`). */
  color_unico?: string;
};

/**
 * Dominant colors of a reference photo versus the colors a plan actually buys
 * (audit finding Alta #3). Regression: a burgundy photo became a silver and
 * white arch, and the columns of a second photo inherited the lilac palette of
 * the first one, all with `sustituciones: []`.
 *
 * Rule:
 * - The server copies into each plan structure with `referencia_element_id` the
 *   dominant colors of THAT element (`colores_referencia`): the first
 *   `MAX_COLORES_REFERENCIA` colors the analyzer NAMED in
 *   `appearance.observed_colors`, in the catalog vocabulary. The pixel
 *   measurement, when there is one, only orders and weighs them: a measured
 *   color the analyzer did not name never takes a slot, neutrals included
 *   (`coloresNombradosOrdenados`, 2026-10-05). With several photos each
 *   structure keeps the palette of its own photo. The model never writes the
 *   field.
 * - The other colors the analysis shows the customer (`coloresFotoCliente`) that
 *   no structure buys are appended to the structure whose element names them,
 *   or to the first structure when no materialized element does, so no photo
 *   color is lost without a notice and the notice lands on the right piece
 *   (E2E 2026-09-15, 2026-10-05; `aplicarColoresReferencia`).
 *   Only the element colors can make `confirmar_plan_decoracion` refuse a plan.
 * - Both resolvers (TypeScript here and `_reference_color_substitutions` in
 *   services/ai-api/app/plan.py) compare those colors with the colors of the
 *   structure's resolved lines and record every missing one in `sustituciones`,
 *   so the loss is visible in the plan and signed with it.
 *
 * Pure: no provider, HTTP, database or environment.
 */
export const MAX_COLORES_REFERENCIA = 3;

/**
 * Transparency is a finish, not a hue (see `TRANSPARENCIA`). A piece with clear
 * balloons keeps them on top of its `MAX_COLORES_REFERENCIA` hues: in a photo
 * with pink, silver, white and clear balloons the clear ones came fourth and
 * were never claimed (2026-09-24).
 */
const TRANSPARENTE = "transparente";

/**
 * English photo words the catalog taxonomy does not alias. "gris" is not a
 * catalog color: it is kept so a grey/graphite photo is reported as lost
 * instead of silently ignored. Names with no clear catalog color (copper,
 * bronze, taupe, terracotta) stay out on purpose: mapping them needs a product
 * decision, and inventing one would buy the wrong balloon.
 */
const SINONIMOS_FOTO: ReadonlyArray<readonly [RegExp, string]> = [
  // Before the generic "pink" alias: the catalog sells these as fucsia.
  [/\b(?:hot|neon|shocking)\s+pink\b/g, "fucsia"],
  [/\boff white\b/g, "crema"],
  [/\b(?:lilac|lavender|mauve)\b/g, "lila"],
  [/\bviolet\b/g, "violeta"],
  [/\b(?:maroon|wine|bordeaux|oxblood)\b/g, "burdeos"],
  [/\b(?:ivory|cream)\b/g, "crema"],
  [/\b(?:teal|aqua|turquoise|cyan)\b/g, "turquesa"],
  [/\b(?:peach|salmon)\b/g, "coral"],
  [/\b(?:tan|sand|khaki)\b/g, "beige"],
  [/\bnavy\b/g, "azul"],
  [/\b(?:sage|emerald|lime|olive)\b/g, "verde"],
  [/\bplum\b/g, "morado"],
];
const GRIS = /\b(?:gr[ae]y|graphite|charcoal|gris|grafito)\b/;

/**
 * Transparency is a finish, not a hue: the analyzer is told to prefix it
 * ("clear pink", "crystal blue") and the catalog sells the Cristal line in
 * several hues. Alone it is the color "transparente".
 */
const TRANSPARENCIA = /\b(?:clear|transparent|transparente|transparentes|crystal|cristal)\b/g;

/** Punctuation that joins several colors in one label ("white/gold"); the fold turns it into a space, so it has to be split first. */
const SEPARADOR_PUNTUACION = /[,;/&+]/;
/** Words that join several colors inside one observed label ("white and gold"). */
const SEPARADOR_COLORES = /\s*\b(?:and|with|plus|y|e|con)\b\s*/;

/**
 * Disyunción dentro de una etiqueta observada ("pink or coral"): el analizador
 * no decidió. La taxonomía compartida sí detecta la ambigüedad, pero con los
 * marcadores del español ("rojo o azul"), y estas etiquetas las escribe el
 * analizador en inglés, así que allí nunca disparaban. Se separa aquí, en el
 * módulo que es dueño de leer etiquetas de foto, en vez de meter inglés en una
 * taxonomía que sirve para el texto que lee el cliente.
 */
const SEPARADOR_AMBIGUO = /\s*\b(?:or|o|u)\b\s*/;

/**
 * Catalog-vocabulary color of one part of an observed label. A part is ONE
 * color: a shade written with two color words ("mint green", "wine red",
 * "silver grey") keeps its first, more specific word, so it does not report a
 * second color the photo never had.
 */
function coloresDeParte(parte: string): string[] {
  let texto = parte;
  for (const [patron, color] of SINONIMOS_FOTO) texto = texto.replace(patron, color);
  const sinTransparencia = texto.replace(TRANSPARENCIA, " ");
  const transparente = sinTransparencia !== texto;
  texto = sinTransparencia;
  const clasificacion = clasificarColores(texto);
  const utiles = clasificacion.values.filter((color) => color !== "multicolor");
  // Ambiguo es el analizador diciendo "es uno de estos" ("pink or coral"). Antes
  // se resolvía tomando el primero, que es resolver por orden de lista y no por
  // la foto; el resultado era que la mitad de las veces se compraba el otro. Si
  // no decidió, no decidimos por él: entran los dos y la foto —o el cliente— lo
  // desempata.
  if (clasificacion.status === "ambiguous" && utiles.length > 1) return utiles;
  const conocido = clasificacion.status === "unknown" ? undefined : utiles[0];
  const unico = conocido ?? (GRIS.test(texto) ? "gris" : transparente ? "transparente" : undefined);
  return unico ? [unico] : [];
}

/**
 * Catalog finish an observed label describes ("chrome gold" -> reflex).
 *
 * Until 2026-09-29 this lived only as a rule in the system prompt
 * ("chrome/metallic = reflex, pearl = satin") that the model applied, or did
 * not: it read "pearl blush pink" and bought a Reflex Dorado Rosa, dragging the
 * gold's chrome onto the rest of the piece and opening the door to a chromed
 * fuchsia the photo never had. Resolving it here makes the finish a datum of
 * the photo, one per color, instead of an inference the model makes once for
 * the whole structure.
 *
 * `undefined` when the label says nothing about finish: silence is not "mate".
 */
const ACABADO_DE_ETIQUETA: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(chrome|chromed|metallic|metalli[sz]ed|cromad[oa]|metalizad[oa])\b/i, "reflex"],
  [/\b(pearl|pearlescent|pearly|perlad[oa]|nacarad[oa])\b/i, "satin"],
  [/\b(satin|satinad[oa])\b/i, "satin"],
  [/\b(matte|matt|mate)\b/i, "mate"],
];

export function acabadoDeEtiqueta(etiqueta: string): string | undefined {
  for (const [patron, acabado] of ACABADO_DE_ETIQUETA) if (patron.test(etiqueta)) return acabado;
  return undefined;
}

export type ColorObservadoConAcabado = { color: string; acabado?: string; etiqueta: string };

/**
 * Dominant colors of a reference element, each with the finish its own label
 * showed. The finish travels WITH the color: a photo with one chromed gold and
 * a pearl blush must not buy both in the same family.
 *
 * Solo colores que el analizador nombró, en el orden de los dominantes (el de la
 * medida cuando la hay). Hasta el 2026-10-05 se añadía detrás cualquier neutro
 * medido en píxeles aunque nadie lo hubiera nombrado, y eso metía en el prompt
 * la pared blanca o el fondo negro que caían dentro de la caja de la pieza como
 * si fueran globos (`coloresNombradosOrdenados`).
 */
export function coloresConAcabadoReferencia(apariencia: AparienciaColor | readonly string[]): ColorObservadoConAcabado[] {
  const entrada = aparienciaDe(apariencia);
  return conAcabadoDeEtiqueta(entrada, coloresDominantesReferencia(entrada));
}

/**
 * TODOS los colores que el analizador nombró en la pieza, cada uno con el
 * acabado de su etiqueta, sin el tope de `MAX_COLORES_REFERENCIA` y en el mismo
 * orden que los dominantes. Los dominantes son lo que la pieza DEBE llevar; esto
 * es lo que la foto dice que tiene. Lo usan quienes no pueden permitirse
 * olvidar el cuarto color: la regla 3 de `aplicarReferenciasMedidas` (no cambia
 * un color que el analizador nombró) y `aplicarColoresReferencia` (el aviso de
 * un color que ninguna pieza compra va a la pieza que lo muestra).
 */
export function coloresNombradosReferencia(apariencia: AparienciaColor | readonly string[]): ColorObservadoConAcabado[] {
  const entrada = aparienciaDe(apariencia);
  return conAcabadoDeEtiqueta(entrada, coloresNombradosOrdenados(entrada));
}

function aparienciaDe(apariencia: AparienciaColor | readonly string[]): AparienciaColor {
  return Array.isArray(apariencia) ? { observed_colors: apariencia } : (apariencia as AparienciaColor);
}

/** Cada color con la PRIMERA etiqueta que lo escribe y el acabado que esa etiqueta dice. */
function conAcabadoDeEtiqueta(entrada: AparienciaColor, colores: readonly string[]): ColorObservadoConAcabado[] {
  const porColor = new Map<string, ColorObservadoConAcabado>();
  for (const etiqueta of entrada.observed_colors) {
    const acabado = acabadoDeEtiqueta(etiqueta);
    for (const color of coloresDeEtiqueta(etiqueta)) {
      if (!porColor.has(color)) porColor.set(color, { color, etiqueta, ...(acabado ? { acabado } : {}) });
    }
  }
  // Un color que ninguna etiqueta escribe solo puede ser `color_unico`, la lectura de que la pieza entera es de
  // ese color: no hay etiqueta que leer, así que viaja sin acabado (el silencio no es mate).
  return colores.map((color) => porColor.get(color) ?? { color, etiqueta: color });
}

/** Catalog-vocabulary colors of one observed label, in reading order. */
function coloresDeEtiqueta(etiqueta: string): string[] {
  const colores: string[] = [];
  for (const bruto of etiqueta.split(SEPARADOR_PUNTUACION)) {
    for (const parte of plegarTexto(bruto).split(SEPARADOR_COLORES)) {
      // Una parte ambigua aporta TODAS sus alternativas: si el analizador no
      // eligió, elegir por él acierta la mitad de las veces.
      for (const alternativa of parte.split(SEPARADOR_AMBIGUO)) colores.push(...coloresDeParte(alternativa));
    }
  }
  return colores;
}

/** Every known color of the observed labels, in reading order. */
function coloresObservados(apariencia: AparienciaColor): string[] {
  const colores: string[] = [];
  for (const etiqueta of apariencia.observed_colors) {
    for (const color of coloresDeEtiqueta(etiqueta)) {
      if (!colores.includes(color)) colores.push(color);
    }
  }
  return colores;
}

/**
 * Una pieza de un solo color compra UN material. Manda sobre las etiquetas y
 * sobre la medida porque las dos confunden el color de un globo con su reflejo:
 * un cromado es un espejo y devuelve los marrones y los rosas de lo que tiene
 * alrededor. Quien miró la foto sí los separa (2026-10-03). Solo se guarda una
 * lectura con confianza >= 0,5 (`adjuntarPistasPatron` en
 * amaterasu/patron-referencia.ts y `validar_pistas` en Python, 2026-10-05). El
 * blueprint no lleva esa confianza, así que aquí no se puede volver a mirar: un
 * blueprint analizado antes de esa fecha que el navegador todavía guarde puede
 * traer una lectura dudosa hasta que la foto se vuelva a analizar.
 */
function colorUnico(apariencia: AparienciaColor): string | undefined {
  return apariencia.color_unico && COLORES_CATALOGO.has(apariencia.color_unico) ? apariencia.color_unico : undefined;
}

/**
 * Los colores que el analizador NOMBRÓ en una pieza, todos, en el orden en que
 * cuentan: primero los que la medición en píxeles también vio, de mayor a menor
 * participación; detrás, los que nombró y los píxeles no vieron, en el orden de
 * sus etiquetas. Sin medida, el orden de las etiquetas.
 *
 * **Las etiquetas deciden QUÉ colores tiene la pieza; la medida solo los ORDENA
 * y los PESA** (decisión del 2026-10-05). La medida es más fiel que el orden de
 * redacción —ese era el problema que arregla la fase 2.1— pero no sabe si está
 * mirando globos o lo que hay detrás de ellos: su única guía es la caja del
 * elemento. Medido sobre una foto real el 2026-10-03: dentro de una caja ajustada
 * a la guirnalda dio `plateado 49 % · blanco 33 % · rosado 18 %`, que es exacto;
 * una caja que respiraba sobre la pared dio **`lila 93 %`**, que es una luz LED y
 * no un globo.
 *
 * Por eso un color medido que el analizador no nombró no entra nunca, tampoco un
 * neutro. Hasta el 2026-10-05 los neutros sí entraban («la luz no los inventa») y
 * además primero: la pared blanca o el fondo negro que caían dentro de la caja se
 * llevaban uno de los tres cupos y echaban un color real de la pieza
 * (`[pearl pink, chrome gold, lilac]` + `blanco 45 %` medido daba
 * `[blanco, rosado, dorado]`, y el lila se perdía). Lo que la luz sí inventa —el
 * lila sobre los globos blancos de la foto de ejemplo 01— ya se descartaba por
 * no estar nombrado. Al revés, lo nombrado que los píxeles no ven se queda: la
 * plata cromada refleja lo de alrededor y los píxeles la leen como blanco, y la
 * pieza sigue siendo rosa y plata (2026-10-04), sin un blanco inventado.
 *
 * Un color que el catálogo no vende pero tiene con qué comprarse
 * (`colorDeCompraSinVenta`, gris → plateado) pasa igual que por las etiquetas:
 * antes la medida lo filtraba al catálogo y un gris medido desaparecía sin
 * sustitución ni aviso (SEGUIMIENTO-color-referencia.md §4.1 b).
 */
function coloresNombradosOrdenados(apariencia: AparienciaColor): string[] {
  const unico = colorUnico(apariencia);
  if (unico) return [unico];
  const nombrados = coloresObservados(apariencia);
  const medidos = [...(apariencia.measured_colors ?? [])].sort((uno, otro) => otro.share - uno.share).map((entrada) => entrada.color);
  const vistos = medidos.filter((color, indice) => nombrados.includes(color) && medidos.indexOf(color) === indice);
  return [...vistos, ...nombrados.filter((color) => !vistos.includes(color))];
}

/**
 * The first `MAX_COLORES_REFERENCIA` hues of a piece, in the order given, plus
 * two colors that never take one of those slots:
 * - `transparente`, a finish rather than a hue (pixels cannot see a clear
 *   balloon, so it always comes from the labels);
 * - a color the catalog does not sell when the piece also has the color it is
 *   bought as ("gris" beside "plateado"): it is the same purchase, so it must
 *   not push a real color out, but it stays so the resolver reports the
 *   substitution to the customer (phase 2.5: substitute, never hide).
 */
function seleccionarDominantes(colores: readonly string[]): string[] {
  const elegidos: string[] = [];
  let tonos = 0;
  for (const color of colores) {
    if (elegidos.includes(color)) continue;
    const sustituto = colorDeCompraSinVenta(color);
    const sinCupo = color === TRANSPARENTE || Boolean(sustituto && colores.includes(sustituto));
    if (!sinCupo) {
      if (tonos === MAX_COLORES_REFERENCIA) continue;
      tonos += 1;
    }
    elegidos.push(color);
  }
  return elegidos;
}

export function coloresDominantesReferencia(apariencia: AparienciaColor | readonly string[]): string[] {
  return seleccionarDominantes(coloresNombradosOrdenados(aparienciaDe(apariencia)));
}

/**
 * Los colores que el analizador nombró en toda la foto, con la misma regla que
 * una pieza (`coloresNombradosOrdenados`): primero los que la medición también
 * vio, sumados por participación sobre los elementos aprobados en vez de
 * concatenados —sin sumar, un elemento pequeño con tres colores pesaría lo mismo
 * que el arco que ocupa media foto—; detrás, los nombrados que ningún píxel vio,
 * en el orden de las etiquetas. `undefined` sin medida en ningún elemento.
 *
 * No filtra al catálogo: esto es lo que se le enseña al cliente como "los
 * colores de tu foto", y un `gris` que el catálogo no vende tiene que aparecer
 * para poder reportarse como perdido, no desaparecer. Hasta el 2026-10-05 eran
 * los colores medidos crudos, sin mirar las etiquetas: la madera de una mesa o
 * la pared que caían en la caja de una pieza llegaban al cliente como color de
 * su foto y volvían como aviso de "esta pieza no lo lleva".
 */
function coloresMedidosDeFoto(blueprint: Pick<ReferenceBlueprintV2, "elements"> | undefined): string[] | undefined {
  const aprobados = blueprint?.elements.filter((elemento) => elemento.approved) ?? [];
  if (!aprobados.some((elemento) => elemento.appearance.measured_colors?.length)) return undefined;
  const suma = new Map<string, number>();
  const nombradosDeFoto: string[] = [];
  for (const elemento of aprobados) {
    const nombrados = coloresNombradosOrdenados(elemento.appearance);
    for (const color of nombrados) if (!nombradosDeFoto.includes(color)) nombradosDeFoto.push(color);
    // El área de la caja pondera: un color que domina un elemento diminuto no
    // domina la foto.
    const area = elemento.reference_bbox.width * elemento.reference_bbox.height;
    for (const entrada of elemento.appearance.measured_colors ?? []) {
      if (nombrados.includes(entrada.color)) suma.set(entrada.color, (suma.get(entrada.color) ?? 0) + entrada.share * area);
    }
  }
  const medidos = [...suma.entries()].sort((uno, otro) => otro[1] - uno[1] || (uno[0] < otro[0] ? -1 : 1)).map(([color]) => color);
  const colores = [...medidos, ...nombradosDeFoto.filter((color) => !medidos.includes(color))];
  return colores.length ? colores : undefined;
}

/**
 * Colors the analysis shows the customer as "the colors of your photo", at most
 * `MAX_COLORES_FOTO_CLIENTE`. With a pixel measurement, the colors the analyzer
 * named in the approved elements ordered by that measurement
 * (`coloresMedidosDeFoto`), the same rule as each piece, so the customer, the
 * plan and its notices talk about the same colors. Without one, the known
 * colors of `palette.observed` (the approved elements when the palette is
 * empty), the same source and bound as the analysis card
 * (`coloresObservadosCliente`, presentacion-cliente.ts).
 */
export const MAX_COLORES_FOTO_CLIENTE = 5;

export function coloresFotoCliente(blueprint: Pick<ReferenceBlueprintV2, "palette" | "elements"> | undefined): string[] {
  if (!blueprint) return [];
  // La medida manda sobre `palette.observed`, que es una segunda salida del
  // modelo tan inestable como la primera: en cinco corridas de la misma foto dio
  // cuatro paletas distintas (G1).
  const medidos = coloresMedidosDeFoto(blueprint);
  if (medidos) return medidos.slice(0, MAX_COLORES_FOTO_CLIENTE);
  const observados = blueprint.palette.observed.length
    ? blueprint.palette.observed
    : blueprint.elements.filter((elemento) => elemento.approved).flatMap((elemento) => elemento.appearance.observed_colors);
  const colores: string[] = [];
  for (const etiqueta of observados) {
    for (const color of coloresDeEtiqueta(etiqueta)) {
      if (!colores.includes(color)) colores.push(color);
    }
  }
  return colores.slice(0, MAX_COLORES_FOTO_CLIENTE);
}

/** Dominant colors of one approved reference element (what `colores_referencia` starts with). */
export function coloresElementoReferencia(blueprint: Pick<ReferenceBlueprintV2, "elements"> | undefined, elementId: string | undefined): string[] {
  const elemento = elementId ? blueprint?.elements.find((item) => item.approved && item.element_id === elementId) : undefined;
  return elemento ? coloresDominantesReferencia(elemento.appearance) : [];
}

/**
 * Todo lo que un elemento de la foto muestra, sin el tope de
 * `MAX_COLORES_REFERENCIA` y sin filtrar al catálogo: los colores de sus
 * etiquetas y los medidos en píxeles.
 *
 * Los dominantes son lo que una pieza DEBE llevar, y por eso van acotados a
 * tres. Esto es lo contrario: la lista contra la que se decide si un color que
 * el plan compra existe en la foto. Acotarla aquí acusaría de invención al
 * cuarto color de una foto que sí lo tiene.
 *
 * Por lo mismo sigue contando lo medido que nadie nombró, al revés que los
 * dominantes (`coloresNombradosOrdenados`): aquí se decide QUITAR un globo del
 * plan, y para quitarlo hace falta que ni las etiquetas ni los píxeles lo vean.
 * Que un color medido no pida cupo no prueba que la foto no lo tenga.
 */
export function coloresObservadosElemento(apariencia: AparienciaColor): string[] {
  const colores = coloresObservados(apariencia);
  for (const entrada of apariencia.measured_colors ?? []) {
    if (!colores.includes(entrada.color)) colores.push(entrada.color);
  }
  return colores;
}

export type MaterialColorInventado = { estructura_id: string; product_id: string; color: string };

/**
 * `transparente` es un acabado, no un tono, y `multicolor` no es un color: un
 * globo cristal o un confeti no prometen un tono que la foto no tenga, así que
 * ninguno se juzga contra ella. Que una pieza se arme ENTERA en transparente
 * para una foto rosa y plata lo sigue atendiendo `coloresReferenciaOmitidos`,
 * que es la mitad de la auditoría que mira la pérdida.
 */
const COLORES_SIN_TONO: ReadonlySet<string> = new Set([TRANSPARENTE, "multicolor"]);

/**
 * Materiales cuyo color la foto no tiene: el espejo que le faltaba a
 * `coloresReferenciaOmitidos`.
 *
 * Toda la maquinaria de color miraba en una sola dirección —los colores de la
 * foto que el plan NO compra— y nada vigilaba el caso inverso. El 2026-09-29,
 * con una pared de globos leída bien (blush perlado, dorado cromado, blanco
 * mate), el modelo compró además un "Reflex Fucsia" que la foto nunca tuvo, y
 * de ahí en cadena la pista de patrón de la foto no encontró material para su
 * rosado y el armado cayó al preset de confeti. El prompt ya lo prohibía con
 * palabras; el modelo las ignoró.
 *
 * Una invención NO es una sustitución. La diferencia se mide con el mismo
 * modelo cromático que ADR-0024 usa para resolver "gris" como "plateado" a
 * ΔE 16: `colorCatalogoMasCercano` devuelve `undefined` por encima de
 * `DELTA_E_MAXIMO`. "dorado rosa" está a 23 del "rosado" observado —es la
 * sustitución que `sustitucionesColorReferencia` ya le reporta al cliente— y
 * "fucsia" a 48 del rosado, 88 del blanco y 97 del dorado: no está en la foto.
 *
 * Solo juzga estructuras que materializan un elemento (`referencia_element_id`)
 * y solo cuando se pudo leer TODA su paleta: una etiqueta que la taxonomía no
 * alias a propósito ("copper", "taupe") es color de la foto que no vemos, y sin
 * verlo no se puede afirmar que un material no le corresponda.
 *
 * Pura: sin proveedor, HTTP, base de datos ni entorno.
 */
export function materialesDeColorInventado<E extends {
  estructura_id: string;
  referencia_element_id?: string;
  materiales: ReadonlyArray<{ product_id: string; color?: string }>;
}>(estructuras: readonly E[], blueprint: Pick<ReferenceBlueprintV2, "elements"> | undefined): MaterialColorInventado[] {
  if (!blueprint) return [];
  const elementos = new Map(blueprint.elements.filter((elemento) => elemento.approved).map((elemento) => [elemento.element_id, elemento]));
  const inventados: MaterialColorInventado[] = [];
  for (const estructura of estructuras) {
    const elemento = estructura.referencia_element_id ? elementos.get(estructura.referencia_element_id) : undefined;
    if (!elemento) continue;
    if (elemento.appearance.observed_colors.some((etiqueta) => coloresDeEtiqueta(etiqueta).length === 0)) continue;
    const observados = coloresObservadosElemento(elemento.appearance).map(normalizarColor).filter(Boolean);
    if (observados.length === 0) continue;
    for (const material of estructura.materiales) {
      const color = normalizarColor(material.color ?? "");
      if (!color || COLORES_SIN_TONO.has(color) || observados.includes(color)) continue;
      // Sin tono medible no hay distancia que sostenga la acusación.
      if (!LAB_COLORES[color]) continue;
      if (colorCatalogoMasCercano(color, observados)) continue;
      inventados.push({ estructura_id: estructura.estructura_id, product_id: material.product_id, color });
    }
  }
  return inventados;
}

export type AcabadoObservadoMaterial = { estructura_id: string; product_id: string; color: string; acabado: string };

/**
 * El acabado que la foto muestra para el color de cada material.
 *
 * `coloresConAcabadoReferencia` resuelve el acabado por color y el prompt se lo
 * entrega al modelo ya resuelto, pero nadie vigilaba que lo usara: con la pared
 * "Mr & Mrs" (blush perlado, dorado cromado, blanco mate) el modelo compró el
 * blush como "Reflex Dorado Rosa" y el cromado del dorado se contagió al rosa
 * (2026-09-29). Esto devuelve lo que la foto exige, material por material, para
 * que `aplicarAcabadoReferencia` (cobertura-materiales.ts) lo respete o lo avise.
 *
 * A qué color de la foto sirve un material se decide con el mismo criterio con
 * que `materialesDeColorInventado` distingue una sustitución de una invención
 * (ADR-0024, ΔE): el "dorado rosa" que se compró está a 23 del "rosado"
 * observado, así que sirve al blush y debe llevar SU acabado, no el del dorado.
 * El vecino se busca entre TODOS los colores dominantes, no solo entre los que
 * traen acabado: si no, un rosado sin acabado indicado caería en el dorado
 * cromado de al lado y acabaríamos exigiendo cromo sobre un globo rosa.
 *
 * Un color sin acabado en su etiqueta no exige ninguno: el silencio no es mate.
 *
 * Pura: sin proveedor, HTTP, base de datos ni entorno.
 */
export function acabadosObservadosDeMateriales<E extends {
  estructura_id: string;
  referencia_element_id?: string;
  materiales: ReadonlyArray<{ product_id: string; color?: string }>;
}>(estructuras: readonly E[], blueprint: Pick<ReferenceBlueprintV2, "elements"> | undefined): AcabadoObservadoMaterial[] {
  if (!blueprint) return [];
  const elementos = new Map(blueprint.elements.filter((elemento) => elemento.approved).map((elemento) => [elemento.element_id, elemento]));
  const esperados: AcabadoObservadoMaterial[] = [];
  for (const estructura of estructuras) {
    const elemento = estructura.referencia_element_id ? elementos.get(estructura.referencia_element_id) : undefined;
    if (!elemento) continue;
    // Los mismos pares color→acabado que el prompt le entrega al modelo, así que
    // la frontera exige exactamente lo que se le pidió y no otra lectura.
    const acabadoPorColor = new Map<string, string>();
    const tonos: string[] = [];
    for (const observado of coloresConAcabadoReferencia(elemento.appearance)) {
      const color = normalizarColor(observado.color);
      if (!color || COLORES_SIN_TONO.has(color)) continue;
      if (!tonos.includes(color)) tonos.push(color);
      if (observado.acabado && !acabadoPorColor.has(color)) acabadoPorColor.set(color, observado.acabado);
    }
    if (acabadoPorColor.size === 0) continue;
    for (const material of estructura.materiales) {
      const color = normalizarColor(material.color ?? "");
      if (!color || COLORES_SIN_TONO.has(color)) continue;
      const servido = tonos.includes(color) ? color : LAB_COLORES[color] ? colorCatalogoMasCercano(color, tonos) : undefined;
      const acabado = servido ? acabadoPorColor.get(servido) : undefined;
      if (!acabado) continue;
      esperados.push({ estructura_id: estructura.estructura_id, product_id: material.product_id, color, acabado });
    }
  }
  return esperados;
}

const COLORES_CATALOGO: ReadonlySet<string> = new Set(PALETA_COLORES_V2);

/**
 * Catalog colors a search must be able to return for a reference photo: the
 * dominant colors of its approved balloon structures, or of the photo palette
 * when it has none. A color the catalog does not sell ("gris") is left out, so
 * it never forces the relaxation ladder to drop the occasion for nothing.
 */
/**
 * Colors the photo's *balloon* structures show. The venue is not decoration: a
 * brick wall behind the piece put "cafe" and "rojo" in `palette.observed`, and
 * through it into the colors a piece was asked to cover (2026-09-29).
 */
export function coloresGlobosReferencia(blueprint: Pick<ReferenceBlueprintV2, "palette" | "elements"> | undefined): string[] {
  if (!blueprint) return [];
  const estructuras = blueprint.elements.filter((elemento) => elemento.approved && elemento.category === "balloon_structure");
  return estructuras.length
    ? [...new Set(estructuras.flatMap((elemento) => coloresDominantesReferencia(elemento.appearance)))]
    : coloresFotoCliente(blueprint).slice(0, MAX_COLORES_REFERENCIA);
}

export function coloresFotoParaBusqueda(blueprint: Pick<ReferenceBlueprintV2, "palette" | "elements"> | undefined): string[] {
  return coloresGlobosReferencia(blueprint).filter((color) => COLORES_CATALOGO.has(color));
}

function normalizarColor(color: string): string {
  return color.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

function unirColores(colores: readonly string[]): string {
  return colores.length <= 1 ? (colores[0] ?? "") : `${colores.slice(0, -1).join(", ")} y ${colores.at(-1)}`;
}

export type SustitucionColor = { estructura_id: string; pedido: string; entregado: string; motivo: string };

/**
 * One substitution per photo color that no resolved line of the structure has.
 * A structure without resolved lines is reported as uncovered by the resolver,
 * not as a color change. Mirror: `_reference_color_substitutions` (plan.py).
 */
export function sustitucionesColorReferencia(
  estructuraId: string,
  coloresReferencia: readonly string[],
  coloresLineas: ReadonlyArray<string | null | undefined>,
  /**
   * Colors a line covers although its label says another one: the color the
   * plan asked for when the resolver relabelled the line with the variant's
   * real color (`colorDeLinea`). They only make the comparison tolerant; the
   * customer is always told the colors the lines actually say.
   */
  coloresEquivalentes: ReadonlyArray<string | null | undefined> = [],
): SustitucionColor[] {
  const entregados: string[] = [];
  for (const color of coloresLineas) {
    const normalizado = color ? normalizarColor(color) : "";
    if (normalizado && !entregados.includes(normalizado)) entregados.push(normalizado);
  }
  if (entregados.length === 0) return [];
  const cubiertos = new Set(entregados);
  for (const color of coloresEquivalentes) {
    const normalizado = color ? normalizarColor(color) : "";
    if (normalizado) cubiertos.add(normalizado);
  }
  const pedidos: string[] = [];
  for (const color of coloresReferencia) {
    const normalizado = normalizarColor(color);
    if (normalizado && !pedidos.includes(normalizado)) pedidos.push(normalizado);
  }
  return pedidos
    .filter((pedido) => !cubiertos.has(pedido))
    .map((pedido) => {
      // Un color que el catálogo no vende (`gris`) y cuya pieza lleva el color
      // con que se compra (`plateado`) no se perdió: se sustituyó, y se dice así.
      const sustituto = colorDeCompraSinVenta(pedido);
      if (sustituto && cubiertos.has(sustituto)) {
        return { estructura_id: estructuraId, pedido, entregado: sustituto, motivo: `La foto de referencia muestra ${pedido}, que el catálogo no vende: se usó ${sustituto}.` };
      }
      return {
        estructura_id: estructuraId,
        pedido,
        entregado: entregados.join(", "),
        motivo: `La foto de referencia muestra ${pedido} y esta pieza no lo lleva: se armó con ${unirColores(entregados)}.`,
      };
    });
}

/** Size substitutions carry a size code ("R-12"); color substitutions carry a color. */
export function esSustitucionDeColor(sustitucion: { pedido: string }): boolean {
  return !/^R-\d/i.test(sustitucion.pedido.trim());
}

/** A catalog product that offers a photo color, and whether this turn's search already returned it. */
export type ProductoColorDisponible = {
  product_id: string;
  titulo: string;
  en_busqueda: boolean;
  /** Available round sizes (inches) inside the active catalog pool, when known. */
  diametros?: readonly number[];
};

export type ColorReferenciaOmitido = {
  estructura_id: string;
  nombre: string;
  color: string;
  productos: ProductoColorDisponible[];
};

/** Catalog categories whose products can build a balloon structure in a photo color. */
const CATEGORIAS_GLOBO_COLOR = new Set(["globo_latex"]);

/**
 * Photo colors each candidate of this turn's search offers as a round latex
 * balloon (the material a photo's balloon structure is built with). Pure.
 */
export function productosGloboPorColor(
  candidatos: ReadonlyArray<{ productId: string; titulo: string; categoria: string | null; colores: readonly string[]; variantes: ReadonlyArray<{ forma: string | null; colores: readonly string[]; disponible: boolean; diamPulg?: number | null }> }>,
  colores: readonly string[],
): Map<string, ProductoColorDisponible[]> {
  const buscados = new Set(colores.map(normalizarColor));
  const resultado = new Map<string, ProductoColorDisponible[]>();
  for (const candidato of candidatos) {
    if (!candidato.categoria || !CATEGORIAS_GLOBO_COLOR.has(candidato.categoria)) continue;
    const redondas = candidato.variantes.filter((variante) => variante.disponible && variante.forma === "redondo");
    if (redondas.length === 0) continue;
    const coloresProducto = new Set([...candidato.colores, ...redondas.flatMap((variante) => variante.colores)].map(normalizarColor));
    for (const color of buscados) {
      if (!coloresProducto.has(color)) continue;
      const lista = resultado.get(color) ?? [];
      if (!lista.some((item) => item.product_id === candidato.productId)) {
        const diametros = [...new Set(redondas.map((variante) => variante.diamPulg).filter((diametro): diametro is number => typeof diametro === "number"))];
        lista.push({ product_id: candidato.productId, titulo: candidato.titulo, en_busqueda: true, diametros });
      }
      resultado.set(color, lista);
    }
  }
  return resultado;
}

/**
 * Dominant photo colors a structure dropped although the catalog offers them
 * (E2E 2026-09-14: "Semiarcos rosa y plata" was quoted 100 % transparent with
 * three color notices while the active catalog had pink and silver balloons).
 * `sustitucionesColorReferencia` only reports the loss; this lets
 * `confirmar_plan_decoracion` refuse it while a real alternative exists. A color
 * the catalog does not offer (`disponibles` has no entry) is not returned: the
 * plan goes on and the resolver records the notice. Pure.
 */
export function coloresReferenciaOmitidos<E extends { estructura_id: string; nombre: string; colores_referencia?: readonly string[]; materiales: ReadonlyArray<{ color?: string }> }>(
  estructuras: readonly E[],
  disponibles: ReadonlyMap<string, readonly ProductoColorDisponible[]>,
  /** Whether a product can actually build this structure (its sizes fit the structure's mix). Default: yes. */
  sirveParaEstructura: (estructura: E, producto: ProductoColorDisponible) => boolean = () => true,
): ColorReferenciaOmitido[] {
  const omitidos: ColorReferenciaOmitido[] = [];
  for (const estructura of estructuras) {
    const usados = new Set(estructura.materiales.map((material) => normalizarColor(material.color ?? "")).filter(Boolean));
    for (const color of new Set((estructura.colores_referencia ?? []).map(normalizarColor))) {
      // A photo color no product can build in this structure's sizes is not
      // mandatory: claiming it would only trade the refusal for SIN_COBERTURA.
      const productos = (disponibles.get(color) ?? []).filter((producto) => sirveParaEstructura(estructura, producto)).map((producto) => ({ product_id: producto.product_id, titulo: producto.titulo, en_busqueda: producto.en_busqueda }));
      // A color the catalog does not sell is used when its stand-in is ("gris" as "plateado").
      if (!color || usados.has(color) || usados.has(colorDeCompraSinVenta(color) ?? "") || productos.length === 0) continue;
      omitidos.push({ estructura_id: estructura.estructura_id, nombre: estructura.nombre, color, productos: [...productos] });
    }
  }
  return omitidos;
}
