/**
 * `POST /api/guiada/motor/plan` (REQ-007, fase 2): el plan de la vista guiada armado por el motor 3D. Sin coste: la
 * bandera, Python y la auditoría son dobles; no hay red, base ni IA.
 * - sesión (401) y cuerpo (400); la bandera `python` manda los planes nuevos a Python (409 tipado);
 * - propuesta e idea con la bandera en `3d`: sobre válido, hash de la espec, token `globos3d`, auditoría con el motor real;
 * - cada fallo es TIPADO (`fallback.razon`): pieza sin constructor, hueco en la tienda, precio que falla, idea sin plan;
 * - sumar una idea a un plan del 3D: las piezas del plan quedan intactas, sigue en el 3D aunque la bandera cambie,
 *   se respeta el tope de 8 piezas y la base se verifica (token, firma, hash de la espec);
 * - los tokens `python` se rechazan aquí y los `globos3d` se rechazan en /api/generate y /api/plan-editar (409 claro);
 * - lo que cambió con la bandera real: la lectura para un plan nuevo ya no dice «efectivo: python» a la fuerza.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-motor-guiada-plan-ruta.ts
 */
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { sessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import { crearTokenPlan } from "../../src/lib/plan/aprobacion";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";
import { atenderPlanMotor, type DependenciasPlanMotor } from "../../src/lib/guiada-motor/plan-motor";
import { FalloPlanMotorSchema, RespuestaPlanMotorSchema } from "../../src/lib/guiada-motor/plan-contrato";
import { cotizarBom, crosswalkIncluido, type ResultadoCotizacionBom } from "../../src/lib/globos3d/motor/v1";
import { MENSAJE_PLAN_DEL_MOTOR_3D, rechazarTokenDelMotor3d } from "../../src/lib/plan/token-motor";
import { PlanEditError } from "../../src/lib/plan/edicion-error";
import { POST as postGenerate } from "../../src/app/api/generate/route";
import { POST as postPlanEditar } from "../../src/app/api/plan-editar/route";
import { pythonDoble, type PythonDoble } from "../lib/python-doble-precio";

const CLAVE_APP = "clave-app-de-prueba";
const SESION = `${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}`;
const cruce = crosswalkIncluido();
const como = <T,>(valor: unknown): T => valor as unknown as T;

let anterior: Record<string, string | undefined> = {};
beforeEach(() => {
  anterior = { APP_PASSWORD: process.env.APP_PASSWORD, DATABASE_URL: process.env.DATABASE_URL, GUIADA_MOTOR: process.env.GUIADA_MOTOR };
  process.env.APP_PASSWORD = CLAVE_APP;
  delete process.env.DATABASE_URL;
  delete process.env.GUIADA_MOTOR;
});
afterEach(() => { for (const [clave, valor] of Object.entries(anterior)) { if (valor === undefined) delete process.env[clave]; else process.env[clave] = valor; } });

type Auditoria = { quien: string; que: string; resultado: Record<string, unknown>; entrada: unknown };
function entorno(motor: "3d" | "python" = "3d", opciones: { cotizar?: DependenciasPlanMotor["cotizar"]; planGuardado?: DependenciasPlanMotor["planGuardado"] } = {}) {
  const auditorias: Auditoria[] = [];
  const doble: PythonDoble = pythonDoble(cruce);
  let ids = 0;
  const deps: DependenciasPlanMotor = {
    leerBandera: async () => ({ motor, fuente: motor === "3d" ? "cookie" : "defecto" }),
    auditar: (quien, que, resultado, extra) => { auditorias.push({ quien, que, resultado: resultado as Record<string, unknown>, entrada: extra?.entrada }); },
    planGuardado: opciones.planGuardado ?? planGuardadoDeIdea,
    cotizar: opciones.cotizar ?? ((bom) => cotizarBom({ total: bom.total, porPieza: bom.porPieza }, { crosswalk: async () => cruce, cotizarLista: doble.cotizarLista })),
    nuevoId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
  };
  return { deps, auditorias, doble };
}

const pedir = (cuerpo: unknown, cookies: string[] = [SESION]) => new Request("https://app.test/api/guiada/motor/plan", {
  method: "POST", headers: { "content-type": "application/json", ...(cookies.length ? { cookie: cookies.join("; ") } : {}) }, body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
});
const PROPUESTA = { frase: "Te propongo un arco y dos columnas.", colores: ["azul", "dorado"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 2 }] };
const propuesta = (extra: Record<string, unknown> = {}) => ({ desde: "propuesta", propuesta: PROPUESTA, brief: { evento: "boda", tematica: "boda azul y dorada" }, ...extra });

async function crear(cuerpo: unknown, motor: "3d" | "python" = "3d") {
  const e = entorno(motor);
  const respuesta = await atenderPlanMotor(pedir(cuerpo), e.deps);
  return { respuesta, cuerpo: await respuesta.json() as Record<string, unknown>, ...e };
}

test("sin sesión: 401 y no lee la bandera", async () => {
  let lecturas = 0;
  const e = entorno();
  const respuesta = await atenderPlanMotor(pedir(propuesta(), []), { ...e.deps, leerBandera: async () => { lecturas += 1; return { motor: "3d", fuente: "cookie" }; } });
  assert.equal(respuesta.status, 401);
  assert.equal(respuesta.headers.get("cache-control"), "no-store");
  assert.equal(lecturas, 0);
  assert.equal(e.auditorias.length, 0);
});

test("valida el cuerpo: JSON roto, vacío, enorme, desde desconocido, campos de más, propuesta sin piezas", async () => {
  for (const cuerpo of ["no es json", "", `{"desde":"propuesta","relleno":"${"x".repeat(700_001)}"}`, { desde: "foto" }, { ...propuesta(), extra: 1 }, { desde: "propuesta", propuesta: { ...PROPUESTA, piezas: [] } }, { desde: "idea" }, { desde: "idea", idea_id: "" }]) {
    const { respuesta, cuerpo: salida, auditorias } = await crear(cuerpo);
    assert.equal(respuesta.status, 400, JSON.stringify(cuerpo).slice(0, 80));
    assert.equal(salida.codigo, "CUERPO_INVALIDO");
    assert.equal(auditorias.length, 0);
  }
});

test("bandera python y plan nuevo: 409 tipado, sin motor ni precio, y queda dicho en la auditoría", async () => {
  let cotizaciones = 0;
  const e = entorno("python", { cotizar: async () => { cotizaciones += 1; return { ok: false, razon: "precio_fallido", detalle: "no debía llamarse" }; } });
  for (const cuerpo of [propuesta(), { desde: "idea", idea_id: "deco-real-01-305" }]) {
    const respuesta = await atenderPlanMotor(pedir(cuerpo), e.deps);
    assert.equal(respuesta.status, 409);
    const salida = FalloPlanMotorSchema.parse(await respuesta.json());
    assert.equal(salida.codigo, "MOTOR_PYTHON");
    assert.equal(salida.fallback?.razon, "bandera_python");
  }
  assert.equal(cotizaciones, 0);
  assert.equal(e.auditorias.length, 2);
  assert.deepEqual(e.auditorias[0]!.resultado, { bandera: "python", fuente: "defecto", efectivo: "python", razon: "bandera_python" });
  assert.equal(e.auditorias[0]!.quien, "regla:motor_guiada");
});

test("propuesta con la bandera en 3d: sobre válido, hash de la espec, token globos3d y auditoría con el motor real", async () => {
  const { respuesta, cuerpo, auditorias, doble } = await crear(propuesta());
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.headers.get("cache-control"), "no-store");
  const salida = RespuestaPlanMotorSchema.parse(cuerpo);
  const plan = PlanGuiadoSchema.parse(salida.plan);
  assert.equal(plan.plan.concepto.titulo, "Boda azul y dorada");
  assert.equal(plan.plan.concepto.ocasion, "boda");
  assert.deepEqual(plan.estructuras.map((e) => e.estructura_id), ["EST_01_ARCO", "EST_02_COLUMNA", "EST_03_COLUMNA"]);
  assert.equal(como<{ motor: { id: string } }>(plan).motor.id, "globos3d");
  assert.equal(doble.llamadas.length, 1, "un solo viaje al servicio de precios");
  assert.deepEqual(salida.nuevas, ["EST_01_ARCO", "EST_02_COLUMNA", "EST_03_COLUMNA"]);
  assert.equal(salida.globosIdea, null);
  assert.equal(auditorias.length, 1);
  const [auditoria] = auditorias;
  assert.equal(auditoria!.quien, "regla:motor_guiada");
  assert.equal(auditoria!.resultado.efectivo, "3d");
  assert.equal(auditoria!.resultado.bandera, "3d");
  assert.equal(auditoria!.resultado.plan_hash, plan.plan_hash);
  assert.ok(Number(auditoria!.resultado.total_cop) > 0 && Number(auditoria!.resultado.globos) > 0);
  assert.doesNotMatch(JSON.stringify(auditoria), /approval_token/, "el token no va a la auditoría");
});

test("la medida que dijo el cliente llega al plan (brief.medida) y la propuesta no pasa por modelo ni catálogo de RAG", async () => {
  const { cuerpo } = await crear(propuesta({ brief: { medida: { texto: "unos 3 metros", metros: 3 }, estructura: { id: "arco", texto: "arco" } } }));
  const plan = PlanGuiadoSchema.parse(RespuestaPlanMotorSchema.parse(cuerpo).plan);
  assert.equal(plan.plan.estructuras[0]!.medidas.ancho_m, 3);
});

test("idea del catálogo con la bandera en 3d: sus piezas, sus globos del motor y la cifra que anunciaba la tarjeta", async () => {
  const { respuesta, cuerpo, auditorias } = await crear({ desde: "idea", idea_id: "deco-real-07-eb12910e210c94b6184d025127acce95" });
  assert.equal(respuesta.status, 200);
  const salida = RespuestaPlanMotorSchema.parse(cuerpo);
  const plan = PlanGuiadoSchema.parse(salida.plan);
  assert.equal(plan.plan.estructuras.length, 2);
  assert.equal(salida.globosIdea, 87, "los globos que decía la idea con Python (informativo)");
  assert.equal(plan.plan.concepto.titulo, planGuardadoDeIdea("deco-real-07-eb12910e210c94b6184d025127acce95")!.plan.concepto.titulo);
  assert.equal(auditorias[0]!.resultado.efectivo, "3d");
});

test("fallos tipados: pieza sin constructor, hueco en la tienda, precio que falla, idea sin plan guardado", async () => {
  const figura = await crear({ desde: "propuesta", propuesta: { frase: "x", colores: ["azul"], piezas: [{ estructura: "figura", cantidad: 1 }] } });
  assert.equal(figura.respuesta.status, 422);
  const f = FalloPlanMotorSchema.parse(figura.cuerpo);
  assert.equal(f.codigo, "PLAN_NO_ARMABLE_EN_3D");
  assert.deepEqual(f.fallback?.razon, "no_representable");
  assert.ok(f.fallback?.piezas?.length === 1 && f.fallback.piezas[0]!.piezaId === "EST_01_FIGURA" && f.fallback.piezas[0]!.motivo.length > 10);
  assert.equal(figura.doble.llamadas.length, 0, "no se cotiza lo que no se arma");
  assert.deepEqual(figura.auditorias[0]!.resultado, { bandera: "3d", fuente: "cookie", efectivo: "python", razon: "no_representable", piezas: f.fallback!.piezas });

  const pared = await crear({ desde: "propuesta", propuesta: { frase: "x", colores: ["azul", "blanco", "dorado"], piezas: [{ estructura: "pared_densa", cantidad: 1 }] } });
  const p = FalloPlanMotorSchema.parse(pared.cuerpo);
  assert.equal(pared.respuesta.status, 422);
  assert.equal(p.fallback?.razon, "sin_cobertura");
  assert.match(p.fallback?.detalle ?? "", /LOL-12 970: no_esta_en_la_tienda/);
  assert.equal(pared.doble.llamadas.length, 0, "el pre-filtro del cruce evita el viaje a Python");

  const casos: Array<[ResultadoCotizacionBom, string]> = [
    [{ ok: false, razon: "precio_fallido", detalle: "502" }, "precio_fallido"],
    [{ ok: false, razon: "material_no_disponible", detalle: "falta una variante" }, "sin_cobertura"],
  ];
  for (const [resultado, razon] of casos) {
    const e = entorno("3d", { cotizar: async () => resultado });
    const respuesta = await atenderPlanMotor(pedir(propuesta()), e.deps);
    assert.equal(respuesta.status, 422);
    assert.equal(FalloPlanMotorSchema.parse(await respuesta.json()).fallback?.razon, razon);
    assert.equal(e.auditorias[0]!.resultado.razon, razon);
  }

  const sinPlan = await crear({ desde: "idea", idea_id: "deco-real-21-no-tiene-plan" });
  assert.equal(sinPlan.respuesta.status, 422);
  assert.equal(FalloPlanMotorSchema.parse(sinPlan.cuerpo).fallback?.razon, "sin_plan_guardado");
});

test("un error inesperado del motor o de la cotización: 500 sin detalles internos y auditado", async () => {
  const e = entorno("3d", { cotizar: async () => { throw new Error("secreto interno"); } });
  const respuesta = await atenderPlanMotor(pedir(propuesta()), e.deps);
  assert.equal(respuesta.status, 500);
  const salida = await respuesta.json() as { error: string; codigo: string };
  assert.equal(salida.codigo, "ERROR_DEL_MOTOR");
  assert.doesNotMatch(JSON.stringify(salida), /secreto/);
  assert.equal(e.auditorias.at(-1)!.resultado.razon, "error_inesperado");
});

async function planBase(idea = "deco-real-07-eb12910e210c94b6184d025127acce95") {
  const { cuerpo } = await crear({ desde: "idea", idea_id: idea });
  return PlanGuiadoSchema.parse(RespuestaPlanMotorSchema.parse(cuerpo).plan);
}

test("sumar una idea a un plan del 3d: las piezas del plan quedan intactas, las nuevas toman ids libres y el origen lo dice", async () => {
  const base = await planBase();
  // Con la bandera en python: el plan ya era del 3d y conserva su motor.
  const e = entorno("python");
  const respuesta = await atenderPlanMotor(pedir({ desde: "idea", idea_id: "deco-real-09-images-24", base }), e.deps);
  assert.equal(respuesta.status, 200, JSON.stringify(await respuesta.clone().json()).slice(0, 300));
  const salida = RespuestaPlanMotorSchema.parse(await respuesta.json());
  const plan = PlanGuiadoSchema.parse(salida.plan);
  const idsBase = base.estructuras.map((x) => x.estructura_id);
  assert.deepEqual(plan.estructuras.slice(0, idsBase.length).map((x) => x.estructura_id), idsBase);
  assert.equal(plan.estructuras.length, idsBase.length + salida.nuevas.length);
  assert.ok(salida.nuevas.every((id) => !idsBase.includes(id)), "ids nuevos");
  // Los globos de cada pieza (talla, color y cantidad) quedan exactamente como estaban; el paquete que se compra puede cambiar,
  // porque se elige por el total de toda la compra (la idea nueva suma globos a la misma talla y color).
  const globos = (lineas: unknown[]) => Object.fromEntries((lineas as Array<{ tamano_codigo: string; color: string; acabado: string; unidades: number; adorno?: string }>).map((l) => [`${l.tamano_codigo}|${l.color}|${l.acabado}|${l.adorno ?? ""}`, l.unidades]));
  for (const [k, e1] of base.estructuras.entries()) assert.deepEqual(globos(plan.estructuras[k]!.lineas), globos(e1.lineas), `${e1.estructura_id}: los globos de las piezas del plan quedan exactamente como estaban`);
  const espec = (plan as unknown as { espec: { origen: { tipo: string; ideaIds: string[] }; piezas: unknown[] } }).espec;
  assert.equal(espec.origen.tipo, "idea_sumada");
  assert.deepEqual(espec.origen.ideaIds, ["deco-real-07-eb12910e210c94b6184d025127acce95", "deco-real-09-images-24"]);
  assert.equal(plan.plan.concepto.titulo, base.plan.concepto.titulo, "el título del plan no se pisa");
  assert.notEqual(plan.plan_hash, base.plan_hash);
  assert.equal(e.auditorias[0]!.resultado.bandera, "python");
  assert.equal(e.auditorias[0]!.resultado.efectivo, "3d");
});

test("rehacer con una propuesta un plan del 3d lo mantiene en el 3d aunque la bandera diga python", async () => {
  const base = await planBase();
  const e = entorno("python");
  const respuesta = await atenderPlanMotor(pedir(propuesta({ base })), e.deps);
  assert.equal(respuesta.status, 200);
  assert.equal(RespuestaPlanMotorSchema.parse(await respuesta.json()).plan.plan_hash.length, 64);
});

test("la base se verifica: token de Python, espec alterada, hash ajeno, sin token válido, sin espec", async () => {
  const base = await planBase();
  const intentar = async (planBase: unknown) => atenderPlanMotor(pedir({ desde: "idea", idea_id: "deco-real-09-images-24", base: planBase }), entorno().deps);

  const deEspec = (base as unknown as { espec: { piezas: Array<{ colores: Array<{ peso: number }> }> } }).espec;
  const alterada = structuredClone(base) as unknown as { espec: typeof deEspec };
  alterada.espec.piezas[0]!.colores = [{ ...alterada.espec.piezas[0]!.colores[0]!, peso: 1 }];
  const r1 = await intentar(alterada);
  assert.equal(r1.status, 409);
  assert.equal((await r1.json() as { codigo: string }).codigo, "PLAN_ALTERADO", "una espec cambiada en el navegador no coincide con lo que se firmó");

  const dePython = { ...base, approval_token: crearTokenPlan({ planHash: base.plan_hash, requestId: "r", backend: "python", catalogSnapshotId: "s", allowlist: [] }) };
  const r2 = await intentar(dePython);
  assert.equal(r2.status, 409);
  assert.equal((await r2.json() as { codigo: string }).codigo, "PLAN_NO_ES_DEL_MOTOR_3D", "los tokens de Python se rechazan aquí");

  const r3 = await intentar({ ...base, plan_hash: "a".repeat(64) });
  assert.equal(r3.status, 409);
  assert.equal((await r3.json() as { codigo: string }).codigo, "APROBACION_INVALIDA", "el token está atado a otro hash");

  const r4 = await intentar({ ...base, approval_token: "no-es-un-token" });
  assert.equal((await r4.json() as { codigo: string }).codigo, "APROBACION_INVALIDA");

  const { espec: _quitada, ...sinEspec } = base as unknown as Record<string, unknown>;
  const r5 = await intentar(sinEspec);
  assert.equal(r5.status, 400);
  assert.equal((await r5.json() as { codigo: string }).codigo, "ESPEC_INVALIDA");
});

test("tope de piezas: sumar una idea que pasa de 8 devuelve un fallo tipado y deja el plan como estaba", async () => {
  // La idea de las dos columnas suma 2 piezas por vez: 2 -> 4 -> 6 -> 8.
  let plan = await planBase("deco-real-07-eb12910e210c94b6184d025127acce95");
  while (plan.estructuras.length < 8) {
    const r = await atenderPlanMotor(pedir({ desde: "idea", idea_id: "deco-real-07-eb12910e210c94b6184d025127acce95", base: plan }), entorno().deps);
    assert.equal(r.status, 200);
    plan = PlanGuiadoSchema.parse(RespuestaPlanMotorSchema.parse(await r.json()).plan);
  }
  assert.equal(plan.estructuras.length, 8);
  const e = entorno();
  const r = await atenderPlanMotor(pedir({ desde: "idea", idea_id: "deco-real-07-eb12910e210c94b6184d025127acce95", base: plan }), e.deps);
  assert.equal(r.status, 422);
  assert.equal(FalloPlanMotorSchema.parse(await r.json()).fallback?.razon, "tope_de_piezas");
  assert.equal(e.doble.llamadas.length, 0, "ni se cotiza");
});

test("los tokens del motor 3d se rechazan en las rutas de Python con un 409 claro", async () => {
  const base = await planBase();
  assert.throws(() => rechazarTokenDelMotor3d(base.approval_token), (error: unknown) => error instanceof PlanEditError && error.status === 409 && error.causa === "PLAN_DEL_MOTOR_3D" && error.message === MENSAJE_PLAN_DEL_MOTOR_3D);
  // Uno de Python o uno que no es un token pasan de largo (los valida quien los usa).
  rechazarTokenDelMotor3d(crearTokenPlan({ planHash: "h", requestId: "r", backend: "python", catalogSnapshotId: "s", allowlist: [] }));
  rechazarTokenDelMotor3d("basura");
  rechazarTokenDelMotor3d(undefined);

  // /api/plan-editar: todos sus modos con base o con token.
  const cuerpos: unknown[] = [
    { modo: "recomendadas", variant_id: "1", approval_token: base.approval_token },
    { modo: "buscar", consulta: "globo azul", approval_token: base.approval_token },
    { modo: "colores", approval_token: base.approval_token },
    { modo: "quitar_pieza", base, estructura_id: "EST_01_COLUMNA" },
    { modo: "agregar_color", base, color: "rojo", product_id: "p", variant_ids: ["v"] },
    { modo: "aplicar", base, edicion: { accion: "repartir", estructura_id: "EST_01_COLUMNA", participaciones: [0.5, 0.5] } },
  ];
  for (const cuerpo of cuerpos) {
    const respuesta = await postPlanEditar(new Request("https://app.test/api/plan-editar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }));
    const salida = await respuesta.json() as { error?: string; causa?: string };
    assert.equal(respuesta.status, 409, JSON.stringify(cuerpo).slice(0, 60));
    assert.equal(salida.causa, "PLAN_DEL_MOTOR_3D");
    assert.equal(salida.error, MENSAJE_PLAN_DEL_MOTOR_3D);
  }
});

test("/api/generate rechaza el plan del motor 3d con un 409 claro, antes de generar nada", async () => {
  const base = await planBase();
  const respuesta = await postGenerate(new Request("https://app.test/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan: base, productIds: [], imagenesReferencia: [] }) }));
  const salida = await respuesta.json() as { error: string; causa: string };
  assert.equal(respuesta.status, 409);
  assert.equal(salida.causa, "PLAN_DEL_MOTOR_3D");
  assert.equal(salida.error, MENSAJE_PLAN_DEL_MOTOR_3D);
});
