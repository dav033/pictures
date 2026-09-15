import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CONSULTA_TOKENS_ANALISIS, supuestoDesdeFilas } from "../src/lib/eval/estructuras/medir-tokens";
import { cabeEnPresupuesto, estimarCostoCorrida, precioVigente, SupuestoTokensSchema, TablaPreciosSchema, type SupuestoTokens } from "../src/lib/eval/estructuras/costo";

/**
 * Plan A §A0.3 / Fundamentos §8.6: dated price table, its parity with
 * migration 025 and the run cost estimate. Synthetic token vectors; no network.
 */

let casos = 0;
function caso(nombre: string, fn: () => void): void {
  fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
}

const tabla = TablaPreciosSchema.parse(JSON.parse(readFileSync(resolve(process.cwd(), "eval/estructuras/precios/2026-09-15.json"), "utf8")));
const supuesto: SupuestoTokens = SupuestoTokensSchema.parse({
  version: "sintetico-prueba",
  modelo: "gemini-3.6-flash",
  origen: "vector sintético de la prueba",
  n_llamadas: 1,
  inventario: { p50: { entrada: 2000, salida: 1000, pensamiento: 0, cacheados: 0 }, p95: { entrada: 4000, salida: 2000, pensamiento: 1000, cacheados: 0 } },
  auditoria: { p50: { entrada: 1000, salida: 400, pensamiento: 0, cacheados: 0 }, p95: { entrada: 2000, salida: 800, pensamiento: 0, cacheados: 0 } },
});

caso("la tabla fechada valida y cambia de precio exactamente el 2027-01-01", () => {
  assert.equal(precioVigente(tabla, "gemini-3.6-flash", new Date("2026-09-15T12:00:00Z")).precio_entrada, 0.75);
  assert.equal(precioVigente(tabla, "gemini-3.6-flash", new Date("2026-12-31T23:59:59.999Z")).precio_salida, 3.75);
  assert.equal(precioVigente(tabla, "gemini-3.6-flash", new Date("2027-01-01T00:00:00Z")).precio_salida, 7.5);
  assert.throws(() => precioVigente(tabla, "gemini-otro", new Date("2026-09-15T00:00:00Z")), /sin precio/);
  const solapada = { ...tabla, precios: [...tabla.precios, { ...tabla.precios[0]!, vigente_desde: "2026-06-01T00:00:00Z" }] };
  assert.throws(() => precioVigente(solapada, "gemini-3.6-flash", new Date("2026-09-15T00:00:00Z")), /solapados/);
});

caso("paridad: la migración 025 carga los mismos precios que la tabla fechada", () => {
  const sql = readFileSync(resolve(process.cwd(), "scripts/migrations/025_precios_gemini_flash.sql"), "utf8");
  const filas = [...sql.matchAll(/\('gemini', '([^']+)', '([^']+)', (NULL|'[^']+'), 'millon_tokens', ([\d.]+), ([\d.]+), ([\d.]+), 'USD'/g)].map((m) => ({
    modelo: m[1], vigente_desde: m[2], vigente_hasta: m[3] === "NULL" ? null : m[3]!.slice(1, -1), precio_entrada: Number(m[4]), precio_salida: Number(m[5]), precio_cacheado: Number(m[6]),
  }));
  const tablaSinFuente = tabla.precios.map(({ modelo, vigente_desde, vigente_hasta, precio_entrada, precio_salida, precio_cacheado }) => ({ modelo, vigente_desde, vigente_hasta, precio_entrada, precio_salida, precio_cacheado }));
  assert.equal(filas.length, 2);
  assert.deepEqual(filas, tablaSinFuente);
});

caso("estimación: esperado con p50 y un intento; cota con p95 y todos los reintentos", () => {
  const estimacion = estimarCostoCorrida({ tabla, supuesto, modelo: "gemini-3.6-flash", instante: new Date("2026-09-15T00:00:00Z"), imagenes: 10, corridasPorImagen: 5, intentosMaximosPorPase: 2 });
  // p50 per analysis: (2000·0.75 + 1000·3.75 + 1000·0.75 + 400·3.75) / 1e6 = 0.0075
  // p95 per analysis: (4000·0.75 + 3000·3.75 + 2000·0.75 + 800·3.75) / 1e6 = 0.01875, ×2 attempts
  assert.equal(estimacion.llamadas_analisis, 50);
  assert.ok(Math.abs(estimacion.esperado_usd - 50 * 0.0075) < 1e-12, String(estimacion.esperado_usd));
  assert.ok(Math.abs(estimacion.cota_superior_usd - 50 * 0.01875 * 2) < 1e-12, String(estimacion.cota_superior_usd));
  assert.deepEqual([estimacion.es_estimado, estimacion.precio_version, estimacion.supuesto_version], [true, "precios-2026-09-15", "sintetico-prueba"]);
});

caso("presupuesto: decide por la cota superior y rechaza entradas inválidas", () => {
  const estimacion = estimarCostoCorrida({ tabla, supuesto, modelo: "gemini-3.6-flash", instante: new Date("2026-09-15T00:00:00Z"), imagenes: 60, corridasPorImagen: 5, intentosMaximosPorPase: 2 });
  assert.equal(cabeEnPresupuesto(estimacion, 15), true, `cota ${estimacion.cota_superior_usd}`);
  assert.equal(cabeEnPresupuesto(estimacion, estimacion.cota_superior_usd - 0.01), false);
  assert.equal(cabeEnPresupuesto(estimacion, Number.NaN), false);
  assert.throws(() => estimarCostoCorrida({ tabla, supuesto, modelo: "gemini-otro", instante: new Date(), imagenes: 1, corridasPorImagen: 1, intentosMaximosPorPase: 1 }), /supuesto de tokens/);
  assert.throws(() => estimarCostoCorrida({ tabla, supuesto, modelo: "gemini-3.6-flash", instante: new Date(), imagenes: 1.5, corridasPorImagen: 1, intentosMaximosPorPase: 1 }), /imagenes inválido/);
  assert.throws(() => estimarCostoCorrida({ tabla, supuesto, modelo: "gemini-3.6-flash", instante: new Date(), imagenes: 1, corridasPorImagen: 0, intentosMaximosPorPase: 1 }), /corridasPorImagen inválido/);
});

caso("medición: el supuesto sale de agregados por pase, redondea hacia arriba y exige un mínimo de llamadas", () => {
  const fila = (capacidad: string, n: number) => ({ capacidad, n, n_reintentos: 2, entrada_p50: "2100.2", entrada_p95: 3999.1, salida_p50: 700, salida_p95: "1500.5", pensamiento_p50: 0, pensamiento_p95: 10.1, cacheados_p50: 0, cacheados_p95: 0, desde: new Date("2026-09-01T10:00:00Z"), hasta: "2026-09-14T23:00:00Z" });
  const opciones = { modelo: "gemini-3.6-flash", dias: 30, minimoLlamadas: 30, fecha: "2026-09-15" };
  const medido = supuestoDesdeFilas([fila("analisis_referencia_inventario", 120), fila("analisis_referencia_auditoria", 118)], opciones);
  assert.deepEqual(medido.inventario.p50, { entrada: 2101, salida: 700, pensamiento: 0, cacheados: 0 });
  assert.deepEqual(medido.inventario.p95, { entrada: 4000, salida: 1501, pensamiento: 11, cacheados: 0 });
  assert.deepEqual([medido.version, medido.n_llamadas, medido.ventana], ["tokens-analisis-2026-09-15", 238, { desde: "2026-09-01", hasta: "2026-09-14" }]);
  assert.ok(SupuestoTokensSchema.safeParse(JSON.parse(JSON.stringify(medido))).success, "the written file loads back");
  assert.throws(() => supuestoDesdeFilas([fila("analisis_referencia_inventario", 120), fila("analisis_referencia_auditoria", 29)], opciones), /auditoria: 29 llamadas/);
  assert.throws(() => supuestoDesdeFilas([fila("analisis_referencia_inventario", 120)], opciones), /auditoria: 0 llamadas/);
  assert.match(CONSULTA_TOKENS_ANALISIS, /^\s*SELECT/);
  assert.doesNotMatch(CONSULTA_TOKENS_ANALISIS, /\b(INSERT|UPDATE|DELETE|request_id|correlation_id)\b/i, "aggregates only, no identifiers");
});

console.log(`[PASS] ${casos} casos de costo de corridas de reconocimiento`);
