import { ACABADOS_GUIRNALDA } from "./armado-guirnalda-organica";
import { OFICIALES_SIN_MOTOR, esEstructuraOficialId } from "./estructuras-oficiales";
import { esCuentaGeometrica, type EstructuraPlan, type MaterialPlan, type PlanDecoracion } from "./tipos";

/**
 * «Quitar pieza» y «Añadir un color» de «Ajustar mi plan» sin modelo: el cambio se hace sobre la ENTRADA del plan
 * firmado (las estructuras con sus medidas, armados, pesos y nombres) y Python vuelve a resolverlo y a firmarlo
 * (`ajuste-plan-entero.ts`, por `/plan/resolve`, que el Python del VPS ya tiene). Aquí no se cuenta ningún globo: se
 * quita una estructura, o se le añade a cada pieza un material con una parte de la paleta, y lo demás queda tal cual.
 *
 * Antes las dos rehacían el plan con el modelo, que solo recibía pieza, cantidad y nombre: al añadir blanco el arco
 * pasaba de 3 × 2,5 a 2,5 × 2,2 m y las columnas de 2,46 a 2 m; al quitar las columnas el arco que quedaba cambiaba de
 * medidas y de reparto (verificación de «Ajustar mi plan», 2026-10-06).
 *
 * Puro: lo importan el servidor (que decide) y el navegador (que solo ofrece lo que se puede hacer).
 */

/** Parte del color nuevo en cada pieza (la misma con que «+» estrena un color en una paleta). Luego se ajusta con «+» y «−». */
export const PARTE_COLOR_NUEVO = 0.15;
/** Tope de materiales de una pieza (`MaterialPlanSchema` max 6), de colores de una paleta y de posiciones de un patrón. */
const MAX_MATERIALES = 6;
const MAX_PALETA = 8;
const MAX_POSICIONES = 8;
/** Piezas sin motor cuyo reparto de colores se puede mover (`TIPOS_GEOMETRICOS` de DetalleEstructura). */
const TIPOS_CON_REPARTO = new Set(["arco", "semiarco", "guirnalda", "columna", "pared", "centro_mesa"]);

export type AcabadoMotor = (typeof ACABADOS_GUIRNALDA)[number];

/** Cómo entra un color nuevo en una pieza, o por qué no entra. `patron`: el patrón de colores de la pieza lo toma. */
export type EntradaColor =
  | { modo: "paleta" | "posiciones" | "reparto" | "patron" }
  | { modo: null; motivo: string };

type PatronPieza = NonNullable<EstructuraPlan["patron_color"]>;

/**
 * El patrón de colores con un material más, sin cambiar su modo ni su ritmo: entra con un peso pequeño (aleatorio,
 * bloques), como un racimo más de la secuencia (anillos, damero), como la última parada (degradado) o en una posición
 * del racimo de la espiral (la del color que más se repite). Null si el modo no deja sumar otro color (flor, zonas)
 * o ya está lleno. Python valida el patrón con la geometría de la pieza al resolver.
 */
export function patronConColor(patron: PatronPieza, indice: number): PatronPieza | null {
  const base = patron.base;
  const peso = (pesos: ReadonlyArray<{ peso: number }>) => Math.min(100, Math.max(1, Math.round((pesos.reduce((suma, item) => suma + item.peso, 0) / Math.max(1, pesos.length)) * 0.5)));
  switch (base.modo) {
    case "aleatorio":
      return base.pesos.length >= 6 ? null : { ...patron, origen: "decorador", base: { ...base, pesos: [...base.pesos, { material: indice, peso: peso(base.pesos) }] } };
    case "bloques":
      return base.bloques.length >= 12 ? null : { ...patron, origen: "decorador", base: { ...base, bloques: [...base.bloques, { material: indice, peso: peso(base.bloques) }] } };
    case "anillos":
      return base.secuencia.length >= 12 ? null : { ...patron, origen: "decorador", base: { ...base, secuencia: [...base.secuencia, indice] } };
    case "damero":
      return base.secuencia.length >= 4 ? null : { ...patron, origen: "decorador", base: { ...base, secuencia: [...base.secuencia, indice] } };
    case "degradado":
      return base.paradas.length >= 6 ? null : { ...patron, origen: "decorador", base: { ...base, paradas: [...base.paradas, indice] } };
    case "espiral": {
      if (base.racimo.length < 2) return null;
      const veces = new Map<number, number>();
      for (const material of base.racimo) veces.set(material, (veces.get(material) ?? 0) + 1);
      const [masRepetido, cuantas] = [...veces.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!;
      // Con todas las posiciones de colores distintos no se quita ninguno: no hay sitio sin borrar un color.
      if (cuantas < 2) return null;
      const posicion = base.racimo.lastIndexOf(masRepetido);
      return { ...patron, origen: "decorador", base: { ...base, racimo: base.racimo.map((material, lugar) => (lugar === posicion ? indice : material)) } };
    }
    default:
      return null;
  }
}

function normal(texto: string | null | undefined): string {
  return (texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLocaleLowerCase("es");
}

/** Acabado con que el motor orgánico pinta un globo, por el título del producto (la familia del catálogo). */
export function acabadoMotorDeTitulo(titulo: string): AcabadoMotor {
  const plegado = normal(titulo);
  if (/reflex|cromad|chrome|metal/.test(plegado)) return "cromado";
  if (/cristal|transparent|clear/.test(plegado)) return "transparente";
  if (/confeti/.test(plegado)) return "confeti";
  return "mate";
}

/**
 * Si una pieza admite un color más y cómo (misma precedencia de motores que Python: el clásico manda). Con `productId`,
 * lo que no se repite es el GLOBO (un blanco perla junto al blanco de siempre sí entra); sin él, el color.
 */
export function entradaColorNuevo(estructura: EstructuraPlan, color: string, productId?: string): EntradaColor {
  if (estructura.materiales.some((material) => normal(material.color) === normal(color) && (!productId || material.product_id === productId))) return { modo: null, motivo: productId ? "ya lleva ese globo" : "ya lleva ese color" };
  if (estructura.materiales.length >= MAX_MATERIALES) return { modo: null, motivo: "ya lleva seis colores" };
  if (estructura.patron_color) {
    const conMotor = Boolean(estructura.armado_columna || estructura.armado_arco || estructura.armado_arco_organico || estructura.armado_columna_organica || estructura.armado_guirnalda_organica || estructura.armado_guirnalda || estructura.armado_bouquet);
    // Un patrón sin motor que lo cuente toma el color en su propio ritmo (`patronConColor`); Python lo valida.
    if (!conMotor && esCuentaGeometrica(estructura) && patronConColor(estructura.patron_color, estructura.materiales.length)) return { modo: "patron" };
    return { modo: null, motivo: "sigue un patrón de colores" };
  }
  if (estructura.armado_bouquet || estructura.estructura_oficial === "bouquet") return { modo: null, motivo: "en un bouquet cada globo tiene su lugar" };
  if (!esCuentaGeometrica(estructura)) return { modo: null, motivo: "es una pieza contada" };
  const sinMotor = esEstructuraOficialId(estructura.estructura_oficial) && OFICIALES_SIN_MOTOR.has(estructura.estructura_oficial);
  const conArmado = Boolean(estructura.armado_columna || estructura.armado_arco || estructura.armado_arco_organico || estructura.armado_columna_organica || estructura.armado_guirnalda_organica || estructura.armado_guirnalda);
  if (sinMotor) return conArmado ? { modo: null, motivo: "su armado fija sus colores" } : TIPOS_CON_REPARTO.has(estructura.tipo) ? { modo: "reparto" } : { modo: null, motivo: "cada color lleva su parte" };
  if (estructura.armado_columna) {
    const armado = estructura.armado_columna;
    return armado.modo === "altura" && armado.patron !== "solido" && armado.materiales.length < MAX_POSICIONES ? { modo: "posiciones" } : { modo: null, motivo: "lleva sus colores capa por capa" };
  }
  if (estructura.armado_arco && estructura.tipo === "arco") {
    const armado = estructura.armado_arco;
    return armado.capas.length === 0 && armado.secciones.length === 0 && armado.patron !== "solido" && armado.materiales.length < MAX_POSICIONES ? { modo: "posiciones" } : { modo: null, motivo: "lleva sus colores por franjas" };
  }
  const organico = estructura.armado_arco_organico ?? estructura.armado_columna_organica ?? estructura.armado_guirnalda_organica;
  if (organico) return organico.colores.paleta.length < MAX_PALETA ? { modo: "paleta" } : { modo: null, motivo: "su paleta está llena" };
  if (estructura.armado_guirnalda) return { modo: null, motivo: "su armado fija sus colores" };
  return TIPOS_CON_REPARTO.has(estructura.tipo) ? { modo: "reparto" } : { modo: null, motivo: "cada color lleva su parte" };
}

/** Participaciones con el material nuevo al final con `PARTE_COLOR_NUEVO`, las demás en su misma proporción; suman 1. */
function participacionesConNuevo(materiales: readonly MaterialPlan[]): number[] {
  const total = materiales.reduce((suma, material) => suma + material.participacion, 0) || 1;
  const otras = materiales.map((material) => Math.round((material.participacion / total) * (1 - PARTE_COLOR_NUEVO) * 10_000) / 10_000);
  const nueva = Math.round((1 - otras.reduce((suma, parte) => suma + parte, 0)) * 10_000) / 10_000;
  return [...otras, nueva];
}

export type GloboNuevo = { product_id: string; color: string; acabadoMotor: AcabadoMotor };

function conColor(estructura: EstructuraPlan, globo: GloboNuevo, modo: "paleta" | "posiciones" | "reparto" | "patron"): EstructuraPlan {
  const indice = estructura.materiales.length;
  const partes = participacionesConNuevo(estructura.materiales);
  const materiales: MaterialPlan[] = [
    ...estructura.materiales.map((material, posicion) => ({ ...material, participacion: partes[posicion]! })),
    { product_id: globo.product_id, color: globo.color, participacion: partes[indice]!, rol_material: "acento" },
  ];
  if (modo === "reparto") return { ...estructura, materiales };
  if (modo === "patron") {
    const patron = estructura.patron_color ? patronConColor(estructura.patron_color, indice) : null;
    return patron ? { ...estructura, materiales, patron_color: patron } : estructura;
  }
  if (modo === "posiciones") {
    if (estructura.armado_columna) return { ...estructura, materiales, armado_columna: { ...estructura.armado_columna, materiales: [...estructura.armado_columna.materiales, indice] } };
    if (estructura.armado_arco) return { ...estructura, materiales, armado_arco: { ...estructura.armado_arco, materiales: [...estructura.armado_arco.materiales, indice] } };
    return estructura;
  }
  // Paleta de un armado orgánico: las demás conservan su proporción entre sí y el color nuevo toma su parte.
  const conPaleta = <A extends { colores: { paleta: Array<{ material: number; peso: number; acabado: AcabadoMotor; rol: "normal" | "acento" }> } }>(armado: A): A => {
    const total = armado.colores.paleta.reduce((suma, color) => suma + color.peso, 0) || 1;
    const paleta = [
      ...armado.colores.paleta.map((color) => ({ ...color, peso: Math.min(100, Math.max(1, Math.round((color.peso / total) * (1 - PARTE_COLOR_NUEVO) * 100))) })),
      { material: indice, peso: Math.round(PARTE_COLOR_NUEVO * 100), acabado: globo.acabadoMotor, rol: "normal" as const },
    ];
    return { ...armado, origen: "decorador", colores: { ...armado.colores, paleta } };
  };
  if (estructura.armado_arco_organico) return { ...estructura, materiales, armado_arco_organico: conPaleta(estructura.armado_arco_organico) };
  if (estructura.armado_columna_organica) return { ...estructura, materiales, armado_columna_organica: conPaleta(estructura.armado_columna_organica) };
  if (estructura.armado_guirnalda_organica) return { ...estructura, materiales, armado_guirnalda_organica: conPaleta(estructura.armado_guirnalda_organica) };
  return estructura;
}

/**
 * El plan con el color nuevo en cada pieza que lo admite (todas sus medidas y su armado quedan como estaban; solo su
 * paleta, sus posiciones de color o su reparto ganan el color). `soloEn`: limita las piezas (el reintento sin las que
 * el catálogo no cubre, o las piezas que pidió el cliente) y `motivoFuera` dice por qué quedan fuera las demás.
 * `piezas` vacío = ninguna pieza lo admite.
 */
export function planConColor(plan: PlanDecoracion, globo: GloboNuevo, soloEn?: ReadonlySet<string>, motivoFuera = "el catálogo no tiene ese color en sus tamaños"): { plan: PlanDecoracion; piezas: string[]; omitidas: Array<{ estructura_id: string; motivo: string }> } {
  const piezas: string[] = [];
  const omitidas: Array<{ estructura_id: string; motivo: string }> = [];
  const estructuras = plan.estructuras.map((estructura) => {
    if (soloEn && !soloEn.has(estructura.estructura_id)) {
      omitidas.push({ estructura_id: estructura.estructura_id, motivo: motivoFuera });
      return estructura;
    }
    const entrada = entradaColorNuevo(estructura, globo.color, globo.product_id);
    if (entrada.modo === null) {
      omitidas.push({ estructura_id: estructura.estructura_id, motivo: entrada.motivo });
      return estructura;
    }
    piezas.push(estructura.estructura_id);
    return conColor(estructura, globo, entrada.modo);
  });
  const paleta = plan.concepto.paleta.some((color) => normal(color) === normal(globo.color)) || plan.concepto.paleta.length >= 8
    ? plan.concepto.paleta
    : [...plan.concepto.paleta, globo.color];
  return { plan: { ...plan, concepto: { ...plan.concepto, paleta }, estructuras }, piezas, omitidas };
}

/** El globo que reemplaza a un color: su producto, su color en el catálogo y el acabado con que lo pinta el motor. */
export type GloboReemplazo = { product_id: string; color: string; acabadoMotor: AcabadoMotor };

/** Qué color se cambia y dónde: `estructuras` vacío o ausente = en todas las piezas que lo llevan. */
export type ColorAReemplazar = { color: string; product_id?: string; estructuras?: ReadonlySet<string> };

function conPaletaAcabado<A extends { colores: { paleta: Array<{ material: number; acabado: AcabadoMotor }> } }>(armado: A, indices: ReadonlySet<number>, acabado: AcabadoMotor): A {
  if (!armado.colores.paleta.some((color) => indices.has(color.material))) return armado;
  return { ...armado, origen: "decorador", colores: { ...armado.colores, paleta: armado.colores.paleta.map((color) => (indices.has(color.material) ? { ...color, acabado } : color)) } };
}

/**
 * El plan con UN color cambiado por otro globo del catálogo, en todas sus medidas: cada material de ese color pasa a
 * ser el producto nuevo (sin variante fija: Python elige la de cada tamaño) y conserva su lugar, su parte y su papel;
 * las paletas de los motores orgánicos pintan ese material con el acabado del globo nuevo. Medidas, armados, pesos de
 * los demás colores y nombres quedan tal cual. Una pieza que ya lleva ESE mismo globo no se toca (quedaría repetido).
 * Puro: no cuenta globos; Python vuelve a resolver y a firmar.
 */
export function planConColorReemplazado(plan: PlanDecoracion, objetivo: ColorAReemplazar, globo: GloboReemplazo): { plan: PlanDecoracion; piezas: string[]; omitidas: Array<{ estructura_id: string; motivo: string }> } {
  const piezas: string[] = [];
  const omitidas: Array<{ estructura_id: string; motivo: string }> = [];
  const viejo = normal(objetivo.color);
  const nuevo = normal(globo.color);
  const esDelColor = (material: MaterialPlan) => normal(material.color) === viejo && (!objetivo.product_id || material.product_id === objetivo.product_id);
  const estructuras = plan.estructuras.map((estructura) => {
    if (objetivo.estructuras?.size && !objetivo.estructuras.has(estructura.estructura_id)) return estructura;
    const indices = new Set(estructura.materiales.flatMap((material, indice) => (esDelColor(material) ? [indice] : [])));
    if (!indices.size) return estructura;
    if (estructura.materiales.some((material, indice) => !indices.has(indice) && material.product_id === globo.product_id && normal(material.color) === nuevo)) {
      omitidas.push({ estructura_id: estructura.estructura_id, motivo: "ya lleva ese globo" });
      return estructura;
    }
    piezas.push(estructura.estructura_id);
    const materiales = estructura.materiales.map((material, indice): MaterialPlan => {
      if (!indices.has(indice)) return material;
      // Sin variante ni acabado fijos: el globo nuevo se compra en cada tamaño que la pieza lleve.
      return { product_id: globo.product_id, color: nuevo, participacion: material.participacion, rol_material: material.rol_material };
    });
    // Un reemplazo suelto de una medida de ESE color (de la clásica) ya no aplica: el color entero cambió.
    const overrides = estructura.variant_overrides?.filter((item) => normal(item.color) !== viejo && (!objetivo.product_id || item.product_id !== objetivo.product_id));
    const cambiada: EstructuraPlan = { ...estructura, materiales };
    if (overrides?.length) cambiada.variant_overrides = overrides;
    else delete cambiada.variant_overrides;
    if (cambiada.armado_arco_organico) cambiada.armado_arco_organico = conPaletaAcabado(cambiada.armado_arco_organico, indices, globo.acabadoMotor);
    if (cambiada.armado_columna_organica) cambiada.armado_columna_organica = conPaletaAcabado(cambiada.armado_columna_organica, indices, globo.acabadoMotor);
    if (cambiada.armado_guirnalda_organica) cambiada.armado_guirnalda_organica = conPaletaAcabado(cambiada.armado_guirnalda_organica, indices, globo.acabadoMotor);
    return cambiada;
  });
  // La paleta del concepto dice el color nuevo en el lugar del viejo (o al final, si el viejo sigue en otra pieza).
  const quedaElViejo = estructuras.some((estructura) => estructura.materiales.some((material) => normal(material.color) === viejo));
  const base = quedaElViejo ? plan.concepto.paleta : [...new Set(plan.concepto.paleta.map((color) => (normal(color) === viejo ? nuevo : color)))];
  const paleta = base.some((color) => normal(color) === nuevo) || base.length >= 8 ? base : [...base, nuevo];
  return { plan: { ...plan, concepto: { ...plan.concepto, paleta: piezas.length ? paleta : plan.concepto.paleta }, estructuras }, piezas, omitidas };
}

/** Si alguna pieza del plan admite un color más (para ofrecer «Añadir un color»). */
export function planAdmiteColorNuevo(plan: PlanDecoracion): boolean {
  return plan.estructuras.some((estructura) => entradaColorNuevo(estructura, "\u0000color nuevo").modo !== null);
}

/**
 * El plan sin una pieza. Si era la única focal, la primera de las que quedan pasa a focal (el plan exige una). Null si
 * la pieza no está o es la última.
 */
export function planSinPieza(plan: PlanDecoracion, estructuraId: string): { plan: PlanDecoracion; nuevaFocal: string | null } | null {
  const quitada = plan.estructuras.find((estructura) => estructura.estructura_id === estructuraId);
  const restantes = plan.estructuras.filter((estructura) => estructura.estructura_id !== estructuraId);
  if (!quitada || restantes.length === 0) return null;
  if (restantes.some((estructura) => estructura.rol_escena === "focal")) return { plan: { ...plan, estructuras: restantes }, nuevaFocal: null };
  const [primera, ...demas] = restantes as [EstructuraPlan, ...EstructuraPlan[]];
  return { plan: { ...plan, estructuras: [{ ...primera, rol_escena: "focal" }, ...demas] }, nuevaFocal: primera.estructura_id };
}
