/**
 * Los dos casos de la guía de estructura (ADR-0033) para las pruebas y la
 * corrida comparativa: la guirnalda en pared del caso del usuario y un arco con
 * patrón. Cada uno trae el plan resuelto por Python de verdad (reducido a esa
 * sola estructura, como una escena de una pieza) y una escena sintética con
 * productos reales del vocabulario LoRA v007 y las frases de Python de ese
 * plan, compilada como en `/api/generate` sin foto del espacio.
 *
 * - `guirnalda-pared`: `pared-arqueada-desnivel` de
 *   `scripts/fixtures/armado-guirnalda-prompt/planes.json` (pared, curva
 *   arqueada por arriba, extremo derecho más bajo, cuartetos, relleno, espiral
 *   rosado, blanco y dorado): la foto del usuario, la que salió como un arco
 *   rectangular con patas.
 * - `arco-patron`: `EST_02_ARCO` de
 *   `scripts/fixtures/patron-color-ui/plan-con-patrones.json` (arco de 3 × 2,5 m,
 *   cuartetos, patrón de flores: fondo blanco, pétalos rosados y centro amarillo).
 *
 * Módulo importable: sin CLI ni efectos al cargar. Determinista y sin red.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SceneSpec } from "@/lib/ia/escena/scene-spec";
import { compileProductPrompt } from "@/lib/ia/kagutsuchi/lora-product-runtime";
import { frasesDeEstructuras, type FraseDeEstructura } from "@/lib/ia/uzume/mezcla-color-escena";
import { PRODUCT_VOCABULARY } from "@/lib/lora/product-vocabulary-data";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { CONTEXTO_CUMPLE } from "./escenas-armado-bouquet";
import { escenaGuirnalda, GUIRNALDA_SINTETICA, planGuirnalda, PRODUCTOS_GUIRNALDA } from "./escenas-armado-guirnalda";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

/** El plan con una sola de sus estructuras: sus líneas, su patrón y su armado, nada de las demás. */
export function planDeUnaEstructura(plan: PlanResuelto, estructuraId: string): PlanResuelto {
  const deEsta = <T extends { estructura_id: string }>(lista: readonly T[] | undefined) => lista?.filter((item) => item.estructura_id === estructuraId);
  return {
    ...plan,
    plan: { ...plan.plan, estructuras: plan.plan.estructuras.filter((estructura) => estructura.estructura_id === estructuraId) } as PlanResuelto["plan"],
    estructuras: plan.estructuras.filter((estructura) => estructura.estructura_id === estructuraId),
    ...(plan.patrones_color ? { patrones_color: deEsta(plan.patrones_color) } : {}),
    ...(plan.armados_guirnalda ? { armados_guirnalda: deEsta(plan.armados_guirnalda) } : {}),
    ...(plan.armados_bouquet ? { armados_bouquet: deEsta(plan.armados_bouquet) } : {}),
  };
}

export const PRODUCTO_AMARILLO_FASHION = "8634239287591";
export const ARCO_SINTETICO = "EST_01_ARCO";

export type CasoGuia = {
  nombre: "guirnalda-pared" | "arco-patron";
  /** Plan resuelto de UNA estructura: lo que dibuja la guía. */
  plan: PlanResuelto;
  /** Escena de esa pieza sola, con productos del vocabulario v007. */
  escena: SceneSpec;
  /** Frases de Python del plan, pasadas a la estructura de la escena. */
  frases: readonly FraseDeEstructura[];
};

type Elemento = SceneSpec["elements"][number];

function escenaDe(elemento: Elemento): SceneSpec {
  return { ...escenaGuirnalda(), elements: [elemento] };
}

export function casoGuirnaldaPared(): CasoGuia {
  const { plan } = planGuirnalda("pared-arqueada-desnivel");
  const reducido = planDeUnaEstructura(plan, "EST_01_GUIRNALDA");
  const frases = frasesDeEstructuras({
    ...(reducido.patrones_color ? { patrones_color: reducido.patrones_color.map((patron) => ({ ...patron, estructura_id: GUIRNALDA_SINTETICA })) } : {}),
    armados_guirnalda: (reducido.armados_guirnalda ?? []).map((armado) => ({ ...armado, estructura_id: GUIRNALDA_SINTETICA })),
  }) ?? [];
  const productos = [PRODUCTOS_GUIRNALDA.rosadoFashion, PRODUCTOS_GUIRNALDA.blancoFashion, PRODUCTOS_GUIRNALDA.doradoReflex];
  const guirnalda = escenaGuirnalda().elements.find((elemento) => elemento.element_id === GUIRNALDA_SINTETICA)!;
  return {
    nombre: "guirnalda-pared",
    plan: reducido,
    escena: escenaDe({ ...guirnalda, catalog_product_ids: productos, resolved_colors: ["rosado", "blanco", "dorado"] }),
    frases,
  };
}

export function casoArcoPatron(): CasoGuia {
  const completo = JSON.parse(readFileSync(join(FIXTURES, "patron-color-ui", "plan-con-patrones.json"), "utf8")) as PlanResuelto;
  const reducido = planDeUnaEstructura(completo, "EST_02_ARCO");
  const patron = reducido.patrones_color?.[0];
  if (!patron) throw new Error("plan-con-patrones.json perdió el patrón del arco");
  const frases = frasesDeEstructuras({ patrones_color: [{ ...patron, estructura_id: ARCO_SINTETICO }] }) ?? [];
  const arco = escenaGuirnalda().elements.find((elemento) => elemento.element_id === ARCO_SINTETICO)!;
  const productos = [PRODUCTOS_GUIRNALDA.blancoFashion, PRODUCTOS_GUIRNALDA.rosadoFashion, PRODUCTO_AMARILLO_FASHION];
  return {
    nombre: "arco-patron",
    plan: reducido,
    escena: escenaDe({ ...arco, catalog_product_id: productos[0], catalog_product_ids: productos, quantity: { mode: "exact", min: 141, max: 141 }, resolved_colors: ["blanco", "rosado", "amarillo"] }),
    frases,
  };
}

export function casosGuia(): CasoGuia[] {
  return [casoGuirnaldaPared(), casoArcoPatron()];
}

const TALLAS_R12 = [12];

/** Caption canónico v007 de la escena del caso, como en `/api/generate` (con `maxLength` para reservar las notas de la guía). */
export function captionDeCaso(caso: CasoGuia, trigger: string, maxLength?: number) {
  const tallas = caso.escena.elements.flatMap((elemento) => (elemento.catalog_product_ids ?? []).flatMap((productId) =>
    (caso.nombre === "arco-patron" ? TALLAS_R12 : [5, 9, 12, 18]).map((diametro) => ({ elementId: elemento.element_id, productId, sizeCode: `R-${diametro}`, diameterInches: diametro }))));
  return compileProductPrompt({
    sceneSpec: caso.escena,
    visualContext: CONTEXTO_CUMPLE,
    vocabulary: PRODUCT_VOCABULARY,
    sizeConfirmations: tallas,
    trigger,
    maxLength,
    officialStructures: new Map([[caso.escena.elements[0]!.element_id, caso.nombre === "arco-patron" ? "arco" : "guirnalda"]]),
    colorPatterns: caso.frases,
  });
}
