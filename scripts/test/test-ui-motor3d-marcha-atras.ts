/**
 * La marcha atrás ordenada del motor de la guiada vista desde el navegador (P-045): el hook `useMotorGuiada` con `fetch`
 * doble y los componentes que pinta la vista, renderizados (sin servidor ni coste).
 * - La bandera decide solo los planes NUEVOS: un plan abierto sigue en su motor aunque la bandera cambie a mitad de la
 *   conversación (ni la lee): rehacer o sumar a un plan del 3D va al 3D con ese plan como base, y rehacer un plan de Python
 *   sigue en Python.
 * - Si un plan del 3D deja el 3D (corte, o su línea pasó el límite con la bandera en python), la primera vez el cliente VE una
 *   tarjeta que le dice que su plan se recalcula y que el precio puede cambiar, con el botón «Recalcular mi plan»; su plan
 *   queda como estaba. Solo si lo vuelve a pedir se recalcula, y la tarjeta del plan nuevo lo dice. Un cambio que el corte
 *   rechazó cuenta como aviso.
 * - Una conversación de Python no toca el 3D y hace las mismas peticiones de Python, byte a byte.
 * Los planes de las respuestas son el fixture de Python con otro hash: el hook solo los reenvía, su contenido no importa aquí.
 *
 * Run: npx tsx scripts/test/test-ui-motor3d-marcha-atras.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { WidgetGuiadoSchema } from "@/lib/ia/guiado/widgets";
import { ETIQUETA_RECALCULAR, TEXTO_AVISO_RECALCULO, TITULO_AVISO_RECALCULO } from "@/lib/guiada-motor/mensajes-cliente";
import { crearAvisosRecalculo, type AvisosRecalculo } from "@/components/guiado/aviso-recalculo";
import { crearDependenciasEdicion3d, FalloMotor3dApagado } from "@/components/guiado/edicion-motor3d";
import { falloDelPlan } from "@/components/guiado/fallo-plan";
import { NotasPlan } from "@/components/guiado/NotasPlan";
import { TEXTO_REHECHO_EN_PYTHON } from "@/components/guiado/Plan3DEnPreparacion";
import { TarjetaError } from "@/components/guiado/TarjetaError";
import { TarjetaPropuesta } from "@/components/guiado/TarjetaPropuesta";
import { useMotorGuiada, type FalloMotor3d, type IntentoPropuesta } from "@/components/guiado/usarMotorGuiada";

const planPython = PlanGuiadoSchema.parse(JSON.parse(readFileSync("scripts/test/fixtures/plan-guiado-columnas-repetidas.json", "utf8")));
const plan3d = { ...planPython, plan_hash: "3d".repeat(32) };
const otroPlan3d = { ...planPython, plan_hash: "0d".repeat(32) };
const propuestaArco = { frase: "Te propongo un arco azul.", colores: ["azul"], piezas: [{ estructura: "arco" as const, cantidad: 1 }] };
const propuesta = propuestaArco as never;
const senal = new AbortController().signal;
const sinAccion = () => undefined;

type Hook = ReturnType<typeof useMotorGuiada>;
function hook(avisos: AvisosRecalculo = crearAvisosRecalculo()): Hook {
  let capturado: Hook | null = null;
  renderToStaticMarkup(createElement(function Sonda() { capturado = useMotorGuiada(avisos); return null; }));
  return capturado!;
}

type Llamada = { metodo: string; url: string; cuerpo: string | null };
type Red = { bandera: { motor: "3d" | "python"; fuente: string }; plan: () => Response; planIdea: () => Response };
const respuestaPlan = (plan: unknown) => Response.json({ plan, cotizacion: { total: 1 }, nuevas: [], globosIdea: null, exacto: true, avisos: [] });
const dejaEl3d = (razon: "motor_3d_cortado" | "plan_3d_vencido" | "aprobacion_invalida") => () => Response.json({ error: "x", codigo: razon.toUpperCase(), fallback: { razon } }, { status: 409 });
const corte = dejaEl3d("motor_3d_cortado");
const prohibida = (ruta: string) => () => { throw new Error(`no debía llamarse ${ruta}`); };

/** `fetch` doble: la bandera, la ruta del 3D y el plan-idea de Python; `red` se puede cambiar a mitad de la prueba. */
async function conRed(red: Red, cuerpo: (llamadas: Llamada[]) => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  const llamadas: Llamada[] = [];
  globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(entrada);
    llamadas.push({ metodo: init?.method ?? "GET", url, cuerpo: init?.body ? String(init.body) : null });
    if (url.startsWith("/api/guiada/motor/plan")) return red.plan();
    if (url.startsWith("/api/guiada/motor/editar")) return corte();
    if (url.startsWith("/api/guiada/motor")) return Response.json(red.bandera);
    if (url.startsWith("/api/plan-idea")) return red.planIdea();
    throw new Error(`ruta inesperada: ${url}`);
  }) as typeof fetch;
  try { await cuerpo(llamadas); } finally { globalThis.fetch = original; }
}
const rutas = (llamadas: Llamada[]) => llamadas.map((l) => `${l.metodo} ${l.url}`);
const base = (llamada: Llamada | undefined) => (JSON.parse(llamada?.cuerpo ?? "{}") as { base?: { plan_hash?: string } }).base?.plan_hash;
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replaceAll("&quot;", "\"").replaceAll("&#x27;", "'").replace(/\s+/g, " ");

/**
 * Lo que el cliente VE cuando la vista recibe este intento: la vista (`ejecutarPlanConMotor` + `aceptarPropuesta`) pasa su
 * `aviso` a `falloDelPlan`, marca la propuesta `en_espera` y pinta la tarjeta con `TarjetaError`. Aquí se renderiza igual.
 */
function loQueVeElCliente(intento: IntentoPropuesta | null, idea?: { titulo: string; sumada: boolean }): string {
  assert.ok(intento !== null && !intento.ok, "la vista solo pinta tarjeta cuando el intento no dio plan");
  const { fallo } = falloDelPlan({ estado: "fallo", ...(intento.aviso ? { aviso: intento.aviso } : {}), ...(idea ? { idea } : {}), accion: { tipo: "plan" }, mensajeId: "m1" });
  const tarjeta = renderToStaticMarkup(createElement(TarjetaError, {
    titulo: fallo.titulo, ...(fallo.detalle ? { detalle: fallo.detalle } : {}), ...(fallo.etiqueta ? { reintentarEtiqueta: fallo.etiqueta } : {}), ...(fallo.variante ? { variante: fallo.variante } : {}),
    onReintentar: sinAccion, onCerrar: sinAccion, ...(fallo.alternativas?.length ? { alternativas: fallo.alternativas.map((tipo) => ({ etiqueta: tipo, onElegir: sinAccion })) } : {}),
  }));
  const tarjetaPropuesta = renderToStaticMarkup(createElement(TarjetaPropuesta, { ...propuestaArco, estado: intento.aviso ? "en_espera" : "fallo" }));
  return `${tarjetaPropuesta}${tarjeta}`;
}

test("la bandera cambia a mitad de la conversación: los planes nuevos la obedecen, el plan del 3D abierto sigue en el 3D sin leerla", async () => {
  const red: Red = { bandera: { motor: "3d", fuente: "ajuste" }, plan: () => respuestaPlan(plan3d), planIdea: prohibida("/api/plan-idea") };
  await conRed(red, async (llamadas) => {
    const h = hook();
    const nuevo = await h.planDePropuesta({ propuesta, anterior3d: null, deFoto: false, signal: senal, alFallback: sinAccion });
    assert.equal(nuevo?.ok, true, "con la bandera en 3d el plan nuevo sale del 3D");
    assert.deepEqual(rutas(llamadas), ["GET /api/guiada/motor?para=plan_nuevo", "POST /api/guiada/motor/plan"]);

    red.bandera = { motor: "python", fuente: "ajuste" };
    llamadas.length = 0;
    const rehecho = await h.planDePropuesta({ propuesta, anterior3d: plan3d, deFoto: false, signal: senal, alFallback: sinAccion });
    const sumada = await h.planDeIdea({ ideaId: "deco-real-07", base: { plan: plan3d, motor: "3d" }, signal: senal, alFallback: sinAccion });
    assert.equal(rehecho?.ok, true, "rehacer el plan del 3D sigue en el 3D con la bandera en python");
    assert.deepEqual({ ok: sumada.ok, motor: sumada.motor }, { ok: true, motor: "3d" }, "sumarle una idea, también");
    assert.deepEqual(rutas(llamadas), ["POST /api/guiada/motor/plan", "POST /api/guiada/motor/plan"], "ni lee la bandera ni va a Python");
    assert.ok(llamadas.every((l) => base(l) === plan3d.plan_hash), "con el plan vigente como base");

    llamadas.length = 0;
    assert.equal(await h.planDePropuesta({ propuesta, anterior3d: null, deFoto: false, signal: senal, alFallback: sinAccion }), null, "un plan nuevo ya va a Python");
    assert.deepEqual(rutas(llamadas), ["GET /api/guiada/motor?para=plan_nuevo"]);
  });
});

test("python → 3d a mitad de la conversación: rehacer un plan de Python sigue en Python, sin llamar al 3D, y la decisión queda en la auditoría", async () => {
  await conRed({ bandera: { motor: "3d", fuente: "ajuste" }, plan: prohibida("/api/guiada/motor/plan"), planIdea: () => respuestaPlan(planPython) }, async (llamadas) => {
    const h = hook();
    assert.equal(await h.planDePropuesta({ propuesta, anterior3d: null, deFoto: false, anteriorPython: true, signal: senal, alFallback: sinAccion }), null, "null = la vista lo rehace con Python");
    const idea = await h.planDeIdea({ ideaId: "deco-real-07", base: { plan: planPython, motor: "python" }, signal: senal, alFallback: sinAccion });
    assert.equal(idea.motor, "python");
    assert.deepEqual(rutas(llamadas), ["GET /api/guiada/motor?para=plan_python", "POST /api/plan-idea"], "la lectura que audita «conserva Python» y el plan-idea de la idea sumada");
  });
});

for (const razon of ["motor_3d_cortado", "plan_3d_vencido", "aprobacion_invalida"] as const) {
  test(`${razon}: el cliente VE el aviso (tarjeta informativa con «Recalcular mi plan») y su plan queda; si lo vuelve a pedir, se recalcula y la tarjeta del plan lo dice`, async () => {
    await conRed({ bandera: { motor: "python", fuente: razon === "motor_3d_cortado" ? "corte" : "ajuste" }, plan: dejaEl3d(razon), planIdea: prohibida("/api/plan-idea") }, async (llamadas) => {
      const h = hook();
      const dichos: FalloMotor3d[] = [];
      const entrada = { propuesta, anterior3d: plan3d, deFoto: false, signal: senal, alFallback: (fallo: FalloMotor3d) => { dichos.push(fallo); } };

      const primero = await h.planDePropuesta(entrada);
      assert.ok(primero !== null && !primero.ok && !primero.detenido, "no es «sigue con Python» (null): la vista deja el plan como estaba");
      assert.equal(primero.razon, razon);
      assert.equal(primero.aviso, TEXTO_AVISO_RECALCULO, "el aviso vuelve con el intento, para la tarjeta");
      assert.equal(dichos[0]!.aviso, TEXTO_AVISO_RECALCULO, "y el registro sabe que se avisó");

      const visto = texto(loQueVeElCliente(primero));
      assert.ok(visto.includes(TITULO_AVISO_RECALCULO), visto);
      assert.ok(visto.includes(TEXTO_AVISO_RECALCULO), "el aviso entero se ve en la tarjeta");
      assert.match(visto, /el precio pueden cambiar/);
      assert.match(visto, /Tu plan sigue como estaba/);
      assert.ok(visto.includes(ETIQUETA_RECALCULAR), "el botón dice qué hace: recalcular");
      assert.doesNotMatch(visto, /No pude/, "no es un fallo: ni la tarjeta ni la propuesta dicen «No pude»");
      assert.doesNotMatch(visto, /motor|armad|python|3d/i, "sin jerga");
      assert.match(loQueVeElCliente(primero), /data-variante="actualizar"/, "estilo informativo, no el de error");

      const conIdea = texto(loQueVeElCliente(primero, { titulo: "Columnas doradas", sumada: true }));
      assert.ok(conIdea.includes(TEXTO_AVISO_RECALCULO) && !/No pude/.test(conIdea), "al sumar una idea, el mismo aviso");

      const segundo = await h.planDePropuesta(entrada);
      assert.equal(segundo, null, "ya avisado: se recalcula (por Python)");
      assert.equal(dichos[1]!.aviso, undefined, "no se vuelve a avisar");
      assert.deepEqual(rutas(llamadas), ["POST /api/guiada/motor/plan", "POST /api/guiada/motor/plan"], "el servidor decide en cada intento; la bandera ni se lee");

      const otro = await h.planDePropuesta({ ...entrada, anterior3d: otroPlan3d });
      assert.equal(otro !== null && !otro.ok ? otro.aviso : null, TEXTO_AVISO_RECALCULO, "otro plan del 3D: su cliente no ha leído el aviso de ESE plan");
    });
  });
}

test("el plan recalculado lo dice en lo que se VE (sobre la tarjeta del plan), y el widget lo guarda para después de recargar", () => {
  const widget = WidgetGuiadoSchema.parse({ tipo: "plan", plan: planPython, motor: "python", recalculado: true });
  assert.ok(widget.tipo === "plan" && widget.recalculado === true);
  const visto = texto(renderToStaticMarkup(createElement(NotasPlan, { widget, vigente: true })));
  assert.ok(visto.includes(TEXTO_REHECHO_EN_PYTHON), visto);
  assert.match(TEXTO_REHECHO_EN_PYTHON, /el precio pueden cambiar/);
  assert.doesNotMatch(TEXTO_REHECHO_EN_PYTHON, /motor|un poco/, "sin jerga ni promesas de que cambia poco");
  assert.equal(texto(renderToStaticMarkup(createElement(NotasPlan, { widget: { ...widget, recalculado: undefined }, vigente: true }))).trim(), "", "un plan que no se recalculó no dice nada");
  const conIdea = texto(renderToStaticMarkup(createElement(NotasPlan, { widget: { agregada: { avisos: ["Ajustamos un tamaño que no había: 36″ por 24″."] } }, vigente: true })));
  assert.match(conIdea, /Ajustamos un tamaño/, "la línea de la idea no exacta sigue saliendo");
  const enEspera = WidgetGuiadoSchema.parse({ tipo: "propuesta", propuesta: propuestaArco, estado: "en_espera" });
  assert.ok(enEspera.tipo === "propuesta" && enEspera.estado === "en_espera");
});

test("corte del 3D al sumar una idea: la suma no avisa ni marca (sigue por la propuesta, que avisa); un cambio rechazado por el corte sí cuenta como aviso", async () => {
  await conRed({ bandera: { motor: "python", fuente: "corte" }, plan: corte, planIdea: prohibida("/api/plan-idea") }, async (llamadas) => {
    const avisos = crearAvisosRecalculo();
    const h = hook(avisos);
    const dichos: FalloMotor3d[] = [];
    const suma = await h.planDeIdea({ ideaId: "deco-real-07", base: { plan: plan3d, motor: "3d" }, signal: senal, alFallback: (fallo) => { dichos.push(fallo); } });
    assert.deepEqual({ ok: suma.ok, motor: suma.motor }, { ok: false, motor: "3d" }, "quien llama sigue por la propuesta, nunca por el plan-idea de Python");
    assert.equal(dichos[0]!.aviso, undefined);
    assert.equal(avisos.yaAvisado(plan3d.plan_hash), false, "si la suma marcara, la propuesta recalcularía sin avisar");
    assert.equal(llamadas.some((l) => l.url.startsWith("/api/plan-idea")), false);

    await assert.rejects(() => crearDependenciasEdicion3d({ avisos }).editar(plan3d, { tipo: "ops", ediciones: [] }), FalloMotor3dApagado);
    const tras = await h.planDePropuesta({ propuesta, anterior3d: plan3d, deFoto: false, signal: senal, alFallback: (fallo) => { dichos.push(fallo); } });
    assert.equal(tras, null, "el cliente ya leyó en el cambio rechazado que su plan se recalcula: se recalcula sin preguntar otra vez");
    assert.equal(dichos.at(-1)!.aviso, undefined);
  });
});

test("con el corte, un plan nuevo va a Python sin avisar (no hay precio que cambie) y sin llamar al 3D", async () => {
  await conRed({ bandera: { motor: "python", fuente: "corte" }, plan: prohibida("/api/guiada/motor/plan"), planIdea: () => respuestaPlan(planPython) }, async (llamadas) => {
    const dichos: FalloMotor3d[] = [];
    assert.equal(await hook().planDePropuesta({ propuesta, anterior3d: null, deFoto: false, signal: senal, alFallback: (fallo) => { dichos.push(fallo); } }), null);
    const idea = await hook().planDeIdea({ ideaId: "deco-real-07", base: null, signal: senal, alFallback: (fallo) => { dichos.push(fallo); } });
    assert.equal(idea.motor, "python");
    assert.deepEqual(dichos, []);
    assert.deepEqual(rutas(llamadas), ["GET /api/guiada/motor?para=plan_nuevo", "GET /api/guiada/motor?para=plan_nuevo", "POST /api/plan-idea"]);
  });
});

test("«Detener» antes de rehacer un plan del 3D: detenido, sin ninguna petición", async () => {
  await conRed({ bandera: { motor: "3d", fuente: "ajuste" }, plan: prohibida("/api/guiada/motor/plan"), planIdea: prohibida("/api/plan-idea") }, async (llamadas) => {
    const abortada = new AbortController();
    abortada.abort();
    const intento = await hook().planDePropuesta({ propuesta, anterior3d: plan3d, deFoto: false, signal: abortada.signal, alFallback: sinAccion });
    assert.ok(intento !== null && !intento.ok && intento.detenido);
    const idea = await hook().planDeIdea({ ideaId: "deco-real-07", base: { plan: plan3d, motor: "3d" }, signal: abortada.signal, alFallback: sinAccion });
    assert.deepEqual({ ok: idea.ok, detenido: !idea.ok && idea.detenido }, { ok: false, detenido: true });
    const dePython = await hook().planDePropuesta({ propuesta, anterior3d: null, deFoto: false, anteriorPython: true, signal: abortada.signal, alFallback: sinAccion });
    assert.ok(dePython !== null && !dePython.ok && dePython.detenido, "rehacer un plan de Python, tampoco (no sigue con Python, que se paga)");
    assert.deepEqual(llamadas, []);
  });
});

test("una conversación que empezó en Python: nunca el 3D, cada plan deja su lectura auditada y las peticiones de Python van byte a byte", async () => {
  await conRed({ bandera: { motor: "python", fuente: "defecto" }, plan: prohibida("/api/guiada/motor/plan"), planIdea: () => respuestaPlan(planPython) }, async (llamadas) => {
    const h = hook();
    const alFallback = () => assert.fail("una conversación de Python no tiene fallos del 3D");
    assert.equal(await h.planDePropuesta({ propuesta, anterior3d: null, deFoto: false, signal: senal, alFallback }), null, "plan nuevo");
    assert.equal(await h.planDePropuesta({ propuesta, anterior3d: null, deFoto: false, anteriorPython: true, signal: senal, alFallback }), null, "rehacer el plan de Python");
    assert.equal(await h.planDePropuesta({ propuesta, anterior3d: null, deFoto: true, signal: senal, alFallback }), null, "plan de foto");
    assert.equal((await h.planDeIdea({ ideaId: "deco-real-07", base: null, signal: senal, alFallback })).motor, "python", "idea nueva");
    assert.equal((await h.planDeIdea({ ideaId: "deco-real-09", base: { plan: planPython, motor: "python" }, signal: senal, alFallback })).motor, "python", "idea sumada");
    assert.deepEqual(llamadas, [
      { metodo: "GET", url: "/api/guiada/motor?para=plan_nuevo", cuerpo: null },
      { metodo: "GET", url: "/api/guiada/motor?para=plan_python", cuerpo: null },
      { metodo: "GET", url: "/api/guiada/motor?para=plan_nuevo", cuerpo: null },
      { metodo: "POST", url: "/api/plan-idea", cuerpo: JSON.stringify({ idea_id: "deco-real-07" }) },
      { metodo: "POST", url: "/api/plan-idea", cuerpo: JSON.stringify({ idea_id: "deco-real-09", base: planPython }) },
    ]);
  });
});
