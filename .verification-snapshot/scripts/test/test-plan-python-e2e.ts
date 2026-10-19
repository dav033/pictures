import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  isPythonAdapterError,
  llamarPythonCatalogSearch,
  llamarPythonPlanResolution,
} from "../../src/lib/ia/nucleo/python-adapter";
import { PlanDecoracionSchema } from "../../src/lib/plan/tipos";
import { decidirSmoke, exigirReadyz } from "../lib/python-smoke-preflight";

function planDeSmoke(productId: string) {
  return PlanDecoracionSchema.parse({
    plan_version: "1.0",
    plan_id: randomUUID(),
    concepto: {
      titulo: "Smoke test Python",
      descripcion: "Resolución local contra catálogo publicado.",
      paleta: [],
    },
    espacio: { tipo: "salon", fuente: "supuesto" },
    estructuras: [{
      estructura_id: "EST_01_SMOKE",
      nombre: "Arco de smoke test",
      tipo: "arco",
      rol_escena: "focal",
      ubicacion: "arco_central",
      medidas: { ancho_m: 3, alto_m: 2.4 },
      repeticiones: 1,
      densidad: "media",
      mezcla: "clasica",
      materiales: [{ product_id: productId, participacion: 1, rol_material: "principal" }],
      porque: "Fixture de verificación local.",
    }],
    supuestos: [],
  });
}

async function main(): Promise<void> {
  // Only a genuinely unconfigured run may skip; a required smoke fails.
  const decision = decidirSmoke(() => null);
  if (decision.accion === "saltar") {
    console.log(`[SKIP] ${decision.motivo}`);
    return;
  }
  if (decision.accion === "fallar") throw new Error(decision.motivo);
  await exigirReadyz(decision.backendUrl);

  try {
    const busqueda = await llamarPythonCatalogSearch({
      message: "globo redondo latex",
      filters: { available: true, shapes: ["redondo"], diameters_inches: [12] },
      allowlist: [],
      limit: 15,
      requestId: randomUUID(),
      correlationId: randomUUID(),
      deadlineMs: 10_000,
    });
    const snapshot = busqueda.catalog_snapshot_id;
    if (!snapshot) {
      throw new Error("la búsqueda real no devolvió catalog_snapshot_id");
    }

    const candidato = busqueda.candidates.find((item) => item.variants.some((variant) =>
      variant.available && variant.shape === "redondo" && variant.diameter_inches === 12));
    if (!candidato) {
      throw new Error("la búsqueda real no encontró una variante redonda R-12 disponible");
    }
    const variante = candidato.variants.find((item) =>
      item.available && item.shape === "redondo" && item.diameter_inches === 12);
    assert.ok(variante, "la variante seleccionada debe existir en el resultado de búsqueda");
    const allowlist = busqueda.whitelist.filter((entry) => entry.product_id === candidato.product_id);
    assert.ok(allowlist.some((entry) => entry.variant_ids.includes(variante.variant_id)));

    const plan = planDeSmoke(candidato.product_id);
    const resultado = await llamarPythonPlanResolution({
      plan,
      allowlist,
      catalogSnapshotId: snapshot,
      requestId: randomUUID(),
      correlationId: randomUUID(),
      deadlineMs: 10_000,
    });
    assert.equal(resultado.catalog_snapshot_id, snapshot);
    assert.ok(resultado.plan_resuelto.compras.length > 0);
    assert.ok(resultado.material_estimate.purchases.length > 0);
    assert.ok(resultado.quote.lines.length > 0);
    assert.ok(resultado.plan_resuelto.totales.total_cop > 0);
    assert.equal(resultado.quote.total_cop, resultado.plan_resuelto.totales.total_cop);
    assert.equal(resultado.quote.plan_hash, resultado.plan_resuelto.plan_hash);
    assert.equal(resultado.material_estimate.totals.purchase_cost, resultado.plan_resuelto.totales.purchase_cost);
    assert.equal(resultado.quote.purchase_cost_cop, resultado.plan_resuelto.totales.purchase_cost);
    assert.equal(resultado.quote.consumption_cost_cop, resultado.plan_resuelto.totales.consumption_cost);
    assert.equal(resultado.quote.target_waste_reserve, resultado.plan_resuelto.totales.target_waste_reserve);
    assert.equal(resultado.quote.covered_waste_reserve, resultado.plan_resuelto.totales.covered_waste_reserve);
    console.log(`[PASS] Next adapter -> Python -> PostgreSQL local; snapshot=${snapshot}; total=${resultado.quote.total_cop} COP`);
  } catch (error) {
    if (isPythonAdapterError(error) && (error.code === "PYTHON_UNAVAILABLE" || error.code === "PYTHON_BACKEND_TIMEOUT")) {
      throw new Error("el servicio Python local no respondió", { cause: error });
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(`[FAIL] smoke E2E de plan Python — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
