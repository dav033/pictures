import { z } from "zod";

/**
 * Contratos de las dos descargas CDN auditadas. Son deliberadamente distintos
 * de `ProductoPublico` (REST Shopify): el CDN es una respuesta GraphQL
 * camelCase y sus IDs son GID/string. Estos schemas solo validan la frontera;
 * la canonización y las políticas de publicación viven en otra capa.
 */

const NumericStringSchema = z.string().regex(/^-?(?:\d+\.?\d*|\.\d+)$/, "numeric string");

export const CatalogImageSourceSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  altText: z.string().nullable().optional(),
});

export const CatalogVariantSourceSchema = z.object({
  id: z.string().min(1),
  sku: z.string().nullable().optional(),
  price: NumericStringSchema,
  compareAtPrice: NumericStringSchema.nullable().optional(),
  title: z.string().min(1),
  availableForSale: z.boolean(),
  inventoryQuantity: z.number().int().nullable().optional(),
  barcode: z.string().nullable().optional(),
});

export const CatalogProductSourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  handle: z.string().min(1),
  status: z.string().min(1),
  productType: z.string().nullable().optional(),
  vendor: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().datetime({ offset: true }).nullable().optional(),
  updatedAt: z.string().datetime({ offset: true }).nullable().optional(),
  variants: z.array(CatalogVariantSourceSchema).min(1),
  images: z.array(CatalogImageSourceSchema).default([]),
});

export const ProductsCatalogSourceSchema = z.array(CatalogProductSourceSchema);

export const OrderMoneySourceSchema = z.object({
  amount: NumericStringSchema,
  currencyCode: z.string().min(1),
});

export const OrderLineVariantSourceSchema = z.object({
  id: z.string().min(1),
  sku: z.string().nullable().optional(),
  product: z.object({ id: z.string().min(1) }).nullable().optional(),
});

export const OrderLineItemSourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  quantity: z.number().int().positive(),
  variant: OrderLineVariantSourceSchema.nullable().optional(),
});

export const OrderSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  displayFinancialStatus: z.string().min(1),
  displayFulfillmentStatus: z.string().min(1),
  totalPriceSet: z.object({ shopMoney: OrderMoneySourceSchema }),
  customer: z.object({ id: z.string().min(1) }).nullable().optional(),
  lineItems: z.object({
    edges: z.array(z.object({ node: OrderLineItemSourceSchema })),
  }),
});

export const OrderDataSourceSchema = z.object({
  data: z.object({
    orders: z.object({
      edges: z.array(z.object({ node: OrderSourceSchema })),
    }),
  }),
  extensions: z.unknown().optional(),
});

export type CatalogImageSource = z.infer<typeof CatalogImageSourceSchema>;
export type CatalogVariantSource = z.infer<typeof CatalogVariantSourceSchema>;
export type CatalogProductSource = z.infer<typeof CatalogProductSourceSchema>;
export type ProductsCatalogSource = z.infer<typeof ProductsCatalogSourceSchema>;
export type OrderSource = z.infer<typeof OrderSourceSchema>;
export type OrderDataSource = z.infer<typeof OrderDataSourceSchema>;

export type SourceKind = "products_catalog" | "order_data";

export type SourceValidationCounts = {
  products?: number;
  variants?: number;
  activeProducts?: number;
  draftProducts?: number;
  nonPositivePriceVariants?: number;
  orders?: number;
  lineItems?: number;
  uniqueOrderSkus?: number;
};

/**
 * Solo devuelve agregados seguros para un manifest persistible. En particular,
 * no conserva IDs de producto, orden, línea, variante ni cliente.
 */
export function summarizeSource(kind: SourceKind, source: ProductsCatalogSource | OrderDataSource): SourceValidationCounts {
  if (kind === "products_catalog") {
    const products = source as ProductsCatalogSource;
    const variants = products.flatMap((product) => product.variants);
    return {
      products: products.length,
      variants: variants.length,
      activeProducts: products.filter((product) => product.status === "ACTIVE").length,
      draftProducts: products.filter((product) => product.status === "DRAFT").length,
      nonPositivePriceVariants: variants.filter((variant) => Number(variant.price) <= 0).length,
    };
  }

  const orders = (source as OrderDataSource).data.orders.edges.map((edge) => edge.node);
  const lines = orders.flatMap((order) => order.lineItems.edges.map((edge) => edge.node));
  const skus = new Set(lines.map((line) => line.variant?.sku).filter((sku): sku is string => Boolean(sku)));
  return { orders: orders.length, lineItems: lines.length, uniqueOrderSkus: skus.size };
}

/**
 * Valida que un objeto persistible no contenga claves de identidad de órdenes
 * o clientes. Se usa sobre manifests/resultados, nunca sobre el RAW completo.
 */
export function contieneIdentidadSensible(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(contieneIdentidadSensible);
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value)) {
    if (/^(customer|order|lineItem|variant|product)?Id$/i.test(key) || /^(customer|order|lineItem|variant|product)_?id$/i.test(key)) return true;
    if (contieneIdentidadSensible(child)) return true;
  }
  return false;
}
