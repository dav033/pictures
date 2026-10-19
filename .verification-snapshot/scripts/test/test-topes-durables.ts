/**
 * Topes de gasto durables y globales (migración 035, `src/lib/topes/tope-durable.ts`): el contador por hora de las llamadas que se
 * pagan vive en Neon y no en la memoria de cada instancia de Vercel. Esta prueba es el motor: la sentencia, la concurrencia, la
 * ventana, las devoluciones y el respaldo en memoria. Las rutas, la activación, el adaptador del pool y la migración, en
 * `test-topes-rutas.ts`.
 *
 * Los mismos escenarios corren contra cada base disponible (ver `scripts/lib/topes-bases-de-prueba.ts`):
 * - el doble en memoria de la sentencia: siempre;
 * - Postgres real en memoria (PGlite): con PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite>;
 * - un `pg.Pool` de 8 conexiones contra una base LOCAL: la de la CI, o TOPES_TEST_DATABASE_URL en local. Es la que prueba de verdad
 *   los bloqueos de fila entre conexiones.
 *
 *   PGLITE_DIR=C:/Users/davidt/lotm-game npx tsx --conditions=react-server scripts/test/test-topes-durables.ts
 */
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { reiniciarFotosPorHora, tomarFotoDeLaHora } from "../../src/lib/globos3d/tope-fotos-hora";
import { devolverImagenDeNavegador, reiniciarImagenesPorNavegador, tomarImagenDeNavegador } from "../../src/lib/guiada-motor/tope-imagenes-navegador";
import { crearTopeDurable, PAUSA_SIN_TABLA_MS, PAUSA_TRAS_FALLO_MS, SQL_TOMAR_TOPE, VENTANA_TOPE_MS, type ReciboTope, type ResultadoTope, type TopeDurable } from "../../src/lib/topes/tope-durable";
import { cerrarBasesCompartidas, crearBaseDoble, crearBasePg, crearBasePglite, crearEspia, crearMemoria, DIA_MS, urlDePruebaPg, type BaseDePrueba, type ModoBase } from "../lib/topes-bases-de-prueba";

const DIR_PGLITE = process.env.PGLITE_DIR;
const URL_PG = urlDePruebaPg();
const HUELLA = "ab".repeat(32);

const espia = crearEspia();
const soloFallos = () => espia.reglas("regla:tope_durable_caido");
const instancia = (base: BaseDePrueba) => crearTopeDurable({ proveedor: async () => base.consulta, registrar: espia.registrar });
type Toma = Awaited<ReturnType<TopeDurable["tomar"]>>;
const contarOk = (resultados: Toma[]): number => resultados.filter((r) => r.toma.ok).length;
const sinRecibo = (toma: ResultadoTope): ResultadoTope => (toma.ok ? { ok: true, usadas: toma.usadas } : toma);
const reciboDe = (resultado: Toma): ReciboTope => {
  const { toma } = resultado;
  assert.ok(toma.ok && toma.recibo, "una toma concedida trae su recibo");
  return toma.recibo;
};
/** Una devolución que no debe tocar la memoria de la instancia. */
const sinMemoria = (): never => assert.fail("la base responde: no se toca la memoria");

async function esperarHasta(condicion: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 150 && !(await condicion()); i += 1) await new Promise((resolver) => setTimeout(resolver, 20));
}

beforeEach(() => { espia.registros.length = 0; });
after(cerrarBasesCompartidas);

function escenarios(titulo: string, abrir: () => Promise<BaseDePrueba>, omitir?: string): void {
  describe(titulo, { skip: omitir }, () => {
    let base: BaseDePrueba;
    beforeEach(async () => { base = await abrir(); });
    afterEach(async () => { await base.vaciar(); });

    it("dos instancias que compiten por el tope reparten exactamente `tope` tomas", async () => {
      const tope = 12;
      const [a, b] = [instancia(base), instancia(base)];
      const [memA, memB] = [crearMemoria(tope), crearMemoria(tope)];
      const resultados = await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? b : a).tomar("fotos_hora", tope, i % 2 ? memB : memA)));
      assert.equal(contarOk(resultados), tope);
      assert.ok(resultados.every((r) => r.origen === "base"), "todas se contaron en la base");
      assert.equal(await base.leer("fotos_hora"), tope);
      const negadas = resultados.filter((r) => !r.toma.ok);
      assert.ok(negadas.every((r) => !r.toma.ok && r.toma.usadas === tope && r.toma.tope === tope), "lo negado dice que ya van `tope`");
    });

    it("una ráfaga de 50 tomas simultáneas desde 5 instancias concede exactamente `tope`, en cada clave", async () => {
      const tope = 20;
      const instancias = Array.from({ length: 5 }, () => instancia(base));
      const memoria = crearMemoria(1_000);
      const claves = ["fotos_hora", `imagenes_navegador:${HUELLA}`, "escena_ia_hora"];
      const resultados = await Promise.all(claves.flatMap((clave) => Array.from({ length: 50 }, (_, i) => instancias[i % 5]!.tomar(clave, tope, memoria).then((r) => ({ clave, r })))));
      for (const clave of claves) {
        const deLaClave = resultados.filter((x) => x.clave === clave).map((x) => x.r);
        assert.equal(deLaClave.length, 50);
        assert.equal(contarOk(deLaClave), tope, clave);
        assert.ok(deLaClave.every((r) => r.origen === "base"));
        assert.equal(await base.leer(clave), tope, clave);
      }
    });

    it("tres instancias con claves y topes distintos no se mezclan", async () => {
      const instancias = [instancia(base), instancia(base), instancia(base)];
      const memoria = crearMemoria(1_000);
      const pedidos = Array.from({ length: 30 }, (_, i) => ({ clave: i % 2 ? "fotos_hora" : `imagenes_navegador:${HUELLA}`, tope: i % 2 ? 4 : 5 }));
      const resultados = await Promise.all(pedidos.map((p, i) => instancias[i % 3]!.tomar(p.clave, p.tope, memoria)));
      const deLaClave = (clave: string) => resultados.filter((_, i) => pedidos[i]!.clave === clave);
      assert.equal(contarOk(deLaClave("fotos_hora")), 4);
      assert.equal(contarOk(deLaClave(`imagenes_navegador:${HUELLA}`)), 5);
    });

    it("la ventana se abre en la primera toma y vuelve a abrirse pasada la hora", async () => {
      const tope = 3;
      const tomador = instancia(base);
      const memoria = crearMemoria(tope);
      for (let i = 1; i <= tope; i += 1) assert.deepEqual(sinRecibo((await tomador.tomar("fotos_hora", tope, memoria)).toma), { ok: true, usadas: i });
      assert.deepEqual((await tomador.tomar("fotos_hora", tope, memoria)).toma, { ok: false, usadas: tope, tope });
      await base.envejecer("fotos_hora", VENTANA_TOPE_MS / 2);
      assert.equal((await tomador.tomar("fotos_hora", tope, memoria)).toma.ok, false, "a media hora sigue la misma ventana");
      await base.envejecer("fotos_hora", VENTANA_TOPE_MS);
      assert.deepEqual(sinRecibo((await tomador.tomar("fotos_hora", tope, memoria)).toma), { ok: true, usadas: 1 }, "pasada la hora, ventana nueva");
      assert.equal(await base.leer("fotos_hora"), 1);
    });

    it("dos instancias que llegan juntas al cambio de ventana siguen sin pasarse del tope", async () => {
      const tope = 5;
      const [a, b] = [instancia(base), instancia(base)];
      const memoria = crearMemoria(1_000);
      for (let i = 0; i < tope; i += 1) await a.tomar("fotos_hora", tope, memoria);
      await base.envejecer("fotos_hora", VENTANA_TOPE_MS + 1_000);
      const resultados = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? b : a).tomar("fotos_hora", tope, memoria)));
      assert.equal(contarOk(resultados), tope);
      assert.equal(await base.leer("fotos_hora"), tope);
    });

    it("devolver con el recibo libera su toma, nunca baja de cero y no toca otras claves", async () => {
      const tomador = instancia(base);
      const memoria = crearMemoria(1_000);
      await tomador.tomar("a", 2, memoria);
      const segunda = await tomador.tomar("a", 2, memoria);
      await tomador.tomar("b", 2, memoria);
      assert.equal((await tomador.tomar("a", 2, memoria)).toma.ok, false);
      await tomador.devolver("a", reciboDe(segunda), sinMemoria);
      assert.equal(await base.leer("a"), 1);
      assert.equal(await base.leer("b"), 1);
      const tercera = await tomador.tomar("a", 2, memoria);
      assert.deepEqual(sinRecibo(tercera.toma), { ok: true, usadas: 2 });
      for (let i = 0; i < 4; i += 1) await tomador.devolver("a", reciboDe(tercera), sinMemoria);
      assert.equal(await base.leer("a"), 0, "con 0 no se baja más");
    });

    it("una devolución de la hora anterior no toca la hora vigente", async () => {
      const tomador = instancia(base);
      const memoria = crearMemoria(1_000);
      await tomador.tomar("escena_ia_hora", 5, memoria);
      const deLaHoraVieja = await tomador.tomar("escena_ia_hora", 5, memoria);
      await base.envejecer("escena_ia_hora", VENTANA_TOPE_MS + 1_000);
      await tomador.tomar("escena_ia_hora", 5, memoria);
      assert.equal(await base.leer("escena_ia_hora"), 1);
      await tomador.devolver("escena_ia_hora", reciboDe(deLaHoraVieja), sinMemoria);
      assert.equal(await base.leer("escena_ia_hora"), 1, "la hora nueva conserva su toma: la devolución era de la otra");
    });

    it("la ventana del recibo vuelve a la base sin perder microsegundos: veinte tomas y devoluciones seguidas", async () => {
      const tomador = instancia(base);
      const memoria = crearMemoria(1_000);
      for (let i = 0; i < 20; i += 1) {
        const toma = await tomador.tomar("imagenes_navegador:" + HUELLA, 6, memoria);
        assert.equal(await base.leer("imagenes_navegador:" + HUELLA), 1, `toma ${i}`);
        await tomador.devolver("imagenes_navegador:" + HUELLA, reciboDe(toma), sinMemoria);
        assert.equal(await base.leer("imagenes_navegador:" + HUELLA), 0, `devolución ${i}`);
      }
    });

    it("limpia los contadores sin uso hace más de un día y deja los recientes", async () => {
      await base.plantar("imagenes_navegador:vieja", 6, 2 * DIA_MS);
      await base.plantar("imagenes_navegador:reciente", 2, 60_000);
      await instancia(base).tomar("fotos_hora", 30, crearMemoria(30));
      await esperarHasta(async () => (await base.leer("imagenes_navegador:vieja")) === null);
      assert.equal(await base.leer("imagenes_navegador:vieja"), null);
      assert.equal(await base.leer("imagenes_navegador:reciente"), 2);
    });
  });
}

escenarios("contra el doble en memoria de la sentencia", async () => crearBaseDoble());
escenarios("contra Postgres real (PGlite) con la migración 035", () => crearBasePglite(DIR_PGLITE!), DIR_PGLITE ? undefined : "sin PGLITE_DIR: no se corre contra PGlite");
escenarios("contra un pg.Pool de 8 conexiones (Postgres local de la CI)", () => crearBasePg(URL_PG!), URL_PG ? undefined : "sin base de pruebas local: ni CI=true ni TOPES_TEST_DATABASE_URL");

describe("el defecto que se corrige", () => {
  it("con el contador solo en memoria, dos instancias se pasan del tope (el doble)", async () => {
    const tope = 12;
    const sinBase = (): TopeDurable => crearTopeDurable({ proveedor: async () => null, registrar: espia.registrar });
    const [a, b] = [sinBase(), sinBase()];
    const [memA, memB] = [crearMemoria(tope), crearMemoria(tope)];
    const resultados = await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? b : a).tomar("fotos_hora", tope, i % 2 ? memB : memA)));
    assert.equal(contarOk(resultados), 2 * tope, "cada instancia tiene su propio tope: el límite por hora no era real");
  });
});

describe("comportamiento idéntico al contador en memoria de hoy", () => {
  const semilla = (n: number): (() => number) => { let x = n; return () => { x = (x * 1_103_515_245 + 12_345) % 2_147_483_648; return x / 2_147_483_648; }; };

  it("fotos por hora: la misma respuesta que `tomarFotoDeLaHora`, paso a paso, con saltos de tiempo al azar", async () => {
    const base = crearBaseDoble();
    const tomador = instancia(base);
    const azar = semilla(7);
    reiniciarFotosPorHora();
    let t = 5_000_000;
    for (let i = 0; i < 400; i += 1) {
      t += Math.floor(azar() * 1_400_000);
      base.estado.ahora = t;
      const esperado = tomarFotoDeLaHora(t, 7);
      const { toma, origen } = await tomador.tomar("fotos_hora", 7, sinMemoria);
      assert.equal(origen, "base");
      assert.deepEqual(sinRecibo(toma), esperado, `paso ${i}`);
    }
  });

  it("imágenes por navegador: la misma respuesta que `tomarImagenDeNavegador`, y devolver la última toma en su hora igual que `devolverImagenDeNavegador`", async () => {
    const base = crearBaseDoble();
    const tomador = instancia(base);
    const azar = semilla(11);
    reiniciarImagenesPorNavegador();
    const clave = `imagenes_navegador:${HUELLA}`;
    let t = 9_000_000;
    for (let i = 0; i < 400; i += 1) {
      t += Math.floor(azar() * 1_000_000);
      base.estado.ahora = t;
      const esperado = tomarImagenDeNavegador(HUELLA, t, 6);
      const hecha = await tomador.tomar(clave, 6, sinMemoria);
      assert.deepEqual(sinRecibo(hecha.toma), esperado, `paso ${i}`);
      if (hecha.toma.ok && azar() < 0.25) {
        devolverImagenDeNavegador(HUELLA);
        await tomador.devolver(clave, reciboDe(hecha), sinMemoria);
      }
    }
  });
});

describe("si la base falla, ni se bloquea al cliente ni queda la llamada de pago sin tope", () => {
  const caida = (modo: ModoBase, opciones: { plazoMs?: number } = {}) => {
    const base = crearBaseDoble();
    base.estado.modo = modo;
    const reloj = { ahora: 1_000 };
    const tomador = crearTopeDurable({ proveedor: async () => base.consulta, reloj: () => reloj.ahora, plazoMs: opciones.plazoMs ?? 25, registrar: espia.registrar });
    return { base, reloj, tomador };
  };

  it("Neon caído: cuenta en memoria, respeta el tope de la instancia y lo deja en el registro una sola vez", async () => {
    const { base, tomador } = caida("caida");
    const memoria = crearMemoria(30);
    const resultados: Toma[] = [];
    for (let i = 0; i < 100; i += 1) resultados.push(await tomador.tomar("fotos_hora", 30, memoria));
    assert.equal(contarOk(resultados), 30, "nunca más del tope de la instancia, aunque la base no responda");
    assert.ok(resultados.every((r) => r.origen === "memoria"));
    assert.equal(base.sentencias.length, 1, "tras el fallo no se vuelve a consultar durante la pausa");
    assert.equal(soloFallos().length, 1);
    assert.deepEqual(soloFallos()[0]!.resultado, { tope: "fotos_hora", causa: "connect ECONNREFUSED 127.0.0.1:5432", pausaSeg: PAUSA_TRAS_FALLO_MS / 1000 });
  });

  it("la clave de un navegador no llega al registro: solo el nombre del tope", async () => {
    const { tomador } = caida("caida");
    await tomador.tomar(`imagenes_navegador:${HUELLA}`, 6, crearMemoria(6));
    assert.equal(soloFallos().length, 1);
    assert.ok(!JSON.stringify(soloFallos()[0]).includes(HUELLA));
    assert.equal((soloFallos()[0]!.resultado as { tope: string }).tope, "imagenes_navegador");
  });

  it("Neon colgado: la toma vuelve a los `plazoMs`, no se queda esperando, y la siguiente ni lo intenta", async () => {
    const { base, tomador } = caida("colgada", { plazoMs: 30 });
    const inicio = performance.now();
    const primera = await tomador.tomar("fotos_hora", 5, crearMemoria(5));
    const tardo = performance.now() - inicio;
    assert.equal(primera.origen, "memoria");
    assert.equal(primera.toma.ok, true);
    assert.ok(tardo >= 25 && tardo < 1_000, `la espera está acotada por el plazo (${Math.round(tardo)} ms)`);
    const segundaDesde = performance.now();
    await tomador.tomar("fotos_hora", 5, crearMemoria(5));
    assert.ok(performance.now() - segundaDesde < tardo, "con la pausa abierta una Neon lenta no suma su plazo a cada petición");
    assert.equal(base.sentencias.length, 1);
  });

  it("la consulta recibe el plazo entero para que ni la conexión pueda pasarse de él", async () => {
    const plazos: Array<number | undefined> = [];
    const tomador = crearTopeDurable({ proveedor: async () => async (sql, _valores, plazoMs) => { if (sql === SQL_TOMAR_TOPE) plazos.push(plazoMs); return { rows: [{ usadas: 1, ventana: "v" }] }; }, plazoMs: 40, registrar: espia.registrar });
    await tomador.tomar("fotos_hora", 5, crearMemoria(5));
    assert.deepEqual(plazos, [40]);
  });

  it("la tabla sin migrar tiene su propia regla, un aviso fuerte una sola vez por proceso y una pausa larga", async () => {
    const { base, reloj, tomador } = caida("tabla_inexistente");
    const errores: string[] = [];
    const original = console.error;
    console.error = (...partes: unknown[]) => { errores.push(partes.map(String).join(" ")); };
    try {
      assert.deepEqual(sinRecibo((await tomador.tomar("fotos_hora", 3, crearMemoria(3))).toma), { ok: true, usadas: 1 });
      assert.equal(soloFallos().length, 0, "no se confunde con una caída de Neon");
      assert.equal(espia.reglas("regla:tope_durable_sin_tabla").length, 1);
      assert.deepEqual(espia.reglas("regla:tope_durable_sin_tabla")[0]!.resultado, { tope: "fotos_hora", codigo: "42P01", pausaSeg: PAUSA_SIN_TABLA_MS / 1000 });
      reloj.ahora += PAUSA_TRAS_FALLO_MS;
      await tomador.tomar("fotos_hora", 3, crearMemoria(3));
      assert.equal(base.sentencias.length, 1, "a los 30 s no vuelve a mirar: la pausa es la larga");
      reloj.ahora += PAUSA_SIN_TABLA_MS;
      await tomador.tomar("fotos_hora", 3, crearMemoria(3));
      assert.equal(base.sentencias.length, 2);
      assert.equal(espia.reglas("regla:tope_durable_sin_tabla").length, 2, "cada vez que se mira y sigue sin tabla queda en el registro");
      assert.equal(errores.length, 1, "pero el console.error sale una sola vez");
      assert.match(errores[0]!, /topes_gasto.*035/);
    } finally {
      console.error = original;
    }
  });

  it("una columna que falta (42703) cuenta igual que la tabla sin migrar", async () => {
    const tomador = crearTopeDurable({
      proveedor: async () => async () => { throw Object.assign(new Error('column "ventana_inicio" does not exist'), { code: "42703" }); },
      registrar: espia.registrar,
    });
    const original = console.error;
    console.error = () => undefined;
    try { await tomador.tomar("fotos_hora", 3, crearMemoria(3)); } finally { console.error = original; }
    assert.equal(espia.reglas("regla:tope_durable_sin_tabla").length, 1);
  });

  it("una respuesta que no es un contador se trata como fallo, no como permiso", async () => {
    const { tomador } = caida("malformada");
    const memoria = crearMemoria(2);
    const resultados: Toma[] = [];
    for (let i = 0; i < 5; i += 1) resultados.push(await tomador.tomar("fotos_hora", 2, memoria));
    assert.equal(contarOk(resultados), 2);
    assert.equal(soloFallos().length, 1);
  });

  it("si el proveedor mismo falla (no se pudo abrir el pool) también cae a memoria", async () => {
    const tomador = crearTopeDurable({ proveedor: async () => { throw new Error("DATABASE_URL no está configurada"); }, registrar: espia.registrar });
    assert.deepEqual(sinRecibo((await tomador.tomar("fotos_hora", 3, crearMemoria(3))).toma), { ok: true, usadas: 1 });
    assert.equal(soloFallos().length, 1);
  });

  it("al vencer la pausa solo UNA toma sondea; las demás siguen en memoria hasta que la base responda", async () => {
    const { base, reloj, tomador } = caida("caida");
    await tomador.tomar("fotos_hora", 30, crearMemoria(30));
    base.estado.modo = "normal";
    reloj.ahora += PAUSA_TRAS_FALLO_MS - 1;
    assert.equal((await tomador.tomar("fotos_hora", 30, crearMemoria(30))).origen, "memoria", "dentro de la pausa");
    reloj.ahora += 1;
    const antes = base.sentencias.length;
    const resultados = await Promise.all(Array.from({ length: 6 }, () => tomador.tomar("fotos_hora", 30, crearMemoria(30))));
    assert.equal(resultados.filter((r) => r.origen === "base").length, 1, "solo el sondeo llega a la base");
    assert.equal(base.sentencias.slice(antes).filter((s) => s === SQL_TOMAR_TOPE).length, 1);
    assert.equal((await tomador.tomar("fotos_hora", 30, crearMemoria(30))).origen, "base", "respondió: vuelve a contar en la base");
    assert.equal(soloFallos().length, 1);
  });

  it("si el sondeo también falla, la pausa vuelve a cerrarse y se registra otra vez", async () => {
    const { base, reloj, tomador } = caida("caida");
    await tomador.tomar("fotos_hora", 30, crearMemoria(30));
    reloj.ahora += PAUSA_TRAS_FALLO_MS;
    await tomador.tomar("fotos_hora", 30, crearMemoria(30));
    assert.equal(soloFallos().length, 2);
    const antes = base.sentencias.length;
    await tomador.tomar("fotos_hora", 30, crearMemoria(30));
    assert.equal(base.sentencias.length, antes, "pausa nueva: no consulta");
  });

  it("un tope menor que 1 no concede nada y no consulta la base", async () => {
    const base = crearBaseDoble();
    const { toma, origen } = await instancia(base).tomar("fotos_hora", 0, crearMemoria(0));
    assert.deepEqual({ toma, origen }, { toma: { ok: false, usadas: 0, tope: 0 }, origen: "memoria" });
    assert.equal(base.sentencias.length, 0);
  });

  describe("las devoluciones van al mismo contador de donde salió la toma", () => {
    it("una toma de memoria (la base estaba caída) se devuelve en memoria aunque la base ya haya vuelto, sin consultarla", async () => {
      const { base, reloj, tomador } = caida("caida");
      const memoria = crearMemoria(5);
      const deMemoria = await tomador.tomar("imagenes_navegador:" + HUELLA, 5, memoria);
      assert.deepEqual(reciboDe(deMemoria), { origen: "memoria" });
      base.estado.modo = "normal";
      reloj.ahora += PAUSA_TRAS_FALLO_MS;
      const antes = base.sentencias.length;
      let devueltas = 0;
      await tomador.devolver("imagenes_navegador:" + HUELLA, reciboDe(deMemoria), () => { devueltas += 1; });
      assert.equal(devueltas, 1);
      assert.equal(base.sentencias.length, antes, "la base no sabe de esa toma: no se le quita nada");
    });

    it("una toma de la base no se devuelve en la memoria: si la base ya no responde, la devolución se pierde y el contador cuenta de más", async () => {
      const { base, tomador } = caida("normal");
      const deLaBase = await tomador.tomar("imagenes_navegador:" + HUELLA, 5, crearMemoria(5));
      assert.equal(deLaBase.origen, "base");
      base.estado.modo = "caida";
      await tomador.devolver("imagenes_navegador:" + HUELLA, reciboDe(deLaBase), sinMemoria);
      assert.equal(soloFallos().length, 1, "queda en el registro");
      assert.equal(await base.leer("imagenes_navegador:" + HUELLA), 1, "la toma sigue contada");
    });

    it("con la base en pausa una devolución de la base no consulta ni toca la memoria", async () => {
      const { base, tomador } = caida("normal");
      const deLaBase = await tomador.tomar("a", 5, crearMemoria(5));
      base.estado.modo = "caida";
      await tomador.tomar("b", 5, crearMemoria(5));
      const antes = base.sentencias.length;
      await tomador.devolver("a", reciboDe(deLaBase), sinMemoria);
      assert.equal(base.sentencias.length, antes);
    });
  });
});
