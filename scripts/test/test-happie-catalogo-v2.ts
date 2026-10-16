import assert from "node:assert/strict";
import test from "node:test";
import { procesarTurnoCatalogo } from "../../src/lib/happie/conversacion-catalogo";
import { HappieConversationRequestV2Schema, HappieConversationResponseV2Schema, HappieRecommendationRequestV2Schema, HappieRecommendationResponseV2Schema, catalogOptions } from "../../src/lib/ia/contracts/happie-v2";
import { HappieRecommendationRequestV1Schema } from "../../src/lib/ia/contracts/happie-v1";
import type { Extraccion } from "../../src/lib/happie/conversacion-webhook";

const request = () => new Request("http://localhost/api/happie/webhook/chat", { method: "POST", body: "{}" });
const extracted: Extraccion = { tipoEvento: "cumpleaños", invitados: 20, presupuesto: 2000000, servicios: [], preferencias: ["magia"], serviciosDeseados: ["magia"], respondioDetalles: true, confirmacion: "si", acuse: "" };
const state = { fase: "confirmacion" as const, tipoEvento: "cumpleaños", invitados: 20, presupuesto: 2000000, city: "barranquilla", servicios: [], preferencias: ["magia"], serviciosDeseados: ["magia"], modo: "mixto" as const, cantidad: { servicios: 5, paquetes: 2 } };

test("v2 quotas support more than three, reject invalid values and preserve v1", () => {
  const base = { tipoEvento: "cumpleaños", invitados: 20, presupuesto: 2000000 };
  assert.ok(HappieRecommendationRequestV2Schema.safeParse({ ...base, schema_version: "happie.v2", modo: "mixto", cantidad: { servicios: 5, paquetes: 2 } }).success);
  for (const servicios of [-1, 21, 1.5]) assert.equal(HappieRecommendationRequestV2Schema.safeParse({ ...base, schema_version: "happie.v2", cantidad: { servicios, paquetes: 1 } }).success, false);
  assert.throws(() => catalogOptions({ modo: "servicios", cantidad: { servicios: 2, paquetes: 1 } }));
  assert.ok(HappieRecommendationRequestV1Schema.safeParse(base).success);
  assert.equal(HappieRecommendationRequestV1Schema.safeParse({ ...base, modo: "mixto" }).success, false);
});

test("confirmed v2 turn passes per-type quotas, city and specific needs and returns grouped data", async () => {
  let calls = 0;
  const result = await procesarTurnoCatalogo({ schema_version: "happie.v2", mensaje: "sí", estado: state }, request(), async () => ({
    ...extracted, servicios: [], preferencias: [], serviciosDeseados: [], respondioDetalles: true,
  }), async (_, input) => {
    calls++;
    assert.deepEqual(input.cantidad, { servicios: 5, paquetes: 2 });
    assert.equal(input.city, "barranquilla");
    assert.ok(input.preferencias?.includes("magia"));
    return { status: 200, body: { schema_version: "happie.v2", modo: "mixto", cantidad: input.cantidad, recomendaciones: [], servicios: [], paquetes: [], resumen: "No hay coincidencias." } };
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 200);
  const body = result.body as { estado: { fase: string }; servicios: unknown[]; paquetes: unknown[] };
  assert.equal(body.estado.fase, "finalizado");
  assert.deepEqual(body.servicios, []);
  assert.deepEqual(body.paquetes, []);
});

test("mode and count changes require a fresh confirmation", async () => {
  let calls = 0;
  const result = await procesarTurnoCatalogo({ schema_version: "happie.v2", mensaje: "mejor solo 7 servicios", estado: state }, request(), async () => ({ ...extracted, modo: "servicios", cantidad: { servicios: 7, paquetes: 0 } }), async () => { calls++; return { status: 500, body: {} }; });
  assert.equal(calls, 0);
  const body = result.body as { tipo: string; estado: { modo: string; cantidad: unknown }; mensaje: string };
  assert.equal(body.tipo, "pregunta");
  assert.equal(body.estado.modo, "servicios");
  assert.deepEqual(body.estado.cantidad, { servicios: 7, paquetes: 0 });
  assert.match(body.mensaje, /7 servicios/);
});

test("chat asks for city instead of recommending services in an unknown location", async () => {
  const result = await procesarTurnoCatalogo({ schema_version: "happie.v2", mensaje: "cumpleaños", modo: "servicios", cantidad: { servicios: 2, paquetes: 0 } }, request(), async () => ({ ...extracted, city: null }));
  assert.match((result.body as { mensaje: string }).mensaje, /ciudad/);
});

test("chat acknowledges a concrete service, guides the occasion, and keeps it across turns", async () => {
  const first = await procesarTurnoCatalogo({ schema_version: "happie.v2", mensaje: "quiero unas pizzas" }, request(), async () => ({
    ...extracted,
    tipoEvento: null,
    invitados: null,
    presupuesto: null,
    servicios: ["comida"],
    preferencias: ["pizzas"],
    serviciosDeseados: ["pizzas"],
    respondioDetalles: false,
    confirmacion: "incierta",
    acuse: "Anoto las pizzas.",
  }));
  const firstBody = HappieConversationResponseV2Schema.parse(first.body);
  assert.equal(firstBody.estado.fase, "descubrimiento");
  assert.ok(firstBody.estado.serviciosDeseados?.includes("pizzas"));
  assert.match(firstBody.mensaje, /Anoto las pizzas/);
  assert.match(firstBody.mensaje, /para una celebración, una reunión o una comida informal/);

  const second = await procesarTurnoCatalogo({ schema_version: "happie.v2", mensaje: "para un cumpleaños", estado: firstBody.estado }, request(), async () => ({
    ...extracted,
    tipoEvento: "cumpleaños",
    invitados: null,
    presupuesto: null,
    servicios: [],
    preferencias: [],
    serviciosDeseados: [],
    respondioDetalles: false,
    confirmacion: "incierta",
    acuse: "Anoto que es un cumpleaños.",
  }));
  const secondBody = HappieConversationResponseV2Schema.parse(second.body);
  assert.ok(secondBody.estado.serviciosDeseados?.includes("pizzas"));
  assert.match(secondBody.mensaje, /cuántas personas/i);
  assert.doesNotMatch(secondBody.mensaje, /qué servicios concretos/i);
});

test("invalid mixed counts fail before paid extraction; cancelled turns cannot recommend", async () => {
  let extracts = 0;
  const result = await procesarTurnoCatalogo({ schema_version: "happie.v2", mensaje: "sí", modo: "servicios", cantidad: { servicios: 1, paquetes: 1 } }, request(), async () => { extracts++; return extracted; });
  assert.equal(result.status, 400);
  assert.equal(extracts, 0);
  const signal = AbortSignal.abort();
  await assert.rejects(procesarTurnoCatalogo({ schema_version: "happie.v2", mensaje: "sí", estado: state }, new Request(request(), { signal }), async () => extracted));
});

test("v2 request rejects unknown fields and empty counts", () => {
  assert.equal(HappieConversationRequestV2Schema.safeParse({ schema_version: "happie.v2", mensaje: "hola", hidden: true }).success, false);
  assert.equal(HappieConversationRequestV2Schema.safeParse({ schema_version: "happie.v2", mensaje: "hola", cantidad: { servicios: 0, paquetes: 0 } }).success, false);
  assert.equal(HappieRecommendationResponseV2Schema.safeParse({ schema_version: "happie.v2", modo: "mixto", cantidad: { servicios: 1, paquetes: 1 }, recomendaciones: [{ tipo: "servicio", servicio: { id: "inventado" } }], servicios: [], paquetes: [], resumen: "x" }).success, false);
});


test("explicit mode changes reset previous counts before validation", async () => {
  const result = await procesarTurnoCatalogo({ schema_version: "happie.v2", mensaje: "solo servicios", modo: "servicios", estado: state }, request(), async () => ({ ...extracted, confirmacion: "no" }));
  assert.equal(result.status, 200);
  assert.deepEqual((result.body as { estado: { cantidad: unknown } }).estado.cantidad, { servicios: 3, paquetes: 0 });
});

test("continuing after final results preserves event, budget, city and guests", async () => {
  const result = await procesarTurnoCatalogo({ schema_version: "happie.v2", mensaje: "mejor solo 7 servicios", estado: { ...state, fase: "finalizado" } }, request(), async (_, previous) => {
    assert.equal(previous.tipoEvento, state.tipoEvento);
    assert.equal(previous.invitados, 20);
    return { ...extracted, tipoEvento: null, invitados: null, presupuesto: null, modo: "servicios", cantidad: { servicios: 7, paquetes: 0 }, confirmacion: "incierta" };
  });
  assert.equal(result.status, 200);
  const body = result.body as { estado: typeof state; tipo: string };
  assert.equal(body.tipo, "pregunta");
  assert.equal(body.estado.city, "barranquilla");
  assert.equal(body.estado.presupuesto, 2000000);
  assert.equal(body.estado.invitados, 20);
  assert.equal(body.estado.fase, "confirmacion");
});


test("natural language on first UI turn overrides initial control defaults in state", async () => {
  const result = await procesarTurnoCatalogo({ schema_version: "happie.v2", mensaje: "solo 7 servicios en Barranquilla", estado: { fase: "descubrimiento", servicios: [], preferencias: [], modo: "mixto", cantidad: { servicios: 3, paquetes: 3 } } }, request(), async () => ({ ...extracted, modo: "servicios", city: "barranquilla", cantidad: { servicios: 7, paquetes: 0 }, confirmacion: "incierta" }));
  const body = result.body as { estado: { modo: string; cantidad: unknown } };
  assert.equal(body.estado.modo, "servicios");
  assert.deepEqual(body.estado.cantidad, { servicios: 7, paquetes: 0 });
});


test("large valid preferences retain full state while confirmation text stays bounded", async () => {
  const preferences = Array.from({ length: 20 }, (_, i) => `${i} ${"p".repeat(290)}`);
  const services = Array.from({ length: 20 }, (_, i) => `${i} ${"s".repeat(290)}`);
  const result = await procesarTurnoCatalogo({ schema_version: "happie.v2", mensaje: "estos servicios", estado: state }, request(), async () => ({ ...extracted, confirmacion: "no", preferencias: preferences, serviciosDeseados: services }));
  assert.equal(result.status, 200);
  const body = result.body as { mensaje: string; estado: { preferencias: string[]; serviciosDeseados: string[] } };
  assert.ok(body.mensaje.length <= 4000);
  assert.deepEqual(body.estado.preferencias, preferences);
  assert.deepEqual(body.estado.serviciosDeseados, services);
});
