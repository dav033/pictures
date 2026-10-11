/**
 * La agregación y los umbrales del pulso de producción (`scripts/lib/pulso/pulso-produccion.ts`), con filas en memoria: sin base,
 * red ni reloj.
 *
 * Run: npx tsx scripts/test/test-pulso-produccion.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluarAlertas, formatearPulso, resumirPulso, ultimoDespliegueDeProduccion,
  type DatosPulso, type FilaFeedback, type FilaLlamada, type FilaPlan,
} from "../lib/pulso/pulso-produccion";

const AHORA = new Date("2026-10-11T15:30:00Z");
const feedback = (producto: string, calificacion: number | null, cuantos = 1, extra: Partial<FilaFeedback> = {}): FilaFeedback => ({ producto, propio: false, calificacion, deshecho: false, cuantos, ...extra });
const plan = (estado: string, motor: string, cuantos = 1, razon = ""): FilaPlan => ({ estado, motor, razon, cuantos });
const llamada = (proveedor: string, resultado: string, cuantos = 1, extra: Partial<FilaLlamada> = {}): FilaLlamada => ({ proveedor, modelo: "m1", superficie: "/api/x", resultado, propio: proveedor === "anthropic", cuantos, coste: 0, moneda: null, ...extra });
const sano = (extra: Partial<DatosPulso> = {}): DatosPulso => ({ horas: 6, incluirPropio: false, feedback: [], plan: [], llamadas: [], login: 200, despliegue: { estado: "Ready", edad: "2h" }, ...extra });
const alertasDe = (datos: DatosPulso) => evaluarAlertas(resumirPulso(datos));

test("sin nada que reportar no hay alertas", () => {
  assert.deepEqual(alertasDe(sano()), []);
});

test("feedback: turnos, calificados, promedio, distribución, ≤4 y deshechos por superficie", () => {
  const resumen = resumirPulso(sano({ feedback: [feedback("cliente", 8, 2), feedback("cliente", 3), feedback("cliente", null, 4), feedback("cliente", 2, 1, { deshecho: true }), feedback("taller", 10)] }));
  const cliente = resumen.feedback.find((s) => s.producto === "cliente")!;
  assert.deepEqual({ ...cliente }, { producto: "cliente", turnos: 8, calificados: 4, promedio: 5.25, distribucion: { 2: 1, 3: 1, 8: 2 }, bajas: 2, deshechos: 1 });
  assert.equal(resumen.feedback.find((s) => s.producto === "taller")!.promedio, 10);
  assert.equal(resumen.calificadosGeneral, 5);
});

test("promedio < 6 con al menos 3 calificaciones alerta; con 2 no, y con 6 justo no", () => {
  assert.equal(alertasDe(sano({ feedback: [feedback("cliente", 5, 3)] })).length, 1);
  assert.match(alertasDe(sano({ feedback: [feedback("cliente", 5, 3)] }))[0]!, /promedio 5 con 3/);
  assert.deepEqual(alertasDe(sano({ feedback: [feedback("cliente", 1, 2)] })), [], "dos calificaciones no bastan");
  assert.deepEqual(alertasDe(sano({ feedback: [feedback("cliente", 6, 3)] })), [], "6 no es menor que 6");
});

test("lo propio no cuenta: ni la calificación de una sesión +local ni las llamadas de anthropic, que van aparte", () => {
  const datos = sano({
    feedback: [feedback("cliente", 1, 10, { propio: true }), feedback("cliente", 9, 3)],
    llamadas: [llamada("anthropic", "error", 20), llamada("anthropic", "ok", 5), llamada("gemini", "ok", 4, { coste: 0.5, moneda: "USD" })],
  });
  const resumen = resumirPulso(datos);
  assert.deepEqual(alertasDe(datos), []);
  assert.equal(resumen.promedioGeneral, 9);
  assert.equal(resumen.erroresLlamadas, 0);
  assert.equal(resumen.llamadas.length, 1);
  assert.deepEqual(resumen.propio, { turnos: 10, llamadas: 25, erroresLlamadas: 20 });
  assert.match(formatearPulso(resumen, [], AHORA).join("\n"), /PROPIO \(no cuenta\): 10 turnos locales; 25 llamadas de anthropic \(20 con error\)/);
});

test("--incluir-propio mete lo propio en las cuentas y las alertas, y quita la línea aparte", () => {
  const datos = sano({ incluirPropio: true, feedback: [feedback("cliente", 1, 10, { propio: true })], llamadas: [llamada("anthropic", "error", 6)] });
  const resumen = resumirPulso(datos);
  assert.equal(resumen.promedioGeneral, 1);
  assert.equal(resumen.erroresLlamadas, 6);
  assert.equal(alertasDe(datos).length, 2);
  assert.doesNotMatch(formatearPulso(resumen, [], AHORA).join("\n"), /PROPIO \(no cuenta\)/);
});

test("errores 5xx: más de 5 entre plan_audit_log y ai_call_log alerta; 5 justo no; cancelado y los rechazos esperados no cuentan", () => {
  const cinco = sano({ plan: [plan("PLAN_3D_FALLBACK", "python", 3, "error_inesperado")], llamadas: [llamada("gemini", "error", 1), llamada("fal", "timeout", 1)] });
  assert.equal(resumirPulso(cinco).erroresPlan + resumirPulso(cinco).erroresLlamadas, 5);
  assert.deepEqual(alertasDe(cinco), []);
  const seis = sano({ plan: [plan("PLAN_3D_FALLBACK", "python", 3, "error_inesperado"), plan("ERROR", "n/d", 1)], llamadas: [llamada("gemini", "error", 1), llamada("fal", "timeout", 1)] });
  assert.match(alertasDe(seis)[0]!, /6 filas de error \(plan_audit_log 4 \+ ai_call_log 2\)/);
  const esperados = sano({ plan: [plan("PLAN_3D_FALLBACK", "python", 40, "precio_fallido"), plan("PLAN_3D_EDICION_RECHAZADA", "3d", 40)], llamadas: [llamada("gemini", "cancelado", 40)] });
  assert.deepEqual(alertasDe(esperados), []);
});

test("PLAN_3D_FALLBACK con `bandera_timeout` o `bandera_error` alerta; `bandera_python` (la bandera dijo python) no", () => {
  assert.deepEqual(alertasDe(sano({ plan: [plan("PLAN_3D_FALLBACK", "python", 40, "bandera_python")] })), []);
  const alertas = alertasDe(sano({ plan: [plan("PLAN_3D_FALLBACK", "python", 2, "bandera_timeout"), plan("PLAN_3D_FALLBACK", "python", 1, "bandera_error")] }));
  assert.deepEqual(alertas, ["1 planes de la guiada cayeron a Python sin leer la bandera (bandera_error).", "2 planes de la guiada cayeron a Python sin leer la bandera (bandera_timeout)."]);
});

test("/login: 200 y 307 son sanos; cualquier otro estado o ninguna respuesta alerta", () => {
  for (const login of [200, 307]) assert.deepEqual(alertasDe(sano({ login })), [], String(login));
  for (const login of [302, 404, 500, 503]) assert.match(alertasDe(sano({ login }))[0]!, new RegExp(`/login respondió ${login}`), String(login));
  assert.match(alertasDe(sano({ login: null }))[0]!, /respondió nada/);
});

test("plan_audit_log agrupa por estado y motor; ai_call_log suma el coste estimado por moneda", () => {
  const resumen = resumirPulso(sano({
    plan: [plan("PLAN_3D_CREADO", "3d", 2), plan("PLAN_3D_CREADO", "3d", 3, "x"), plan("PLAN_3D_FALLBACK", "python", 1, "sin_cobertura")],
    llamadas: [llamada("gemini", "ok", 2, { coste: 0.25, moneda: "USD" }), llamada("gemini", "error", 1, { coste: 0.0, moneda: "USD" }), llamada("gemini", "ok", 1, { superficie: "/api/y", coste: 0.5, moneda: "USD" })],
  }));
  assert.deepEqual(resumen.plan, [{ estado: "PLAN_3D_CREADO", motor: "3d", cuantos: 5 }, { estado: "PLAN_3D_FALLBACK", motor: "python", cuantos: 1 }]);
  assert.deepEqual(resumen.costeTotal, { USD: 0.75 });
  assert.deepEqual(resumen.llamadas.map((g) => [g.clave, g.llamadas, g.errores]), [["gemini/m1 · /api/x", 3, 1], ["gemini/m1 · /api/y", 1, 0]]);
});

test("el informe cabe en 30 líneas con muchas filas, solo trae agregados y marca el estado", () => {
  const muchas = sano({
    feedback: ["a", "b", "c", "d", "e", "f"].map((p) => feedback(p, 9)),
    plan: Array.from({ length: 20 }, (_, i) => plan(`ESTADO_${i}`, "3d", 20 - i)),
    llamadas: Array.from({ length: 20 }, (_, i) => llamada("gemini", "ok", 20 - i, { modelo: `m${i}` })),
    login: 500,
  });
  const resumen = resumirPulso(muchas);
  const lineas = formatearPulso(resumen, evaluarAlertas(resumen), AHORA);
  assert.ok(lineas.length <= 30, `${lineas.length} líneas`);
  assert.ok(lineas.includes("ESTADO: ALERTA"));
  assert.ok(lineas.some((l) => l.startsWith("ALERTA: ")));
  assert.ok(lineas.some((l) => /\+\d+ más/.test(l)));
  assert.ok(formatearPulso(resumirPulso(sano()), [], AHORA).includes("ESTADO: sano"));
});

test("el despliegue de producción más reciente sale de la tabla de `vercel ls`, sin tomar los de preview ni la URL", () => {
  const tabla = [
    "  Age     Project                              Deployment                                                        Status      Environment     Duration     Username     ",
    "  7m      dav033s-projects/demo-decoracion     https://demo-decoracion-aaa-dav033s-projects.vercel.app     ● Ready     Preview         51s          dav033       ",
    "  2h      dav033s-projects/demo-decoracion     https://demo-decoracion-bbb-dav033s-projects.vercel.app     ● Error     Production      2m           dav033       ",
    "  3h      dav033s-projects/demo-decoracion     https://demo-decoracion-ccc-dav033s-projects.vercel.app     ● Ready     Production      1m           dav033       ",
  ].join("\n");
  assert.deepEqual(ultimoDespliegueDeProduccion(tabla), { edad: "2h", estado: "Error" });
  assert.equal(ultimoDespliegueDeProduccion("Error: not logged in"), null);
});
