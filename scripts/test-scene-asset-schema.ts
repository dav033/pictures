import assert from "node:assert/strict";
import type { CatalogProduct } from "../src/lib/rag/catalog/schemas";
import { adaptCatalogProductV2ToV3 } from "../src/lib/rag/sources/provenance";
import { CatalogItemV3Schema, CommercialOfferV1Schema, SupplyBindingSchema } from "../src/lib/rag/catalog/scene-asset-schema";

// ---------------------------------------------------------------------------
// Mini test runner casero (mismo estilo que scripts/test-scene-invariants.ts):
// sin dependencias externas, sin PostgreSQL. Cada test corre aislado; una
// falla no aborta el resto. Sale con process.exit(1) si algo falló.
// ---------------------------------------------------------------------------

let passCount = 0;
let failCount = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passCount += 1;
    console.log(`[PASS] ${name}`);
  } catch (error) {
    failCount += 1;
    console.error(`[FAIL] ${name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

// ---------------------------------------------------------------------------
// Fixtures mínimos, con la forma real de `CatalogProduct` (V2) tal como sale
// de `normalize.ts` — globo, cortina y vela, las tres familias que el plan
// exige poder adaptar sin pérdida (Tarea 02.2, "Terminado cuando...").
// ---------------------------------------------------------------------------

function catalogProductFixture(overrides: Partial<CatalogProduct>): CatalogProduct {
  return {
    product_id: "prod-base",
    handle: "producto-base",
    title: "Producto base",
    description_text: null,
    vendor: null,
    product_type: null,
    tags: [],
    image_urls: [],
    status: "ACTIVE",
    available: true,
    price_min: 1000,
    price_max: 1000,
    derived: { category: null, colors: [], occasions: [] },
    source_payload: {},
    search_text: "producto base",
    embedding_source_hash: "hash",
    source_updated_at: null,
    ...overrides,
  };
}

const GLOBO_LATEX_FIXTURE = catalogProductFixture({
  product_id: "prod-globo-latex-r12-dorado",
  handle: "globo-latex-r12-dorado",
  title: "Globo Latex R12 Dorado",
  product_type: "LATEX",
  tags: ["globo", "latex", "dorado", "cumpleanos"],
  image_urls: ["https://cdn.example.com/globo-r12-dorado.jpg"],
  derived: { category: "globo_latex", colors: ["dorado"], occasions: ["cumpleanos"] },
});

const ARCO_GUIRNALDA_FIXTURE = catalogProductFixture({
  product_id: "prod-guirnalda-arco-organico-blanco",
  handle: "guirnalda-arco-organico-blanco",
  title: "Kit Arco Orgánico Blanco y Dorado",
  product_type: "DECOR-KIT",
  tags: ["arco", "guirnalda", "boda", "blanco", "dorado"],
  image_urls: ["https://cdn.example.com/arco-blanco-dorado.jpg", "https://cdn.example.com/arco-blanco-dorado-detalle.jpg"],
  derived: { category: "guirnalda_arco", colors: ["blanco", "dorado"], occasions: ["boda"] },
});

const CORTINA_FIXTURE = catalogProductFixture({
  product_id: "prod-cortina-metalica-dorada",
  handle: "cortina-metalica-dorada",
  title: "Cortina Metálica Dorada para Backdrop",
  product_type: "COMPLEMENTO",
  tags: ["cortina", "backdrop", "dorado"],
  image_urls: ["https://cdn.example.com/cortina-dorada.jpg"],
  derived: { category: "complemento", colors: ["dorado"], occasions: [] },
});

const VELA_FIXTURE = catalogProductFixture({
  product_id: "prod-vela-taper-blanca",
  handle: "vela-taper-blanca",
  title: "Vela Taper Blanca 25cm",
  product_type: "VELA",
  tags: ["vela", "blanco", "decoracion"],
  image_urls: ["https://cdn.example.com/vela-taper-blanca.jpg"],
  derived: { category: "vela", colors: ["blanco"], occasions: [] },
});

const DESECHABLE_SIN_SENAL_FIXTURE = catalogProductFixture({
  product_id: "prod-vaso-desechable-transparente",
  handle: "vaso-desechable-transparente",
  title: "Vaso Desechable Transparente x50",
  product_type: "DESECHABLE",
  tags: ["desechable", "transparente"],
  image_urls: [],
  derived: { category: "desechable", colors: ["transparente"], occasions: [] },
});

// ---------------------------------------------------------------------------
// (a) Globos, cortinas y velas del catálogo se adaptan sin lanzar error.
// ---------------------------------------------------------------------------

test("(a) globo_latex se adapta sin error y con categoría balloon_material", () => {
  const result = adaptCatalogProductV2ToV3(GLOBO_LATEX_FIXTURE);
  assert.equal(result.item.category_v3, "balloon_material");
  assert.ok(result.confidence > 0 && result.confidence <= 1);
  assert.ok(result.evidence.length > 0);
  // No debe inventar una función de alta confianza sin evidencia: el globo
  // básico solo debería activar balloon_accent con confianza moderada.
  assert.ok(result.item.scene_functions.every((fn) => fn.confidence <= 0.7));
});

test("(a) guirnalda_arco (kit arco orgánico) se adapta sin error y con categoría balloon_structure", () => {
  const result = adaptCatalogProductV2ToV3(ARCO_GUIRNALDA_FIXTURE);
  assert.equal(result.item.category_v3, "balloon_structure");
  const functionIds = result.item.scene_functions.map((fn) => fn.function);
  assert.ok(functionIds.includes("altar_frame"), "debe candidatear altar_frame (arco genérico, confianza baja/media)");
  const altarCandidate = result.item.scene_functions.find((fn) => fn.function === "altar_frame")!;
  assert.ok(altarCandidate.confidence < 0.6, "altar_frame en un arco genérico no debe reportarse con alta confianza");
  assert.equal(result.item.media_refs.length, 2);
  assert.equal(result.item.media_refs[0].role, "identity");
  assert.equal(result.item.media_refs[1].role, "detail");
});

test("(a) cortina se adapta sin error y con categoría backdrop_surface + función focal_backdrop", () => {
  const result = adaptCatalogProductV2ToV3(CORTINA_FIXTURE);
  assert.equal(result.item.category_v3, "backdrop_surface");
  const functionIds = result.item.scene_functions.map((fn) => fn.function);
  assert.ok(functionIds.includes("focal_backdrop"));
});

test("(a) vela se adapta sin error y con categoría ambient_lighting + función ambient_light de baja/media confianza", () => {
  const result = adaptCatalogProductV2ToV3(VELA_FIXTURE);
  assert.equal(result.item.category_v3, "ambient_lighting");
  const ambientCandidate = result.item.scene_functions.find((fn) => fn.function === "ambient_light");
  assert.ok(ambientCandidate, "debe candidatear ambient_light");
  assert.ok(ambientCandidate!.confidence <= 0.6, "vela sin más contexto no debe reportar alta confianza de función");
});

test("(a) producto sin señal textual reconocible (desechable) cae a categoría de reserva de baja confianza, nunca inventa función", () => {
  const result = adaptCatalogProductV2ToV3(DESECHABLE_SIN_SENAL_FIXTURE);
  assert.equal(result.item.category_v3, "table_setting");
  assert.equal(result.item.scene_functions.length, 0, "sin evidencia textual de función específica, no debe inventar ninguna");
  assert.ok(result.confidence <= 0.4, "categoría de baja confianza para señal ambigua");
});

// ---------------------------------------------------------------------------
// (b) Un CatalogItemV3 con función focal_backdrop en una cortina valida OK.
// ---------------------------------------------------------------------------

test("(b) CatalogItemV3 de ejemplo (cortina, función focal_backdrop) valida correctamente", () => {
  const parsed = CatalogItemV3Schema.parse({
    item_id: "item-cortina-dorada-001",
    category_v3: "backdrop_surface",
    media_refs: [{ id: "media-1", role: "identity", source_url_hash: "abc123" }],
    scene_functions: [{ function: "focal_backdrop", confidence: 0.6, evidence: "título contiene 'cortina'" }],
    compatibility: { indoor_outdoor: ["indoor", "outdoor"] },
  });
  assert.equal(parsed.category_v3, "backdrop_surface");
  assert.equal(parsed.scene_functions[0]?.function, "focal_backdrop");
});

// ---------------------------------------------------------------------------
// (c) SupplyBinding context_non_quotable con context_kind inválido ("chair")
//     debe ser RECHAZADO por Zod.
// ---------------------------------------------------------------------------

test("(c) SupplyBinding context_non_quotable con context_kind:'chair' es rechazado", () => {
  const result = SupplyBindingSchema.safeParse({ kind: "context_non_quotable", context_kind: "chair" });
  assert.equal(result.success, false, "un context_kind fuera de la lista cerrada debe fallar la validación");
});

test("(c) SupplyBinding context_non_quotable con context_kind válido ('wall') es aceptado", () => {
  const result = SupplyBindingSchema.safeParse({ kind: "context_non_quotable", context_kind: "wall" });
  assert.equal(result.success, true);
});

test("(c) SupplyBinding context_non_quotable rechaza campos de oferta comercial (offer_id) por forma cerrada", () => {
  const result = SupplyBindingSchema.safeParse({ kind: "context_non_quotable", context_kind: "wall", offer_id: "OFR-1" });
  assert.equal(result.success, false, "context_non_quotable no puede llevar offer_id: la forma es cerrada (.strict())");
});

// ---------------------------------------------------------------------------
// (d) CommercialOfferV1 con status PRICED pero sin price_components debe ser
//     RECHAZADO.
// ---------------------------------------------------------------------------

const baseOffer = {
  offer_id: "OFR-TEST-0001",
  item_id: "item-cortina-dorada-001",
  source_ref: { source_id: "postgres-catalog", snapshot_id: "snapshot-2026-08-22", verified_at: "2026-08-22T00:00:00.000Z" },
  source_class: "catalog_sale" as const,
  availability: { status: "available" as const, checked_at: "2026-08-22T00:00:00.000Z" },
};

test("(d) CommercialOfferV1 PRICED sin price_components es rechazado", () => {
  const result = CommercialOfferV1Schema.safeParse({ ...baseOffer, status: "PRICED", price_components: [] });
  assert.equal(result.success, false, "PRICED sin ningún price_component debe fallar");
});

test("(d) CommercialOfferV1 PRICED con solo un service_fee (sin unit_sale/package_sale) es rechazado", () => {
  const result = CommercialOfferV1Schema.safeParse({
    ...baseOffer,
    status: "PRICED",
    price_components: [{ type: "service_fee", amount_cop: 20000, service_fee_kind: "transport" }],
  });
  assert.equal(result.success, false, "un cargo de servicio solo no cubre la modalidad de venta");
});

test("(d) CommercialOfferV1 PRICED con unit_sale válido es aceptado", () => {
  const result = CommercialOfferV1Schema.safeParse({
    ...baseOffer,
    status: "PRICED",
    price_components: [{ type: "unit_sale", amount_cop: 45000 }],
  });
  assert.equal(result.success, true);
});

test("(d) CommercialOfferV1 catalog_rental PRICED requiere rental_period, no basta unit_sale", () => {
  const result = CommercialOfferV1Schema.safeParse({
    ...baseOffer,
    source_class: "catalog_rental",
    status: "PRICED",
    price_components: [{ type: "unit_sale", amount_cop: 45000 }],
  });
  assert.equal(result.success, false, "un alquiler PRICED necesita al menos un rental_period");
});

test("(d) CommercialOfferV1 QUOTE_REQUIRED sin price_components es aceptado (no exige precio)", () => {
  const result = CommercialOfferV1Schema.safeParse({ ...baseOffer, status: "QUOTE_REQUIRED", price_components: [] });
  assert.equal(result.success, true);
});

// ---------------------------------------------------------------------------
// Alineación NonCommercialReferenceClass — sanity check en runtime además de
// la comprobación de tipo en scene-asset-schema.ts.
// ---------------------------------------------------------------------------

test("NonCommercialReferenceClassSchema acepta exactamente 'editorial_reference' y 'test_only'", async () => {
  const { NonCommercialReferenceClassSchema } = await import("../src/lib/rag/catalog/scene-asset-schema");
  assert.equal(NonCommercialReferenceClassSchema.safeParse("editorial_reference").success, true);
  assert.equal(NonCommercialReferenceClassSchema.safeParse("test_only").success, true);
  assert.equal(NonCommercialReferenceClassSchema.safeParse("something_else").success, false);
});

// ---------------------------------------------------------------------------
// SupplyBinding sale/rental — casos positivos rápidos, para no validar solo
// el camino de rechazo.
// ---------------------------------------------------------------------------

test("SupplyBinding sale válido es aceptado", () => {
  const result = SupplyBindingSchema.safeParse({
    kind: "sale",
    item_id: "item-1",
    offer_id: "OFR-1",
    snapshot_id: "snap-1",
  });
  assert.equal(result.success, true);
});

test("SupplyBinding rental sin 'periods' es rechazado (campo obligatorio del variant)", () => {
  const result = SupplyBindingSchema.safeParse({
    kind: "rental",
    item_id: "item-1",
    offer_id: "OFR-1",
    snapshot_id: "snap-1",
  });
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------

console.log(`\n${passCount} pasaron, ${failCount} fallaron.`);
if (failCount > 0) {
  process.exit(1);
}
