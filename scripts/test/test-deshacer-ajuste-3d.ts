/**
 * Deshacer un ajuste de un plan del motor 3D (REQ-016, P-042): el plan vuelve a lo que el cliente tenía, tal como lo guardó la
 * vista antes del ajuste (espec, hash, token y cotización), nunca con un ajuste inverso. Sin coste: la bandera, Python y la
 * auditoría son dobles, como en `test-motor-guiada-editar-ruta.ts`; los planes y los ajustes salen de la ruta real de edición.
 * - agrandar y volver a achicar con el ajuste inverso NO deja la espec que había (la deriva de P-042), y volver por su nombre a
 *   un color que se fundió con otro cambia los códigos; deshacer, en cambio, deja la espec idéntica y el plan sigue editándose
 *   con su mismo token;
 * - varios ajustes seguidos se deshacen de uno en uno, hasta los que la pila recuerda; sin plan guardado se rechaza con «No pude:»;
 * - un plan que ya no es el de ese ajuste, o uno de Python, no se deshace.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-deshacer-ajuste-3d.ts
 */
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { SESSION_COOKIE, sessionToken } from "../../src/lib/auth/session";
import { PlanGuiadoSchema, CotizacionPlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { WidgetGuiadoSchema } from "../../src/lib/ia/guiado/widgets";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";
import { atenderPlanMotor, huellaDeNavegador, type DependenciasPlanMotor } from "../../src/lib/guiada-motor/plan-motor";
import { atenderEditarMotor, type DependenciasEditarMotor } from "../../src/lib/guiada-motor/editar-motor";
import { crearTopePorNavegador } from "../../src/lib/guiada-motor/tope-imagenes-navegador";
import { RespuestaEditarMotorSchema, type CuerpoEditarMotor } from "../../src/lib/guiada-motor/editar-contrato";
import { verificarPlanConConcepto } from "../../src/lib/guiada-motor/verificar-plan";
import { armarDesdeEspec, cotizarBom, crearCachePiezas, crosswalkIncluido, type EspecClienteV1 } from "../../src/lib/globos3d/motor/v1";
import { MAX_AJUSTES_DESHACER, deshacerAjuste, puedeDeshacer, recordarParaDeshacer, vencimientoDelToken, type PilaDeshacer, type WidgetDelPlan } from "../../src/components/guiado/deshacer-ajuste";
import { pythonDoble } from "../lib/python-doble-precio";

const CLAVE_APP = "clave-app-de-prueba";
const SESION = `${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}`;
const USUARIO = "a1".repeat(16);
const NAVEGADOR = `feedback_usuario=${USUARIO}`;
const cruce = crosswalkIncluido();
const PROPUESTA = { frase: "Te propongo un arco y dos columnas.", colores: ["azul", "dorado"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 2 }] };

let anterior: Record<string, string | undefined> = {};
beforeEach(() => {
  anterior = { APP_PASSWORD: process.env.APP_PASSWORD, DATABASE_URL: process.env.DATABASE_URL, GUIADA_MOTOR: process.env.GUIADA_MOTOR };
  process.env.APP_PASSWORD = CLAVE_APP;
  delete process.env.DATABASE_URL;
  delete process.env.GUIADA_MOTOR;
});
afterEach(() => { for (const [clave, valor] of Object.entries(anterior)) { if (valor === undefined) delete process.env[clave]; else process.env[clave] = valor; } });

type Plan = ReturnType<typeof PlanGuiadoSchema.parse> & { espec: EspecClienteV1; motor: { id: string; version: string } };
type Ajuste = { plan: Plan; cotizacion: ReturnType<typeof CotizacionPlanGuiadoSchema.parse>; descripcion: string; turno: { antes: { espec: unknown }; despues: { espec: unknown } } };

/** La ruta real de edición y la del plan, con Python y la auditoría de doble (como `entorno()` de la prueba de la ruta). */
function entorno() {
  let ids = 0;
  const cachePiezas = crearCachePiezas(64);
  const doble = pythonDoble(cruce);
  const cotizar: DependenciasEditarMotor["cotizar"] = (bom) => cotizarBom({ total: bom.total, porPieza: bom.porPieza }, { crosswalk: async () => cruce, cotizarLista: doble.cotizarLista });
  const nuevoId = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
  const comunes = { leerBandera: async () => ({ motor: "3d" as const, fuente: "cookie" as const }), auditar: () => undefined, planGuardado: planGuardadoDeIdea, cotizar, nuevoId, registrarPlan: async () => undefined };
  const edicion: DependenciasEditarMotor = { ...comunes, armar: (espec) => armarDesdeEspec(espec, { cachePiezas }), tomarEdicion: crearTopePorNavegador(1000).tomar };
  const plan: DependenciasPlanMotor = comunes;
  return { edicion, plan };
}

const pedir = (cuerpo: unknown) => new Request("https://app.test/api/guiada/motor/editar", { method: "POST", headers: { "content-type": "application/json", cookie: `${SESION}; ${NAVEGADOR}` }, body: JSON.stringify(cuerpo) });

async function planInicial(e: ReturnType<typeof entorno>): Promise<{ plan: Plan; cotizacion: Ajuste["cotizacion"] }> {
  const respuesta = await atenderPlanMotor(new Request("https://app.test/api/guiada/motor/plan", { method: "POST", headers: { "content-type": "application/json", cookie: `${SESION}; ${NAVEGADOR}` }, body: JSON.stringify({ desde: "propuesta", propuesta: PROPUESTA, brief: { evento: "boda", tematica: "boda azul y dorada" } }) }), e.plan);
  assert.equal(respuesta.status, 200);
  const { plan, cotizacion } = (await respuesta.json()) as { plan: unknown; cotizacion: unknown };
  return { plan: PlanGuiadoSchema.parse(plan) as Plan, cotizacion: CotizacionPlanGuiadoSchema.parse(cotizacion) };
}

/** Un ajuste del cliente sobre `plan`, por la ruta real: lo que `ejecutarCambio3d` le devuelve a la vista. */
async function ajustar(e: ReturnType<typeof entorno>, plan: Plan, edicion: CuerpoEditarMotor["edicion"]): Promise<Ajuste> {
  const respuesta = await atenderEditarMotor(pedir({ plan, edicion }), e.edicion);
  assert.equal(respuesta.status, 200, JSON.stringify(await respuesta.clone().json()));
  const hecho = RespuestaEditarMotorSchema.parse(await respuesta.json());
  return { plan: PlanGuiadoSchema.parse(hecho.plan) as Plan, cotizacion: CotizacionPlanGuiadoSchema.parse(hecho.cotizacion), descripcion: hecho.descripcion, turno: hecho.turno as Ajuste["turno"] };
}

const TAMANO_ARCO = (direccion: 1 | -1): CuerpoEditarMotor["edicion"] => ({ tipo: "cambio", cambio: { tipo: "tamano", estructuraId: "EST_01_ARCO", direccion } });
const COLOR = (color: string, nuevo: string): CuerpoEditarMotor["edicion"] => ({ tipo: "cambio", cambio: { tipo: "reemplazar-color", color, nuevo } });

/** El widget del plan como la vista lo guarda en la conversación. */
function widgetDe(plan: Plan, cotizacion: Ajuste["cotizacion"], extra: Record<string, unknown> = {}): WidgetDelPlan {
  const leido = WidgetGuiadoSchema.parse({ tipo: "plan", plan, motor: "3d", cotizacion, ...extra });
  assert.equal(leido.tipo, "plan");
  return leido as WidgetDelPlan;
}

/** Lo que hace `ajustarPlan` de la vista con un ajuste hecho: recuerda el widget de antes y publica el plan nuevo. */
function publicar(pila: PilaDeshacer, antes: WidgetDelPlan, ajuste: Ajuste): { pila: PilaDeshacer; widget: WidgetDelPlan } {
  return {
    pila: recordarParaDeshacer(pila, antes, ajuste.plan.plan_hash),
    widget: { ...antes, plan: ajuste.plan, cotizacion: ajuste.cotizacion, ajustes: [...(antes.ajustes ?? []), ajuste.descripcion], totalAnterior: antes.plan.plan.estructuras.length },
  };
}

const igualAlPlan = (obtenido: Plan, esperado: Plan, etiqueta: string): void => {
  assert.equal(JSON.stringify(obtenido), JSON.stringify(esperado), `${etiqueta}: el plan no quedó idéntico, byte a byte`);
  assert.equal(obtenido.plan_hash, esperado.plan_hash, `${etiqueta}: hash`);
  assert.equal(obtenido.approval_token, esperado.approval_token, `${etiqueta}: token`);
  assert.deepEqual(obtenido.espec, esperado.espec, `${etiqueta}: espec`);
};

test("agrandar y achicar con el ajuste inverso deriva; deshacer deja la espec idéntica y el plan se sigue editando", async () => {
  const e = entorno();
  const { plan: plan0, cotizacion: cotizacion0 } = await planInicial(e);
  const widget0 = widgetDe(plan0, cotizacion0);

  const agrandado = await ajustar(e, plan0, TAMANO_ARCO(1));
  const publicado = publicar([], widget0, agrandado);
  assert.ok(puedeDeshacer(publicado.pila, publicado.widget));

  // La deriva de P-042 con el ajuste inverso: el arco agrandado y achicado un paso por la ruta no vuelve a lo de antes.
  const achicadoAlReves = await ajustar(e, agrandado.plan, TAMANO_ARCO(-1));
  const arcoAntes = plan0.espec.piezas.find((pieza) => pieza.id === "EST_01_ARCO")!.medidas;
  const arcoInverso = achicadoAlReves.plan.espec.piezas.find((pieza) => pieza.id === "EST_01_ARCO")!.medidas;
  console.log(`      informe: arco ${JSON.stringify(arcoAntes)} → agrandado → ajuste inverso ${JSON.stringify(arcoInverso)}`);
  assert.notEqual(achicadoAlReves.plan.plan_hash, plan0.plan_hash, "P-042: agrandar y achicar un paso ya dejaba la espec de antes; si el motor lo logró, deshacer sigue siendo restaurar, pero esta prueba debe cambiar");

  const deshecho = deshacerAjuste(publicado.pila, publicado.widget);
  assert.ok(deshecho.ok, "deshacer rechazó un ajuste que sí se hizo");
  igualAlPlan(deshecho.widget.plan as Plan, plan0, "deshacer el tamaño");
  assert.deepEqual(deshecho.widget.plan.espec, agrandado.turno.antes.espec, "la espec que vuelve es la que el servidor guardó como «antes» del turno");
  assert.deepEqual(deshecho.widget.cotizacion, cotizacion0, "el precio que vuelve es el que el cliente veía");
  assert.equal(deshecho.pila.length, 0);

  // Lo deshecho es un plan firmado y vigente: el servidor lo acepta como base y rehace lo mismo que antes.
  const verificado = verificarPlanConConcepto(deshecho.widget.plan, huellaDeNavegador(`nav-${USUARIO}`));
  assert.ok(!("codigo" in verificado), "el token del plan restaurado ya no sirve");
  const otraVez = await ajustar(e, deshecho.widget.plan as Plan, TAMANO_ARCO(1));
  assert.equal(otraVez.plan.plan_hash, agrandado.plan.plan_hash, "editar el plan restaurado no da lo mismo que editar el original");
});

test("un color que se funde con otro: volver por su nombre cambia los códigos; deshacer deja los de antes", async () => {
  const e = entorno();
  const { plan: plan0, cotizacion: cotizacion0 } = await planInicial(e);
  const widget0 = widgetDe(plan0, cotizacion0);
  const codigos = (plan: Plan) => plan.espec.piezas.map((pieza) => pieza.colores.map((color) => color.codigo).join("+"));

  const dorado = await ajustar(e, plan0, COLOR("azul", "dorado"));
  const publicado = publicar([], widget0, dorado);
  assert.ok(dorado.plan.espec.piezas.every((pieza) => pieza.colores.length === 1), "el azul pasado a dorado ya no se funde con el dorado de cada pieza: este caso debe cambiar");
  const deVuelta = await ajustar(e, dorado.plan, COLOR("dorado", "azul"));
  console.log(`      informe: códigos ${codigos(plan0).join(" | ")} → dorado → «dorado → azul» por nombre ${codigos(deVuelta.plan).join(" | ")}`);
  // La otra cara de P-042: el azul se fundió con el dorado que ya estaba, y volver «dorado → azul» por nombre pinta de azul los dos.
  assert.notDeepEqual(codigos(deVuelta.plan), codigos(plan0), "P-042: volver al color por su nombre ya dejaba los códigos de antes; si el motor lo logró, deshacer sigue siendo restaurar, pero esta prueba debe cambiar");

  const deshecho = deshacerAjuste(publicado.pila, publicado.widget);
  assert.ok(deshecho.ok);
  assert.deepEqual(codigos(deshecho.widget.plan as Plan), codigos(plan0));
  igualAlPlan(deshecho.widget.plan as Plan, plan0, "deshacer el color");
  // Lo que la vista guarda en la sesión del navegador (esquema estricto) lo lee igual.
  assert.deepEqual(WidgetGuiadoSchema.parse(deshecho.widget), deshecho.widget);
});

test("un plan de antes con la aprobación vencida (o por vencer) no se restaura: se rechaza sin tocar la pila", async () => {
  const e = entorno();
  const { plan: plan0, cotizacion: cotizacion0 } = await planInicial(e);
  const widget0 = widgetDe(plan0, cotizacion0);
  const a1 = await ajustar(e, plan0, TAMANO_ARCO(1));
  const { pila, widget } = publicar([], widget0, a1);

  const vence = vencimientoDelToken(plan0.approval_token);
  assert.ok(vence !== null && vence > Date.now(), "el token del plan de antes dice cuándo vence");
  assert.equal(vencimientoDelToken("no-es-un-token"), null);
  const casiVencido = deshacerAjuste(pila, widget, vence! - 60_000);
  assert.ok(!casiVencido.ok);
  assert.equal(casiVencido.codigo, "aprobacion_vencida");
  assert.match(casiVencido.mensaje, /^No pude deshacer: la aprobación de tu plan de antes ya venció/);
  assert.equal(casiVencido.pila.length, 0, "los planes más viejos vencieron antes: la pila se vacía y el botón deja de ofrecerse");
  // El margen: a 4 min de vencer ya no sirve; a 6 min todavía.
  assert.ok(!deshacerAjuste(pila, widget, vence! - 4 * 60_000).ok);
  assert.ok(deshacerAjuste(pila, widget, vence! - 6 * 60_000).ok);
  assert.ok(deshacerAjuste(pila, widget, vence! - 3_600_000).ok, "con tiempo de sobra sí se deshace");
});

test("varios ajustes se deshacen de uno en uno, cada uno a su plan de antes; sin más pasos guardados se rechaza con «No pude:»", async () => {
  const e = entorno();
  const { plan: plan0, cotizacion: cotizacion0 } = await planInicial(e);
  const widget0 = widgetDe(plan0, cotizacion0);

  const a1 = await ajustar(e, plan0, TAMANO_ARCO(1));
  const p1 = publicar([], widget0, a1);
  const a2 = await ajustar(e, a1.plan, TAMANO_ARCO(-1));
  const p2 = publicar(p1.pila, p1.widget, a2);
  const a3 = await ajustar(e, a2.plan, COLOR("azul", "rojo"));
  const p3 = publicar(p2.pila, p2.widget, a3);
  assert.equal(p3.pila.length, 3);

  const primero = deshacerAjuste(p3.pila, p3.widget);
  assert.ok(primero.ok);
  igualAlPlan(primero.widget.plan as Plan, a2.plan, "primer deshacer");
  assert.deepEqual(primero.widget.ajustes, p2.widget.ajustes, "«Último ajuste» vuelve al de antes");
  const segundo = deshacerAjuste(primero.pila, primero.widget);
  assert.ok(segundo.ok);
  igualAlPlan(segundo.widget.plan as Plan, a1.plan, "segundo deshacer");
  const tercero = deshacerAjuste(segundo.pila, segundo.widget);
  assert.ok(tercero.ok);
  igualAlPlan(tercero.widget.plan as Plan, plan0, "tercer deshacer");
  assert.equal(tercero.widget.ajustes, undefined);
  assert.equal(tercero.widget.totalAnterior, widget0.totalAnterior);

  assert.equal(puedeDeshacer(tercero.pila, tercero.widget), false);
  const sinPasos = deshacerAjuste(tercero.pila, tercero.widget);
  assert.ok(!sinPasos.ok);
  assert.equal(sinPasos.codigo, "sin_plan_de_antes");
  assert.match(sinPasos.mensaje, /^No pude deshacer/);
  assert.equal(sinPasos.pila.length, 0);
});

test("solo se deshace sobre el plan que dejó ese ajuste: si el plan cambió por otro lado, se rechaza y la pila queda vacía", async () => {
  const e = entorno();
  const { plan: plan0, cotizacion: cotizacion0 } = await planInicial(e);
  const widget0 = widgetDe(plan0, cotizacion0);
  const a1 = await ajustar(e, plan0, TAMANO_ARCO(1));
  const p1 = publicar([], widget0, a1);
  const a2 = await ajustar(e, a1.plan, COLOR("azul", "rojo"));
  const cambiadoPorOtroLado = { ...p1.widget, plan: a2.plan };

  assert.equal(puedeDeshacer(p1.pila, cambiadoPorOtroLado), false);
  const resultado = deshacerAjuste(p1.pila, cambiadoPorOtroLado);
  assert.ok(!resultado.ok);
  assert.equal(resultado.codigo, "plan_cambio");
  assert.match(resultado.mensaje, /^No pude deshacer/);
  assert.match(resultado.mensaje, /sigue como está/);
  assert.equal(resultado.pila.length, 0);
});

test("un plan de Python no guarda nada para deshacer: la pila queda igual", async () => {
  const e = entorno();
  const { plan: plan0, cotizacion: cotizacion0 } = await planInicial(e);
  const a1 = await ajustar(e, plan0, TAMANO_ARCO(1));
  const deLaClasica: WidgetDelPlan = { ...widgetDe(plan0, cotizacion0), motor: "python" };
  const pila = recordarParaDeshacer([], deLaClasica, a1.plan.plan_hash);
  assert.equal(pila.length, 0);
  assert.equal(puedeDeshacer(pila, { ...deLaClasica, plan: a1.plan }), false);
});

test("la pila recuerda los últimos ajustes y suelta los más viejos; un ajuste que no cambió el plan no cuenta", async () => {
  const e = entorno();
  const { plan: plan0, cotizacion: cotizacion0 } = await planInicial(e);
  const base = widgetDe(plan0, cotizacion0);
  const total = MAX_AJUSTES_DESHACER + 2;
  let pila: PilaDeshacer = [];
  let actual = base;
  const planes: WidgetDelPlan[] = [base];
  for (let i = 1; i <= total; i += 1) {
    const siguiente = { ...actual, plan: { ...actual.plan, plan_hash: `${String(i).padStart(64, "0")}` }, ajustes: [`ajuste ${i}`] };
    pila = recordarParaDeshacer(pila, actual, siguiente.plan.plan_hash);
    actual = siguiente;
    planes.push(actual);
  }
  assert.equal(pila.length, MAX_AJUSTES_DESHACER);
  for (let i = total; i > total - MAX_AJUSTES_DESHACER; i -= 1) {
    const resultado = deshacerAjuste(pila, actual);
    assert.ok(resultado.ok, `deshacer ${i}`);
    assert.equal(resultado.widget.plan.plan_hash, planes[i - 1]!.plan.plan_hash);
    pila = resultado.pila;
    actual = resultado.widget;
  }
  assert.ok(!deshacerAjuste(pila, actual).ok, "más allá de lo que la pila recuerda se rechaza");

  assert.equal(recordarParaDeshacer([], base, base.plan.plan_hash).length, 0, "un ajuste que deja el mismo plan no es un paso para deshacer");
});

test("al deshacer se conserva lo que el cliente hizo después (uso, compra abierta) y se descarta lo del plan de antes que ya no vale (imagen, «Ver»)", async () => {
  const e = entorno();
  const { plan: plan0, cotizacion: cotizacion0 } = await planInicial(e);
  const antes = widgetDe(plan0, cotizacion0, { imagen: "/api/guiada-imagen/antes", avisoImagen: "No cotizo la mesa.", hechas: ["ver"] });
  const a1 = await ajustar(e, plan0, TAMANO_ARCO(1));
  const { pila, widget } = publicar([], antes, a1);
  const despues: WidgetDelPlan = { ...widget, usoCosteo: "personal", compraAbierta: true, hechas: ["costear"] };

  const deshecho = deshacerAjuste(pila, despues);
  assert.ok(deshecho.ok);
  assert.equal(deshecho.widget.usoCosteo, "personal");
  assert.equal(deshecho.widget.compraAbierta, true);
  assert.deepEqual(deshecho.widget.hechas, ["costear"]);
  assert.equal(deshecho.widget.imagen, undefined);
  assert.equal(deshecho.widget.avisoImagen, undefined);
  assert.equal(deshecho.widget.motor, "3d");
});
