import assert from "node:assert/strict";
import test from "node:test";
import { recomendarCatalogo, type RecomendarCatalogoInput } from "../src/recomendador-catalogo";
import type { HappiaPackage, HappiaPackageItem, HappiaServicio } from "../src/tipos";
import type { GenerarEstructurado, TelemetriaRecomendacion } from "../src/recomendador";

const service = (id = "s1", extra: Partial<HappiaServicio> = {}): HappiaServicio => ({
  id, name: "Decoración", description: "Globos", total: 100.05,
  charge_type: "total", charge_mode: "event", quantity_editable: false, sale_unit: null,
  has_delivery: false, image_url: null, image_focus: "50% 50%", category_name: "Decoración",
  provider_name: "Proveedor", city: "Barranquilla", city_slug: "barranquilla", rating: null, ...extra,
});
const line = (extra: Partial<HappiaPackageItem> = {}): HappiaPackageItem => ({
  id: "i1", package_id: "p1", total: 20.1, is_active: true, charge_type: "per_person",
  charge_mode: "per_person", quantity_editable: false, sale_unit: null,
  description: "Comida", suggested_start_time: null, provider_name: "Proveedor", category_name: "Comida", ...extra,
});
const pkg = (id = "p1", extra: Partial<HappiaPackage> = {}): HappiaPackage => ({
  id, name: "Cumpleaños", event_type_id: "birthday", base_guests: 20, standard_duration_minutes: 60,
  conditions: null, restrictions: null, is_active: true, city_id: "city-id", is_featured: false, package_items: [line()], ...extra,
});
const answer = (options: Array<{ tipo: "servicio" | "paquete"; id: string }>): GenerarEstructurado => async () => ({
  texto: JSON.stringify({ recomendaciones: options.map((option) => ({ ...option, razon: "Coincide con el evento." })), resumen: "Opciones disponibles." }),
  uso: { promptTokenCount: 100, candidatesTokenCount: 20 },
});
const request = (extra: Partial<RecomendarCatalogoInput> = {}): RecomendarCatalogoInput => ({
  tipoEvento: "Cumpleaños", invitados: 3, presupuesto: 1000, modo: "mixto", cantidad: { servicios: 1, paquetes: 1 },
  servicios: [service()], paquetes: [pkg()], generar: answer([{ tipo: "servicio", id: "s1" }, { tipo: "paquete", id: "p1" }]), ...extra,
});

test("mixed recommendations use independent quotas, project public records and active items", async () => {
  const sourceService = { ...service(), provider_cost: 1 };
  const sourcePackage = { ...pkg(), private_notes: "private", package_items: [{ ...line(), provider_cost: 2 }, line({ id: "inactive", is_active: false, total: 900 })] };
  const result = await recomendarCatalogo(request({ servicios: [sourceService], paquetes: [sourcePackage] }));
  assert.equal(result.recomendaciones.length, 2);
  const [s, p] = result.recomendaciones;
  assert.equal(s?.tipo, "servicio");
  assert.equal(p?.tipo, "paquete");
  if (s?.tipo !== "servicio" || p?.tipo !== "paquete") throw new Error("Missing typed options");
  assert.equal("provider_cost" in s.servicio, false);
  assert.equal("private_notes" in p.paquete, false);
  assert.equal("provider_cost" in p.paquete.package_items[0]!, false);
  assert.equal(p.paquete.package_items.length, 1);
  assert.equal(p.paquete.city_id, "city-id");
  assert.equal(p.precio.subtotal, 60.3);
  assert.equal(p.precio.es_final, false);
  assert.equal(p.precio.moneda, "COP");
});

for (const mode of ["servicios", "paquetes"] as const) {
  test(`${mode} mode rejects IDs of the excluded type and logs discarded count`, async (t) => {
    const warnings: unknown[][] = [];
    t.mock.method(console, "warn", (...args: unknown[]) => warnings.push(args));
    const result = await recomendarCatalogo(request({ modo: mode, cantidad: { servicios: 2, paquetes: 2 } }));
    assert.equal(result.recomendaciones.length, 1);
    assert.equal(result.recomendaciones[0]?.tipo, mode === "servicios" ? "servicio" : "paquete");
    assert.equal(warnings.length, 1);
    assert.match(result.resumen, /Se entregaron/);
  });
}

test("supports 5 services and 2 packages, beyond the previous cap of 3", async () => {
  const services = Array.from({ length: 5 }, (_, i) => service(`s${i}`));
  const packages = [pkg("p1"), pkg("p2")];
  const result = await recomendarCatalogo(request({
    servicios: services, paquetes: packages, cantidad: { servicios: 5, paquetes: 2 },
    generar: answer([...services.map((s) => ({ tipo: "servicio" as const, id: s.id })), ...packages.map((p) => ({ tipo: "paquete" as const, id: p.id }))]),
  }));
  assert.equal(result.recomendaciones.length, 7);
  assert.equal(result.recomendaciones.filter((r) => r.tipo === "servicio").length, 5);
  assert.equal(result.recomendaciones.filter((r) => r.tipo === "paquete").length, 2);
});

test("rejects invented and duplicate IDs without filling missing options", async (t) => {
  t.mock.method(console, "warn", () => {});
  const result = await recomendarCatalogo(request({ cantidad: { servicios: 3, paquetes: 1 }, generar: answer([
    { tipo: "servicio", id: "s1" }, { tipo: "servicio", id: "s1" }, { tipo: "servicio", id: "invented" }, { tipo: "paquete", id: "p1" },
  ]) }));
  assert.equal(result.recomendaciones.length, 2);
  assert.match(result.resumen, /1 de 3 servicios/);
});

test("enforces per-type quota even if provider returns more of one type", async (t) => {
  t.mock.method(console, "warn", () => {});
  const result = await recomendarCatalogo(request({ servicios: [service("s1"), service("s2")], generar: answer([{ tipo: "servicio", id: "s1" }, { tipo: "servicio", id: "s2" }]) }));
  assert.equal(result.recomendaciones.length, 1);
  assert.match(result.resumen, /0 de 1 paquetes/);
});

test("calculates event, unit and per-person prices in cents with explicit one-unit assumptions", async () => {
  const services = [
    service("event"), service("unit", { charge_mode: "unit", quantity_editable: true }),
    service("person", { charge_type: "per_person", charge_mode: "per_person" }),
    service("person-editable", { charge_type: "per_person", charge_mode: "per_person", quantity_editable: true, sale_unit: { singular: "refrigerio", plural: "refrigerios" } }),
  ];
  const result = await recomendarCatalogo(request({ modo: "servicios", cantidad: { servicios: 4, paquetes: 0 }, servicios: services, generar: answer(services.map((s) => ({ tipo: "servicio", id: s.id }))) }));
  assert.deepEqual(result.recomendaciones.map((r) => r.precio.subtotal), [100.05, 100.05, 300.15, 300.15]);
  assert.match(result.recomendaciones[1]!.precio.advertencia, /supone 1 unidad/);
  assert.match(result.recomendaciones[3]!.precio.advertencia, /1 por invitado/);
});

test("unknown legacy total charge mode returns an unknown subtotal", async () => {
  const result = await recomendarCatalogo(request({ modo: "paquetes", paquetes: [pkg("p1", { package_items: [line({ charge_mode: undefined, charge_type: "total" })] })], generar: answer([{ tipo: "paquete", id: "p1" }]) }));
  assert.equal(result.recomendaciones[0]?.precio.subtotal, null);
  assert.match(result.recomendaciones[0]!.precio.advertencia, /No se puede calcular/);
});

test("inactive and empty packages are absent and an empty catalogue needs no provider", async () => {
  let called = false;
  const result = await recomendarCatalogo(request({ modo: "paquetes", paquetes: [pkg("inactive", { is_active: false }), pkg("empty", { package_items: [line({ is_active: false })] })], generar: async () => { called = true; throw new Error("must not run"); } }));
  assert.deepEqual(result.recomendaciones, []);
  assert.equal(called, false);
});

test("provider prices or extra response keys are rejected with error telemetry", async () => {
  const events: TelemetriaRecomendacion[] = [];
  await assert.rejects(recomendarCatalogo(request({ registrarTelemetria: (event) => events.push(event), generar: async () => ({ texto: JSON.stringify({ recomendaciones: [{ tipo: "servicio", id: "s1", razon: "Good", precio: 1 }], resumen: "Summary" }) }) })));
  assert.deepEqual(events.map((e) => e.resultado), ["error"]);
});

test("success telemetry includes provider usage; telemetry failures do not break results", async () => {
  const events: TelemetriaRecomendacion[] = [];
  await recomendarCatalogo(request({ registrarTelemetria: (event) => events.push(event) }));
  assert.equal(events[0]?.resultado, "ok");
  assert.equal(events[0]?.tokensEntrada, 100);
  assert.equal(events[0]?.tokensSalida, 20);
  await assert.doesNotReject(recomendarCatalogo(request({ registrarTelemetria: () => { throw new Error("storage unavailable"); } })));
});

test("cancellation rejects even when the provider ignores abort and records cancellation", async () => {
  const controller = new AbortController();
  const events: TelemetriaRecomendacion[] = [];
  const pending = recomendarCatalogo(request({ signal: controller.signal, registrarTelemetria: (event) => events.push(event), generar: async () => new Promise(() => {}) }));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.deepEqual(events.map((e) => e.resultado), ["cancelado"]);
});

test("provider timeout and malformed JSON are reported as failed generations", async () => {
  for (const [generate, expected] of [
    [async () => { throw new DOMException("Timed out", "TimeoutError"); }, "timeout"],
    [async () => ({ texto: "not JSON" }), "error"],
    [async () => ({ texto: undefined }), "error"],
  ] as const) {
    const events: TelemetriaRecomendacion[] = [];
    await assert.rejects(recomendarCatalogo(request({ generar: generate, registrarTelemetria: (event) => events.push(event) })));
    assert.equal(events[0]?.resultado, expected);
  }
});

test("rejects oversized catalogue rather than silently truncating and rejects invalid counts", async () => {
  await assert.rejects(recomendarCatalogo(request({ servicios: Array.from({ length: 2001 }, (_, i) => service(`s${i}`)) })), /excede 2000/);
  await assert.rejects(recomendarCatalogo(request({ cantidad: { servicios: 21, paquetes: 1 } })));
});

test("inconsistent charge fields fail before provider invocation", async () => {
  await assert.rejects(recomendarCatalogo(request({ servicios: [service("s1", { charge_mode: "unit", quantity_editable: false })] })), /Inconsistent service charge fields/);
});
