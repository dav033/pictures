/**
 * Prueba del SQL del feedback (REQ-010) contra Postgres real en memoria (PGlite): la migración 030, la mezcla por COALESCE,
 * el dueño del turno, los topes por conversación, la retención y el análisis. Las pruebas de las rutas (src/lib/feedback-ia)
 * usan un doble de la base y no pueden comprobar esto.
 *
 *   npm i --no-save @electric-sql/pglite     (o PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite>)
 *   npx tsx --conditions=react-server scripts/test/test-feedback-ia-sql.ts
 *
 * PGlite no es dependencia del proyecto (no hace falta en producción): si no se encuentra, la prueba FALLA con ese aviso.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { aplicarRetencion } from "../../src/lib/feedback-ia/retencion";
import type { BaseDatos } from "../../src/lib/feedback-ia/repositorio";
import { fijarImagen, guardar, listar, llamadasIaDeSolicitud, volumenDeConversacion, type ParcheFeedback } from "../../src/lib/feedback-ia/repositorio";
import { ejecutarAnalisis } from "../../src/lib/feedback-ia/servicio-analisis";
import { registrarFeedback, type DependenciasServicio } from "../../src/lib/feedback-ia/servicio";
import type { ClienteAlmacen } from "../../src/lib/almacen/objetos-s3";

type Pglite = { exec(sql: string): Promise<unknown>; query(sql: string, valores?: unknown[]): Promise<{ rows: unknown[]; affectedRows?: number }> };

async function abrirPglite(): Promise<Pglite> {
  const base = process.env.PGLITE_DIR ? path.join(process.env.PGLITE_DIR, "package.json") : path.join(process.cwd(), "package.json");
  let ruta: string;
  try {
    ruta = createRequire(base).resolve("@electric-sql/pglite");
  } catch {
    throw new Error("Falta @electric-sql/pglite: npm i --no-save @electric-sql/pglite (o PGLITE_DIR).");
  }
  const { PGlite } = (await import(pathToFileURL(ruta).href)) as { PGlite: new () => Pglite };
  return new PGlite();
}

const U = "nav-usuario-a";
const OTRO = "nav-usuario-b";
const vacio = { calificacion: null, motivos: null, comentario: null, deshecho: null, pedido: null, respuesta: null, solicitudId: null, conversacionId: null, herramientas: null, pasos: null, pasosFuente: null, modelo: null, costeUsd: null, latenciaMs: null, escenaAntes: null, escenaDespues: null, diferencia: null } as const;
const parche = (turnoId: string, cambios: Partial<ParcheFeedback> = {}, usuarioId = U): ParcheFeedback => ({ turnoId, producto: "taller", usuarioId, versionApp: "v-test", ...vacio, ...cambios });

async function principal(): Promise<void> {
  const pg = await abrirPglite();
  const db: BaseDatos = { query: async (sql, valores) => { const r = await pg.query(sql, valores); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length } as never; } };
  const migracion = readFileSync(path.join(process.cwd(), "scripts/migrations/030_ai_feedback.sql"), "utf8");
  await pg.exec(migracion);
  await pg.exec(migracion);
  await pg.exec("CREATE TABLE ai_call_log (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), capacidad TEXT, modelo TEXT, herramienta TEXT, vuelta SMALLINT, ms INT, resultado TEXT, coste_estimado NUMERIC, request_id UUID, correlation_id UUID)");
  const leer = async (turno: string) => (await pg.query("SELECT * FROM ai_feedback WHERE turno_id = $1", [turno])).rows[0] as Record<string, unknown>;
  const pruebas: [string, () => Promise<void>][] = [];
  const prueba = (nombre: string, cuerpo: () => Promise<void>) => pruebas.push([nombre, cuerpo]);

  prueba("la migración es idempotente y respeta sus CHECK", async () => {
    await assert.rejects(() => pg.exec("INSERT INTO ai_feedback (turno_id, producto, usuario_id, calificacion) VALUES ('x', 'taller', 'u', 11)"));
    await assert.rejects(() => pg.exec("INSERT INTO ai_feedback (turno_id, producto, usuario_id) VALUES ('../x', 'taller', 'u')"));
    await assert.rejects(() => pg.exec("INSERT INTO ai_feedback (turno_id, producto, usuario_id, pasos_fuente) VALUES ('y', 'taller', 'u', 'otro')"));
  });

  prueba("dos escrituras sobre el mismo turno no se pisan con nulos, en cualquier orden", async () => {
    const registro = parche("orden-1", { pedido: "pon un arco", respuesta: "listo", modelo: "flash", latenciaMs: 900, solicitudId: "req-1", conversacionId: "conv-orden" });
    const calificacion = parche("orden-1", { calificacion: 3, motivos: ["colores"], comentario: "torcido", deshecho: true });
    await guardar(db, registro);
    await guardar(db, calificacion);
    const ab = await leer("orden-1");
    await guardar(db, { ...calificacion, turnoId: "orden-2" });
    await guardar(db, { ...registro, turnoId: "orden-2" });
    const ba = await leer("orden-2");
    for (const fila of [ab, ba]) {
      assert.equal(fila.calificacion, 3);
      assert.deepEqual(fila.motivos, ["colores"]);
      assert.equal(fila.comentario, "torcido");
      assert.equal(fila.deshecho, true);
      assert.equal(fila.pedido, "pon un arco");
      assert.equal(fila.modelo, "flash");
      assert.equal(fila.latencia_ms, 900);
    }
  });

  prueba("veinte escrituras concurrentes de campos distintos conservan todos los campos", async () => {
    await guardar(db, parche("conc-1"));
    const campos: Partial<ParcheFeedback>[] = [{ calificacion: 7 }, { pedido: "p" }, { respuesta: "r" }, { modelo: "m" }, { latenciaMs: 5 }, { motivos: ["lento"] }, { comentario: "c" }, { costeUsd: 0.5 }];
    await Promise.all(Array.from({ length: 20 }, (_, i) => guardar(db, parche("conc-1", campos[i % campos.length]))));
    const fila = await leer("conc-1");
    assert.deepEqual([fila.calificacion, fila.pedido, fila.respuesta, fila.modelo, fila.latencia_ms, fila.comentario, Number(fila.coste_usd)], [7, "p", "r", "m", 5, "c", 0.5]);
    assert.deepEqual(fila.motivos, ["lento"]);
  });

  prueba("un comentario vacío lo borra, la versión de la app es la del primer registro y el número de creado es exacto", async () => {
    const primero = await guardar(db, { ...parche("com-1", { comentario: "algo" }), versionApp: "v1" });
    const segundo = await guardar(db, { ...parche("com-1", { comentario: "" }), versionApp: "v2" });
    assert.equal(primero?.creado, true);
    assert.equal(segundo?.creado, false);
    const fila = await leer("com-1");
    assert.equal(fila.comentario, null);
    assert.equal(fila.version_app, "v1");
  });

  prueba("solo el dueño modifica el turno (también las capturas)", async () => {
    await guardar(db, parche("dueno-1", { calificacion: 9 }));
    assert.equal(await guardar(db, parche("dueno-1", { calificacion: 1 }, OTRO)), null);
    assert.equal((await leer("dueno-1")).calificacion, 9);
    assert.equal(await fijarImagen(db, { producto: "taller", turnoId: "dueno-1", usuarioId: OTRO, momento: "antes", clave: "k", conversacionId: null }), false);
    assert.equal(await fijarImagen(db, { producto: "taller", turnoId: "dueno-1", usuarioId: U, momento: "antes", clave: "feedback/taller/dueno-1/antes.jpg", conversacionId: "conv-d" }), true);
    const fila = await leer("dueno-1");
    assert.equal(fila.imagen_antes, "feedback/taller/dueno-1/antes.jpg");
    assert.equal(fila.conversacion_id, "conv-d");
  });

  prueba("los pasos del navegador no se pisan con los del servidor, pero sí al revés", async () => {
    const paso = (nombre: string) => [{ ts: "t", tipo: "herramienta", nombre, ok: true, resumen: "" }];
    await guardar(db, parche("pasos-1", { pasos: paso("del_cliente"), pasosFuente: "cliente", herramientas: ["del_cliente"] }));
    await guardar(db, parche("pasos-1", { pasos: paso("del_servidor"), pasosFuente: "servidor", herramientas: ["del_servidor"] }));
    let fila = await leer("pasos-1");
    assert.equal(fila.pasos_fuente, "cliente");
    assert.deepEqual(fila.herramientas, ["del_cliente"]);
    await guardar(db, parche("pasos-1", { pasos: paso("nuevo_cliente"), pasosFuente: "cliente", herramientas: ["nuevo_cliente"] }));
    fila = await leer("pasos-1");
    assert.deepEqual(fila.herramientas, ["nuevo_cliente"]);
    await guardar(db, parche("pasos-2", { pasos: paso("del_servidor"), pasosFuente: "servidor", herramientas: ["del_servidor"] }));
    await guardar(db, parche("pasos-2", { pasos: paso("del_cliente"), pasosFuente: "cliente", herramientas: ["del_cliente"] }));
    assert.equal((await leer("pasos-2")).pasos_fuente, "cliente");
  });

  prueba("de punta a punta con el servicio: escenas solo si se valora, diferencia y respuesta con la calificación guardada", async () => {
    const deps: DependenciasServicio = { db, leerPasos: async () => [], versionApp: () => "v-test" };
    const antes = { nodos: [{ id: "a", x: 1 }] };
    const despues = { nodos: [{ id: "a", x: 2 }, { id: "b" }] };
    const sinValorar = await registrarFeedback(deps, U, { turnoId: "svc-1", producto: "taller", conversacionId: "conv-svc", pedido: "p", escenaAntes: antes, escenaDespues: despues });
    assert.equal(sinValorar.estado === "ok" && sinValorar.respuesta.escenasGuardadas, false);
    assert.equal((await leer("svc-1")).escena_antes, null);
    const valorado = await registrarFeedback(deps, U, { turnoId: "svc-1", producto: "taller", calificacion: 4, escenaAntes: antes, escenaDespues: despues });
    assert.equal(valorado.estado === "ok" && valorado.respuesta.escenasGuardadas, true);
    const fila = await leer("svc-1");
    assert.deepEqual(fila.diferencia, { agregados: ["b"], quitados: [], modificados: [{ id: "a", campos: ["x"] }], otros: [] });
    const solo = await registrarFeedback(deps, U, { turnoId: "svc-1", producto: "taller", comentario: "ojo" });
    assert.equal(solo.estado === "ok" && solo.respuesta.calificacion, 4, "la respuesta trae la calificación guardada aunque esta petición no la envíe");
    assert.deepEqual((await volumenDeConversacion(db, "conv-svc", "taller", "otro")).turnos, 1);
  });

  prueba("las llamadas de ai_call_log se unen solo con ids UUID", async () => {
    const id = "22222222-2222-2222-2222-222222222222";
    await pg.query("INSERT INTO ai_call_log (capacidad, modelo, ms, resultado, request_id) VALUES ('chat_turno', 'flash', 10, 'ok', $1)", [id]);
    assert.equal((await llamadasIaDeSolicitud(db, id)).length, 1);
    assert.deepEqual(await llamadasIaDeSolicitud(db, "req-no-uuid"), []);
  });

  prueba("el listado va de la peor nota a la mejor y filtra por motivo, texto y rango", async () => {
    const filtros = { limite: 50, desplazamiento: 0, formato: "json" as const };
    const { items } = await listar(db, filtros, 50, 0);
    const notas = items.map((i) => i.calificacion);
    assert.deepEqual(notas, [...notas].sort((a, b) => (a ?? 11) - (b ?? 11)));
    assert.equal((await listar(db, { ...filtros, motivo: "lento" }, 50, 0)).total, 1);
    assert.equal((await listar(db, { ...filtros, texto: "arco" }, 50, 0)).total >= 1, true);
    assert.equal((await listar(db, { ...filtros, minimo: 9 }, 50, 0)).items.every((i) => (i.calificacion ?? 0) >= 9), true);
  });

  prueba("la retención borra lo sin valorar viejo (y sus imágenes) y conserva lo valorado", async () => {
    await pg.exec("INSERT INTO ai_feedback (turno_id, producto, usuario_id, imagen_antes, actualizado_en) VALUES ('viejo-sin', 'taller', 'u', 'feedback/taller/viejo-sin/antes.jpg', now() - interval '40 days')");
    await pg.exec("INSERT INTO ai_feedback (turno_id, producto, usuario_id, calificacion, actualizado_en) VALUES ('viejo-con', 'taller', 'u', 5, now() - interval '40 days')");
    await pg.exec("INSERT INTO ai_feedback (turno_id, producto, usuario_id, comentario, actualizado_en) VALUES ('viejo-com', 'taller', 'u', 'ojo', now() - interval '40 days')");
    await pg.exec("INSERT INTO ai_feedback (turno_id, producto, usuario_id, actualizado_en) VALUES ('nuevo-sin', 'taller', 'u', now() - interval '5 days')");
    const borradas: string[] = [];
    const almacen = { borrar: async (clave: string) => { borradas.push(clave); }, listar: async () => ({ objetos: [], siguiente: null }) } as unknown as ClienteAlmacen;
    await aplicarRetencion({ db, almacen });
    const turnos = ((await pg.query("SELECT turno_id FROM ai_feedback")).rows as { turno_id: string }[]).map((f) => f.turno_id);
    assert.ok(!turnos.includes("viejo-sin"));
    for (const conservado of ["viejo-con", "viejo-com", "nuevo-sin"]) assert.ok(turnos.includes(conservado), conservado);
    assert.deepEqual(borradas, ["feedback/taller/viejo-sin/antes.jpg"]);
  });

  prueba("el análisis cuenta lo valorado en el periodo por fecha de valoración y todos los turnos registrados", async () => {
    await pg.exec("UPDATE ai_feedback SET actualizado_en = now() - interval '60 days' WHERE turno_id = 'viejo-con'");
    const analisis = await ejecutarAnalisis({ db, resumir: null }, { dias: 7, origen: "script" });
    assert.ok(analisis.totalTurnos >= analisis.totalCalificados);
    assert.ok(analisis.totalCalificados >= 1);
    const todos = (await pg.query("SELECT count(*) AS n FROM ai_feedback WHERE calificacion IS NOT NULL")).rows[0] as { n: string };
    assert.ok(analisis.totalCalificados < Number(todos.n), "la calificación antigua queda fuera del periodo");
  });

  let fallos = 0;
  for (const [nombre, cuerpo] of pruebas) {
    try {
      await cuerpo();
      console.log(`  ok   ${nombre}`);
    } catch (error) {
      fallos += 1;
      console.error(`  FALLÓ ${nombre}\n${error instanceof Error ? error.message : error}`);
    }
  }
  if (fallos > 0) process.exit(1);
  console.log(`[PASS] ${pruebas.length} pruebas del SQL del feedback`);
}

principal().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
