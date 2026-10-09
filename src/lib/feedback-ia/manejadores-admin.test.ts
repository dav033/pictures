import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { aCsv } from "./csv";
import type { RespuestaListadoFeedback } from "./contrato";
import { atenderAnalisisCron, atenderAnalisisManual, atenderUltimosAnalisis } from "./manejadores-analisis";
import { atenderDetalle, atenderImagen, atenderListado } from "./manejadores-admin";
import { construirFiltros, type FilaListado } from "./repositorio";
import { CONTRASENA, almacenFalso, baseFalsa, dependenciasFalsas, peticion, peticionJson } from "./pruebas-comunes";

let contrasenaAnterior: string | undefined;
let cronAnterior: string | undefined;
beforeEach(() => {
  contrasenaAnterior = process.env.APP_PASSWORD;
  cronAnterior = process.env.CRON_SECRET;
  process.env.APP_PASSWORD = CONTRASENA;
  delete process.env.CRON_SECRET;
});
afterEach(() => {
  if (contrasenaAnterior === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = contrasenaAnterior;
  if (cronAnterior === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = cronAnterior;
});

const FILA_LISTADO = {
  id: "7", turno_id: "t7", producto: "taller", creado_en: new Date("2026-10-09T12:00:00Z"), calificacion: 2, motivos: ["colores"],
  comentario: "=cmd|' /C calc'!A0", deshecho: true, pedido: "pon un arco, azul", modelo: "flash", coste_usd: "0.0123", latencia_ms: 900,
  herramientas: ["colocar"], tiene_antes: true, tiene_despues: false,
};

test("todas las rutas de administrador rechazan sin sesión y no tocan la base", async () => {
  const db = baseFalsa(() => []);
  const deps = dependenciasFalsas(db, { almacen: () => almacenFalso() });
  const respuestas = [
    await atenderListado(peticion("/api/feedback-ia/admin", { conSesion: false }), deps),
    await atenderDetalle(peticion("/api/feedback-ia/admin/7", { conSesion: false }), "7", deps),
    await atenderImagen(peticion("/api/feedback-ia/admin/imagen?id=7&momento=antes", { conSesion: false }), deps),
    await atenderUltimosAnalisis(peticion("/api/feedback-ia/analisis", { conSesion: false }), deps),
    await atenderAnalisisManual(peticionJson("/api/feedback-ia/analisis", {}, { conSesion: false }), deps),
  ];
  assert.deepEqual(respuestas.map((r) => r.status), [401, 401, 401, 401, 401]);
  assert.equal(db.consultas.length, 0);
});

test("un usuario que no es administrador recibe 403 (rol resuelto por actorDeSesion)", async () => {
  const { exigirAdministrador } = await import("./acceso");
  const resultado = exigirAdministrador(peticion("/api/feedback-ia/admin"), () => ({ usuarioId: "u1", rol: "staff" }));
  assert.ok("respuesta" in resultado);
  assert.equal(resultado.respuesta.status, 403);
  assert.equal(((await resultado.respuesta.json()) as { codigo: string }).codigo, "SOLO_ADMINISTRADOR");
});

test("el listado valida los filtros, pide peor primero y devuelve el total", async () => {
  const db = baseFalsa(({ sql }) => (sql.includes("count(*)") ? [{ total: "1" }] : [FILA_LISTADO]));
  const deps = dependenciasFalsas(db);
  const respuesta = await atenderListado(peticion("/api/feedback-ia/admin?producto=taller&maximo=4&motivo=colores&desde=2026-10-01&limite=20"), deps);
  assert.equal(respuesta.status, 200);
  const cuerpo = (await respuesta.json()) as RespuestaListadoFeedback;
  assert.equal(cuerpo.total, 1);
  assert.equal(cuerpo.items[0].costeUsd, 0.0123);
  assert.equal(cuerpo.items[0].tieneImagenAntes, true);
  const consultaPagina = db.consultas.find((c) => c.sql.includes("ORDER BY"))!;
  assert.match(consultaPagina.sql, /ORDER BY calificacion ASC NULLS LAST, creado_en DESC/);
  assert.deepEqual(consultaPagina.valores, ["taller", 4, "colores", "2026-10-01", 20, 0]);

  for (const mala of ["maximo=11", "minimo=5&maximo=2", "desde=ayer", "limite=1000", "motivo=otro", "x=1"]) {
    assert.equal((await atenderListado(peticion(`/api/feedback-ia/admin?${mala}`), deps)).status, 400, mala);
  }
});

test("construirFiltros parametriza todo, excluye sin calificar por defecto y escapa el texto de búsqueda", () => {
  assert.equal(construirFiltros({}).donde, "WHERE calificacion IS NOT NULL");
  assert.equal(construirFiltros({ sinCalificar: "1" }).donde, "");
  const { donde, valores } = construirFiltros({ texto: "100%_ok'; DROP TABLE x;--", deshecho: "1", hasta: "2026-10-09" });
  assert.match(donde, /pedido ILIKE \$2 OR comentario ILIKE \$2 OR respuesta ILIKE \$2/);
  assert.ok(!donde.includes("DROP"));
  assert.deepEqual(valores, ["2026-10-09", "%100\\%\\_ok'; DROP TABLE x;--%"]);
});

test("la exportación CSV neutraliza fórmulas y escapa comas y comillas", async () => {
  const db = baseFalsa(({ sql }) => (sql.includes("count(*)") ? [{ total: "1" }] : [FILA_LISTADO]));
  const respuesta = await atenderListado(peticion("/api/feedback-ia/admin?formato=csv"), dependenciasFalsas(db));
  assert.match(respuesta.headers.get("content-disposition") ?? "", /^attachment; filename="feedback-ia-\d{4}-\d{2}-\d{2}\.csv"$/);
  const bytes = new Uint8Array(await respuesta.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "BOM UTF-8 para Excel");
  const texto = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).slice(1);
  assert.ok(texto.startsWith("id,fecha,producto"));
  assert.ok(texto.includes(",'=cmd|' /C calc'!A0,"), "la celda con = va precedida de comilla simple");
  assert.ok(texto.includes(`"pon un arco, azul"`));
  const fila: FilaListado = { id: 1, turnoId: "t", producto: "cliente", creadoEn: "x", calificacion: null, motivos: [], comentario: 'dijo "hola"', deshecho: false, pedido: null, modelo: null, costeUsd: null, latenciaMs: null, herramientas: [], tieneImagenAntes: false, tieneImagenDespues: false };
  assert.ok(aCsv([fila]).includes('"dijo ""hola"""'));
});

test("la exportación JSON completa incluye las escenas", async () => {
  const completa = { ...FILA_LISTADO, usuario_id: "u", actualizado_en: new Date(), respuesta: "ok", solicitud_id: null, conversacion_id: null, pasos: null, version_app: "v", escena_antes: { nodos: [] }, escena_despues: { nodos: [] }, diferencia: null, imagen_antes: "k", imagen_despues: null };
  const db = baseFalsa(() => [completa]);
  const respuesta = await atenderListado(peticion("/api/feedback-ia/admin?completo=1"), dependenciasFalsas(db));
  const filas = JSON.parse(await respuesta.text()) as { escenaAntes: unknown; id: number }[];
  assert.deepEqual(filas[0].escenaAntes, { nodos: [] });
  assert.equal(filas[0].id, 7);
});

test("el detalle une los pasos guardados con las llamadas de ai_call_log y no filtra claves de S3", async () => {
  const fila = {
    ...FILA_LISTADO, usuario_id: "u", actualizado_en: new Date(), respuesta: "listo", solicitud_id: "req-9", conversacion_id: "conv-1",
    pasos: [{ ts: "2026-10-09T10:00:00Z", tipo: "herramienta", nombre: "colocar", resumen: "ok" }], version_app: "abc",
    escena_antes: { nodos: [] }, escena_despues: { nodos: [{ id: "a" }] }, diferencia: { agregados: ["a"], quitados: [], modificados: [], otros: [] },
    imagen_antes: "feedback/taller/t7/antes.jpg", imagen_despues: null,
  };
  const db = baseFalsa(({ sql }) => sql.includes("FROM ai_call_log")
    ? [{ capacidad: "chat_turno", modelo: "flash", herramienta: "colocar", vuelta: 1, ms: 800, resultado: "ok", coste_estimado: "0.002" }]
    : [fila]);
  const respuesta = await atenderDetalle(peticion("/api/feedback-ia/admin/7"), "7", dependenciasFalsas(db));
  const detalle = (await respuesta.json()) as Record<string, unknown>;
  assert.equal(detalle.imagenAntesUrl, "/api/feedback-ia/admin/imagen?id=7&momento=antes");
  assert.equal(detalle.imagenDespuesUrl, null);
  assert.equal((detalle.llamadasIa as { costeEstimadoUsd: number }[])[0].costeEstimadoUsd, 0.002);
  assert.equal((detalle.pasos as unknown[]).length, 1);
  assert.ok(!JSON.stringify(detalle).includes("feedback/taller"));
  assert.deepEqual(db.consultas.find((c) => c.sql.includes("ai_call_log"))!.valores, ["req-9"]);

  assert.equal((await atenderDetalle(peticion("/api/feedback-ia/admin/abc"), "abc", dependenciasFalsas(db))).status, 400);
  const vacia = await atenderDetalle(peticion("/api/feedback-ia/admin/9"), "9", dependenciasFalsas(baseFalsa(() => [])));
  assert.equal(vacia.status, 404);
});

test("la imagen se sirve desde el almacén solo al administrador y valida la consulta", async () => {
  const almacen = almacenFalso();
  await almacen.poner("feedback/taller/t7/antes.jpg", new Uint8Array([0xff, 0xd8, 0xff, 1]), "image/jpeg");
  const db = baseFalsa(() => [{ ...FILA_LISTADO, imagen_antes: "feedback/taller/t7/antes.jpg", imagen_despues: null, usuario_id: "u", actualizado_en: new Date() }]);
  const deps = dependenciasFalsas(db, { almacen: () => almacen });
  const buena = await atenderImagen(peticion("/api/feedback-ia/admin/imagen?id=7&momento=antes"), deps);
  assert.equal(buena.status, 200);
  assert.equal(buena.headers.get("content-type"), "image/jpeg");
  assert.deepEqual([...new Uint8Array(await buena.arrayBuffer())], [0xff, 0xd8, 0xff, 1]);
  assert.equal((await atenderImagen(peticion("/api/feedback-ia/admin/imagen?id=7&momento=despues"), deps)).status, 404);
  assert.equal((await atenderImagen(peticion("/api/feedback-ia/admin/imagen?id=7&momento=../x"), deps)).status, 400);
  assert.equal((await atenderImagen(peticion("/api/feedback-ia/admin/imagen?id=7&momento=antes"), dependenciasFalsas(db))).status, 503);
});

/* ---------- Análisis ---------- */

const FILA_ANALISIS_SQL = {
  id: "3", creado_en: new Date("2026-10-09T00:00:00Z"), origen: "manual", desde: new Date("2026-10-02T00:00:00Z"), hasta: new Date("2026-10-09T00:00:00Z"),
  dias: 7, total_turnos: 2, total_calificados: 2, promedio: "4.50", metricas: { porMotivo: [] }, resumen: null, resumen_modelo: null, resumen_coste_usd: null,
};

function baseDeAnalisis() {
  return baseFalsa(({ sql }) => {
    if (sql.includes("FROM ai_feedback WHERE creado_en")) {
      return [
        { id: "2", turno_id: "b", producto: "taller", calificacion: 2, motivos: ["colores"], comentario: null, pedido: null, herramientas: ["pintar"], deshecho: false },
        { id: "1", turno_id: "a", producto: "cliente", calificacion: 7, motivos: [], comentario: null, pedido: null, herramientas: [], deshecho: false },
      ];
    }
    return [FILA_ANALISIS_SQL];
  });
}

test("el análisis manual valida el pedido, guarda el resultado y solo llama a Gemini si se pide", async () => {
  const db = baseDeAnalisis();
  let llamadasGemini = 0;
  const deps = dependenciasFalsas(db, { resumir: async () => { llamadasGemini += 1; return { texto: "Resumen", modelo: "flash", costeUsd: 0.001 }; } });

  const sin = await atenderAnalisisManual(peticionJson("/api/feedback-ia/analisis", { dias: 7 }), deps);
  assert.equal(sin.status, 201);
  assert.equal(llamadasGemini, 0);
  const insercion = db.consultas.find((c) => c.sql.startsWith("INSERT INTO ai_feedback_analisis"))!;
  assert.equal(insercion.valores[3], 7);
  assert.equal(insercion.valores[5], 2);
  assert.equal(insercion.valores[6], 4.5);

  const con = await atenderAnalisisManual(peticionJson("/api/feedback-ia/analisis", { dias: 30, conResumen: true }), deps);
  assert.equal(con.status, 201);
  assert.equal(llamadasGemini, 1);
  assert.equal(db.consultas.filter((c) => c.sql.startsWith("INSERT INTO ai_feedback_analisis")).pop()!.valores[8], "Resumen");

  for (const malo of [{ dias: 0 }, { dias: 400 }, { dias: 7, extra: 1 }]) {
    assert.equal((await atenderAnalisisManual(peticionJson("/api/feedback-ia/analisis", malo), deps)).status, 400);
  }
  assert.equal((await atenderAnalisisManual(peticionJson("/api/feedback-ia/analisis", {}, { cabeceras: { origin: "https://malo.test" } }), deps)).status, 403);
});

test("el cron exige CRON_SECRET (cerrado sin él) y el resumen automático depende de la bandera", async () => {
  const db = baseDeAnalisis();
  let llamadasGemini = 0;
  const resumir = async () => { llamadasGemini += 1; return null; };
  const sinSecreto = await atenderAnalisisCron(peticion("/api/feedback-ia/analisis-cron", { conSesion: false, cabeceras: { authorization: "Bearer " } }), dependenciasFalsas(db));
  assert.equal(sinSecreto.status, 401);

  process.env.CRON_SECRET = "secreto-cron";
  const mal = await atenderAnalisisCron(peticion("/api/feedback-ia/analisis-cron", { conSesion: false, cabeceras: { authorization: "Bearer otro" } }), dependenciasFalsas(db));
  assert.equal(mal.status, 401);
  const conSesionPeroSinSecreto = await atenderAnalisisCron(peticion("/api/feedback-ia/analisis-cron"), dependenciasFalsas(db));
  assert.equal(conSesionPeroSinSecreto.status, 401);

  const bien = await atenderAnalisisCron(peticion("/api/feedback-ia/analisis-cron", { conSesion: false, cabeceras: { authorization: "Bearer secreto-cron" } }), dependenciasFalsas(db, { resumir }));
  assert.equal(bien.status, 200);
  assert.equal(llamadasGemini, 0);
  assert.equal(db.consultas.filter((c) => c.sql.startsWith("INSERT INTO ai_feedback_analisis")).pop()!.valores[0], "cron");

  await atenderAnalisisCron(peticion("/api/feedback-ia/analisis-cron", { conSesion: false, cabeceras: { authorization: "Bearer secreto-cron" } }), dependenciasFalsas(db, { resumir, resumenAutomaticoActivo: () => true }));
  assert.equal(llamadasGemini, 1);
});

test("el último análisis se lee con la sesión de administrador", async () => {
  const respuesta = await atenderUltimosAnalisis(peticion("/api/feedback-ia/analisis"), dependenciasFalsas(baseDeAnalisis()));
  const cuerpo = (await respuesta.json()) as { analisis: { id: number; promedio: number }[] };
  assert.equal(cuerpo.analisis[0].id, 3);
  assert.equal(cuerpo.analisis[0].promedio, 4.5);
});
