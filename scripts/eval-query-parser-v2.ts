import { performance } from "node:perf_hooks";
import {
  clasificarTaxonomia,
  clasificarTamanos,
  TAXONOMY_VERSION,
  type TaxonomyStatus,
} from "@/lib/rag/taxonomy/v2";
import { interpretarConsulta, interpretarConsultaLocal } from "@/lib/rag/query-parser/parse";
import { IntentQuerySchema, type IntentQuery } from "@/lib/rag/query-parser/schema";
import { canonicalizeCatalog } from "@/lib/rag/catalog/canonicalize";
import { ProductsCatalogSourceSchema, type ProductsCatalogSource } from "@/lib/rag/sources/contracts";
import fixtureJson from "../eval/fixtures/products_catalog.fixture.json";

type Expected = Partial<{
  intent: IntentQuery["intent"];
  categorias: string[];
  ocasiones: string[];
  colores: string[];
  formas: string[];
  diametros_pulgadas: number[];
  precio_max: number | null;
  solo_disponibles: boolean;
}>;

type Case = {
  id: string;
  phrase: string;
  expected?: Expected;
};

const cases: Case[] = [
  { id: "sku-01", phrase: "Necesito el producto SKU-DEMO-001", expected: { intent: "product_search" } },
  { id: "name-02", phrase: "Busco un globo cromado para una mesa", expected: { intent: "product_search" } },
  { id: "color-03", phrase: "Globos dorados", expected: { colores: ["dorado"] } },
  { id: "color-04", phrase: "Globos plateados", expected: { colores: ["plateado"] } },
  { id: "color-05", phrase: "Decoración azul rey", expected: { colores: ["azul"] } },
  { id: "color-06", phrase: "Globos rosa y negro", expected: { colores: ["rosado", "negro"] } },
  { id: "color-07", phrase: "Globos lila y turquesa", expected: { colores: ["lila", "turquesa"] } },
  { id: "color-08", phrase: "Globos beige", expected: { colores: ["beige"] } },
  { id: "color-09", phrase: "Globos café chocolate", expected: { colores: ["cafe"] } },
  { id: "color-10", phrase: "Globos champagne", expected: { colores: ["champagne"] } },
  { id: "color-11", phrase: "Globos morados", expected: { colores: ["morado"] } },
  { id: "color-12", phrase: "Globos fucsia", expected: { colores: ["fucsia"] } },
  { id: "color-13", phrase: "Globos transparentes", expected: { colores: ["transparente"] } },
  { id: "color-14", phrase: "Globos dorado rosa", expected: { colores: ["dorado rosa"] } },
  { id: "color-15", phrase: "Globos dorado rosa y negro", expected: { colores: ["dorado rosa", "negro"] } },
  { id: "color-16", phrase: "Globos dorado o negro", expected: { colores: [] } },
  { id: "color-17", phrase: "Globos rojos y verdes", expected: { colores: ["rojo", "verde"] } },
  { id: "color-17b", phrase: "Globos color vino", expected: { colores: ["burdeos"] } },
  { id: "color-17c", phrase: "Bolsa para vino", expected: { colores: [] } },
  { id: "color-17d", phrase: "Caja de regalo vino", expected: { colores: [] } },
  { id: "color-17e", phrase: "Globos arena", expected: { colores: ["beige"] } },
  { id: "finish-18", phrase: "Globos metalizados para decorar", expected: { categorias: ["globo_metalizado"] } },
  { id: "finish-19", phrase: "Globos mate", expected: { intent: "product_search" } },
  { id: "finish-20", phrase: "Globos reflex", expected: { intent: "product_search" } },
  { id: "finish-21", phrase: "Globos perlados", expected: { intent: "product_search" } },
  { id: "pattern-22", phrase: "Globos impresos de lunares", expected: { intent: "product_search" } },
  { id: "pattern-23", phrase: "Globos con rayas", expected: { intent: "product_search" } },
  { id: "pattern-24", phrase: "Globos con diseño chevron", expected: { intent: "product_search" } },
  { id: "pattern-25", phrase: "Globos de triángulos", expected: { intent: "product_search" } },
  { id: "pattern-26", phrase: "Globos de personajes Jurassic", expected: { intent: "product_search" } },
  { id: "category-27", phrase: "Globos de látex", expected: { categorias: ["globo_latex"] } },
  { id: "category-28", phrase: "Globos metalizados", expected: { categorias: ["globo_metalizado"] } },
  { id: "category-29", phrase: "Quiero globos número", expected: { categorias: ["globo_numero_letra"] } },
  { id: "category-30", phrase: "Necesito velas", expected: { categorias: ["vela"] } },
  { id: "category-31", phrase: "Un kit de fiesta", expected: { categorias: ["kit"] } },
  { id: "category-32", phrase: "Una guirnalda", expected: { categorias: ["guirnalda_arco"] } },
  { id: "category-33", phrase: "Un arco de globos", expected: { categorias: ["guirnalda_arco"] } },
  { id: "category-34", phrase: "Busco una banderola", expected: { categorias: ["banderola_cartel"] } },
  { id: "category-35", phrase: "Accesorios para fiesta", expected: { categorias: ["complemento"] } },
  { id: "category-36", phrase: "Bolsas de regalo", expected: { categorias: ["empaque"] } },
  { id: "category-37", phrase: "Platos desechables", expected: { categorias: ["desechable"] } },
  { id: "category-38", phrase: "Necesito globos", expected: { categorias: [] } },
  { id: "occasion-39", phrase: "Globos de cumpleaños", expected: { ocasiones: ["cumpleanos"] } },
  { id: "occasion-40", phrase: "Decoración para San Valentín", expected: { ocasiones: ["san_valentin"] } },
  { id: "occasion-41", phrase: "Globos de amor y amistad", expected: { ocasiones: ["san_valentin"] } },
  { id: "occasion-42", phrase: "Decoración para Día de mamá", expected: { ocasiones: ["dia_madre"] } },
  { id: "occasion-43", phrase: "Globos para Día del padre", expected: { ocasiones: ["dia_padre"] } },
  { id: "occasion-44", phrase: "Fiesta de navidad", expected: { ocasiones: ["navidad"] } },
  { id: "occasion-45", phrase: "Fiesta de Halloween", expected: { ocasiones: ["halloween"] } },
  { id: "occasion-46", phrase: "Decoración de graduación", expected: { ocasiones: ["graduacion"] } },
  { id: "occasion-47", phrase: "Globos para XV años", expected: { ocasiones: ["xv_anos"] } },
  { id: "occasion-48", phrase: "Decoración de boda", expected: { ocasiones: ["boda"] } },
  { id: "occasion-49", phrase: "Kit para baby shower", expected: { ocasiones: ["baby_shower"], categorias: ["kit"] } },
  { id: "shape-50", phrase: "Globos redondos", expected: { formas: ["redondo"] } },
  { id: "shape-51", phrase: "Globos de corazón", expected: { formas: ["corazon"] } },
  { id: "shape-52", phrase: "Globos link o loon", expected: { formas: ["link"] } },
  { id: "shape-53", phrase: "Globos para modelar figuras", expected: { formas: ["modelar"] } },
  { id: "shape-54", phrase: "Necesito un globo R-12", expected: { formas: ["redondo"], diametros_pulgadas: [12] } },
  { id: "shape-55", phrase: "Necesito un globo C-12", expected: { formas: ["corazon"], diametros_pulgadas: [] } },
  { id: "shape-56", phrase: "Necesito un LOL-660", expected: { formas: ["link"], diametros_pulgadas: [] } },
  { id: "shape-57", phrase: "Necesito un T-260", expected: { formas: ["modelar"], diametros_pulgadas: [] } },
  { id: "shape-57b", phrase: "Vaso con corazones pop", expected: { formas: [] } },
  { id: "shape-57c", phrase: "Platos con corazones", expected: { formas: [] } },
  { id: "shape-57d", phrase: "Servilletas con corazones", expected: { formas: [] } },
  { id: "shape-57e", phrase: "Globos con corazones", expected: { formas: ["corazon"] } },
  { id: "shape-57f", phrase: "Quiero una forma corazón", expected: { formas: ["corazon"] } },
  { id: "shape-57g", phrase: "Plato redondo", expected: { formas: [] } },
  { id: "shape-57h", phrase: "Quiero link o loon", expected: { formas: [] } },
  { id: "shape-57i", phrase: "Necesito modelar figuras", expected: { formas: [] } },
  { id: "size-58", phrase: "Globos de 5 pulgadas", expected: { diametros_pulgadas: [5] } },
  { id: "size-59", phrase: "Globos tamaño 9", expected: { diametros_pulgadas: [9] } },
  { id: "size-60", phrase: "Globos de 12 pulgadas", expected: { diametros_pulgadas: [12] } },
  { id: "size-61", phrase: "Globos R-18", expected: { diametros_pulgadas: [18], formas: ["redondo"] } },
  { id: "size-61b", phrase: "Globos R-40", expected: { diametros_pulgadas: [40], formas: ["redondo"] } },
  { id: "size-62", phrase: "Globos mini", expected: { diametros_pulgadas: [] } },
  { id: "size-63", phrase: "Globos medianos", expected: { diametros_pulgadas: [] } },
  { id: "size-64", phrase: "Globos grandes", expected: { diametros_pulgadas: [] } },
  { id: "size-65", phrase: "Globos jumbo", expected: { diametros_pulgadas: [] } },
  { id: "size-66", phrase: "Globos R-5 o R-12", expected: { diametros_pulgadas: [] } },
  { id: "size-66b", phrase: "Necesito 12 globos", expected: { diametros_pulgadas: [] } },
  { id: "price-67", phrase: "Globos hasta $100.000", expected: { precio_max: 100000 } },
  { id: "price-68", phrase: "Globos máximo 50 mil", expected: { precio_max: 50000 } },
  { id: "price-69", phrase: "Kit con presupuesto 75k", expected: { precio_max: 75000, categorias: ["kit"] } },
  { id: "price-70", phrase: "Globos por debajo de 120000", expected: { precio_max: 120000 } },
  { id: "availability-71", phrase: "Muéstrame productos agotados", expected: { solo_disponibles: false } },
  { id: "availability-72", phrase: "Solo productos disponibles", expected: { solo_disponibles: true } },
  { id: "preference-73", phrase: "Preferiría algo dorado", expected: { colores: [] } },
  { id: "preference-74", phrase: "Me gustaría una boda rosada", expected: { colores: [], ocasiones: [] } },
  { id: "preference-74b", phrase: "Preferiría globos de corazón", expected: { formas: [] } },
  { id: "hard-75", phrase: "Solo globos dorados", expected: { colores: ["dorado"] } },
  { id: "hard-76", phrase: "Únicamente globos metalizados", expected: { categorias: ["globo_metalizado"] } },
  { id: "other-77", phrase: "Hola", expected: { intent: "other" } },
  { id: "other-78", phrase: "¿Cuál es el horario?", expected: { intent: "other" } },
  { id: "other-79", phrase: "¿Hacen envíos?", expected: { intent: "other" } },
  { id: "other-80", phrase: "¿Qué precio tienen los kits?", expected: { categorias: ["kit"] } },
];

type TaxonomyCheck = {
  id: string;
  phrase: string;
  field: "colores" | "acabados" | "patrones" | "ocasiones" | "categorias" | "formas" | "tamanos";
  status: TaxonomyStatus;
  values: string[] | number[];
};

const taxonomyChecks: TaxonomyCheck[] = [
  { id: "tx-01", phrase: "dorado rosa", field: "colores", status: "known", values: ["dorado rosa"] },
  { id: "tx-02", phrase: "dorado o negro", field: "colores", status: "ambiguous", values: ["dorado", "negro"] },
  { id: "tx-03", phrase: "ultravioleta", field: "colores", status: "unknown", values: [] },
  { id: "tx-04", phrase: "metalizado", field: "acabados", status: "known", values: ["metalizado"] },
  { id: "tx-05", phrase: "estampado de lunares", field: "patrones", status: "known", values: ["impreso", "polka"] },
  { id: "tx-06", phrase: "forma corazón o forma redonda", field: "formas", status: "ambiguous", values: ["corazon", "redondo"] },
  { id: "tx-07", phrase: "arco", field: "categorias", status: "known", values: ["guirnalda_arco"] },
  { id: "tx-08", phrase: "globos", field: "categorias", status: "unknown", values: [] },
  { id: "tx-09", phrase: "navidad", field: "ocasiones", status: "known", values: ["navidad"] },
  { id: "tx-10", phrase: "R-12", field: "tamanos", status: "known", values: [12] },
  { id: "tx-11", phrase: "R-5 o R-12", field: "tamanos", status: "ambiguous", values: [5, 12] },
  { id: "tx-12", phrase: "metalizado", field: "formas", status: "unknown", values: [] },
  { id: "tx-13", phrase: "12 globos", field: "tamanos", status: "unknown", values: [] },
];

function sameValues(actual: readonly unknown[], expected: readonly unknown[]): boolean {
  return JSON.stringify([...actual].map(String).sort()) === JSON.stringify([...expected].map(String).sort());
}

function assertExpected(actual: IntentQuery, expected: Expected): string | null {
  const fields: Array<keyof Expected> = ["intent", "categorias", "ocasiones", "colores", "formas", "diametros_pulgadas", "precio_max", "solo_disponibles"];
  for (const field of fields) {
    if (!(field in expected)) continue;
    const expectedValue = expected[field];
    const actualValue = field === "intent" ? actual.intent : actual.filtros_duros[field];
    const ok = Array.isArray(expectedValue) && Array.isArray(actualValue)
      ? sameValues(actualValue, expectedValue)
      : actualValue === expectedValue;
    if (!ok) return `${field}: esperado ${JSON.stringify(expectedValue)}, recibido ${JSON.stringify(actualValue)}`;
  }
  return null;
}

function getTaxonomyValues(phrase: string, field: TaxonomyCheck["field"]): readonly unknown[] {
  if (field === "tamanos") return clasificarTamanos(phrase).values;
  return clasificarTaxonomia(phrase)[field].values;
}

function getTaxonomyStatus(phrase: string, field: TaxonomyCheck["field"]): TaxonomyStatus {
  if (field === "tamanos") return clasificarTamanos(phrase).status;
  return clasificarTaxonomia(phrase)[field].status;
}

function runCanonicalizationSmoke(): void {
  const source: ProductsCatalogSource = [{
    id: "gid://shopify/Product/fixture-taxonomy-v2",
    title: "Globo dorado rosa",
    handle: "fixture-taxonomy-v2",
    status: "ACTIVE",
    productType: "LÁTEX",
    vendor: "fixture",
    tags: ["DORADO ROSA", "R-12"],
    variants: [{
      id: "gid://shopify/ProductVariant/fixture-taxonomy-v2",
      sku: "SKU-FIXTURE-TAXONOMY-001",
      price: "1000",
      title: "R-12",
      availableForSale: true,
      inventoryQuantity: 4,
    }],
    images: [],
  }];
  const canonical = canonicalizeCatalog(source);
  const product = canonical.products[0];
  const variant = product?.variants[0];
  if (!product || !variant) throw new Error("canonicalization smoke produced no product");
  if (!sameValues(product.derived.colors, ["dorado rosa"])) throw new Error(`v2 color merge: ${JSON.stringify(product.derived.colors)}`);
  if (product.derived.category !== "globo_latex") throw new Error(`category: ${product.derived.category}`);
  if (variant.forma !== "redondo" || variant.diam_pulg !== 12) throw new Error(`size/shape: ${variant.forma}/${variant.diam_pulg}`);

  const fixture = canonicalizeCatalog(ProductsCatalogSourceSchema.parse(fixtureJson));
  const fixtureProduct = fixture.products.find((candidate) => candidate.handle === "fixture-globo-rojo");
  if (!fixtureProduct || !sameValues(fixtureProduct.derived.colors, ["rojo"])) throw new Error("source fixture did not use taxonomy v2");
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  if (args.has("--no-key") && args.has("--with-gemini")) throw new Error("Usa solo --no-key o --with-gemini");
  const taxonomyOnly = args.has("--taxonomy-only");
  const withGemini = args.has("--with-gemini");
  if (args.has("--no-key")) delete process.env.GEMINI_API_KEY;
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  const mode = withGemini ? "with-gemini" : "no-key";
  const repetitions = 3;

  runCanonicalizationSmoke();

  let taxonomyFailures = 0;
  for (const check of taxonomyChecks) {
    const status = getTaxonomyStatus(check.phrase, check.field);
    const values = getTaxonomyValues(check.phrase, check.field);
    if (status !== check.status || !sameValues(values, check.values)) {
      taxonomyFailures++;
      console.error(`[FAIL][taxonomy] ${check.id} ${check.field}: status=${status} values=${JSON.stringify(values)}`);
    }
  }
  if (taxonomyFailures > 0) throw new Error(`${taxonomyFailures} taxonomy checks failed`);
  if (taxonomyOnly) {
    console.log(`[PASS] taxonomy-only ${taxonomyChecks.length} checks; version=${TAXONOMY_VERSION}`);
    return;
  }

  const localLatencies: number[] = [];
  const localBaselines = new Map<string, string>();
  let failures = 0;
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    for (const testCase of cases) {
      try {
        const start = performance.now();
        const local = interpretarConsultaLocal(testCase.phrase);
        localLatencies.push(performance.now() - start);
        const localJson = JSON.stringify(local.intent);
        const baseline = localBaselines.get(testCase.id);
        if (baseline && baseline !== localJson) {
          failures++;
          console.error(`[FAIL][unstable] ${testCase.id} repetition=${repetition}`);
        }
        localBaselines.set(testCase.id, localJson);

        const actual = await interpretarConsulta(testCase.phrase);
        const mismatch = assertExpected(actual, testCase.expected ?? {});
        if (mismatch) {
          failures++;
          console.error(`[FAIL] ${testCase.id} repetition=${repetition}: ${mismatch}`);
        }
        if (!IntentQuerySchemaSafe(actual)) {
          failures++;
          console.error(`[FAIL][schema] ${testCase.id} repetition=${repetition}`);
        }
        if (withGemini && hasKey) {
          const lockedMismatch = assertLockedFields(actual, local);
          if (lockedMismatch) {
            failures++;
            console.error(`[FAIL][locked] ${testCase.id}: ${lockedMismatch}`);
          }
        }
      } catch (error) {
        failures++;
        console.error(`[FAIL][error] ${testCase.id} repetition=${repetition}: ${String(error)}`);
      }
    }
  }

  localLatencies.sort((a, b) => a - b);
  const p50 = localLatencies[Math.floor(localLatencies.length / 2)] ?? 0;
  const optional = withGemini && !hasKey;
  if (optional) console.log("[SKIPPED_OPTIONAL] Gemini: GEMINI_API_KEY no configurada; matriz local ejecutada.");
  console.log(`[${failures === 0 ? "PASS" : "FAIL"}] mode=${mode} cases=${cases.length} repetitions=${repetitions} local_p50_ms=${p50.toFixed(2)} taxonomy=${TAXONOMY_VERSION}`);
  if (p50 > 50) {
    failures++;
    console.error(`[FAIL][latency] local parser p50 ${p50.toFixed(2)}ms > 50ms`);
  }
  if (failures > 0) process.exitCode = 1;
}

function IntentQuerySchemaSafe(value: IntentQuery): boolean {
  return IntentQuerySchema.safeParse(value).success;
}

function assertLockedFields(actual: IntentQuery, local: ReturnType<typeof interpretarConsultaLocal>): string | null {
  const remote = actual.filtros_duros;
  const deterministic = local.intent.filtros_duros;
  for (const field of local.lockedFields) {
    const left = remote[field];
    const right = deterministic[field];
    if (Array.isArray(left) && Array.isArray(right) ? !sameValues(left, right) : left !== right) {
      return `${field} cambió de ${JSON.stringify(right)} a ${JSON.stringify(left)}`;
    }
  }
  return null;
}

void main().catch((error) => {
  console.error(`[FAIL][fatal] ${String(error)}`);
  process.exitCode = 1;
});
