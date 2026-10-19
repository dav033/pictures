import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { crearLimitador } from "./acceso";
import { atenderConsulta } from "./manejadores-registro";
import { baseFalsa, CONTRASENA, dependenciasFalsas, peticion, USUARIO_A, USUARIO_B } from "./pruebas-comunes";

let contrasenaAnterior: string | undefined;
beforeEach(() => {
  contrasenaAnterior = process.env.APP_PASSWORD;
  process.env.APP_PASSWORD = CONTRASENA;
});
afterEach(() => {
  if (contrasenaAnterior === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = contrasenaAnterior;
});

/** GET /api/feedback-ia: la calificación guardada de unos turnos, para mostrarla al recargar (REQ-010). */
const FILA = { turno_id: "t1", calificacion: 7, motivos: ["falto_algo"], comentario: null, deshecho: false };

function baseDeConsulta(filas: unknown[] = [FILA]) {
  return baseFalsa(() => filas);
}

test("devuelve la calificación guardada de cada turno del navegador, sin escenas", async () => {
  const db = baseDeConsulta();
  const respuesta = await atenderConsulta(peticion("/api/feedback-ia?producto=taller&turnos=t1,t2", { usuario: USUARIO_A }), dependenciasFalsas(db));
  assert.equal(respuesta.status, 200);
  assert.deepEqual(await respuesta.json(), {
    ok: true,
    calificaciones: [{ turnoId: "t1", calificacion: 7, motivos: ["falto_algo"], comentario: "", deshecho: false }],
  });
  const consulta = db.consultas[0]!;
  assert.match(consulta.sql, /WHERE usuario_id = \$1::text AND producto = \$2::text AND turno_id = ANY\(\$3::text\[\]\)/);
  assert.deepEqual(consulta.valores, [`nav-${USUARIO_A}`, "taller", ["t1", "t2"]], "solo los turnos de este navegador");
});

test("sin turnos válidos, producto desconocido o más de 100 turnos: 400 y no se toca la base", async () => {
  const casos = [
    "/api/feedback-ia?producto=otro&turnos=t1",
    "/api/feedback-ia?producto=taller",
    "/api/feedback-ia?producto=taller&turnos=t1,,t%20malo",
    `/api/feedback-ia?producto=taller&turnos=${Array.from({ length: 101 }, (_, i) => `t${i}`).join(",")}`,
  ];
  for (const url of casos) {
    const db = baseDeConsulta();
    const respuesta = await atenderConsulta(peticion(url, { usuario: USUARIO_A }), dependenciasFalsas(db));
    assert.equal(respuesta.status, 400, url);
    assert.equal(db.consultas.length, 0, url);
  }
});

test("sin sesión se rechaza antes de tocar la base", async () => {
  const db = baseDeConsulta();
  const respuesta = await atenderConsulta(peticion("/api/feedback-ia?producto=taller&turnos=t1", { conSesion: false }), dependenciasFalsas(db));
  assert.equal(respuesta.status, 401);
  assert.equal(db.consultas.length, 0);
});

test("un navegador sin calificaciones guardadas recibe una lista vacía", async () => {
  const respuesta = await atenderConsulta(peticion("/api/feedback-ia?producto=cliente&turnos=t9", { usuario: USUARIO_A }), dependenciasFalsas(baseDeConsulta([])));
  assert.deepEqual(await respuesta.json(), { ok: true, calificaciones: [] });
});

/** Una base falsa que sí filtra por dueño: guarda filas por (usuario, producto, turno) y responde la consulta de `calificacionesDeTurnos`. */
type FilaGuardada = { usuario: string; producto: string; turno: string; calificacion: number | null; motivos: string[]; comentario: string | null; deshecho: boolean };
function baseConFilas(filas: FilaGuardada[]) {
  return baseFalsa(({ valores }) => {
    const [usuario, producto, turnos] = valores as [string, string, string[]];
    return filas
      .filter((f) => f.usuario === usuario && f.producto === producto && turnos.includes(f.turno))
      .map((f) => ({ turno_id: f.turno, calificacion: f.calificacion, motivos: f.motivos, comentario: f.comentario, deshecho: f.deshecho }));
  });
}

test("aislamiento: cada navegador solo ve sus calificaciones (usuario A no ve las de B, ni al revés)", async () => {
  const db = baseConFilas([
    { usuario: `nav-${USUARIO_A}`, producto: "taller", turno: "t1", calificacion: 9, motivos: [], comentario: null, deshecho: false },
    { usuario: `nav-${USUARIO_B}`, producto: "taller", turno: "t1", calificacion: 2, motivos: ["colores"], comentario: "rojo", deshecho: false },
  ]);
  const deps = dependenciasFalsas(db);
  const a = (await (await atenderConsulta(peticion("/api/feedback-ia?producto=taller&turnos=t1", { usuario: USUARIO_A }), deps)).json()) as { calificaciones: Array<{ calificacion: number }> };
  const b = (await (await atenderConsulta(peticion("/api/feedback-ia?producto=taller&turnos=t1", { usuario: USUARIO_B }), deps)).json()) as { calificaciones: Array<{ calificacion: number; comentario: string }> };
  assert.deepEqual(a.calificaciones.map((c) => c.calificacion), [9]);
  assert.deepEqual(b.calificaciones.map((c) => [c.calificacion, c.comentario]), [[2, "rojo"]]);
  const nuevo = (await (await atenderConsulta(peticion("/api/feedback-ia?producto=taller&turnos=t1", { usuario: "c".repeat(32) }), deps)).json()) as { calificaciones: unknown[] };
  assert.deepEqual(nuevo.calificaciones, []);
});

test("el GET no cambia el dueño ni se cachea: Cache-Control private, no-store también en los errores", async () => {
  const db = baseConFilas([]);
  const ok = await atenderConsulta(peticion("/api/feedback-ia?producto=taller&turnos=t1", { usuario: USUARIO_A }), dependenciasFalsas(db));
  assert.equal(ok.headers.get("cache-control"), "private, no-store");
  const malo = await atenderConsulta(peticion("/api/feedback-ia?producto=taller", { usuario: USUARIO_A }), dependenciasFalsas(db));
  assert.equal(malo.headers.get("cache-control"), "private, no-store");
  const sinSesion = await atenderConsulta(peticion("/api/feedback-ia?producto=taller&turnos=t1", { conSesion: false }), dependenciasFalsas(db));
  assert.equal(sinSesion.headers.get("cache-control"), "private, no-store");
});

test("Set-Cookie: un navegador nuevo recibe su cookie en el GET; uno conocido no la recibe otra vez", async () => {
  const deps = dependenciasFalsas(baseDeConsulta([]));
  const nuevo = await atenderConsulta(peticion("/api/feedback-ia?producto=taller&turnos=t1", { conSesion: true }), deps);
  assert.match(nuevo.headers.get("set-cookie") ?? "", /^feedback_usuario=[0-9a-f]{32}; Path=\/; HttpOnly; SameSite=Lax/);
  const conocido = await atenderConsulta(peticion("/api/feedback-ia?producto=taller&turnos=t1", { usuario: USUARIO_A }), deps);
  assert.equal(conocido.headers.get("set-cookie"), null);
});

test("403 con otro origen y 503 cuando la base falla; ambos sin tocar nada más", async () => {
  const db = baseDeConsulta([]);
  const otro = await atenderConsulta(peticion("/api/feedback-ia?producto=taller&turnos=t1", { usuario: USUARIO_A, cabeceras: { origin: "https://malo.test" } }), dependenciasFalsas(db));
  assert.equal(otro.status, 403);
  const rota = baseFalsa(() => { throw new Error("base caída"); });
  const deps = dependenciasFalsas(rota);
  const caida = await atenderConsulta(peticion("/api/feedback-ia?producto=taller&turnos=t1", { usuario: USUARIO_A }), deps);
  assert.equal(caida.status, 503);
  assert.equal(((await caida.json()) as { codigo: string }).codigo, "BASE_NO_DISPONIBLE");
  assert.deepEqual(deps.fallos, ["feedback_ia.consulta"]);
});

test("un límite de lecturas por IP da 429 y no toca la base", async () => {
  const db = baseDeConsulta([]);
  const deps = dependenciasFalsas(db, { limitadorConsulta: crearLimitador(1) });
  assert.equal((await atenderConsulta(peticion("/api/feedback-ia?producto=taller&turnos=t1", { usuario: USUARIO_A }), deps)).status, 200);
  const segunda = await atenderConsulta(peticion("/api/feedback-ia?producto=taller&turnos=t1", { usuario: USUARIO_A }), deps);
  assert.equal(segunda.status, 429);
  assert.equal(db.consultas.length, 1);
});
