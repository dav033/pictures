import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { AsistenteGuiadoRequestSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import decoracionesRaw from "@/lib/biblioteca-sempertex/decoraciones.json";
import { DecoracionSempertexSchema } from "@/lib/biblioteca-sempertex/esquemas";
import { propuestaAgregarIdea } from "@/components/guiado/agregar-idea";
import {
  avanzarOpcionIdea,
  accionIdeaAlElegirUso,
  estadoDelTurnoDeIdea,
  ideasTrasArmarIdea,
  marcarChipAlElegir,
  resultadoPlanIdea,
  rutaOpcionIdea,
  TEXTO_OPCION_IDEA,
  type EsperaOpcionIdea,
} from "@/components/guiado/opcion-idea";
import { respuestaPrecioPlan } from "@/components/guiado/precio-chat";

/**
 * REQ-015 T4/T8: los chips «Cuánto cuesta» y «Aprender a hacerlo» de una idea elegida usan el plan exacto guardado de la
 * idea, sin modelo, y su ciclo (éxito, fallo, detener, reinicio, figura, plan ajeno) es una máquina pura. Sin red ni
 * modelo: `npx tsx scripts/test/test-opcion-idea-guiada.ts`.
 */

const vista = readFileSync("src/components/guiado/VistaGuiada.tsx", "utf8");
// ── Ruta del chip ───────────────────────────────────────────────────────────────────────────────────────────────
const sinPlan = { hayIdea: true, hayPlan: false, ideaEnElPlan: false };
assert.equal(rutaOpcionIdea("costear", sinPlan), "plan-exacto-de-idea");
assert.equal(rutaOpcionIdea("aprender", sinPlan), "plan-exacto-de-idea");
assert.equal(rutaOpcionIdea("costear", { hayIdea: true, hayPlan: true, ideaEnElPlan: true }), "accion-plan");
assert.equal(rutaOpcionIdea("costear", { hayIdea: false, hayPlan: true, ideaEnElPlan: false }), "accion-plan");
assert.equal(rutaOpcionIdea("costear", { hayIdea: true, hayPlan: true, ideaEnElPlan: false }), "turno-reglas", "an existing plan A is neither replaced by idea B nor redirected to the model: the rule path prices B alone");
assert.equal(rutaOpcionIdea("aprender", { hayIdea: true, hayPlan: true, ideaEnElPlan: false }), "turno-reglas");
assert.equal(marcarChipAlElegir("turno-reglas"), true, "the rule turn accepts the action at once");
assert.match(vista, /ruta === "turno-reglas" && seleccionada[\s\S]{0,200}void enviar\(TEXTO_OPCION_IDEA\[opcion\]\(seleccionada\.titulo\), \{ accionIdea: opcion \}\)/, "idea B beside plan A goes straight to the rule turn with accionIdea");
assert.equal(accionIdeaAlElegirUso({ hayIdea: true, hayPlan: true, ideaEnElPlan: false }), "costear");
const contextoDeB = estadoDelTurnoDeIdea({ uso: "personal", planActual: { piezas: ["A"] }, motorPlan: "3d", alcancePropuesta: "completa", piezaPedida: "columna", ideasMostradas: [{ id: "B" }] }, "costear", "B");
assert.deepEqual(contextoDeB, { uso: "personal", ideasMostradas: [{ id: "B" }], decoracionId: "B", accionIdea: "costear" }, "an explicit idea action excludes the old plan and scope from the unchanged API contract");
assert.deepEqual(ideasTrasArmarIdea({ id: "B", sumada: false }, ["A"]), ["B"]);
assert.deepEqual(ideasTrasArmarIdea({ id: "B", sumada: true }, ["A"]), ["A", "B"]);
assert.ok(AsistenteGuiadoRequestSchema.safeParse({ schema_version: "asistente-guiado.v1", messages: [{ role: "user", content: "Cuánto cuesta" }], brief: {}, estadoGuiado: estadoDelTurnoDeIdea({ planActual: {}, alcancePropuesta: "completa" }, "costear", "deco-b") }).success);
assert.match(vista, /const estadoGuiado = estadoDelTurnoDeIdea\(/);
assert.match(vista, /const elegida = seleccionada && \(accionIdea \|\| !planVigente\)/);
assert.doesNotMatch(vista, /if \(!decoracion \|\| planVigente\)/, "retrying B preserves its existing bubble while unrelated plan A remains");
assert.equal(rutaOpcionIdea("costear", { hayIdea: false, hayPlan: false, ideaEnElPlan: false }), "chat", "sin idea ni plan sigue el camino de siempre");
assert.equal(rutaOpcionIdea("comprar", sinPlan), "chat");
assert.equal(rutaOpcionIdea("contratar", sinPlan), "chat");

// [P1] El chip solo queda elegido cuando su acción se aceptó: el del plan exacto espera al plan.
assert.equal(marcarChipAlElegir("plan-exacto-de-idea"), false, "el chip del plan exacto no se marca al tocarlo");
assert.equal(marcarChipAlElegir("accion-plan"), true);
assert.equal(marcarChipAlElegir("chat"), true);

// [P1] Cotizar una idea no depende de poder sumarla a un plan: la columna con balón (figura con plan guardado) no se
// puede agregar, pero su chip pide su plan exacto igual.
const decoraciones = DecoracionSempertexSchema.array().parse(decoracionesRaw);
const balon = decoraciones.find((decoracion) => decoracion.id === "deco-real-30-columna-balon-futbol");
assert.ok(balon, "la idea de la columna con balón sigue en la biblioteca");
const agregable = propuestaAgregarIdea(balon, null);
assert.equal(agregable.ok, false, "la figura sigue sin poder sumarse a un plan");
assert.equal(rutaOpcionIdea("costear", sinPlan), "plan-exacto-de-idea", "la ruta del chip no mira si la idea se puede agregar");

// ── Resultado del pedido del plan exacto ────────────────────────────────────────────────────────────────────────
assert.equal(resultadoPlanIdea({ ok: true }, false), "ok");
assert.equal(resultadoPlanIdea({ ok: false, estado: 404, detenido: false }, false), "sin-plan-guardado");
assert.equal(resultadoPlanIdea({ ok: false, estado: 502, detenido: false }, false), "fallo");
assert.equal(resultadoPlanIdea({ ok: false, estado: 422, detenido: false }, false), "sin-plan-guardado", "una idea que no se puede armar sola no se ofrece a reintentar para siempre");
assert.equal(resultadoPlanIdea({ ok: false, estado: null, detenido: true }, true), "fallo", "el plazo vencido es un fallo, no un «Detener»");
assert.equal(resultadoPlanIdea({ ok: false, estado: null, detenido: true }, false), "detenido");

// ── Ciclo de la acción pendiente ────────────────────────────────────────────────────────────────────────────────
const espera: EsperaOpcionIdea = { accion: "costear", ideaId: "i1", mensajeId: "m-plan", sesion: 3, opcionesId: "m-chips" };

// Éxito: el plan exacto llega en ESE mensaje y lleva la idea → se resuelve, en cualquier orden con el «ok».
let paso = avanzarOpcionIdea(espera, { tipo: "resultado", mensajeId: "m-plan", resultado: "ok" });
assert.deepEqual(paso, { espera }, "«ok» sigue esperando a que el plan esté a la vista");
paso = avanzarOpcionIdea(espera, { tipo: "plan", mensajeId: "m-plan", ideas: ["i1"], sesion: 3 });
assert.deepEqual(paso, { espera: null, resolver: espera });
assert.deepEqual(avanzarOpcionIdea(null, { tipo: "resultado", mensajeId: "m-plan", resultado: "ok" }), { espera: null }, "un «ok» tras resolver no hace nada");

// [P1] Fallo del plan (502, plazo): nada de modelo; se ofrece reintentar ESTA acción y el chip sigue disponible.
assert.deepEqual(avanzarOpcionIdea(espera, { tipo: "resultado", mensajeId: "m-plan", resultado: "fallo" }), { espera: null, reintento: espera });
assert.deepEqual(avanzarOpcionIdea(espera, { tipo: "resultado", mensajeId: "m-plan", resultado: "detenido" }), { espera: null, reintento: espera });
// Sin plan guardado (figuras y ejemplos sin plan) o que no se arma sola: la misma petición del cliente va al servidor con
// `accionIdea`, que cotiza su lista curada o da sus pasos por reglas, sin modelo (D-043; test-accion-idea-guiada.ts).
assert.deepEqual(avanzarOpcionIdea(espera, { tipo: "resultado", mensajeId: "m-plan", resultado: "sin-plan-guardado" }), { espera: null, turnoReglas: espera });
assert.deepEqual(avanzarOpcionIdea(espera, { tipo: "resultado", mensajeId: "m-plan", resultado: "obsoleto" }), { espera: null });

// [P2] El resultado de un pedido viejo (otro mensaje: p. ej. antes de «Empezar de nuevo») no toca la acción de ahora.
assert.deepEqual(avanzarOpcionIdea(espera, { tipo: "resultado", mensajeId: "viejo", resultado: "obsoleto" }), { espera });
assert.deepEqual(avanzarOpcionIdea(espera, { tipo: "resultado", mensajeId: "viejo", resultado: "fallo" }), { espera });

// [P2] Reinicio y otra acción la descartan; un plan de otra conversación, de otro mensaje o sin la idea no la dispara.
assert.deepEqual(avanzarOpcionIdea(espera, { tipo: "reinicio" }), { espera: null });
assert.deepEqual(avanzarOpcionIdea(espera, { tipo: "otra-accion" }), { espera: null });
assert.deepEqual(avanzarOpcionIdea(espera, { tipo: "plan", mensajeId: "m-plan", ideas: ["i1"], sesion: 4 }), { espera: null }, "otra conversación: se descarta");
assert.deepEqual(avanzarOpcionIdea(espera, { tipo: "plan", mensajeId: "otro", ideas: ["i1"], sesion: 3 }), { espera }, "el plan de «Crear mi plan» en otro mensaje no la dispara");
assert.deepEqual(avanzarOpcionIdea(espera, { tipo: "plan", mensajeId: "m-plan", ideas: ["otra"], sesion: 3 }), { espera }, "un plan sin la idea no la dispara");
assert.deepEqual(avanzarOpcionIdea(espera, { tipo: "plan", mensajeId: null, ideas: [], sesion: 3 }), { espera });
assert.deepEqual(avanzarOpcionIdea(null, { tipo: "plan", mensajeId: "m-plan", ideas: ["i1"], sesion: 3 }), { espera: null }, "sin acción pendiente, un plan nuevo no abre el precio");

// [P3] Una sola petición del cliente: la del chip, que es también la del turno de siempre si hace falta.
assert.equal(TEXTO_OPCION_IDEA.costear(null), "Quiero saber cuánto cuestan los materiales.");
assert.equal(TEXTO_OPCION_IDEA.aprender("Arco rosa"), "Quiero aprender a hacerlo: armar «Arco rosa» paso a paso.");
assert.equal(TEXTO_OPCION_IDEA.aprender(null), "Quiero aprender a hacerlo paso a paso.");

// El precio que dice el chat es el cotizacion.total del plan guardado de la idea, el mismo de la tarjeta.
assert.match(respuestaPrecioPlan({ cotizacion: { total: 132656, incluyeIva: true } }, "personal"), /132\.656/);
console.log("test-opcion-idea-guiada: los chips de la idea usan su plan guardado, sin modelo, y su ciclo es seguro");
