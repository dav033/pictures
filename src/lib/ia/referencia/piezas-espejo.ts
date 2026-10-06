import type { ReferenceBBox, ReferenceBlueprintV2 } from "./reference-blueprint";
import type { LoraDensity, LoraDesignRole, LoraStructureType } from "../escena/lora-semantics";
import { coloresDominantesReferencia } from "@/lib/plan/colores-referencia";

/**
 * Dos piezas en espejo de la misma foto son UNA pieza repetida (2026-10-04).
 *
 * El reconocedor mira cada pieza por separado y, en una foto con dos piezas orgánicas que enmarcan una mesa,
 * llamó a la de la izquierda «columna» (vuelo `slight`) y a la de la derecha «semiarco» (vuelo `strong`), cada
 * una con su `repetition_group`. El plan las armó como dos estructuras distintas —una columna y un arco
 * completo de 3,68 m— y la imagen salió con una sola pieza. Aquí, sin proveedor y de forma determinista, una
 * pareja que es claramente la misma pieza (cajas simétricas respecto al centro, alto y ancho parecidos, mismos
 * colores) recibe el mismo tipo, el mismo `repetition_group`, el mismo rol y la misma densidad, y la
 * inclinación en espejo. El plan la materializa con UNA estructura de `repeticiones` 2
 * (`validarCoberturaReferencia` da la segunda por cubierta) y la guía de escena pone la segunda instancia en la
 * caja de la otra, en espejo (`cajasDeLaFoto` busca primero por `repetition_group`).
 *
 * El tipo común sale del criterio que ya decide entre columna y semiarco (`parseDetectedStructure`, frontera
 * del prompt: vuelo `strong` = más del 35 % del alto), aplicado a la pareja: la media de los dos vuelos. En el
 * clasificador (`docs/investigacion-columna-organica.md`) una columna orgánica inclina la punta «hasta el 30 %
 * del alto»; por encima es un medio arco. Con un vuelo `slight` (22 %) y otro `strong` (45 %) la media es
 * 33,5 %: la misma pieza inclinada, no dos piezas de familias distintas.
 */

type Elemento = ReferenceBlueprintV2["elements"][number];

/** Las piezas verticales de un lado: las únicas que el reconocedor confunde entre sí. */
const TIPOS_VERTICALES: ReadonlySet<LoraStructureType> = new Set(["columna", "semiarco"]);
/** Frontera columna / semiarco en fracción del alto: la del prompt (`top_overhang` strong = más del 35 %). */
export const VUELO_FRONTERA_SEMIARCO = 0.35;
/** Diferencia máxima entre las distancias de las dos piezas al centro de la foto (fracción del ancho). */
const TOLERANCIA_SIMETRIA = 0.2;
const ALTO_MINIMO_RELATIVO = 0.7;
const ANCHO_MINIMO_RELATIVO = 0.5;
const SOLAPE_VERTICAL_MINIMO = 0.6;
const COLORES_MINIMO_JACCARD = 0.5;

const centroX = (caja: ReferenceBBox) => caja.x + caja.width / 2;
const proporcion = (a: number, b: number) => (Math.max(a, b) > 0 ? Math.min(a, b) / Math.max(a, b) : 0);

function solapeVertical(a: ReferenceBBox, b: ReferenceBBox): number {
  const solape = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return solape / Math.max(Math.min(a.height, b.height), 1e-6);
}

function coloresDe(elemento: Elemento): Set<string> {
  return new Set(coloresDominantesReferencia(elemento.appearance.observed_colors));
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size || !b.size) return 0;
  const comunes = [...a].filter((color) => b.has(color)).length;
  return comunes / new Set([...a, ...b]).size;
}

function vertical(elemento: Elemento): boolean {
  const tipo = elemento.visual_semantics?.structure_type;
  return elemento.approved && elemento.category === "balloon_structure" && tipo !== undefined && TIPOS_VERTICALES.has(tipo);
}

/**
 * Cuánto se parecen dos piezas como pareja en espejo (0 = no son pareja). `izquierda` tiene el centro a la
 * izquierda de `derecha`, y cada una en su mitad de la foto.
 */
export function parecidoEspejo(izquierda: Elemento, derecha: Elemento): number {
  if (izquierda.source_image_id !== derecha.source_image_id) return 0;
  const a = izquierda.reference_bbox;
  const b = derecha.reference_bbox;
  if (!(centroX(a) < 0.5 && centroX(b) > 0.5)) return 0;
  const asimetria = Math.abs((0.5 - centroX(a)) - (centroX(b) - 0.5));
  if (asimetria > TOLERANCIA_SIMETRIA) return 0;
  const alto = proporcion(a.height, b.height);
  const ancho = proporcion(a.width, b.width);
  const solape = solapeVertical(a, b);
  const colores = jaccard(coloresDe(izquierda), coloresDe(derecha));
  if (alto < ALTO_MINIMO_RELATIVO || ancho < ANCHO_MINIMO_RELATIVO || solape < SOLAPE_VERTICAL_MINIMO || colores < COLORES_MINIMO_JACCARD) return 0;
  return (1 - asimetria) * alto * ancho * colores;
}

const RANGO_ROL: Record<LoraDesignRole, number> = { acento: 0, soporte: 1, focal: 2 };
const RANGO_DENSIDAD: Record<LoraDensity, number> = { sencilla: 0, media: 1, lujosa: 2 };

/** Cambia izquierda por derecha en la descripción de la forma (la de la otra pieza, vista en espejo). */
function enEspejo(texto: string): string {
  return texto.replace(/\b(left|right)\b/g, (lado) => (lado === "left" ? "right" : "left"));
}

/** Lo que sabe la pareja de su vuelo: la media de los dos, en fracción del alto (sin signo). */
function vueloDeLaPareja(a: Elemento, b: Elemento): number {
  const vuelo = (elemento: Elemento) => Math.abs(elemento.appearance.inclinacion ?? 0);
  return (vuelo(a) + vuelo(b)) / 2;
}

export type ParejaEspejo = { izquierda: string; derecha: string; tipo: LoraStructureType; grupo: string };

/** Las parejas en espejo de una foto, la mejor primero; cada elemento entra como mucho en una. */
export function parejasEspejo(elementos: readonly Elemento[]): Array<{ izquierda: Elemento; derecha: Elemento }> {
  const candidatos = elementos.filter(vertical);
  const posibles: Array<{ izquierda: Elemento; derecha: Elemento; parecido: number }> = [];
  for (const izquierda of candidatos) {
    for (const derecha of candidatos) {
      if (izquierda === derecha) continue;
      const parecido = parecidoEspejo(izquierda, derecha);
      if (parecido > 0) posibles.push({ izquierda, derecha, parecido });
    }
  }
  posibles.sort((x, y) => y.parecido - x.parecido || x.izquierda.element_id.localeCompare(y.izquierda.element_id));
  const usados = new Set<string>();
  const parejas: Array<{ izquierda: Elemento; derecha: Elemento }> = [];
  for (const { izquierda, derecha } of posibles) {
    if (usados.has(izquierda.element_id) || usados.has(derecha.element_id)) continue;
    usados.add(izquierda.element_id);
    usados.add(derecha.element_id);
    parejas.push({ izquierda, derecha });
  }
  return parejas;
}

/**
 * El blueprint con cada pareja en espejo unificada (ver arriba). Devuelve el mismo objeto si no hay ninguna;
 * nunca modifica el recibido. Un elemento que ya comparte grupo con otro no se toca: alguien ya lo decidió.
 */
export function unificarPiezasEspejo(blueprint: ReferenceBlueprintV2): ReferenceBlueprintV2 {
  const grupos = new Map<string, number>();
  for (const elemento of blueprint.elements) {
    const grupo = elemento.visual_semantics?.repetition_group;
    if (grupo) grupos.set(grupo, (grupos.get(grupo) ?? 0) + 1);
  }
  const libres = blueprint.elements.filter((elemento) => (grupos.get(elemento.visual_semantics?.repetition_group ?? "") ?? 0) <= 1);
  const parejas = parejasEspejo(libres);
  if (!parejas.length) return blueprint;
  const cambios = new Map<string, Elemento>();
  for (const { izquierda, derecha } of parejas) {
    const si = izquierda.visual_semantics!;
    const sd = derecha.visual_semantics!;
    const vuelo = vueloDeLaPareja(izquierda, derecha);
    const tipo: LoraStructureType = si.structure_type === sd.structure_type
      ? si.structure_type
      : vuelo > VUELO_FRONTERA_SEMIARCO ? "semiarco" : "columna";
    const rol = RANGO_ROL[si.design_role] >= RANGO_ROL[sd.design_role] ? si.design_role : sd.design_role;
    const densidad = RANGO_DENSIDAD[si.density] >= RANGO_DENSIDAD[sd.density] ? si.density : sd.density;
    const grupo = izquierda.element_id;
    // La forma de la pieza que ya tenía el tipo común manda; la otra la recibe en espejo, para que las dos
    // digan lo mismo (el chat y la tarjeta leen la forma para elegir la estructura oficial).
    const modelo = si.structure_type === tipo ? izquierda : derecha;
    const formaIzquierda = modelo === izquierda ? izquierda.appearance.shape : enEspejo(derecha.appearance.shape);
    const formaDerecha = modelo === derecha ? derecha.appearance.shape : enEspejo(izquierda.appearance.shape);
    // Cada una hacia el centro de la foto: la izquierda se va a la derecha (+) y la derecha a la izquierda (−).
    // Si la foto mostró las dos rectas (0 observado), la pareja sigue recta: perder ese 0 devolvería a la
    // columna asimétrica su inclinación de plantilla.
    const rectaObservada = izquierda.appearance.inclinacion === 0 && derecha.appearance.inclinacion === 0;
    const inclinacion = (signo: 1 | -1) => (vuelo > 0 ? { inclinacion: Math.min(1, signo * vuelo) } : rectaObservada ? { inclinacion: 0 } : {});
    const unificar = (elemento: Elemento, forma: string, signo: 1 | -1, otra: Elemento): Elemento => {
      const { inclinacion: _anterior, ...apariencia } = elemento.appearance;
      void _anterior;
      // Es la misma pieza: un color que el analizador vio en una y no en la otra (las burbujas transparentes,
      // que los píxeles no ven y el modelo nombra una vez sí y otra no) lo tienen las dos, al final del orden.
      const propios = new Set(coloresDominantesReferencia(elemento.appearance.observed_colors));
      const prestados = otra.appearance.observed_colors.filter((etiqueta) => coloresDominantesReferencia([etiqueta]).some((color) => !propios.has(color)));
      const observados = [...elemento.appearance.observed_colors, ...prestados].slice(0, 8);
      return {
        ...elemento,
        appearance: { ...apariencia, observed_colors: observados, shape: forma, ...inclinacion(signo) },
        visual_semantics: { ...elemento.visual_semantics!, structure_type: tipo, design_role: rol, density: densidad, repetition_group: grupo },
        uncertainties: [`Mirrored pair with ${otra.element_id}: the same piece repeated, built as one structure with 2 repetitions.`, ...elemento.uncertainties].slice(0, 8),
      };
    };
    cambios.set(izquierda.element_id, unificar(izquierda, formaIzquierda, 1, derecha));
    cambios.set(derecha.element_id, unificar(derecha, formaDerecha, -1, izquierda));
  }
  return { ...blueprint, elements: blueprint.elements.map((elemento) => cambios.get(elemento.element_id) ?? elemento) };
}

/**
 * Los otros elementos aprobados de la foto que son la misma pieza que `elementId` (mismo `repetition_group`),
 * de izquierda a derecha. Vacío si la pieza es única.
 */
export function companerasDeGrupo(blueprint: ReferenceBlueprintV2 | undefined, elementId: string): Elemento[] {
  const elemento = blueprint?.elements.find((item) => item.element_id === elementId);
  const grupo = elemento?.visual_semantics?.repetition_group;
  if (!blueprint || !grupo) return [];
  return blueprint.elements
    .filter((item) => item.approved && item.element_id !== elementId && item.visual_semantics?.repetition_group === grupo)
    .sort((a, b) => centroX(a.reference_bbox) - centroX(b.reference_bbox));
}
