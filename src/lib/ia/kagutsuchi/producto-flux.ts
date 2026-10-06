import type { SceneElement, SceneSpec } from "../escena/scene-spec";
import type { VisualContext } from "../escena/visual-context";
import { compileFluxCaption, translateFluxColor, type FluxVisualClause, type ProductConceptClauseInput } from "./caption-flux";
import { canonicalizeSku } from "@/lib/rag/catalog/canonicalize";
import { colorDeReferencia, leerTituloCatalogo, terminosBaseDeTitulo } from "./vocabulario-base";
import { referenciaDelTitulo } from "@/lib/plan/referencia-sempertex";
import type { FraseDeEstructura } from "../uzume/mezcla-color-escena";

export const FLUX_PRODUCT_RUNTIME_VERSION = "flux-product-runtime.v2" as const;

export type UnresolvedProductReason = "unknown" | "ambiguous" | "invalid";
export type UnresolvedProduct = { product_id?: string; title?: string; reason: UnresolvedProductReason };
export type TallaOmitida = { element_id: string; concept_id: string; size_codes: string[] };
export type ElementSizeConfirmation = {
  elementId: string;
  productId: string;
  sizeCode: string;
  diameterInches?: number;
};
export type ProductPromptRuntimeResult = {
  prompt: string;
  resolved_concepts: string[];
  unresolved_products: UnresolvedProduct[];
  dropped_sizes: TallaOmitida[];
  vocabulary_version: string;
  compiler_version: string;
  legacy: boolean;
  legacyReason?: string;
  captionCompilerVersion: string;
  clauses: FluxVisualClause[];
  diagnostics: string[];
};

export function aliasesDeProducto(producto: { id: string; catalogSku?: string; familiaId?: string }): string[] {
  const canonico = producto.catalogSku ? canonicalizeSku(producto.catalogSku) : undefined;
  return [...new Set([producto.catalogSku, canonico, producto.familiaId])].filter((id): id is string => Boolean(id && id !== producto.id));
}

export function sizeConfirmationsFromMaterialLines(
  lines: ReadonlyArray<{ structure_id?: string; product_id?: string; variant_id?: string }>,
  products: ReadonlyArray<{ id: string; familiaId?: string; tamanoCodigo?: string; diamPulg?: number }>,
): ElementSizeConfirmation[] {
  return lines.flatMap((line) => {
    const elementId = line.structure_id;
    const selectedProductId = line.variant_id ?? line.product_id;
    if (!elementId || !selectedProductId) return [];
    const exact = products.find((candidate) => candidate.id === selectedProductId);
    const siblings = exact ? [] : products.filter((candidate) => candidate.familiaId === line.product_id || candidate.familiaId === selectedProductId);
    const product = exact ?? (new Set(siblings.map((candidate) => candidate.tamanoCodigo)).size === 1 ? siblings[0] : undefined);
    return product?.tamanoCodigo
      ? [{ elementId, productId: selectedProductId, sizeCode: product.tamanoCodigo, diameterInches: product.diamPulg }]
      : [];
  });
}

function elementProductIds(element: SceneElement): string[] {
  if (element.source_type !== "catalog_backed") return [];
  const ids = element.catalog_product_ids?.length ? element.catalog_product_ids : element.catalog_product_id ? [element.catalog_product_id] : [];
  return [...new Set(ids)];
}

function diameterFromSizeCode(sizeCode: string): number | undefined {
  const match = sizeCode.match(/(?:^|[-_\s])(\d+(?:\.\d+)?)\s*(?:inch|inches|in)?$/i);
  const diameter = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(diameter) && diameter > 0 ? diameter : undefined;
}

function renderSize(diameterInches: number | undefined, fallback: string): string {
  if (diameterInches === undefined) return fallback;
  const normalized = Number.isInteger(diameterInches) ? String(diameterInches) : String(Number(diameterInches.toFixed(2)));
  return `${normalized}-inch`;
}

function entradaCatalogo(
  element: SceneElement,
  productId: string,
  titulos: readonly string[],
  tallas: ReadonlyMap<string, ElementSizeConfirmation[]>,
): ProductConceptClauseInput | undefined {
  const productoUnico = elementProductIds(element).length === 1;
  for (const titulo of titulos) {
    const lectura = leerTituloCatalogo(titulo);
    if (!lectura) continue;
    const referencia = referenciaDelTitulo(titulo, lectura.acabado);
    const colorTitulo = referencia
      ? colorDeReferencia(referencia)
      : lectura.restoColor ? translateFluxColor(lectura.restoColor) : "";
    const color = colorTitulo && colorTitulo !== lectura.restoColor
      ? colorTitulo
      : productoUnico ? element.resolved_colors.map(translateFluxColor).join(" and ") : "";
    const terminos = terminosBaseDeTitulo(lectura, color);
    if (!terminos || terminos.kind !== "balloon") continue;
    const sizeCodes = (tallas.get(productId) ?? [])
      .filter(({ elementId }) => elementId === element.element_id || element.element_id.startsWith(`${elementId}#`))
      .map(({ sizeCode, diameterInches }) => renderSize(diameterInches ?? diameterFromSizeCode(sizeCode), sizeCode));
    return {
      elementId: element.element_id,
      conceptId: `catalog:${productId}`,
      canonicalLabel: `${terminos.finish} ${terminos.color} ${terminos.noun}`.trim(),
      sizeCodes: sizeCodes.length ? [...new Set(sizeCodes)] : undefined,
      colorName: terminos.color,
      baseTerms: terminos,
    };
  }
  return undefined;
}

export function compileProductPrompt(input: {
  sceneSpec: SceneSpec;
  visualContext: VisualContext;
  sizeConfirmations?: ElementSizeConfirmation[];
  productIdAliases?: ReadonlyMap<string, string | readonly string[]>;
  productCatalogTitles?: ReadonlyMap<string, string | readonly string[]>;
  maxLength?: number;
  ambientDecor?: readonly string[];
  officialStructures?: ReadonlyMap<string, string>;
  creativeCues?: readonly string[];
  colorPatterns?: readonly FraseDeEstructura[];
}): ProductPromptRuntimeResult {
  const tallas = new Map<string, ElementSizeConfirmation[]>();
  for (const confirmacion of input.sizeConfirmations ?? []) {
    const lista = tallas.get(confirmacion.productId) ?? [];
    lista.push(confirmacion);
    tallas.set(confirmacion.productId, lista);
  }
  const entradas: ProductConceptClauseInput[] = [];
  const unresolved: UnresolvedProduct[] = [];
  const diagnosticos: string[] = [];
  for (const elemento of input.sceneSpec.elements) {
    for (const productoId of elementProductIds(elemento)) {
      const alias = input.productIdAliases?.get(productoId);
      const aliasIds = alias === undefined ? [] : Array.isArray(alias) ? alias : [alias];
      const titulos = [productoId, ...aliasIds].flatMap((id) => {
        const valor = input.productCatalogTitles?.get(id);
        return valor === undefined ? [] : Array.isArray(valor) ? valor : [valor];
      });
      const entrada = entradaCatalogo(elemento, productoId, titulos, tallas);
      if (entrada) entradas.push(entrada);
      else {
        unresolved.push({ product_id: productoId, reason: "unknown" });
        diagnosticos.push(`elemento ${elemento.element_id}: producto ${productoId} no tiene título de catálogo descriptible; se omite del caption`);
      }
    }
  }
  const compilacion = compileFluxCaption({
    sceneSpec: input.sceneSpec,
    visualContext: input.visualContext,
    productConcepts: entradas,
    maxLength: input.maxLength,
    ambientDecor: input.ambientDecor,
    officialStructures: input.officialStructures,
    creativeCues: input.creativeCues,
    colorPatterns: input.colorPatterns,
  });
  if (compilacion.palabrasQuitadas.length) diagnosticos.push(`palabras comerciales quitadas: ${compilacion.palabrasQuitadas.join(", ")}`);
  if (compilacion.compactionStep > 0) diagnosticos.push(`caption compactado al paso ${compilacion.compactionStep}; conserva estructuras, ubicaciones, relaciones y colores`);
  const legacy = entradas.length === 0 || !compilacion.usedCatalogProducts;
  if (legacy) diagnosticos.push("ningún producto pudo describirse desde título de catálogo; se usan colores y acabados del plan");
  return {
    prompt: compilacion.prompt,
    resolved_concepts: entradas.map(({ conceptId }) => conceptId).sort(),
    unresolved_products: unresolved,
    dropped_sizes: [],
    vocabulary_version: "catalog-title",
    compiler_version: FLUX_PRODUCT_RUNTIME_VERSION,
    legacy,
    legacyReason: legacy ? "no product could be described from its catalog title" : undefined,
    captionCompilerVersion: compilacion.compilerVersion,
    clauses: compilacion.clauses,
    diagnostics: diagnosticos,
  };
}
