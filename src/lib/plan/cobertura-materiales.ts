import type { Mezcla } from "@/lib/medidas/geometria";
import { TIPOS_ESTRUCTURA_GEOMETRICOS } from "./composicion";
import type { PlanDecoracion } from "./tipos";

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
 * 2. A geometric structure without mandatory customer sizes keeps its mix when
 *    every material covers it. Otherwise the closest mix of the same family
 *    (`MEZCLAS_CERCANAS`) that every material covers replaces it.
 * 3. If no close mix fits every material, the main material (first
 *    `principal`, else the largest share) decides the mix, and the materials
 *    that cannot cover it are removed with a customer notice; the remaining
 *    shares are rescaled to add up to 1.
 * 4. A structure whose main material covers no close mix, or with a material
 *    this turn's search did not return, is left as it is: the resolver reports
 *    it.
 *
 * Pure: no provider, HTTP, database or environment.
 */

export type DisponibilidadProducto = {
  titulo: string;
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
  | { tipo: "acabado_material"; estructura_id: string; product_id: string; antes: string }
  | { tipo: "mezcla"; estructura_id: string; antes: Mezcla; despues: Mezcla }
  | { tipo: "material_quitado"; estructura_id: string; product_id: string; color: string | null; aviso_cliente: string };

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

export function ajustarCoberturaPlan(
  plan: PlanDecoracion,
  disponibilidad: ReadonlyMap<string, DisponibilidadProducto>,
): { plan: PlanDecoracion; ajustes: AjusteCobertura[] } {
  const ajustes: AjusteCobertura[] = [];
  const tamanosObligatorios = (plan.restricciones?.tamanos ?? []).some((item) => item.polaridad === "obligatorio");
  const estructuras = plan.estructuras.map((estructuraOriginal) => {
    // Rule 1: the material color follows a one-color product.
    const materiales = estructuraOriginal.materiales.map((materialModelo) => {
      const producto = disponibilidad.get(materialModelo.product_id);
      if (!producto) return materialModelo;
      let material = materialModelo;
      if (material.acabado && !producto.acabados.map(plegar).includes(plegar(material.acabado))) {
        ajustes.push({ tipo: "acabado_material", estructura_id: estructuraOriginal.estructura_id, product_id: material.product_id, antes: material.acabado });
        const sinAcabado = { ...material };
        delete sinAcabado.acabado;
        material = sinAcabado;
      }
      if (!material.color) return material;
      // The variant colors, not the product's: a product's `derived.colors`
      // include the Shopify color FAMILIES of its tags ("Fashion Violeta" is
      // tagged MORADOS), and taking them as real colors stopped this rule from
      // firing, so a violet balloon was quoted as "morado".
      const colores = producto.coloresVariante.map(plegar).filter((color) => !SIN_COLOR_UNICO.has(color));
      const actual = plegar(material.color);
      if (colores.length !== 1 || colores.includes(actual)) return material;
      ajustes.push({ tipo: "color_material", estructura_id: estructuraOriginal.estructura_id, product_id: material.product_id, antes: material.color, despues: colores[0]! });
      return { ...material, color: colores[0]! };
    });
    const estructura = { ...estructuraOriginal, materiales };
    if (!GEOMETRICOS.has(estructura.tipo) || tamanosObligatorios) return estructura;
    const productos = materiales.map((material) => disponibilidad.get(material.product_id));
    if (productos.some((producto) => !producto)) return estructura;
    const cubre = (indice: number, mezcla: Mezcla) => productos[indice]!.mezclas.includes(mezcla);

    // Rule 2: a close mix every material covers.
    const cercanas = MEZCLAS_CERCANAS[estructura.mezcla];
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
    const quedan = materiales.filter((_, indice) => cubre(indice, elegida));
    const salen = materiales.filter((_, indice) => !cubre(indice, elegida));
    const total = quedan.reduce((suma, material) => suma + material.participacion, 0);
    const reescaladas = quedan.map((material) => ({ ...material, participacion: material.participacion / total }));
    // Shares must add up to exactly 1 for the plan schema.
    const desfase = 1 - reescaladas.reduce((suma, material) => suma + material.participacion, 0);
    reescaladas[0] = { ...reescaladas[0]!, participacion: reescaladas[0]!.participacion + desfase };
    if (!reescaladas.some((material) => material.rol_material === "principal")) reescaladas[0] = { ...reescaladas[0]!, rol_material: "principal" };
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
