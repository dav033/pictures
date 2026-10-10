/**
 * Arnés de entrenamiento (W4): pasada por foto, puntuación y tope de gasto, con el camino real de la app y el transporte
 * de la guarda en seco (respuestas grabadas, coste simulado; sin red):
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-entrenamiento-pasada.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(tmpdir(), "entrenamiento-pasada-"));
Object.assign(process.env, {
  NODE_ENV: "development", IA_PROVEEDOR: "claude", ANTHROPIC_API_KEY: "seco-sin-llave",
  TALLER_RAG_ENABLED: "false", RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED: "false",
  REGISTRO_ACTIVO: "1", REGISTRO_DIR: path.join(tmp, "registro"), REGISTRO_NIVEL_STDOUT: "error",
});
delete process.env.VERCEL;
delete process.env.GEMINI_API_KEY;
delete process.env.FAL_KEY;
delete process.env.DATABASE_URL;

async function main(): Promise<void> {
let pruebas = 0;
const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const { default: sharp } = await import("sharp");
const { compilarLectura } = await import("../../src/lib/globos3d/compilar-lectura");
const { LecturaFotoSchema } = await import("../../src/lib/globos3d/lectura-foto");
const { CAJAS_DETECCION_SECO, LECTURA_SECO } = await import("../entrenamiento/fixtures/lectura-seco");
const { puntuarEscena } = await import("../entrenamiento/lib-puntuacion");
const { instalarGuardaRed } = await import("../entrenamiento/lib-red");
const red = instalarGuardaRed("seco", {});
const { ContadorLlamadas, RESERVA_LLAMADA_FALLIDA_USD } = await import("../entrenamiento/lib-contador");
const { CupoGasto } = await import("../entrenamiento/lib-cupo-gasto");
const { idConversacionDePasada, pasadaDeFoto } = await import("../entrenamiento/lib-pasada");
const { claveDeteccion } = await import("../entrenamiento/lib-cache-deteccion");
const { observarLlamadasIa } = await import("../../src/lib/registro/observadores-llamadas");
const { esperarRegistros } = await import("../../src/lib/registro/escritor");

const deteccionSeca = { globos: CAJAS_DETECCION_SECO.map((c) => ({ box_2d: [...c.box_2d], color: c.color })), fondos: [], uso: { entrada: 0, salida: 0, pensamiento: 0 }, costeEstimadoUsd: 0, trozos: 1, fallidos: 0, racimos: { revisadas: 0, quitadas: 0 } };
const lecturaSeca = LecturaFotoSchema.parse(LECTURA_SECO);
const fotoJpeg = new Uint8Array(await sharp({ create: { width: 400, height: 300, channels: 3, background: "#eeeeee" } }).jpeg().toBuffer());

const opciones = (nombre: string, contador: InstanceType<typeof ContadorLlamadas>, dirCache: string, modo: "seco" | "real" = "seco") => ({
  corrida: "2026-10-10T00-00-00-000Z", nombre, bytes: fotoJpeg, turnos: 1, contador, modo, transporte: "seco" as const,
  modelo: "claude-haiku-5-5", esfuerzo: "medium", pensamiento: true, commit: "test", dirCacheDeteccion: dirCache,
});

console.log("Pasada, puntuación y tope de gasto (arnés W4):");

await prueba("la puntuación mide una escena con globos y da 0 con una escena sin globos armados", () => {
  const escena = compilarLectura(lecturaSeca).escena;
  const medida = puntuarEscena({ lectura: lecturaSeca, escena, deteccion: deteccionSeca });
  assert.equal(medida.escenaVacia, false);
  assert.equal(medida.piezas.globosFoto, 3);
  assert.ok(medida.piezas.globosArmados > 0);
  assert.ok(typeof medida.puntajes.proporciones === "number" && medida.puntajes.proporciones >= 0 && medida.puntajes.proporciones <= 1);
  const vacia = puntuarEscena({ lectura: lecturaSeca, escena: { ...escena, nodos: [] }, deteccion: deteccionSeca });
  assert.equal(vacia.escenaVacia, true);
  assert.equal(vacia.puntajes.proporciones, 0);
  assert.throws(() => puntuarEscena({ lectura: lecturaSeca, escena, deteccion: { ...deteccionSeca, globos: [] } }));
});

await prueba("una pasada completa en seco por el camino del Taller: escena, vueltas, coste, llamadas y sin caché", async () => {
  red.ajustar({});
  const contador = new ContadorLlamadas(new CupoGasto(1), 400, "seco");
  contador.activar();
  try {
    const dir = path.join(tmp, "cache-seco");
    const r = await pasadaDeFoto(opciones("images (25).jpg", contador, dir));
    assert.equal(r.registro.error, null);
    assert.equal(r.registro.abortada, null);
    assert.equal(r.topeAlcanzado, false);
    assert.ok(r.escena && r.escena.nodos.length > 0, "la escena armada se devuelve");
    assert.equal(r.registro.turnos, 1);
    assert.equal(r.registro.turnosMax, 1);
    assert.ok(r.registro.llamadas >= 3, "lectura, detección y una vuelta del asistente");
    assert.equal(r.registro.deteccionCacheada, false);
    assert.equal(r.registro.transporte, "seco");
    assert.ok(r.registro.costeUsd > 0, "el coste simulado se cuenta por llamada");
    assert.deepEqual(r.registro.fallos, []);
    assert.equal(existsSync(dir), false, "el modo seco nunca escribe la caché de la detección");
    const segunda = await pasadaDeFoto(opciones("images (25).jpg", new ContadorLlamadas(new CupoGasto(1), 400, "seco"), dir));
    assert.equal(segunda.registro.deteccionCacheada, false, "ni la lee: cada pasada en seco detecta de nuevo");
  } finally {
    contador.desactivar();
  }
});

await prueba("en real la detección se cachea por foto; una detección grabada del seco (clave de antes) no se usa como verdad", async () => {
  red.ajustar({});
  const dir = path.join(tmp, "cache-real");
  mkdirSync(dir);
  const claveAntigua = createHash("sha256").update(fotoJpeg).update("|claude-haiku-5-5").digest("hex").slice(0, 32);
  writeFileSync(path.join(dir, `${claveAntigua}.json`), JSON.stringify(deteccionSeca));
  const corrida = async (): Promise<Awaited<ReturnType<typeof pasadaDeFoto>>> => {
    const contador = new ContadorLlamadas(new CupoGasto(1), 400, "seco");
    contador.activar();
    try {
      return await pasadaDeFoto({ ...opciones("images (25).jpg", contador, dir, "real"), turnos: 0 });
    } finally {
      contador.desactivar();
    }
  };
  const primera = await corrida();
  assert.equal(primera.registro.deteccionCacheada, false, "la entrada del seco no cuenta");
  assert.equal(primera.registro.modo, "real");
  assert.equal(readdirSync(dir).length, 2, "la detección real se guarda con su propia clave");
  const segunda = await corrida();
  assert.equal(segunda.registro.deteccionCacheada, true);
  assert.ok(segunda.registro.llamadas < primera.registro.llamadas, "la detección cacheada no vuelve a llamar");
  assert.notEqual(claveDeteccion({ bytes: fotoJpeg, modo: "real", transporte: "seco", modelo: "claude-haiku-5-5", esfuerzo: "medium", pensamiento: true, ladoLectura: 1536 }), claveAntigua);
});

await prueba("en real una detección hecha con una llamada fallida o cortada no se guarda como verdad", async () => {
  const corrida = async (dir: string, fallarLlamada?: number) => {
    red.ajustar(fallarLlamada === undefined ? {} : { fallarLlamada });
    const contador = new ContadorLlamadas(new CupoGasto(1), 400, "seco");
    contador.activar();
    try {
      await pasadaDeFoto({ ...opciones("images (25).jpg", contador, dir, "real"), turnos: 0 });
    } finally {
      contador.desactivar();
    }
    return red.servidas();
  };
  const limpia = path.join(tmp, "cache-limpia");
  const llamadas = await corrida(limpia);
  assert.equal(readdirSync(limpia).length, 1, "sin fallos la detección se guarda");
  assert.ok(llamadas >= 10, `lectura, nueve trozos y fondos: ${llamadas}`);
  for (let k = 1; k <= llamadas; k += 1) {
    const dir = path.join(tmp, `cache-fallo-${k}`);
    await corrida(dir, k);
    assert.equal(existsSync(dir), false, `con la llamada ${k} fallida (trozo, fondos o lectura) no se guarda ninguna detección`);
  }
});

await prueba("todos los eventos de IA de una pasada caen en su propia conversación de auditoría", async () => {
  red.ajustar({});
  const contador = new ContadorLlamadas(new CupoGasto(1), 400, "seco");
  contador.activar();
  try {
    const opts = opciones("images (31).jpg", contador, path.join(tmp, "cache-audit"));
    await pasadaDeFoto(opts);
    await esperarRegistros();
    const idEsperado = idConversacionDePasada(opts.corrida, opts.nombre);
    assert.equal(idEsperado, "entrenamiento-2026-10-10T00-00-00-000Z-images-31");
    const raiz = path.join(tmp, "registro", "conversaciones");
    const archivos = readdirSync(raiz).flatMap((dia) => readdirSync(path.join(raiz, dia)).map((f) => ({ f, ruta: path.join(raiz, dia, f) })));
    const llamadas = archivos.map(({ f, ruta }) => ({ f, n: readFileSync(ruta, "utf8").split("\n").filter((l) => l.includes('"llamada_ia"')).length }));
    const conLlamadas = llamadas.filter(({ n }) => n > 0).map(({ f }) => f);
    assert.ok(conLlamadas.includes(`${idEsperado}.jsonl`));
    assert.ok(conLlamadas.every((f) => f.startsWith("entrenamiento-")), `ninguna llamada queda sin conversación: ${JSON.stringify(llamadas)}`);
    assert.ok(llamadas.find(({ f }) => f === `${idEsperado}.jsonl`)!.n >= 3, "lectura, detección y la vuelta del asistente");
  } finally {
    contador.desactivar();
  }
});

await prueba("al cruzar el tope se aborta la petición en curso, no sale ninguna petición después y se conserva la escena del turno pagado", async () => {
  // Cada llamada cuesta ~0,10 USD (un millón de tokens de entrada): con un tope de 0,15 USD, la segunda ya lo cruza.
  const contador = new ContadorLlamadas(new CupoGasto(0.15), 400, "seco");
  red.ajustar({ uso: { input_tokens: 1_000_000, output_tokens: 0 }, parado: () => contador.paro });
  let servidasAlCruzar: number | null = null;
  contador.activar();
  // Después del contador: en el cierre que cruza el tope ya ve el paro y anota cuántas peticiones habían salido hasta ahí.
  const quitar = observarLlamadasIa(() => { if (contador.paro !== null && servidasAlCruzar === null) servidasAlCruzar = red.servidas(); });
  try {
    const r = await pasadaDeFoto(opciones("images (26).jpg", contador, path.join(tmp, "cache-b")));
    assert.equal(r.topeAlcanzado, true);
    assert.ok(r.registro.abortada && r.registro.abortada.includes("Tope de gasto"), `abortada: ${r.registro.abortada}`);
    assert.ok(r.registro.costeUsd > 0.15, "la llamada que cruza el tope queda contada");
    assert.ok(r.escena, "la escena de la foto (turno ya pagado) se conserva");
    assert.equal(contador.margen(), false);
    await new Promise((resolver) => setTimeout(resolver, 50));
    assert.notEqual(servidasAlCruzar, null, "el tope se cruzó");
    assert.equal(red.servidas(), servidasAlCruzar, "tras cruzar el tope no se sirvió ni se envió ninguna petición más");
  } finally {
    quitar();
    contador.desactivar();
  }
});

await prueba("al llegar al máximo de llamadas la pasada se anota como abortada por ese motivo", async () => {
  const contador = new ContadorLlamadas(new CupoGasto(1), 2, "seco");
  red.ajustar({ parado: () => contador.paro });
  contador.activar();
  try {
    const r = await pasadaDeFoto(opciones("images (29).jpg", contador, path.join(tmp, "cache-max")));
    assert.match(r.registro.abortada ?? "", /máximo de llamadas \(2\)/);
    assert.equal(r.topeAlcanzado, true);
    assert.equal(contador.margen(), false);
  } finally {
    contador.desactivar();
  }
});

await prueba("una llamada fallida se carga con reserva y la foto se anota como lectura fallida", async () => {
  red.ajustar({ fallarLlamada: 1 });
  const contador = new ContadorLlamadas(new CupoGasto(1), 400, "seco");
  contador.activar();
  try {
    const r = await pasadaDeFoto(opciones("images (27).jpg", contador, path.join(tmp, "cache-c")));
    assert.ok(r.registro.costeUsd >= RESERVA_LLAMADA_FALLIDA_USD, "la llamada fallida cuenta la reserva");
    assert.ok(r.registro.fallos.includes("lectura") || r.registro.fallos.includes("medida"), `fallos: ${r.registro.fallos}`);
  } finally {
    contador.desactivar();
  }
});

await prueba("un modelo sin precio para la pasada: el contador para y no vuelve a gastar", () => {
  const cupo = new CupoGasto(1);
  const contador = new ContadorLlamadas(cupo, 400, "api");
  const controlador = new AbortController();
  contador.vigilar(controlador);
  contador.observar({ proveedor: "claude", proposito: "x", modelo: "modelo-sin-precio", error: false, interrumpida: false });
  assert.match(contador.paro ?? "", /sin precio/);
  assert.equal(controlador.signal.aborted, true);
  assert.equal(contador.margen(), false);
  assert.equal(cupo.gastado, 0);
});

  red.restaurar();
  await esperarRegistros();
  rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pruebas} pruebas de la pasada, la puntuación y el tope: OK`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
