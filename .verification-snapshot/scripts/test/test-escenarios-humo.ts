/**
 * Humo del barrido de la matriz (`scripts/escenarios/informe.ts` y `correr.ts`, REQ-014 T19): 150 escenarios sin red ni IA.
 *   - el informe tiene la forma esperada y sus cuentas cuadran (pasan + fallidos = n);
 *   - un fallo plantado en un escenario concreto aparece en el informe, agrupado por su invariante, con su escenario y semilla;
 *   - el CLI acepta --n, --semilla y --salida y escribe el JSON donde se le pide.
 *
 *   npx tsx --conditions=react-server scripts/test/test-escenarios-humo.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { barrer } from "../escenarios/informe";
import { correr } from "../escenarios/matriz";
import { INVARIANTES } from "../escenarios/invariantes";

const N = 150;
const SEMILLA = 3;
const PLANTADO = 4;
const CLASE_PLANTADA = "sin_solapes:plantado";

const base = barrer({ n: N, semilla: SEMILLA, ejecutar: (e) => correr(e, { conTiempo: false }), conRepro: false });

function pruebaForma(): void {
  const informe = base;
  assert.equal(informe.n, N);
  assert.equal(informe.semilla, SEMILLA);
  assert.equal(informe.rechazadosPorEsquema, 0, "ningún escenario generado lo rechaza el esquema");
  assert.equal(informe.pasan + informe.escenariosFallidos.length, N, "pasan + fallidos = n");
  assert.match(informe.tasaGlobal, /^\d+\.\d%$/);
  assert.deepEqual(Object.keys(informe.porInvariante), [...INVARIANTES]);
  for (const v of Object.values(informe.porInvariante)) assert.equal(v.pasa + v.falla, N, "cada invariante se evalúa en cada escenario");
  assert.equal(Object.values(informe.porEstructura).reduce((s, v) => s + v.n, 0), N, "la tasa por estructura cubre todos los escenarios");
  assert.ok(Object.keys(informe.celdasComprobadas).length > 0, "se comprobó alguna celda de banda");
  for (const clave of ["tiempoFachadaMs", "porSala", "clases", "sinBandaPorEstructura"] as const) assert.ok(clave in informe, `el informe trae ${clave}`);
  console.log(`  informe de ${N} escenarios: ${informe.pasan}/${N} pasan, forma y cuentas correctas: ok`);
}

function pruebaFalloPlantado(): void {
  assert.ok(!base.escenariosFallidos.includes("E-00004"), "E-00004 pasa en la base");
  const informe = barrer({
    n: N, semilla: SEMILLA, conRepro: false,
    ejecutar: (e) => {
      const r = correr(e, { conTiempo: false });
      if (e.indice !== PLANTADO) return r;
      return { ...r, chequeos: r.chequeos.map((c) => (c.invariante === "sin_solapes" ? { ...c, clases: [CLASE_PLANTADA] } : c)) };
    },
  });
  const clase = informe.clases[CLASE_PLANTADA];
  assert.ok(clase, `el fallo plantado aparece entre las clases: ${Object.keys(informe.clases).join(", ")}`);
  assert.equal(clase.escenarios, 1);
  assert.equal(clase.ejemplo, "E-00004");
  assert.equal(clase.semilla, SEMILLA, "la clase lleva la semilla para reproducirla");
  assert.ok(informe.escenariosFallidos.includes("E-00004"));
  assert.equal(informe.porInvariante.sin_solapes.falla, base.porInvariante.sin_solapes.falla + 1);
  assert.equal(informe.pasan, base.pasan - 1, "plantar un fallo baja exactamente un escenario que pasa");
  assert.equal(informe.pasan + informe.escenariosFallidos.length, N);
  assert.ok(!(CLASE_PLANTADA in base.clases), "el barrido sin plantar no tiene esa clase");
  console.log("  fallo plantado: reportado por clase, escenario y semilla: ok");
}

function pruebaCli(): void {
  const dir = mkdtempSync(join(tmpdir(), "escenarios-humo-"));
  try {
    const r = spawnSync("npx", ["tsx", "--conditions=react-server", "scripts/escenarios/correr.ts", "--n", "8", "--semilla", "5", "--salida", dir], { encoding: "utf8", timeout: 60_000, cwd: join(import.meta.dirname, "..", "..") });
    assert.equal(r.status, 0, `el CLI termina bien: ${r.stderr}`);
    const ruta = join(dir, "informe-s5-n8.json");
    assert.ok(existsSync(ruta), "el CLI escribe el informe en --salida");
    const json = JSON.parse(readFileSync(ruta, "utf8")) as { n: number; semilla: number };
    assert.deepEqual([json.n, json.semilla], [8, 5]);
    assert.match(r.stdout, /pasan todos los invariantes: \d+\/8/);
    const mala = spawnSync("npx", ["tsx", "--conditions=react-server", "scripts/escenarios/correr.ts", "--n", "abc"], { encoding: "utf8", timeout: 60_000, cwd: join(import.meta.dirname, "..", "..") });
    assert.notEqual(mala.status, 0, "--n inválido falla en vez de barrer 2000 por defecto");
    assert.match(mala.stderr, /--n tiene que ser un entero/, "el error nombra el argumento inválido");
    console.log("  CLI --n/--semilla/--salida: ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

pruebaForma();
pruebaFalloPlantado();
pruebaCli();
console.log("test-escenarios-humo: ok");
