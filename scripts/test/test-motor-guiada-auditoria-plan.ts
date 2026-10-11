/**
 * La auditoría DURABLE del motor 3D de la vista guiada (`src/lib/guiada-motor/auditoria-plan.ts`). `decidir` y `conRegistro`
 * solo escriben a stdout y a /tmp: en Vercel stdout dura ~30 minutos y /tmp muere con la instancia, y el 3D no llama a Python
 * `/plan/resolve`, así que `plan_audit_log` no recibió ninguna fila desde que `guiada_motor=3d` quedó encendida para todos.
 * Sin coste, sin red ni Neon: la base es un doble que guarda la consulta.
 * - la fila usa las columnas de `plan_audit_log` que ya escriben Python y TypeScript (sin migración), con el estado, el hash, la
 *   ruta, el total, las variantes compradas y la conversación; se espera a que termine (en Vercel una promesa suelta se pierde)
 *   y nunca tumba ni retrasa de más el plan del cliente;
 * - cada plan nuevo, plan rehecho, idea sumada, cambio hecho o rechazado, fallo que manda a Python y «¿cuánto cuesta?» de una
 *   idea deja su fila, con el mismo request_id con que se pidió el precio a Python;
 * - nada de lo que escribió el cliente (la temática, la frase, el nombre de una pieza) llega a la fila, y de lo que manda el
 *   navegador (hash del plan, id de turno, id de idea, motivo de una pieza que no se arma) solo entra lo que tiene forma de código;
 * - un INSERT que falla o tarda queda dicho en el registro, con el request_id; con `after()` la respuesta no espera a la base.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-motor-guiada-auditoria-plan.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach, beforeEach } from "node:test";
import type { Pool } from "pg";
import { sessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import { armarDesdeEspec, cotizarBom, crearCachePiezas, crosswalkIncluido, type ResultadoCotizacionBom } from "../../src/lib/globos3d/motor/v1";
import { PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { filaDeCotizacionDeIdea, registrarAuditoriaPlan3d, type FilaAuditoriaPlan3d } from "../../src/lib/guiada-motor/auditoria-plan";
import { cotizarIdeaConMotor } from "../../src/lib/guiada-motor/cotizar-idea";
import { costearDecoracion, type DependenciasCosteo } from "../../src/lib/guiada-motor/costear-idea";
import { cotizarIdeaConPython } from "../../src/lib/guiada-motor/cotizar-idea-python";
import { atenderEditarMotor, type DependenciasEditarMotor } from "../../src/lib/guiada-motor/editar-motor";
import { atenderPlanMotor, type DependenciasPlanMotor } from "../../src/lib/guiada-motor/plan-motor";
import { crearTopePorNavegador } from "../../src/lib/guiada-motor/tope-imagenes-navegador";
import { conContexto } from "../../src/lib/registro/contexto";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";
import { pythonDoble } from "../lib/python-doble-precio";

const CLAVE_APP = "clave-app-de-prueba";
const SESION = `${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}`;
const NAVEGADOR = "feedback_usuario=" + "a1".repeat(16);
const cruce = crosswalkIncluido();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Lo que escribe un cliente y no puede aparecer en ninguna fila. */
const PRIVADO = "SENTINELA-PRIVADA-LAURA";

let anterior: Record<string, string | undefined> = {};
beforeEach(() => {
  anterior = { APP_PASSWORD: process.env.APP_PASSWORD, DATABASE_URL: process.env.DATABASE_URL, GUIADA_MOTOR: process.env.GUIADA_MOTOR };
  process.env.APP_PASSWORD = CLAVE_APP;
  delete process.env.DATABASE_URL;
  delete process.env.GUIADA_MOTOR;
});
afterEach(() => { for (const [clave, valor] of Object.entries(anterior)) { if (valor === undefined) delete process.env[clave]; else process.env[clave] = valor; } });

/* ---------- La base: un doble que guarda la consulta ---------- */

type Consulta = { texto: string; valores: unknown[] };
function baseDoble(opciones: { rechaza?: boolean; retardoMs?: number; nunca?: boolean } = {}) {
  const consultas: Consulta[] = [];
  const estado = { terminadas: 0 };
  const query = async (texto: string, valores: unknown[]): Promise<{ rows: unknown[] }> => {
    consultas.push({ texto, valores });
    if (opciones.nunca) return new Promise<{ rows: unknown[] }>(() => undefined);
    if (opciones.retardoMs) await new Promise((resolver) => setTimeout(resolver, opciones.retardoMs));
    if (opciones.rechaza) throw new Error("Neon no responde");
    estado.terminadas += 1;
    return { rows: [] };
  };
  return { pool: { query } as unknown as Pick<Pool, "query">, consultas, estado };
}

/** Las columnas de `plan_audit_log` con lo que se les guardó (el INSERT de `registrarPlanAudit`). */
function filaInsertada(consulta: Consulta): Record<string, unknown> {
  assert.match(consulta.texto, /INSERT INTO plan_audit_log/);
  const columnas = /INSERT INTO plan_audit_log\s*\(([^)]*)\)/.exec(consulta.texto)![1]!.split(",").map((columna) => columna.trim());
  assert.equal(columnas.length, consulta.valores.length);
  return Object.fromEntries(columnas.map((columna, indice) => [columna, consulta.valores[indice]]));
}
const json = (valor: unknown): Record<string, unknown> => JSON.parse(String(valor)) as Record<string, unknown>;

async function sinRuido<T>(fn: () => Promise<T>): Promise<{ valor: T; errores: string[]; avisos: string[] }> {
  const original = { error: console.error, warn: console.warn };
  const errores: string[] = [];
  const avisos: string[] = [];
  console.error = (...a: unknown[]) => { errores.push(a.map(String).join(" ")); };
  console.warn = (...a: unknown[]) => { avisos.push(a.map(String).join(" ")); };
  try { return { valor: await fn(), errores, avisos }; } finally { console.error = original.error; console.warn = original.warn; }
}

const FILA: FilaAuditoriaPlan3d = {
  requestId: "00000000-0000-4000-8000-000000000001", estado: "PLAN_3D_CREADO", superficie: "/api/guiada/motor/plan", planHash: "a".repeat(64),
  pedido: { desde: "propuesta", piezas: ["arco"], colores: ["azul"] }, resultado: { accion: "plan_3d", motor: { id: "globos3d" }, globos: 120 },
  motor: { bandera: "3d", fuente: "cookie", efectivo: "3d" }, totalCop: 123456.4, snapshotPrecios: "products_catalog:abc",
  compras: [{ variantId: "v1", paquetes: 2, subtotal: 1000 }, { variantId: "v2", paquetes: 1, subtotal: 500 }],
};

test("la fila usa las columnas de plan_audit_log (sin migración): estado, hash, ruta, total entero, variantes y paquetes", async () => {
  const base = baseDoble();
  await registrarAuditoriaPlan3d(FILA, { pool: base.pool });
  assert.equal(base.consultas.length, 1);
  const fila = filaInsertada(base.consultas[0]!);
  assert.equal(fila.request_id, FILA.requestId);
  assert.equal(fila.plan_hash, FILA.planHash);
  assert.equal(fila.scene_spec_hash, FILA.planHash);
  assert.equal(fila.status, "PLAN_3D_CREADO");
  assert.equal(fila.superficie, "/api/guiada/motor/plan");
  assert.equal(fila.cost_chosen_cop, 123456, "la columna es INTEGER: se redondea");
  assert.deepEqual(fila.selected_product_ids, ["v1", "v2"]);
  assert.deepEqual(json(fila.packages), { lineas: [{ variant_id: "v1", paquetes: 2, subtotal: 1000 }, { variant_id: "v2", paquetes: 1, subtotal: 500 }] });
  assert.deepEqual(json(fila.restricciones), FILA.pedido);
  assert.equal(json(fila.geometry).globos, 120);
  assert.equal(fila.solicitud_original, null, "nunca las palabras del cliente");
  assert.deepEqual(json(fila.flag_snapshot), { guiada_motor: "3d", fuente: "cookie", efectivo: "3d", snapshot_precios: "products_catalog:abc" });
});

test("la conversación va en flag_snapshot para unir la fila con la traza de la conversación", async () => {
  const base = baseDoble();
  await conContexto({ conversacion: "conv-abc_123" }, () => registrarAuditoriaPlan3d(FILA, { pool: base.pool }));
  assert.equal(json(filaInsertada(base.consultas[0]!).flag_snapshot).conversacion, "conv-abc_123");
});

test("espera a que la escritura termine: en Vercel una promesa suelta se pierde cuando la función se congela", async () => {
  const base = baseDoble({ retardoMs: 40 });
  await registrarAuditoriaPlan3d(FILA, { pool: base.pool });
  assert.equal(base.estado.terminadas, 1);
});

test("con la base caída no lanza y deja dicho que no se guardó, con el request_id; con la base colgada no retrasa más que el plazo y también lo dice", async () => {
  const avisos: Array<{ evento: string; datos: Record<string, unknown> }> = [];
  const avisarFallo = (evento: string, datos: Record<string, unknown>) => { avisos.push({ evento, datos }); };
  const caida = await sinRuido(() => registrarAuditoriaPlan3d(FILA, { pool: baseDoble({ rechaza: true }).pool, avisarFallo }));
  assert.equal(caida.valor, undefined);
  assert.match(caida.errores.join("\n"), /no se pudo registrar auditoría de plan/);
  assert.equal(avisos.length, 1, "`registrarPlanAudit` se traga el error del INSERT: la fila no guardada se dice aparte");
  assert.equal(avisos[0]!.evento, "guiada_motor.auditoria_plan_no_guardada");
  assert.deepEqual({ request_id: avisos[0]!.datos.request_id, estado: avisos[0]!.datos.estado, total_cop: avisos[0]!.datos.total_cop }, { request_id: FILA.requestId, estado: "PLAN_3D_CREADO", total_cop: 123456.4 });

  avisos.length = 0;
  const inicio = performance.now();
  await registrarAuditoriaPlan3d(FILA, { pool: baseDoble({ nunca: true }).pool, plazoMs: 30, avisarFallo });
  assert.ok(performance.now() - inicio < 1_000, "la escritura colgada no frena al cliente");
  assert.deepEqual(avisos.map((a) => a.evento), ["guiada_motor.auditoria_plan_lenta"]);
});

test("con after() de Next la respuesta no espera a la base: la escritura sigue y termina sola", async () => {
  const base = baseDoble({ retardoMs: 80 });
  let programada: Promise<void> | undefined;
  await registrarAuditoriaPlan3d(FILA, { pool: base.pool, programar: (escritura) => { programada = escritura; return true; } });
  assert.equal(base.estado.terminadas, 0, "la respuesta salió antes de que Neon contestara");
  await programada;
  assert.equal(base.estado.terminadas, 1);
});

test("sin DATABASE_URL (el PC sin Neon) no lanza: avisa una vez por proceso", async () => {
  const { errores, avisos } = await sinRuido(async () => { await registrarAuditoriaPlan3d(FILA); await registrarAuditoriaPlan3d(FILA); });
  assert.deepEqual(errores, []);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0]!, /sin DATABASE_URL/);
});

/* ---------- Las rutas: plan, cambios y precio de una idea ---------- */

type Entorno<D> = { deps: D; filas: FilaAuditoriaPlan3d[]; idsDePrecio: string[]; doble: ReturnType<typeof pythonDoble> };
type OpcionesPlan = { motor?: "3d" | "python"; corte?: boolean; cotizar?: DependenciasPlanMotor["cotizar"] };

function entornoPlan(opciones: OpcionesPlan = {}): Entorno<DependenciasPlanMotor> {
  const filas: FilaAuditoriaPlan3d[] = [];
  const idsDePrecio: string[] = [];
  const doble = pythonDoble(cruce);
  let ids = 0;
  const deps: DependenciasPlanMotor = {
    leerBandera: async () => (opciones.corte ? { motor: "python", fuente: "corte" } : { motor: opciones.motor ?? "3d", fuente: "cookie" }),
    auditar: () => undefined,
    planGuardado: planGuardadoDeIdea,
    cotizar: opciones.cotizar ?? ((bom, { requestId }) => { idsDePrecio.push(requestId); return cotizarBom({ total: bom.total, porPieza: bom.porPieza }, { crosswalk: async () => cruce, cotizarLista: doble.cotizarLista }); }),
    nuevoId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    registrarPlan: async (fila) => { filas.push(fila); },
  };
  return { deps, filas, idsDePrecio, doble };
}

const pedirPlan = (cuerpo: unknown) => new Request("https://app.test/api/guiada/motor/plan", { method: "POST", headers: { "content-type": "application/json", cookie: [SESION, NAVEGADOR].join("; ") }, body: JSON.stringify(cuerpo) });
const PROPUESTA = { frase: `Te propongo un arco para ${PRIVADO}.`, colores: ["azul", "dorado"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 2 }] };
const propuesta = (extra: Record<string, unknown> = {}) => ({ desde: "propuesta", propuesta: PROPUESTA, brief: { evento: "boda", tematica: `boda de ${PRIVADO}` }, ...extra });
const IDEA = "deco-real-07-eb12910e210c94b6184d025127acce95";
const OTRA_IDEA = "deco-real-09-images-24";

async function crearPlan(cuerpo: unknown, opciones: OpcionesPlan = {}) {
  const e = entornoPlan(opciones);
  const respuesta = await atenderPlanMotor(pedirPlan(cuerpo), e.deps);
  return { ...e, respuesta, cuerpo: await respuesta.json() as Record<string, unknown> };
}
const planDe = (cuerpo: Record<string, unknown>) => PlanGuiadoSchema.parse(cuerpo.plan);

test("plan nuevo con el motor 3D: una fila PLAN_3D_CREADO con el hash del plan, el total, las variantes y el mismo request_id del precio", async () => {
  const { respuesta, cuerpo, filas, idsDePrecio } = await crearPlan(propuesta());
  assert.equal(respuesta.status, 200);
  const plan = planDe(cuerpo);
  assert.equal(filas.length, 1);
  const [fila] = filas;
  assert.equal(fila!.estado, "PLAN_3D_CREADO");
  assert.equal(fila!.superficie, "/api/guiada/motor/plan");
  assert.equal(fila!.planHash, plan.plan_hash);
  assert.match(fila!.requestId, UUID);
  assert.deepEqual(idsDePrecio, [fila!.requestId], "la fila se une a la llamada de precios de Python");
  assert.equal(fila!.totalCop, (cuerpo.cotizacion as { total: number }).total);
  assert.ok(fila!.compras && fila!.compras.length > 0 && fila!.compras.every((c) => c.variantId && c.paquetes > 0 && c.subtotal > 0));
  assert.deepEqual(fila!.motor, { bandera: "3d", fuente: "cookie", efectivo: "3d" });
  assert.deepEqual(fila!.pedido, { desde: "propuesta", conBase: false, piezas: ["arco", "columna"], colores: ["azul", "dorado"] });
  assert.ok(Number(fila!.resultado.globos) > 0 && Array.isArray(fila!.resultado.piezas));
  assert.doesNotMatch(JSON.stringify(fila), /approval_token/);
});

test("lo que escribió el cliente (la frase, la temática) no llega a la fila", async () => {
  const { filas } = await crearPlan(propuesta());
  assert.equal(filas.length, 1);
  assert.doesNotMatch(JSON.stringify(filas), new RegExp(PRIVADO));
});

test("rehacer un plan del 3D y sumarle una idea dejan su fila, con el hash del plan base", async () => {
  const base = planDe((await crearPlan({ desde: "idea", idea_id: IDEA })).cuerpo);
  const rehecho = await crearPlan(propuesta({ base }), { motor: "python" });
  assert.equal(rehecho.filas[0]!.estado, "PLAN_3D_REHECHO");
  assert.equal(rehecho.filas[0]!.resultado.plan_hash_base, base.plan_hash);
  assert.equal(rehecho.filas[0]!.motor.bandera, "python", "con la bandera en python un plan abierto sigue en el 3D, y la fila lo dice");
  assert.equal(rehecho.filas[0]!.motor.efectivo, "3d");
  const sumada = await crearPlan({ desde: "idea", idea_id: OTRA_IDEA, base });
  assert.equal(sumada.filas[0]!.estado, "PLAN_3D_IDEA_SUMADA");
  assert.notEqual(sumada.filas[0]!.planHash, base.plan_hash);
  assert.deepEqual(sumada.filas[0]!.pedido, { desde: "idea", conBase: true, idea_id: OTRA_IDEA });
});

test("cada fallo que manda el plan a Python deja su fila PLAN_3D_FALLBACK con la razón", async () => {
  const casos: Array<[nombre: string, cuerpo: unknown, opciones: OpcionesPlan, razon: string]> = [
    ["la bandera dice python", propuesta(), { motor: "python" }, "bandera_python"],
    ["el corte del 3D", propuesta(), { corte: true }, "motor_3d_cortado"],
    ["pieza sin constructor", { desde: "propuesta", propuesta: { frase: "x", colores: ["azul"], piezas: [{ estructura: "figura", cantidad: 1 }] } }, {}, "no_representable"],
    ["precio que falla", propuesta(), { cotizar: async (): Promise<ResultadoCotizacionBom> => ({ ok: false, razon: "precio_fallido", detalle: "502" }) }, "precio_fallido"],
    ["hueco en la tienda", propuesta(), { cotizar: async (): Promise<ResultadoCotizacionBom> => ({ ok: false, razon: "material_no_disponible", detalle: "falta" }) }, "sin_cobertura"],
    ["idea sin plan guardado", { desde: "idea", idea_id: "deco-real-21-no-tiene-plan" }, {}, "sin_plan_guardado"],
    ["error inesperado", propuesta(), { cotizar: async () => { throw new Error("secreto interno"); } }, "error_inesperado"],
  ];
  for (const [nombre, cuerpo, opciones, razon] of casos) {
    const { filas } = await crearPlan(cuerpo, opciones);
    assert.equal(filas.length, 1, nombre);
    assert.equal(filas[0]!.estado, "PLAN_3D_FALLBACK", nombre);
    assert.equal(filas[0]!.error, razon, nombre);
    assert.equal(filas[0]!.resultado.razon, razon, nombre);
    assert.equal(filas[0]!.motor.efectivo, "python", nombre);
    assert.match(filas[0]!.requestId, UUID, nombre);
    assert.equal(filas[0]!.planHash, undefined, `${nombre}: no hubo plan`);
  }
});

test("un plan base que no se acepta (token de otro navegador) deja su fila y no cotiza", async () => {
  const base = planDe((await crearPlan({ desde: "idea", idea_id: IDEA })).cuerpo);
  const e = entornoPlan();
  const respuesta = await atenderPlanMotor(new Request("https://app.test/api/guiada/motor/plan", { method: "POST", headers: { "content-type": "application/json", cookie: [SESION, "feedback_usuario=" + "b2".repeat(16)].join("; ") }, body: JSON.stringify({ desde: "idea", idea_id: OTRA_IDEA, base }) }), e.deps);
  assert.equal(respuesta.status, 409);
  assert.equal(e.filas.length, 1);
  assert.equal(e.filas[0]!.estado, "PLAN_3D_FALLBACK");
  assert.equal(e.filas[0]!.error, "APROBACION_INVALIDA");
  assert.equal(e.doble.llamadas.length, 0);
});

test("cuerpo inválido o sin sesión: ninguna fila (no hubo decisión del motor)", async () => {
  const e = entornoPlan();
  const sinSesion = await atenderPlanMotor(new Request("https://app.test/api/guiada/motor/plan", { method: "POST", body: "{}" }), e.deps);
  const roto = await atenderPlanMotor(pedirPlan("no es json" as unknown), e.deps);
  assert.deepEqual([sinSesion.status, roto.status], [401, 400]);
  assert.equal(e.filas.length, 0);
});

/* ---------- Cambios del cliente ---------- */

function entornoEditar(opciones: { corte?: boolean; tope?: number; cotizar?: DependenciasEditarMotor["cotizar"] } = {}): Entorno<DependenciasEditarMotor> {
  const filas: FilaAuditoriaPlan3d[] = [];
  const idsDePrecio: string[] = [];
  const doble = pythonDoble(cruce);
  const cachePiezas = crearCachePiezas(64);
  let ids = 100;
  const deps: DependenciasEditarMotor = {
    leerBandera: async () => (opciones.corte ? { motor: "python", fuente: "corte" } : { motor: "3d", fuente: "cookie" }),
    auditar: () => undefined,
    armar: (espec) => armarDesdeEspec(espec, { cachePiezas }),
    planGuardado: planGuardadoDeIdea,
    cotizar: opciones.cotizar ?? ((bom, { requestId }) => { idsDePrecio.push(requestId); return cotizarBom({ total: bom.total, porPieza: bom.porPieza }, { crosswalk: async () => cruce, cotizarLista: doble.cotizarLista }); }),
    nuevoId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    registrarPlan: async (fila) => { filas.push(fila); },
    tomarEdicion: crearTopePorNavegador(opciones.tope ?? 1000).tomar,
  };
  return { deps, filas, idsDePrecio, doble };
}

const editar = async (e: Entorno<DependenciasEditarMotor>, plan: unknown, edicion: unknown, extra: Record<string, unknown> = {}) => {
  const respuesta = await atenderEditarMotor(new Request("https://app.test/api/guiada/motor/editar", { method: "POST", headers: { "content-type": "application/json", cookie: [SESION, NAVEGADOR].join("; ") }, body: JSON.stringify({ plan, edicion, ...extra }) }), e.deps);
  return { respuesta, cuerpo: await respuesta.json() as Record<string, unknown> };
};
const pedidoColor = { tipo: "pedido", pedido: { tipo: "reemplazar_color", color: "azul", colorNuevo: "rojo", piezas: [] } };

test("un cambio hecho: PLAN_3D_EDITADO con el hash nuevo y el de la base, el total y el mismo request_id del precio", async () => {
  const plan = planDe((await crearPlan(propuesta())).cuerpo);
  const e = entornoEditar();
  const { respuesta, cuerpo } = await editar(e, plan, pedidoColor);
  assert.equal(respuesta.status, 200, JSON.stringify(cuerpo).slice(0, 300));
  const nuevo = planDe(cuerpo);
  assert.equal(e.filas.length, 1);
  const [fila] = e.filas;
  assert.equal(fila!.estado, "PLAN_3D_EDITADO");
  assert.equal(fila!.superficie, "/api/guiada/motor/editar");
  assert.equal(fila!.planHash, nuevo.plan_hash);
  assert.equal(fila!.resultado.plan_hash_base, plan.plan_hash);
  assert.notEqual(nuevo.plan_hash, plan.plan_hash);
  assert.equal(fila!.totalCop, (cuerpo.cotizacion as { total: number }).total);
  assert.deepEqual(e.idsDePrecio, [fila!.requestId], "el cambio se vuelve a cotizar con Python y la fila lleva ese id");
  assert.deepEqual(fila!.pedido, { via: "pedido", plan_hash_base: plan.plan_hash, tipo: "reemplazar_color" });
  assert.deepEqual(fila!.motor, { bandera: "3d", fuente: "cookie", efectivo: "3d" });
  assert.ok(fila!.compras && fila!.compras.length > 0);
});

test("un cambio que no se hace deja PLAN_3D_EDICION_RECHAZADA con el código; pasarse del cupo por hora no escribe filas", async () => {
  const plan = planDe((await crearPlan(propuesta())).cuerpo);
  const e = entornoEditar();
  const { respuesta, cuerpo } = await editar(e, plan, { tipo: "pedido", pedido: { tipo: "quitar_pieza", piezas: ["Pieza que no existe"] } });
  assert.equal(respuesta.status, 422, JSON.stringify(cuerpo).slice(0, 200));
  assert.equal(e.filas.length, 1);
  assert.equal(e.filas[0]!.estado, "PLAN_3D_EDICION_RECHAZADA");
  assert.equal(e.filas[0]!.error, cuerpo.codigo);
  assert.equal(e.filas[0]!.planHash, undefined);

  const sinCobertura = entornoEditar({ cotizar: async (): Promise<ResultadoCotizacionBom> => ({ ok: false, razon: "precio_fallido", detalle: "502" }) });
  assert.equal((await editar(sinCobertura, plan, pedidoColor)).respuesta.status, 422);
  assert.equal(sinCobertura.filas[0]!.error, "PRECIO_FALLIDO");

  const sinCupo = entornoEditar({ tope: 1 });
  await editar(sinCupo, plan, pedidoColor);
  const filasAntes = sinCupo.filas.length;
  const segunda = await editar(sinCupo, plan, pedidoColor);
  assert.equal(segunda.respuesta.status, 429);
  assert.equal(sinCupo.filas.length, filasAntes, "el cupo no es una decisión del motor: un bucle no llena la tabla");
});

test("el corte del 3D y el error inesperado también dejan su fila", async () => {
  const plan = planDe((await crearPlan(propuesta())).cuerpo);
  const cortado = entornoEditar({ corte: true });
  assert.equal((await editar(cortado, plan, pedidoColor)).respuesta.status, 409);
  assert.deepEqual([cortado.filas[0]!.estado, cortado.filas[0]!.error, cortado.filas[0]!.motor.efectivo], ["PLAN_3D_EDICION_RECHAZADA", "motor_3d_cortado", "ninguno"]);
  const roto = entornoEditar({ cotizar: async () => { throw new Error("secreto interno"); } });
  assert.equal((await editar(roto, plan, pedidoColor)).respuesta.status, 500);
  assert.equal(roto.filas[0]!.error, "error_inesperado");
});

test("lo que el cliente escribe en un cambio (el nombre de una pieza) no llega a la fila", async () => {
  const plan = planDe((await crearPlan(propuesta())).cuerpo);
  const e = entornoEditar();
  await editar(e, plan, { tipo: "pedido", pedido: { tipo: "quitar_pieza", piezas: [PRIVADO] } });
  await editar(e, plan, { tipo: "pedido", pedido: { tipo: "renombrar_pieza", pieza: "Arco", nombre: PRIVADO } });
  assert.ok(e.filas.length >= 1);
  assert.doesNotMatch(JSON.stringify(e.filas), new RegExp(PRIVADO));
});

/* ---------- Lo que manda el navegador ---------- */

test("lo que manda el navegador sin forma de código no llega a la fila: id de idea, hash del plan e id de turno", async () => {
  const idea = await crearPlan({ desde: "idea", idea_id: PRIVADO });
  assert.equal(idea.filas[0]!.estado, "PLAN_3D_FALLBACK");
  assert.equal(idea.filas[0]!.error, "sin_plan_guardado");
  assert.equal(idea.filas[0]!.pedido.idea_id, "desconocida", "un id que no está en el catálogo no se guarda");
  assert.equal(idea.filas[0]!.resultado.detalle, undefined);
  assert.doesNotMatch(JSON.stringify(idea.filas), new RegExp(PRIVADO));

  const plan = planDe((await crearPlan(propuesta())).cuerpo);
  const conHashFalso = entornoEditar();
  const rechazo = await editar(conHashFalso, { ...plan, plan_hash: PRIVADO }, pedidoColor);
  assert.equal(rechazo.respuesta.status, 400, "el contrato del plan ya exige un sha256: un hash con texto ni llega al motor");
  assert.equal(conHashFalso.filas.length, 0);

  const conTurno = entornoEditar();
  const hecho = await editar(conTurno, plan, pedidoColor, { turnoId: PRIVADO });
  assert.equal(hecho.respuesta.status, 200);
  assert.equal(conTurno.filas[0]!.estado, "PLAN_3D_EDITADO");
  assert.equal(conTurno.filas[0]!.resultado.turno_id, undefined, "el id de turno del navegador solo entra si es un UUID");
  assert.doesNotMatch(JSON.stringify(conTurno.filas), new RegExp(PRIVADO));
  const conTurnoUuid = entornoEditar();
  await editar(conTurnoUuid, plan, pedidoColor, { turnoId: "11111111-2222-4333-8444-555555555555" });
  assert.equal(conTurnoUuid.filas[0]!.resultado.turno_id, "11111111-2222-4333-8444-555555555555");
});

test("una pieza que el armado no representa deja solo su id: el motivo la nombra como la llamó el cliente", async () => {
  const figura = await crearPlan({ desde: "propuesta", propuesta: { frase: "x", colores: ["azul"], piezas: [{ estructura: "figura", cantidad: 1, nombre: PRIVADO }] } });
  assert.equal(figura.filas[0]!.error, "no_representable");
  assert.deepEqual(figura.filas[0]!.resultado.piezas, ["EST_01_FIGURA"]);
  assert.doesNotMatch(JSON.stringify(figura.filas), new RegExp(PRIVADO));

  const plan = planDe((await crearPlan(propuesta())).cuerpo);
  const e = entornoEditar();
  const armarReal = e.deps.armar;
  e.deps.armar = (espec) => ({ ...armarReal(espec), noRepresentable: [{ piezaId: "EST_01_ARCO", motivo: `El color rojo no llega a la lista de materiales de «${PRIVADO}»` }] });
  const rechazo = await editar(e, plan, pedidoColor);
  assert.equal(rechazo.cuerpo.codigo, "EDICION_NO_ARMABLE");
  assert.equal(e.filas[0]!.estado, "PLAN_3D_EDICION_RECHAZADA");
  assert.deepEqual(e.filas[0]!.resultado.piezas, ["EST_01_ARCO"]);
  assert.doesNotMatch(JSON.stringify(e.filas), new RegExp(PRIVADO));
});

test("las rutas escriben con `registrarAuditoriaPlan3d` (el tipo exige la dependencia, no cuál)", () => {
  const fuente = (ruta: string) => readFileSync(new URL(`../../src/app/api/${ruta}/route.ts`, import.meta.url), "utf8");
  for (const ruta of ["guiada/motor/plan", "guiada/motor/editar"]) assert.match(fuente(ruta), /registrarPlan: registrarAuditoriaPlan3d/, ruta);
  const guiada = fuente("asistente-guiado");
  assert.match(guiada, /filaDeCotizacionDeIdea\(decision, decoracion\.id, requestId, "\/api\/asistente-guiado"\)/);
  assert.match(guiada, /await registrarAuditoriaPlan3d\(filaAuditoria\)/);
});

/* ---------- «¿Cuánto cuesta?» de una idea del carrusel ---------- */

const doble = pythonDoble(cruce);
const cotizarIdea = (ideaId: string) => cotizarIdeaConMotor(ideaId, { planGuardado: planGuardadoDeIdea, crosswalk: async () => cruce, cotizarLista: doble.cotizarLista });
const HASH_PYTHON = "b".repeat(64);
const cotizacionPython = { lineas: [{ id: "v1", tamano: "R-12", cantidadNecesaria: 10, disponible: true, varianteId: "v1", nombre: "Globo", precioPaquete: 3963, unidadesPaquete: 12, paquetes: 1, subtotal: 3963, sobrante: 2 }], total: 3963, mermaPorcentaje: 8, incluyeIva: true, complementosSoportados: false as const, plan_hash: HASH_PYTHON };
/** El costeo de la ruta, con Python sustituido por dobles: lo que decide es lo que la fila cuenta. */
function depsCosteo(motor: "3d" | "python" | "sin_bandera", extra: Partial<DependenciasCosteo> = {}): DependenciasCosteo {
  return {
    leerMotor: async () => { if (motor === "sin_bandera") throw new Error("sin base"); return motor; },
    tienePlanGuardado: async (id) => planGuardadoDeIdea(id) !== null,
    cotizarConMotor: cotizarIdea,
    cotizarConPython: (id) => cotizarIdeaConPython(id, { planGuardado: planGuardadoDeIdea, resolver: async () => ({ cotizacion: cotizacionPython }) }),
    cotizarLista: doble.cotizarLista,
    auditar: () => undefined,
    ...extra,
  };
}
const costear = async (ideaId: string, deps: DependenciasCosteo) => (await costearDecoracion({ id: ideaId, materiales: [] }, "personal", deps)).decision;

test("el precio de una idea con el motor 3D deja COTIZACION_IDEA_3D con el total, las variantes y el hash del plan", async () => {
  const decision = await costear(IDEA, depsCosteo("3d"));
  assert.equal(decision.usar, "motor");
  const fila = filaDeCotizacionDeIdea(decision, IDEA, "00000000-0000-4000-8000-0000000000aa", "/api/asistente-guiado");
  assert.equal(fila.estado, "COTIZACION_IDEA_3D");
  assert.equal(fila.superficie, "/api/asistente-guiado");
  assert.deepEqual(fila.pedido, { idea_id: IDEA });
  assert.ok(fila.totalCop && fila.totalCop > 0 && fila.compras && fila.compras.length > 0);
  assert.match(fila.planHash ?? "", /^[0-9a-f]{64}$/);
  const base = baseDoble();
  await registrarAuditoriaPlan3d(fila, { pool: base.pool });
  const guardada = filaInsertada(base.consultas[0]!);
  assert.equal(guardada.status, "COTIZACION_IDEA_3D");
  assert.equal(guardada.cost_chosen_cop, fila.totalCop);
});

test("cada «¿cuánto cuesta?» deja su fila (D-038): plan de Python, lista curada y sin precio, sin texto del cliente", async () => {
  // Bandera en python: el plan de Python de la idea guardada, con su total y su hash.
  const python = filaDeCotizacionDeIdea(await costear(IDEA, depsCosteo("python")), IDEA, "00000000-0000-4000-8000-0000000000cc", "/api/asistente-guiado");
  assert.deepEqual([python.estado, python.motor.bandera, python.motor.efectivo, python.totalCop, python.planHash, python.error], ["COTIZACION_IDEA_PYTHON", "python", "python", 3963, HASH_PYTHON, undefined]);
  // Sin leer la bandera: también el plan de Python, y la fila no dice que la bandera era 3d.
  const sinLeer = filaDeCotizacionDeIdea(await costear(IDEA, depsCosteo("sin_bandera")), IDEA, "00000000-0000-4000-8000-0000000000dd", "/api/asistente-guiado");
  assert.equal(sinLeer.motor.bandera, null, "no se leyó la bandera: la fila no dice que era 3d");
  assert.deepEqual(sinLeer.resultado, { accion: "cotizacion_idea", motor: "python", razon: "no_se_pudo_leer_la_bandera", globos: 10, lineas: 1 });
  // El 3D no arma la idea: cae al plan de Python, como el plan, y la fila dice por qué.
  const centroDeMesa = "deco-real-03-63ba2a23-cda3-4af6-af27-bb1746751288-1";
  const cae = filaDeCotizacionDeIdea(await costear(centroDeMesa, depsCosteo("3d")), centroDeMesa, "00000000-0000-4000-8000-0000000000ee", "/api/asistente-guiado");
  assert.deepEqual([cae.estado, cae.error, cae.motor.bandera, cae.motor.efectivo], ["COTIZACION_IDEA_FALLBACK", "no_representable", "3d", "python"]);
  // Sin plan guardado (las figuras): la lista curada.
  const sinPlan = filaDeCotizacionDeIdea(await costear("deco-real-21-no-tiene-plan", depsCosteo("3d")), "deco-real-21-no-tiene-plan", "00000000-0000-4000-8000-0000000000bb", "/api/asistente-guiado");
  assert.deepEqual([sinPlan.estado, sinPlan.error, sinPlan.motor.efectivo], ["COTIZACION_IDEA_FALLBACK", "sin_plan_guardado", "python"]);
  // Sin precio: la fila lo dice con un código, nunca con el detalle del error ni el aviso al cliente.
  const sinPrecio = filaDeCotizacionDeIdea(await costear(IDEA, depsCosteo("python", { cotizarConPython: async () => { throw new Error(PRIVADO); } })), IDEA, "00000000-0000-4000-8000-0000000000ff", "/api/asistente-guiado");
  assert.deepEqual([sinPrecio.estado, sinPrecio.error, sinPrecio.motor.efectivo], ["COTIZACION_IDEA_SIN_PRECIO", "error_de_python", "ninguno"]);
  for (const fila of [python, sinLeer, cae, sinPlan, sinPrecio]) assert.doesNotMatch(JSON.stringify(fila), new RegExp(`${PRIVADO}|No pude|Precio de los materiales`));
});
