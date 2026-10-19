import type { AnalisisColorSempertex } from "./analisis-color";
import type { AjusteCobertura, DisponibilidadProducto } from "./cobertura-materiales";
import { coloresNombradosReferencia } from "./colores-referencia";
import { referenciaDelCatalogo, referenciaPorCodigo } from "./referencia-sempertex";
import type { PlanDecoracion } from "./tipos";
import type { ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { labDeRgb } from "@/lib/rag/catalog/similitud-color";
import { clasificarColores } from "@/lib/rag/taxonomy/v2";

/**
 * **La referencia Sempertex medida en la foto decide qué globo se compra.**
 *
 * La foto se mide contra las 90 referencias de la lámina (`color-sempertex.ts`): «Satín Rosado 409»,
 * «Pastel Mate Rosado 609», «Reflex Plata 981». Hasta el 2026-10-04 eso solo se enseñaba en pantalla; el
 * chat recibía la paleta de 26 palabras, donde los dos rosados son un solo «rosado», y el control de
 * acabado no conocía Pastel, Silk, Cristal ni Neón. Resultado medido: para dos columnas de rosa pastel,
 * lila satinado y transparentes, el plan compró Reflex Fucsia y Fashion Lila, aunque el catálogo tiene
 * Satin Rosado, Pastel Mate Rosado y Satin Lila.
 *
 * Aquí viven las cuatro piezas, puras (sin red, base ni entorno):
 * - `conReferenciasMedidas`: pega a cada elemento del blueprint sus referencias medidas.
 * - `familiaDeTitulo`: la familia de un producto del catálogo, leída de su título.
 * - `busquedasDeReferencias`: las búsquedas que faltan para que el turno tenga el producto exacto.
 * - `aplicarReferenciasMedidas`: al confirmar, cambia el material que no es la referencia medida por el
 *   producto que sí lo es, si la búsqueda del turno lo trae.
 */

type ReferenciaMedida = NonNullable<ReferenceBlueprintV2["elements"][number]["appearance"]["referencias_medidas"]>[number];

/** Por debajo de esta parte, un color medido es ruido (sombra, reflejo o fondo): no decide la compra. */
export const PARTE_MINIMA_REFERENCIA = 0.08;
const MAX_REFERENCIAS = 5;

function plegar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** El color de la lámina en la paleta del plan («Plata» → «plateado», «Lavanda» → «lila»). */
export function colorDeReferencia(nombre: string): string {
  // Sempertex 010 is named "Palo de Rosa". The catalog taxonomy does not
  // recognize that shade as rosado, so it was filtered out when the analyzer
  // had named pink; 609 then survived as the only usable measured pink.
  if (/\bpalo\s+de\s+rosa\b/.test(plegar(nombre))) return "rosado";
  return clasificarColores(nombre).values[0] ?? plegar(nombre);
}

/**
 * Las referencias de UNA pieza: la mejor candidata de cada color medido, juntando las que repiten código y
 * descartando lo que no es un globo (`sinReferencia`). La familia solo se da por buena si la foto la
 * restringió (el analizador dijo el acabado) o si el analizador nombró esa referencia, y nunca cuando las
 * dos primeras candidatas están tan juntas que la foto no permite elegir.
 */
export function referenciasDePieza(pieza: AnalisisColorSempertex["piezas"][number]): ReferenciaMedida[] {
  const porCodigo = new Map<string, ReferenciaMedida>();
  for (const color of pieza.colores) {
    const { cruce } = color;
    const mejor = cruce.candidatas[0];
    if (!mejor || cruce.sinReferencia) continue;
    const referencia = referenciaPorCodigo(mejor.codigo);
    if (!referencia) continue;
    const previa = porCodigo.get(mejor.codigo);
    const fiable = !cruce.ambigua && (cruce.familias.length > 0 || cruce.porNombre);
    if (previa) {
      previa.parte = Math.min(1, Math.round((previa.parte + color.parte) * 1e4) / 1e4);
      previa.familia_fiable = previa.familia_fiable || fiable;
      continue;
    }
    porCodigo.set(mejor.codigo, {
      codigo: mejor.codigo,
      familia: referencia.familia,
      nombre: referencia.nombre,
      nombre_completo: mejor.nombreCompleto,
      // Acotada como la suma de arriba: una pieza de un solo color medido llegaba con 1,00005 (suma en coma
      // flotante), se redondeaba a 1,0001 y el blueprint entero dejaba de cumplir su esquema (parte <= 1): la guiada
      // descartaba la lectura («no pude distinguir los detalles») y la clásica daba error (banco 2026-10-06).
      parte: Math.min(1, Math.round(color.parte * 1e4) / 1e4),
      familia_fiable: fiable,
    });
  }
  return [...porCodigo.values()].sort((a, b) => b.parte - a.parte).slice(0, MAX_REFERENCIAS);
}

/**
 * **El analizador decide QUÉ colores tiene la pieza; los píxeles solo afinan cuál referencia de ese color.**
 *
 * Los píxeles no distinguen el color de un globo del color de la luz que le pega. Medido el 2026-10-04 en
 * la foto de ejemplo 01 («Columnas rosa y plata», un salón con luz morada desde el piso): los globos blancos
 * y grises iluminados salían como Satín Lila 450, Silk Amatista 850 y Pastel Dusk Lavanda 150, y el plan
 * compraba lila, un color que la foto no tiene. Un balance de blancos con la cortina y la mesa de la misma
 * foto no lo arregla: la luz pega en la cara de los globos, no en el fondo, y corregirla borraba el rosa.
 * El analizador visual sí descuenta la luz («light pink, chrome silver, clear»): un tono que solo ven los
 * píxeles es luz o reflejo y se descarta.
 *
 * Los neutros tampoco pasan sin nombre (2026-10-05). Pasaban siempre («la luz no los crea»), pero los píxeles
 * no solo ven luz: ven lo que cae dentro de la caja, y una pared blanca o un fondo negro SÍ son neutros. Su
 * «Fashion Blanco» entraba al blueprint, y la regla 3 de `aplicarReferenciasMedidas` cambiaba por él el Satín
 * Lila que la foto sí tenía. Es la misma regla que los dominantes (`coloresNombradosOrdenados` en
 * colores-referencia.ts), con la lista entera de lo nombrado y no solo los tres primeros: el cuarto color de
 * la foto también tiene su referencia. El transparente sigue a su etiqueta como cualquier otro: solo con un
 * «clear» del analizador, porque los píxeles no ven un globo transparente. Sin un solo color nombrado no hay
 * nada que afinar y no queda ninguna referencia.
 */
function referenciasCompatibles(referencias: readonly ReferenciaMedida[], acabadoPorColor: ReadonlyMap<string, string | undefined>): ReferenciaMedida[] {
  return referencias
    .filter((referencia) => acabadoPorColor.has(colorDeReferencia(referencia.nombre)))
    .map((referencia) => {
      // La familia es segura cuando el analizador dijo el acabado de ESE color («chrome silver») y la
      // referencia es de una familia de ese acabado. La restricción de la medición solo existía si TODAS las
      // etiquetas de la pieza nombraban el mismo acabado, así que en una pieza de varios colores nunca lo era.
      const acabado = acabadoPorColor.get(colorDeReferencia(referencia.nombre));
      const fiable = referencia.familia_fiable || Boolean(acabado && FAMILIAS_DEL_ACABADO[acabado]?.includes(referencia.familia));
      return fiable === referencia.familia_fiable ? referencia : { ...referencia, familia_fiable: fiable };
    });
}

/** Las familias de la lámina que cumplen cada acabado que el analizador sabe nombrar (`ACABADO_DE_ETIQUETA`). */
const FAMILIAS_DEL_ACABADO: Readonly<Record<string, readonly string[]>> = {
  reflex: ["reflex"],
  satin: ["satin", "silk"],
  mate: ["fashion", "pastelMate", "pastelDusk"],
};

/**
 * Los colores que el analizador nombró en la pieza, con el acabado que les vio (si lo dijo). TODOS, sin el
 * tope de tres de los dominantes: leerlos de la lista acotada hacía que el cuarto color nombrado contara como
 * «nadie lo vio», y la regla 3 de `aplicarReferenciasMedidas` podía cambiarlo por otro (2026-10-05).
 */
export function coloresDelAnalizador(apariencia: ReferenceBlueprintV2["elements"][number]["appearance"]): Map<string, string | undefined> {
  return new Map(coloresNombradosReferencia(apariencia).map((observado) => [observado.color, observado.acabado]));
}

/** El blueprint con las referencias medidas de cada pieza; sin análisis de color, el mismo blueprint. */
export function conReferenciasMedidas(blueprint: ReferenceBlueprintV2, analisis: AnalisisColorSempertex | null): ReferenceBlueprintV2 {
  if (!analisis) return blueprint;
  const porElemento = new Map(analisis.piezas.map((pieza) => [pieza.elementId, referenciasDePieza(pieza)]));
  return {
    ...blueprint,
    elements: blueprint.elements.map((elemento) => {
      const referencias = referenciasCompatibles(porElemento.get(elemento.element_id) ?? [], coloresDelAnalizador(elemento.appearance));
      return referencias.length ? { ...elemento, appearance: { ...elemento.appearance, referencias_medidas: referencias } } : elemento;
    }),
  };
}

/** Familias de la lámina tal como las escribe el título del catálogo; las de dos palabras van primero. */
const FAMILIA_POR_PALABRAS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bpastel dusk\b/, "pastelDusk"],
  [/\bpastel mate\b/, "pastelMate"],
  [/\bcristal\b|\bcrystal\b/, "cristal"],
  [/\breflex\b/, "reflex"],
  [/\bsatin\b/, "satin"],
  [/\bsilk\b|\bseda\b/, "silk"],
  [/\bneon\b/, "neon"],
  [/\bmetal\b/, "metal"],
  [/\bfashion\b/, "fashion"],
];

/** Lo que el título dice además de familia y color: un globo con eso está impreso o es un surtido. */
const PREFIJO_GLOBO = /^(?:b2[bc] )?globo latex redondo /;

/**
 * La familia de la lámina de un producto del catálogo, leída de su título («B2b Globo Latex Redondo Satin
 * Rosado» → `satin`), o `null` si el título no es el de un globo liso de una familia. La taxonomía del
 * catálogo no sirve aquí: no tiene Pastel, Pastel Dusk, Silk, Neón ni Cristal («Pastel Dusk Lavanda» llega
 * con `finishes: []` y «Pastel Mate Rosado» como `mate`, igual que un Fashion).
 *
 * Solo globos lisos: lo que queda tras quitar el prefijo y la familia tiene que ser el color (dos palabras
 * como mucho y sin cifras). «Infinity® Coquette», «2 Caras Mis 15 Años» o «Duo Plata» no son un color de la
 * lámina, son globos impresos o surtidos que no reemplazan a una referencia.
 */
export function familiaDeTitulo(titulo: string): string | null {
  const texto = plegar(titulo);
  if (!PREFIJO_GLOBO.test(texto)) return null;
  const resto = texto.replace(PREFIJO_GLOBO, "");
  for (const [patron, familia] of FAMILIA_POR_PALABRAS) {
    if (!patron.test(resto)) continue;
    const color = resto.replace(patron, " ").replace(/\bpastel\b/, " ").replace(/\s+/g, " ").trim();
    // "Palo de Rosa" is the official 010 shade name; the middle preposition
    // makes it three words without turning it into a printed/mixed balloon.
    if (!color || /\d/.test(color) || (color.split(" ").length > 2 && color !== "palo de rosa")) return null;
    return familia;
  }
  return null;
}

const GEOMETRICOS = new Set(["arco", "semiarco", "guirnalda", "columna", "pared", "centro_mesa"]);

type Estructura = PlanDecoracion["estructuras"][number];

/**
 * ¿Este producto es la referencia? Mismo color y, si la foto decidió la familia, misma familia. Un transparente es transparente en cualquier línea.
 *
 * Con la familia medida sin confirmar (`familia_fiable` falso) ya no vale cualquier línea: si el analizador dijo
 * el acabado de ESE color («chrome silver» → reflex, «pastel pink» → mate), el producto tiene que ser de una
 * familia de ese acabado. Antes valía cualquiera y el primer producto rosado del turno —un Reflex que el modelo
 * trajo arrastrando el «reflex» de otro color— quedaba como «la referencia» (CASE-002 de images-judge).
 */
function cumple(producto: DisponibilidadProducto, referencia: ReferenciaMedida, acabadoFoto?: string): boolean {
  const color = colorDeReferencia(referencia.nombre);
  if (!producto.coloresVariante.map(plegar).includes(color)) return false;
  if (color === "transparente") return true;
  // Sin acabado explícito, la familia del dominante medido también forma parte
  // de la referencia. No dejar que el orden del catálogo sustituya Fashion 010
  // por Satin 609 solo porque ambas variantes se llaman "rosado".
  if (!acabadoFoto) return familiaDeTitulo(producto.titulo) === referencia.familia;
  // Un acabado que el analizador sí nombró puede cambiar la familia; el tono
  // medido sigue limitando el color dentro de las familias de ese acabado.
  if (!referencia.familia_fiable) return familiaCompatibleConLaFoto(producto, acabadoFoto);
  return familiaDeTitulo(producto.titulo) === referencia.familia;
}

/** Sin acabado dicho por el analizador para ese color, cualquier familia; con él, solo las de ese acabado. */
function familiaCompatibleConLaFoto(producto: DisponibilidadProducto, acabadoFoto: string | undefined): boolean {
  const permitidas = acabadoFoto ? FAMILIAS_DEL_ACABADO[acabadoFoto] : undefined;
  if (!permitidas) return true;
  const familia = familiaDeTitulo(producto.titulo);
  return familia !== null && permitidas.includes(familia);
}

/** El primer producto liso del turno que es la referencia; el orden de la búsqueda decide, para que un reintento elija lo mismo. */
function productoDeReferencia(
  estructura: Pick<Estructura, "tipo" | "mezcla">,
  referencia: ReferenciaMedida,
  disponibilidad: ReadonlyMap<string, DisponibilidadProducto>,
  acabadoFoto?: string,
): string | undefined {
  for (const [productId, producto] of disponibilidad) {
    if (producto.categoria !== "globo_latex" || familiaDeTitulo(producto.titulo) === null) continue;
    if (GEOMETRICOS.has(estructura.tipo) && !producto.mezclas.includes(estructura.mezcla)) continue;
    if (cumple(producto, referencia, acabadoFoto)) return productId;
  }
  return undefined;
}

function elementoDeEstructura(estructura: Pick<Estructura, "referencia_element_id">, blueprint: Pick<ReferenceBlueprintV2, "elements"> | undefined) {
  if (!blueprint || !estructura.referencia_element_id) return undefined;
  return blueprint.elements.find((candidato) => candidato.approved && candidato.element_id === estructura.referencia_element_id);
}

/**
 * Las referencias medidas de una pieza que cuentan: las que llegan a `PARTE_MINIMA_REFERENCIA` y cuyo color
 * nombró el analizador. La segunda condición ya la aplicó `conReferenciasMedidas` al guardarlas, pero el
 * blueprint viaja con el navegador en cada turno: uno analizado antes del 2026-10-05 todavía puede traer la
 * referencia de la pared, y aquí se vuelve a exigir para que la regla no dependa de cuándo se analizó la
 * foto. Es lo que leen la compra (`aplicarReferenciasMedidas`), las búsquedas del servidor y el prompt.
 */
export function referenciasUsables(apariencia: ReferenceBlueprintV2["elements"][number]["appearance"]): ReferenciaMedida[] {
  const nombrados = coloresDelAnalizador(apariencia);
  return (apariencia.referencias_medidas ?? []).filter((referencia) => referencia.parte >= PARTE_MINIMA_REFERENCIA && nombrados.has(colorDeReferencia(referencia.nombre)));
}

function referenciasDeEstructura(estructura: Pick<Estructura, "referencia_element_id">, blueprint: Pick<ReferenceBlueprintV2, "elements"> | undefined): ReferenciaMedida[] {
  const elemento = elementoDeEstructura(estructura, blueprint);
  return elemento ? referenciasUsables(elemento.appearance) : [];
}

/**
 * Lo que el servidor tiene que buscar para que el turno tenga el producto exacto de cada referencia medida
 * de las piezas del plan: la frase con la que se pide el globo («globo latex redondo Satin Rosado»). Se
 * busca en el servidor, no se le pide al modelo: la búsqueda que el modelo hace por color devuelve primero
 * la línea Fashion (orden por título), así que el producto exacto casi nunca llegaba al turno.
 */
export function busquedasDeReferencias(
  plan: Pick<PlanDecoracion, "estructuras">,
  blueprint: Pick<ReferenceBlueprintV2, "elements"> | undefined,
  disponibilidad: ReadonlyMap<string, DisponibilidadProducto>,
  maximo = 6,
): string[] {
  const busquedas: string[] = [];
  for (const estructura of plan.estructuras) {
    const elemento = elementoDeEstructura(estructura, blueprint);
    const acabadosDeLaFoto = elemento ? coloresDelAnalizador(elemento.appearance) : new Map<string, string | undefined>();
    for (const referencia of referenciasDeEstructura(estructura, blueprint)) {
      const acabadoFoto = acabadosDeLaFoto.get(colorDeReferencia(referencia.nombre));
      if (productoDeReferencia(estructura, referencia, disponibilidad, acabadoFoto)) continue;
      const frase = fraseDeBusqueda(referencia, acabadoFoto);
      if (!busquedas.includes(frase)) busquedas.push(frase);
    }
  }
  return busquedas.slice(0, maximo);
}

/**
 * Cómo se pide el globo de una referencia medida. Con la familia confirmada, por su nombre completo («Satin
 * Rosado»). Sin confirmar NO se nombra la familia que la medición adivinó: se pide el color, más el acabado que
 * dijo el analizador si lo dijo. Pedir «Reflex Rosado» por una familia aproximada dejaba ese Reflex como único
 * rosado del turno, y el plan terminaba comprándolo aunque la foto fuera pastel (CASE-002 de images-judge).
 */
function fraseDeBusqueda(referencia: ReferenciaMedida, acabadoFoto: string | undefined): string {
  if (referencia.familia_fiable) return `globo latex redondo ${plegar(referencia.nombre_completo)}`;
  const palabraDeAcabado = acabadoFoto === "reflex" ? "reflex " : acabadoFoto === "satin" ? "satin " : "";
  return `globo latex redondo ${palabraDeAcabado}${plegar(referencia.nombre)}`;
}

function hexDe(color: string, acabado: string | null | undefined): string | undefined {
  return referenciaDelCatalogo(color, acabado ?? null)?.hexGlobo;
}

function distanciaHex(a: string, b: string): number {
  const lab = (hex: string) => labDeRgb(Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16));
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * Al confirmar: cada globo de látex de una pieza con referencias medidas tiene que SER una de ellas.
 *
 * 1. Un material que ya es una referencia medida (mismo color y, si la foto lo decidió, misma familia)
 *    no se toca y esa referencia queda usada.
 * 2. Un material del color de una referencia pero de otra familia (Fashion Lila donde la foto midió Satín
 *    Lila) se cambia por el producto de esa referencia.
 * 3. Un material de un color que la foto no tiene (Reflex Fucsia en una columna de rosa pastel) se cambia
 *    por la referencia sin usar más cercana en color.
 * 4. Si la búsqueda del turno no trae el producto de la referencia, el material se queda como está: dejar
 *    la pieza sin ese color es peor que un tono aproximado. `busquedasDeReferencias` existe para que esto
 *    sea la excepción.
 *
 * El color pasa a ser el de la referencia y el acabado el del producto nuevo. Una variante fijada por el
 * modelo o una línea con `variant_override` nombran ESE producto: no se cambian por debajo.
 *
 * Cuando el cambio es solo de familia (regla 2, el mismo color en la línea que la foto midió) queda como
 * `acabado_referencia`, sin aviso. Cuando cambia el COLOR (regla 3) queda como `color_referencia`, que sí le
 * llega al cliente (`avisosClienteAjustes`): el modelo le describió un fucsia y la cotización compra un
 * rosado, y hasta el 2026-10-05 nadie se lo decía.
 */
export function aplicarReferenciasMedidas(
  plan: PlanDecoracion,
  blueprint: Pick<ReferenceBlueprintV2, "elements"> | undefined,
  disponibilidad: ReadonlyMap<string, DisponibilidadProducto>,
): { plan: PlanDecoracion; ajustes: AjusteCobertura[] } {
  const ajustes: AjusteCobertura[] = [];
  const estructuras = plan.estructuras.map((estructura) => {
    const referencias = referenciasDeEstructura(estructura, blueprint);
    if (referencias.length === 0 || estructura.variant_overrides?.length) return estructura;
    const elemento = elementoDeEstructura(estructura, blueprint);
    const nombradosPorElAnalizador = elemento ? coloresDelAnalizador(elemento.appearance) : new Map<string, string | undefined>();
    const acabadoDeLaFoto = (referencia: ReferenciaMedida) => nombradosPorElAnalizador.get(colorDeReferencia(referencia.nombre));
    const usadas = new Set<string>();
    const decision = estructura.materiales.map((material) => {
      const producto = disponibilidad.get(material.product_id);
      if (!producto || producto.categoria !== "globo_latex") return { material, referencia: undefined as ReferenciaMedida | undefined, ok: true };
      const exacta = referencias.find((referencia) => !usadas.has(referencia.codigo) && cumple(producto, referencia, acabadoDeLaFoto(referencia)));
      if (exacta) {
        usadas.add(exacta.codigo);
        return { material, referencia: exacta, ok: true };
      }
      return { material, referencia: undefined, ok: false };
    });
    // Dos pasadas: primero los materiales cuyo color la foto sí tiene en otra familia (regla 2), después
    // los de un color que no tiene (regla 3). En una sola pasada, un fucsia sin pareja podía quedarse con
    // la referencia lila antes de que el material lila la reclamara.
    const elegida = new Map<number, ReferenciaMedida>();
    for (const [indice, { material, ok }] of decision.entries()) {
      if (ok || material.variant_id) continue;
      const mismoColor = referencias.find((referencia) => !usadas.has(referencia.codigo) && colorDeReferencia(referencia.nombre) === plegar(material.color ?? ""));
      if (mismoColor && productoDeReferencia(estructura, mismoColor, disponibilidad, acabadoDeLaFoto(mismoColor))) {
        usadas.add(mismoColor.codigo);
        elegida.set(indice, mismoColor);
      }
    }
    for (const [indice, { material, ok }] of decision.entries()) {
      if (ok || material.variant_id || elegida.has(indice)) continue;
      // Regla 3 solo para un color que nadie vio: si el analizador lo nombró (un vino oscuro que los píxeles
      // leen como «Metal Negro»), la medición no puede quitarlo.
      if (nombradosPorElAnalizador.has(plegar(material.color ?? ""))) continue;
      // Ni un transparente: los píxeles no ven un globo transparente (`coloresDominantesReferencia`), así que
      // que la medición no traiga una referencia transparente no es evidencia de que la foto no lo tenga. Sin
      // esto, las burbujas transparentes de una columna rosa y plata se cambiaban por otro rosa (2026-10-04).
      if (plegar(material.color ?? "") === "transparente") continue;
      const hexActual = hexDe(plegar(material.color ?? ""), material.acabado);
      const libres = referencias.filter((referencia) => !usadas.has(referencia.codigo) && productoDeReferencia(estructura, referencia, disponibilidad, acabadoDeLaFoto(referencia)));
      const masCercana = hexActual
        ? libres.map((referencia) => ({ referencia, distancia: distanciaHex(hexActual, referenciaPorCodigo(referencia.codigo)?.hexGlobo ?? hexActual) })).sort((a, b) => a.distancia - b.distancia)[0]?.referencia
        : libres[0];
      if (!masCercana) continue;
      usadas.add(masCercana.codigo);
      elegida.set(indice, masCercana);
    }
    const materiales = decision.map(({ material }, indice) => {
      const masCercana = elegida.get(indice);
      if (!masCercana) return material;
      const reemplazo = productoDeReferencia(estructura, masCercana, disponibilidad, acabadoDeLaFoto(masCercana));
      if (!reemplazo || reemplazo === material.product_id) return material;
      const nuevo = disponibilidad.get(reemplazo)!;
      const color = colorDeReferencia(masCercana.nombre);
      ajustes.push(plegar(material.color ?? "") === color
        ? { tipo: "acabado_referencia", estructura_id: estructura.estructura_id, product_id: material.product_id, despues: reemplazo, color, acabado: masCercana.nombre_completo }
        : { tipo: "color_referencia", estructura_id: estructura.estructura_id, product_id: material.product_id, despues: reemplazo, antes: material.color ?? null, color, referencia: masCercana.nombre_completo });
      // El acabado del material es el del producto nuevo; si el catálogo no se lo leyó, no lleva ninguno
      // (el del producto anterior sería falso).
      const cambiado: typeof material = { ...material, product_id: reemplazo, color };
      if (nuevo.acabados[0]) cambiado.acabado = nuevo.acabados[0];
      else delete cambiado.acabado;
      return cambiado;
    });
    return { ...estructura, materiales };
  });
  return { plan: { ...plan, estructuras }, ajustes };
}
