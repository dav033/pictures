import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDetectedStructure } from "../src/lib/ia/reference-structure";
import { ejecutarCli, leerArgumentos, type DependenciasCli } from "../src/lib/eval/estructuras/cli-reconocimiento";
import type { Analizador } from "../src/lib/eval/estructuras/runner";

/**
 * Plan A §A0.3: recognition runner CLI gates with simulated I/O — preview by
 * default, explicit budget and private raw storage to spend, telemetry disabled
 * before any analyzer exists, and resume guarded by system version.
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
const suite = { suite_id: "dev-seed-v0", taxonomy_version: "estructuras-2.0.0", items: [1, 2].map((n) => ({ image_sha256: hash(n), ruta_privada: `20_sanitized/${n}.jpg`, evaluacion_con_proveedor_externo: true, envio_proveedores_ia_permitido: true })) };
const sistema = { modelo: "gemini-3.6-flash", thinkingLevel: "default", systemPromptSha256: "a".repeat(64), configHash: "b".repeat(64), parserVersion: "semantic-layers-v13-box-2d" };

function entorno(opciones: { commit?: string; archivos?: Map<string, string> } = {}) {
  const archivos = opciones.archivos ?? new Map<string, string>([
    [resolve(REPO, "suite.json"), JSON.stringify(suite)],
    ["eval/estructuras/precios/2026-09-15.json", readFileSync("eval/estructuras/precios/2026-09-15.json", "utf8")],
    ["eval/estructuras/supuestos/tokens-analisis-2026-09-15.json", readFileSync("eval/estructuras/supuestos/tokens-analisis-2026-09-15.json", "utf8")],
  ]);
  const eventos: string[] = [];
  let llamadas = 0;
  const analizar: Analizador = async () => {
    llamadas += 1;
    return { resultado: "ok", detecciones: [{ elementId: "REF_01_E01", bbox: { x: 0, y: 0, width: 0.5, height: 0.5 }, structure: parseDetectedStructure({ structure_type: "arch" })! }], pases: [{ capacidad: "analisis_referencia_inventario", intento: 1, ms: 10, uso: { entrada: 3300, salida: 1500 }, finishReason: "STOP", malformado: false }], rawOutputSha256: "c".repeat(64), msTotal: 10 };
  };
  const deps: DependenciasCli = {
    repo: REPO,
    leerTexto: (ruta) => archivos.get(ruta) ?? archivos.get(resolve(ruta)) ?? null,
    escribirTexto: (ruta, texto) => { archivos.set(ruta, texto); eventos.push(`escribir:${ruta.split(/[\\/]/).pop()}`); },
    anexarTexto: (ruta, texto) => { archivos.set(ruta, (archivos.get(ruta) ?? "") + texto); },
    commit: () => opciones.commit ?? "abc1234",
    ahora: () => new Date("2026-09-15T14:00:00Z"),
    desactivarTelemetriaDurable: () => { eventos.push("telemetria-desactivada"); },
    crearAnalizador: async () => { eventos.push("analizador-creado"); return { ...sistema, analizar }; },
    sistemaSinProveedor: () => sistema,
    log: (mensaje) => { eventos.push(`log:${mensaje}`); },
  };
  return { deps, archivos, eventos, llamadas: () => llamadas };
}

const base = ["--suite", resolve(REPO, "suite.json"), "--run-id", "a0-4a-prueba", "--raiz-imagenes", FUERA, "--salida", resolve(REPO, "eval/results/estructuras/a0-4a-prueba")];

async function run(): Promise<void> {
  await caso("argumentos: preview por defecto; gastar exige --max-usd y --crudos", () => {
    assert.equal(leerArgumentos(base).ejecutar, false);
    assert.throws(() => leerArgumentos([...base, "--ejecutar", "--crudos", FUERA]), /exige --max-usd/);
    assert.throws(() => leerArgumentos([...base, "--ejecutar", "--max-usd", "15"]), /exige --crudos/);
    assert.throws(() => leerArgumentos([...base, "--corridas", "cinco"]), /numérico/);
    assert.throws(() => leerArgumentos(["--run-id", "x"]), /--suite es obligatorio/);
  });

  await caso("preview: estima y escribe preview.json sin crear analizador ni tocar telemetría", async () => {
    const { deps, archivos, eventos, llamadas } = entorno();
    const salida = await ejecutarCli([...base, "--max-usd", "15"], deps);
    assert.equal(salida.modo, "preview");
    assert.equal(llamadas(), 0);
    assert.ok(!eventos.includes("analizador-creado") && !eventos.includes("telemetria-desactivada"), eventos.join(" "));
    const preview = JSON.parse(archivos.get(resolve(REPO, "eval/results/estructuras/a0-4a-prueba/preview.json"))!);
    assert.deepEqual([preview.analisis_pendientes, preview.cabe_en_presupuesto, preview.estimacion.es_estimado], [10, true, true]);
    assert.ok(eventos.some((evento) => /sin llamadas al proveedor/.test(evento)));
  });

  await caso("rutas privadas: crudos o imágenes dentro del repo se rechazan", async () => {
    const { deps } = entorno();
    await assert.rejects(ejecutarCli([...base, "--ejecutar", "--max-usd", "15", "--crudos", resolve(REPO, "crudos")], deps), /--crudos debe quedar fuera/);
    await assert.rejects(ejecutarCli([...base.slice(0, 4), "--raiz-imagenes", resolve(REPO, "data"), ...base.slice(6)], deps), /--raiz-imagenes debe quedar fuera/);
  });

  await caso("ejecución: telemetría desactivada antes del analizador; predicciones y run.json escritos", async () => {
    const { deps, archivos, eventos, llamadas } = entorno();
    const salida = await ejecutarCli([...base, "--ejecutar", "--max-usd", "15", "--crudos", FUERA, "--corridas", "2"], deps);
    assert.equal(salida.modo, "ejecucion");
    assert.ok(eventos.indexOf("telemetria-desactivada") >= 0 && eventos.indexOf("telemetria-desactivada") < eventos.indexOf("analizador-creado"), eventos.join(" "));
    assert.equal(llamadas(), 4);
    const lineas = archivos.get(resolve(REPO, "eval/results/estructuras/a0-4a-prueba/predicciones.jsonl"))!.trim().split("\n");
    assert.equal(lineas.length, 4);
    const runJson = JSON.parse(archivos.get(salida.runJsonRuta!)!);
    assert.equal(runJson.metricas_de_exactitud, "no_calculadas_sin_verdad_humana");
    assert.doesNotMatch(archivos.get(salida.runJsonRuta!)! + lineas.join(""), /20_sanitized|privado-simulado/, "no private paths in versioned outputs");
  });

  await caso("presupuesto: si la cota no cabe en --max-usd no se ejecuta ningún análisis", async () => {
    const { deps, llamadas } = entorno();
    await assert.rejects(ejecutarCli([...base, "--ejecutar", "--max-usd", "0.05", "--crudos", FUERA], deps), /supera --max-usd/);
    assert.equal(llamadas(), 0);
  });

  await caso("reanudación: continúa lo pendiente y rechaza otro commit u otra corrida", async () => {
    const primera = entorno();
    await ejecutarCli([...base, "--ejecutar", "--max-usd", "15", "--crudos", FUERA, "--corridas", "1"], primera.deps);
    const segunda = entorno({ archivos: primera.archivos });
    await ejecutarCli([...base, "--ejecutar", "--max-usd", "15", "--crudos", FUERA, "--corridas", "2"], segunda.deps);
    assert.equal(segunda.llamadas(), 2, "only the second repetition of each image runs");
    const otroCommit = entorno({ commit: "fff9999", archivos: primera.archivos });
    await assert.rejects(ejecutarCli([...base, "--ejecutar", "--max-usd", "15", "--crudos", FUERA, "--corridas", "3"], otroCommit.deps), /otra configuración o commit/);
    assert.equal(otroCommit.llamadas(), 0);
    const otraCorrida = entorno({ archivos: primera.archivos });
    await assert.rejects(ejecutarCli([...base.slice(0, 2), "--run-id", "otra", ...base.slice(4), "--ejecutar", "--max-usd", "15", "--crudos", FUERA], otraCorrida.deps), /pertenece a otra corrida/);
  });

  console.log(`[PASS] ${casos} casos de la CLI del runner`);
}

run().catch((error: unknown) => {
  console.error("[FAIL]", error);
  process.exitCode = 1;
});
