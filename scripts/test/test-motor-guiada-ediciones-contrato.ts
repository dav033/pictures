/**
 * El contrato cliente↔ruta de `POST /api/guiada/motor/editar` (`guiada-motor/editar-contrato.ts`, REQ-007 fase 5). Sin red,
 * base ni IA: la ruta real (`atenderEditarMotor`) con dobles de bandera, caché y precio, y el cliente real
 * (`crearDependenciasEdicion3d`) con un `fetch` que le entrega la petición. Fija:
 *   - la URL y la forma exacta del cuerpo que manda el navegador (plan, turnoId, una de las tres ediciones);
 *   - la forma de la respuesta (`RespuestaEditarMotorSchema`) y que `turno` trae `{turnoId, antes, despues}` con el hash de la espec;
 *   - que cada `codigo` de fallo que emite el servidor está en `CODIGOS_FALLO_EDITAR` y que los fallos cumplen `FalloEditarMotorSchema`;
 *   - que el navegador solo importa tipos del motor y que Python no pasa por el contrato.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-motor-guiada-ediciones-contrato.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { afterEach, beforeEach } from "node:test";
import { sessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import { PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";
import { atenderPlanMotor, type DependenciasPlanMotor } from "../../src/lib/guiada-motor/plan-motor";
import { atenderEditarMotor, type DependenciasEditarMotor } from "../../src/lib/guiada-motor/editar-motor";
import { crearTopePorNavegador } from "../../src/lib/guiada-motor/tope-imagenes-navegador";
import {
  CODIGOS_FALLO_EDITAR, FalloEditarMotorSchema, RespuestaEditarMotorSchema, RUTA_EDITAR_MOTOR, TurnoEdicionSchema,
  type CuerpoEditarMotor, type EdicionDelCliente,
} from "../../src/lib/guiada-motor/editar-contrato";
import { RAZONES_RECALCULO } from "../../src/lib/guiada-motor/plan-contrato";
import { crearDependenciasEdicion3d, FalloMotor3dApagado } from "../../src/components/guiado/edicion-motor3d";
import { armarDesdeEspec, cotizarBom, crearCachePiezas, crosswalkIncluido, type EspecClienteV1 } from "../../src/lib/globos3d/motor/v1";
import { pythonDoble } from "../lib/python-doble-precio";

const CLAVE_APP = "clave-app-de-prueba";
const SESION = `${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}`;
const NAVEGADOR = "feedback_usuario=" + "d4".repeat(16);
const cruce = crosswalkIncluido();
const RAIZ = path.resolve(__dirname, "../..");

let anterior: Record<string, string | undefined> = {};
beforeEach(() => {
  anterior = { APP_PASSWORD: process.env.APP_PASSWORD, DATABASE_URL: process.env.DATABASE_URL, GUIADA_MOTOR: process.env.GUIADA_MOTOR };
  process.env.APP_PASSWORD = CLAVE_APP;
  delete process.env.DATABASE_URL;
  delete process.env.GUIADA_MOTOR;
});
afterEach(() => { for (const [clave, valor] of Object.entries(anterior)) { if (valor === undefined) delete process.env[clave]; else process.env[clave] = valor; } });

type Plan = ReturnType<typeof PlanGuiadoSchema.parse> & { espec: EspecClienteV1 };

function dependencias(corte = false): DependenciasEditarMotor {
  const cachePiezas = crearCachePiezas(64);
  let ids = 0;
  return {
    leerBandera: async () => (corte ? { motor: "python", fuente: "corte" } : { motor: "3d", fuente: "cookie" }),
    auditar: () => undefined,
    armar: (espec) => armarDesdeEspec(espec, { cachePiezas }),
    planGuardado: planGuardadoDeIdea,
    cotizar: (bom) => cotizarBom({ total: bom.total, porPieza: bom.porPieza }, { crosswalk: async () => cruce, cotizarLista: pythonDoble(cruce).cotizarLista }),
    nuevoId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    registrarPlan: async () => undefined,
    tomarEdicion: crearTopePorNavegador(1000).tomar,
  };
}

async function planDeArcoYColumnas(): Promise<Plan> {
  const base = dependencias();
  const deps: DependenciasPlanMotor = {
    leerBandera: base.leerBandera, auditar: base.auditar, planGuardado: planGuardadoDeIdea,
    cotizar: (bom) => cotizarBom({ total: bom.total, porPieza: bom.porPieza }, { crosswalk: async () => cruce, cotizarLista: pythonDoble(cruce).cotizarLista }),
    nuevoId: base.nuevoId, registrarPlan: base.registrarPlan,
  };
  const propuesta = { frase: "Te propongo una decoración.", colores: ["azul", "dorado"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 2 }] };
  const respuesta = await atenderPlanMotor(new Request("https://app.test/api/guiada/motor/plan", { method: "POST", headers: { "content-type": "application/json", cookie: [SESION, NAVEGADOR].join("; ") }, body: JSON.stringify({ desde: "propuesta", propuesta, brief: {} }) }), deps);
  assert.equal(respuesta.status, 200, "el plan de prueba se arma");
  return ((await respuesta.json()) as { plan: Plan }).plan;
}

type Capturada = { url: string; metodo: string; cabeceras: Record<string, string>; cuerpo: Record<string, unknown> };

/** El cliente real contra la ruta real: devuelve lo que el navegador mandó y lo que la ruta contestó. */
function cliente(deps: DependenciasEditarMotor, cookie = [SESION, NAVEGADOR].join("; ")) {
  const capturas: Capturada[] = [];
  const respuestas: Array<{ estado: number; json: Record<string, unknown> }> = [];
  const red = (async (url: RequestInfo | URL, init?: RequestInit) => {
    capturas.push({ url: String(url), metodo: String(init?.method), cabeceras: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)), cuerpo: JSON.parse(init?.body as string) as Record<string, unknown> });
    const respuesta = await atenderEditarMotor(new Request(`https://app.test${String(url)}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: init?.body as string }), deps);
    respuestas.push({ estado: respuesta.status, json: await respuesta.clone().json() as Record<string, unknown> });
    return respuesta;
  }) as typeof fetch;
  return { dependencias: crearDependenciasEdicion3d({ red }), capturas, respuestas };
}

const EDICIONES: Record<string, EdicionDelCliente> = {
  ops: { tipo: "ops", ediciones: [{ op: "reemplazar_color", de: "azul", a: "rojo", piezas: ["EST_01_ARCO"] }] },
  pedido: { tipo: "pedido", pedido: { tipo: "reemplazar_color", color: "azul", colorNuevo: "rojo", piezas: [] } },
  cambio: { tipo: "cambio", cambio: { tipo: "tamano-todo", direccion: 1 } },
};

test("la URL del contrato es /api/guiada/motor/editar y la ruta existe", () => {
  assert.equal(RUTA_EDITAR_MOTOR, "/api/guiada/motor/editar");
  const ruta = readFileSync(path.join(RAIZ, "src/app/api/guiada/motor/editar/route.ts"), "utf8");
  assert.match(ruta, /atenderEditarMotor/);
});

for (const [forma, edicion] of Object.entries(EDICIONES)) {
  test(`el navegador manda {plan, turnoId, edicion} (${forma}) y la ruta devuelve la respuesta del contrato con el turno`, async () => {
    const plan = await planDeArcoYColumnas();
    const c = cliente(dependencias());
    const hecho = await c.dependencias.editar(plan, edicion, { turnoId: "msj-contrato-1" });

    const [enviada] = c.capturas;
    assert.equal(enviada!.url, RUTA_EDITAR_MOTOR);
    assert.equal(enviada!.metodo, "POST");
    assert.equal(enviada!.cabeceras["Content-Type"], "application/json");
    assert.deepEqual(Object.keys(enviada!.cuerpo).sort(), ["edicion", "plan", "turnoId"], "el cuerpo no trae nada más");
    const cuerpo = enviada!.cuerpo as unknown as CuerpoEditarMotor;
    assert.equal(cuerpo.turnoId, "msj-contrato-1");
    assert.deepEqual(cuerpo.edicion, edicion);
    assert.equal(cuerpo.plan.plan_hash, plan.plan_hash, "va el plan vigente tal cual, con su token y su espec firmada");

    assert.equal(c.respuestas[0]!.estado, 200);
    const leida = RespuestaEditarMotorSchema.parse(c.respuestas[0]!.json);
    assert.deepEqual(hecho, leida, "el cliente entrega lo que valida el esquema");
    assert.notEqual(leida.plan.plan_hash, plan.plan_hash, "plan nuevo, hash nuevo");
    assert.notEqual(leida.plan.approval_token, plan.approval_token, "token nuevo");
    assert.ok(leida.descripcion && leida.confirmacion);
    assert.ok(leida.tocadas.length > 0 || leida.noAplicadas.length > 0);

    // El turno es lo que la calificación necesita: el id del turno y la espec de antes y de después con su hash.
    const turno = TurnoEdicionSchema.parse(leida.turno);
    assert.equal(turno.turnoId, "msj-contrato-1");
    // El hash del plan ES el hash de su espec firmada: el de antes es el del plan que se mandó, el de después el del nuevo.
    assert.equal(turno.antes.especHash, plan.plan_hash);
    assert.equal(turno.despues.especHash, leida.plan.plan_hash);
    assert.ok(turno.antes.espec && turno.despues.espec, "el turno trae la espec de antes y de después");
    assert.notDeepEqual(turno.antes.espec, turno.despues.espec);
    assert.notEqual(turno.antes.especHash, turno.despues.especHash);
  });
}

test("sin turnoId el servidor genera uno y el turno lo devuelve", async () => {
  const plan = await planDeArcoYColumnas();
  const c = cliente(dependencias());
  const hecho = await c.dependencias.editar(plan, EDICIONES.cambio!);
  assert.equal("turnoId" in c.capturas[0]!.cuerpo, false, "el cliente no manda un turnoId vacío");
  assert.ok(hecho.turno.turnoId.length > 0);
});

test("la respuesta del servidor es estricta: un campo de más o de menos no pasa el esquema", async () => {
  const plan = await planDeArcoYColumnas();
  const c = cliente(dependencias());
  await c.dependencias.editar(plan, EDICIONES.cambio!);
  const buena = c.respuestas[0]!.json;
  assert.equal(RespuestaEditarMotorSchema.safeParse({ ...buena, extra: 1 }).success, false);
  const sinTurno = Object.fromEntries(Object.entries(buena).filter(([clave]) => clave !== "turno"));
  assert.equal(RespuestaEditarMotorSchema.safeParse(sinTurno).success, false);
  assert.equal(TurnoEdicionSchema.safeParse({ turnoId: "", antes: { especHash: "a", espec: {} }, despues: { especHash: "b", espec: {} } }).success, false);
});

test("los fallos de la ruta cumplen FalloEditarMotorSchema y su codigo está en CODIGOS_FALLO_EDITAR", async () => {
  const plan = await planDeArcoYColumnas();
  const emitidos: Array<{ nombre: string; estado: number; codigo: string }> = [];
  const registrar = (nombre: string, r: { estado: number; json: Record<string, unknown> }) => {
    const fallo = FalloEditarMotorSchema.parse(r.json);
    assert.ok((CODIGOS_FALLO_EDITAR as readonly string[]).includes(fallo.codigo), `${nombre}: ${fallo.codigo} está en el contrato`);
    emitidos.push({ nombre, estado: r.estado, codigo: fallo.codigo });
  };
  const peticion = (cookie: string, cuerpo: unknown) => atenderEditarMotor(new Request("https://app.test/api/guiada/motor/editar", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(cuerpo) }), dependencias());
  const leer = async (r: Response) => ({ estado: r.status, json: await r.json() as Record<string, unknown> });

  registrar("sin sesión", await leer(await peticion(NAVEGADOR, { plan, edicion: EDICIONES.cambio })));
  registrar("cuerpo inválido", await leer(await peticion([SESION, NAVEGADOR].join("; "), { plan, edicion: { tipo: "inventada" } })));
  const alterado = { ...plan, plan_hash: "0".repeat(plan.plan_hash.length) };
  registrar("plan alterado", await leer(await peticion([SESION, NAVEGADOR].join("; "), { plan: alterado, edicion: EDICIONES.cambio })));
  registrar("sin pieza que cambiar", await leer(await peticion([SESION, NAVEGADOR].join("; "), { plan, edicion: { tipo: "ops", ediciones: [{ op: "reemplazar_color", de: "verde", a: "rojo", piezas: [] }] } })));
  assert.equal(emitidos[0]!.codigo, "SESION_REQUERIDA");
  assert.equal(emitidos[0]!.estado, 401);
  assert.equal(emitidos[1]!.codigo, "CUERPO_INVALIDO");
  assert.equal(emitidos[1]!.estado, 400);
  assert.deepEqual(emitidos[2], { nombre: "plan alterado", estado: 409, codigo: "APROBACION_INVALIDA" });
  assert.deepEqual(emitidos[3], { nombre: "sin pieza que cambiar", estado: 400, codigo: "CUERPO_INVALIDO" }, "piezas vacías las rechaza el esquema de la petición");
  assert.equal(emitidos.length, 4);
});

test("con el corte del 3D la ruta no cambia el plan y dice la razón del recálculo; el cliente lo muestra como FalloMotor3dApagado", async () => {
  const plan = await planDeArcoYColumnas();
  const c = cliente(dependencias(true));
  await assert.rejects(() => c.dependencias.editar(plan, EDICIONES.cambio!), (error: unknown) => error instanceof FalloMotor3dApagado && (RAZONES_RECALCULO as readonly string[]).includes(error.razon));
  const fallo = FalloEditarMotorSchema.parse(c.respuestas[0]!.json);
  assert.equal(fallo.codigo, "MOTOR_3D_CORTADO");
  assert.equal(c.respuestas[0]!.estado, 409);
  assert.ok(fallo.fallback && (RAZONES_RECALCULO as readonly string[]).includes(fallo.fallback.razon));
});

test("todo codigo que editar-motor.ts emite está en CODIGOS_FALLO_EDITAR (y la lista no guarda códigos que nadie emite)", () => {
  const fuente = readFileSync(path.join(RAIZ, "src/lib/guiada-motor/editar-motor.ts"), "utf8");
  const usados = new Set([...fuente.matchAll(/\b(?:error|rechazar)\(\s*["']([A-Z][A-Z0-9_]+)["']/g)].map((m) => m[1]!));
  assert.ok(usados.size > 3, "se leyeron los códigos que emite la ruta");
  const sinTipo = [...usados].filter((codigo) => !(CODIGOS_FALLO_EDITAR as readonly string[]).includes(codigo));
  assert.deepEqual(sinTipo, [], "códigos usados por el servidor y ausentes del contrato");
  const huerfanos = CODIGOS_FALLO_EDITAR.filter((codigo) => !fuente.includes(codigo) && !readFileSync(path.join(RAIZ, "src/lib/guiada-motor/verificar-plan.ts"), "utf8").includes(codigo));
  assert.deepEqual(huerfanos, [], "códigos del contrato que ningún módulo del servidor emite");
});

test("el contrato no arrastra código de servidor ni de Python: solo zod, esquemas y tipos", () => {
  const fuente = readFileSync(path.join(RAIZ, "src/lib/guiada-motor/editar-contrato.ts"), "utf8");
  const importaciones = [...fuente.matchAll(/^import (type )?.*from "([^"]+)"/gm)].map((m) => ({ tipo: Boolean(m[1]), modulo: m[2]! }));
  assert.doesNotMatch(fuente, /^import .*server-only/m);
  for (const { tipo, modulo } of importaciones) {
    if (modulo.startsWith("@/lib/globos3d")) assert.ok(tipo, `${modulo}: del motor el navegador solo importa tipos`);
    assert.doesNotMatch(modulo, /python|adapter|nucleo/, `${modulo}: el contrato no toca Python`);
  }
});
