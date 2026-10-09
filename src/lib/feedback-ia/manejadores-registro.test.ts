import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { crearLimitador } from "./acceso";
import { TOPE_CAPTURA_BYTES } from "./contrato";
import { atenderCaptura, atenderRegistro } from "./manejadores-registro";
import { CONTRASENA, almacenFalso, baseFalsa, dependenciasFalsas, peticion, peticionJson } from "./pruebas-comunes";

const COLUMNAS_REGISTRO = [
  "turno_id", "producto", "usuario_id", "calificacion", "motivos", "comentario", "deshecho", "pedido", "respuesta", "solicitud_id",
  "conversacion_id", "herramientas", "pasos", "modelo", "coste_usd", "latencia_ms", "version_app", "escena_antes", "escena_despues", "diferencia",
] as const;
const JSON_COLUMNAS = new Set(["pasos", "escena_antes", "escena_despues", "diferencia"]);

/** Postgres mínimo en memoria para las dos consultas de escritura y la de lectura por turno (el SQL real se prueba en migración). */
function baseConFilas() {
  const filas = new Map<string, Record<string, unknown>>();
  const db = baseFalsa(({ sql, valores }) => {
    if (sql.startsWith("SELECT") && sql.includes("WHERE producto = $1 AND turno_id = $2")) {
      const fila = filas.get(`${valores[0]}/${valores[1]}`);
      return fila ? [fila] : [];
    }
    if (sql.includes("INSERT INTO ai_feedback (turno_id, producto, usuario_id, calificacion")) {
      const nueva: Record<string, unknown> = { id: "1", creado_en: new Date(), actualizado_en: new Date(), imagen_antes: null, imagen_despues: null };
      COLUMNAS_REGISTRO.forEach((columna, i) => {
        const valor = valores[i];
        nueva[columna] = JSON_COLUMNAS.has(columna) && typeof valor === "string" ? JSON.parse(valor) : valor;
      });
      const clave = `${nueva.producto}/${nueva.turno_id}`;
      const previa = filas.get(clave);
      if (previa && previa.usuario_id !== nueva.usuario_id) return [];
      filas.set(clave, { ...previa, ...nueva, imagen_antes: previa?.imagen_antes ?? null, imagen_despues: previa?.imagen_despues ?? null });
      return [{ id: "1", creado: !previa, actualizado_en: new Date() }];
    }
    if (sql.includes("INSERT INTO ai_feedback (turno_id, producto, usuario_id, imagen_")) {
      const [turno, producto, usuario, clave] = valores as string[];
      const previa = filas.get(`${producto}/${turno}`);
      if (previa && previa.usuario_id !== usuario) return { rows: [], rowCount: 0 };
      const columna = sql.includes("imagen_antes") ? "imagen_antes" : "imagen_despues";
      filas.set(`${producto}/${turno}`, { ...(previa ?? { id: "1", turno_id: turno, producto, usuario_id: usuario }), [columna]: clave });
      return { rows: [], rowCount: 1 };
    }
    return undefined;
  });
  return { db, filas };
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

test("sin sesión o con otro origen se rechaza antes de tocar la base", async () => {
  const { db } = baseConFilas();
  const deps = dependenciasFalsas(db);
  const sinSesion = await atenderRegistro(peticionJson("/api/feedback-ia", BASE, { conSesion: false }), deps);
  assert.equal(sinSesion.status, 401);
  assert.equal(((await sinSesion.json()) as { codigo: string }).codigo, "SESION_REQUERIDA");
  const otroOrigen = await atenderRegistro(peticionJson("/api/feedback-ia", BASE, { cabeceras: { origin: "https://malo.test" } }), deps);
  assert.equal(otroOrigen.status, 403);
  assert.equal(db.consultas.length, 0);
});

test("valida con zod: motivos desconocidos, calificación fuera de rango y propiedades de más", async () => {
  const deps = dependenciasFalsas(baseConFilas().db);
  for (const malo of [
    { ...BASE, calificacion: 11 },
    { ...BASE, calificacion: 0 },
    { ...BASE, calificacion: 5.5 },
    { ...BASE, motivos: ["inventado"] },
    { ...BASE, turnoId: "../etc" },
    { ...BASE, producto: "otro" },
    { ...BASE, extra: true },
    { ...BASE, comentario: "x".repeat(2001) },
  ]) {
    const respuesta = await atenderRegistro(peticionJson("/api/feedback-ia", malo), deps);
    assert.equal(respuesta.status, 400, JSON.stringify(malo).slice(0, 80));
    assert.equal(((await respuesta.json()) as { codigo: string }).codigo, "CUERPO_INVALIDO");
  }
});

test("topes de tamaño: escena de más de 400 kB y cuerpo de más de 1 MB", async () => {
  const deps = dependenciasFalsas(baseConFilas().db);
  const escenaGrande = { nodos: [{ id: "a", relleno: "x".repeat(400_001) }] };
  assert.equal((await atenderRegistro(peticionJson("/api/feedback-ia", { ...BASE, escenaAntes: escenaGrande }), deps)).status, 400);
  const enorme = await atenderRegistro(peticion("/api/feedback-ia", { metodo: "POST", cuerpo: "x".repeat(1_000_001), cabeceras: { "content-type": "application/json" } }), deps);
  assert.equal(enorme.status, 413);
});

test("registrar y luego calificar es idempotente: una sola fila, los campos no enviados se conservan", async () => {
  const { db, filas } = baseConFilas();
  const deps = dependenciasFalsas(db);
  const antes = { sala: { ancho: 5 }, nodos: [{ id: "a", x: 1 }, { id: "b", x: 2 }] };
  const despues = { sala: { ancho: 5 }, nodos: [{ id: "a", x: 9 }, { id: "c", x: 3 }] };

  const primera = await atenderRegistro(peticionJson("/api/feedback-ia", { ...BASE, pedido: "pon un arco", escenaAntes: antes, escenaDespues: despues, modelo: "flash", latenciaMs: 1200 }), deps);
  assert.equal(primera.status, 201);
  assert.equal(((await primera.json()) as { creado: boolean }).creado, true);

  const calificar = { ...BASE, calificacion: 3, motivos: ["colores", "colores", "mal_colocado"], comentario: "El arco quedó torcido" };
  const segunda = await atenderRegistro(peticionJson("/api/feedback-ia", calificar), deps);
  const repetida = await atenderRegistro(peticionJson("/api/feedback-ia", calificar), deps);
  assert.equal(segunda.status, 200);
  assert.equal(repetida.status, 200);
  assert.equal(((await repetida.json()) as { creado: boolean }).creado, false);

  assert.equal(filas.size, 1);
  const fila = filas.get("taller/turno-1")!;
  assert.equal(fila.calificacion, 3);
  assert.deepEqual(fila.motivos, ["colores", "mal_colocado"]);
  assert.equal(fila.pedido, "pon un arco");
  assert.equal(fila.modelo, "flash");
  assert.equal(fila.version_app, "abc123");
  assert.deepEqual(fila.diferencia, { agregados: ["c"], quitados: ["b"], modificados: [{ id: "a", campos: ["x"] }], otros: [] });
  assert.equal(deps.auditorias.length, 3);
  assert.match(deps.auditorias[0], /regla:feedback_ia/);
});

test("el chat del cliente usa el mismo registro y deshacer queda marcado", async () => {
  const { db, filas } = baseConFilas();
  const deps = dependenciasFalsas(db);
  await atenderRegistro(peticionJson("/api/feedback-ia", { turnoId: "c1", producto: "cliente", calificacion: 8 }), deps);
  await atenderRegistro(peticionJson("/api/feedback-ia", { turnoId: "c1", producto: "cliente", deshecho: true }), deps);
  assert.equal(filas.get("cliente/c1")!.deshecho, true);
  assert.equal(filas.get("cliente/c1")!.calificacion, 8);
});

test("copia los pasos de la auditoría una vez y deriva las herramientas", async () => {
  const { db, filas } = baseConFilas();
  let lecturas = 0;
  const deps = dependenciasFalsas(db, {
    servicio: () => ({
      db,
      versionApp: () => "v1",
      leerPasos: async () => { lecturas += 1; return [{ ts: "2026-10-09T10:00:00Z", tipo: "herramienta", nombre: "colocar_pieza", resumen: "ok" }]; },
    }),
  });
  await atenderRegistro(peticionJson("/api/feedback-ia", { ...BASE, solicitudId: "req-1", conversacionId: "conv-1" }), deps);
  await atenderRegistro(peticionJson("/api/feedback-ia", { ...BASE, calificacion: 7 }), deps);
  assert.equal(lecturas, 1);
  assert.deepEqual(filas.get("taller/turno-1")!.herramientas, ["colocar_pieza"]);
});

test("otra persona no puede modificar un turno ajeno", async () => {
  const { db, filas } = baseConFilas();
  filas.set("taller/turno-1", { id: "1", turno_id: "turno-1", producto: "taller", usuario_id: "otra-persona", motivos: [], herramientas: [], deshecho: false, creado_en: new Date(), actualizado_en: new Date() });
  const respuesta = await atenderRegistro(peticionJson("/api/feedback-ia", { ...BASE, calificacion: 1 }), dependenciasFalsas(db));
  assert.equal(respuesta.status, 403);
  assert.equal(((await respuesta.json()) as { codigo: string }).codigo, "TURNO_AJENO");
});

test("el tope por minuto devuelve 429 y un fallo de base 503 sin filtrar el error", async () => {
  const { db } = baseConFilas();
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

test("sube la captura al almacén con clave por producto/turno/momento y guarda solo la clave", async () => {
  const { db, filas } = baseConFilas();
  const almacen = almacenFalso();
  const deps = dependenciasFalsas(db, { almacen: () => almacen });
  const respuesta = await atenderCaptura(peticion("/api/feedback-ia/capturas", { metodo: "POST", cuerpo: formulario(CAMPOS, JPEG) }), deps);
  assert.equal(respuesta.status, 200);
  assert.deepEqual([...almacen.objetos.keys()], ["feedback/taller/turno-1/antes.jpg"]);
  assert.equal(almacen.objetos.get("feedback/taller/turno-1/antes.jpg")!.tipo, "image/jpeg");
  assert.equal(filas.get("taller/turno-1")!.imagen_antes, "feedback/taller/turno-1/antes.jpg");
  assert.ok(!JSON.stringify(await respuesta.clone().json()).includes("feedback/"), "la respuesta no revela la clave del almacén");
});

test("rechaza capturas de más de 600 KB, que no son JPEG o sin archivo", async () => {
  const { db } = baseConFilas();
  const almacen = almacenFalso();
  const deps = dependenciasFalsas(db, { almacen: () => almacen });
  const grande = new Uint8Array(TOPE_CAPTURA_BYTES + 1);
  grande.set([0xff, 0xd8, 0xff]);
  assert.equal((await atenderCaptura(peticion("/api/feedback-ia/capturas", { metodo: "POST", cuerpo: formulario(CAMPOS, grande) }), deps)).status, 413);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const noJpeg = await atenderCaptura(peticion("/api/feedback-ia/capturas", { metodo: "POST", cuerpo: formulario(CAMPOS, png, "image/png") }), deps);
  assert.equal(noJpeg.status, 400);
  assert.equal(((await noJpeg.json()) as { codigo: string }).codigo, "IMAGEN_INVALIDA");
  assert.equal((await atenderCaptura(peticion("/api/feedback-ia/capturas", { metodo: "POST", cuerpo: formulario(CAMPOS) }), deps)).status, 400);
  assert.equal((await atenderCaptura(peticion("/api/feedback-ia/capturas", { metodo: "POST", cuerpo: formulario({ ...CAMPOS, momento: "durante" }, JPEG) }), deps)).status, 400);
  assert.equal(almacen.objetos.size, 0);
});

test("sin almacén configurado responde 503 con código y un fallo del almacén responde 502", async () => {
  const { db } = baseConFilas();
  const sinAlmacen = await atenderCaptura(peticion("/api/feedback-ia/capturas", { metodo: "POST", cuerpo: formulario(CAMPOS, JPEG) }), dependenciasFalsas(db));
  assert.equal(sinAlmacen.status, 503);
  assert.equal(((await sinAlmacen.json()) as { codigo: string }).codigo, "ALMACEN_NO_CONFIGURADO");

  const { ErrorAlmacen } = await import("@/lib/almacen/objetos-s3");
  const caido = { ...almacenFalso(), poner: async () => { throw new ErrorAlmacen("caído"); } };
  const respuesta = await atenderCaptura(peticion("/api/feedback-ia/capturas", { metodo: "POST", cuerpo: formulario(CAMPOS, JPEG) }), dependenciasFalsas(db, { almacen: () => caido }));
  assert.equal(respuesta.status, 502);
});

test("las capturas también exigen sesión y mismo origen", async () => {
  const deps = dependenciasFalsas(baseConFilas().db, { almacen: () => almacenFalso() });
  assert.equal((await atenderCaptura(peticion("/api/feedback-ia/capturas", { metodo: "POST", cuerpo: formulario(CAMPOS, JPEG), conSesion: false }), deps)).status, 401);
  assert.equal((await atenderCaptura(peticion("/api/feedback-ia/capturas", { metodo: "POST", cuerpo: formulario(CAMPOS, JPEG), cabeceras: { origin: "https://malo.test" } }), deps)).status, 403);
});
