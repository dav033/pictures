/**
 * Marcha atrás ordenada del motor de la guiada (P-045). La bandera GUIADA_MOTOR decide solo los planes NUEVOS: un plan del 3D
 * que el cliente ya tiene sigue en el 3D hasta el final de la conversación (cambios, ideas sumadas, propuestas rehechas),
 * también si la bandera vuelve a python a mitad de ella (caché de 30 s por instancia), y con el mismo precio que habría tenido.
 * Solo el corte del 3D (`guiada_motor_corte`) lo frena: el servidor no toca el plan ni cotiza nada, responde un código estable
 * y una frase de cliente que avisa del recálculo y del precio ANTES de que cambie (D-023). La vista hace el resto
 * (test-ui-motor3d-marcha-atras.ts). Con la bandera en `python` la continuidad tiene un límite: una línea del 3D (un plan y lo
 * que sale de él, que hereda la hora de su primer plan) de más de 24 h deja el 3D igual que con el corte. Sin coste: Python es un doble y la bandera es el lector real con la fila de Neon y el
 * reloj simulados.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-motor-guiada-marcha-atras.ts
 */
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { sessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import { PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { abrirContextoPlan, crearTokenPlan } from "../../src/lib/plan/aprobacion";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";
import { crearLectorBandera, TTL_AJUSTE_MS } from "../../src/lib/guiada-motor/bandera";
import { atenderPlanMotor, type DependenciasPlanMotor } from "../../src/lib/guiada-motor/plan-motor";
import { atenderEditarMotor, type DependenciasEditarMotor } from "../../src/lib/guiada-motor/editar-motor";
import { FalloEditarMotorSchema, RespuestaEditarMotorSchema, type CuerpoEditarMotor } from "../../src/lib/guiada-motor/editar-contrato";
import { FalloPlanMotorSchema, RespuestaPlanMotorSchema } from "../../src/lib/guiada-motor/plan-contrato";
import { TEXTO_EDICION_RECALCULO } from "../../src/lib/guiada-motor/mensajes-cliente";
import { crearTopePorNavegador } from "../../src/lib/guiada-motor/tope-imagenes-navegador";
import { armarDesdeEspec, cotizarBom, crosswalkIncluido } from "../../src/lib/globos3d/motor/v1";
import { pythonDoble } from "../lib/python-doble-precio";

const CLAVE_APP = "clave-app-de-prueba";
const COOKIES = [`${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}`, "feedback_usuario=" + "a1".repeat(16)].join("; ");
const IDEA = "deco-real-09-images-24";
const PROPUESTA = { frase: "Te propongo un arco y dos columnas.", colores: ["azul", "dorado"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 2 }] };
const OTRA_PROPUESTA = { frase: "Mejor un arco y una guirnalda.", colores: ["azul", "dorado"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "guirnalda", cantidad: 1 }] };
const CAMBIO_COLOR: CuerpoEditarMotor["edicion"] = { tipo: "pedido", pedido: { tipo: "reemplazar_color", color: "azul", colorNuevo: "rojo", piezas: [] } };
const cruce = crosswalkIncluido();

let anterior: Record<string, string | undefined> = {};
beforeEach(() => {
  anterior = { APP_PASSWORD: process.env.APP_PASSWORD, DATABASE_URL: process.env.DATABASE_URL };
  process.env.APP_PASSWORD = CLAVE_APP;
  delete process.env.DATABASE_URL;
});
afterEach(() => { for (const [clave, valor] of Object.entries(anterior)) { if (valor === undefined) delete process.env[clave]; else process.env[clave] = valor; } });

type Plan = ReturnType<typeof PlanGuiadoSchema.parse>;
type Auditoria = { quien: string; que: string; resultado: Record<string, unknown> };

/** Una instancia de la app: la fila de `ajustes_runtime` (bandera y corte) y el reloj se cambian a mano a mitad de la prueba. */
function instancia() {
  const ajustes: { motor: string | null; corte: string | null } = { motor: "3d", corte: null };
  const reloj = { ms: 1_000 };
  const auditorias: Auditoria[] = [];
  const cotizaciones = { total: 0 };
  const doble = pythonDoble(cruce);
  let ids = 0;
  const leerBandera = crearLectorBandera({
    esAdministrador: () => false,
    leerAjuste: async () => ajustes.motor,
    env: () => undefined,
    leerCorte: async () => ajustes.corte,
    envCorte: () => undefined,
    ahora: () => reloj.ms,
  });
  const auditar: DependenciasPlanMotor["auditar"] = (quien, que, resultado) => { auditorias.push({ quien, que, resultado: resultado as Record<string, unknown> }); };
  const cotizar: DependenciasPlanMotor["cotizar"] = (bom) => { cotizaciones.total += 1; return cotizarBom({ total: bom.total, porPieza: bom.porPieza }, { crosswalk: async () => cruce, cotizarLista: doble.cotizarLista }); };
  const nuevoId = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
  const registrarPlan = async (): Promise<void> => undefined;
  const plan: DependenciasPlanMotor = { leerBandera, auditar, planGuardado: planGuardadoDeIdea, cotizar, nuevoId, registrarPlan };
  const editar: DependenciasEditarMotor = { leerBandera, auditar, armar: (espec) => armarDesdeEspec(espec), planGuardado: planGuardadoDeIdea, cotizar, nuevoId, registrarPlan, tomarEdicion: crearTopePorNavegador(1000).tomar };
  /** La fila cambia en Neon y el caché de la instancia vence: la próxima petición ya la ve. */
  const fijar = (cambio: Partial<typeof ajustes>, vencerCache = true) => { Object.assign(ajustes, cambio); if (vencerCache) reloj.ms += TTL_AJUSTE_MS; };
  return { deps: { plan, editar }, auditorias, cotizaciones, fijar };
}

const peticion = (ruta: string, cuerpo: unknown) => new Request(`https://app.test${ruta}`, { method: "POST", headers: { "content-type": "application/json", cookie: COOKIES }, body: JSON.stringify(cuerpo) });
type App = ReturnType<typeof instancia>;

async function pedirPlan(app: App, cuerpo: unknown) {
  const respuesta = await atenderPlanMotor(peticion("/api/guiada/motor/plan", cuerpo), app.deps.plan);
  return { estado: respuesta.status, cuerpo: await respuesta.json() as unknown };
}
async function pedirCambio(app: App, plan: Plan, edicion = CAMBIO_COLOR) {
  const respuesta = await atenderEditarMotor(peticion("/api/guiada/motor/editar", { plan, edicion }), app.deps.editar);
  return { estado: respuesta.status, cuerpo: await respuesta.json() as unknown };
}
const planDe = (cuerpo: unknown): Plan => PlanGuiadoSchema.parse(RespuestaPlanMotorSchema.parse(cuerpo).plan);
const totalDe = (cotizacion: unknown): number => (cotizacion as { total: number }).total;
/** Lo que el cliente ve de un plan: qué se arma (hash de la espec) y cuánto cuesta. */
const huella = (cuerpo: unknown) => { const { plan, cotizacion } = cuerpo as { plan: Plan; cotizacion: unknown }; return { plan_hash: plan.plan_hash, total: totalDe(cotizacion) }; };

async function planAbierto(app: App): Promise<Plan> {
  const creado = await pedirPlan(app, { desde: "propuesta", propuesta: PROPUESTA });
  assert.equal(creado.estado, 200, JSON.stringify(creado.cuerpo).slice(0, 300));
  return planDe(creado.cuerpo);
}

test("la bandera vuelve a python a mitad de la conversación: el plan del 3D abierto se sigue cambiando, con el mismo precio que con 3d", async () => {
  const app = instancia();
  const plan = await planAbierto(app);
  const con3d = await pedirCambio(app, plan);
  assert.equal(con3d.estado, 200);

  app.fijar({ motor: "python" });
  const conPython = await pedirCambio(app, plan);
  assert.equal(conPython.estado, 200, JSON.stringify(conPython.cuerpo).slice(0, 300));
  const hecho = RespuestaEditarMotorSchema.parse(conPython.cuerpo);
  assert.deepEqual(huella(hecho), huella(con3d.cuerpo), "mismo plan y mismo precio: la marcha atrás no le cambia el precio a nadie");
  assert.match(hecho.confirmacion, /^Listo: /);
  const auditoria = app.auditorias.at(-1)!;
  assert.equal(auditoria.resultado.bandera, "python");
  assert.equal(auditoria.resultado.efectivo, "3d", "la auditoría dice que la bandera decía python y el plan siguió en el 3D");

  // El plan nuevo de la misma conversación sí obedece la bandera: va a Python antes de tener precio alguno.
  const nuevo = await pedirPlan(app, { desde: "propuesta", propuesta: OTRA_PROPUESTA });
  assert.equal(nuevo.estado, 409);
  assert.equal(FalloPlanMotorSchema.parse(nuevo.cuerpo).fallback?.razon, "bandera_python");
});

test("sumar una idea y rehacer la propuesta de un plan del 3D siguen en el 3D con la bandera en python, igual que con 3d", async () => {
  const app = instancia();
  const plan = await planAbierto(app);
  const sumada3d = await pedirPlan(app, { desde: "idea", idea_id: IDEA, base: plan });
  const rehecha3d = await pedirPlan(app, { desde: "propuesta", propuesta: OTRA_PROPUESTA, base: plan });
  assert.deepEqual([sumada3d.estado, rehecha3d.estado], [200, 200]);

  app.fijar({ motor: "python" });
  const sumada = await pedirPlan(app, { desde: "idea", idea_id: IDEA, base: plan });
  const rehecha = await pedirPlan(app, { desde: "propuesta", propuesta: OTRA_PROPUESTA, base: plan });
  assert.deepEqual([sumada.estado, rehecha.estado], [200, 200], JSON.stringify([sumada.cuerpo, rehecha.cuerpo]).slice(0, 300));
  assert.deepEqual(huella(sumada.cuerpo), huella(sumada3d.cuerpo), "la idea se suma con el motor del plan y el mismo precio");
  assert.deepEqual(huella(rehecha.cuerpo), huella(rehecha3d.cuerpo), "la propuesta se rehace con el motor del plan y el mismo precio");
  // Lo que sale de un plan del 3D sigue siendo del 3D: se puede seguir cambiando aunque la bandera diga python.
  assert.equal((await pedirCambio(app, planDe(sumada.cuerpo))).estado, 200);
  const exitosas = app.auditorias.filter((a) => a.resultado.efectivo === "3d" && a.resultado.bandera === "python");
  assert.equal(exitosas.length, 3);
  assert.ok(exitosas.slice(0, 2).every((a) => a.resultado.conserva_motor === "plan_3d_abierto"), "el plan y la suma dicen por qué siguen en el 3D");
});

test("dentro de los 30 s del caché la bandera vieja sigue decidiendo los planes nuevos; a los abiertos les da igual antes y después", async () => {
  const app = instancia();
  const plan = await planAbierto(app);
  app.fijar({ motor: "python" }, false);
  assert.equal((await pedirPlan(app, { desde: "propuesta", propuesta: OTRA_PROPUESTA })).estado, 200, "la instancia todavía no ve la fila nueva");
  const antes = await pedirCambio(app, plan);
  app.fijar({}, true);
  assert.equal((await pedirPlan(app, { desde: "propuesta", propuesta: OTRA_PROPUESTA })).estado, 409, "vencido el caché, el plan nuevo va a Python");
  const despues = await pedirCambio(app, plan);
  assert.deepEqual([antes.estado, despues.estado], [200, 200]);
  assert.deepEqual(huella(despues.cuerpo), huella(antes.cuerpo));
  // Y al revés: si la bandera vuelve a 3d, el plan abierto tampoco se entera.
  app.fijar({ motor: "3d" });
  assert.deepEqual(huella((await pedirCambio(app, plan)).cuerpo), huella(antes.cuerpo));
});

test("el corte del 3D frena el plan abierto sin tocarlo ni cotizar: código estable y una frase que avisa del recálculo y del precio", async () => {
  const app = instancia();
  const plan = await planAbierto(app);
  const antes = await pedirCambio(app, plan);
  app.fijar({ corte: "activo" });
  const cotizadas = app.cotizaciones.total;

  const cambio = await pedirCambio(app, plan);
  assert.equal(cambio.estado, 409);
  const dicho = FalloEditarMotorSchema.parse(cambio.cuerpo);
  assert.equal(dicho.codigo, "MOTOR_3D_CORTADO");
  assert.deepEqual(dicho.fallback, { razon: "motor_3d_cortado" });
  assert.equal(dicho.error, TEXTO_EDICION_RECALCULO);
  assert.match(dicho.error, /^No pude: /, "D-023: lo que no se hizo se dice como «No pude: …»");
  assert.match(dicho.error, /volver a calcular tu plan/);
  assert.match(dicho.error, /el precio pueden cambiar/);
  assert.match(dicho.error, /Tu plan sigue como estaba/);
  assert.doesNotMatch(dicho.error, /motor|armad|python|3d/i, "en palabras de cliente, sin jerga");

  for (const cuerpo of [{ desde: "idea", idea_id: IDEA, base: plan }, { desde: "propuesta", propuesta: OTRA_PROPUESTA, base: plan }, { desde: "propuesta", propuesta: OTRA_PROPUESTA }]) {
    const pedido = await pedirPlan(app, cuerpo);
    assert.equal(pedido.estado, 409);
    const fallo = FalloPlanMotorSchema.parse(pedido.cuerpo);
    assert.equal(fallo.codigo, "MOTOR_3D_CORTADO");
    assert.equal(fallo.fallback?.razon, "motor_3d_cortado");
  }
  assert.equal(app.cotizaciones.total, cotizadas, "con el corte no se cotiza nada: ningún precio nuevo sale del servidor");
  const delCorte = app.auditorias.filter((a) => a.resultado.razon === "motor_3d_cortado");
  assert.equal(delCorte.length, 4, "cada rechazo del corte queda en la auditoría");
  assert.ok(delCorte.every((a) => a.quien === "regla:motor_guiada" && a.resultado.fuente === "corte"));

  // Quitado el corte, el plan abierto vuelve a cambiarse en el 3D, igual que antes.
  app.fijar({ corte: "inactivo" });
  const otraVez = await pedirCambio(app, plan);
  assert.equal(otraVez.estado, 200);
  assert.deepEqual(huella(otraVez.cuerpo), huella(antes.cuerpo));
});

const HORA = 60 * 60 * 1000;
/** El mismo plan con su token firmado de nuevo como si su línea hubiera empezado hace `horas` (lo único que cambia). */
function conOrigen(plan: Plan, horas: number): Plan {
  const contexto = abrirContextoPlan(plan.approval_token)!;
  const { planHash, requestId, catalogSnapshotId, allowlist } = contexto;
  return { ...plan, approval_token: crearTokenPlan({ planHash, requestId, backend: "globos3d", catalogSnapshotId, allowlist, navegador: contexto.navegador!, origenEn: Date.now() - horas * HORA }) };
}
const payloadDe = (token: string): Record<string, unknown> => JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8")) as Record<string, unknown>;

test("encadenar cambios no alarga la línea: cada plan que sale de otro hereda la hora de su primer plan", async () => {
  const app = instancia();
  const plan = await planAbierto(app);
  const origen = abrirContextoPlan(plan.approval_token)!.origenEn;
  assert.ok(Math.abs(Date.now() - origen) < 60_000, "un plan nuevo empieza su línea ahora");
  const cambiado = RespuestaEditarMotorSchema.parse((await pedirCambio(app, plan)).cuerpo).plan;
  const sumado = planDe((await pedirPlan(app, { desde: "idea", idea_id: IDEA, base: cambiado })).cuerpo);
  const rehecho = planDe((await pedirPlan(app, { desde: "propuesta", propuesta: OTRA_PROPUESTA, base: sumado })).cuerpo);
  for (const derivado of [cambiado, sumado, rehecho]) assert.equal(abrirContextoPlan(derivado.approval_token)!.origenEn, origen);
  // Los tokens de Python no cambian (ni el campo): su camino queda igual, byte a byte.
  assert.equal("origenEn" in payloadDe(crearTokenPlan({ planHash: "h", requestId: "r", backend: "python", catalogSnapshotId: "s", allowlist: [] })), false);
  assert.ok(Math.abs(abrirContextoPlan(crearTokenPlan({ planHash: "h", requestId: "r", backend: "globos3d", catalogSnapshotId: "s", allowlist: [] }))!.origenEn - Date.now()) < 60_000, "un token sin el campo cuenta desde su emisión");
});

test("con la bandera en python, una línea del 3D de más de 24 h deja el 3D: 409 PLAN_3D_VENCIDO con la frase del recálculo, sin cotizar; con 3d no hay límite", async () => {
  const app = instancia();
  const viejo = conOrigen(await planAbierto(app), 25);
  assert.equal((await pedirCambio(app, viejo)).estado, 200, "con la bandera en 3d el 3D es el motor vigente: sin límite");

  app.fijar({ motor: "python" });
  const cotizadas = app.cotizaciones.total;
  const cambio = await pedirCambio(app, viejo);
  assert.equal(cambio.estado, 409);
  const dicho = FalloEditarMotorSchema.parse(cambio.cuerpo);
  assert.deepEqual({ codigo: dicho.codigo, fallback: dicho.fallback, error: dicho.error }, { codigo: "PLAN_3D_VENCIDO", fallback: { razon: "plan_3d_vencido" }, error: TEXTO_EDICION_RECALCULO });
  for (const cuerpo of [{ desde: "idea", idea_id: IDEA, base: viejo }, { desde: "propuesta", propuesta: OTRA_PROPUESTA, base: viejo }]) {
    const pedido = await pedirPlan(app, cuerpo);
    assert.equal(pedido.estado, 409);
    const fallo = FalloPlanMotorSchema.parse(pedido.cuerpo);
    assert.deepEqual({ codigo: fallo.codigo, razon: fallo.fallback?.razon }, { codigo: "PLAN_3D_VENCIDO", razon: "plan_3d_vencido" });
  }
  assert.equal(app.cotizaciones.total, cotizadas, "nada se cotiza: ningún precio nuevo sale del servidor");

  const reciente = conOrigen(await (async () => { app.fijar({ motor: "3d" }); return planAbierto(app); })(), 23);
  app.fijar({ motor: "python" });
  assert.equal((await pedirCambio(app, reciente)).estado, 200, "dentro del límite sigue en el 3D");
});

test("un plan del 3D con la aprobación vencida (24 h sin cambios) o de otro navegador: el servidor no lo toca y lo dice como recálculo, sin cotizar", async () => {
  const app = instancia();
  const plan = await planAbierto(app);
  const contexto = abrirContextoPlan(plan.approval_token)!;
  const { planHash, requestId, catalogSnapshotId, allowlist } = contexto;
  const vencido: Plan = { ...plan, approval_token: crearTokenPlan({ planHash, requestId, backend: "globos3d", catalogSnapshotId, allowlist, navegador: contexto.navegador!, origenEn: contexto.origenEn }, -1) };
  const ajeno: Plan = { ...plan, approval_token: crearTokenPlan({ planHash, requestId, backend: "globos3d", catalogSnapshotId, allowlist, navegador: "b2".repeat(32), origenEn: contexto.origenEn }) };
  const cotizadas = app.cotizaciones.total;
  for (const viejo of [vencido, ajeno]) {
    const cambio = await pedirCambio(app, viejo);
    assert.equal(cambio.estado, 409);
    const dicho = FalloEditarMotorSchema.parse(cambio.cuerpo);
    assert.deepEqual({ codigo: dicho.codigo, fallback: dicho.fallback, error: dicho.error }, { codigo: "APROBACION_INVALIDA", fallback: { razon: "aprobacion_invalida" }, error: TEXTO_EDICION_RECALCULO }, "«No pude: …» en palabras de cliente, no «La aprobación del plan expiró…»");
    for (const cuerpo of [{ desde: "idea", idea_id: IDEA, base: viejo }, { desde: "propuesta", propuesta: OTRA_PROPUESTA, base: viejo }]) {
      const pedido = await pedirPlan(app, cuerpo);
      assert.equal(pedido.estado, 409);
      const fallo = FalloPlanMotorSchema.parse(pedido.cuerpo);
      assert.deepEqual({ codigo: fallo.codigo, razon: fallo.fallback?.razon }, { codigo: "APROBACION_INVALIDA", razon: "aprobacion_invalida" }, "la vista avisa antes de recalcular (antes: «servidor» y Python en silencio)");
    }
  }
  assert.equal(app.cotizaciones.total, cotizadas);
});
