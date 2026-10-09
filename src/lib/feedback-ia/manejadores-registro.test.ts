import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { ErrorAlmacen } from "@/lib/almacen/objetos-s3";
import { crearLimitador } from "./acceso";
import { TOPE_CAPTURA_BYTES, TOPE_ESCENAS_CONVERSACION_BYTES, TOPE_TURNOS_CONVERSACION, type RespuestaFeedback } from "./contrato";
import { atenderCaptura, atenderRegistro } from "./manejadores-registro";
import { CONTRASENA, USUARIO_A, USUARIO_B, almacenFalso, baseFalsa, dependenciasFalsas, peticion, peticionJson } from "./pruebas-comunes";

/** Orden de los parámetros de la sentencia de `guardar` (ver repositorio.ts). */
const PARAMETROS = [
  "turnoId", "producto", "usuarioId", "calificacion", "motivos", "comentario", "deshecho", "pedido", "respuesta", "solicitudId",
  "conversacionId", "herramientas", "pasos", "pasosFuente", "modelo", "costeUsd", "latenciaMs", "versionApp", "escenaAntes", "escenaDespues", "diferencia",
] as const;
type Parche = Record<(typeof PARAMETROS)[number], unknown>;

/**
 * Doble de la base: anota los parámetros de cada escritura y emula solo el dueño (WHERE usuario_id) y `creado`. La mezcla
 * por COALESCE es SQL y se prueba contra Postgres real en feedback-sql.test.ts.
 */
function baseDeRegistro(opciones: { turnosEnConversacion?: number; bytesEscenas?: number } = {}) {
  const duenos = new Map<string, string>();
  const escrituras: Parche[] = [];
  const db = baseFalsa(({ sql, valores }) => {
    if (sql.includes("WITH filas")) return [{ turnos: String(opciones.turnosEnConversacion ?? 0), bytes: String(opciones.bytesEscenas ?? 0), existe: false }];
    if (sql.startsWith("SELECT usuario_id")) {
      const dueno = duenos.get(`${valores[0]}/${valores[1]}`);
      return dueno ? [{ usuario_id: dueno }] : [];
    }
    if (sql.includes("INSERT INTO ai_feedback (turno_id, producto, usuario_id, calificacion")) {
      const jsonb = new Set(["pasos", "escenaAntes", "escenaDespues", "diferencia"]);
      const parche = Object.fromEntries(PARAMETROS.map((nombre, i) => [nombre, jsonb.has(nombre) && typeof valores[i] === "string" ? JSON.parse(valores[i] as string) : valores[i]])) as Parche;
      const clave = `${parche.producto}/${parche.turnoId}`;
      const dueno = duenos.get(clave);
      if (dueno && dueno !== parche.usuarioId) return [];
      duenos.set(clave, parche.usuarioId as string);
      escrituras.push(parche);
      return [{ id: "1", creado: !dueno, calificacion: parche.calificacion, actualizado_en: new Date() }];
    }
    if (sql.includes("INSERT INTO ai_feedback (turno_id, producto, usuario_id, imagen_")) {
      const [turno, producto, usuario] = valores as string[];
      const dueno = duenos.get(`${producto}/${turno}`);
      if (dueno && dueno !== usuario) return { rows: [], rowCount: 0 };
      duenos.set(`${producto}/${turno}`, usuario);
      return { rows: [], rowCount: 1 };
    }
    return undefined;
  });
  return { db, escrituras, duenos };
}

let contrasenaAnterior: string | undefined;
beforeEach(() => {
  contrasenaAnterior = process.env.APP_PASSWORD;
  process.env.APP_PASSWORD = CONTRASENA;
});
afterEach(() => {
  if (contrasenaAnterior === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = contrasenaAnterior;
});

const BASE = { turnoId: "turno-1", producto: "taller" as const };
const ESCENA_ANTES = { sala: { ancho: 5 }, nodos: [{ id: "a", x: 1 }, { id: "b", x: 2 }] };
const ESCENA_DESPUES = { sala: { ancho: 5 }, nodos: [{ id: "a", x: 9 }, { id: "c", x: 3 }] };

test("sin sesión o con otro origen se rechaza antes de tocar la base", async () => {
  const { db } = baseDeRegistro();
  const deps = dependenciasFalsas(db);
  const sinSesion = await atenderRegistro(peticionJson("/api/feedback-ia", BASE, { conSesion: false }), deps);
  assert.equal(sinSesion.status, 401);
  assert.equal(((await sinSesion.json()) as { codigo: string }).codigo, "SESION_REQUERIDA");
  const otroOrigen = await atenderRegistro(peticionJson("/api/feedback-ia", BASE, { cabeceras: { origin: "https://malo.test" } }), deps);
  assert.equal(otroOrigen.status, 403);
  assert.equal(db.consultas.length, 0);
});

test("valida con zod: motivos desconocidos, calificación fuera de rango, pasos mal formados y propiedades de más", async () => {
  const deps = dependenciasFalsas(baseDeRegistro().db);
  for (const malo of [
    { ...BASE, calificacion: 11 }, { ...BASE, calificacion: 0 }, { ...BASE, calificacion: 5.5 },
    { ...BASE, motivos: ["inventado"] }, { ...BASE, turnoId: "../etc" }, { ...BASE, producto: "otro" }, { ...BASE, extra: true },
    { ...BASE, comentario: "x".repeat(2001) },
    { ...BASE, pasos: [{ nombre: "", ok: true }] },
    { ...BASE, pasos: [{ nombre: "colocar", ok: "si" }] },
    { ...BASE, pasos: Array.from({ length: 101 }, () => ({ nombre: "x", ok: true })) },
    { ...BASE, pasos: [{ nombre: "x", ok: true, resumen: "y".repeat(301) }] },
  ]) {
    const respuesta = await atenderRegistro(peticionJson("/api/feedback-ia", malo), deps);
    assert.equal(respuesta.status, 400, JSON.stringify(malo).slice(0, 80));
    assert.equal(((await respuesta.json()) as { codigo: string }).codigo, "CUERPO_INVALIDO");
  }
});

test("topes de tamaño: una escena de más de 400 kB y un cuerpo de más de 1 MB dan 413, no 400 ni 503", async () => {
  const deps = dependenciasFalsas(baseDeRegistro().db);
  const escenaGrande = { nodos: [{ id: "a", relleno: "x".repeat(400_001) }] };
  const respuesta = await atenderRegistro(peticionJson("/api/feedback-ia", { ...BASE, calificacion: 3, escenaAntes: escenaGrande }), deps);
  assert.equal(respuesta.status, 413);
  assert.equal(((await respuesta.json()) as { codigo: string }).codigo, "CUERPO_DEMASIADO_GRANDE");
  const enorme = await atenderRegistro(peticion("/api/feedback-ia", { metodo: "POST", cuerpo: "x".repeat(1_000_001), cabeceras: { "content-type": "application/json" } }), deps);
  assert.equal(enorme.status, 413);
});

test("una violación de CHECK de la base (campo que la validación dejó pasar) también es 413", async () => {
  const caida = baseFalsa(() => { throw Object.assign(new Error("new row violates check constraint"), { code: "23514" }); });
  const respuesta = await atenderRegistro(peticionJson("/api/feedback-ia", BASE), dependenciasFalsas(caida));
  assert.equal(respuesta.status, 413);
});

test("el registro entrega una cookie de navegador (httpOnly, SameSite=Lax) la primera vez y no la repite", async () => {
  const { db } = baseDeRegistro();
  const deps = dependenciasFalsas(db);
  const primera = await atenderRegistro(peticionJson("/api/feedback-ia", BASE), deps);
  const cookie = primera.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^feedback_usuario=[0-9a-f]{32}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+/);
  const segunda = await atenderRegistro(peticionJson("/api/feedback-ia", BASE, { usuario: USUARIO_A }), deps);
  assert.equal(segunda.headers.get("set-cookie"), null);
  const cookieInvalida = await atenderRegistro(peticionJson("/api/feedback-ia", BASE, { usuario: "no-vale" }), deps);
  assert.match(cookieInvalida.headers.get("set-cookie") ?? "", /^feedback_usuario=[0-9a-f]{32};/);
});

test("el turno es del navegador que lo creó: otro navegador recibe TURNO_AJENO y el mismo puede seguir calificando", async () => {
  const { db, escrituras } = baseDeRegistro();
  const deps = dependenciasFalsas(db);
  assert.equal((await atenderRegistro(peticionJson("/api/feedback-ia", BASE, { usuario: USUARIO_A }), deps)).status, 201);
  const intruso = await atenderRegistro(peticionJson("/api/feedback-ia", { ...BASE, calificacion: 1 }, { usuario: USUARIO_B }), deps);
  assert.equal(intruso.status, 403);
  assert.equal(((await intruso.json()) as { codigo: string }).codigo, "TURNO_AJENO");
  const dueno = await atenderRegistro(peticionJson("/api/feedback-ia", { ...BASE, calificacion: 6 }, { usuario: USUARIO_A }), deps);
  assert.equal(dueno.status, 200);
  assert.equal(((await dueno.json()) as RespuestaFeedback).calificacion, 6);
  assert.deepEqual(escrituras.map((e) => [e.usuarioId, e.calificacion]), [[`nav-${USUARIO_A}`, null], [`nav-${USUARIO_A}`, 6]]);
});

test("el parche solo lleva lo que la petición trae (null = no enviado) y deduplica motivos", async () => {
  const { db, escrituras } = baseDeRegistro();
  const deps = dependenciasFalsas(db);
  await atenderRegistro(peticionJson("/api/feedback-ia", { ...BASE, calificacion: 3, motivos: ["colores", "colores", "mal_colocado"], comentario: "torcido" }), deps);
  const [parche] = escrituras;
  assert.equal(parche.calificacion, 3);
  assert.deepEqual(parche.motivos, ["colores", "mal_colocado"]);
  assert.equal(parche.pedido, null);
  assert.equal(parche.deshecho, null);
  assert.equal(parche.versionApp, "abc123");
  assert.equal(parche.pasos, null);
});

test("las escenas solo se guardan si la misma petición califica, deshace o comenta, y la diferencia se calcula", async () => {
  const { db, escrituras } = baseDeRegistro();
  const deps = dependenciasFalsas(db);
  const sinValorar = await atenderRegistro(peticionJson("/api/feedback-ia", { ...BASE, pedido: "pon un arco", escenaAntes: ESCENA_ANTES, escenaDespues: ESCENA_DESPUES }), deps);
  assert.equal(((await sinValorar.json()) as RespuestaFeedback).escenasGuardadas, false);
  assert.equal(escrituras[0].escenaAntes, null);
  assert.equal(escrituras[0].diferencia, null);
  assert.equal(escrituras[0].pedido, "pon un arco");

  for (const [i, valoracion] of [{ calificacion: 4 }, { deshecho: true }, { comentario: "mal" }].entries()) {
    const respuesta = await atenderRegistro(peticionJson("/api/feedback-ia", { ...BASE, turnoId: `v${i}`, ...valoracion, escenaAntes: ESCENA_ANTES, escenaDespues: ESCENA_DESPUES }), deps);
    assert.equal(((await respuesta.json()) as RespuestaFeedback).escenasGuardadas, true, JSON.stringify(valoracion));
  }
  const ultima = escrituras[escrituras.length - 1];
  assert.deepEqual(ultima.escenaDespues, ESCENA_DESPUES);
  assert.deepEqual(ultima.diferencia, { agregados: ["c"], quitados: ["b"], modificados: [{ id: "a", campos: ["x"] }], otros: [] });

  const comentarioVacio = await atenderRegistro(peticionJson("/api/feedback-ia", { ...BASE, turnoId: "vacio", comentario: "", escenaAntes: ESCENA_ANTES }), deps);
  assert.equal(((await comentarioVacio.json()) as RespuestaFeedback).escenasGuardadas, false);
});

test("topes por conversación: demasiados turnos dan 429 y demasiados bytes de escenas se descartan sin fallar", async () => {
  const lleno = dependenciasFalsas(baseDeRegistro({ turnosEnConversacion: TOPE_TURNOS_CONVERSACION }).db);
  const rechazo = await atenderRegistro(peticionJson("/api/feedback-ia", { ...BASE, conversacionId: "conv-1" }), lleno);
  assert.equal(rechazo.status, 429);
  assert.equal(((await rechazo.json()) as { codigo: string }).codigo, "CONVERSACION_LLENA");

  const { db, escrituras } = baseDeRegistro({ bytesEscenas: TOPE_ESCENAS_CONVERSACION_BYTES - 10 });
  const respuesta = await atenderRegistro(peticionJson("/api/feedback-ia", { ...BASE, conversacionId: "conv-1", calificacion: 2, escenaAntes: ESCENA_ANTES, escenaDespues: ESCENA_DESPUES }), dependenciasFalsas(db));
  assert.equal(respuesta.status, 201);
  assert.equal(((await respuesta.json()) as RespuestaFeedback).escenasGuardadas, false);
  assert.equal(escrituras[0].escenaAntes, null);
  assert.equal(escrituras[0].calificacion, 2);
});

test("los pasos del navegador se guardan como fuente «cliente» y mandan sobre la auditoría del servidor", async () => {
  const { db, escrituras } = baseDeRegistro();
  let lecturas = 0;
  const deps = dependenciasFalsas(db, {
    servicio: () => ({ db, versionApp: () => "v1", leerPasos: async () => { lecturas += 1; return [{ ts: "t", tipo: "herramienta", nombre: "del_servidor", resumen: "" }]; } }),
  });
  await atenderRegistro(peticionJson("/api/feedback-ia", { ...BASE, solicitudId: "req-1", conversacionId: "conv-1", pasos: [{ nombre: "colocar_pieza", ok: true, resumen: "arco azul", ms: 40 }, { nombre: "pintar", ok: false }] }), deps);
  assert.equal(lecturas, 0);
  assert.equal(escrituras[0].pasosFuente, "cliente");
  assert.deepEqual(escrituras[0].herramientas, ["colocar_pieza", "pintar"]);
  assert.deepEqual((escrituras[0].pasos as { nombre: string; ok: boolean }[]).map((p) => [p.nombre, p.ok]), [["colocar_pieza", true], ["pintar", false]]);
});

test("sin pasos del navegador se intenta la auditoría del servidor (mejor esfuerzo) y se marca «servidor»; sin ellos, null", async () => {
  const { db, escrituras } = baseDeRegistro();
  const conAuditoria = dependenciasFalsas(db, {
    servicio: () => ({ db, versionApp: () => "v1", leerPasos: async () => [{ ts: "t", tipo: "herramienta", nombre: "colocar", resumen: "" }] }),
  });
  await atenderRegistro(peticionJson("/api/feedback-ia", { ...BASE, turnoId: "s1", solicitudId: "req-1", conversacionId: "conv-1" }), conAuditoria);
  assert.equal(escrituras[0].pasosFuente, "servidor");
  await atenderRegistro(peticionJson("/api/feedback-ia", { ...BASE, turnoId: "s2", solicitudId: "req-2", conversacionId: "conv-1" }), dependenciasFalsas(db));
  assert.equal(escrituras[1].pasos, null);
  assert.equal(escrituras[1].pasosFuente, null);
});

test("el tope por minuto devuelve 429 y un fallo de base 503 sin filtrar el error", async () => {
  const { db } = baseDeRegistro();
  const limitado = dependenciasFalsas(db, { limitadorRegistro: crearLimitador(1) });
  assert.equal((await atenderRegistro(peticionJson("/api/feedback-ia", BASE), limitado)).status, 201);
  assert.equal((await atenderRegistro(peticionJson("/api/feedback-ia", BASE), limitado)).status, 429);

  const caida = baseFalsa(() => { throw new Error("password authentication failed for user secreto"); });
  const deps = dependenciasFalsas(caida);
  const respuesta = await atenderRegistro(peticionJson("/api/feedback-ia", BASE), deps);
  assert.equal(respuesta.status, 503);
  assert.ok(!JSON.stringify(await respuesta.json()).includes("secreto"));
  assert.deepEqual(deps.fallos, ["feedback_ia.registro"]);
});

/* ---------- Capturas ---------- */

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(7)]);

function formulario(campos: Record<string, string>, archivo?: Uint8Array, tipo = "image/jpeg"): FormData {
  const datos = new FormData();
  for (const [clave, valor] of Object.entries(campos)) datos.set(clave, valor);
  if (archivo) datos.set("imagen", new Blob([Buffer.from(archivo)], { type: tipo }), "captura.jpg");
  return datos;
}

const CAMPOS = { turnoId: "turno-1", producto: "taller", momento: "antes" };
const subir = (cuerpo: FormData, extra: Parameters<typeof peticion>[1] = {}) => peticion("/api/feedback-ia/capturas", { metodo: "POST", cuerpo, ...extra });

test("sube la captura al almacén con clave por producto/turno/momento y guarda solo la clave", async () => {
  const { db } = baseDeRegistro();
  const almacen = almacenFalso();
  const deps = dependenciasFalsas(db, { almacen: () => almacen });
  const respuesta = await atenderCaptura(subir(formulario(CAMPOS, JPEG)), deps);
  assert.equal(respuesta.status, 200);
  assert.deepEqual([...almacen.objetos.keys()], ["feedback/taller/turno-1/antes.jpg"]);
  assert.equal(almacen.objetos.get("feedback/taller/turno-1/antes.jpg")!.tipo, "image/jpeg");
  assert.ok(!JSON.stringify(await respuesta.clone().json()).includes("feedback/"), "la respuesta no revela la clave del almacén");
  const insercion = db.consultas.find((c) => c.sql.includes("imagen_antes"))!;
  assert.equal(insercion.valores[3], "feedback/taller/turno-1/antes.jpg");
});

test("otro navegador no puede sobrescribir la captura de un turno ajeno (no llega a tocar el almacén)", async () => {
  const { db } = baseDeRegistro();
  const almacen = almacenFalso();
  const deps = dependenciasFalsas(db, { almacen: () => almacen });
  assert.equal((await atenderCaptura(subir(formulario(CAMPOS, JPEG), { usuario: USUARIO_A }), deps)).status, 200);
  const antes = [...almacen.objetos.values()][0].modificado;
  const intruso = await atenderCaptura(subir(formulario(CAMPOS, new Uint8Array([0xff, 0xd8, 0xff, 9, 9, 9])), { usuario: USUARIO_B }), deps);
  assert.equal(intruso.status, 403);
  assert.equal([...almacen.objetos.values()][0].cuerpo.length, JPEG.length);
  assert.equal([...almacen.objetos.values()][0].modificado, antes);
});

test("rechaza capturas de más de 600 KB, que no son JPEG o sin archivo", async () => {
  const { db } = baseDeRegistro();
  const almacen = almacenFalso();
  const deps = dependenciasFalsas(db, { almacen: () => almacen });
  const grande = new Uint8Array(TOPE_CAPTURA_BYTES + 1);
  grande.set([0xff, 0xd8, 0xff]);
  assert.equal((await atenderCaptura(subir(formulario(CAMPOS, grande)), deps)).status, 413);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const noJpeg = await atenderCaptura(subir(formulario(CAMPOS, png, "image/png")), deps);
  assert.equal(noJpeg.status, 400);
  assert.equal(((await noJpeg.json()) as { codigo: string }).codigo, "IMAGEN_INVALIDA");
  assert.equal((await atenderCaptura(subir(formulario(CAMPOS)), deps)).status, 400);
  assert.equal((await atenderCaptura(subir(formulario({ ...CAMPOS, momento: "durante" }, JPEG)), deps)).status, 400);
  assert.equal(almacen.objetos.size, 0);
});

test("topes de capturas: turnos por conversación y capturas por día", async () => {
  const llena = dependenciasFalsas(baseDeRegistro({ turnosEnConversacion: TOPE_TURNOS_CONVERSACION }).db, { almacen: () => almacenFalso() });
  const rechazo = await atenderCaptura(subir(formulario({ ...CAMPOS, conversacionId: "conv-1" }, JPEG)), llena);
  assert.equal(rechazo.status, 429);
  const diario = dependenciasFalsas(baseDeRegistro().db, { almacen: () => almacenFalso(), limitadorCapturaDiario: crearLimitador(1, 86_400_000) });
  assert.equal((await atenderCaptura(subir(formulario(CAMPOS, JPEG)), diario)).status, 200);
  assert.equal((await atenderCaptura(subir(formulario({ ...CAMPOS, momento: "despues" }, JPEG)), diario)).status, 429);
});

test("sin almacén configurado responde 503 con código y un fallo del almacén responde 502", async () => {
  const { db } = baseDeRegistro();
  const sinAlmacen = await atenderCaptura(subir(formulario(CAMPOS, JPEG)), dependenciasFalsas(db));
  assert.equal(sinAlmacen.status, 503);
  assert.equal(((await sinAlmacen.json()) as { codigo: string }).codigo, "ALMACEN_NO_CONFIGURADO");
  const caido = { ...almacenFalso(), poner: async () => { throw new ErrorAlmacen("caído"); } };
  const respuesta = await atenderCaptura(subir(formulario(CAMPOS, JPEG)), dependenciasFalsas(db, { almacen: () => caido }));
  assert.equal(respuesta.status, 502);
});

test("las capturas también exigen sesión y mismo origen", async () => {
  const deps = dependenciasFalsas(baseDeRegistro().db, { almacen: () => almacenFalso() });
  assert.equal((await atenderCaptura(subir(formulario(CAMPOS, JPEG), { conSesion: false }), deps)).status, 401);
  assert.equal((await atenderCaptura(subir(formulario(CAMPOS, JPEG), { cabeceras: { origin: "https://malo.test" } }), deps)).status, 403);
});
