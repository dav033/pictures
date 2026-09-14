import type { ProductoCandidato } from "./buscar";

/**
 * Wire shape shared by the Python catalog search and recommendations results
 * (`catalog-search-result.v1`, `catalog-recommendations-result.v1`). The search
 * candidate also carries a `score`, which is not part of the UI candidate.
 */
export type CandidatoPython = {
  product_id: string;
  title: string;
  category: string | null;
  colors: string[];
  finishes: string[];
  occasions: string[];
  available: boolean;
  image: string | null;
  variants: ReadonlyArray<{
    variant_id: string;
    sku: string | null;
    title: string | null;
    price: number;
    available: boolean;
    size_code: string | null;
    diameter_inches: number | null;
    shape: string | null;
    colors: string[];
  }>;
};

/** Single mapping from a Python-authorized candidate to the Next UI candidate. */
export function candidatoDesdePython(candidate: CandidatoPython): ProductoCandidato {
  return {
    productId: candidate.product_id,
    titulo: candidate.title,
    categoria: candidate.category,
    colores: candidate.colors,
    acabados: candidate.finishes,
    ocasiones: candidate.occasions,
    disponible: candidate.available,
    imagen: candidate.image,
    variantes: candidate.variants.map((variant) => ({
      variantId: variant.variant_id,
      sku: variant.sku,
      titulo: variant.title,
      precio: variant.price,
      disponible: variant.available,
      codigoTamano: variant.size_code,
      diamPulg: variant.diameter_inches,
      forma: variant.shape,
      colores: variant.colors,
    })),
  };
}
