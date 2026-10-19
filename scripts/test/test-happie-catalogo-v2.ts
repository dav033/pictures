import assert from "node:assert/strict";
import test from "node:test";
import { procesarTurnoCatalogo } from "../../src/lib/happie/conversacion-catalogo";
import { HappieConversationRequestV2Schema, HappieConversationResponseV2Schema, HappieRecommendationRequestV2Schema, HappieRecommendationResponseV2Schema, catalogOptions } from "../../src/lib/ia/contracts/happie-v2";
import { HappieRecommendationRequestV1Schema } from "../../src/lib/ia/contracts/happie-v1";
import { manejarChatWebhookExterno, procesarTurnoConversacion, type Extraccion } from "../../src/lib/happie/conversacion-webhook";

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

test("chat accepts an informal meal as context and keeps the requested pizza", async () => {
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

  const second = await procesarTurnoCatalogo({ schema_version: "happie.v2", mensaje: "comida informal", estado: firstBody.estado }, request(), async () => ({
    ...extracted,
    tipoEvento: null,
    invitados: null,
    presupuesto: null,
    servicios: [],
    preferencias: ["comida informal"],
    serviciosDeseados: [],
    respondioDetalles: true,
    confirmacion: "incierta",
    acuse: "Anoto que prefieres comida informal.",
  }));
  const secondBody = HappieConversationResponseV2Schema.parse(second.body);

  assert.equal(secondBody.estado.tipoEvento, "Comida informal");
  assert.ok(secondBody.estado.serviciosDeseados?.includes("pizzas"));
  assert.ok(secondBody.estado.servicios.includes("comida"));
  assert.doesNotMatch(secondBody.mensaje, /¿Buscas pizzas?/i);
  assert.match(secondBody.mensaje, /¿Para cuántas personas será el evento\?/i);
  assert.ok(!secondBody.estado.preferencias.some((preference) => /comida informal/i.test(preference)));

  const third = await procesarTurnoCatalogo({ schema_version: "happie.v2", mensaje: "12", estado: secondBody.estado }, request(), async () => ({
    ...extracted,
    tipoEvento: null,
    invitados: null,
    presupuesto: null,
    servicios: [],
    preferencias: [],
    serviciosDeseados: [],
    respondioDetalles: true,
    confirmacion: "incierta",
    acuse: "Anoto el dato.",
  }));
  const thirdBody = HappieConversationResponseV2Schema.parse(third.body);

  assert.equal(thirdBody.estado.invitados, 12);
  assert.ok(thirdBody.estado.serviciosDeseados?.includes("pizzas"));
  assert.ok(thirdBody.estado.servicios.includes("comida"));
  assert.match(thirdBody.mensaje, /presupuesto/i);
  assert.doesNotMatch(thirdBody.mensaje, /cuántas personas/i);
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

test("a conversational detour preserves state and does not repeat confirmation or recommend", async () => {
  let recommendations = 0;
  const previous = { ...state, tipoEvento: "Comida informal", invitados: 14, presupuesto: 140000, preferencias: ["pizza"], serviciosDeseados: ["pizza"] };
  const reply = "Me quedo con las pizzas 🙂. ¿Seguimos buscando opciones para tu comida?";
  const result = await procesarTurnoCatalogo({ schema_version: "happie.v2", mensaje: "dame un ejemplo de hello world en js", estado: previous }, request(), async () => ({
    ...extracted, tipoEvento: null, invitados: null, presupuesto: null, servicios: [], preferencias: [], serviciosDeseados: [],
    confirmacion: "incierta", acuse: "Entendido.", respondioDetalles: false, respuestaConversacional: reply,
  }), async () => { recommendations++; return { status: 500, body: {} }; });
  const body = HappieConversationResponseV2Schema.parse(result.body);
  assert.equal(body.mensaje, reply);
  assert.deepEqual(body.estado, previous);
  assert.equal(recommendations, 0);
  assert.doesNotMatch(body.mensaje, /140[.,]?000|14 personas|Buscaré hasta|Preferencias:/);
});


for (const version of ["happie.v1", "happie.v2"]) {
  test(`${version} external chat keeps resumen present and empty without losing message, data or headers`, async () => {
    const body = { schema_version: version, tipo: "recomendaciones", mensaje: "Estas son tus opciones de pizza.", resumen: "Estas son tus opciones de pizza.", estado: state, recomendaciones: [{ tipo: "servicio", id: "existing-id" }], servicios: [], paquetes: [] };
    const response = await manejarChatWebhookExterno(request(), async () => Response.json(body, { headers: { "cache-control": "no-store", "x-correlation-id": "existing-correlation" } }));
    const actual = await response.json();
    assert.deepEqual(actual, { ...body, resumen: "" });
    assert.ok(Object.hasOwn(actual, "resumen"));
    assert.equal(response.headers.get("x-correlation-id"), "existing-correlation");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
}

test("external chat leaves questions and errors untouched", async () => {
  for (const [status, body] of [[200, { tipo: "pregunta", mensaje: "¿Seguimos?", estado: state }], [429, { error: "Espera para reintentar." }]] as const) {
    const original = Response.json(body, { status, headers: { "retry-after": "60" } });
    const response = await manejarChatWebhookExterno(request(), async () => original);
    assert.equal(response, original);
    assert.deepEqual(await response.json(), body);
    assert.equal(response.headers.get("retry-after"), "60");
  }
});


test("legacy chat also responds naturally to detours without losing event context", async () => {
  const previous = { fase: "confirmacion" as const, tipoEvento: "Comida informal", invitados: 14, presupuesto: 140000, servicios: [] as [], preferencias: ["pizza"] };
  const reply = "Aquí seguimos con tu comida 🙂. ¿Quieres que busque las opciones de pizza?";
  const result = await procesarTurnoConversacion({ mensaje: "dame un hello world en js", estado: previous }, {
    extraer: async () => ({ ...extracted, respuestaConversacional: reply, confirmacion: "incierta" }),
    recomendar: async () => { throw new Error("A detour must not buy recommendations"); },
  });
  assert.deepEqual(result, { status: 200, body: { tipo: "pregunta", mensaje: reply, estado: previous } });
});


test("legacy thanks after recommendations sees the real completed event context", async () => {
  const previous = { fase: "finalizado" as const, tipoEvento: "Comida informal", invitados: 14, presupuesto: 140000, servicios: [] as [], preferencias: ["pizza"] };
  const reply = "¡Con gusto! Si quieres ajustar las opciones de pizza, aquí estoy.";
  const result = await procesarTurnoConversacion({ mensaje: "gracias", estado: previous }, {
    extraer: async (_, actual) => {
      assert.deepEqual(actual, previous);
      return { ...extracted, respuestaConversacional: reply, confirmacion: "incierta" };
    },
    recomendar: async () => { throw new Error("Thanks must not buy recommendations"); },
  });
  assert.deepEqual(result, { status: 200, body: { tipo: "pregunta", mensaje: reply, estado: previous } });
});
