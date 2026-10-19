import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");
const FIXTURE = path.join(ROOT, "scripts", "test", "fixtures", "medicion-reactbits.json");
const RUTAS = ["3d", "asistente", "sharedQuote"] as const;
const ESCENARIOS = ["sheetDrag", "panelOpen"] as const;

function record(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${label} debe ser un objeto`);
  return value as Record<string, unknown>;
}

function readModules(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return readModules(file);
    if (!entry.isFile() || !/\.[cm]?[jt]sx?$/.test(entry.name)) return [];
    return [readFileSync(file, "utf8")];
  });
}

const fixture = record(JSON.parse(readFileSync(FIXTURE, "utf8")) as unknown, "fixture");
assert.equal(fixture.schemaVersion, 1, "schemaVersion debe ser 1");
assert.equal(fixture.bundleMetric, "firstLoadUncompressedJsBytes");

const builds = record(fixture.builds, "builds");
const routeBytes = new Map<string, { main: number; branch: number }>();
for (const buildName of ["main", "branch"] as const) {
  const build = record(builds[buildName], `builds.${buildName}`);
  assert.equal(typeof build.commit, "string", `builds.${buildName}.commit debe documentarse`);
  const routes = record(build.routes, `builds.${buildName}.routes`);
  for (const routeName of RUTAS) {
    const route = record(routes[routeName], `builds.${buildName}.routes.${routeName}`);
    assert.equal(typeof route.pathname, "string", `${routeName} debe conservar su pathname`);
    assert.ok(Number.isSafeInteger(route.firstLoadUncompressedJsBytes) && Number(route.firstLoadUncompressedJsBytes) > 0, `${routeName} debe tener bytes JS medidos`);
    const bytes = Number(route.firstLoadUncompressedJsBytes);
    const previous = routeBytes.get(routeName) ?? { main: 0, branch: 0 };
    previous[buildName] = bytes;
    routeBytes.set(routeName, previous);
  }
}
const branchRoutes = record(record(builds.branch, "builds.branch").routes, "builds.branch.routes");
for (const routeName of RUTAS) {
  const route = record(branchRoutes[routeName], `builds.branch.routes.${routeName}`);
  assert.equal(route.deltaFromMainBytes, routeBytes.get(routeName)!.branch - routeBytes.get(routeName)!.main, `${routeName} debe cuadrar su delta`);
}

const trace = record(fixture.phoneTrace, "phoneTrace");
assert.equal(trace.cpuThrottleRate, 4, "la traza debe usar CPU x4");
const viewport = record(trace.viewport, "phoneTrace.viewport");
assert.equal(viewport.width, 390);
assert.equal(viewport.height, 844);
const traceRuns = record(trace.results, "phoneTrace.results");
for (const buildName of ["main", "branch"] as const) {
  const build = record(traceRuns[buildName], `phoneTrace.results.${buildName}`);
  for (const scenarioName of ESCENARIOS) {
    const scenario = record(build[scenarioName], `phoneTrace.results.${buildName}.${scenarioName}`);
    assert.equal(scenario.samples, 3, `${buildName}.${scenarioName} debe tener tres muestras`);
    assert.ok(Number.isFinite(scenario.medianWallDurationMs) && Number(scenario.medianWallDurationMs) > 0, `${buildName}.${scenarioName} debe tener duración`);
    assert.ok(Number.isFinite(scenario.medianLongTaskDurationMs) && Number(scenario.medianLongTaskDurationMs) >= 0, `${buildName}.${scenarioName} debe registrar tareas largas`);
    assert.ok(Number.isSafeInteger(scenario.traceEventCount) && Number(scenario.traceEventCount) > 0, `${buildName}.${scenarioName} debe incluir eventos CDP`);
  }
}

assert.ok(Array.isArray(fixture.rulings), "rulings debe ser una lista");
const rulings = fixture.rulings.map((entry, index) => record(entry, `rulings[${index}]`));
const spotlightRuling = rulings.find((ruling) => ruling.component === "SpotlightCard");
assert.ok(spotlightRuling, "SpotlightCard requiere una decisión registrada");
assert.equal(spotlightRuling.decision, "removed", "SpotlightCard fue retirado de las tarjetas del Taller táctil");
assert.equal(spotlightRuling.remainingImports, 0, "no deben quedar imports de SpotlightCard");
const beforeRulingBytes = spotlightRuling.beforeRulingFirstLoadJsBytes;
const afterRulingBytes = spotlightRuling.afterRulingFirstLoadJsBytes;
const avoidedBytes = spotlightRuling.bundleBytesAvoided;
assert.ok(typeof beforeRulingBytes === "number" && Number.isSafeInteger(beforeRulingBytes), "el build previo al ruling debe registrar bytes");
assert.ok(typeof afterRulingBytes === "number" && Number.isSafeInteger(afterRulingBytes), "el build posterior al ruling debe registrar bytes");
assert.ok(typeof avoidedBytes === "number" && Number.isSafeInteger(avoidedBytes), "el ahorro debe registrar bytes enteros");
assert.equal(beforeRulingBytes - afterRulingBytes, avoidedBytes, "el coste retirado debe cuadrar con los builds medidos");
const source = readModules(path.join(ROOT, "src")).join("\n");
assert.doesNotMatch(source, /(?:from|import)\s*["'][^"']*SpotlightCard(?:\.[cm]?[jt]sx?)?["']/, "SpotlightCard no debe conservar consumidores");

console.log("Mediciones de bundle, traza móvil y ruling de SpotlightCard presentes.");
