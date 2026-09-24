/**
 * Signed plan provenance (src/lib/plan/aprobacion.ts) and the Python transport
 * mapping (src/lib/plan/python-mapper.ts).
 *
 * These two pieces are what lets `/api/generate` and `/api/plan-editar` restate
 * the catalog snapshot and the same-turn allowlist of a proposal without the
 * browser being able to change either. The mapper assertions deliberately
 * compare field against field instead of hard-coded numbers: the mapper must
 * copy the commercial values Python produced, never recompute them, so a
 * fixture whose numbers change must not change what this test proves.
 */
process.env.PLAN_APPROVAL_SECRET ??= "test-plan-approval-secret";

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  abrirContextoPlan,
  allowlistDesdeMapa,
  crearTokenAprobacion,
  crearTokenPlan,
  mapaDesdeAllowlist,
  verificarTokenAprobacion,
} from "../../src/lib/plan/aprobacion";
import {
  PlanResolutionResultV1Schema,
  PlanResueltoV1Schema,
  QuoteV1Schema,
} from "../../src/lib/ia/contracts/domain-v1";
import { MaterialEstimateSchema } from "../../src/lib/materiales/estimacion";
import { cotizacionDesdePython, planResueltoDesdePython, PythonPlanMappingError } from "../../src/lib/plan/python-mapper";

const PLAN_HASH = "a".repeat(64);
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT = "SNAP-CONTEXTO-001";
// allowlistDesdeMapa emite un orden estable (producto y variante ordenados)
// para que el mismo turno produzca siempre el mismo token.
const ALLOWLIST = [
  { product_id: "P-BACK", variant_ids: ["V-BACK"] },
  { product_id: "P-GLOBOS", variant_ids: ["V-R-12", "V-R-18"] },
];

function fixture(nombre: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), "contracts", "domain", "v1", "fixtures", nombre), "utf8"));
}

function tokenV1(planHash: string, requestId: string, expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, planHash, requestId, expiresAt }), "utf8").toString("base64url");
  const firma = createHmac("sha256", process.env.PLAN_APPROVAL_SECRET!).update(payload).digest("base64url");
  return `${payload}.${firma}`;
}

function probarContextoFirmado(): void {
  const token = crearTokenPlan({
    planHash: PLAN_HASH,
    requestId: REQUEST_ID,
    backend: "python",
    catalogSnapshotId: SNAPSHOT,
    allowlist: ALLOWLIST,
  });

  const contexto = abrirContextoPlan(token);
  assert.ok(contexto, "el token recién emitido debe abrirse");
  assert.equal(contexto.backend, "python");
  assert.equal(contexto.catalogSnapshotId, SNAPSHOT);
  assert.deepStrictEqual(contexto.allowlist, ALLOWLIST);
  assert.equal(contexto.planHash, PLAN_HASH);
  assert.equal(contexto.requestId, REQUEST_ID);

  // La puerta de aprobación sigue exigiendo el hash exacto resuelto en servidor.
  assert.ok(verificarTokenAprobacion(token, PLAN_HASH), "el hash correcto debe aprobar");
  assert.equal(verificarTokenAprobacion(token, "b".repeat(64)), null, "otro hash no puede aprobar");
  assert.equal(verificarTokenAprobacion(undefined, PLAN_HASH), null);

  // El navegador no puede reescribir la procedencia: cualquier cambio en el
  // payload invalida la firma, y un token sin firma válida no abre contexto.
  const [payload, firma] = token.split(".");
  const manipulado = Buffer.from(JSON.stringify({
    v: 2,
    planHash: PLAN_HASH,
    requestId: REQUEST_ID,
    expiresAt: Date.now() + 60_000,
    backend: "python",
    catalogSnapshotId: "SNAP-FALSIFICADO",
    allowlist: [{ product_id: "P-CUALQUIERA", variant_ids: ["V-CUALQUIERA"] }],
  }), "utf8").toString("base64url");
  assert.equal(abrirContextoPlan(`${manipulado}.${firma}`), null, "un snapshot falsificado no puede abrirse");
  assert.equal(verificarTokenAprobacion(`${manipulado}.${firma}`, PLAN_HASH), null);
  assert.equal(abrirContextoPlan(`${payload}.${"x".repeat(firma!.length)}`), null, "una firma inventada no abre");
  assert.equal(abrirContextoPlan("sin-punto"), null);
  assert.equal(abrirContextoPlan(`${payload}.`), null);

  // Un token expirado no abre contexto ni aprueba.
  const expirado = crearTokenPlan({ planHash: PLAN_HASH, requestId: REQUEST_ID, backend: "python", catalogSnapshotId: SNAPSHOT, allowlist: ALLOWLIST }, -1);
  assert.equal(abrirContextoPlan(expirado), null);
  assert.equal(verificarTokenAprobacion(expirado, PLAN_HASH), null);
}

function probarCompatibilidadV1(): void {
  // Tokens v1 ya emitidos siguen aprobando, y se leen como el único backend que
  // puede re-resolverlos: TypeScript, que deriva su propia whitelist del plan.
  const token = tokenV1(PLAN_HASH, REQUEST_ID, Date.now() + 60_000);
  assert.ok(verificarTokenAprobacion(token, PLAN_HASH), "un token v1 vigente debe seguir aprobando");
  const contexto = abrirContextoPlan(token);
  assert.ok(contexto);
  assert.equal(contexto.backend, "next");
  assert.equal(contexto.catalogSnapshotId, null);
  assert.deepStrictEqual(contexto.allowlist, []);
  assert.equal(verificarTokenAprobacion(tokenV1(PLAN_HASH, REQUEST_ID, Date.now() - 1), PLAN_HASH), null);

  // El helper de compatibilidad no inventa procedencia.
  const sinContexto = abrirContextoPlan(crearTokenAprobacion(PLAN_HASH, REQUEST_ID));
  assert.ok(sinContexto);
  assert.equal(sinContexto.backend, "next");
  assert.equal(sinContexto.catalogSnapshotId, null);
  assert.deepStrictEqual(sinContexto.allowlist, []);
}

function probarConversionAllowlist(): void {
  const mapa = new Map<string, Set<string>>([
    ["P-GLOBOS", new Set(["V-R-18", "V-R-12"])],
    ["P-BACK", new Set(["V-BACK"])],
    ["P-VACIO", new Set<string>()],
  ]);
  const allowlist = allowlistDesdeMapa(mapa);
  assert.deepStrictEqual(allowlist, ALLOWLIST, "orden estable y sin productos sin variantes");
  const vuelta = mapaDesdeAllowlist(allowlist);
  assert.deepStrictEqual([...vuelta.get("P-GLOBOS")!].sort(), ["V-R-12", "V-R-18"]);
  assert.deepStrictEqual([...vuelta.get("P-BACK")!], ["V-BACK"]);
  assert.equal(vuelta.has("P-VACIO"), false);
}

function resultadoPython() {
  return PlanResolutionResultV1Schema.parse({
    operation_schema_version: "plan-resolution-result.v1",
    catalog_snapshot_id: SNAPSHOT,
    plan_resuelto: PlanResueltoV1Schema.parse(fixture("plan-resuelto-ok.json")),
    material_estimate: MaterialEstimateSchema.parse(fixture("material-estimate-ok.json")),
    quote: QuoteV1Schema.parse(fixture("quote-ok.json")),
  });
}

function probarMapeoPlan(): void {
  const resultado = resultadoPython();
  const resuelto = planResueltoDesdePython(resultado.plan_resuelto);

  assert.equal("schema_version" in resuelto, false, "el mapeo quita el marcador de contrato");
  assert.equal(resuelto.plan_hash, resultado.plan_resuelto.plan_hash);
  assert.deepStrictEqual(resuelto.totales, resultado.plan_resuelto.totales);
  assert.deepStrictEqual(resuelto.comercial, resultado.plan_resuelto.comercial);
  assert.deepStrictEqual(resuelto.compras, resultado.plan_resuelto.compras);
  assert.deepStrictEqual(resuelto.sin_cobertura, resultado.plan_resuelto.sin_cobertura);
  assert.deepStrictEqual(resuelto.sustituciones, resultado.plan_resuelto.sustituciones);
  assert.equal(resuelto.estructuras.length, resultado.plan_resuelto.estructuras.length);
  for (const [indice, estructura] of resuelto.estructuras.entries()) {
    const origen = resultado.plan_resuelto.estructuras[indice]!;
    assert.equal(estructura.tipo, origen.tipo);
    assert.equal(estructura.ubicacion, origen.ubicacion);
    assert.deepStrictEqual(estructura.lineas, origen.lineas);
    assert.deepStrictEqual(estructura.mezcla_real, origen.mezcla_real);
  }

  // Un vocabulario que la UI no sabe dibujar es una respuesta rota, no algo que
  // se pueda coercionar en silencio.
  for (const campo of ["tipo", "ubicacion"] as const) {
    assert.throws(
      () => planResueltoDesdePython({
        ...resultado.plan_resuelto,
        estructuras: resultado.plan_resuelto.estructuras.map((estructura) => ({ ...estructura, [campo]: "inventado" })),
      }),
      PythonPlanMappingError,
      `un ${campo} desconocido debe rechazarse`,
    );
  }
}

function probarMapeoCotizacion(): void {
  const resultado = resultadoPython();
  const cotizacion = cotizacionDesdePython(resultado);
  const { quote, plan_resuelto: planResuelto } = resultado;

  assert.equal(cotizacion.total, quote.total_cop);
  assert.equal(cotizacion.mermaPorcentaje, quote.waste_percentage);
  assert.equal(cotizacion.incluyeIva, quote.includes_vat);
  assert.equal(cotizacion.purchaseCost, quote.purchase_cost_cop);
  assert.equal(cotizacion.consumptionCost, quote.consumption_cost_cop);
  assert.equal(cotizacion.targetWasteReserve, quote.target_waste_reserve);
  assert.equal(cotizacion.coveredWasteReserve, quote.covered_waste_reserve);
  assert.equal(cotizacion.leftoverInventory, quote.leftover_inventory);
  assert.equal(cotizacion.plan_hash, quote.plan_hash);
  assert.equal(cotizacion.complementosSoportados, false);
  assert.equal(cotizacion.lineas.length, quote.lines.length);

  for (const [indice, linea] of cotizacion.lineas.entries()) {
    const origen = quote.lines[indice]!;
    const compra = planResuelto.compras.find((item) => item.variant_id === (origen.variant_id ?? origen.id))!;
    assert.ok(compra, "cada línea de cotización tiene su compra consolidada");
    assert.equal(linea.id, origen.id);
    assert.equal(linea.productId, origen.product_id);
    assert.equal(linea.varianteId, origen.variant_id);
    assert.equal(linea.tamano, origen.size);
    assert.equal(linea.tamanoCodigo, origen.size_code);
    assert.equal(linea.diamPulg, origen.diameter_inches);
    assert.equal(linea.color, origen.color);
    assert.equal(linea.nombre, origen.title);
    assert.equal(linea.disponible, origen.available);
    assert.equal(linea.designQuantity, origen.design_quantity);
    assert.equal(linea.wasteReserve, origen.waste_reserve);
    assert.equal(linea.requiredQuantity, origen.required_quantity);
    assert.equal(linea.purchaseQuantity, origen.purchase_quantity);
    assert.equal(linea.used, origen.used);
    assert.equal(linea.leftoverInventory, origen.leftover_inventory);
    assert.equal(linea.consumptionCost, origen.consumption_cost_cop);
    assert.equal(linea.purchaseCost, origen.purchase_cost_cop);
    assert.equal(linea.precioPaquete, origen.package_price_cop);
    assert.equal(linea.unidadesPaquete, origen.units_per_package);
    assert.equal(linea.paquetes, origen.packages);
    assert.equal(linea.subtotal, origen.subtotal_cop);
    assert.equal(linea.sobrante, origen.surplus);
    assert.deepStrictEqual(linea.estructuras, origen.structures ?? []);
    assert.deepStrictEqual(linea.elementosOrigen, origen.origins);
    // `quote.v1` no transporta estos dos: salen de la compra consolidada que
    // viaja en la misma respuesta, no de un recálculo en Next.
    assert.equal(linea.cantidadNecesaria, compra.unidades_necesarias);
    assert.equal(linea.additionalPackageForWaste, compra.additional_package_for_waste);
    const referenciasEsperadas = [...new Set((origen.structures ?? [])
      .map((estructuraId) => planResuelto.plan.estructuras.find((entrada) => entrada.estructura_id === estructuraId)?.referencia_element_id)
      .filter((id): id is string => Boolean(id)))];
    assert.deepStrictEqual(linea.referenciaElementIds, referenciasEsperadas);
  }

  // Una cotización que menciona una variante sin compra consolidada es una
  // respuesta incoherente, no una línea que se pueda mostrar a medias.
  assert.throws(
    () => cotizacionDesdePython({
      ...resultado,
      quote: { ...quote, lines: quote.lines.map((linea) => ({ ...linea, id: "var-inexistente", variant_id: "var-inexistente" })) },
    }),
    PythonPlanMappingError,
    "una línea sin compra asociada debe rechazarse",
  );
}

function main(): void {
  probarContextoFirmado();
  probarCompatibilidadV1();
  probarConversionAllowlist();
  probarMapeoPlan();
  probarMapeoCotizacion();
  console.log("OK contexto de plan firmado y mapeo Python→UI");
}

main();
