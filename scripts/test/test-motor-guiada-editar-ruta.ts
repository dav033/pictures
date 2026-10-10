/**
 * `POST /api/guiada/motor/editar` (REQ-007, fase 5): los cambios del cliente a un plan del motor 3D. Sin coste: la bandera,
 * Python y la auditoría son dobles; no hay red, base ni IA.
 * - sesión (401), mismo origen (403) y cuerpo (400); la bandera no manda sobre un plan del 3D (P-045): con `python` se edita
 *   igual; el corte del 3D responde `motor_3d_cortado` (409) sin mirar el plan;
 * - el plan se verifica como en toda ruta del 3D: token, backend, navegador y espec firmada (409);
 * - un cambio por pedido del chat, por cambio del panel o por operaciones: plan nuevo, hash nuevo, token nuevo atado al mismo
 *   navegador, lo demás igual, solo se rearma lo que cambió y el turno trae la espec de antes y de después;
 * - nunca dice algo que no pasó: «No pude: …» con código estable para lo no soportado, lo no aplicable, lo que el motor no arma,
 *   lo que la tienda no vende y el precio que falla; el plan queda como estaba y cada rechazo queda en la auditoría.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-motor-guiada-editar-ruta.ts
 */
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { PlanGuiadoSchema, CotizacionPlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { sessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import { abrirContextoPlan, crearTokenPlan } from "../../src/lib/plan/aprobacion";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";
import { atenderPlanMotor, huellaDeNavegador, type DependenciasPlanMotor } from "../../src/lib/guiada-motor/plan-motor";
import { atenderEditarMotor, type DependenciasEditarMotor } from "../../src/lib/guiada-motor/editar-motor";
import { crearTopePorNavegador } from "../../src/lib/guiada-motor/tope-imagenes-navegador";
import { TEXTO_EDICION_RECALCULO, unirNoPude } from "../../src/lib/guiada-motor/mensajes-cliente";
import { FalloEditarMotorSchema, RespuestaEditarMotorSchema, type CuerpoEditarMotor } from "../../src/lib/guiada-motor/editar-contrato";
import { armarDesdeEspec, cotizarBom, crearCachePiezas, crosswalkIncluido, especHashDe, EspecClienteV1Schema, type EspecClienteV1, type ResultadoCotizacionBom } from "../../src/lib/globos3d/motor/v1";
import { pythonDoble } from "../lib/python-doble-precio";

const CLAVE_APP = "clave-app-de-prueba";
const SESION = `${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}`;
const NAVEGADOR = "feedback_usuario=" + "a1".repeat(16);
const OTRO_NAVEGADOR = "feedback_usuario=" + "b2".repeat(16);
const cruce = crosswalkIncluido();

let anterior: Record<string, string | undefined> = {};
beforeEach(() => {
  anterior = { APP_PASSWORD: process.env.APP_PASSWORD, DATABASE_URL: process.env.DATABASE_URL, GUIADA_MOTOR: process.env.GUIADA_MOTOR };
  process.env.APP_PASSWORD = CLAVE_APP;
  delete process.env.DATABASE_URL;
  delete process.env.GUIADA_MOTOR;
});
afterEach(() => { for (const [clave, valor] of Object.entries(anterior)) { if (valor === undefined) delete process.env[clave]; else process.env[clave] = valor; } });

type Auditoria = { quien: string; que: string; resultado: Record<string, unknown>; entrada: unknown };
type Opciones = { motor?: "3d" | "python"; corte?: boolean; cotizar?: DependenciasEditarMotor["cotizar"]; armar?: DependenciasEditarMotor["armar"]; tope?: number };

function entorno(opciones: Opciones = {}) {
  const auditorias: Auditoria[] = [];
  const cachePiezas = crearCachePiezas(64);
  let ids = 0;
  const doble = pythonDoble(cruce);
  const cotizarPorDefecto: DependenciasEditarMotor["cotizar"] = (bom) => cotizarBom({ total: bom.total, porPieza: bom.porPieza }, { crosswalk: async () => cruce, cotizarLista: doble.cotizarLista });
  const deps: DependenciasEditarMotor = {
    leerBandera: async () => (opciones.corte ? { motor: "python", fuente: "corte" } : { motor: opciones.motor ?? "3d", fuente: "cookie" }),
    auditar: (quien, que, resultado, extra) => { auditorias.push({ quien, que, resultado: resultado as Record<string, unknown>, entrada: extra?.entrada }); },
    armar: opciones.armar ?? ((espec) => armarDesdeEspec(espec, { cachePiezas })),
    planGuardado: planGuardadoDeIdea,
    cotizar: opciones.cotizar ?? cotizarPorDefecto,
    nuevoId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    tomarEdicion: crearTopePorNavegador(opciones.tope ?? 1000).tomar,
    estadisticasCache: () => { const { aciertos, fallos } = cachePiezas.estadisticas(); return { aciertos, fallos }; },
  };
  return { deps, auditorias, cachePiezas, doble, cotizarPorDefecto };
}

const pedir = (cuerpo: unknown, cookies: string[] = [SESION, NAVEGADOR], cabeceras: Record<string, string> = {}) => new Request("https://app.test/api/guiada/motor/editar", {
  method: "POST", headers: { "content-type": "application/json", ...cabeceras, ...(cookies.length ? { cookie: cookies.join("; ") } : {}) }, body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
});

type Plan = ReturnType<typeof PlanGuiadoSchema.parse> & { espec: EspecClienteV1; motor: { id: string; version: string }; planActual: unknown; avisos: string[] };
const PROPUESTA = { frase: "Te propongo un arco y dos columnas.", colores: ["azul", "dorado"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 2 }] };

/** Un plan del 3D de verdad, con el token atado a NAVEGADOR (la ruta del plan). */
async function planDe(propuesta: unknown = PROPUESTA, cookies: string[] = [SESION, NAVEGADOR]): Promise<Plan> {
  const e = entorno();
  const deps: DependenciasPlanMotor = {
    leerBandera: e.deps.leerBandera, auditar: e.deps.auditar, planGuardado: planGuardadoDeIdea,
    cotizar: (bom) => cotizarBom({ total: bom.total, porPieza: bom.porPieza }, { crosswalk: async () => cruce, cotizarLista: e.doble.cotizarLista }),
    nuevoId: e.deps.nuevoId,
  };
  const respuesta = await atenderPlanMotor(new Request("https://app.test/api/guiada/motor/plan", { method: "POST", headers: { "content-type": "application/json", cookie: cookies.join("; ") }, body: JSON.stringify({ desde: "propuesta", propuesta, brief: { evento: "boda", tematica: "boda azul y dorada" } }) }), deps);
  assert.equal(respuesta.status, 200);
  return ((await respuesta.json()) as { plan: Plan }).plan;
}

const editar = async (e: ReturnType<typeof entorno>, plan: Plan, edicion: CuerpoEditarMotor["edicion"], extra: Partial<CuerpoEditarMotor> = {}, cookies?: string[]) => {
  const respuesta = await atenderEditarMotor(pedir({ plan, edicion, ...extra }, cookies), e.deps);
  return { respuesta, cuerpo: await respuesta.json() as Record<string, unknown> };
};
const pedidoColor: CuerpoEditarMotor["edicion"] = { tipo: "pedido", pedido: { tipo: "reemplazar_color", color: "azul", colorNuevo: "rojo", piezas: [] } };
const piezaDe = (p: Plan, id: string) => p.espec.piezas.find((x) => x.id === id)!;
const rechazos = (e: ReturnType<typeof entorno>) => e.auditorias.filter((a) => a.que.includes("no se aplica") || a.que.includes("no se acepta"));

test("sin sesión: 401, sin leer la bandera ni auditar; sin la cookie del navegador se le fija una; otro origen: 403", async () => {
  const plan = await planDe();
  let lecturas = 0;
  const e = entorno();
  const respuesta = await atenderEditarMotor(pedir({ plan, edicion: pedidoColor }, []), { ...e.deps, leerBandera: async () => { lecturas += 1; return { motor: "3d", fuente: "cookie" }; } });
  assert.equal(respuesta.status, 401);
  assert.equal(respuesta.headers.get("cache-control"), "no-store");
  assert.equal(lecturas, 0);
  assert.equal(e.auditorias.length, 0);
  const otroOrigen = await atenderEditarMotor(pedir({ plan, edicion: pedidoColor }, [SESION, NAVEGADOR], { origin: "https://otro.test" }), e.deps);
  assert.equal(otroOrigen.status, 403);
  // Sin cookie de navegador, la ruta crea una (y el token no le sirve: es de otro navegador).
  const sinNavegador = await atenderEditarMotor(pedir({ plan, edicion: pedidoColor }, [SESION]), e.deps);
  assert.equal(sinNavegador.status, 409);
  assert.match(sinNavegador.headers.get("set-cookie") ?? "", /feedback_usuario=[0-9a-f]{32}/);
});

test("cuerpo inválido: 400 tipado, también con una operación inventada o un cuerpo enorme", async () => {
  const plan = await planDe();
  const e = entorno();
  for (const cuerpo of [
    "no es json", "", JSON.stringify({ plan }), JSON.stringify({ plan, edicion: { tipo: "ops", ediciones: [{ op: "arrastrar", pieza: "EST_01_ARCO", x: 3 }] } }),
    JSON.stringify({ plan, edicion: { tipo: "ops", ediciones: [{ op: "agregar_pieza", oficial: "estatua" }] } }), JSON.stringify({ plan, edicion: { tipo: "ops", ediciones: [] } }),
    JSON.stringify({ plan, edicion: { tipo: "cambio", cambio: { tipo: "tamano", estructuraId: "arco", direccion: 1 } } }), JSON.stringify({ plan, edicion: pedidoColor, otra: 1 }),
    JSON.stringify({ plan, edicion: { tipo: "pedido", pedido: { tipo: "renombrar_pieza", pieza: "Arco", nombre: "x".repeat(100) } } }),
    "x".repeat(800_000),
  ]) {
    const respuesta = await atenderEditarMotor(pedir(cuerpo), e.deps);
    assert.equal(respuesta.status, 400, cuerpo.slice(0, 60));
    assert.equal(((await respuesta.json()) as { codigo: string }).codigo, "CUERPO_INVALIDO");
  }
});

test("la bandera no manda sobre un plan del 3d (P-045): con python el cambio se hace igual y con el mismo precio", async () => {
  const plan = await planDe();
  const con3d = await editar(entorno(), plan, pedidoColor);
  const python = entorno({ motor: "python" });
  const conPython = await editar(python, plan, pedidoColor);
  assert.deepEqual([con3d.respuesta.status, conPython.respuesta.status], [200, 200], JSON.stringify(conPython.cuerpo).slice(0, 300));
  const [a, b] = [RespuestaEditarMotorSchema.parse(con3d.cuerpo), RespuestaEditarMotorSchema.parse(conPython.cuerpo)];
  assert.equal(b.plan.plan_hash, a.plan.plan_hash);
  assert.equal((b.cotizacion as { total: number }).total, (a.cotizacion as { total: number }).total);
  assert.deepEqual({ bandera: python.auditorias.at(-1)!.resultado.bandera, efectivo: python.auditorias.at(-1)!.resultado.efectivo }, { bandera: "python", efectivo: "3d" });
});

test("el corte del 3d sí frena el cambio: 409 MOTOR_3D_CORTADO sin mirar el plan, con la frase que avisa del recálculo, y deja el motivo", async () => {
  const plan = await planDe();
  const e = entorno({ corte: true });
  for (const cuerpo of [{ plan, edicion: pedidoColor }, { plan: { ...plan, approval_token: "basura" }, edicion: pedidoColor }]) {
    const respuesta = await atenderEditarMotor(pedir(cuerpo), e.deps);
    assert.equal(respuesta.status, 409);
    const dicho = FalloEditarMotorSchema.parse(await respuesta.json());
    assert.equal(dicho.codigo, "MOTOR_3D_CORTADO");
    assert.deepEqual(dicho.fallback, { razon: "motor_3d_cortado" });
    assert.equal(dicho.error, TEXTO_EDICION_RECALCULO);
  }
  assert.equal(e.auditorias.length, 2);
  assert.ok(e.auditorias.every((a) => a.quien === "regla:motor_guiada" && a.resultado.razon === "motor_3d_cortado" && a.resultado.fuente === "corte"));
});

test("el plan se verifica: token basura, de Python, de otro navegador, hash ajeno, espec alterada o ausente", async () => {
  const plan = await planDe();
  const e = entorno();
  const intentar = async (cuerpoPlan: unknown, cookies?: string[]) => {
    const respuesta = await atenderEditarMotor(pedir({ plan: cuerpoPlan, edicion: pedidoColor }, cookies), e.deps);
    return { estado: respuesta.status, codigo: ((await respuesta.json()) as { codigo: string }).codigo };
  };
  assert.deepEqual(await intentar({ ...plan, approval_token: "no-es-un-token" }), { estado: 409, codigo: "APROBACION_INVALIDA" });
  assert.deepEqual(await intentar({ ...plan, plan_hash: "a".repeat(64) }), { estado: 409, codigo: "APROBACION_INVALIDA" }, "el token está atado a otro hash");
  assert.deepEqual(await intentar({ ...plan, approval_token: crearTokenPlan({ planHash: plan.plan_hash, requestId: "r", backend: "python", catalogSnapshotId: "s", allowlist: [] }) }), { estado: 409, codigo: "PLAN_NO_ES_DEL_MOTOR_3D" });
  assert.deepEqual(await intentar(plan, [SESION, OTRO_NAVEGADOR]), { estado: 409, codigo: "APROBACION_INVALIDA" }, "un token copiado a otro navegador no sirve");
  const alterada = structuredClone(plan);
  alterada.espec.piezas[0]!.colores = [{ ...alterada.espec.piezas[0]!.colores[0]!, peso: 1 }];
  assert.deepEqual(await intentar(alterada), { estado: 409, codigo: "PLAN_ALTERADO" });
  const { espec: _quitada, ...sinEspec } = plan;
  assert.deepEqual(await intentar(sinEspec), { estado: 400, codigo: "ESPEC_INVALIDA" });
  assert.equal(rechazos(e).length, 6, "cada rechazo queda en la auditoría con su motivo");
  assert.ok(rechazos(e).every((a) => a.quien === "regla:motor_guiada" && typeof a.resultado.motivo === "string"));
});

test("un cambio por pedido del chat: plan nuevo, hash y token nuevos atados al mismo navegador, lo demás igual y el turno con la espec de antes y de después", async () => {
  const plan = await planDe();
  const e = entorno();
  const { respuesta, cuerpo } = await editar(e, plan, { tipo: "pedido", pedido: { tipo: "reemplazar_color", color: "azul", colorNuevo: "celeste", piezas: ["Columna izquierda"] } }, { turnoId: "msj-123" });
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.headers.get("cache-control"), "no-store");
  const hecho = RespuestaEditarMotorSchema.parse(cuerpo);
  const nuevo = PlanGuiadoSchema.parse(hecho.plan) as Plan;
  CotizacionPlanGuiadoSchema.parse(hecho.cotizacion);
  // Plan nuevo y firmado: el hash es el de la espec nueva y el token es del 3D, de este navegador.
  assert.notEqual(nuevo.plan_hash, plan.plan_hash);
  assert.equal(nuevo.plan_hash, especHashDe(nuevo.espec, nuevo.motor.version));
  const contexto = abrirContextoPlan(nuevo.approval_token);
  assert.deepEqual({ backend: contexto?.backend, navegador: contexto?.navegador }, { backend: "globos3d", navegador: huellaDeNavegador(`nav-${"a1".repeat(16)}`) });
  // Lo que cambió y lo que no.
  assert.deepEqual(piezaDe(nuevo, "EST_02_COLUMNA").colores.map((c) => c.nombre), ["celeste", "dorado"]);
  assert.deepEqual(piezaDe(nuevo, "EST_01_ARCO"), piezaDe(plan, "EST_01_ARCO"));
  assert.deepEqual(piezaDe(nuevo, "EST_03_COLUMNA"), piezaDe(plan, "EST_03_COLUMNA"));
  assert.deepEqual(nuevo.plan.estructuras.map((p) => p.estructura_id), plan.plan.estructuras.map((p) => p.estructura_id));
  // Los globos de la pieza que no cambió son los mismos (el reparto en paquetes se vuelve a decidir para todo el plan, pero lo que lleva no).
  const porColorYTamano = (p: Plan, id: string) => Object.fromEntries([...p.estructuras.find((x) => x.estructura_id === id)!.lineas.reduce((mapa, linea) => {
    const l = linea as unknown as { product_id?: string; tamano_codigo?: string; unidades: number };
    const clave = `${l.product_id}|${l.tamano_codigo}`;
    return mapa.set(clave, (mapa.get(clave) ?? 0) + l.unidades);
  }, new Map<string, number>())].sort());
  assert.deepEqual(porColorYTamano(nuevo, "EST_01_ARCO"), porColorYTamano(plan, "EST_01_ARCO"), "el arco lleva los mismos globos");
  assert.deepEqual(porColorYTamano(nuevo, "EST_03_COLUMNA"), porColorYTamano(plan, "EST_03_COLUMNA"), "la columna derecha lleva los mismos globos");
  assert.notDeepEqual(porColorYTamano(nuevo, "EST_02_COLUMNA"), porColorYTamano(plan, "EST_02_COLUMNA"), "la columna izquierda cambió de globo (otro producto de la tienda)");
  assert.equal(nuevo.plan.concepto.titulo, plan.plan.concepto.titulo, "el título y la descripción del plan se conservan");
  // El plan para el chat sale exacto de la espec nueva.
  const actual = nuevo.planActual as { piezas: Array<{ nombre: string; participacion: Array<{ color: string }> }> };
  assert.deepEqual(actual.piezas[1]!.participacion.map((p) => p.color), ["celeste", "dorado"]);
  // Lo que dice.
  assert.match(hecho.descripcion, /cambié azul por celeste en la columna izquierda/);
  assert.match(hecho.confirmacion, /^Listo: cambié azul por celeste en la columna izquierda; lo demás quedó igual\.$/);
  assert.deepEqual(hecho.tocadas, ["EST_02_COLUMNA"]);
  assert.deepEqual(hecho.noAplicadas, []);
  // El turno: el id del chat, la espec de antes y de después (lo que espera la calificación).
  assert.equal(hecho.turno.turnoId, "msj-123");
  assert.equal(hecho.turno.antes.especHash, plan.plan_hash);
  assert.deepEqual(EspecClienteV1Schema.parse(hecho.turno.antes.espec), plan.espec);
  assert.equal(hecho.turno.despues.especHash, nuevo.plan_hash);
  assert.deepEqual(EspecClienteV1Schema.parse(hecho.turno.despues.espec), nuevo.espec);
  // Sin turnoId, el servidor pone el suyo.
  const sinId = RespuestaEditarMotorSchema.parse((await editar(e, plan, pedidoColor)).cuerpo);
  assert.match(sinId.turno.turnoId, /^00000000-0000-4000-8000-/);
  // La auditoría.
  const hechas = e.auditorias.filter((a) => a.que.startsWith("edición del plan 3D hecha"));
  assert.equal(hechas.length, 2);
  assert.deepEqual({ plan_hash_base: hechas[0]!.resultado.plan_hash_base, plan_hash: hechas[0]!.resultado.plan_hash, turno_id: hechas[0]!.resultado.turno_id, efectivo: hechas[0]!.resultado.efectivo }, { plan_hash_base: plan.plan_hash, plan_hash: nuevo.plan_hash, turno_id: "msj-123", efectivo: "3d" });
});

test("el plan nuevo se puede seguir editando con su token nuevo; solo se rearma lo que cambió (caché de piezas)", async () => {
  const plan = await planDe();
  const e = entorno();
  const primero = RespuestaEditarMotorSchema.parse((await editar(e, plan, { tipo: "cambio", cambio: { tipo: "tamano", estructuraId: "EST_01_ARCO", direccion: 1 } })).cuerpo);
  const despuesDelPrimero = e.cachePiezas.estadisticas();
  const plan2 = PlanGuiadoSchema.parse(primero.plan) as Plan;
  const segundo = await editar(e, plan2, { tipo: "cambio", cambio: { tipo: "tamano", estructuraId: "EST_01_ARCO", direccion: 1 } });
  assert.equal(segundo.respuesta.status, 200, "el token del plan nuevo sirve");
  const despuesDelSegundo = e.cachePiezas.estadisticas();
  assert.equal(despuesDelSegundo.fallos - despuesDelPrimero.fallos, 1, "solo el arco se rearmó");
  assert.equal(despuesDelSegundo.aciertos - despuesDelPrimero.aciertos, 2, "las dos columnas salieron de la caché");
  const plan3 = PlanGuiadoSchema.parse((segundo.cuerpo as { plan: unknown }).plan) as Plan;
  assert.ok(piezaDe(plan3, "EST_01_ARCO").medidas.anchoM! > piezaDe(plan2, "EST_01_ARCO").medidas.anchoM!);
  const hechas = e.auditorias.filter((a) => a.que.startsWith("edición del plan 3D hecha"));
  assert.deepEqual(hechas.at(-1)!.resultado.cache_piezas, { aciertos: despuesDelSegundo.aciertos, fallos: despuesDelSegundo.fallos });
});

test("por cambio del panel y por operaciones: cada tipo de cambio rehace el plan", async () => {
  const plan = await planDe();
  const e = entorno();
  const casos: Array<[CuerpoEditarMotor["edicion"], (nuevo: Plan) => void]> = [
    [{ tipo: "cambio", cambio: { tipo: "quitar-pieza", estructuraId: "EST_03_COLUMNA" } }, (n) => assert.equal(n.espec.piezas.length, 2)],
    [{ tipo: "cambio", cambio: { tipo: "tamano-todo", direccion: -1 } }, (n) => assert.ok(n.espec.piezas.every((p) => p.medidas.anchoM !== undefined || p.medidas.altoM !== undefined))],
    [{ tipo: "cambio", cambio: { tipo: "reemplazar-color", color: "dorado", nuevo: "015", estructuraIds: ["EST_01_ARCO"] } }, (n) => assert.deepEqual(piezaDe(n, "EST_01_ARCO").colores.map((c) => c.codigo), ["040", "015"])],
    [{ tipo: "cambio", cambio: { tipo: "cantidad", estructuraId: "EST_01_ARCO", indice: 0, objetivo: 150, desde: 100 } }, (n) => assert.ok(piezaDe(n, "EST_01_ARCO").colores[0]!.peso > 0.5)],
    [{ tipo: "cambio", cambio: { tipo: "tamano-globos", estructuraId: "EST_01_ARCO", direccion: 1 } }, (n) => assert.equal(piezaDe(n, "EST_01_ARCO").tamanos, "organica_gruesa")],
    [{ tipo: "ops", ediciones: [{ op: "agregar_pieza", oficial: "guirnalda", colores: ["rojo", "blanco"] }] }, (n) => assert.equal(n.espec.piezas.at(-1)!.oficial, "guirnalda")],
    [{ tipo: "ops", ediciones: [{ op: "flores", pieza: "EST_01_ARCO", flores: { cantidad: 3, petalos: 3, codigo: "970", centro: "005" } }] }, (n) => assert.equal(piezaDe(n, "EST_01_ARCO").flores?.cantidad, 3)],
    [{ tipo: "ops", ediciones: [{ op: "lado", pieza: "EST_02_COLUMNA", lado: "derecha" }] }, (n) => assert.equal(piezaDe(n, "EST_02_COLUMNA").lugar, "derecha")],
  ];
  for (const [edicion, comprueba] of casos) {
    const { respuesta, cuerpo } = await editar(e, plan, edicion);
    assert.equal(respuesta.status, 200, JSON.stringify(edicion));
    const nuevo = PlanGuiadoSchema.parse(RespuestaEditarMotorSchema.parse(cuerpo).plan) as Plan;
    comprueba(nuevo);
    assert.notEqual(nuevo.plan_hash, plan.plan_hash);
  }
});

test("una tanda parcial se dice entera: lo hecho, lo que no se pudo con «No pude: …» y los avisos; el plan es el de lo hecho", async () => {
  const plan = await planDe();
  const e = entorno();
  const { respuesta, cuerpo } = await editar(e, plan, { tipo: "ops", ediciones: [
    { op: "reemplazar_color", de: "azul", a: "rojo", piezas: ["EST_01_ARCO"] },
    { op: "quitar_color", color: "verde" },
    { op: "tamano_pieza", pieza: "EST_02_COLUMNA", medidas: { altoM: 9 } },
  ] });
  assert.equal(respuesta.status, 200);
  const hecho = RespuestaEditarMotorSchema.parse(cuerpo);
  assert.equal(hecho.noAplicadas.length, 1);
  assert.match(hecho.noAplicadas[0]!, /^No pude: tu plan no lleva verde/);
  assert.match(hecho.confirmacion, /^Listo: cambié azul por rojo en el arco; dejé la columna izquierda con alto de 5 m\. No pude: tu plan no lleva verde/);
  assert.ok(hecho.avisos.some((a) => /9 m queda fuera de lo que se arma/.test(a)), "la medida acotada se dice");
  assert.deepEqual(hecho.tocadas, ["EST_01_ARCO", "EST_02_COLUMNA"]);
});

test("lo que no se puede: «No pude: …» con código estable, el plan queda como estaba y cada rechazo queda auditado", async () => {
  const plan = await planDe();
  const e = entorno();
  const rechazo = async (edicion: CuerpoEditarMotor["edicion"]) => {
    const { respuesta, cuerpo } = await editar(e, plan, edicion);
    const dicho = FalloEditarMotorSchema.parse(cuerpo);
    return { estado: respuesta.status, codigo: dicho.codigo, error: dicho.error, noAplicadas: dicho.noAplicadas ?? [] };
  };
  const renombrar = await rechazo({ tipo: "pedido", pedido: { tipo: "renombrar_pieza", pieza: "Arco", nombre: "Cascada" } });
  assert.deepEqual([renombrar.estado, renombrar.codigo], [422, "EDICION_NO_SOPORTADA"]);
  assert.match(renombrar.error, /^No pude: por ahora no puedo cambiarle el nombre a una pieza/);
  const mover = await rechazo({ tipo: "pedido", pedido: { tipo: "mover_pieza", pieza: "Arco", ubicacion: "arriba" } });
  assert.deepEqual([mover.estado, mover.codigo], [422, "EDICION_NO_SOPORTADA"]);
  const sinPieza = await rechazo({ tipo: "pedido", pedido: { tipo: "quitar_pieza", piezas: ["Estatua"] } });
  assert.deepEqual([sinPieza.estado, sinPieza.codigo, sinPieza.error], [422, "EDICION_NO_APLICADA", "No pude: no encontré esa pieza en tu plan."]);
  const sinColor = await rechazo({ tipo: "pedido", pedido: { tipo: "reemplazar_color", color: "verde", colorNuevo: "rojo", piezas: [] } });
  assert.deepEqual([sinColor.estado, sinColor.codigo], [422, "EDICION_NO_APLICADA"]);
  assert.match(sinColor.error, /^No pude: tu plan no lleva verde/);
  assert.deepEqual(sinColor.noAplicadas, [sinColor.error]);
  const todas = await rechazo({ tipo: "pedido", pedido: { tipo: "quitar_pieza", piezas: ["Arco", "Columna izquierda", "Columna derecha"] } });
  assert.deepEqual([todas.estado, todas.codigo, todas.error], [422, "EDICION_NO_APLICADA", "No pude: tu plan necesita al menos una pieza."]);
  assert.equal(rechazos(e).length, 5, "cada rechazo queda auditado");
  assert.ok(rechazos(e).every((a) => a.quien === "regla:motor_guiada" && typeof a.resultado.codigo === "string" && a.entrada !== undefined));
  assert.equal(e.doble.llamadas.length, 0, "nada de lo rechazado llegó a cotizar con Python");
  // Una tanda que quita piezas hasta quedarse sin ninguna deja la última y lo dice.
  const tanda = await editar(e, plan, { tipo: "ops", ediciones: [{ op: "quitar_pieza", pieza: "EST_01_ARCO" }, { op: "quitar_pieza", pieza: "EST_02_COLUMNA" }, { op: "quitar_pieza", pieza: "EST_03_COLUMNA" }] });
  assert.equal(tanda.respuesta.status, 200);
  const parcial = RespuestaEditarMotorSchema.parse(tanda.cuerpo);
  assert.deepEqual((PlanGuiadoSchema.parse(parcial.plan) as Plan).espec.piezas.map((p) => p.id), ["EST_03_COLUMNA"]);
  assert.deepEqual(parcial.noAplicadas, ["No pude: tu plan necesita al menos una pieza."]);
  assert.match(parcial.confirmacion, /^Listo: quité el arco; quité la columna izquierda\. No pude: tu plan necesita al menos una pieza\.$/);
});

test("un cambio que deja una pieza que el motor no arma, o que la tienda no vende, o un precio que falla, se rechaza entero", async () => {
  // Una pared de malla con cuatro colores: un quinto no llega a su lista de materiales.
  const pared = await planDe({ frase: "Una pared.", colores: ["azul", "rojo", "blanco", "negro"], piezas: [{ estructura: "pared_densa", cantidad: 1 }] });
  const e = entorno();
  const noArmable = await editar(e, pared, { tipo: "ops", ediciones: [{ op: "agregar_color", color: "verde" }] });
  assert.equal(noArmable.respuesta.status, 422);
  const dicho = FalloEditarMotorSchema.parse(noArmable.cuerpo);
  assert.equal(dicho.codigo, "EDICION_NO_ARMABLE");
  assert.match(dicho.error, /^No pude: ese color no se puede armar en esa pieza/);
  assert.doesNotMatch(dicho.error, /lista de materiales|R-\d|\(\d{3}\)/);

  const plan = await planDe();
  const sinTienda = entorno({ cotizar: async () => ({ ok: false, razon: "sin_cobertura", faltantes: [{ formatoId: "R-12", codigo: "015", motivo: "no_esta_en_la_tienda" }] }) as ResultadoCotizacionBom });
  const cobertura = await editar(sinTienda, plan, pedidoColor);
  assert.deepEqual([cobertura.respuesta.status, FalloEditarMotorSchema.parse(cobertura.cuerpo).codigo], [422, "SIN_COBERTURA"]);
  assert.match(FalloEditarMotorSchema.parse(cobertura.cuerpo).error, /^No pude: la tienda no vende/);

  const sinPrecio = entorno({ cotizar: async () => ({ ok: false, razon: "precio_fallido", detalle: "python caído" }) as ResultadoCotizacionBom });
  const precio = await editar(sinPrecio, plan, pedidoColor);
  assert.deepEqual([precio.respuesta.status, FalloEditarMotorSchema.parse(precio.cuerpo).codigo], [422, "PRECIO_FALLIDO"]);
  assert.match(FalloEditarMotorSchema.parse(precio.cuerpo).error, /^No pude: no logré calcular el precio.*Tu plan sigue como estaba/);

  const roto = entorno({ armar: () => { throw new Error("boom"); } });
  const aviso = console.warn;
  console.warn = () => undefined;
  try {
    const error = await editar(roto, plan, pedidoColor);
    assert.deepEqual([error.respuesta.status, FalloEditarMotorSchema.parse(error.cuerpo).codigo], [500, "ERROR_DEL_MOTOR"]);
    assert.match(FalloEditarMotorSchema.parse(error.cuerpo).error, /^No pude: tuve un problema técnico/);
    assert.ok(roto.auditorias.some((a) => a.resultado.razon === "error_inesperado"));
  } finally {
    console.warn = aviso;
  }
  for (const entorno_ of [e, sinTienda, sinPrecio]) assert.ok(rechazos(entorno_).length >= 1, "el rechazo queda auditado");
});

test("los planes de Python no se editan aquí y los del 3D no se editan en /api/plan-editar", async () => {
  const plan = await planDe();
  const e = entorno();
  const dePython = { ...plan, approval_token: crearTokenPlan({ planHash: plan.plan_hash, requestId: "r", backend: "python", catalogSnapshotId: "s", allowlist: [] }) };
  const r = await atenderEditarMotor(pedir({ plan: dePython, edicion: pedidoColor }), e.deps);
  assert.equal(r.status, 409);
  assert.equal(((await r.json()) as { codigo: string }).codigo, "PLAN_NO_ES_DEL_MOTOR_3D");
});

test("un motivo técnico del motor no llega al cliente: la frase es de cliente y el motivo queda en la auditoría", async () => {
  const plan = await planDe();
  const motivo = "Ningún color de la paleta se fabrica en R-18, R-24";
  const e = entorno({ armar: (espec) => ({ ...armarDesdeEspec(espec), noRepresentable: [{ piezaId: "EST_01_ARCO", motivo }] }) });
  const r = await editar(e, plan, pedidoColor);
  assert.equal(r.respuesta.status, 422);
  const error = FalloEditarMotorSchema.parse(r.cuerpo).error;
  assert.doesNotMatch(error, /R-\d|\(\d{3}\)|armad|motor|paleta|fabric/i, error);
  assert.match(error, /^No pude: ese color no se puede armar en esa pieza/);
  assert.ok(rechazos(e).some((a) => JSON.stringify(a.resultado).includes("R-18")), "el motivo técnico queda en la auditoría");
});

test("cupo por hora y por navegador: al agotarlo, 429 LIMITE_EDICIONES y el plan queda como estaba; otro navegador no se ve afectado", async () => {
  const plan = await planDe();
  const e = entorno({ tope: 2 });
  assert.equal((await editar(e, plan, pedidoColor)).respuesta.status, 200);
  assert.equal((await editar(e, plan, pedidoColor)).respuesta.status, 200);
  const tercera = await editar(e, plan, pedidoColor);
  assert.equal(tercera.respuesta.status, 429);
  assert.equal(FalloEditarMotorSchema.parse(tercera.cuerpo).codigo, "LIMITE_EDICIONES");
  assert.match(FalloEditarMotorSchema.parse(tercera.cuerpo).error, /tu plan sigue como estaba/);
  const otro = await editar(e, plan, pedidoColor, {}, [SESION, OTRO_NAVEGADOR]);
  assert.notEqual(otro.respuesta.status, 429, "el cupo es por navegador");
});

test("una tanda que no se hizo entera dice todas las razones, no solo la primera", async () => {
  const plan = await planDe();
  const e = entorno();
  const r = await editar(e, plan, { tipo: "ops", ediciones: [{ op: "quitar_color", color: "rosado" }, { op: "quitar_color", color: "verde" }] });
  assert.equal(r.respuesta.status, 422);
  const fallo = FalloEditarMotorSchema.parse(r.cuerpo);
  assert.equal(fallo.noAplicadas?.length, 2, "las dos razones vienen en la respuesta");
  assert.equal(fallo.error, unirNoPude(fallo.noAplicadas ?? []));
  for (const frase of fallo.noAplicadas ?? []) assert.ok(fallo.error.toLowerCase().includes(frase.replace("No pude: ", "").toLowerCase()), frase);
});
