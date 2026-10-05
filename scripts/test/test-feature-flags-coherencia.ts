/**
 * Auditoría 2026-10-04 (M2, S9): el resumen de banderas de arranque solo lleva
 * nombres y booleanos, y el aviso de lecturas sin consumidor dice cuáles se pagan
 * y se tiran. Las banderas se leen al cargar el módulo, así que cada caso lo
 * importa de nuevo con su propio entorno.
 */
import assert from "node:assert/strict";

type Entorno = Record<string, string | undefined>;

async function conEntorno<T>(entorno: Entorno, fn: (m: typeof import("../../src/lib/ia/nucleo/feature-flags")) => T): Promise<T> {
  const previo: Entorno = {};
  for (const [clave, valor] of Object.entries(entorno)) {
    previo[clave] = process.env[clave];
    if (valor === undefined) delete process.env[clave]; else process.env[clave] = valor;
  }
  try {
    const modulo = await import(`../../src/lib/ia/nucleo/feature-flags.ts?caso=${Math.random()}`);
    return fn(modulo);
  } finally {
    for (const [clave, valor] of Object.entries(previo)) {
      if (valor === undefined) delete process.env[clave]; else process.env[clave] = valor;
    }
  }
}

// Desde D2 (2026-10-04) todo va encendido por defecto: apagar es explícito.
const APAGADAS: Entorno = {
  LECTURA_UNICA_REFERENCIA_ENABLED: "false",
  PATRON_REFERENCIA_PYTHON_ENABLED: "false",
  BOUQUET_REFERENCIA_PYTHON_ENABLED: "false",
  CONTEO_REFERENCIA_PYTHON_ENABLED: "false",
  GUIRNALDA_REFERENCIA_PYTHON_ENABLED: "false",
  PATRONES_COLOR_V1: "false",
  BOUQUETS_ARMADO_V1: "false",
  GUIRNALDAS_ARMADO_V1: "false",
  CONTEO_REFERENCIA_V1: "false",
  ARMADO_ARCO_COLUMNA_V1: "false",
};
const POR_DEFECTO: Entorno = Object.fromEntries(Object.keys(APAGADAS).map((clave) => [clave, undefined]));

async function main(): Promise<void> {
  const cuatro = await conEntorno({ ...APAGADAS, LECTURA_UNICA_REFERENCIA_ENABLED: "true" }, (m) => m.lecturasSinConsumidor());
  assert.deepEqual(cuatro, ["patron", "bouquet", "guirnalda", "conteo"], "lectura única con los consumidores apagados: se pagan las cuatro");

  const ninguna = await conEntorno({ ...APAGADAS, LECTURA_UNICA_REFERENCIA_ENABLED: "true", PATRONES_COLOR_V1: "true", BOUQUETS_ARMADO_V1: "true", GUIRNALDAS_ARMADO_V1: "true", CONTEO_REFERENCIA_V1: "true" }, (m) => m.lecturasSinConsumidor());
  assert.deepEqual(ninguna, []);

  const conMotor = await conEntorno({ ...APAGADAS, PATRON_REFERENCIA_PYTHON_ENABLED: "true", ARMADO_ARCO_COLUMNA_V1: "true" }, (m) => m.lecturasSinConsumidor());
  assert.deepEqual(conMotor, [], "el motor consume la lectura de patrón");

  const sinNada = await conEntorno(APAGADAS, (m) => m.lecturasSinConsumidor());
  assert.deepEqual(sinNada, []);
  console.log("[PASS] lecturas sin consumidor: se nombran las que se pagan y nadie usa");

  const SECRETO = "valor-secreto-que-no-debe-salir";
  const porDefecto = await conEntorno(POR_DEFECTO, (m) => m.lecturasSinConsumidor());
  assert.deepEqual(porDefecto, [], "por defecto cada lectura tiene su consumidor encendido");
  const resumen = await conEntorno({ ...POR_DEFECTO, GEMINI_API_KEY: SECRETO, INTERNAL_HMAC_SECRET: SECRETO, DATABASE_URL: SECRETO, NODE_ENV: "production" }, (m) => m.resumenBanderas());
  assert.ok(!JSON.stringify(resumen).includes(SECRETO), "el resumen no lleva secretos");
  // D2: el valor por defecto ya no depende de NODE_ENV.
  assert.equal(resumen.ARMADO_ARCO_COLUMNA_V1, true, "en producción el motor está encendido por defecto");
  assert.equal(resumen.PATRONES_COLOR_V1, true);
  assert.equal(resumen.LECTURA_UNICA_REFERENCIA_ENABLED, true);
  assert.equal(resumen.GUIA_ESTRUCTURA_V1, false, "la guía por /edit sigue apagada hasta medirla con el modelo base");
  assert.ok(Object.values(resumen).every((valor) => typeof valor === "boolean" || typeof valor === "string"));
  console.log("[PASS] resumen de banderas: solo nombres y booleanos, sin secretos");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
