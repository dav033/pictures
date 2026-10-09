/**
 * La vista guiada con un plan del motor 3D (REQ-007, fase 2): los componentes reales renderizan el sobre del motor, la
 * tarjeta no ofrece lo que todavía no existe (vista 3D, imagen, cambios) y el cliente decide el motor al crear el plan.
 * Sin red y sin coste: los sobres vienen de `datos-plan-motor3d.ts` (el motor es solo de servidor) y `fetch` es un doble.
 * - `TarjetaPlan`, `DetalleGlobos`/`TablaGlobosPieza`, `ComprarMateriales` (por `plan-compra`) y `CotizacionPersonalGuiada`
 *   pintan los mismos globos, tamaños, paquetes y total que el motor contó y Python cotizó;
 * - en un plan 3D: «Vista del plan en preparación», sin dibujo de Python, sin «Ajustar», «Modificar» ni «Cambiar algo», y
 *   «Ver cómo quedaría» apagado con una nota honesta; el plan de Python se pinta como siempre;
 * - el cliente: la bandera se lee al crear el plan; un plan de foto va por Python; un plan 3D nunca cae a Python;
 * - `VistaGuiada` no manda a Python la imagen ni los cambios de un plan 3D.
 *
 * Run: npx tsx scripts/test/test-ui-plan-motor3d.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { z } from "zod";
import { CotizacionPlanGuiadoSchema, PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { WidgetGuiadoSchema } from "@/lib/ia/guiado/widgets";
import { TarjetaPlan } from "@/components/guiado/TarjetaPlan";
import { DetalleGlobos } from "@/components/guiado/TablaGlobosPieza";
import { ComprarMateriales } from "@/components/guiado/ComprarMateriales";
import { CotizacionPersonalGuiada } from "@/components/guiado/CotizacionPersonalGuiada";
import { decoracionDePlan } from "@/components/guiado/plan-compra";
import { piezasVistaDePlan, tablaGlobos, titulosDelPlan } from "@/components/guiado/piezas-vista";
import { TEXTO_NOTA_PLAN_3D, TEXTO_VISTA_EN_PREPARACION } from "@/components/guiado/Plan3DEnPreparacion";
import { cuerpoDeIdea, cuerpoDePropuesta, pedirPlanAlMotor3d } from "@/components/guiado/plan-motor3d";
import { TIMEOUT_BANDERA_MS, pedirMotorGuiada, useMotorGuiada } from "@/components/guiado/usarMotorGuiada";

type PlanGuiado = z.infer<typeof PlanGuiadoSchema>;
type Sobre = { id: string; plan: unknown; cotizacion: unknown; globos: number; porPieza: Record<string, number> };

let casos = 0;
async function caso(nombre: string, prueba: () => void | Promise<void>): Promise<void> {
  try { await prueba(); casos += 1; console.log(`[PASS] ${nombre}`); } catch (error) { console.error(`[FAIL] ${nombre}`); throw error; }
}

const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replaceAll("&quot;", "\"").replaceAll("&#x27;", "'").replace(/\s+/g, " ");
const sinAccion = () => undefined;
const sobres: Sobre[] = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/test/datos-plan-motor3d.ts"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })) as Sobre[];
const sobreDe = (id: string) => sobres.find((s) => s.id === id)!;
const planPython = PlanGuiadoSchema.parse(JSON.parse(readFileSync("scripts/test/fixtures/plan-guiado-columnas-repetidas.json", "utf8")));
const entero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

const propiedades = (plan: PlanGuiado, extra: Record<string, unknown> = {}) => ({
  plan, estadoImagen: "nada", usoCosteo: null, compraAbierta: false, vigente: true, ocupado: false, hechas: [], contextoCompra: {},
  onAccion: sinAccion, onCosteo: sinAccion, onProveedores: sinAccion, onDistribuidor: sinAccion, onPlanAjustado: sinAccion, ...extra,
}) as never;

async function main(): Promise<void> {
  await caso("hay sobres de ideas y de oficiales para renderizar, todos válidos", () => {
    assert.ok(sobres.length >= 38, `sobres: ${sobres.length}`);
    for (const s of sobres) {
      PlanGuiadoSchema.parse(s.plan);
      CotizacionPlanGuiadoSchema.parse(s.cotizacion);
      assert.equal(WidgetGuiadoSchema.safeParse({ tipo: "plan", plan: s.plan, motor: "3d", cotizacion: s.cotizacion }).success, true, `${s.id}: el widget del plan 3D es válido`);
    }
  });

  await caso("TarjetaPlan con un plan 3D: las cifras del motor, «Vista del plan en preparación» y nada de Python", () => {
    const s = sobreDe("idea-deco-real-07-eb12910e210c94b6184d025127acce95");
    const plan = PlanGuiadoSchema.parse(s.plan);
    const html = renderToStaticMarkup(createElement(TarjetaPlan, propiedades(plan, { cotizacion: CotizacionPlanGuiadoSchema.parse(s.cotizacion), motor: "3d" })));
    const t = texto(html);
    assert.ok(t.includes(TEXTO_VISTA_EN_PREPARACION), "el marcador de la vista");
    assert.equal(html.split('data-testid="vista-plan-en-preparacion"').length - 1, 1, "una sola vez por tarjeta, no por pieza");
    assert.ok(t.includes(TEXTO_NOTA_PLAN_3D), "la nota honesta");
    assert.ok(t.includes(entero.format(s.globos)) || t.includes(String(s.globos)), `el total de globos (${s.globos})`);
    for (const pieza of plan.plan.estructuras) assert.ok(t.includes(pieza.nombre), `la pieza ${pieza.nombre}`);
    assert.ok(t.includes("2 piezas"), "cuenta las piezas");
    // Lo que no existe todavía no se ofrece.
    assert.ok(!t.includes("Ajustar mi plan"), "sin «Ajustar mi plan»");
    assert.ok(!t.includes("Modificar esta pieza") && !t.includes("Modificar estas piezas"), "sin «Modificar»");
    assert.doesNotMatch(html, /aria-label="Modificar /);
    assert.match(html, /<button[^>]*disabled=""[^>]*>[^]*?Ver cómo quedaría/, "«Ver cómo quedaría» apagado");
    assert.match(html, /<button[^>]*disabled=""[^>]*>[^]*?Cambiar algo/, "«Cambiar algo» apagado");
    // Lo que sí: ver detalle, costear, comprar, aprender y contratar.
    for (const accion of ["Ver detalle", "Cuánto cuesta", "Comprar", "Aprender a hacerlo", "Contratar decorador"]) assert.ok(t.includes(accion), accion);
    // El dibujo del motor de Python (`GraficaMotorGuiada`) ni se monta.
    assert.ok(!html.includes("plan-armado") && !html.includes("plan-dibujo"), "ninguna vista previa de Python");
  });

  await caso("el mismo componente con un plan de Python se pinta como siempre (sin marcador ni nota)", () => {
    const html = renderToStaticMarkup(createElement(TarjetaPlan, propiedades(planPython)));
    const t = texto(html);
    assert.ok(!t.includes(TEXTO_VISTA_EN_PREPARACION) && !t.includes(TEXTO_NOTA_PLAN_3D));
    assert.ok(t.includes("Ajustar mi plan"), "Python conserva «Ajustar mi plan»");
    assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>[^]*?Ver cómo quedaría/);
    const explicito = texto(renderToStaticMarkup(createElement(TarjetaPlan, propiedades(planPython, { motor: "python" }))));
    assert.equal(explicito.includes(TEXTO_NOTA_PLAN_3D), false);
  });

  await caso("«Ver detalle»: la tabla por pieza suma los globos del motor y las flores de globo se cuentan", () => {
    for (const id of ["idea-deco-real-07-eb12910e210c94b6184d025127acce95", "idea-deco-real-28-aro-blanco-dorado-y-nude", "oficial-guirnalda", "oficial-semiarco_asimetrico", "oficial-columna", "oficial-arco"]) {
      const s = sobreDe(id);
      const plan = PlanGuiadoSchema.parse(s.plan);
      const piezas = piezasVistaDePlan(plan);
      assert.deepEqual(piezas.map((p) => tablaGlobos(p.lineas).total), plan.plan.estructuras.map((e) => s.porPieza[e.estructura_id]), `${id}: la tabla de cada pieza`);
      const html = texto(renderToStaticMarkup(createElement(DetalleGlobos, { piezas, total: s.globos })));
      // Las cifras animadas se pintan dos veces en el HTML estático (la visible y la que lee el lector de pantalla).
      if (piezas.length > 1) assert.match(html, new RegExp(`Todo el plan: ${entero.format(s.globos)} ${entero.format(s.globos)} globos`), `${id}: el total del plan`);
      for (const pieza of piezas) assert.ok(html.includes(pieza.nombre));
      // Cada globo con su producto Sempertex del catálogo, no un color genérico.
      assert.ok(piezas.every((p) => p.lineas.every((l) => l.producto !== null)), `${id}: todas las filas nombran el producto Sempertex`);
    }
    const aro = PlanGuiadoSchema.parse(sobreDe("idea-deco-real-28-aro-blanco-dorado-y-nude").plan);
    const [pieza] = piezasVistaDePlan(aro);
    assert.ok(pieza!.flores && pieza!.flores.flores === 2 && pieza!.flores.globos === 14, `las flores del aro: ${JSON.stringify(pieza!.flores)}`);
    assert.match(texto(renderToStaticMarkup(createElement(DetalleGlobos, { piezas: [pieza!], total: sobreDe("idea-deco-real-28-aro-blanco-dorado-y-nude").globos }))), /Incluye las flores de globo: 2 flores \(14 globos de 5″\)/);
  });

  await caso("«Comprar»: cada variante del sobre con su cantidad, y los títulos del catálogo de cada variante", () => {
    const s = sobreDe("idea-deco-real-07-eb12910e210c94b6184d025127acce95");
    const plan = PlanGuiadoSchema.parse(s.plan);
    const cotizacion = CotizacionPlanGuiadoSchema.parse(s.cotizacion);
    const decoracion = decoracionDePlan(plan, cotizacion, { evento: "boda" });
    assert.deepEqual(decoracion.materiales.map((m) => m.variantId).sort(), plan.compras.map((c) => c.variant_id).sort());
    assert.equal(decoracion.materiales.reduce((suma, m) => suma + m.cantidad, 0), s.globos);
    const html = texto(renderToStaticMarkup(createElement(ComprarMateriales, { decoracion, onDistribuidor: sinAccion })));
    assert.ok(html.includes("Lo que necesitas comprar"));
    for (const material of decoracion.materiales) assert.ok(html.includes(String(material.cantidad)), `la cantidad ${material.cantidad}`);
    assert.equal(titulosDelPlan(plan).size, plan.compras.length);
    for (const titulo of titulosDelPlan(plan).values()) assert.match(titulo, /^B2b Globo Latex .+ — .+PAQUETE X \d+/);
  });

  await caso("«Cuánto cuesta» (uso personal): paquetes cerrados, sobrante con la merma y el total que cotizó Python", () => {
    const s = sobreDe("idea-deco-real-07-eb12910e210c94b6184d025127acce95");
    const plan = PlanGuiadoSchema.parse(s.plan);
    const cotizacion = CotizacionPlanGuiadoSchema.parse(s.cotizacion);
    const html = texto(renderToStaticMarkup(createElement(CotizacionPersonalGuiada, { cotizacion: cotizacion as never, titulos: titulosDelPlan(plan) })));
    const formato = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
    assert.ok(html.replaceAll(/\s/g, " ").includes(entero.format(cotizacion.total)), `el total ${formato.format(cotizacion.total)}`);
    assert.ok(html.includes("Total con IVA"));
    const sobrante = cotizacion.lineas.reduce((suma, l) => suma + (l.sobrante ?? 0), 0);
    assert.ok(sobrante > 0 && html.includes(`te sobran ${entero.format(sobrante)}`), "el sobrante (merma + paquete cerrado) se dice");
    const usados = cotizacion.lineas.reduce((suma, l) => suma + l.cantidadNecesaria, 0);
    assert.ok(cotizacion.lineas.reduce((suma, l) => suma + (l.paquetes ?? 0) * (l.unidadesPaquete ?? 0), 0) >= Math.ceil(usados * 1.08), "la compra del plan cubre la reserva del 8 % (una sola para todo el plan)");
    for (const l of cotizacion.lineas) {
      assert.equal(l.cantidadNecesaria + (l.sobrante ?? 0), (l.paquetes ?? 0) * (l.unidadesPaquete ?? 0), `${l.id}: lo usado más lo que sobra es lo que se compra`);
    }
  });

  await caso("pedirPlanAlMotor3d: sobre válido, fallos tipados con su motivo, error del servidor, red caída y plan detenido", async () => {
    const s = sobreDe("idea-deco-real-07-eb12910e210c94b6184d025127acce95");
    const respuesta = (cuerpo: unknown, estado = 200) => async () => new Response(JSON.stringify(cuerpo), { status: estado });
    const propuesta = { frase: "x", colores: ["azul"], piezas: [{ estructura: "arco", cantidad: 1 }] } as never;
    const control = new AbortController();
    const visto: { url?: string; cuerpo?: unknown } = {};
    const ok = await pedirPlanAlMotor3d(cuerpoDePropuesta(propuesta, undefined, null), control.signal, (async (url: string, init: RequestInit) => { visto.url = url; visto.cuerpo = JSON.parse(String(init.body)); return new Response(JSON.stringify({ plan: s.plan, cotizacion: s.cotizacion, nuevas: ["EST_01_COLUMNA"], globosIdea: 87, exacto: true, avisos: [] })); }) as never);
    assert.equal(ok.ok, true);
    assert.equal(visto.url, "/api/guiada/motor/plan");
    assert.deepEqual(visto.cuerpo, { desde: "propuesta", propuesta });
    const fallo = await pedirPlanAlMotor3d(cuerpoDeIdea("deco-real-03-x", null), control.signal, respuesta({ error: "x", codigo: "PLAN_NO_ARMABLE_EN_3D", fallback: { razon: "no_representable", piezas: [{ piezaId: "EST_01_CENTRO_MESA", motivo: "no hay constructor" }] } }, 422) as never);
    assert.deepEqual(fallo.ok ? null : { razon: fallo.razon, estado: fallo.estado }, { razon: "no_representable", estado: 422 });
    const servidor = await pedirPlanAlMotor3d(cuerpoDeIdea("i", null), control.signal, respuesta({ error: "boom", codigo: "ERROR_DEL_MOTOR" }, 500) as never);
    assert.deepEqual(servidor.ok ? null : servidor.razon, "servidor");
    const sinPlan = await pedirPlanAlMotor3d(cuerpoDeIdea("i", null), control.signal, respuesta({ plan: { no: "es un plan" } }) as never);
    assert.deepEqual(sinPlan.ok ? null : sinPlan.razon, "servidor");
    const red = await pedirPlanAlMotor3d(cuerpoDeIdea("i", null), control.signal, (async () => { throw new Error("sin red"); }) as never);
    assert.deepEqual(red.ok ? null : red.razon, "red");
    control.abort();
    const detenido = await pedirPlanAlMotor3d(cuerpoDeIdea("i", null), control.signal, (async () => { throw new DOMException("abortado", "AbortError"); }) as never);
    assert.equal(!detenido.ok && detenido.detenido, true);
  });

  // ── La decisión del cliente: el hook, con `fetch` doble ─────────────────────────────────────────────────────────
  type Hook = ReturnType<typeof useMotorGuiada>;
  function hook(): Hook {
    let capturado: Hook | null = null;
    renderToStaticMarkup(createElement(function Sonda() { capturado = useMotorGuiada(); return null; }));
    return capturado!;
  }
  type Llamada = { url: string; metodo: string; cuerpo: unknown };
  async function conRed(flag: "3d" | "python", rutas: { motor?: () => Response; planIdea?: () => Response }, cuerpo: (llamadas: Llamada[]) => Promise<void>): Promise<void> {
    const original = globalThis.fetch;
    const llamadas: Llamada[] = [];
    globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
      const url = String(entrada);
      llamadas.push({ url, metodo: init?.method ?? "GET", cuerpo: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.startsWith("/api/guiada/motor/plan")) return rutas.motor!();
      if (url.startsWith("/api/guiada/motor")) return Response.json({ motor: flag, fuente: "cookie" });
      if (url.startsWith("/api/plan-idea")) return rutas.planIdea!();
      throw new Error(`ruta inesperada: ${url}`);
    }) as typeof fetch;
    try { await cuerpo(llamadas); } finally { globalThis.fetch = original; }
  }
  const s7 = sobreDe("idea-deco-real-07-eb12910e210c94b6184d025127acce95");
  const planOk = () => Response.json({ plan: s7.plan, cotizacion: s7.cotizacion, nuevas: ["EST_01_COLUMNA", "EST_02_COLUMNA"], globosIdea: 87, exacto: true, avisos: [] });
  const sinConstructor = () => Response.json({ error: "x", codigo: "PLAN_NO_ARMABLE_EN_3D", fallback: { razon: "no_representable", detalle: "figura" } }, { status: 422 });
  const planPythonIdea = () => Response.json({ plan: planPython, cotizacion: undefined, nuevas: [], globosIdea: 40, exacto: true, avisos: [] });
  const propuesta = { frase: "x", colores: ["azul"], piezas: [{ estructura: "arco", cantidad: 1 }] } as never;
  const senal = new AbortController().signal;
  const plan3d = PlanGuiadoSchema.parse(s7.plan);

  await caso("propuesta: la bandera se lee al crear el plan y decide; un plan de foto va por Python sin tocar la red", async () => {
    await conRed("python", {}, async (llamadas) => {
      assert.equal(await hook().planDePropuesta({ propuesta, anterior3d: null, deFoto: false, signal: senal, alFallback: sinAccion }), null);
      assert.deepEqual(llamadas.map((l) => l.url), ["/api/guiada/motor?para=plan_nuevo"], "solo leyó la bandera");
    });
    await conRed("3d", { motor: planOk }, async (llamadas) => {
      const intento = await hook().planDePropuesta({ propuesta, brief: { evento: "boda" }, anterior3d: null, deFoto: false, signal: senal, alFallback: sinAccion });
      assert.equal(intento?.ok, true);
      assert.deepEqual(llamadas.map((l) => `${l.metodo} ${l.url}`), ["GET /api/guiada/motor?para=plan_nuevo", "POST /api/guiada/motor/plan"]);
      assert.deepEqual(llamadas[1]!.cuerpo, { desde: "propuesta", propuesta, brief: { evento: "boda" } });
    });
    await conRed("3d", { motor: planOk }, async (llamadas) => {
      assert.equal(await hook().planDePropuesta({ propuesta, anterior3d: null, deFoto: true, signal: senal, alFallback: sinAccion }), null);
      assert.equal(llamadas.length, 0, "un plan de foto no pregunta nada: va por Python");
    });
  });

  await caso("propuesta: si el 3d no la arma vuelve a Python y deja el motivo, también cuando el plan que se rehace era del 3d (nunca queda el cliente sin plan)", async () => {
    await conRed("3d", { motor: sinConstructor }, async () => {
      const motivos: string[] = [];
      assert.equal(await hook().planDePropuesta({ propuesta, anterior3d: null, deFoto: false, signal: senal, alFallback: (f) => motivos.push(f.razon) }), null, "→ Python");
      assert.deepEqual(motivos, ["no_representable"]);
    });
    await conRed("3d", { motor: sinConstructor }, async (llamadas) => {
      const motivos: string[] = [];
      const intento = await hook().planDePropuesta({ propuesta, anterior3d: plan3d, deFoto: false, signal: senal, alFallback: (f) => motivos.push(f.razon) });
      assert.equal(intento, null, "el plan era del 3d y el 3d ya no puede: se rehace entero con Python");
      assert.deepEqual(motivos, ["no_representable"]);
      assert.equal((llamadas.find((l) => l.url === "/api/guiada/motor/plan")!.cuerpo as { base?: unknown }).base !== undefined, true, "manda el plan vigente como base para verificar su token");
    });
    for (const fallo of [() => Response.json({ error: "x", codigo: "APROBACION_INVALIDA" }, { status: 409 }), () => Response.json({ error: "x", codigo: "ERROR_DEL_MOTOR" }, { status: 500 }), () => { throw new Error("sin red"); }]) {
      await conRed("3d", { motor: fallo }, async () => {
        assert.equal(await hook().planDePropuesta({ propuesta, anterior3d: plan3d, deFoto: false, signal: senal, alFallback: sinAccion }), null, "base rechazada, error del servidor o red caída: Python");
      });
    }
  });

  await caso("marcha atrás inmediata con un plan 3D en pantalla: la bandera en python rehace el plan con Python, sin llamar al 3D", async () => {
    await conRed("python", { motor: planOk, planIdea: planPythonIdea }, async (llamadas) => {
      assert.equal(await hook().planDePropuesta({ propuesta, anterior3d: plan3d, deFoto: false, signal: senal, alFallback: sinAccion }), null, "propuesta → Python");
      const motivos: string[] = [];
      const r = await hook().planDeIdea({ ideaId: "deco-real-07", base: { plan: plan3d, motor: "3d" }, signal: senal, alFallback: (f) => motivos.push(f.razon) });
      assert.deepEqual({ ok: r.ok, motor: r.motor }, { ok: false, motor: "3d" }, "sumar una idea: no se arma en el 3d; quien llama rehace el plan completo desde la propuesta");
      assert.deepEqual(motivos, ["bandera_python"], "el motivo queda dicho");
      assert.equal(llamadas.some((l) => l.url === "/api/guiada/motor/plan" || l.url.startsWith("/api/plan-idea")), false, "ni el 3d ni el plan-idea de Python con un plan del 3d");
    });
  });

  await caso("la bandera no bloquea: se espera como mucho 1 s, «Detener» durante la lectura no arma plan alguno y una señal ya abortada ni pregunta", async () => {
    const colgada = (llamadas: string[]) => ((entrada: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolver, rechazar) => {
      llamadas.push(String(entrada));
      init?.signal?.addEventListener("abort", () => rechazar(new DOMException("abortado", "AbortError")));
    })) as typeof fetch;
    const original = globalThis.fetch;
    // `AbortSignal.timeout` no mantiene vivo el proceso de Node: se mantiene con un temporizador mientras dura la prueba.
    const vivo = setInterval(() => undefined, 20);
    try {
      // Tiempo: sin respuesta en timeoutMs, Python.
      const a: string[] = [];
      globalThis.fetch = colgada(a);
      const inicio = Date.now();
      const lectura = await pedirMotorGuiada({ timeoutMs: 40 });
      assert.deepEqual({ motor: lectura.motor, detenido: lectura.detenido }, { motor: "python", detenido: false });
      assert.ok(Date.now() - inicio < 1000, "no espera más de lo pedido");
      assert.equal(TIMEOUT_BANDERA_MS, 1000, "por defecto, 1 s");
      // «Detener» durante la lectura de un plan por propuesta: detenido, y NO se llama al 3d ni (por quien llama) a Python.
      const b: string[] = [];
      globalThis.fetch = colgada(b);
      const control = new AbortController();
      const pendiente = hook().planDePropuesta({ propuesta, anterior3d: null, deFoto: false, signal: control.signal, alFallback: sinAccion });
      setTimeout(() => control.abort(), 10);
      const intento = await pendiente;
      assert.equal(intento !== null && !intento.ok && intento.detenido, true, "detenido, no «null» (que significaría: sigue con Python)");
      assert.deepEqual(b, ["/api/guiada/motor?para=plan_nuevo"], "solo la lectura de la bandera; ninguna petición de plan");
      // Idem para una idea.
      const c: string[] = [];
      globalThis.fetch = colgada(c);
      const control2 = new AbortController();
      const idea = hook().planDeIdea({ ideaId: "deco-real-07", base: null, signal: control2.signal, alFallback: sinAccion });
      setTimeout(() => control2.abort(), 10);
      const r = await idea;
      assert.equal(!r.ok && r.detenido, true);
      assert.deepEqual(c, ["/api/guiada/motor?para=plan_nuevo"]);
      // Señal ya abortada: ni se pregunta.
      const d: string[] = [];
      globalThis.fetch = colgada(d);
      const abortada = new AbortController();
      abortada.abort();
      const previo = await hook().planDePropuesta({ propuesta, anterior3d: plan3d, deFoto: false, signal: abortada.signal, alFallback: sinAccion });
      assert.equal(previo !== null && !previo.ok && previo.detenido, true);
      assert.equal((await pedirMotorGuiada({ signal: abortada.signal })).detenido, true);
      assert.deepEqual(d, [], "sin ninguna petición");
    } finally {
      clearInterval(vivo);
      globalThis.fetch = original;
    }
  });

  await caso("idea: plan nuevo según la bandera, sumar a un plan según el motor de ESE plan", async () => {
    await conRed("python", { planIdea: planPythonIdea }, async (llamadas) => {
      const r = await hook().planDeIdea({ ideaId: "deco-real-07", base: null, signal: senal, alFallback: sinAccion });
      assert.equal(r.motor, "python");
      assert.deepEqual(llamadas.map((l) => l.url), ["/api/guiada/motor?para=plan_nuevo", "/api/plan-idea"]);
    });
    await conRed("3d", { motor: planOk }, async (llamadas) => {
      const r = await hook().planDeIdea({ ideaId: "deco-real-07", base: null, signal: senal, alFallback: sinAccion });
      assert.equal(r.ok && r.motor, "3d");
      assert.equal(llamadas.some((l) => l.url.startsWith("/api/plan-idea")), false);
    });
    await conRed("3d", { motor: sinConstructor, planIdea: planPythonIdea }, async (llamadas) => {
      const motivos: string[] = [];
      const r = await hook().planDeIdea({ ideaId: "deco-real-03", base: null, signal: senal, alFallback: (f) => motivos.push(f.razon) });
      assert.equal(r.motor, "python", "un plan nuevo que el 3d no arma sale de Python");
      assert.deepEqual(motivos, ["no_representable"]);
      assert.equal(llamadas.filter((l) => l.url.startsWith("/api/plan-idea")).length, 1);
    });
    // Sumar a un plan de Python con la bandera en 3d: sigue en Python (un plan, un dueño de las cantidades).
    await conRed("3d", { planIdea: planPythonIdea }, async (llamadas) => {
      const r = await hook().planDeIdea({ ideaId: "deco-real-07", base: { plan: planPython, motor: "python" }, signal: senal, alFallback: sinAccion });
      assert.equal(r.motor, "python");
      assert.deepEqual(llamadas.map((l) => l.url), ["/api/plan-idea"], "ni lee la bandera");
    });
    // Sumar a un plan del 3d: el 3d si la bandera dice 3d, con el plan vigente como base; si el 3d no puede, quien llama rehace el plan completo.
    await conRed("3d", { motor: planOk }, async (llamadas) => {
      const r = await hook().planDeIdea({ ideaId: "deco-real-07", base: { plan: plan3d, motor: "3d" }, signal: senal, alFallback: sinAccion });
      assert.equal(r.ok && r.motor, "3d");
      assert.deepEqual(llamadas.map((l) => l.url), ["/api/guiada/motor?para=plan_nuevo", "/api/guiada/motor/plan"]);
      assert.equal((llamadas[1]!.cuerpo as { base?: { plan_hash?: string } }).base?.plan_hash, plan3d.plan_hash);
    });
    await conRed("3d", { motor: sinConstructor, planIdea: planPythonIdea }, async (llamadas) => {
      const r = await hook().planDeIdea({ ideaId: "deco-real-21", base: { plan: plan3d, motor: "3d" }, signal: senal, alFallback: sinAccion });
      assert.deepEqual({ ok: r.ok, motor: r.motor }, { ok: false, motor: "3d" });
      assert.equal(llamadas.some((l) => l.url.startsWith("/api/plan-idea")), false, "un plan del 3d no se manda al plan-idea de Python (rechaza su token): se rehace desde la propuesta");
    });
  });

  await caso("VistaGuiada: la imagen y los cambios de un plan 3D no van a Python, y el plan guarda su motor", () => {
    const fuente = readFileSync("src/components/guiado/VistaGuiada.tsx", "utf8");
    assert.match(fuente, /async function verComoQuedaria[\s\S]{0,700}widget\.motor === "3d"[\s\S]{0,200}return;/, "verComoQuedaria se detiene antes de /api/generate");
    assert.match(fuente, /async function aplicarEdicionChat[\s\S]{0,500}\?\.motor === "3d"[\s\S]{0,400}return;/, "los cambios por chat se detienen antes de /api/plan-editar");
    assert.match(fuente, /motor=\{widget\.motor\}/, "la tarjeta recibe el motor del plan");
    assert.match(fuente, /colocarPlan\(mensajeId, resultado\.plan, resultado\.cotizacion, Boolean\(foto\), idea, foto\?\.referenciaId, resultado\.motor\)/, "el plan guarda el motor con que se armó");
    assert.doesNotMatch(fuente, /void leerMotorDelPlan\(\)/, "la lectura de la bandera ya no es solo auditoría");
    const hookFuente = readFileSync("src/components/guiado/usarMotorGuiada.ts", "utf8");
    assert.match(hookFuente, /if \(deFoto\) return null;/);
    assert.match(fuente, /control\.signal\.aborted \|\| \(intento !== null && !intento\.ok && intento\.detenido\)\) return \{ turno, estado: "detenido"/, "Detener durante la lectura de la bandera no sigue con Python");
    assert.match(fuente, /rehechoEnPython: true as const/, "el plan 3D que se rehace con Python lo dice");
    assert.match(fuente, /TEXTO_REHECHO_EN_PYTHON/);
  });

  console.log(`test-ui-plan-motor3d: ok (${casos} pruebas, ${sobres.length} sobres)`);
}

void main().catch((error: unknown) => { console.error(error); process.exit(1); });
