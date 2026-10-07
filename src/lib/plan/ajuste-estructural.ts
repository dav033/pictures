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

/** Cómo entra un color nuevo en una pieza, o por qué no entra. */
export type EntradaColor =
  | { modo: "paleta" | "posiciones" | "reparto" }
  | { modo: null; motivo: string };

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

/** Si una pieza admite un color más y cómo (misma precedencia de motores que Python: el clásico manda). */
export function entradaColorNuevo(estructura: EstructuraPlan, color: string): EntradaColor {
  if (estructura.materiales.some((material) => normal(material.color) === normal(color))) return { modo: null, motivo: "ya lleva ese color" };
  if (estructura.materiales.length >= MAX_MATERIALES) return { modo: null, motivo: "ya lleva seis colores" };
  if (estructura.patron_color) return { modo: null, motivo: "sigue un patrón de colores" };
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

function conColor(estructura: EstructuraPlan, globo: GloboNuevo, modo: "paleta" | "posiciones" | "reparto"): EstructuraPlan {
  const indice = estructura.materiales.length;
  const partes = participacionesConNuevo(estructura.materiales);
  const materiales: MaterialPlan[] = [
    ...estructura.materiales.map((material, posicion) => ({ ...material, participacion: partes[posicion]! })),
    { product_id: globo.product_id, color: globo.color, participacion: partes[indice]!, rol_material: "acento" },
  ];
  if (modo === "reparto") return { ...estructura, materiales };
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
 * el catálogo no cubre). `piezas` vacío = ninguna pieza lo admite.
 */
export function planConColor(plan: PlanDecoracion, globo: GloboNuevo, soloEn?: ReadonlySet<string>): { plan: PlanDecoracion; piezas: string[]; omitidas: Array<{ estructura_id: string; motivo: string }> } {
  const piezas: string[] = [];
  const omitidas: Array<{ estructura_id: string; motivo: string }> = [];
  const estructuras = plan.estructuras.map((estructura) => {
    if (soloEn && !soloEn.has(estructura.estructura_id)) {
      omitidas.push({ estructura_id: estructura.estructura_id, motivo: "el catálogo no tiene ese color en sus tamaños" });
      return estructura;
    }
    const entrada = entradaColorNuevo(estructura, globo.color);
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
