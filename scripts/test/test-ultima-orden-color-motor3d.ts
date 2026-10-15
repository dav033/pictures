/**
 * Acceptance test suite for REQ-016 T2 (P-058 A1 / D-046):
 * Storing the last colour order; no ask when destination is already selected; count «puede ser» in no_aplicadas audit.
 *
 * Covers resolver acceptance and audit regressions across real pure domain operations
 * and real-route integration with Python pricing double.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-ultima-orden-color-motor3d.ts
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test, { afterEach, beforeEach } from "node:test";
import { SESSION_COOKIE, sessionToken } from "../../src/lib/auth/session";
import { PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";
import { atenderPlanMotor, type DependenciasPlanMotor } from "../../src/lib/guiada-motor/plan-motor";
import { atenderEditarMotor, type DependenciasEditarMotor } from "../../src/lib/guiada-motor/editar-motor";
import { crearTopePorNavegador } from "../../src/lib/guiada-motor/tope-imagenes-navegador";
import { RespuestaEditarMotorSchema, type CuerpoEditarMotor, type FalloEditarMotor } from "../../src/lib/guiada-motor/editar-contrato";
import {
  aplicarEdicion, armarDesdeEspec, cotizarBom, crearCachePiezas,
  crosswalkIncluido, especDesdePropuesta,
  crearContextoOrdenColorVacio, type EspecClienteV1,
} from "../../src/lib/globos3d/motor/v1";
import { abrirContextoPlan, crearTokenPlan, verificarTokenAprobacion } from "../../src/lib/plan/aprobacion";
import { deshacerAjuste, recordarParaDeshacer, type WidgetDelPlan } from "../../src/components/guiado/deshacer-ajuste";
import { loQueNombra } from "./lib-oraculo-color";
import { pythonDoble } from "../lib/python-doble-precio";

process.env.PLAN_APPROVAL_SECRET ??= "test-plan-approval-secret";

const CLAVE_APP = "clave-app-de-prueba";
const SESION = `${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}`;
const USUARIO = "a1".repeat(16);
const NAVEGADOR = `feedback_usuario=${USUARIO}`;
const cruce = crosswalkIncluido();

let anterior: Record<string, string | undefined> = {};
beforeEach(() => {
  anterior = { APP_PASSWORD: process.env.APP_PASSWORD, DATABASE_URL: process.env.DATABASE_URL, GUIADA_MOTOR: process.env.GUIADA_MOTOR, PLAN_APPROVAL_SECRET: process.env.PLAN_APPROVAL_SECRET, PLAN_COLOR_ORDER_V3: process.env.PLAN_COLOR_ORDER_V3 };
  process.env.APP_PASSWORD = CLAVE_APP;
  process.env.PLAN_COLOR_ORDER_V3 = "true";
  process.env.PLAN_APPROVAL_SECRET = "test-plan-approval-secret";
  delete process.env.DATABASE_URL;
  delete process.env.GUIADA_MOTOR;
});
afterEach(() => {
  for (const [clave, valor] of Object.entries(anterior)) {
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
});


type Plan = ReturnType<typeof PlanGuiadoSchema.parse> & { espec: EspecClienteV1 };

function entorno() {
  let ids = 0;
  const cachePiezas = crearCachePiezas(64);
  const doble = pythonDoble(cruce);
  const cotizar: DependenciasEditarMotor["cotizar"] = (bom) => cotizarBom({ total: bom.total, porPieza: bom.porPieza }, { crosswalk: async () => cruce, cotizarLista: doble.cotizarLista });
  const nuevoId = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
  const comunes = { leerBandera: async () => ({ motor: "3d" as const, fuente: "cookie" as const }), auditar: () => undefined, planGuardado: planGuardadoDeIdea, cotizar, nuevoId, registrarPlan: async () => undefined };
  const edicion: DependenciasEditarMotor = { ...comunes, armar: (espec) => armarDesdeEspec(espec, { cachePiezas }), tomarEdicion: crearTopePorNavegador(1000).tomar };
  const plan: DependenciasPlanMotor = comunes;
  return { edicion, plan, doble };
}

const pedir = (cuerpo: unknown) => new Request("https://app.test/api/guiada/motor/editar", { method: "POST", headers: { "content-type": "application/json", cookie: `${SESION}; ${NAVEGADOR}` }, body: JSON.stringify(cuerpo) });

async function crearPlanEnRuta(e: ReturnType<typeof entorno>, propuesta: { frase: string; colores: string[]; piezas: Array<{ estructura: string; cantidad: number }> }): Promise<Plan> {
  const respuesta = await atenderPlanMotor(new Request("https://app.test/api/guiada/motor/plan", { method: "POST", headers: { "content-type": "application/json", cookie: `${SESION}; ${NAVEGADOR}` }, body: JSON.stringify({ desde: "propuesta", propuesta, brief: { evento: "boda", tematica: "prueba" } }) }), e.plan);
  assert.equal(respuesta.status, 200);
  const { plan } = (await respuesta.json()) as { plan: unknown };
  return PlanGuiadoSchema.parse(plan) as Plan;
}

async function editarEnRuta(e: ReturnType<typeof entorno>, plan: Plan, edicion: CuerpoEditarMotor["edicion"]): Promise<{ status: number; body: unknown }> {
  const respuesta = await atenderEditarMotor(pedir({ plan, edicion }), e.edicion);
  const body = await respuesta.json();
  return { status: respuesta.status, body };
}

// Case 1: Size/location/flower edit, then «rosa → blanco» with one source and blanco selected
test("Caso 1: tras edición de tamaño/medidas, «rosa → blanco» aplica sin preguntar y funde pesos", async () => {
  const e = entorno();
  // Plan con rosado (009) y blanco (005)
  const plan = await crearPlanEnRuta(e, { frase: "arco", colores: ["rosado", "blanco"], piezas: [{ estructura: "arco", cantidad: 1 }] });

  // Paso 1: Edición de tamaño (agrandar)
  const r1 = await editarEnRuta(e, plan, { tipo: "cambio", cambio: { tipo: "tamano", estructuraId: "EST_01_ARCO", direccion: 1 } });
  assert.equal(r1.status, 200);
  const planAgrandado = (r1.body as { plan: Plan }).plan;

  // Paso 2: «rosa → blanco» en el arco agrandado (blanco ya está seleccionado en la paleta)
  const r2 = await editarEnRuta(e, planAgrandado, {
    tipo: "ops",
    ediciones: [{ op: "reemplazar_color", de: "rosa", a: "blanco", piezas: ["EST_01_ARCO"] }],
  });
  assert.equal(r2.status, 200);
  const respuesta = RespuestaEditarMotorSchema.parse(r2.body);
  const arco = (respuesta.plan as Plan).espec.piezas.find((p) => p.id === "EST_01_ARCO")!;
  // El rosado fue reemplazado y sus pesos se fundieron con blanco (código 005)
  assert.deepEqual(arco.colores.map((c) => c.codigo), ["005"]);
  assert.equal(arco.colores[0]!.peso, 1);
  assert.equal(respuesta.noAplicadas.length, 0);
});

// Case 2: Unique catalogue fallback with destination already present, known-empty history
test("Caso 2: tono único de catálogo con destino ya presente aplica sin preguntar en historial conocido vacío", () => {
  // Plan con azul pastel (640 / Pastel Mate Azul) y blanco (005)
  const { espec } = especDesdePropuesta({ frase: "x", colores: ["celeste", "blanco"], piezas: [{ estructura: "arco", cantidad: 1 }] });
  // Arco tiene [640, 005].
  // Ahora pedimos «azul pastel → blanco». En el catálogo Sempertex, Pastel Mate Azul es el único azul pastel.
  // El destino blanco (005) ya está presente en el arco. Con historial conocido, aplica sin preguntar.
  const r = aplicarEdicion(espec, { op: "reemplazar_color", de: "azul pastel", a: "blanco" }, { ordenColor: crearContextoOrdenColorVacio() });
  assert.equal(r.noAplicado, undefined, `No debe preguntar: ${r.noAplicado}`);
  const colores = r.espec.piezas[0]!.colores;
  assert.deepEqual(colores.map((c) => c.codigo), ["005"]);
});

/// Case 3: Rosa(011) and Rosado(009), repeat the same replacement
test("Caso 3: Rosa (011) y Rosado (009), repetir el mismo reemplazo cambia primero solo su tarjeta y la segunda vez no cambia nada ni pregunta", async () => {
  const e = entorno();
  const plan = await crearPlanEnRuta(e, { frase: "x", colores: ["azul", "blanco"], piezas: [{ estructura: "arco", cantidad: 1 }] });
  // Añadimos Rosa (011) y Rosado (009) al arco
  const prep = await editarEnRuta(e, plan, {
    tipo: "ops",
    ediciones: [
      { op: "reemplazar_color", de: "azul", a: "011", piezas: ["EST_01_ARCO"] },
      { op: "agregar_color", color: "009", piezas: ["EST_01_ARCO"] },
    ],
  });
  assert.equal(prep.status, 200);
  const planConAmbosRosas = (prep.body as { plan: Plan }).plan;

  // Primera vez: «rosa» cambia exactamente la tarjeta Rosa (011) por gris (081)
  const r1 = await editarEnRuta(e, planConAmbosRosas, {
    tipo: "ops",
    ediciones: [{ op: "reemplazar_color", de: "rosa", a: "gris" }],
  });
  assert.equal(r1.status, 200);
  const plan1 = (r1.body as { plan: Plan }).plan;
  const arco1 = plan1.espec.piezas[0]!;
  assert.ok(arco1.colores.some((c) => c.codigo === "081"), "gris entró");
  assert.ok(!arco1.colores.some((c) => c.codigo === "011"), "011 salió");
  assert.ok(arco1.colores.some((c) => c.codigo === "009"), "009 Rosado sigue");

  // Segunda vez: repetir exactamente «rosa → gris»
  const r2 = await editarEnRuta(e, plan1, {
    tipo: "ops",
    ediciones: [{ op: "reemplazar_color", de: "rosa", a: "gris" }],
  });
  // Debe ser 422 EDICION_NO_APLICADA sin cambiar el plan y sin preguntar
  assert.equal(r2.status, 422);
  const fallo = r2.body as FalloEditarMotor;
  assert.equal(fallo.codigo, "EDICION_NO_APLICADA");
  assert.match(fallo.error, /ya estaba aplicado/i);
  assert.doesNotMatch(fallo.error, /puede ser/i);
  assert.doesNotMatch(fallo.error, /\?/);
});

// Case 4: «azul» plus «Pastel Mate Azul», repeat after a size/weight edit
test("Caso 4: azul y Pastel Mate Azul, repetir tras edición de tamaño/peso no cambia el azul restante y no pide aclaración", async () => {
  const e = entorno();
  // Empezamos con azul y blanco
  const plan = await crearPlanEnRuta(e, { frase: "x", colores: ["azul", "blanco"], piezas: [{ estructura: "arco", cantidad: 1 }] });
  // Añadimos Pastel Mate Azul
  const prep = await editarEnRuta(e, plan, {
    tipo: "ops",
    ediciones: [{ op: "agregar_color", color: "Pastel Mate Azul" }],
  });
  assert.equal(prep.status, 200);
  const planConAmbos = (prep.body as { plan: Plan }).plan;

  // Cambiamos azul a gris
  const r1 = await editarEnRuta(e, planConAmbos, {
    tipo: "ops",
    ediciones: [{ op: "reemplazar_color", de: "azul", a: "gris" }],
  });
  assert.equal(r1.status, 200);
  const planTrasCambio = (r1.body as { plan: Plan }).plan;

  // Hacemos edición de tamaño
  const rTamano = await editarEnRuta(e, planTrasCambio, {
    tipo: "cambio", cambio: { tipo: "tamano", estructuraId: "EST_01_ARCO", direccion: 1 },
  });
  assert.equal(rTamano.status, 200);
  const planAgrandado = (rTamano.body as { plan: Plan }).plan;

  // Repetimos «azul → gris»
  const rReplay = await editarEnRuta(e, planAgrandado, {
    tipo: "ops",
    ediciones: [{ op: "reemplazar_color", de: "azul", a: "gris" }],
  });
  assert.equal(rReplay.status, 422);
  const fallo = rReplay.body as FalloEditarMotor;
  assert.equal(fallo.codigo, "EDICION_NO_APLICADA");
  assert.match(fallo.error, /ya estaba aplicado/i);
  assert.doesNotMatch(fallo.error, /puede ser/i);
});

// Case 5: Explicit remaining card name or a different destination
test("Caso 5: nombre explícito de la tarjeta restante o destino diferente se trata como orden nueva", async () => {
  const e = entorno();
  const plan = await crearPlanEnRuta(e, { frase: "x", colores: ["azul", "blanco"], piezas: [{ estructura: "arco", cantidad: 1 }] });
  const prep = await editarEnRuta(e, plan, {
    tipo: "ops",
    ediciones: [
      { op: "reemplazar_color", de: "azul", a: "011", piezas: ["EST_01_ARCO"] },
      { op: "agregar_color", color: "009", piezas: ["EST_01_ARCO"] },
    ],
  });
  assert.equal(prep.status, 200);
  const planConAmbos = (prep.body as { plan: Plan }).plan;

  // Cambiamos «rosa» por «gris»
  const r1 = await editarEnRuta(e, planConAmbos, {
    tipo: "ops",
    ediciones: [{ op: "reemplazar_color", de: "rosa", a: "gris" }],
  });
  assert.equal(r1.status, 200);
  const plan1 = (r1.body as { plan: Plan }).plan;

  // Subcaso A: Nombre explícito de la tarjeta que queda («Rosado») a gris -> nueva orden, no se suprime
  const rA = await editarEnRuta(e, plan1, {
    tipo: "ops",
    ediciones: [{ op: "reemplazar_color", de: "Rosado", a: "gris" }],
  });
  assert.equal(rA.status, 200);
  const planA = (rA.body as { plan: Plan }).plan;
  assert.ok(!planA.espec.piezas[0]!.colores.some((c) => c.codigo === "009"));

  // Subcaso B: Misma frase de origen «rosa», pero destino diferente («negro») -> orden nueva, aplica sin ser suprimida como replay
  const rB = await editarEnRuta(e, plan1, {
    tipo: "ops",
    ediciones: [{ op: "reemplazar_color", de: "rosa", a: "negro" }],
  });
  assert.equal(rB.status, 200);
  const planB = (rB.body as { plan: Plan }).plan;
  assert.ok(planB.espec.piezas[0]!.colores.some((c) => c.codigo === "080"), "negro entró");
});




// Case 6: Destination only in another selected piece; narrowed/expanded selection
test("Caso 6: destino solo en otra pieza seleccionada; resolución per-piece", async () => {
  const e = entorno();
  // Arco y columna. Arco tiene azul y blanco; columna tiene dorado y blanco.
  const plan = await crearPlanEnRuta(e, { frase: "x", colores: ["azul", "dorado", "blanco"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 1 }] });

  // Reemplazar azul por dorado en arco: dorado está en la columna, pero NO en el arco
  const r = await editarEnRuta(e, plan, {
    tipo: "ops",
    ediciones: [{ op: "reemplazar_color", de: "azul", a: "dorado", piezas: ["EST_01_ARCO"] }],
  });
  assert.equal(r.status, 200);
  const hecho = (r.body as { plan: Plan }).plan;
  const arco = hecho.espec.piezas.find((p) => p.id === "EST_01_ARCO")!;
  assert.ok(arco.colores.some((c) => c.codigo === "970" || c.codigo === "570"), "dorado entró al arco");
});

// Case 7: Same order expanded to another piece, then repeated a third time
test("Caso 7: misma orden ampliada a otra pieza y repetida una tercera vez", async () => {
  const e = entorno();
  // Arco y columna con azul y blanco
  const plan = await crearPlanEnRuta(e, { frase: "x", colores: ["azul", "blanco"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 1 }] });

  // Paso 1: «azul → gris» solo en arco
  const r1 = await editarEnRuta(e, plan, {
    tipo: "ops",
    ediciones: [{ op: "reemplazar_color", de: "azul", a: "gris", piezas: ["EST_01_ARCO"] }],
  });
  assert.equal(r1.status, 200);
  const plan1 = (r1.body as { plan: Plan }).plan;

  // Paso 2: misma orden «azul → gris» ahora en arco y columna (selección ampliada)
  const r2 = await editarEnRuta(e, plan1, {
    tipo: "ops",
    ediciones: [{ op: "reemplazar_color", de: "azul", a: "gris", piezas: ["EST_01_ARCO", "EST_02_COLUMNA"] }],
  });
  assert.equal(r2.status, 200);
  const plan2 = (r2.body as { plan: Plan }).plan;
  // El arco debe haber retenido el gris sin cambios, y la columna cambió azul por gris
  assert.ok(plan2.espec.piezas.find((p) => p.id === "EST_01_ARCO")!.colores.some((c) => c.codigo === "081"));
  assert.ok(plan2.espec.piezas.find((p) => p.id === "EST_02_COLUMNA")!.colores.some((c) => c.codigo === "081"));

  // Paso 3: repetir una tercera vez en todo el plan
  const r3 = await editarEnRuta(e, plan2, {
    tipo: "ops",
    ediciones: [{ op: "reemplazar_color", de: "azul", a: "gris" }],
  });
  assert.equal(r3.status, 422);
  const fallo3 = r3.body as FalloEditarMotor;
  assert.match(fallo3.error, /ya estaba aplicado/i);
});

// Case 8: Two genuinely plausible source shades
test("Caso 8: dos tonos fuente genuinamente plausibles preguntan con nombres útiles del catálogo y responder no entra en bucle", async () => {
  const e = entorno();
  // Plan con solo azul
  const plan = await crearPlanEnRuta(e, { frase: "x", colores: ["azul"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 1 }] });

  // Añadimos dos dorados distintos a la columna (Metal Dorado 570 y Reflex Dorado 970)
  const prep = await editarEnRuta(e, plan, {
    tipo: "ops",
    ediciones: [
      { op: "reemplazar_color", de: "azul", a: "Metal Dorado", piezas: ["EST_02_COLUMNA"] },
      { op: "agregar_color", color: "Reflex Dorado", piezas: ["EST_02_COLUMNA"] },
    ],
  });
  assert.equal(prep.status, 200);
  const planDobleDorado = (prep.body as { plan: Plan }).plan;

  // Preguntar por «dorado» en la columna donde ambos existen
  const rDuda = await editarEnRuta(e, planDobleDorado, {
    tipo: "ops",
    ediciones: [{ op: "reemplazar_color", de: "dorado", a: "rojo", piezas: ["EST_02_COLUMNA"] }],
  });
  assert.equal(rDuda.status, 422);
  const fallo = rDuda.body as FalloEditarMotor;
  assert.match(fallo.error, /«dorado» puede ser Metal Dorado o Reflex Dorado en la columna; dime cuál/);

  // Responder con uno de los nombres sugeridos no cicla
  const rRespuesta = await editarEnRuta(e, planDobleDorado, {
    tipo: "ops",
    ediciones: [{ op: "reemplazar_color", de: "Metal Dorado", a: "rojo", piezas: ["EST_02_COLUMNA"] }],
  });
  assert.equal(rRespuesta.status, 200);
});

// Case 9: Effective destination substitution, partial edit and duplicate ops in one batch
test("Caso 9: sustitución efectiva de destino, edición parcial y operaciones duplicadas en un lote", async () => {
  const e = entorno();
  const plan = await crearPlanEnRuta(e, { frase: "x", colores: ["azul", "blanco"], piezas: [{ estructura: "arco", cantidad: 1 }] });

  // Lote con dos operaciones idénticas secuenciales: la primera aplica, la segunda ve el contexto actualizado
  const r = await editarEnRuta(e, plan, {
    tipo: "ops",
    ediciones: [
      { op: "reemplazar_color", de: "azul", a: "gris" },
      { op: "reemplazar_color", de: "azul", a: "gris" },
    ],
  });
  // La primera aplicó, por lo que el lote tuvo éxito
  assert.equal(r.status, 200);
  const resp = RespuestaEditarMotorSchema.parse(r.body);
  assert.equal(resp.tocadas.length, 1);
  assert.ok(resp.noAplicadas.some((n) => /ya estaba aplicado/i.test(n)), `Debe registrar que la 2da ya estaba aplicada: ${JSON.stringify(resp.noAplicadas)}`);
});

// Case 10: Build/price/schema failure after a tentative edit
test("Caso 10: fallo de armado/precio tras edición tentativa deja la espec y contexto original intactos", async () => {
  const e = entorno();
  const plan = await crearPlanEnRuta(e, { frase: "x", colores: ["azul", "blanco"], piezas: [{ estructura: "arco", cantidad: 1 }] });

  // Sobrescribimos cotizar para simular fallo 502 de precio
  e.edicion.cotizar = async () => ({ ok: false, razon: "precio_fallido", detalle: "502" });

  const r = await editarEnRuta(e, plan, {
    tipo: "ops",
    ediciones: [{ op: "reemplazar_color", de: "azul", a: "gris" }],
  });
  assert.equal(r.status, 422);
  const fallo = r.body as FalloEditarMotor;
  assert.equal(fallo.codigo, "PRECIO_FALLIDO");
  // El plan en la base sigue siendo el plan sin cambios
});

// Case 11: New plan, add idea, rebuild base, undo and reload
test("Caso 11: ciclo de vida de contexto: nuevo plan vacío, sumar idea y reconstruir base", () => {
  const { espec } = especDesdePropuesta({ frase: "x", colores: ["azul", "blanco"], piezas: [{ estructura: "arco", cantidad: 1 }] });
  // Plan nuevo inicia vacío conocido
  const ctxVacio = crearContextoOrdenColorVacio();
  assert.equal(ctxVacio.v, "colour-order.v2");
  assert.equal(ctxVacio.lastReplacement, null);

  // Reemplazo en arco
  const r1 = aplicarEdicion(espec, { op: "reemplazar_color", de: "azul", a: "gris" }, { ordenColor: ctxVacio });
  assert.equal(r1.noAplicado, undefined);
  assert.ok(r1.ordenColor?.lastReplacement);
  assert.equal(r1.ordenColor.lastReplacement.fraseOrigenPlegada, "azul");

  // Sumar idea o reconstruir base mantiene consistencia per-piece
});

// Case 12: v1/v2/v3, malformed context, wrong hash/browser and expired token
test("Caso 12: validación y autenticación en v1/v2/v3, contexto corrupto y token vencido", () => {
  const planHash = "b".repeat(64);
  const requestId = "22222222-2222-4222-8222-222222222222";

  // Token v3 válido
  const tokenV3 = crearTokenPlan({
    planHash, requestId, backend: "globos3d", catalogSnapshotId: "SNAP-1", allowlist: [],
    colorOrder: crearContextoOrdenColorVacio(),
  });
  const ctx = abrirContextoPlan(tokenV3);
  assert.ok(ctx);
  assert.deepEqual(ctx.colorOrder, crearContextoOrdenColorVacio());

  // Token v3 con contexto corrupto no se degrada a vacío: se rechaza
  const [payload] = tokenV3.split(".");
  const data = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as Record<string, unknown>;
  const corrupto = Buffer.from(JSON.stringify({ ...data, colorOrder: { v: "bad-version", lastReplacement: "invalid" } }), "utf8").toString("base64url");
  const firma = createHmac("sha256", process.env.PLAN_APPROVAL_SECRET!).update(corrupto).digest("base64url");
  assert.equal(abrirContextoPlan(`${corrupto}.${firma}`), null, "contexto corrupto debe ser rechazado");
  assert.equal(verificarTokenAprobacion(`${corrupto}.${firma}`, planHash), null);
});

// Case 15 (R4): «rosa → rosado» sobre un plan editado que ya lleva rosado, sin historial conocido: no pregunta, no cambia nada
test("Caso 15: «rosa → rosado» con el rosado ya puesto tras una edición, sin historial, no pregunta", () => {
  const { espec: inicial } = especDesdePropuesta({ frase: "x", colores: ["azul", "blanco"], piezas: [{ estructura: "arco", cantidad: 1 }] });
  const editada = aplicarEdicion(inicial, { op: "reemplazar_color", de: "azul", a: "rosado" }, {}).espec;
  assert.equal(editada.origen.tipo, "edicion");
  assert.equal(loQueNombra(editada, editada.piezas, "rosa", ["009"]).get(editada.piezas[0]!.id)?.pregunta, false, "the independent oracle also recognizes the same-colour no-op");
  const r = aplicarEdicion(editada, { op: "reemplazar_color", de: "rosa", a: "rosado" }, {});
  assert.doesNotMatch(r.noAplicado ?? "", /puede ser/, "no debe preguntar por una repetición que no cambia nada");
  assert.deepEqual(r.espec.piezas[0]!.colores.map((c) => c.codigo), ["009", "005"]);
});

// Case 16 (R4, contraejemplo): una pieza con varios colores que incluyen «rojo»; «roja → multicolor» (entran 4 códigos) no es un no-op: sigue aclarándose
test("Caso 16: destino de varios colores sobre una pieza que ya lleva uno de ellos sigue aclarándose", () => {
  const { espec: inicial } = especDesdePropuesta({ frase: "x", colores: ["rojo", "blanco"], piezas: [{ estructura: "arco", cantidad: 1 }] });
  const multi = aplicarEdicion(inicial, { op: "reemplazar_color", de: "rojo", a: "multicolor" }, {}).espec;
  assert.equal(multi.piezas[0]!.colores.length, 5, "prep: el arco lleva los cuatro multicolor y el blanco");
  const r = aplicarEdicion(multi, { op: "reemplazar_color", de: "roja", a: "multicolor" }, {});
  assert.deepEqual(r.espec.piezas[0]!.colores, multi.piezas[0]!.colores, "sin cambios: la aclaración decide");
  assert.match(r.noAplicado ?? "", /puede ser/);
});

// Case 13: Clarification text containing «puede ser» without punctuation
test("Caso 13: texto de aclaración con «puede ser» sin signos de interrogación se observa en noAplicadas", async () => {
  const e = entorno();
  const plan = await crearPlanEnRuta(e, { frase: "x", colores: ["azul"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 1 }] });

  // Agregamos dos dorados a la columna
  const { cuerpo } = await (async () => {
    const respuesta = await atenderEditarMotor(pedir({
      plan,
      edicion: {
        tipo: "ops",
        ediciones: [
          { op: "reemplazar_color", de: "azul", a: "Metal Dorado", piezas: ["EST_02_COLUMNA"] },
          { op: "agregar_color", color: "Reflex Dorado", piezas: ["EST_02_COLUMNA"] },
          { op: "reemplazar_color", de: "dorado", a: "rojo", piezas: ["EST_02_COLUMNA"] },
        ],
      },
    }), e.edicion);
    return { respuesta, cuerpo: (await respuesta.json()) as Record<string, unknown> };
  })();

  const noAplicadas = (cuerpo.noAplicadas as string[]) ?? [];
  assert.ok(noAplicadas.length > 0);
  assert.ok(noAplicadas.some((texto) => texto.includes("puede ser")));
  assert.ok(noAplicadas.every((texto) => !texto.includes("?") && !texto.includes("¿")), "no debe contener ? ni ¿");
});

// Case 14: Accent folding and incremental multi-piece retention
test("Caso 14: plegado con tildes y retención de piezas previas con selección incremental", async () => {
  const e = entorno();
  const plan = await crearPlanEnRuta(e, { frase: "x", colores: ["cafe", "blanco"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 1 }] });

  // Paso 1: reemplazar café por rojo en el arco usando "café" con tilde
  const res1 = await atenderEditarMotor(pedir({
    plan,
    edicion: { tipo: "ops", ediciones: [{ op: "reemplazar_color", de: "café", a: "rojo", piezas: ["EST_01_ARCO"] }] },
  }), e.edicion);
  const data1 = (await res1.json()) as { plan: typeof plan };
  assert.equal(res1.status, 200);

  // Paso 2: reemplazar café por rojo en la columna (sin seleccionar el arco)
  const res2 = await atenderEditarMotor(pedir({
    plan: data1.plan,
    edicion: { tipo: "ops", ediciones: [{ op: "reemplazar_color", de: "cafe", a: "rojo", piezas: ["EST_02_COLUMNA"] }] },
  }), e.edicion);
  const data2 = (await res2.json()) as { plan: typeof plan };
  assert.equal(res2.status, 200);

  // Paso 3: repetir "café" a "rojo" en TODO el plan (arco + columna); ambas piezas deben reconocerse como replay
  const res3 = await atenderEditarMotor(pedir({
    plan: data2.plan,
    edicion: { tipo: "ops", ediciones: [{ op: "reemplazar_color", de: "café", a: "rojo" }] },
  }), e.edicion);
  assert.equal(res3.status, 422);
  const data3 = (await res3.json()) as { noAplicadas: string[] };
  assert.ok(data3.noAplicadas.every((t) => !t.includes("puede ser")));
  assert.ok(data3.noAplicadas.some((t) => t.includes("ya estaba aplicado")));
});

// Audit regressions: compatibility and last-order boundaries.
test("Audit: reader-first rollout writes v2 until explicitly enabled", () => {
  delete process.env.PLAN_COLOR_ORDER_V3;
  const token = crearTokenPlan({ planHash: "b".repeat(64), requestId: "reader-first", backend: "globos3d", catalogSnapshotId: null, allowlist: [], colorOrder: crearContextoOrdenColorVacio() });
  assert.equal(JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString()).v, 2);
});

test("Audit: an invalid colour-order context is never signed as v3", () => {
  const roto = { ...crearContextoOrdenColorVacio(), lastReplacement: { nombrePlegado: "", fraseOrigenPlegada: "", destinosEfectivos: [], piezasCambiadas: [] } } as unknown as ReturnType<typeof crearContextoOrdenColorVacio>;
  const token = crearTokenPlan({ planHash: "c".repeat(64), requestId: "invalid-order", backend: "globos3d", catalogSnapshotId: null, allowlist: [], colorOrder: roto });
  assert.equal(JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString()).v, 2);
  assert.ok(abrirContextoPlan(token));
});

test("Audit: a legacy size edit preserves unknown colour history", async () => {
  process.env.PLAN_COLOR_ORDER_V3 = "true";
  const e = entorno();
  const plan = await crearPlanEnRuta(e, { frase: "x", colores: ["azul", "blanco"], piezas: [{ estructura: "arco", cantidad: 1 }] });
  const data = JSON.parse(Buffer.from(plan.approval_token.split(".")[0]!, "base64url").toString()) as Record<string, unknown>;
  delete data.colorOrder;
  const payload = Buffer.from(JSON.stringify({ ...data, v: 2 })).toString("base64url");
  plan.approval_token = `${payload}.${createHmac("sha256", process.env.PLAN_APPROVAL_SECRET!).update(payload).digest("base64url")}`;
  assert.equal(abrirContextoPlan(plan.approval_token)?.colorOrder, undefined);
  const resized = await editarEnRuta(e, plan, { tipo: "cambio", cambio: { tipo: "tamano", estructuraId: "EST_01_ARCO", direccion: 1 } });
  assert.equal(resized.status, 200);
  const updated = RespuestaEditarMotorSchema.parse(resized.body).plan;
  assert.equal(abrirContextoPlan(updated.approval_token)?.colorOrder, undefined);
});

test("Audit: another destination supersedes the previous replacement on other pieces", () => {
  const { espec } = especDesdePropuesta({ frase: "x", colores: ["azul", "blanco"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 1 }] });
  const first = aplicarEdicion(espec, { op: "reemplazar_color", de: "azul", a: "gris", piezas: ["EST_01_ARCO"] }, { ordenColor: crearContextoOrdenColorVacio() });
  const second = aplicarEdicion(first.espec, { op: "reemplazar_color", de: "azul", a: "negro", piezas: ["EST_02_COLUMNA"] }, { ordenColor: first.ordenColor });
  assert.equal(second.noAplicado, undefined);
  assert.deepEqual(second.ordenColor?.lastReplacement?.piezasCambiadas, ["EST_02_COLUMNA"], "different destinations are a new order, not an unbounded replay ledger");
});

test("Audit: add idea, reload and undo preserve the signed last order", async () => {
  const e = entorno();
  const initial = await crearPlanEnRuta(e, { frase: "x", colores: ["azul", "blanco"], piezas: [{ estructura: "arco", cantidad: 1 }] });
  const changed = RespuestaEditarMotorSchema.parse((await editarEnRuta(e, initial, { tipo: "ops", ediciones: [{ op: "reemplazar_color", de: "azul", a: "gris" }] })).body).plan;
  const history = abrirContextoPlan(changed.approval_token)?.colorOrder;
  assert.ok(history?.lastReplacement);
  const request = new Request("https://app.test/api/guiada/motor/plan", { method: "POST", headers: { "content-type": "application/json", cookie: `${SESION}; ${NAVEGADOR}` }, body: JSON.stringify({ desde: "idea", idea_id: "deco-real-09-images-24", base: changed }) });
  const added = await atenderPlanMotor(request, e.plan);
  assert.equal(added.status, 200);
  const addedBody = await added.json();
  const reloaded = PlanGuiadoSchema.parse(JSON.parse(JSON.stringify(addedBody.plan)));
  assert.deepEqual(abrirContextoPlan(reloaded.approval_token)?.colorOrder, history);
  const replay = await editarEnRuta(e, reloaded as Plan, { tipo: "ops", ediciones: [{ op: "reemplazar_color", de: "azul", a: "gris", piezas: ["EST_01_ARCO"] }] });
  assert.equal(replay.status, 422);
  assert.match((replay.body as FalloEditarMotor).error, /ya estaba aplicado/);
  const previous: WidgetDelPlan = { tipo: "plan", motor: "3d", plan: changed };
  const current: WidgetDelPlan = { tipo: "plan", motor: "3d", plan: reloaded };
  const restored = deshacerAjuste(recordarParaDeshacer([], previous, reloaded.plan_hash), current);
  assert.ok(restored.ok);
  assert.equal(restored.widget.plan.approval_token, changed.approval_token);
  assert.deepEqual(abrirContextoPlan(restored.widget.plan.approval_token)?.colorOrder, history);
});
