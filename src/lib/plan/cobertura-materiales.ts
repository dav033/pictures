import { mezclasCompatiblesConDiametros, type Mezcla } from "@/lib/plan/mezclas";
import { esReferenciaPastel, referenciaDelTitulo } from "@/lib/plan/referencia-sempertex";
import { TIPOS_ESTRUCTURA_GEOMETRICOS } from "./composicion";
import { esCuentaGeometrica, type PlanDecoracion } from "./tipos";

/**
 * Size coverage of a plan's materials before it reaches the resolver.
 *
 * Regression (E2E 2026-09-15, "Semiarcos rosa y plata" + "Quiero algo así para
 * un cumpleaños", rid 6e9e49b5, adc094d4, ed4f9eb8): the active LoRA catalog
 * only has some sizes of each balloon (Fashion Transparente R-9/18/24, Fashion
 * Gris R-5/12, Pastel Mate Rosado R-5/9). The model chose `organica_fina`
 * (R-5…R-24) with those products, the resolver answered SIN_COBERTURA, the
 * model retried another mix or product, COLORES_REFERENCIA_OMITIDOS asked it to
 * add the clear balloon back, and the turn ran out of time.
 *
 * Rules, applied to the plan the model confirmed (only with this turn's search
 * data, never inventing availability):
 * 1. A material whose product's round variants share exactly one real color
 *    takes that color ("Fashion Gris" is grey even when the model wrote
 *    "plateado"; "Fashion Violeta" is violeta, not the family color morado of
 *    its tags). A finish
 *    the product does not have is dropped: the product fixes its finish, and
 *    "satin" on Fashion Rosado left every size uncovered (rid 0acd0eb6).
 *    A material WITHOUT color takes the product's one real color (`color_catalogo`).
 * 2a. A material whose product builds none of the structure's close mixes is
 *    bought as another product of the SAME real color that does, when this
 *    turn's search has one (`producto_mismo_color`); rule 3 tries the same swap
 *    before removing a material.
 * 2. A geometric structure without mandatory customer sizes keeps its mix when
 *    every material covers it. Otherwise the closest mix of the same family
 *    (`MEZCLAS_CERCANAS`) that every material covers replaces it.
 * 3. If no close mix fits every material, the main material (first
 *    `principal`, else the largest share) decides the mix, and the materials
 *    that cannot cover it are removed with a customer notice; the remaining
 *    shares are rescaled to add up to 1 and, when the `principal` left, the
 *    role goes to the largest rescaled share (ties by declared order).
 * 4. A structure whose main material covers no close mix, or with a material
 *    this turn's search did not return, is left as it is: the resolver reports
 *    it.
 *
 * `quitarMaterialesDeColorInventado` applies the same removal (and the same
 * notice) to a material whose color the reference photo does not have, which is
 * a decision of the reference flow rather than of size coverage: the colors come
 * from `colores-referencia.ts` and this module only takes them out of the plan.
 * `aplicarAcabadoReferencia` is the same split for the FINISH the photo shows:
 * the demand comes from `colores-referencia.ts` and here it is either bought or
 * reported through the notice rule 1 already had.
 *
 * Pure: no provider, HTTP, database or environment.
 */

export type DisponibilidadProducto = {
  titulo: string;
  /** Catalog category ("globo_latex", "globo_foil"…): un globo de látex solo se cambia por otro globo de látex. */
  categoria: string | null;
  /** Real colors of the product (`coloresRealesProducto`), family colors from its tags included. */
  colores: readonly string[];
  /** Real colors of its available round variants (`coloresRealesVariante`); the product's when it has none. */
  coloresVariante: readonly string[];
  /** Mixes the product's available round sizes can build (`mezclasCompatiblesConDiametros`). */
  mezclas: readonly Mezcla[];
  /** Catalog finishes of the product ("fashion", "reflex"…). */
  acabados: readonly string[];
};

export type AjusteCobertura =
  | { tipo: "color_material"; estructura_id: string; product_id: string; antes: string; despues: string }
  | { tipo: "acabado_material"; estructura_id: string; product_id: string; antes: string; color: string | null }
  /** El producto cambió para comprar el acabado de la foto en el MISMO color (`aplicarAcabadoReferencia`). */
  | { tipo: "acabado_referencia"; estructura_id: string; product_id: string; despues: string; color: string | null; acabado: string }
  /**
   * El producto cambió por el globo Sempertex que la foto midió y con él cambió el COLOR (regla 3 de
   * `aplicarReferenciasMedidas`): `antes` es el color que eligió el modelo, `color` el de la referencia y
   * `referencia` su nombre comercial («Satín Rosado»). A diferencia de `acabado_referencia`, se avisa.
   */
  | { tipo: "color_referencia"; estructura_id: string; product_id: string; despues: string; antes: string | null; color: string; referencia: string }
  | { tipo: "mezcla"; estructura_id: string; antes: Mezcla; despues: Mezcla }
  | { tipo: "material_quitado"; estructura_id: string; product_id: string; color: string | null; aviso_cliente: string }
  /**
   * El modelo dejó el material sin `color` y el producto tiene un solo color real: el material lo toma del catálogo
   * (regla 1). Sin aviso: no cambia nada de lo que el cliente ve, solo deja de faltar el dato. Antes el material
   * llegaba sin color a Python y al texto de FLUX, que decía «catalog color» (banco de fotos 09 y 10, 2026-10-06).
   */
  | { tipo: "color_catalogo"; estructura_id: string; product_id: string; color: string }
  /**
   * Un material que no podía seguir la mezcla de su pieza (sus tamaños no alcanzan) se cambió por otro producto del
   * MISMO color real que sí la cubre (regla 3, antes de quitarlo). Sin aviso: el color y la pieza son los de la foto.
   * Antes el Metal Vinotinto (solo R-9) se quitaba del arco y el vino de la foto desaparecía mientras el catálogo
   * tenía el Fashion Merlot en todos los tamaños (banco de fotos 07, 2026-10-06).
   */
  | { tipo: "producto_mismo_color"; estructura_id: string; product_id: string; despues: string; color: string };

/**
 * Los productos que nombra un ajuste: el que tenía el material y, si el ajuste lo cambió por otro, también el
 * nuevo. Sirve para saber qué avisos hablan de un material que ya no está en el plan cotizado
 * (`avisosClienteAjustes`, `materialesFuera`): un cambio de producto deja fuera el viejo, y el nuevo puede
 * salir después por la convergencia.
 */
export function productosDelAjuste(ajuste: AjusteCobertura): string[] {
  if (ajuste.tipo === "mezcla") return [];
  if (ajuste.tipo === "acabado_referencia" || ajuste.tipo === "color_referencia" || ajuste.tipo === "producto_mismo_color") return [ajuste.product_id, ajuste.despues];
  return [ajuste.product_id];
}

/** Mixes that keep the look of the chosen one, in order of preference. */
export const MEZCLAS_CERCANAS: Readonly<Record<Mezcla, readonly Mezcla[]>> = {
  organica_fina: ["organica_fina", "organica_gruesa"],
  organica_gruesa: ["organica_gruesa", "organica_fina"],
  solo_grandes: ["solo_grandes", "organica_gruesa"],
  clasica: ["clasica"],
};

const GEOMETRICOS: ReadonlySet<string> = new Set(TIPOS_ESTRUCTURA_GEOMETRICOS);
const SIN_COLOR_UNICO = new Set(["multicolor"]);

function plegar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

type Material = PlanDecoracion["estructuras"][number]["materiales"][number];

function indicePrincipal(materiales: readonly Material[]): number {
  const principal = materiales.findIndex((material) => material.rol_material === "principal");
  if (principal >= 0) return principal;
  return materiales.reduce((mejor, material, indice) => (material.participacion > materiales[mejor]!.participacion ? indice : mejor), 0);
}

/** Close mixes the main material of a structure can build; empty when unknown. */
export function mezclasAdmisiblesEstructura(
  estructura: Pick<PlanDecoracion["estructuras"][number], "mezcla" | "materiales">,
  disponibilidad: ReadonlyMap<string, DisponibilidadProducto>,
): Mezcla[] {
  const principal = disponibilidad.get(estructura.materiales[indicePrincipal(estructura.materiales)]?.product_id ?? "");
  if (!principal) return [];
  return MEZCLAS_CERCANAS[estructura.mezcla].filter((mezcla) => principal.mezclas.includes(mezcla));
}

function unirColores(colores: readonly string[]): string {
  return colores.length <= 1 ? (colores[0] ?? "") : `${colores.slice(0, -1).join(", ")} y ${colores.at(-1)}`;
}

/**
 * Parte los materiales de una pieza en los que se quedan y los que salen, con
 * las participaciones reescaladas para que sumen exactamente 1 (lo exige el
 * esquema del plan) y el rol `principal` en el de mayor participación cuando el
 * que lo era se fue (empates: el primero declarado).
 *
 * `null` cuando no queda ninguno o no sale ninguno: una pieza sin materiales no
 * es una pieza, y quitarlos todos la borraría en silencio.
 */
function partirMateriales(
  materiales: readonly Material[],
  sale: (material: Material, indice: number) => boolean,
): { quedan: Material[]; salen: Material[] } | null {
  const salen = materiales.filter((material, indice) => sale(material, indice));
  const conservados = materiales.filter((material, indice) => !sale(material, indice));
  if (salen.length === 0 || conservados.length === 0) return null;
  const total = conservados.reduce((suma, material) => suma + material.participacion, 0);
  if (total <= 0) return null;
  const quedan = conservados.map((material) => ({ ...material, participacion: material.participacion / total }));
  const desfase = 1 - quedan.reduce((suma, material) => suma + material.participacion, 0);
  quedan[0] = { ...quedan[0]!, participacion: quedan[0]!.participacion + desfase };
  if (!quedan.some((material) => material.rol_material === "principal")) {
    const mayor = quedan.reduce((mejor, material, indice) => (material.participacion > quedan[mejor]!.participacion ? indice : mejor), 0);
    quedan[mayor] = { ...quedan[mayor]!, rol_material: "principal" };
  }
  return { quedan, salen };
}

/**
 * Saca de cada estructura los materiales cuyo color la foto no tiene
 * (`materialesDeColorInventado`, colores-referencia.ts) antes de validar y
 * resolver el plan.
 *
 * Es acotar, no auditar: el color inventado no llega a cotizarse ni al prompt de
 * la imagen, y el turno no gasta un rechazo ni una llamada más al modelo. Una
 * pieza cuyos materiales serían TODOS de colores ajenos a la foto se deja como
 * está: podarla la borraría, y ese caso ya lo atiende
 * `COLORES_REFERENCIA_OMITIDOS`, que le pide al modelo armarla con los colores
 * de la foto (registro-herramientas.ts).
 *
 * El aviso viaja por el mismo canal que un material sin cobertura de tamaños
 * (`material_quitado`): el cliente ve en la tarjeta qué no lleva la pieza y por
 * qué, y el modelo no promete en el resumen un color que la cotización no
 * compra.
 */
export function quitarMaterialesDeColorInventado(
  plan: PlanDecoracion,
  inventados: ReadonlyArray<{ estructura_id: string; product_id: string }>,
): { plan: PlanDecoracion; ajustes: AjusteCobertura[] } {
  if (inventados.length === 0) return { plan, ajustes: [] };
  const ajustes: AjusteCobertura[] = [];
  const estructuras = plan.estructuras.map((estructura) => {
    const fuera = new Set(inventados.filter((item) => item.estructura_id === estructura.estructura_id).map((item) => item.product_id));
    if (fuera.size === 0) return estructura;
    const partido = partirMateriales(estructura.materiales, (material) => fuera.has(material.product_id));
    if (!partido) return estructura;
    const coloresQuedan = [...new Set(partido.quedan.map((material) => material.color).filter((color): color is string => Boolean(color)))];
    for (const material of partido.salen) {
      const globos = material.color ? `globos ${material.color}` : "unos globos";
      ajustes.push({
        tipo: "material_quitado",
        estructura_id: estructura.estructura_id,
        product_id: material.product_id,
        color: material.color ?? null,
        aviso_cliente: `En ${estructura.nombre.toLowerCase()} no incluí ${globos} porque tu foto no los tiene${coloresQuedan.length ? `: la armé con ${unirColores(coloresQuedan)}` : ""}.`,
      });
    }
    return { ...estructura, materiales: partido.quedan };
  });
  return { plan: { ...plan, estructuras }, ajustes };
}

/**
 * Acabados del catálogo que cumplen un acabado observado en la foto. No es una
 * tabla de gustos: son los nombres con que el catálogo vende la misma familia
 * del vocabulario LoRA. `Fashion` es su mate y `Satin` su perlado, así que un
 * producto cuyo texto solo dice "fashion" sí cumple "mate", y uno que dice
 * "perlado" sí cumple "satin". `Metalizado` (mylar/foil) NO cumple "reflex":
 * es otro material, no el cromado del látex.
 */
/**
 * El acabado observado solo se le exige al globo de látex: Fashion, Reflex y
 * Satin son sus líneas. Un número de mylar o una serpentina no son mate ni
 * cromados en ese sentido, exigirles un acabado solo cambiaría un producto por
 * otro de la misma categoría (un 3 por un 5) o dejaría un aviso sin sentido.
 * Mismo criterio que `CATEGORIAS_GLOBO_COLOR` en colores-referencia.ts.
 */
const CATEGORIA_CON_ACABADO = "globo_latex";

const ACABADOS_QUE_CUMPLEN: Readonly<Record<string, readonly string[]>> = {
  reflex: ["reflex"],
  satin: ["satin", "perlado"],
  mate: ["mate", "fashion"],
};

/**
 * El acabado con que ESTE producto cumple el observado, o `undefined` si no lo cumple.
 *
 * «pastel» (`acabadosObservadosDeMateriales`) no es un acabado del catálogo sino un tono: lo cumple un globo mate cuyo
 * color real, el de la referencia Sempertex que nombra su título, es claro y poco saturado (`esReferenciaPastel`). Así un Fashion
 * Rosado o un Pastel Mate Azul sirven a una foto pastel y el Fashion Azul 040 (un cian intenso) o el Azul Naval, no.
 */
function acabadoQueCumple(observado: string, producto: Pick<DisponibilidadProducto, "acabados" | "titulo">): string | undefined {
  if (plegar(observado) === "pastel") {
    const mate = acabadoQueCumple("mate", producto);
    if (!mate) return undefined;
    const referencia = referenciaDelTitulo(producto.titulo, null);
    return referencia && !esReferenciaPastel(referencia) ? undefined : mate;
  }
  const admitidos = ACABADOS_QUE_CUMPLEN[plegar(observado)] ?? [plegar(observado)];
  return producto.acabados.map(plegar).find((acabado) => admitidos.includes(acabado));
}

/**
 * Respeta el acabado que la foto muestra para el color de cada material
 * (`acabadosObservadosDeMateriales`, colores-referencia.ts), o lo avisa.
 *
 * Es la mitad que le faltaba a la auditoría de color: el color ya lo vigilan
 * `coloresReferenciaOmitidos` (lo que la foto tiene y el plan no compra) y
 * `materialesDeColorInventado` (lo que el plan compra y la foto no tiene), pero
 * el ACABADO no lo vigilaba nadie. Con la pared "Mr & Mrs" el blush perlado se
 * compró cromado y nada lo detectó (2026-09-29).
 *
 * Reglas, sobre el plan que el modelo confirmó y solo con los datos de la
 * búsqueda de este turno:
 * 1. Si el producto del material ya cumple el acabado observado, no se toca.
 * 2. Si no lo cumple y la búsqueda de este turno tiene el MISMO color en ese
 *    acabado (misma categoría, y para una estructura geométrica con los tamaños
 *    de su mezcla), se compra ese producto: el acabado de la foto se respeta sin
 *    tocar el color.
 * 3. Si el catálogo no ofrece ese color en ese acabado, se deja el que hay y se
 *    avisa por el canal que ya existe (`acabado_material` →
 *    `avisosClienteAjustes`). Nunca se quita el material: dejar la pieza sin ese
 *    color por un acabado es peor que el acabado equivocado.
 * 4. Un producto sin acabados leídos no se juzga: no saber qué acabado tiene no
 *    es saber que no lo tiene, y avisar de un catálogo que no vimos sería falso.
 * 5. Solo se juzga el globo de látex (`CATEGORIA_CON_ACABADO`).
 *
 * El color NO lo decide esta regla: el material conserva el suyo, ya resuelto
 * por la regla 1 de cobertura y por la maquinaria de color de la foto.
 *
 * Pura: sin proveedor, HTTP, base de datos ni entorno.
 */
export function aplicarAcabadoReferencia(
  plan: PlanDecoracion,
  esperados: ReadonlyArray<{ estructura_id: string; product_id: string; acabado: string }>,
  disponibilidad: ReadonlyMap<string, DisponibilidadProducto>,
): { plan: PlanDecoracion; ajustes: AjusteCobertura[] } {
  if (esperados.length === 0) return { plan, ajustes: [] };
  const ajustes: AjusteCobertura[] = [];
  const estructuras = plan.estructuras.map((estructura) => {
    const acabadoEsperado = new Map(esperados.filter((item) => item.estructura_id === estructura.estructura_id).map((item) => [item.product_id, item.acabado]));
    if (acabadoEsperado.size === 0) return estructura;
    const materiales = estructura.materiales.map((material) => {
      const observado = acabadoEsperado.get(material.product_id);
      const producto = observado ? disponibilidad.get(material.product_id) : undefined;
      // Regla 4: sin acabados leídos no hay nada que comparar ni que avisar.
      if (!observado || !producto || producto.acabados.length === 0) return material;
      if (producto.categoria !== CATEGORIA_CON_ACABADO) return material;
      if (acabadoQueCumple(observado, producto)) return material;
      const color = plegar(material.color ?? "");
      // Una variante fijada por el modelo, o una línea que un `variant_override`
      // reemplaza, nombran ESE producto: cambiarlo debajo dejaría el plan
      // contradiciéndose. En ese caso solo se avisa.
      const puedeCambiar = !material.variant_id && !estructura.variant_overrides?.length;
      const reemplazo = color && puedeCambiar ? buscarProductoConAcabado(estructura, producto, color, observado, disponibilidad) : undefined;
      if (!reemplazo) {
        ajustes.push({ tipo: "acabado_material", estructura_id: estructura.estructura_id, product_id: material.product_id, antes: observado, color: material.color ?? null });
        return material;
      }
      ajustes.push({ tipo: "acabado_referencia", estructura_id: estructura.estructura_id, product_id: material.product_id, despues: reemplazo.product_id, color: material.color ?? null, acabado: observado });
      return { ...material, product_id: reemplazo.product_id, acabado: reemplazo.acabado };
    });
    return { ...estructura, materiales };
  });
  return { plan: { ...plan, estructuras }, ajustes };
}

/** Primer candidato del turno con el mismo color en el acabado observado; el orden de la búsqueda decide, para que el reintento del mismo turno elija lo mismo. */
function buscarProductoConAcabado(
  estructura: Pick<PlanDecoracion["estructuras"][number], "tipo" | "mezcla">,
  actual: DisponibilidadProducto,
  color: string,
  observado: string,
  disponibilidad: ReadonlyMap<string, DisponibilidadProducto>,
): { product_id: string; acabado: string } | undefined {
  for (const [productId, candidato] of disponibilidad) {
    if (candidato === actual || candidato.categoria !== actual.categoria) continue;
    if (!candidato.coloresVariante.map(plegar).includes(color)) continue;
    // Cambiar el acabado no puede dejar la pieza sin los tamaños de su mezcla.
    if (GEOMETRICOS.has(estructura.tipo) && !candidato.mezclas.includes(estructura.mezcla)) continue;
    const acabado = acabadoQueCumple(observado, candidato);
    if (acabado) return { product_id: productId, acabado };
  }
  return undefined;
}

/** La palabra con que el catálogo titula cada acabado («Pastel Mate Rosado», «Reflex Plata», «Satin Rosado»). */
const PALABRA_DE_ACABADO: Readonly<Record<string, string>> = { reflex: "reflex", satin: "satin", mate: "mate", pastel: "pastel mate" };

/**
 * Lo que el servidor tiene que buscar para que `aplicarAcabadoReferencia` pueda cumplir su regla 2: la frase
 * del color en el acabado de la foto («globo latex redondo mate rosado») para cada material que hoy cae en la
 * regla 3 (el turno no trae ese color en ese acabado). Mismas condiciones que la regla 2, así que una búsqueda
 * solo se pide cuando su resultado se puede usar.
 *
 * Sin esto, el acabado de la foto dependía de que la búsqueda del MODELO lo hubiera traído: el modelo junta
 * los colores en una sola frase («plateado reflex rosado gris»), el «reflex» del plateado arrastra al rosado y
 * el primer rosado del turno es un Reflex (CASE-002 de images-judge, 3 de 3 planes). Es el mismo remedio que
 * `busquedasDeReferencias` (referencias-medidas.ts) para los globos medidos.
 *
 * Pura: sin proveedor, HTTP, base de datos ni entorno.
 */
export function busquedasDeAcabado(
  plan: Pick<PlanDecoracion, "estructuras">,
  esperados: ReadonlyArray<{ estructura_id: string; product_id: string; acabado: string }>,
  disponibilidad: ReadonlyMap<string, DisponibilidadProducto>,
  maximo = 4,
): string[] {
  const busquedas: string[] = [];
  for (const estructura of plan.estructuras) {
    if (estructura.variant_overrides?.length) continue;
    const acabadoEsperado = new Map(esperados.filter((item) => item.estructura_id === estructura.estructura_id).map((item) => [item.product_id, item.acabado]));
    for (const material of estructura.materiales) {
      const observado = acabadoEsperado.get(material.product_id);
      const producto = observado ? disponibilidad.get(material.product_id) : undefined;
      const color = plegar(material.color ?? "");
      if (!observado || !producto || !color || material.variant_id) continue;
      if (producto.categoria !== CATEGORIA_CON_ACABADO || producto.acabados.length === 0) continue;
      if (acabadoQueCumple(observado, producto)) continue;
      if (buscarProductoConAcabado(estructura, producto, color, observado, disponibilidad)) continue;
      const palabra = PALABRA_DE_ACABADO[plegar(observado)];
      if (!palabra) continue;
      const frase = `globo latex redondo ${palabra} ${color}`;
      if (!busquedas.includes(frase)) busquedas.push(frase);
    }
  }
  return busquedas.slice(0, maximo);
}

/**
 * Notices for the customer about the adjustments the server makes before
 * resolving. Without them the model describes a finish or a color the quote
 * does not have ("dorados cromados como en tu foto" over a plain metal line).
 *
 * A color rewrite is only reported when nobody else reports it: the photo-color
 * substitutions already cover the reference flow and a color the customer made
 * mandatory is refused earlier by `validarRestriccionesPlan`, so repeating it
 * here would duplicate the notice.
 *
 * A material the plan no longer buys gets no finish or color notice either:
 * rule 3 rewrites the finish of a material it then removes, and convergence
 * (`quitarMaterialesSinCobertura`) removes more later, so the quote promised
 * "los dorados van en su acabado normal" without a single gold balloon in it.
 * The `material_quitado` notice already tells that story.
 *
 * A measured Sempertex reference that replaced a material of ANOTHER color
 * (`color_referencia`) is reported like the other color rewrites: the model
 * described one color and the quote buys another (2026-10-05). Its material is
 * the replacement (followed through a later finish swap), so that is the one
 * checked against `materialesFuera`; the replaced product is out by design.
 *
 * Pure: customer wording only, no ids, codes or internal field names.
 */
export function avisosClienteAjustes(
  ajustes: readonly AjusteCobertura[],
  contexto: {
    /** estructura_id → nombre para el cliente. */
    nombres: ReadonlyMap<string, string>;
    /** Colores que otra vía ya le reporta al cliente (sustituciones de la foto). */
    coloresReportados?: ReadonlyArray<{ estructura_id: string; color: string }>;
    /** Colores que el cliente exigió (los valida `validarRestriccionesPlan`). */
    coloresDelCliente?: readonly string[];
    /** Materiales que ya no están en el plan cotizado (los quitó la convergencia). */
    materialesFuera?: ReadonlyArray<{ estructura_id: string; product_id: string }>;
  },
): string[] {
  const nombreDe = (estructuraId: string) => (contexto.nombres.get(estructuraId) ?? "la decoración").toLowerCase();
  const reportados = new Set((contexto.coloresReportados ?? []).map((item) => `${item.estructura_id}|${plegar(item.color)}`));
  const delCliente = new Set((contexto.coloresDelCliente ?? []).map(plegar));
  const fuera = new Set([
    ...ajustes.flatMap((ajuste) => (ajuste.tipo === "material_quitado" ? [`${ajuste.estructura_id}|${ajuste.product_id}`] : [])),
    ...(contexto.materialesFuera ?? []).map((item) => `${item.estructura_id}|${item.product_id}`),
  ]);
  // El producto que quedó en el plan después de un cambio de producto: el `despues` del ajuste o, si
  // `aplicarAcabadoReferencia` lo volvió a cambiar por el acabado de la foto, el de ese segundo cambio.
  const siguiente = new Map(ajustes.flatMap((ajuste) => (
    ajuste.tipo === "acabado_referencia" || ajuste.tipo === "color_referencia" || ajuste.tipo === "producto_mismo_color" ? [[`${ajuste.estructura_id}|${ajuste.product_id}`, ajuste.despues] as const] : []
  )));
  const productoQueQueda = (estructuraId: string, productId: string): string => {
    const vistos = new Set<string>();
    let actual = productId;
    while (!vistos.has(actual)) {
      vistos.add(actual);
      const proximo = siguiente.get(`${estructuraId}|${actual}`);
      if (!proximo) break;
      actual = proximo;
    }
    return actual;
  };
  return [...new Set(ajustes.flatMap((ajuste) => {
    // `acabado_referencia` no lleva aviso: el acabado de la foto SÍ se respetó,
    // y contarle al cliente que se cambió de producto para lograrlo sería
    // hablarle de catálogo en vez de de su decoración.
    if (ajuste.tipo === "mezcla" || ajuste.tipo === "material_quitado" || ajuste.tipo === "acabado_referencia" || ajuste.tipo === "color_catalogo" || ajuste.tipo === "producto_mismo_color") return [];
    if (ajuste.tipo === "color_referencia") {
      // El producto viejo salió del plan a propósito: lo que importa es que el nuevo siga en él.
      if (fuera.has(`${ajuste.estructura_id}|${productoQueQueda(ajuste.estructura_id, ajuste.product_id)}`)) return [];
      const globos = ajuste.antes ? `los globos de color ${ajuste.antes}` : "unos globos";
      return [`En ${nombreDe(ajuste.estructura_id)} ${globos} van en ${ajuste.color} (${ajuste.referencia}), que es el color que tiene tu foto.`];
    }
    if (fuera.has(`${ajuste.estructura_id}|${ajuste.product_id}`)) return [];
    const nombre = nombreDe(ajuste.estructura_id);
    if (ajuste.tipo === "acabado_material") {
      const globos = ajuste.color ? `los globos de color ${ajuste.color}` : "los globos";
      return [`En ${nombre} ${globos} no vienen en acabado ${ajuste.antes} en el catálogo: van en su acabado normal.`];
    }
    const color = plegar(ajuste.antes);
    if (reportados.has(`${ajuste.estructura_id}|${color}`) || delCliente.has(color)) return [];
    return [`En ${nombre} los globos de color ${ajuste.antes} van en ${ajuste.despues}, que es el color real de ese producto.`];
  }))];
}

/**
 * El material comprado como otro producto de su MISMO color real que sí arma alguna de `mezclas` (en ese orden de
 * preferencia), o el material tal cual si la búsqueda del turno no trae ninguno. Mismas guardas que el cambio de
 * acabado (`buscarProductoConAcabado`): misma categoría, nada de variantes fijadas por el modelo ni de
 * `variant_overrides`, y un producto que la pieza ya usa no se repite. Se prefiere el que tiene el acabado que el
 * material declaraba; si no lo tiene, el acabado se suelta (lo fija el producto, como en la regla 1).
 */
function cambiarPorMismoColor(
  estructura: PlanDecoracion["estructuras"][number],
  material: Material,
  actual: DisponibilidadProducto,
  mezclas: readonly Mezcla[],
  disponibilidad: ReadonlyMap<string, DisponibilidadProducto>,
  ajustes: AjusteCobertura[],
): Material {
  const color = plegar(material.color ?? "");
  if (!color || material.variant_id || estructura.variant_overrides?.length) return material;
  const enUso = new Set(estructura.materiales.map((item) => item.product_id));
  const acabado = material.acabado ? plegar(material.acabado) : undefined;
  for (const mezcla of mezclas) {
    let elegido: { productId: string; producto: DisponibilidadProducto } | undefined;
    for (const [productId, candidato] of disponibilidad) {
      if (enUso.has(productId) || candidato === actual || candidato.categoria !== actual.categoria) continue;
      if (!candidato.coloresVariante.map(plegar).includes(color) || !candidato.mezclas.includes(mezcla)) continue;
      if (acabado && candidato.acabados.map(plegar).includes(acabado)) {
        elegido = { productId, producto: candidato };
        break;
      }
      elegido ??= { productId, producto: candidato };
    }
    if (!elegido) continue;
    ajustes.push({ tipo: "producto_mismo_color", estructura_id: estructura.estructura_id, product_id: material.product_id, despues: elegido.productId, color });
    const cambiado: Material = { ...material, product_id: elegido.productId };
    if (acabado && !elegido.producto.acabados.map(plegar).includes(acabado)) delete cambiado.acabado;
    return cambiado;
  }
  return material;
}

/**
 * Los colores cuyo producto no arma ninguna mezcla cercana de su pieza y para los que la búsqueda del turno no trae
 * otro producto del mismo color que sí la arme: lo que la regla 2a necesita que el servidor busque, con las mezclas
 * que sirven. Sin esto el cambio dependía de que la búsqueda del MODELO hubiera traído el producto bueno: «Borgoña
 * vino» trajo el Metal Vinotinto (solo R-9) y no el Fashion Merlot, y el vino de la foto 07 se quitó del arco.
 *
 * Pura: quien llama consulta el catálogo por color (`buscarGlobosPorColor`) y busca los títulos que sirven.
 */
export function coloresSinTamanos(
  plan: Pick<PlanDecoracion, "estructuras" | "restricciones">,
  disponibilidad: ReadonlyMap<string, DisponibilidadProducto>,
): Array<{ color: string; mezclas: readonly Mezcla[] }> {
  if ((plan.restricciones?.tamanos ?? []).some((item) => item.polaridad === "obligatorio")) return [];
  const resultado = new Map<string, Set<Mezcla>>();
  for (const estructura of plan.estructuras) {
    if (!esCuentaGeometrica(estructura) || estructura.variant_overrides?.length) continue;
    const cercanas = MEZCLAS_CERCANAS[estructura.mezcla];
    for (const material of estructura.materiales) {
      const producto = disponibilidad.get(material.product_id);
      if (!producto || material.variant_id) continue;
      // Sin color del modelo, el del producto (el mismo que le pondrá la regla 1): el Metal Vinotinto llegó sin color
      // en la guiada de la foto 07 y el servidor no buscaba el Fashion Merlot (banco de fotos, segunda corrida).
      const unicos = producto.coloresVariante.map(plegar).filter((tono) => !SIN_COLOR_UNICO.has(tono));
      const color = plegar(material.color ?? (unicos.length === 1 ? unicos[0]! : ""));
      if (!color) continue;
      if (cercanas.some((mezcla) => producto.mezclas.includes(mezcla))) continue;
      const hayOtro = [...disponibilidad.values()].some((candidato) => candidato !== producto
        && candidato.categoria === producto.categoria
        && candidato.coloresVariante.map(plegar).includes(color)
        && cercanas.some((mezcla) => candidato.mezclas.includes(mezcla)));
      if (hayOtro) continue;
      const mezclas = resultado.get(color) ?? new Set<Mezcla>();
      for (const mezcla of cercanas) mezclas.add(mezcla);
      resultado.set(color, mezclas);
    }
  }
  return [...resultado].map(([color, mezclas]) => ({ color, mezclas: [...mezclas] }));
}

/**
 * Las frases con que el servidor trae al turno los productos del catálogo (consultados por color) que sí arman la
 * pieza: el título tal cual se pide en la tienda («globo latex redondo fashion merlot»), como `busquedasDeReferencias`.
 * Un producto que el turno ya tiene no se busca; como mucho `porColor` productos por color y `maximo` frases.
 */
export function busquedasDeMismoColor(
  faltan: ReadonlyArray<{ color: string; mezclas: readonly Mezcla[] }>,
  catalogoPorColor: ReadonlyMap<string, ReadonlyArray<{ product_id: string; titulo: string; diametros?: readonly number[] }>>,
  disponibilidad: ReadonlyMap<string, DisponibilidadProducto>,
  { porColor = 2, maximo = 4 }: { porColor?: number; maximo?: number } = {},
): string[] {
  const busquedas: string[] = [];
  for (const { color, mezclas } of faltan) {
    const sirven = (catalogoPorColor.get(color) ?? [])
      .filter((producto) => !disponibilidad.has(producto.product_id))
      .filter((producto) => mezclasCompatiblesConDiametros(producto.diametros ?? []).some((mezcla) => mezclas.includes(mezcla)))
      .slice(0, porColor);
    for (const producto of sirven) {
      const nombre = plegar(producto.titulo).replace(/^(?:b2[bc]\s+)?(?:globos?\s+)?(?:latex\s+)?(?:redond[oa]s?\s+)?/, "").trim();
      const frase = `globo latex redondo ${nombre}`;
      if (nombre && !busquedas.includes(frase)) busquedas.push(frase);
    }
  }
  return busquedas.slice(0, maximo);
}

export function ajustarCoberturaPlan(
  plan: PlanDecoracion,
  disponibilidad: ReadonlyMap<string, DisponibilidadProducto>,
): { plan: PlanDecoracion; ajustes: AjusteCobertura[] } {
  const ajustes: AjusteCobertura[] = [];
  const tamanosObligatorios = (plan.restricciones?.tamanos ?? []).some((item) => item.polaridad === "obligatorio");
  const estructuras = plan.estructuras.map((estructuraOriginal) => {
    // Rule 1: the material color follows a one-color product.
    const materialesConColor = estructuraOriginal.materiales.map((materialModelo) => {
      const producto = disponibilidad.get(materialModelo.product_id);
      if (!producto) return materialModelo;
      let material = materialModelo;
      if (material.acabado && !producto.acabados.map(plegar).includes(plegar(material.acabado))) {
        ajustes.push({ tipo: "acabado_material", estructura_id: estructuraOriginal.estructura_id, product_id: material.product_id, antes: material.acabado, color: material.color ?? null });
        const sinAcabado = { ...material };
        delete sinAcabado.acabado;
        material = sinAcabado;
      }
      // The variant colors, not the product's: a product's `derived.colors`
      // include the Shopify color FAMILIES of its tags ("Fashion Violeta" is
      // tagged MORADOS), and taking them as real colors stopped this rule from
      // firing, so a violet balloon was quoted as "morado".
      const colores = producto.coloresVariante.map(plegar).filter((color) => !SIN_COLOR_UNICO.has(color));
      if (!material.color) {
        // Sin color del modelo, el del catálogo: un producto de un solo color real lo dice él. Un producto de varios
        // colores (un surtido, un «Duo») se queda sin él: elegir uno sería inventarlo.
        if (colores.length !== 1) return material;
        ajustes.push({ tipo: "color_catalogo", estructura_id: estructuraOriginal.estructura_id, product_id: material.product_id, color: colores[0]! });
        return { ...material, color: colores[0]! };
      }
      const actual = plegar(material.color);
      if (colores.length !== 1 || colores.includes(actual)) return material;
      ajustes.push({ tipo: "color_material", estructura_id: estructuraOriginal.estructura_id, product_id: material.product_id, antes: material.color, despues: colores[0]! });
      return { ...material, color: colores[0]! };
    });
    const conColor = { ...estructuraOriginal, materiales: materialesConColor };
    // Un centro de mesa de globos contados (UI-6) compra variantes fijas: no tiene mezcla que cubrir.
    if (!esCuentaGeometrica(conColor) || tamanosObligatorios) return conColor;
    if (materialesConColor.some((material) => !disponibilidad.get(material.product_id))) return conColor;
    const cercanas = MEZCLAS_CERCANAS[conColor.mezcla];
    // Rule 2a: a material whose product builds none of the close mixes is bought as another product of the SAME
    // real color that does, when this turn's search has one; only then do rules 2 and 3 decide the mix.
    const materiales = materialesConColor.map((material) => {
      const producto = disponibilidad.get(material.product_id)!;
      if (cercanas.some((mezcla) => producto.mezclas.includes(mezcla))) return material;
      return cambiarPorMismoColor(conColor, material, producto, cercanas, disponibilidad, ajustes);
    });
    const estructura = { ...conColor, materiales };
    const productos = materiales.map((material) => disponibilidad.get(material.product_id));
    if (productos.some((producto) => !producto)) return estructura;
    const cubre = (indice: number, mezcla: Mezcla) => productos[indice]!.mezclas.includes(mezcla);

    // Rule 2: a close mix every material covers.
    const comun = cercanas.find((mezcla) => materiales.every((_, indice) => cubre(indice, mezcla)));
    if (comun) {
      if (comun === estructura.mezcla) return estructura;
      ajustes.push({ tipo: "mezcla", estructura_id: estructura.estructura_id, antes: estructura.mezcla, despues: comun });
      return { ...estructura, mezcla: comun };
    }

    // Rule 3: the main material decides; the ones that cannot follow it leave.
    const principal = indicePrincipal(materiales);
    const opciones = cercanas.filter((mezcla) => cubre(principal, mezcla));
    if (opciones.length === 0 || materiales.length < 2) return estructura;
    const participacionQueQueda = (mezcla: Mezcla) => materiales.reduce((suma, material, indice) => suma + (cubre(indice, mezcla) ? material.participacion : 0), 0);
    const elegida = opciones.reduce((mejor, mezcla) => (participacionQueQueda(mezcla) > participacionQueQueda(mejor) ? mezcla : mejor), opciones[0]!);
    // Antes de salir, el material que no puede seguir la mezcla elegida prueba otro producto de su MISMO color real
    // que sí la sigue (el cambio de la regla 2a, ahora para la mezcla elegida): quitarlo es perder un color de la foto.
    const seguidores = materiales.map((material, indice) => (cubre(indice, elegida) ? material : cambiarPorMismoColor(estructura, material, productos[indice]!, [elegida], disponibilidad, ajustes)));
    const sigue = (material: Material) => disponibilidad.get(material.product_id)?.mezclas.includes(elegida) ?? false;
    // El material que decide la mezcla es el `principal`: si el que lo era se
    // fue, el rol pasa al de mayor participación reescalada (`partirMateriales`).
    const partido = partirMateriales(seguidores, (material) => !sigue(material));
    if (!partido) {
      if (!seguidores.every(sigue)) return estructura;
      // Todos la siguen gracias al cambio de producto: la pieza conserva todos sus colores.
      if (elegida !== estructura.mezcla) ajustes.push({ tipo: "mezcla", estructura_id: estructura.estructura_id, antes: estructura.mezcla, despues: elegida });
      return { ...estructura, mezcla: elegida, materiales: seguidores };
    }
    const { quedan: reescaladas, salen } = partido;
    const coloresQuedan = [...new Set(reescaladas.map((material) => material.color).filter((color): color is string => Boolean(color)))];
    for (const material of salen) {
      const nombre = material.color ? `globos ${material.color}` : "uno de los globos";
      ajustes.push({
        tipo: "material_quitado",
        estructura_id: estructura.estructura_id,
        product_id: material.product_id,
        color: material.color ?? null,
        aviso_cliente: `No tengo ${nombre} en los tamaños que necesita ${estructura.nombre.toLowerCase()}${coloresQuedan.length ? `: la armé con ${unirColores(coloresQuedan)}` : ""}.`,
      });
    }
    if (elegida !== estructura.mezcla) ajustes.push({ tipo: "mezcla", estructura_id: estructura.estructura_id, antes: estructura.mezcla, despues: elegida });
    return { ...estructura, mezcla: elegida, materiales: reescaladas };
  });
  return { plan: { ...plan, estructuras }, ajustes };
}
