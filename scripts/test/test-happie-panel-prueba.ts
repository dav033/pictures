import assert from "node:assert/strict";
import { z } from "zod";
import { ejecutarWebhook } from "../../src/lib/happie/webhook-control";
import { ambitoDeSesion } from "../../src/lib/happie/panel-prueba";
import { SESSION_COOKIE, sessionToken } from "../../src/lib/auth/session";
import { panelPruebaActivo } from "../../src/lib/happie/panel-prueba";
import { POST as recomendar } from "../../src/app/api/happie/prueba-api/recomendar/route";
import { GET as catalogo } from "../../src/app/api/happie/prueba-api/route";
import { POST as conversar } from "../../src/app/api/happie/conversar/route";

// Permisos del panel /happie/prueba: la sesión y el mismo origen se exigen ANTES de tocar la IA, el catálogo o la base
// de datos, y el interruptor HAPPIE_PANEL_PRUEBA=0 apaga todo. Ninguna de estas rutas llega a un proveedor.

const CLAVE_APP = "panel-test-password";
const COOKIE = `${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}`;
const BASE = "http://localhost:3000";
const CUERPO_VALIDO = JSON.stringify({ tipoEvento: "Cumpleaños", invitados: 20, presupuesto: 2_000_000 });

function post(headers: Record<string, string>, body = CUERPO_VALIDO): Request {
  return new Request(`${BASE}/api/happie/prueba-api/recomendar`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
}

async function main() {
  process.env.APP_PASSWORD = CLAVE_APP;
  delete process.env.HAPPIE_PANEL_PRUEBA;
  delete process.env.DEV_REQUIRE_LOGIN;

  // Sin sesión: 401 sobre el contrato de errores de Happie.
  const sinSesion = await recomendar(post({}));
  assert.equal(sinSesion.status, 401);
  assert.equal((await sinSesion.json()).schema_version, "happie.v1");
  assert.equal((await catalogo(new Request(`${BASE}/api/happie/prueba-api`))).status, 401);

  // Con sesión pero desde otro origen: 403, sin llegar al generador.
  const otroOrigen = await recomendar(post({ cookie: COOKIE, origin: "https://evil.example" }));
  assert.equal(otroOrigen.status, 403);

  // Con sesión y mismo origen, un body inválido es un 400 de validación (antes de la tasa y de la IA).
  const invalido = await recomendar(post({ cookie: COOKIE, origin: BASE }, JSON.stringify({ tipoEvento: "x" })));
  assert.equal(invalido.status, 400);
  assert.ok(Array.isArray((await invalido.json()).campos));
  const noJson = await recomendar(post({ cookie: COOKIE, origin: BASE }, "no es json"));
  assert.equal(noJson.status, 400);

  // El chat de /happie (conversar): misma conversación del webhook con la sesión como credencial.
  const turno = (headers: Record<string, string>, body: string) =>
    new Request(`${BASE}/api/happie/conversar`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  const mensajeValido = JSON.stringify({ mensaje: "quiero un cumpleaños" });
  assert.equal((await conversar(turno({}, mensajeValido))).status, 401, "conversar sin sesión");
  assert.equal((await conversar(turno({ cookie: COOKIE, origin: "https://evil.example" }, mensajeValido))).status, 403, "conversar desde otro origen");
  const sinMensaje = await conversar(turno({ cookie: COOKIE, origin: BASE }, JSON.stringify({ estado: { fase: "descubrimiento", servicios: [], preferencias: [] } })));
  assert.equal(sinMensaje.status, 400, "conversar sin mensaje es un 400 de validación");
  assert.equal((await conversar(turno({ cookie: COOKIE, origin: BASE }, "no es json"))).status, 400);

  // Límite de tasa: un llamador con sesión se cuenta por su IP; el x-api-key que mande no le da un contador nuevo, y dos
  // IP distintas no comparten contador. Sin ámbito (webhook) sigue contando por el digest de la key.
  const ambitos: string[] = [];
  const almacen = {
    rate: async (scope: string) => { ambitos.push(scope); return true; },
    claim: async () => "claimed" as const,
    finish: async () => {},
  };
  const llamar = (headers: Record<string, string>, ambito?: string) =>
    ejecutarWebhook(
      new Request(`${BASE}/x`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" }),
      "prueba", null, z.object({}).passthrough(), async () => ({ status: 200, body: {} }), almacen, ambito,
    );
  const ip = (cabeceras: Record<string, string>) => ambitoDeSesion(new Request(`${BASE}/x`, { headers: cabeceras }));
  await llamar({ "x-api-key": "uno" }, ip({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }));
  await llamar({ "x-api-key": "otro" }, ip({ "x-forwarded-for": "1.2.3.4" }));
  await llamar({}, ip({ "x-forwarded-for": "5.6.7.8" }));
  assert.equal(ambitos[0], ambitos[1], "mismo IP, distinta x-api-key: el mismo contador");
  assert.notEqual(ambitos[0], ambitos[2], "otro IP: otro contador");
  await llamar({ "x-api-key": "uno" });
  await llamar({ "x-api-key": "otro" });
  assert.notEqual(ambitos[3], ambitos[4], "el webhook sigue contando por su key");

  // Interruptor apagado: 404 aunque haya sesión.
  process.env.HAPPIE_PANEL_PRUEBA = "0";
  assert.equal(panelPruebaActivo(), false);
  assert.equal((await recomendar(post({ cookie: COOKIE, origin: BASE }))).status, 404);
  assert.equal((await catalogo(new Request(`${BASE}/api/happie/prueba-api`, { headers: { cookie: COOKIE } }))).status, 404);
  delete process.env.HAPPIE_PANEL_PRUEBA;
  assert.equal(panelPruebaActivo(), true);

  console.log("Panel de prueba de Happie: sesión, mismo origen, validación (panel y chat) e interruptor PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
