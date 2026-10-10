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
import { PlanGuiadoSchema, PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
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
import { avisarCorte3d, avisarSiEsCorteDeLaImagen, CODIGO_MOTOR_3D_CORTADO, crearEscuchaCorte3d, debeMostrarAvisoCorte3d, hashAvisoCorteAlCargar, sinAvisoDeCorte, suscribirCorte3d, TIPO_ACCION_RECALCULAR_3D, type OrigenAviso } from "@/components/guiado/aviso-corte-3d";
import { avisarAlCargarPlan } from "@/components/guiado/avisar-corte-3d-al-cargar";
import { EstadoGuardadoSchema } from "@/components/guiado/estado-guardado";
import { planActualDelPlan } from "@/components/guiado/plan-actual";
import { prepararRecalculo3d, propuestaParaGuardar, TEXTO_RECALCULO_NO_POSIBLE } from "@/components/guiado/recalculo-3d";
import { ErrorImagen, pedirImagenConRecuperacion } from "@/lib/generacion/pedir-imagen";
import { TEXTO_AVISO_DIBUJO_RECALCULO } from "@/lib/guiada-motor/mensajes-cliente";
import { crearGestorVista, FalloArmada, type FirmaPlan } from "@/components/guiado/motor3d/gestor-vista";

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

/**
 * El aviso del corte del 3D (P-049): al cargar la conversación (si el plan vigente es del 3D y el corte está puesto), o cuando la
 * armada o la imagen reciben `MOTOR_3D_CORTADO`. Ninguno cambia el plan; no pisa una tarjeta de fallo ni avisa dos veces.
 */
test("el aviso al cargar: solo un plan del 3D pregunta; con el corte puesto avisa una vez; un plan de Python no hace ninguna petición", async () => {
  const avisados: string[] = [];
  const quitar = suscribirCorte3d((hash) => { avisados.push(hash); });
  try {
    let lecturas = 0;
    const contando = async () => { lecturas += 1; return { motor: "python" as const, fuente: "corte" as const, detenido: false }; };
    await avisarAlCargarPlan(null, contando);
    await avisarAlCargarPlan({ motor: "python", plan: { plan_hash: "pp".repeat(32) } }, contando);
    assert.equal(lecturas, 0, "ni una conversación sin plan ni un plan de Python leen la bandera");
    assert.deepEqual(avisados, []);

    await avisarAlCargarPlan({ motor: "3d", plan: { plan_hash: plan3d.plan_hash } }, contando);
    assert.equal(lecturas, 1);
    assert.deepEqual(avisados, [plan3d.plan_hash], "el plan del 3D con el corte puesto avisa");

    avisados.length = 0;
    await avisarAlCargarPlan({ motor: "3d", plan: { plan_hash: plan3d.plan_hash } }, async () => ({ motor: "python", fuente: "ajuste", detenido: false }));
    await avisarAlCargarPlan({ motor: "3d", plan: { plan_hash: plan3d.plan_hash } }, async () => ({ motor: "3d", fuente: "cookie", detenido: false }));
    assert.deepEqual(avisados, [], "sin corte (ni con la cookie del administrador), nada");
  } finally { quitar(); }

  assert.equal(hashAvisoCorteAlCargar(plan3d.plan_hash, "corte"), plan3d.plan_hash);
  assert.equal(hashAvisoCorteAlCargar(null, "corte"), null);
});

test("al cargar, la lectura usa GET /api/guiada/motor sin para (una sola vez, sin sondeo)", async () => {
  await conRed({ bandera: { motor: "python", fuente: "corte" }, plan: prohibida("/api/guiada/motor/plan"), planIdea: prohibida("/api/plan-idea") }, async (llamadas) => {
    await avisarAlCargarPlan({ motor: "3d", plan: { plan_hash: plan3d.plan_hash } });
    assert.deepEqual(rutas(llamadas), ["GET /api/guiada/motor"]);
  });
});

test("el aviso sale con su origen y deja de llegar al soltar la suscripción", () => {
  const recibidos: Array<[string, string]> = [];
  const quitar = suscribirCorte3d((hash, origen) => { recibidos.push([hash, origen]); });
  avisarCorte3d("aa".repeat(32), "dibujo");
  quitar();
  avisarCorte3d("bb".repeat(32), "carga");
  assert.deepEqual(recibidos, [["aa".repeat(32), "dibujo"]]);
  assert.equal(CODIGO_MOTOR_3D_CORTADO, "MOTOR_3D_CORTADO");
});

const hashCortado = plan3d.plan_hash;
const errorDelCorte = () => new ErrorImagen("rechazo", "/api/guiada/motor/imagen respondió con estado 409.", 409, CODIGO_MOTOR_3D_CORTADO);

test("el aviso solo sale para el plan de la pantalla, sin petición en curso ni otra tarjeta, y una vez salvo que el cliente lo pida con un toque", () => {
  const base = { planHash: hashCortado, origen: "dibujo" as OrigenAviso, planVigenteHash: hashCortado, yaAvisado: false, cargando: false, hayFallo: false };
  assert.equal(debeMostrarAvisoCorte3d(base), true);
  assert.equal(debeMostrarAvisoCorte3d({ ...base, planVigenteHash: otroPlan3d.plan_hash }), false, "el corte nombra un plan que ya no es el de la pantalla");
  assert.equal(debeMostrarAvisoCorte3d({ ...base, planVigenteHash: null }), false, "sin plan en pantalla");
  assert.equal(debeMostrarAvisoCorte3d({ ...base, cargando: true }), false, "no pisa una petición en curso");
  assert.equal(debeMostrarAvisoCorte3d({ ...base, hayFallo: true }), false, "no pisa el último mensaje sin respuesta");
  for (const origen of ["carga", "dibujo"] as const) assert.equal(debeMostrarAvisoCorte3d({ ...base, origen, yaAvisado: true }), false, `${origen}: no es un segundo aviso`);
  assert.equal(debeMostrarAvisoCorte3d({ ...base, origen: "toque", yaAvisado: true }), true, "el cliente tocó «Ver cómo quedaría»: se le contesta aunque ya lo leyera");
  assert.equal(debeMostrarAvisoCorte3d({ ...base, origen: "toque", yaAvisado: true, hayFallo: true }), false, "ni un toque pisa otra tarjeta");
});

test("el texto del aviso al cargar o al pedir una vista no habla de un cambio que nadie pidió, y dice que volver a pedirlo también recalcula", () => {
  assert.doesNotMatch(TEXTO_AVISO_DIBUJO_RECALCULO, /ese cambio/);
  assert.match(TEXTO_AVISO_DIBUJO_RECALCULO, /no se puede mostrar/);
  assert.match(TEXTO_AVISO_DIBUJO_RECALCULO, /las cantidades y el precio pueden cambiar/);
  assert.match(TEXTO_AVISO_DIBUJO_RECALCULO, /Recalcular mi plan/);
  assert.match(TEXTO_AVISO_DIBUJO_RECALCULO, /o vuelve a pedírmelo/, "mostrarlo ya cuenta como aviso: el siguiente cambio recalcula sin otro");
});

test("«Ver cómo quedaría» con el corte: el 409 vuelve a mostrar el aviso aunque ya se hubiera mostrado, y no se queda mudo", () => {
  const avisos = crearAvisosRecalculo();
  const vista = { planVigenteHash: hashCortado as string | null, cargando: false, hayFallo: false };
  const mostrados: OrigenAviso[] = [];
  const quitar = suscribirCorte3d(crearEscuchaCorte3d({ avisos, estado: () => vista, mostrar: (_hash, origen) => { mostrados.push(origen); vista.hayFallo = true; } }));
  try {
    avisarCorte3d(hashCortado, "carga");
    assert.deepEqual(mostrados, ["carga"]);
    assert.equal(avisos.yaAvisado(hashCortado), true, "mostrarlo lo marca: el siguiente cambio ya recalcula");

    avisarCorte3d(hashCortado, "dibujo");
    assert.deepEqual(mostrados, ["carga"], "con la tarjeta a la vista no sale otra");

    vista.hayFallo = false;
    avisarCorte3d(hashCortado, "dibujo");
    assert.deepEqual(mostrados, ["carga"], "las miniaturas que siguen fallando no la reabren tras cerrarla");

    // El cliente toca «Ver cómo quedaría» (que quita la tarjeta) y la imagen vuelve con el 409 del corte.
    assert.equal(avisarSiEsCorteDeLaImagen(errorDelCorte(), hashCortado), true);
    assert.deepEqual(mostrados, ["carga", "toque"], "el toque recibe su respuesta: antes el botón dejaba de girar sin decir nada");
    assert.equal(avisarSiEsCorteDeLaImagen(errorDelCorte(), hashCortado), true);
    assert.deepEqual(mostrados, ["carga", "toque"], "con la tarjeta ya a la vista, otro toque no la duplica");

    vista.hayFallo = false;
    vista.planVigenteHash = otroPlan3d.plan_hash;
    avisarSiEsCorteDeLaImagen(errorDelCorte(), hashCortado);
    assert.deepEqual(mostrados, ["carga", "toque"], "si el plan de la pantalla ya es otro, no se avisa de este");
  } finally { quitar(); }
});

test("la imagen que el servidor rechaza con el corte llega a la vista como el aviso; cualquier otro fallo, no", async () => {
  const mostrados: OrigenAviso[] = [];
  const orden: string[] = [];
  const vista = { planVigenteHash: hashCortado as string | null, cargando: false, hayFallo: false };
  const quitar = suscribirCorte3d(crearEscuchaCorte3d({ avisos: crearAvisosRecalculo(), estado: () => vista, mostrar: (_hash, origen) => { mostrados.push(origen); orden.push("aviso"); } }));
  const pedirConRespuesta = (respuesta: () => Response) => pedirImagenConRecuperacion({
    ruta: "/api/guiada/motor/imagen", cuerpo: {}, planHash: hashCortado, senal, limiteIntentoMs: 1_000, reintentoSilencioso: false,
    dependencias: { fetch: async () => respuesta() },
  });
  try {
    const delCorte = await pedirConRespuesta(() => Response.json({ error: "No pude", codigo: CODIGO_MOTOR_3D_CORTADO }, { status: 409 })).catch((causa: unknown) => causa);
    assert.ok(delCorte instanceof ErrorImagen && delCorte.status === 409, "el cliente de imágenes falla tipado con el código del servidor");
    assert.equal(avisarSiEsCorteDeLaImagen(delCorte, hashCortado, () => orden.push("causa registrada")), true);
    assert.deepEqual(orden, ["causa registrada", "aviso"], "la causa queda registrada antes del aviso");
    assert.deepEqual(mostrados, ["toque"]);

    mostrados.length = 0;
    const otros = [
      await pedirConRespuesta(() => Response.json({ error: "x", codigo: "PLAN_ALTERADO" }, { status: 409 })).catch((causa: unknown) => causa),
      new ErrorImagen("red", "sin red"),
      new Error("otra cosa"),
      "texto",
    ];
    for (const causa of otros) assert.equal(avisarSiEsCorteDeLaImagen(causa, hashCortado, () => orden.push("no debía")), false);
    assert.deepEqual(mostrados, []);
    assert.ok(!orden.includes("no debía"));
  } finally { quitar(); }
});

test("al llegar un plan nuevo se quita el aviso de recálculo, y cualquier otra tarjeta se queda", () => {
  const aviso = { titulo: "Antes de cambiar tu plan", accion: { tipo: TIPO_ACCION_RECALCULAR_3D, planHash: hashCortado } };
  const sinRespuesta = { titulo: "Tu último mensaje quedó sin respuesta", accion: { tipo: "turno" } };
  assert.equal(sinAvisoDeCorte(aviso), null);
  assert.equal(sinAvisoDeCorte(sinRespuesta), sinRespuesta);
  assert.equal(sinAvisoDeCorte(null), null);
});

/**
 * «Recalcular mi plan» (P-049): con qué se vuelve a armar el plan. Los datos son un plan real (columnas repetidas) y su proyección
 * (`planActualDelPlan`), no objetos a mano: lo que la vista le pasa a `aceptarPropuesta` sale de aquí.
 */
test("Recalcular mi plan: la propuesta guardada manda, y el plan anterior es el del plan o, si no lo da, lo que dice la propuesta", () => {
  const guardada = PropuestaComposicionSchema.parse({ frase: "Te propongo un arco azul.", colores: ["azul"], piezas: [{ estructura: "arco", cantidad: 1, nombre: "Arco azul", medidas: { ancho_m: 2, alto_m: 2.2 } }] });
  const planActual = planActualDelPlan(plan3d, "python");
  assert.ok(planActual);
  assert.deepEqual(prepararRecalculo3d({ guardada, planActual, piezasDelPlan: plan3d.plan.estructuras }), { propuesta: guardada, planAnterior: planActual });

  const sinPlanActual = prepararRecalculo3d({ guardada, planActual: null, piezasDelPlan: plan3d.plan.estructuras });
  assert.ok(sinPlanActual, "con la propuesta guardada siempre hay con qué recalcular, aunque el plan no se lea");
  assert.equal(sinPlanActual.propuesta, guardada);
  assert.deepEqual(sinPlanActual.planAnterior, { piezas: [{ estructura: "arco", cantidad: 1, nombre: "Arco azul", medidas: { ancho_m: 2, alto_m: 2.2 } }], colores: ["azul"] }, "sin esto no habría plan anterior ni la nota «recalculado»");
});

test("Recalcular mi plan: sin propuesta guardada se reconstruye del plan con TODAS sus piezas", () => {
  const planActual = planActualDelPlan(plan3d, "python");
  assert.ok(planActual);
  const preparado = prepararRecalculo3d({ guardada: undefined, planActual, piezasDelPlan: plan3d.plan.estructuras });
  assert.ok(preparado, "un plan que se describe entero se puede rehacer");
  assert.deepEqual(preparado.planAnterior, planActual);
  assert.deepEqual(preparado.propuesta.piezas.map((pieza) => [pieza.estructura, pieza.cantidad]), planActual.piezas.map((pieza) => [pieza.estructura, pieza.cantidad]));
  assert.deepEqual(preparado.propuesta.colores, planActual.colores);
  assert.deepEqual(preparado.propuesta.piezas[0]?.medidas, planActual.piezas[0]?.medidas, "las medidas se conservan");
});

test("Recalcular mi plan: si la proyección del plan dejaría piezas fuera, no recalcula en silencio (hay un mensaje)", () => {
  const conPiezaSinOficial = structuredClone(plan3d);
  delete conPiezaSinOficial.plan.estructuras[1]!.estructura_oficial;
  const reducida = planActualDelPlan(conPiezaSinOficial, "python");
  assert.ok(reducida && reducida.piezas.length < conPiezaSinOficial.plan.estructuras.length, "la proyección pierde la pieza sin estructura oficial");
  assert.equal(prepararRecalculo3d({ guardada: undefined, planActual: reducida, piezasDelPlan: conPiezaSinOficial.plan.estructuras }), null, "la instrucción dice «SOLO las piezas de esta lista»: faltaría una");

  const planActual = planActualDelPlan(plan3d, "python")!;
  const repetida = plan3d.plan.estructuras.map((estructura, indice) => ({ ...estructura, repeticiones: indice === 0 ? 14 : estructura.repeticiones }));
  const recortada = { ...planActual, piezas: planActual.piezas.map((pieza, indice) => ({ ...pieza, cantidad: indice === 0 ? 12 : pieza.cantidad })) };
  assert.equal(prepararRecalculo3d({ guardada: undefined, planActual: recortada, piezasDelPlan: repetida }), null, "14 repeticiones no caben en las 12 de la proyección");

  assert.equal(prepararRecalculo3d({ guardada: undefined, planActual: null, piezasDelPlan: plan3d.plan.estructuras }), null, "ni propuesta ni plan legible");
  const colorAjeno = { ...planActual, colores: ["fashion azul rey"] };
  assert.equal(prepararRecalculo3d({ guardada: undefined, planActual: colorAjeno, piezasDelPlan: plan3d.plan.estructuras }), null, "un color que la propuesta no admite: no se adivina");
  assert.match(TEXTO_RECALCULO_NO_POSIBLE, /tu plan sigue como estaba/);
});

/**
 * La propuesta que el plan guarda para «Recalcular mi plan» solo la escribe un plan del 3D: las conversaciones guardadas se leen con
 * esquemas estrictos y un despliegue anterior descarta la conversación entera si una clave le es desconocida.
 */
test("la propuesta se guarda solo en un plan del 3D: un plan de Python no lleva la clave", () => {
  const propuestaGuardable = PropuestaComposicionSchema.parse(propuestaArco);
  assert.equal(propuestaParaGuardar("python", propuestaGuardable), undefined);
  assert.equal(propuestaParaGuardar("3d", propuestaGuardable), propuestaGuardable);
  const widgetDe = (motor: "3d" | "python") => {
    const guardada = propuestaParaGuardar(motor, propuestaGuardable);
    return { tipo: "plan" as const, plan: motor === "3d" ? plan3d : planPython, motor, ...(guardada ? { propuesta: guardada } : {}) };
  };
  assert.equal("propuesta" in widgetDe("python"), false, "el widget de un plan de Python no trae la clave");
  assert.equal("propuesta" in JSON.parse(JSON.stringify(WidgetGuiadoSchema.parse(widgetDe("python")))), false, "ni al guardarse ni al volver");
});

test("un plan del 3D con su propuesta se guarda y se lee igual: por el widget y por la conversación guardada", () => {
  const propuestaGuardable = PropuestaComposicionSchema.parse(propuestaArco);
  const widget = { tipo: "plan" as const, plan: plan3d, motor: "3d" as const, propuesta: propuestaGuardable };
  const leido = WidgetGuiadoSchema.parse(JSON.parse(JSON.stringify(widget)));
  assert.deepEqual(leido.tipo === "plan" ? leido.propuesta : undefined, propuestaGuardable);

  const guardado = { mensajes: [{ id: "m1", role: "assistant" as const, content: "Tu plan", widgets: [widget] }], brief: {}, seleccionadaId: null, uso: null };
  const restaurado = EstadoGuardadoSchema.safeParse(JSON.parse(JSON.stringify(guardado)));
  assert.ok(restaurado.success, "la conversación con la propuesta en el plan no se descarta");
  const widgetRestaurado = restaurado.data.mensajes[0]?.widgets?.[0];
  assert.deepEqual(widgetRestaurado?.tipo === "plan" ? widgetRestaurado.propuesta : undefined, propuestaGuardable);
  assert.deepEqual(widgetRestaurado, { ...widget, motor: "3d" }, "ida y vuelta sin cambiar nada");

  const sinPropuesta = EstadoGuardadoSchema.safeParse({ ...guardado, mensajes: [{ ...guardado.mensajes[0]!, widgets: [{ tipo: "plan", plan: planPython }] }] });
  assert.ok(sinPropuesta.success, "los planes guardados antes (sin propuesta ni motor) siguen leyéndose");
});

test("una propuesta guardada que ya no cumple el esquema se descarta sola: el plan y la conversación se conservan", () => {
  const rota = { frase: "x", colores: ["color-que-no-existe"], piezas: [] };
  const widget = WidgetGuiadoSchema.parse({ tipo: "plan", plan: plan3d, motor: "3d", propuesta: rota });
  assert.equal(widget.tipo === "plan" ? widget.propuesta : "no es un plan", undefined);
  const estado = EstadoGuardadoSchema.safeParse({ mensajes: [{ id: "m1", role: "assistant", content: "Tu plan", widgets: [{ tipo: "plan", plan: plan3d, motor: "3d", propuesta: rota }] }] });
  assert.ok(estado.success, "con `.catch` la conversación no se pierde por ella");
});

test("la armada del plan 3D con el corte puesto publica el aviso (no un error de dibujo) y falla tipado", async () => {
  const avisados: string[] = [];
  const quitar = suscribirCorte3d((hash) => { avisados.push(hash); });
  const firma = { approval_token: "token", plan_hash: "cc".repeat(32), motor: { id: "globos3d", version: "v1" }, espec: {} } as unknown as FirmaPlan;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ error: "No pude", codigo: CODIGO_MOTOR_3D_CORTADO }, { status: 409 })) as typeof fetch;
  try {
    const gestor = crearGestorVista({ red: globalThis.fetch, entorno: { webgl: false, memoriaGb: null, ahorroDatos: false }, visor: () => { throw new Error("sin visor en la prueba"); } });
    await assert.rejects(() => gestor.imagen(firma, { vista: "frente", lado: 256 }), (causa: unknown) => causa instanceof FalloArmada && causa.estado === 409);
    assert.deepEqual(avisados, ["cc".repeat(32)], "el aviso sale con el hash del plan que pidio la vista");
  } finally {
    globalThis.fetch = original;
    quitar();
  }
});

test("un 409 de la armada que no es el corte no publica el aviso", async () => {
  const avisados: string[] = [];
  const quitar = suscribirCorte3d((hash) => { avisados.push(hash); });
  const firma = { approval_token: "token", plan_hash: "dd".repeat(32), motor: { id: "globos3d", version: "v1" }, espec: {} } as unknown as FirmaPlan;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ error: "x", codigo: "PLAN_ALTERADO" }, { status: 409 })) as typeof fetch;
  try {
    const gestor = crearGestorVista({ red: globalThis.fetch, entorno: { webgl: false, memoriaGb: null, ahorroDatos: false }, visor: () => { throw new Error("sin visor en la prueba"); } });
    await assert.rejects(() => gestor.imagen(firma, { vista: "frente", lado: 256 }));
    assert.deepEqual(avisados, []);
  } finally {
    globalThis.fetch = original;
    quitar();
  }
});
