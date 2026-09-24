import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDetectedStructure } from "../../src/lib/ia/referencia/reference-structure";
import { SupuestoTokensSchema, TablaPreciosSchema } from "../../src/lib/eval/estructuras/costo";
import { claveCorrida, ejecutarCorrida, planificarCorrida, type Analizador, type ConfiguracionRunner, type ItemSuite } from "../../src/lib/eval/estructuras/runner";
import type { PrediccionEstructurasV1 } from "../../src/lib/eval/estructuras/prediccion";
import { firmaFamilias, flipRate, percentil, resumirCorrida } from "../../src/lib/eval/estructuras/resumen-corrida";

/**
 * Plan A §A0.3: recognition runner core with simulated analyzers — preview
 * without calls, consent gate, budget, concurrency, deadlines and resume.
 */

let casos = 0;
async function caso(nombre: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
}

const tabla = TablaPreciosSchema.parse(JSON.parse(readFileSync(resolve(process.cwd(), "eval/estructuras/precios/2026-09-15.json"), "utf8")));
const supuesto = SupuestoTokensSchema.parse({
  version: "sintetico-runner", modelo: "gemini-3.6-flash", origen: "prueba", n_llamadas: 1,
  inventario: { p50: { entrada: 2000, salida: 1000, pensamiento: 0, cacheados: 0 }, p95: { entrada: 4000, salida: 2000, pensamiento: 1000, cacheados: 0 } },
  auditoria: { p50: { entrada: 1000, salida: 400, pensamiento: 0, cacheados: 0 }, p95: { entrada: 2000, salida: 800, pensamiento: 0, cacheados: 0 } },
});
// Upper bound per analysis with 2 attempts: 0.01875 × 2 = 0.0375 USD.
const COTA = 0.0375;

const hash = (n: number) => n.toString(16).padStart(64, "0");
const item = (n: number, permiso = true): ItemSuite => ({ image_sha256: hash(n), ruta_privada: `privado/${n}.jpg`, evaluacion_con_proveedor_externo: permiso, envio_proveedores_ia_permitido: true });
const config = (overrides: Partial<ConfiguracionRunner> = {}): ConfiguracionRunner => ({
  runId: "prueba-runner", corridasPorImagen: 5, maxUsd: 15, concurrencia: 4, plazoPorAnalisisMs: 5_000, intentosMaximosPorPase: 2, tabla, supuesto,
  instante: new Date("2026-09-15T00:00:00Z"),
  sistema: { id: "v13", modelo: "gemini-3.6-flash", parser_version: "semantic-layers-v13-box-2d", system_prompt_sha256: "a".repeat(64), config_hash: "b".repeat(64), thinking_level: "default", taxonomy_version: "estructuras-2.0.0", commit: "75ceeff" },
  ...overrides,
});

const pasesOk = [
  { capacidad: "analisis_referencia_inventario" as const, intento: 1, ms: 40, uso: { entrada: 3000, salida: 1000 }, finishReason: "STOP", malformado: false },
  { capacidad: "analisis_referencia_auditoria" as const, intento: 1, ms: 20, uso: { entrada: 2000, salida: 100, pensamiento: 200 }, finishReason: "STOP", malformado: false },
];
const analizadorOk = (espera = 0): Analizador => async (_item, signal) => {
  if (espera) await new Promise((resolver, rechazar) => { const t = setTimeout(resolver, espera); signal.addEventListener("abort", () => { clearTimeout(t); rechazar(signal.reason); }, { once: true }); });
  return { resultado: "ok", detecciones: [{ elementId: "REF_01_E01", bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 }, structure: parseDetectedStructure({ structure_type: "hoop" })! }], pases: pasesOk, rawOutputSha256: "c".repeat(64), msTotal: 60 };
};

async function run(): Promise<void> {
  await caso("--preview: estima sin llamar al analizador y respeta lo ya hecho", async () => {
    const plan = planificarCorrida(config(), [item(1), item(2)], new Set([claveCorrida(hash(1), 1), claveCorrida(hash(1), 2)]));
    assert.deepEqual([plan.imagenes, plan.analisis_totales, plan.analisis_pendientes], [2, 10, 8]);
    assert.ok(Math.abs(plan.estimacion.cota_superior_usd - 8 * COTA) < 1e-12);
    assert.equal(plan.cabe_en_presupuesto, true);
    assert.equal(planificarCorrida(config({ maxUsd: 0.1 }), [item(1)]).cabe_en_presupuesto, false);
  });

  await caso("permiso: un solo ítem sin evaluación con proveedor externo rechaza la suite entera antes de llamar", async () => {
    let llamadas = 0;
    await assert.rejects(ejecutarCorrida({ config: config(), items: [item(1), item(2, false)], analizar: async () => { llamadas += 1; throw new Error("no debe llamarse"); }, alEscribir: () => undefined }), /sin permiso de evaluación/);
    assert.equal(llamadas, 0);
    assert.throws(() => planificarCorrida(config(), [item(1), item(1)]), /repite 1 imagen/);
    assert.throws(() => planificarCorrida(config({ concurrencia: 5 }), [item(1)]), /concurrencia debe ser 1-4/);
  });

  await caso("corrida: líneas válidas con familia del detector, uso sumado y costo reportado desde los tokens", async () => {
    const escritas: PrediccionEstructurasV1[] = [];
    const resultado = await ejecutarCorrida({ config: config({ corridasPorImagen: 2 }), items: [item(1)], analizar: analizadorOk(), alEscribir: (linea) => { escritas.push(linea); } });
    assert.equal(escritas.length, 2);
    assert.deepEqual(escritas.map((linea) => linea.corrida), [1, 2]);
    const [primera] = escritas;
    assert.equal(primera!.instancias[0]!.familia, "aro");
    assert.deepEqual(primera!.uso_reportado, { tokens_entrada: 5000, tokens_salida: 1100, tokens_pensamiento: 200, tokens_cacheados: 0, llamadas: 2, finish_reasons: ["STOP", "STOP"] });
    assert.deepEqual(primera!.latencia_ms, { total: 60, inventario: 40, auditoria: 20 });
    // Per analysis: (5000·0.75 + 1300·3.75) / 1e6 = 0.008625
    assert.ok(Math.abs(resultado.costo_reportado_usd - 2 * 0.008625) < 1e-12, String(resultado.costo_reportado_usd));
  });

  await caso("presupuesto: cuando la cota no cabe, el resto queda omitido_por_presupuesto sin llamar", async () => {
    let llamadas = 0;
    const analizar: Analizador = async (i, s) => { llamadas += 1; return analizadorOk()(i, s); };
    // Each call reserves the upper bound and then keeps only its real cost (0.008625):
    // budget = bound + 2 real costs − ε allows exactly two calls.
    const resultado = await ejecutarCorrida({ config: config({ maxUsd: COTA + 2 * 0.008625 - 1e-9, corridasPorImagen: 3, concurrencia: 1 }), items: [item(1)], analizar, alEscribir: () => undefined });
    assert.equal(llamadas, 2);
    assert.equal(resultado.omitidas_por_presupuesto, 1);
    assert.equal(resultado.lineas[2]!.resultado, "omitida_por_presupuesto");
    assert.ok(resultado.lineas.filter((linea) => linea.resultado === "omitida_por_presupuesto").every((linea) => linea.instancias.length === 0 && linea.uso_reportado.llamadas === 0));
    const sinDinero = await ejecutarCorrida({ config: config({ maxUsd: 0 }), items: [item(1)], analizar: async () => { throw new Error("no"); }, alEscribir: () => undefined });
    assert.equal(sinDinero.omitidas_por_presupuesto, 5);
  });

  await caso("concurrencia: ≤ límite entre imágenes y nunca la misma imagen en paralelo", async () => {
    let activas = 0;
    let maximo = 0;
    const activasPorImagen = new Map<string, number>();
    const analizar: Analizador = async (i, s) => {
      activas += 1; maximo = Math.max(maximo, activas);
      activasPorImagen.set(i.image_sha256, (activasPorImagen.get(i.image_sha256) ?? 0) + 1);
      assert.equal(activasPorImagen.get(i.image_sha256), 1, "same image concurrently");
      try { return await analizadorOk(5)(i, s); } finally { activas -= 1; activasPorImagen.set(i.image_sha256, activasPorImagen.get(i.image_sha256)! - 1); }
    };
    const resultado = await ejecutarCorrida({ config: config({ concurrencia: 3, corridasPorImagen: 3 }), items: [1, 2, 3, 4, 5, 6].map((n) => item(n)), analizar, alEscribir: () => undefined });
    assert.equal(resultado.lineas.length, 18);
    assert.ok(maximo <= 3 && maximo >= 2, `maximo=${maximo}`);
  });

  await caso("plazo: un análisis que excede el plazo queda timeout y su reserva completa sigue contando", async () => {
    const resultado = await ejecutarCorrida({ config: config({ plazoPorAnalisisMs: 1_000, corridasPorImagen: 1 }), items: [item(1)], analizar: analizadorOk(3_000), alEscribir: () => undefined });
    assert.equal(resultado.lineas[0]!.resultado, "timeout");
    assert.equal(resultado.lineas[0]!.instancias.length, 0);
    // Budget for exactly two bounds: after a timeout keeps its whole reservation, only one more call fits.
    let llamadas = 0;
    const lento: Analizador = async (i, s) => { llamadas += 1; return analizadorOk(3_000)(i, s); };
    const conTope = await ejecutarCorrida({ config: config({ plazoPorAnalisisMs: 1_000, corridasPorImagen: 3, concurrencia: 1, maxUsd: 2 * COTA + 1e-9 }), items: [item(1)], analizar: lento, alEscribir: () => undefined });
    assert.equal(llamadas, 2);
    assert.equal(conTope.omitidas_por_presupuesto, 1);
  });

  await caso("reanudación: lo ya escrito no se repite", async () => {
    let llamadas = 0;
    const analizar: Analizador = async (i, s) => { llamadas += 1; return analizadorOk()(i, s); };
    const yaHechas = new Set([1, 2, 3].map((corrida) => claveCorrida(hash(1), corrida)));
    const resultado = await ejecutarCorrida({ config: config(), items: [item(1)], analizar, yaHechas, alEscribir: () => undefined });
    assert.equal(llamadas, 2);
    assert.deepEqual(resultado.lineas.map((linea) => linea.corrida), [4, 5]);
  });

  await caso("run.json: percentiles por rango más cercano y flip rate por firma de familias", () => {
    assert.equal(percentil([], 50), null);
    assert.deepEqual([percentil([5], 95), percentil([1, 2, 3, 4], 50), percentil([1, 2, 3, 4], 95), percentil([10, 1, 7], 50)], [5, 2, 4, 7]);
    const base = { schema: "prediccion-estructuras.v1" as const, run_id: "r", sistema: config().sistema, raw_output_sha256: "c".repeat(64), uso_reportado: { tokens_entrada: 0, tokens_salida: 0, tokens_pensamiento: 0, tokens_cacheados: 0, llamadas: 0, finish_reasons: [] }, latencia_ms: { total: 1, inventario: null, auditoria: null } };
    const instancia = (familia: "arco" | "aro") => ({ instance_id: "E", bbox: { x: 0, y: 0, width: 1, height: 1 }, familia, candidatos: [familia], estado: "determinada" as const, atributos_v1: { structure_type: familia === "arco" ? "arch" as const : "hoop" as const, outline: "symmetric" as const, density: "dense" as const, horizontal_position: "center" as const, top_overhang: null, grounded: true } });
    const linea = (imagen: number, corrida: number, familias: Array<"arco" | "aro">, resultado: "ok" | "error" = "ok"): PrediccionEstructurasV1 => ({ ...base, image_sha256: hash(imagen), corrida, resultado, instancias: resultado === "ok" ? familias.map(instancia) : [] });
    const lineas = [
      linea(1, 1, ["arco", "aro"]), linea(1, 2, ["aro", "arco"]), linea(1, 3, ["arco"]), linea(1, 4, ["arco", "aro"]), linea(1, 5, [], "error"),
      linea(2, 1, ["arco"]), linea(2, 2, ["arco"]),
      linea(3, 1, ["aro"]),
    ];
    assert.equal(firmaFamilias(lineas[0]!), firmaFamilias(lineas[1]!), "order does not matter");
    const flip = flipRate(lineas);
    // Image 1: 4 ok runs, mode 3 → 0.25; image 2: 0; image 3: one ok run, not evaluated.
    assert.deepEqual([flip.imagenes_evaluadas, flip.por_imagen[hash(1)], flip.por_imagen[hash(2)], flip.media], [2, 0.25, 0, 0.125]);
  });

  await caso("run.json: conteos, latencias, formato y costo sin métricas de exactitud", async () => {
    const pasesMalformados: Analizador = async () => ({ resultado: "ok", detecciones: [], rawOutputSha256: "d".repeat(64), msTotal: 90, pases: [{ ...pasesOk[0]!, malformado: true, finishReason: "MAX_TOKENS" }, { ...pasesOk[0]!, intento: 2, ms: 50 }, pasesOk[1]!] });
    const corrida = await ejecutarCorrida({ config: config({ corridasPorImagen: 2 }), items: [item(1), item(2)], analizar: pasesMalformados, alEscribir: () => undefined });
    const runJson = resumirCorrida({ corrida, generadoEn: new Date("2026-09-15T13:00:00Z"), suite: { id: "prueba", manifiesto_sha256: "e".repeat(64) }, todasLasLineas: corrida.lineas });
    assert.equal(runJson.metricas_de_exactitud, "no_calculadas_sin_verdad_humana");
    assert.deepEqual(runJson.conteos.por_resultado, { ok: 4 });
    assert.deepEqual(runJson.latencia_ms.inventario, { n: 8, p50: 40, p95: 50 });
    assert.deepEqual(runJson.latencia_ms.punta_a_punta, { n: 4, p50: 90, p95: 90 });
    assert.deepEqual([runJson.formato.intentos, runJson.formato.intentos_malformados, runJson.formato.tasa_malformada], [12, 4, 4 / 12]);
    assert.deepEqual(runJson.formato.finish_reasons, { MAX_TOKENS: 4, STOP: 8 });
    assert.ok(runJson.costo.desviacion_vs_esperado !== null && runJson.costo.reportado_es_estimado_desde_tokens_reportados);
    assert.doesNotMatch(JSON.stringify(runJson), /privado\//, "private image paths never reach run.json");
    const otroSistema = { ...corrida.lineas[0]!, sistema: { ...corrida.lineas[0]!.sistema, commit: "0000000" } };
    assert.throws(() => resumirCorrida({ corrida, generadoEn: new Date(), suite: { id: "x", manifiesto_sha256: "e".repeat(64) }, todasLasLineas: [...corrida.lineas, otroSistema] }), /mezclan versiones/);
  });

  console.log(`[PASS] ${casos} casos del runner de reconocimiento`);
}

run().catch((error: unknown) => {
  console.error("[FAIL]", error);
  process.exitCode = 1;
});
