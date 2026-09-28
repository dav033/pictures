import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ejecutarCliConteo, leerArgumentosConteo, type DependenciasCliConteo } from "../../src/lib/eval/estructuras/cli-conteo";
import {
  cuentaDeLectura,
  leerPrediccionesConteo,
  leerVerdadConteo,
  metricasConteo,
  type AnalizadorConteo,
  type PrediccionConteoV1,
} from "../../src/lib/eval/estructuras/conteo";

/**
 * Runner de evaluación del conteo (ADR-0031, E2) con E/S simulada: vista previa
 * por defecto y sin analizador, tope de gasto, rutas privadas fuera del repo
 * (crudos, imágenes y verdad humana), telemetría apagada antes de crear el
 * analizador, reanudación y métricas contra la verdad. Sin red ni proveedor.
 * Run: npx tsx scripts/test/test-eval-conteo.ts
 */

let casos = 0;
async function caso(nombre: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
}

const REPO = resolve("C:/repo-simulado");
const FUERA = resolve("C:/privado-simulado");
const hash = (n: number) => n.toString(16).padStart(64, "0");
const suite = { suite_id: "conteo-seed-v0", taxonomy_version: "estructuras-2.0.0", items: [1, 2, 3].map((n) => ({ image_sha256: hash(n), ruta_privada: `conteo/${n}.jpg`, evaluacion_con_proveedor_externo: true, envio_proveedores_ia_permitido: true })) };
const sistema = { modelo: "gemini-3.6-flash", promptVersion: "conteo-referencia.v1:bfd6604c6192ab95" };
const verdad = ["sha256,globos,exacto,familia", `${hash(1)},100,no,guirnalda`, `${hash(2)},6,si,bouquet`, `${hash(3)},40,no`].join("\n");

const lectura = (extra: Record<string, unknown> = {}) => ({
  globos_visibles: 60, exacto: false, estimado_total: 90, racimos: null, globos_por_racimo: null,
  por_tamano: [], largo_relativo: null, alto_relativo: null, confianza: 0.8, ...extra,
});

function entorno(opciones: { archivos?: Map<string, string> } = {}) {
  const archivos = opciones.archivos ?? new Map<string, string>([
    [resolve(REPO, "suite.json"), JSON.stringify(suite)],
    [resolve(FUERA, "verdad.csv"), verdad],
    ["eval/estructuras/precios/2026-09-15.json", readFileSync("eval/estructuras/precios/2026-09-15.json", "utf8")],
    ["eval/estructuras/supuestos/tokens-conteo-2026-09-28.json", readFileSync("eval/estructuras/supuestos/tokens-conteo-2026-09-28.json", "utf8")],
  ]);
  const eventos: string[] = [];
  let llamadas = 0;
  const analizar: AnalizadorConteo = async (item) => {
    llamadas += 1;
    const piezas = item.image_sha256 === hash(2)
      ? [{ element_id: "REF_01_E01", tipo: "kit", estructura_oficial: "bouquet", piezas: 1, lectura: lectura({ globos_visibles: 5, exacto: true, estimado_total: null }) }]
      : [{ element_id: "REF_01_E01", tipo: "guirnalda", estructura_oficial: "guirnalda", piezas: 1, lectura: lectura() }];
    return { resultado: "ok", piezas, uso: { entrada: 6000, salida: 1800, completo: true }, rawOutputSha256: "c".repeat(64), msTotal: 12 };
  };
  const deps: DependenciasCliConteo = {
    repo: REPO,
    leerTexto: (ruta) => archivos.get(ruta) ?? archivos.get(resolve(ruta)) ?? null,
    escribirTexto: (ruta, texto) => { archivos.set(ruta, texto); eventos.push(`escribir:${ruta.split(/[\\/]/).pop()}`); },
    anexarTexto: (ruta, texto) => { archivos.set(ruta, (archivos.get(ruta) ?? "") + texto); },
    commit: () => "abc1234",
    ahora: () => new Date("2026-09-28T14:00:00Z"),
    desactivarTelemetriaDurable: () => { eventos.push("telemetria-desactivada"); },
    crearAnalizador: async () => { eventos.push("analizador-creado"); return { ...sistema, analizar }; },
    sistemaSinProveedor: () => sistema,
    log: (mensaje) => { eventos.push(`log:${mensaje}`); },
  };
  return { deps, archivos, eventos, llamadas: () => llamadas };
}

const salida = resolve(REPO, "eval/results/conteo/conteo-prueba");
const base = ["--suite", resolve(REPO, "suite.json"), "--run-id", "conteo-prueba", "--raiz-imagenes", FUERA, "--salida", salida];

async function run(): Promise<void> {
  await caso("argumentos: vista previa por defecto; gastar exige --max-usd y --crudos", () => {
    assert.equal(leerArgumentosConteo(base).ejecutar, false);
    assert.equal(leerArgumentosConteo(base).corridas, 1);
    assert.throws(() => leerArgumentosConteo([...base, "--ejecutar", "--crudos", FUERA]), /exige --max-usd/);
    assert.throws(() => leerArgumentosConteo([...base, "--ejecutar", "--max-usd", "2"]), /exige --crudos/);
    assert.throws(() => leerArgumentosConteo([...base, "--concurrencia", "dos"]), /numérico/);
  });

  await caso("vista previa: estima (tokens sin medir) sin crear analizador ni tocar telemetría", async () => {
    const { deps, archivos, eventos, llamadas } = entorno();
    const resultado = await ejecutarCliConteo([...base, "--max-usd", "2", "--verdad", resolve(FUERA, "verdad.csv")], deps);
    assert.equal(resultado.modo, "preview");
    assert.equal(llamadas(), 0);
    assert.ok(!eventos.includes("analizador-creado") && !eventos.includes("telemetria-desactivada"), eventos.join(" "));
    const vista = JSON.parse(archivos.get(resolve(salida, "preview.json"))!);
    assert.deepEqual([vista.analisis_pendientes, vista.cabe_en_presupuesto, vista.estimacion.es_estimado, vista.estimacion.supuesto_medido], [3, true, true, false]);
    assert.deepEqual(vista.verdad, { fotos_con_verdad: 3, verdad_fuera_de_la_suite: 0 });
    assert.ok(eventos.some((evento) => /sin llamadas al proveedor/.test(evento) && /tokens sin medir/.test(evento)));
  });

  await caso("rutas privadas: crudos, imágenes o verdad dentro del repo se rechazan", async () => {
    const { deps } = entorno();
    await assert.rejects(ejecutarCliConteo([...base, "--ejecutar", "--max-usd", "2", "--crudos", resolve(REPO, "crudos")], deps), /--crudos debe quedar fuera/);
    await assert.rejects(ejecutarCliConteo([...base.slice(0, 4), "--raiz-imagenes", resolve(REPO, "data"), ...base.slice(6)], deps), /--raiz-imagenes debe quedar fuera/);
    await assert.rejects(ejecutarCliConteo([...base, "--verdad", resolve(REPO, "verdad.csv")], deps), /--verdad debe quedar fuera/);
  });

  await caso("tope: una cota que no cabe no ejecuta nada", async () => {
    const { deps, llamadas } = entorno();
    await assert.rejects(ejecutarCliConteo([...base, "--ejecutar", "--max-usd", "0.0001", "--crudos", FUERA], deps), /supera --max-usd/);
    assert.equal(llamadas(), 0);
  });

  await caso("ejecución simulada: telemetría apagada antes del analizador, métricas y reanudación", async () => {
    const { deps, archivos, eventos, llamadas } = entorno();
    const argv = [...base, "--ejecutar", "--max-usd", "2", "--crudos", FUERA, "--verdad", resolve(FUERA, "verdad.csv")];
    const primera = await ejecutarCliConteo(argv, deps);
    assert.equal(primera.modo, "ejecucion");
    assert.ok(eventos.indexOf("telemetria-desactivada") < eventos.indexOf("analizador-creado"));
    assert.equal(llamadas(), 3);
    const lineas: PrediccionConteoV1[] = leerPrediccionesConteo(archivos.get(resolve(salida, "predicciones.jsonl"))!);
    assert.equal(lineas.length, 3);
    const run = JSON.parse(archivos.get(primera.runJsonRuta!)!);
    // Guirnalda: 90 frente a 100 (10 %) y la tercera foto, sin familia en la verdad, toma
    // la de su pieza predicha: 90 frente a 40 (125 %). Bouquet exacto: 5 frente a 6 (±1).
    assert.equal(run.metricas.por_familia.guirnalda.n, 2);
    assert.equal(run.metricas.por_familia.guirnalda.error_relativo_mediano, (0.1 + 1.25) / 2);
    assert.equal(run.metricas.por_familia.bouquet.exactas.dentro_1, 1);
    assert.equal(run.metricas.densas.error_relativo_mediano, (0.1 + 1.25) / 2);
    assert.equal(run.metricas.cumple.densas, false);
    assert.equal(run.costo.estimado.es_estimado, true);
    await ejecutarCliConteo(argv, deps);
    assert.equal(llamadas(), 3, "una corrida ya hecha no se repite");
  });

  await caso("verdad: formato sha256,globos,exacto[,familia] y errores con su línea", () => {
    assert.equal(leerVerdadConteo(verdad).get(hash(2))?.exacto, true);
    assert.throws(() => leerVerdadConteo(`${hash(1)},muchos,no`), /línea 1: globos/);
    assert.throws(() => leerVerdadConteo(`${hash(1)},10,quizas`), /línea 1: exacto/);
    assert.throws(() => leerVerdadConteo(`${hash(1)},10,no,cohete`), /familia desconocida/);
    assert.throws(() => leerVerdadConteo(`${hash(1)},10,no\n${hash(1)},11,no`), /repetida/);
  });

  await caso("la cuenta de una lectura: exacta, estimado, racimos y, a falta de todo, lo visible", () => {
    assert.equal(cuentaDeLectura(lectura({ exacto: true, globos_visibles: 7 }) as never), 7);
    assert.equal(cuentaDeLectura(lectura() as never), 90);
    assert.equal(cuentaDeLectura(lectura({ estimado_total: null, racimos: 20, globos_por_racimo: 4 }) as never), 80);
    assert.equal(cuentaDeLectura(lectura({ estimado_total: null }) as never), 60);
    assert.equal(metricasConteo([], new Map()).total.n, 0);
  });

  console.log(`[PASS] ${casos} casos del runner de conteo`);
}

run().catch((error: unknown) => {
  console.error("[FAIL]", error);
  process.exitCode = 1;
});
