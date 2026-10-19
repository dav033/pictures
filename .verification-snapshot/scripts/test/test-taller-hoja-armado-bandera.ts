/**
 * La bandera de la «Hoja de armado» del Taller 3D (`taller_hoja_armado`): apagada por defecto; la fila de `ajustes_runtime`
 * manda sobre la variable `TALLER_HOJA_ARMADO`; un valor inventado no enciende nada; con Neon caído vale la última lectura
 * buena o la variable. Y la ruta: pide sesión y no se cachea. Sin Neon ni red.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-taller-hoja-armado-bandera.ts
 */
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { sessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import { TTL_AJUSTE_MS } from "../../src/lib/guiada-motor/bandera";
import { CLAVE_AJUSTE_HOJA_ARMADO, crearLectorHojaArmado, leerFilaHojaArmado } from "../../src/lib/taller/hoja-armado-bandera";
import { LecturaHojaArmadoSchema, RUTA_HOJA_ARMADO } from "../../src/lib/taller/hoja-armado-bandera-tipos";
import { GET } from "../../src/app/api/taller/hoja-armado/route";

type Lectura = string | null | (() => Promise<string | null>);

function montar(extra: { ajuste?: Lectura; env?: string; reloj?: { ms: number } } = {}) {
  const reloj = extra.reloj ?? { ms: 1_000 };
  const lecturas = { ajuste: 0 };
  const leer = crearLectorHojaArmado({
    leerAjuste: async () => {
      lecturas.ajuste += 1;
      return typeof extra.ajuste === "function" ? extra.ajuste() : (extra.ajuste ?? null);
    },
    env: () => extra.env,
    ahora: () => reloj.ms,
  });
  return { leer, lecturas, reloj };
}

test("sin nada configurado la hoja está apagada", async () => {
  assert.deepEqual(await montar().leer(), { activa: false, fuente: "defecto" });
});

test("la variable de entorno la enciende o la apaga", async () => {
  assert.deepEqual(await montar({ env: "activo" }).leer(), { activa: true, fuente: "env" });
  assert.deepEqual(await montar({ env: " ACTIVO " }).leer(), { activa: true, fuente: "env" });
  assert.deepEqual(await montar({ env: "inactivo" }).leer(), { activa: false, fuente: "env" });
});

test("la fila de ajustes_runtime manda sobre la variable", async () => {
  assert.deepEqual(await montar({ ajuste: "inactivo", env: "activo" }).leer(), { activa: false, fuente: "ajuste" });
  assert.deepEqual(await montar({ ajuste: "activo", env: "inactivo" }).leer(), { activa: true, fuente: "ajuste" });
});

test("un valor inventado no enciende nada: se pasa al siguiente", async () => {
  for (const valor of ["true", "1", "si", "on", ""]) {
    assert.deepEqual(await montar({ ajuste: valor }).leer(), { activa: false, fuente: "defecto" }, valor);
    assert.deepEqual(await montar({ ajuste: valor, env: "activo" }).leer(), { activa: true, fuente: "env" }, valor);
  }
});

test("la fila se lee una vez cada 30 s y, con Neon caído, sigue la última lectura buena", async () => {
  let valor: string | null = "activo";
  let falla = false;
  const { leer, lecturas, reloj } = montar({ env: "inactivo", ajuste: async () => { if (falla) throw new Error("Neon caído"); return valor; } });
  assert.equal((await leer()).activa, true);
  valor = "inactivo";
  assert.equal((await leer()).activa, true, "dentro del caché no se vuelve a leer");
  assert.equal(lecturas.ajuste, 1);
  falla = true;
  reloj.ms += TTL_AJUSTE_MS + 1;
  assert.deepEqual(await leer(), { activa: true, fuente: "ajuste" }, "Neon caído: vale la última lectura buena");
  falla = false;
  reloj.ms += TTL_AJUSTE_MS + 1;
  assert.deepEqual(await leer(), { activa: false, fuente: "ajuste" });
});

test("la fila se lee de ajustes_runtime; un fallo de la base se avisa como [taller-hoja-armado] y se lanza; sin tabla no hay fila", async () => {
  const pedidas: Array<{ sql: string; valores: string[] }> = [];
  assert.equal(await leerFilaHojaArmado(async (sql, valores) => { pedidas.push({ sql, valores }); return { rows: [{ valor: "activo" }] }; }), "activo");
  assert.deepEqual(pedidas.map((p) => p.valores), [[CLAVE_AJUSTE_HOJA_ARMADO]]);
  const avisos: string[] = [];
  const avisar = console.warn;
  console.warn = (...partes: unknown[]) => { avisos.push(partes.map(String).join(" ")); };
  try {
    await assert.rejects(leerFilaHojaArmado(async () => { throw new Error("Neon caído"); }), /Neon caído/);
  } finally {
    console.warn = avisar;
  }
  assert.equal(avisos.length, 1);
  assert.match(avisos[0]!, /^\[taller-hoja-armado\] no se pudo leer taller_hoja_armado de ajustes_runtime/);
  assert.equal(await leerFilaHojaArmado(async () => { throw Object.assign(new Error("no existe"), { code: "42P01" }); }), null);
});

// ---------------------------------------------------------------------------------------------------------------------
// La ruta
// ---------------------------------------------------------------------------------------------------------------------

const CLAVE_APP = "clave-app-de-prueba";
const guardadas: Record<string, string | undefined> = {};
const VARIABLES = ["APP_PASSWORD", "TALLER_HOJA_ARMADO", "DATABASE_URL"] as const;
beforeEach(() => {
  for (const v of VARIABLES) guardadas[v] = process.env[v];
  process.env.APP_PASSWORD = CLAVE_APP;
  delete process.env.DATABASE_URL;
});
afterEach(() => {
  for (const v of VARIABLES) if (guardadas[v] === undefined) delete process.env[v]; else process.env[v] = guardadas[v];
});

const peticion = (conSesion: boolean) => new Request(`https://app.test${RUTA_HOJA_ARMADO}`, { headers: conSesion ? { cookie: `${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}` } : {} });

test("la ruta pide sesión", async () => {
  const respuesta = await GET(peticion(false));
  assert.equal(respuesta.status, 401);
  assert.equal(respuesta.headers.get("cache-control"), "no-store");
});

test("la ruta dice la bandera, sin caché, con la forma que lee el navegador", async () => {
  process.env.TALLER_HOJA_ARMADO = "activo";
  const respuesta = await GET(peticion(true));
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.headers.get("cache-control"), "no-store");
  assert.deepEqual(LecturaHojaArmadoSchema.parse(await respuesta.json()), { activa: true, fuente: "env" });
});
