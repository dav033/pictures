import assert from "node:assert/strict";
import { SESSION_COOKIE, sessionToken } from "../../src/lib/auth/session";
import { panelPruebaActivo } from "../../src/lib/happie/panel-prueba";
import { POST as recomendar } from "../../src/app/api/happie/prueba-api/recomendar/route";
import { GET as catalogo } from "../../src/app/api/happie/prueba-api/route";

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

  // Interruptor apagado: 404 aunque haya sesión.
  process.env.HAPPIE_PANEL_PRUEBA = "0";
  assert.equal(panelPruebaActivo(), false);
  assert.equal((await recomendar(post({ cookie: COOKIE, origin: BASE }))).status, 404);
  assert.equal((await catalogo(new Request(`${BASE}/api/happie/prueba-api`, { headers: { cookie: COOKIE } }))).status, 404);
  delete process.env.HAPPIE_PANEL_PRUEBA;
  assert.equal(panelPruebaActivo(), true);

  console.log("Panel de prueba de Happie: sesión, mismo origen, validación e interruptor PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
