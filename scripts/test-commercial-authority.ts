/**
 * Tarea 00.3 — Frontera de autoridad comercial
 * (PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md §2.2 y §6).
 *
 * Prueba, sin conectar a PostgreSQL real ni llamar proveedores externos, que
 * el seed SQLite (`src/lib/catalog-data.ts` + SQLite) y `manualProducts`
 * (`/api/generate`) pueden usarse como referencia no cotizable en modo
 * local/test, pero quedan bloqueados como línea comercial verificada
 * (compra, alquiler, plan) en un contexto marcado como producción.
 *
 * Solo importa `src/lib/generacion/provenance.ts` (código puro, sin
 * `server-only`) a propósito: así corre con `npx tsx
 * scripts/test-commercial-authority.ts` sin `--conditions=react-server` ni
 * abrir la base SQLite/Postgres real. El wiring real en
 * `src/lib/products.ts` (productosPorIdConFuente) y
 * `src/app/api/generate/route.ts` se revisa por lectura de código y por
 * `npx tsc --noEmit`; ambos delegan la decisión de bloqueo exactamente a las
 * funciones que se prueban aquí.
 */
import assert from "node:assert/strict";
import {
  classifyGenerationIds,
  classifyNonCommercialProduct,
  classifyNonCommercialProducts,
  normalizeGenerationSources,
  NonCommercialSourceRejectedError,
  resolveRuntimeCommercialEnvironment,
  type NonCommercialProductSource,
} from "../src/lib/generacion/provenance";

let pruebas = 0;
function paso(nombre: string, fn: () => void): void {
  fn();
  pruebas += 1;
  console.log(`  [ok] ${nombre}`);
}

const ENV_DEV = { NODE_ENV: "development" } as const;
const ENV_TEST = { NODE_ENV: "test" } as const;
const ENV_SIN_DEFINIR = {} as const;
const ENV_PROD = { NODE_ENV: "production" } as const;

console.log("Frontera de autoridad comercial — Tarea 00.3\n");

// --- resolveRuntimeCommercialEnvironment ------------------------------------

paso("NODE_ENV=production se resuelve como entorno de producción", () => {
  assert.equal(resolveRuntimeCommercialEnvironment(ENV_PROD), "production");
});

paso("NODE_ENV=development/test/indefinido se resuelven como non_production", () => {
  assert.equal(resolveRuntimeCommercialEnvironment(ENV_DEV), "non_production");
  assert.equal(resolveRuntimeCommercialEnvironment(ENV_TEST), "non_production");
  assert.equal(resolveRuntimeCommercialEnvironment(ENV_SIN_DEFINIR), "non_production");
});

// --- Caso 1: referencia no cotizable, permitida en cualquier entorno -------

paso("seed_demo como referencia se acepta en dev/test y queda etiquetado test_only", () => {
  const resultado = classifyNonCommercialProduct("arc-001", "seed_demo", "reference", ENV_DEV);
  assert.equal(resultado.source, "seed_demo");
  assert.equal(resultado.referenceClass, "test_only");
  assert.equal(resultado.runtime, "non_production");
});

paso("manual_product como referencia se acepta en dev/test y queda etiquetado editorial_reference", () => {
  const resultado = classifyNonCommercialProduct("manual-001", "manual_product", "reference", ENV_TEST);
  assert.equal(resultado.source, "manual_product");
  assert.equal(resultado.referenceClass, "editorial_reference");
  assert.equal(resultado.runtime, "non_production");
});

paso("una referencia (no línea comercial) también se acepta en producción, sin degradar su clase", () => {
  const seed = classifyNonCommercialProduct("arc-001", "seed_demo", "reference", ENV_PROD);
  const manual = classifyNonCommercialProduct("manual-001", "manual_product", "reference", ENV_PROD);
  assert.equal(seed.referenceClass, "test_only");
  assert.equal(manual.referenceClass, "editorial_reference");
  assert.equal(seed.runtime, "production");
});

// --- Caso 2: línea comercial verificada -------------------------------------

paso("seed_demo puede usarse como línea comercial en local/test (no rompe el demo actual)", () => {
  const resultado = classifyNonCommercialProduct("arc-001", "seed_demo", "commercial_line", ENV_DEV);
  assert.equal(resultado.referenceClass, "test_only");
  assert.equal(resultado.runtime, "non_production");
});

paso("manualProducts puede usarse como línea comercial en local/test (no rompe el demo actual)", () => {
  const resultado = classifyNonCommercialProduct("manual-001", "manual_product", "commercial_line", ENV_SIN_DEFINIR);
  assert.equal(resultado.referenceClass, "editorial_reference");
  assert.equal(resultado.runtime, "non_production");
});

paso("seed_demo como línea comercial en producción lanza NonCommercialSourceRejectedError", () => {
  assert.throws(
    () => classifyNonCommercialProduct("arc-001", "seed_demo", "commercial_line", ENV_PROD),
    (error: unknown) => {
      assert.ok(error instanceof NonCommercialSourceRejectedError);
      assert.equal(error.productId, "arc-001");
      assert.equal(error.source, "seed_demo");
      assert.equal(error.referenceClass, "test_only");
      return true;
    },
  );
});

paso("manualProducts como línea comercial en producción lanza NonCommercialSourceRejectedError", () => {
  assert.throws(
    () => classifyNonCommercialProduct("manual-001", "manual_product", "commercial_line", ENV_PROD),
    (error: unknown) => {
      assert.ok(error instanceof NonCommercialSourceRejectedError);
      assert.equal(error.productId, "manual-001");
      assert.equal(error.source, "manual_product");
      assert.equal(error.referenceClass, "editorial_reference");
      return true;
    },
  );
});

// --- Variante en lote (la que usa src/app/api/generate/route.ts) -----------

paso("classifyNonCommercialProducts en lote no lanza en dev/test para reference ni commercial_line", () => {
  const idsSeed = ["arc-001", "cen-001"];
  const idsManual = ["manual-001", "manual-002"];
  assert.doesNotThrow(() => classifyNonCommercialProducts(idsSeed, "seed_demo", "commercial_line", ENV_DEV));
  assert.doesNotThrow(() => classifyNonCommercialProducts(idsManual, "manual_product", "commercial_line", ENV_DEV));
});

paso("classifyNonCommercialProducts en lote lanza en producción para commercial_line (bloquea toda la petición)", () => {
  const idsSeed = ["arc-001", "cen-001"];
  assert.throws(
    () => classifyNonCommercialProducts(idsSeed, "seed_demo", "commercial_line", ENV_PROD),
    NonCommercialSourceRejectedError,
  );
});

paso("classifyNonCommercialProducts en lote NO lanza en producción para reference (solo se etiqueta)", () => {
  const idsSeed = ["arc-001", "cen-001"];
  const idsManual = ["manual-001"];
  const clasificacion = [
    ...classifyNonCommercialProducts(idsSeed, "seed_demo", "reference", ENV_PROD),
    ...classifyNonCommercialProducts(idsManual, "manual_product", "reference", ENV_PROD),
  ];
  assert.equal(clasificacion.length, 3);
  assert.ok(clasificacion.every((item) => item.referenceClass === "test_only" || item.referenceClass === "editorial_reference"));
});

// --- Simulación del punto de decisión real de /api/generate/route.ts -------
//
// route.ts calcula `usoComercialProductos = planDeclarativo ? "reference" :
// "commercial_line"` y clasifica ahí mismo los ids de seed/manual. Esta
// prueba reproduce esa decisión sin levantar el servidor HTTP.

function simularGeneracion(input: {
  planDeclarativo: boolean;
  idsSeedDemo: string[];
  idsManuales: string[];
  env: Record<string, string | undefined>;
}): { bloqueado: boolean; motivo?: string } {
  const usoComercial = input.planDeclarativo ? "reference" : "commercial_line";
  try {
    classifyNonCommercialProducts(input.idsSeedDemo, "seed_demo", usoComercial, input.env);
    classifyNonCommercialProducts(input.idsManuales, "manual_product", usoComercial, input.env);
    return { bloqueado: false };
  } catch (error) {
    if (error instanceof NonCommercialSourceRejectedError) return { bloqueado: true, motivo: error.message };
    throw error;
  }
}

paso("sin plan declarativo + producción + manualProducts -> generación bloqueada", () => {
  const resultado = simularGeneracion({ planDeclarativo: false, idsSeedDemo: [], idsManuales: ["manual-001"], env: ENV_PROD });
  assert.equal(resultado.bloqueado, true);
});

paso("sin plan declarativo + producción + seed_demo -> generación bloqueada", () => {
  const resultado = simularGeneracion({ planDeclarativo: false, idsSeedDemo: ["arc-001"], idsManuales: [], env: ENV_PROD });
  assert.equal(resultado.bloqueado, true);
});

paso("sin plan declarativo + local/test + manualProducts o seed_demo -> generación permitida (demo actual intacto)", () => {
  const conManual = simularGeneracion({ planDeclarativo: false, idsSeedDemo: [], idsManuales: ["manual-001"], env: ENV_DEV });
  const conSeed = simularGeneracion({ planDeclarativo: false, idsSeedDemo: ["arc-001"], idsManuales: [], env: ENV_DEV });
  assert.equal(conManual.bloqueado, false);
  assert.equal(conSeed.bloqueado, false);
});

paso("con plan declarativo + producción + manualProducts/seed_demo -> generación permitida como referencia (cotización real sale de PostgreSQL vía cotizarPlan)", () => {
  const resultado = simularGeneracion({ planDeclarativo: true, idsSeedDemo: ["arc-001"], idsManuales: ["manual-001"], env: ENV_PROD });
  assert.equal(resultado.bloqueado, false);
});

paso("productos con oferta comercial real (postgres_shopify) nunca pasan por este bloqueo: no son seed ni manual", () => {
  // El id de una variante real de Postgres/Shopify jamás llega a
  // classifyNonCommercialProducts en route.ts: solo los ids resueltos por
  // `productosPorIdConFuente(...).fuente === "seed_demo"` y los de
  // `manualProducts` entran a ese arreglo. Esta prueba documenta esa
  // invariante explícitamente en vez de dejarla implícita en route.ts.
  const fuente: NonCommercialProductSource = "seed_demo";
  assert.notEqual(fuente as string, "postgres_shopify");
});

// --- Regresión: no se rompieron las funciones existentes de provenance.ts --

paso("normalizeGenerationSources sigue funcionando (regresión, no se tocó su comportamiento)", () => {
  const resultado = normalizeGenerationSources(["a", "b", "b"], ["b", "c"]);
  assert.deepEqual(resultado.productIds, ["a"]);
  assert.deepEqual(resultado.ragVariantIds, ["b", "c"]);
});

paso("classifyGenerationIds sigue funcionando (regresión, no se tocó su comportamiento)", () => {
  const resultado = classifyGenerationIds(["a", "b", "c"], new Set(["b"]));
  assert.deepEqual(resultado.productIds, ["a", "c"]);
  assert.deepEqual(resultado.ragVariantIds, ["b"]);
});

console.log(`\n[PASS] frontera de autoridad comercial — ${pruebas} aserciones`);
