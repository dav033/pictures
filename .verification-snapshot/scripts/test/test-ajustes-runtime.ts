import assert from "node:assert/strict";
import test from "node:test";
import { TTL_AJUSTE_MS, crearAjusteConCache, leerAjusteNeon, leerFilaAjuste, type ConsultaAjuste } from "../../src/lib/ajustes/ajustes-runtime";

/**
 * El lector de `ajustes_runtime` que comparten la bandera de la guiada, la de la hoja de armado y la visibilidad del catálogo
 * (REQ-013 T19): caché de 30 s por instancia, una sola consulta para las lecturas simultáneas, la última lectura buena cuando la
 * base falla, y el prefijo del aviso de quien lee. Sin Neon ni red.
 */

const consultaDe = (filas: Array<{ valor: string }>, vistas: Array<{ sql: string; valores: string[] }> = []): ConsultaAjuste => async (sql, valores) => {
  vistas.push({ sql, valores });
  return { rows: filas };
};

async function conAvisos<T>(fn: () => Promise<T>): Promise<{ resultado: PromiseSettledResult<T>; avisos: string[] }> {
  const avisos: string[] = [];
  const original = console.warn;
  console.warn = (...partes: unknown[]) => { avisos.push(partes.map(String).join(" ")); };
  try {
    return { resultado: await fn().then((value): PromiseFulfilledResult<T> => ({ status: "fulfilled", value }), (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason })), avisos };
  } finally {
    console.warn = original;
  }
}

test("el caché dura 30 s: dentro no se vuelve a leer, al vencer sí", async () => {
  const reloj = { ms: 1_000 };
  let lecturas = 0;
  let valor: string | null = "a";
  const vigente = crearAjusteConCache(async () => { lecturas += 1; return valor; }, () => reloj.ms);
  assert.equal(await vigente(), "a");
  valor = "b";
  reloj.ms += TTL_AJUSTE_MS - 1;
  assert.equal(await vigente(), "a");
  assert.equal(lecturas, 1);
  reloj.ms += 1;
  assert.equal(await vigente(), "b");
  assert.equal(lecturas, 2);
});

test("las lecturas simultáneas comparten una sola consulta", async () => {
  let lecturas = 0;
  const vigente = crearAjusteConCache(async () => { lecturas += 1; return "x"; }, () => 0);
  assert.deepEqual(await Promise.all([vigente(), vigente(), vigente()]), ["x", "x", "x"]);
  assert.equal(lecturas, 1);
});

test("con la base caída vale la última lectura buena (o «sin fila» si nunca la hubo) y se reintenta al vencer", async () => {
  const reloj = { ms: 0 };
  let falla = true;
  const vigente = crearAjusteConCache(async () => { if (falla) throw new Error("Neon caído"); return "activo"; }, () => reloj.ms);
  assert.equal(await vigente(), null, "sin lectura buena previa: sin fila");
  falla = false;
  reloj.ms += TTL_AJUSTE_MS;
  assert.equal(await vigente(), "activo");
  falla = true;
  reloj.ms += TTL_AJUSTE_MS;
  assert.equal(await vigente(), "activo", "Neon caído: la última buena");
});

test("leerFilaAjuste lee la clave pedida; sin fila o sin tabla es null y un fallo se avisa con el prefijo de quien leía y se lanza", async () => {
  const vistas: Array<{ sql: string; valores: string[] }> = [];
  assert.equal(await leerFilaAjuste(consultaDe([{ valor: "sempertex" }], vistas), "catalogo_repos_rag"), "sempertex");
  assert.equal(await leerFilaAjuste(consultaDe([]), "catalogo_repos_rag"), null);
  assert.match(vistas[0]!.sql, /FROM ajustes_runtime WHERE clave = \$1/);
  assert.deepEqual(vistas[0]!.valores, ["catalogo_repos_rag"]);

  const sinTabla = Object.assign(new Error("relation \"ajustes_runtime\" does not exist"), { code: "42P01" });
  assert.equal(await leerFilaAjuste(async () => { throw sinTabla; }, "catalogo_repos_rag"), null);

  const caida = async () => { throw Object.assign(new Error("Connection terminated"), { code: "57P01" }); };
  const porDefecto = await conAvisos(() => leerFilaAjuste(caida, "guiada_motor"));
  assert.equal(porDefecto.resultado.status, "rejected");
  assert.match(porDefecto.avisos[0]!, /^\[guiada-motor\] no se pudo leer guiada_motor de ajustes_runtime/);
  const delCatalogo = await conAvisos(() => leerFilaAjuste(caida, "catalogo_repos_rag", "catalogo"));
  assert.match(delCatalogo.avisos[0]!, /^\[catalogo\] no se pudo leer catalogo_repos_rag/);
});

test("leerAjusteNeon sin DATABASE_URL no hay base: sin fila, sin tocar el pool", async () => {
  const antes = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    assert.equal(await leerAjusteNeon("catalogo_repos_rag", "catalogo"), null);
  } finally {
    if (antes !== undefined) process.env.DATABASE_URL = antes;
  }
});

/** Una lectura que termina cuando el test lo dice (la base lenta), y cuántas veces se pidió. */
function lecturaLenta() {
  const pedidas: Array<{ terminar: (valor: string | null) => void; fallar: (error: Error) => void }> = [];
  const leer = () => new Promise<string | null>((resolver, rechazar) => { pedidas.push({ terminar: resolver, fallar: rechazar }); });
  return { leer, pedidas };
}
const unTurno = () => new Promise<void>((resolver) => setImmediate(resolver));
const PLAZO_DE_PRUEBA_MS = 25;

test("Neon lento sin lectura buena previa: la petición no espera más del plazo, sigue «sin fila» y la lectura deja su valor al terminar", async () => {
  const reloj = { ms: 1_000 };
  const { leer, pedidas } = lecturaLenta();
  const vigente = crearAjusteConCache(leer, () => reloj.ms, { plazoMs: PLAZO_DE_PRUEBA_MS, etiqueta: "catalogo_repos_rag" });
  const { resultado: primero, avisos } = await conAvisos(async () => {
    const inicio = Date.now();
    const valor = await vigente();
    return { valor, esperoMs: Date.now() - inicio };
  });
  assert.equal(primero.status, "fulfilled");
  const { valor, esperoMs } = (primero as PromiseFulfilledResult<{ valor: string | null; esperoMs: number }>).value;
  assert.equal(valor, null, "sin lectura buena previa: sin fila (deciden las variables de entorno)");
  assert.ok(esperoMs >= PLAZO_DE_PRUEBA_MS - 5 && esperoMs < 1_000, `esperó ${esperoMs} ms`);
  assert.match(avisos[0]!, /^\[ajustes\] catalogo_repos_rag tardó más de 25 ms/);

  assert.equal(await vigente(), null, "dentro del caché no se vuelve a esperar ni a leer");
  assert.equal(pedidas.length, 1);

  pedidas[0]!.terminar("sempertex,mobiliario");
  await unTurno();
  assert.equal(await vigente(), "sempertex,mobiliario", "la lectura terminó en segundo plano: las siguientes ven el valor nuevo");
  assert.equal(pedidas.length, 1);
});

test("Neon lento con una lectura buena previa: la petición sigue con ella; si la lectura tardía falla, la buena se queda", async () => {
  const reloj = { ms: 1_000 };
  const { leer, pedidas } = lecturaLenta();
  const vigente = crearAjusteConCache(leer, () => reloj.ms, { plazoMs: PLAZO_DE_PRUEBA_MS });
  const buena = vigente();
  pedidas[0]!.terminar("activo");
  assert.equal(await buena, "activo");

  reloj.ms += TTL_AJUSTE_MS;
  const { resultado } = await conAvisos(() => vigente());
  assert.deepEqual(resultado, { status: "fulfilled", value: "activo" }, "vence el caché, la base no responde a tiempo: vale la última buena");
  assert.equal(pedidas.length, 2);

  pedidas[1]!.fallar(new Error("Neon caído"));
  await unTurno();
  assert.equal(await vigente(), "activo", "la lectura tardía falló: la buena se queda");

  reloj.ms += TTL_AJUSTE_MS;
  const otra = conAvisos(() => vigente());
  await unTurno();
  pedidas[2]!.terminar("inactivo");
  assert.deepEqual((await otra).resultado, { status: "fulfilled", value: "inactivo" }, "si la base contesta dentro del plazo, el valor es el nuevo");
});

test("una lectura rápida no deja temporizadores vivos ni avisos", async () => {
  const { resultado, avisos } = await conAvisos(() => crearAjusteConCache(async () => "x", () => 0, { plazoMs: 60_000 })());
  assert.deepEqual(resultado, { status: "fulfilled", value: "x" });
  assert.deepEqual(avisos, []);
});
