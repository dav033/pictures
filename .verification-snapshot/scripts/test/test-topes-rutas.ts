/**
 * Los topes de gasto por hora vistos desde las rutas (migración 035, `src/lib/topes/`): las funciones `…Durable` de las fotos, las
 * imágenes por navegador y el asistente de escena sobre el doble de la sentencia; cuándo cuentan en Neon; el adaptador del pool
 * (`crearConsultaDePool`: el plazo y la conexión) y la migración. El motor (concurrencia, ventana, respaldo), en
 * `test-topes-durables.ts`.
 *
 *   PGLITE_DIR=C:/Users/davidt/lotm-game npx tsx --conditions=react-server scripts/test/test-topes-rutas.ts
 */
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { devolverCupoEscenaIADurable, reiniciarCupoEscenaIA, TOPE_POR_HORA, TOPE_SIMILITUD_POR_HORA, tomarCupoEscenaIA, tomarCupoEscenaIADurable, tomarCupoSimilitudDurable } from "../../src/lib/globos3d/cupo-escena-ia";
import { TOPE_FOTOS_POR_HORA } from "../../src/lib/globos3d/foto-realista";
import { reiniciarFotosPorHora, tomarFotoDeLaHora, tomarFotoDeLaHoraDurable } from "../../src/lib/globos3d/tope-fotos-hora";
import { devolverImagenDeNavegadorDurable, reiniciarImagenesPorNavegador, TOPE_IMAGENES_POR_NAVEGADOR_HORA, tomarImagenDeNavegador, tomarImagenDeNavegadorDurable } from "../../src/lib/guiada-motor/tope-imagenes-navegador";
import { crearConsultaDePool, topesDurablesActivos, type PoolDeTopes } from "../../src/lib/topes/consulta-pool";
import { crearTopeDurable, topeDurable, VENTANA_TOPE_MS, type ResultadoTope } from "../../src/lib/topes/tope-durable";
import { PlazoDeTopeVencido } from "../../src/lib/topes/tipos";
import { abrirPglite, cerrarBasesCompartidas, crearBaseDoble, crearEspia, crearMemoria, RUTA_MIGRACION, sqlMigracion } from "../lib/topes-bases-de-prueba";

const DIR_PGLITE = process.env.PGLITE_DIR;
const HUELLA = "ab".repeat(32);
const OTRA_HUELLA = "cd".repeat(32);

const sinRecibo = (toma: ResultadoTope): ResultadoTope => (toma.ok ? { ok: true, usadas: toma.usadas } : toma);

after(cerrarBasesCompartidas);

describe("los topes de las rutas cuentan en la base", () => {
  let base: ReturnType<typeof crearBaseDoble>;
  beforeEach(() => {
    reiniciarFotosPorHora();
    reiniciarImagenesPorNavegador();
    reiniciarCupoEscenaIA();
    base = crearBaseDoble();
    topeDurable().usarProveedor(async () => base.consulta);
  });
  afterEach(() => {
    topeDurable().usarProveedor(async () => null);
    reiniciarFotosPorHora();
    reiniciarImagenesPorNavegador();
    reiniciarCupoEscenaIA();
  });

  it("ningún límite cambió", () => {
    assert.deepEqual([TOPE_FOTOS_POR_HORA, TOPE_IMAGENES_POR_NAVEGADOR_HORA, TOPE_POR_HORA, TOPE_SIMILITUD_POR_HORA], [30, 6, 60, 120]);
  });

  it("fotos por hora: la clave global, el mismo resultado de tope y la memoria intacta", async () => {
    for (let i = 1; i <= 3; i += 1) assert.deepEqual(sinRecibo(await tomarFotoDeLaHoraDurable(Date.now(), 3)), { ok: true, usadas: i });
    assert.deepEqual(await tomarFotoDeLaHoraDurable(Date.now(), 3), { ok: false, usadas: 3, tope: 3 });
    assert.equal(await base.leer("fotos_hora"), 3);
    assert.equal(tomarFotoDeLaHora(0, 1).ok, true, "la memoria de la instancia no se tocó");
  });

  it("imágenes por navegador: cuenta y devuelve en la base, con la huella como única clave", async () => {
    assert.equal((await tomarImagenDeNavegadorDurable(HUELLA, Date.now(), 2)).ok, true);
    const segunda = await tomarImagenDeNavegadorDurable(HUELLA, Date.now(), 2);
    assert.equal(segunda.ok, true);
    assert.deepEqual(await tomarImagenDeNavegadorDurable(HUELLA, Date.now(), 2), { ok: false, usadas: 2, tope: 2 });
    assert.equal((await tomarImagenDeNavegadorDurable(OTRA_HUELLA, Date.now(), 2)).ok, true, "otro navegador, otra cuenta");
    await devolverImagenDeNavegadorDurable(HUELLA, segunda);
    assert.equal(await base.leer(`imagenes_navegador:${HUELLA}`), 1);
    assert.equal((await tomarImagenDeNavegadorDurable(HUELLA, Date.now(), 2)).ok, true);
    assert.deepEqual((await base.claves()).sort(), [`imagenes_navegador:${HUELLA}`, `imagenes_navegador:${OTRA_HUELLA}`]);
  });

  it("la devolución de una imagen vuelve a donde salió: a la base si salió de la base, a la memoria si salió de la memoria", async () => {
    const deLaBase = await tomarImagenDeNavegadorDurable(HUELLA, Date.now(), 3);
    base.estado.modo = "caida";
    topeDurable().usarProveedor(async () => base.consulta);
    const deLaMemoria = await tomarImagenDeNavegadorDurable(OTRA_HUELLA, Date.now(), 3);
    base.estado.modo = "normal";
    topeDurable().usarProveedor(async () => base.consulta);
    await devolverImagenDeNavegadorDurable(OTRA_HUELLA, deLaMemoria);
    assert.equal(await base.leer(`imagenes_navegador:${OTRA_HUELLA}`), null, "la base no sabía de esa toma");
    assert.equal(tomarImagenDeNavegador(OTRA_HUELLA, Date.now(), 1).ok, true, "la memoria recuperó el cupo que se devolvió");
    await devolverImagenDeNavegadorDurable(HUELLA, deLaBase);
    assert.equal(await base.leer(`imagenes_navegador:${HUELLA}`), 0);
  });

  describe("una clave de navegador que no es una huella sha256", () => {
    const entorno = process.env as Record<string, string | undefined>;
    let anterior: string | undefined;
    beforeEach(() => { anterior = entorno.NODE_ENV; });
    afterEach(() => { if (anterior === undefined) delete entorno.NODE_ENV; else entorno.NODE_ENV = anterior; });

    it("en desarrollo y en las pruebas se rechaza: nunca llega a la base ni se le inventa una huella", async () => {
      entorno.NODE_ENV = "test";
      await assert.rejects(tomarImagenDeNavegadorDurable("feedback_usuario=cookie-en-claro-1234"), /huella sha256/);
      await assert.rejects(tomarImagenDeNavegadorDurable("AB".repeat(32)), /huella sha256/, "ni siquiera en mayúsculas");
      await assert.rejects(tomarImagenDeNavegadorDurable("ab".repeat(31)), /huella sha256/);
      assert.equal(base.sentencias.length, 0);
    });

    it("en producción no bloquea al cliente ni toca la base: cuenta en la memoria de la instancia, sin el valor en el registro", async () => {
      entorno.NODE_ENV = "production";
      const cookie = "feedback_usuario=cookie-en-claro-1234";
      assert.equal((await tomarImagenDeNavegadorDurable(cookie, Date.now(), 1)).ok, true);
      assert.deepEqual(await tomarImagenDeNavegadorDurable(cookie, Date.now(), 1), { ok: false, usadas: 1, tope: 1 }, "sigue acotado");
      assert.equal(base.sentencias.length, 0);
      assert.deepEqual(await base.claves(), []);
    });
  });

  it("asistente de escena: los pedidos y las revisiones de ronda tienen cada uno su cuenta, y devolver libera un pedido", async () => {
    let ultimo: ResultadoTope = { ok: false, usadas: 0, tope: 0 };
    for (let i = 0; i < TOPE_POR_HORA; i += 1) { ultimo = await tomarCupoEscenaIADurable(); assert.equal(ultimo.ok, true); }
    assert.equal((await tomarCupoEscenaIADurable()).ok, false);
    assert.equal(await tomarCupoSimilitudDurable(), true, "la revisión de una ronda ya pagada tiene su cupo aparte");
    assert.equal(await base.leer("escena_ia_hora"), TOPE_POR_HORA);
    assert.equal(await base.leer("escena_ia_similitud_hora"), 1);
    await devolverCupoEscenaIADurable(ultimo);
    assert.equal((await tomarCupoEscenaIADurable()).ok, true);
    for (let i = 1; i < TOPE_SIMILITUD_POR_HORA; i += 1) assert.equal(await tomarCupoSimilitudDurable(), true);
    assert.equal(await tomarCupoSimilitudDurable(), false);
    assert.equal(tomarCupoEscenaIA(), true, "el contador en memoria no se gastó");
  });

  it("el pedido que la IA no atendió (sinIA) se devuelve a su hora: si entre medias cambió la hora, no le quita nada a la nueva", async () => {
    const pedido = await tomarCupoEscenaIADurable();
    await base.envejecer("escena_ia_hora", VENTANA_TOPE_MS + 1_000);
    assert.equal((await tomarCupoEscenaIADurable()).ok, true);
    assert.equal(await base.leer("escena_ia_hora"), 1);
    await devolverCupoEscenaIADurable(pedido);
    assert.equal(await base.leer("escena_ia_hora"), 1);
  });

  it("con la base caída cada tope sigue respondiendo igual que hoy, con el contador de la instancia", async () => {
    base.estado.modo = "caida";
    topeDurable().usarProveedor(async () => base.consulta);
    assert.deepEqual(sinRecibo(await tomarFotoDeLaHoraDurable(Date.now(), 2)), { ok: true, usadas: 1 });
    assert.deepEqual(sinRecibo(await tomarFotoDeLaHoraDurable(Date.now(), 2)), { ok: true, usadas: 2 });
    assert.deepEqual(await tomarFotoDeLaHoraDurable(Date.now(), 2), { ok: false, usadas: 2, tope: 2 });
    let concedidas = 0;
    for (let i = 0; i < TOPE_POR_HORA + 10; i += 1) if ((await tomarCupoEscenaIADurable()).ok) concedidas += 1;
    assert.equal(concedidas, TOPE_POR_HORA, "sin la base, el tope de la instancia sigue vigente");
  });

  it("sin proveedor de base los tres topes cuentan en memoria, como antes de la migración", async () => {
    topeDurable().usarProveedor(async () => null);
    assert.deepEqual(sinRecibo(await tomarFotoDeLaHoraDurable(Date.now(), 1)), { ok: true, usadas: 1 });
    assert.deepEqual(await tomarFotoDeLaHoraDurable(Date.now(), 1), { ok: false, usadas: 1, tope: 1 });
    assert.equal((await tomarImagenDeNavegadorDurable(HUELLA, Date.now(), 1)).ok, true);
    assert.equal((await tomarCupoEscenaIADurable()).ok, true);
    assert.equal(base.sentencias.length, 0);
  });
});

describe("cuándo los topes cuentan en Neon", () => {
  const produccion = { DATABASE_URL: "postgresql://nadie:nada@127.0.0.1:1/nada", NEXT_RUNTIME: "nodejs", NODE_ENV: "production" };

  it("solo en el servidor de Next de producción y con base", () => {
    assert.equal(topesDurablesActivos(produccion), true);
    assert.equal(topesDurablesActivos({ ...produccion, DATABASE_URL: undefined }), false, "sin DATABASE_URL");
    assert.equal(topesDurablesActivos({ ...produccion, NEXT_RUNTIME: undefined }), false, "un script de tsx (pruebas, CI) no cuenta en la base");
    assert.equal(topesDurablesActivos({ ...produccion, NEXT_RUNTIME: "edge" }), false, "el runtime edge no abre el pool");
    assert.equal(topesDurablesActivos({ ...produccion, NODE_ENV: "development" }), false, "`next dev` con el .env.local de producción no gasta los topes reales");
  });

  it("TOPES_DURABLES=1 lo fuerza (si hay base) y TOPES_DURABLES=0 lo apaga", () => {
    assert.equal(topesDurablesActivos({ DATABASE_URL: "postgresql://x", TOPES_DURABLES: "1" }), true);
    assert.equal(topesDurablesActivos({ TOPES_DURABLES: "1" }), false, "forzado pero sin base");
    assert.equal(topesDurablesActivos({ ...produccion, TOPES_DURABLES: "0" }), false);
  });

  it("en un script de prueba, por defecto, cuenta en memoria sin consultar ni registrar nada", async () => {
    const espia = crearEspia();
    const tomador = crearTopeDurable({ registrar: espia.registrar });
    assert.deepEqual(await tomador.tomar("fotos_hora", 2, crearMemoria(2)), { toma: { ok: true, usadas: 1, recibo: { origen: "memoria" } }, origen: "memoria" });
    assert.equal(espia.registros.length, 0);
  });
});

describe("el adaptador del pool respeta el plazo de verdad", () => {
  type Evento = string;
  const poolFalso = (opciones: { alConectar?: () => void; falla?: unknown } = {}) => {
    const eventos: Evento[] = [];
    const configs: Array<{ text: string; values: unknown[]; query_timeout: number }> = [];
    const pool: PoolDeTopes = {
      connect: async () => {
        opciones.alConectar?.();
        eventos.push("conexión");
        return {
          query: async (config) => {
            eventos.push("consulta");
            configs.push(config);
            if (opciones.falla) throw opciones.falla;
            return { rows: [{ usadas: 1 }] };
          },
          release: (destruir) => { eventos.push(destruir ? "libera:destruye" : "libera"); },
        };
      },
    };
    return { pool, eventos, configs };
  };

  it("la consulta lleva query_timeout igual al plazo que le queda", async () => {
    const reloj = { ms: 1_000 };
    const { pool, eventos, configs } = poolFalso({ alConectar: () => { reloj.ms += 300; } });
    const consulta = crearConsultaDePool(pool, () => reloj.ms);
    await consulta("SELECT 1", ["a"], 1_500);
    assert.deepEqual(eventos, ["conexión", "consulta", "libera"]);
    assert.equal(configs[0]!.query_timeout, 1_200, "plazo 1500 menos los 300 ms que tardó la conexión");
    assert.deepEqual(configs[0]!.values, ["a"]);
  });

  it("sin plazo usa el de los topes (1,5 s)", async () => {
    const { pool, configs } = poolFalso();
    await crearConsultaDePool(pool, () => 5)("SELECT 1", []);
    assert.equal(configs[0]!.query_timeout, 1_500);
  });

  it("una conexión que llega después del plazo (Neon dormido que despierta) no manda la consulta: no cuenta una toma tardía", async () => {
    const reloj = { ms: 0 };
    const { pool, eventos } = poolFalso({ alConectar: () => { reloj.ms += 2_000; } });
    await assert.rejects(crearConsultaDePool(pool, () => reloj.ms)("INSERT ...", [], 1_500), PlazoDeTopeVencido);
    assert.deepEqual(eventos, ["conexión", "libera"], "ni una consulta, y la conexión vuelve sana al pool");
  });

  it("un error de Postgres no destruye la conexión; un corte o un plazo de lectura sí (el servidor cancela lo que corría)", async () => {
    const deSql = poolFalso({ falla: Object.assign(new Error("relation does not exist"), { code: "42P01" }) });
    await assert.rejects(crearConsultaDePool(deSql.pool)("SELECT 1", []), /does not exist/);
    assert.deepEqual(deSql.eventos.slice(-1), ["libera"]);
    const deLectura = poolFalso({ falla: new Error("Query read timeout") });
    await assert.rejects(crearConsultaDePool(deLectura.pool)("SELECT 1", []), /read timeout/);
    assert.deepEqual(deLectura.eventos.slice(-1), ["libera:destruye"]);
  });
});

describe("la migración 035", () => {
  const sql = sqlMigracion();
  const ejecutable = sql.split("\n").filter((linea) => !linea.trim().startsWith("--")).join("\n");

  it("es aditiva e idempotente: solo crea una tabla y un índice con IF NOT EXISTS", () => {
    const sentencias = ejecutable.split(";").map((s) => s.trim()).filter(Boolean);
    assert.equal(sentencias.length, 2);
    assert.match(sentencias[0]!, /^CREATE TABLE IF NOT EXISTS topes_gasto \(/);
    assert.match(sentencias[1]!, /^CREATE INDEX IF NOT EXISTS ix_topes_gasto_ventana ON topes_gasto \(ventana_inicio\)$/);
    assert.ok(!/\b(ALTER|DROP|UPDATE|DELETE|TRUNCATE|INSERT)\b/i.test(ejecutable), "no toca ninguna tabla existente");
  });

  it("documenta su rollback completo: borrar la tabla Y su fila de schema_migrations", () => {
    assert.match(sql, /^-- rollback: DROP TABLE topes_gasto;$/m);
    assert.match(sql, /^--\s+DELETE FROM schema_migrations WHERE filename = '035_topes_gasto\.sql';$/m);
  });

  it("su número no se repite con otra migración", () => {
    const numeros = readdirSync(path.dirname(RUTA_MIGRACION)).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 3));
    assert.equal(numeros.filter((n) => n === "035").length, 1);
  });

  it("corre varias veces sin error ni cambio, aunque ya tenga filas, y el CHECK rechaza un contador negativo", { skip: DIR_PGLITE ? undefined : "sin PGLITE_DIR" }, async () => {
    const db = await abrirPglite(DIR_PGLITE!);
    await db.exec("DELETE FROM topes_gasto");
    await db.exec("INSERT INTO topes_gasto (clave, usadas) VALUES ('x', 1)");
    await db.exec(sql);
    await db.exec(sql);
    assert.equal(Number((await db.query("SELECT usadas FROM topes_gasto WHERE clave = 'x'")).rows[0]?.usadas), 1, "volver a correrla (ya migrada, con filas) no pierde ni cambia nada");
    await assert.rejects(db.exec("INSERT INTO topes_gasto (clave, usadas) VALUES ('y', -1)"), "el CHECK rechaza un contador negativo");
    await db.exec("DELETE FROM topes_gasto");
  });
});
