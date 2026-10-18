import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { casosOficiales } from "../lib/casos-motor-guiada";
import { calcularParidadIdeas } from "./paridad-ideas";
import { ESTRUCTURAS_OFICIALES } from "../../src/lib/plan/estructuras-oficiales";
import {
  DENSIDAD_POR_DEFECTO, MEDIDAS_POR_DEFECTO, TAMANOS_POR_DEFECTO, UNIDADES_POR_DEFECTO,
  type MedidasEspec,
} from "../../src/lib/globos3d/motor/medidas-espec";
import { referenciaPorCodigo } from "../../src/lib/plan/referencia-sempertex";
import { FORMATOS_GLOBO } from "../../src/lib/globos3d/formatos";
import {
  armarDesdeEspec, crosswalkIncluido, planearCompra, VERSION_MOTOR,
  type EspecClienteV1, type PoliticaPaquetes,
} from "../../src/lib/globos3d/motor/v1";

const ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_DIR = path.join(os.homedir(), "bitacora", "pictures", "requirements", "REQ-007-engine-behind-the-customer-journey-2d-vi");
const BASELINE_CSV = path.join(OUTPUT_DIR, "PARIDAD-2026-10-09.csv");
const PYTHON_HELPER = path.join(ROOT, "scripts", "motor", "reporte-paridad-python.py");
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const MAX_BUFFER = 16 * 1024 * 1024;

type PythonCase = {
  id: string; name: string; official: string; type: string; location: string;
  measures: Record<string, number>; density: string; mix: string;
  colors: Array<{ code: string; name: string; participation: number }>;
  declaredUnits?: number;
};

type PythonResult = {
  id: string; total: number; sizeMix: Record<string, number>; colors: string[];
  axisM: number | null; priceCop: number;
  uncovered: Array<{ estructura_id?: string; tamano?: string }>;
  warnings: string[];
};

export type ReportRow = {
  id: string; kind: "idea" | "official"; variant: string;
  pythonCount: number | null; engineCount: number | null; countDeltaPct: number | null;
  colorSetEqual: boolean | null; sizeMixEqual: boolean | null;
  pythonColors: string[]; engineColors: string[];
  pythonSizeMix: Record<string, number>; engineSizeMix: Record<string, number>;
  pythonPriceCop: number | null; enginePriceCop: number | null; priceDeltaPct: number | null;
  pythonAxisM: number | null; pythonMeasuresM: Record<string, number> | null; engineBoxM: number[][];
  engineUnrepresentable: string[]; pythonUncovered: string[]; pythonWarnings: string[];
};

const SCALES = [
  { label: "default", factor: 1 },
  { label: "compacta (-25%)", factor: 0.75 },
  { label: "ampliada (+25%)", factor: 1.25 },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberMap(value: unknown, label: string): Record<string, number> {
  if (!isRecord(value) || Object.values(value).some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new Error("Python devolvió un mapa numérico inválido: " + label);
  }
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "number") throw new Error("Python devolvió un mapa numérico inválido: " + label);
    result[key] = item;
  }
  return result;
}

function measuresMap(value: unknown): Record<string, number> | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new Error("La biblioteca devolvió medidas inválidas.");
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error("La biblioteca devolvió medidas inválidas.");
    }
    result[key] = item;
  }
  return result;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("Python devolvió una lista de texto inválida: " + label);
  }
  return value.filter((item): item is string => typeof item === "string");
}

function uncoveredArray(value: unknown, label: string): PythonResult["uncovered"] {
  if (!Array.isArray(value)) throw new Error("Python devolvió faltantes inválidos: " + label);
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("Python devolvió un faltante inválido: " + label);
    const result: PythonResult["uncovered"][number] = {};
    if (item.estructura_id !== undefined) {
      if (typeof item.estructura_id !== "string") throw new Error("Python devolvió un identificador inválido: " + label);
      result.estructura_id = item.estructura_id;
    }
    if (item.tamano !== undefined) {
      if (typeof item.tamano !== "string") throw new Error("Python devolvió una talla inválida: " + label);
      result.tamano = item.tamano;
    }
    return result;
  });
}

function parsePythonResults(value: unknown): PythonResult[] {
  if (!Array.isArray(value)) throw new Error("Python devolvió una lista inválida.");
  return value.map((item): PythonResult => {
    if (!isRecord(item)
      || typeof item.id !== "string"
      || typeof item.total !== "number"
      || !Number.isSafeInteger(item.total)
      || item.total < 0
      || (item.axisM !== null && (typeof item.axisM !== "number" || !Number.isFinite(item.axisM)))
      || typeof item.priceCop !== "number"
      || !Number.isSafeInteger(item.priceCop)
      || item.priceCop < 0) {
      throw new Error("Python devolvió un resultado oficial inválido.");
    }
    const colors = stringArray(item.colors, item.id + " colors");
    const warnings = stringArray(item.warnings, item.id + " warnings");
    return {
      id: item.id,
      total: item.total,
      sizeMix: numberMap(item.sizeMix, item.id),
      colors,
      axisM: item.axisM,
      priceCop: item.priceCop,
      uncovered: uncoveredArray(item.uncovered, item.id),
      warnings,
    };
  });
}

function round2(value: number): number { return Math.round(value * 100) / 100; }

function scaleMeasures(measures: MedidasEspec, factor: number): MedidasEspec {
  return Object.fromEntries(Object.entries(measures).map(([key, value]) => [key, round2(value * factor)])) as MedidasEspec;
}

function planLocation(lugar: string): string {
  const locations: Record<string, string> = {
    fondo: "fondo_pared", mesa: "sobre_mesa_principal", techo: "techo",
    izquierda: "lateral_izquierdo", derecha: "lateral_derecho", centro: "arco_central",
  };
  return locations[lugar] ?? "entrada";
}

export function officialCases(): Array<{ id: string; variant: string; spec: EspecClienteV1; python: PythonCase }> {
  return casosOficiales().flatMap((testCase) => {
    const piece = testCase.espec.piezas[0];
    if (!piece) throw new Error("Caso oficial sin pieza: " + testCase.id);
    const official = piece.oficial;
    const defaultMeasures: MedidasEspec = { ...MEDIDAS_POR_DEFECTO[official], ...piece.medidas };
    const density = piece.densidad ?? DENSIDAD_POR_DEFECTO[official] ?? "media";
    const mix = piece.tamanos ?? TAMANOS_POR_DEFECTO[official];
    const units = piece.unidades ?? UNIDADES_POR_DEFECTO[official];
    return SCALES.map(({ label, factor }) => {
      const measures = scaleMeasures(defaultMeasures, factor);
      const id = testCase.id + ":" + label;
      const scaledPiece = {
        ...piece, medidas: measures,
        ...(units === undefined ? {} : { unidades: Math.max(1, Math.round(units * factor)) }),
      };
      const spec: EspecClienteV1 = { ...testCase.espec, piezas: [scaledPiece] };
      return {
        id, variant: label, spec,
        python: {
          id,
          name: piece.nombre + " — " + label,
          official,
          type: ESTRUCTURAS_OFICIALES[official].tipoBase,
          location: planLocation(piece.lugar),
          measures: Object.fromEntries(Object.entries(measures)),
          density, mix,
          colors: piece.colores.map((color) => ({ code: color.codigo, name: color.nombre, participation: color.peso })),
          ...(units === undefined ? {} : { declaredUnits: Math.max(1, Math.round(units * factor)) }),
        },
      };
    });
  });
}

function resolvePython(cases: PythonCase[]): PythonResult[] {
  const crosswalk = crosswalkIncluido();
  const payload = {
    snapshot: crosswalk.snapshot,
    entries: crosswalk.entradas,
    formats: Object.fromEntries(FORMATOS_GLOBO.map((format) => [format.id, {
      type: format.tipo, diameterInches: format.diametroMaxCm / 2.54,
    }])),
    cases,
  };
  const stdout = execFileSync(process.env.PYTHON_EXECUTABLE || pythonExecutable(), [PYTHON_HELPER], {
    cwd: ROOT, encoding: "utf8", input: JSON.stringify(payload), maxBuffer: MAX_BUFFER,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  return parsePythonResults(JSON.parse(stdout) as unknown);
}

function pythonExecutable(): string {
  const candidates = [
    path.join(ROOT, "services", "ai-api", ".venv", "bin", "python"),
    path.join(ROOT, "services", "ai-api", ".venv", "Scripts", "python.exe"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? (process.platform === "win32" ? "python" : "python3");
}

function enginePrice(bom: Parameters<typeof planearCompra>[0]): number | null {
  const policy: PoliticaPaquetes = "mas_barato";
  const plan = planearCompra(bom, crosswalkIncluido(), policy);
  return plan.ok ? plan.compras.reduce((sum, item) => sum + item.paquetes * item.variante.precio, 0) : null;
}

function add(map: Record<string, number>, key: string, count: number): void {
  map[key] = (map[key] ?? 0) + count;
}

function deltaPct(actual: number | null, previous: number | null): number | null {
  if (actual === null || previous === null || previous === 0) return null;
  return Math.round(((actual - previous) / previous) * 1000) / 10;
}

function normalizedColor(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");
}

function sameSet(a: string[], b: string[]): boolean {
  const left = [...new Set(a.map(normalizedColor))].sort();
  const right = [...new Set(b.map(normalizedColor))].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameMap(a: Record<string, number>, b: Record<string, number>): boolean {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((key) => (a[key] ?? 0) === (b[key] ?? 0));
}

function colorsFromMap(colors: Record<string, number>): string[] {
  return Object.keys(colors).map((key) => key.replace(/\s+(?:R|LOL|T|C)-\S+$/i, "").trim());
}

function boxesInMeters(boxes: unknown[]): number[][] {
  return boxes.flatMap((box) => Array.isArray(box) && box.length === 6 && box.every((value) => typeof value === "number")
    ? [[round2((box[3]! - box[0]!) / 100), round2((box[4]! - box[1]!) / 100), round2((box[5]! - box[2]!) / 100)]]
    : []);
}

function ideaRow(idea: ReturnType<typeof calcularParidadIdeas>[number]): ReportRow {
  const py = idea.python;
  const motor = idea.motor;
  const pythonCount = typeof py.totalResuelto === "number" ? py.totalResuelto : null;
  const engineCount = typeof motor.total === "number" ? motor.total : null;
  const pythonColors = colorsFromMap(Object.assign({}, ...py.estructuras.map((item) => item.porColor)));
  const engineColors = colorsFromMap(Object.assign({}, ...motor.piezas.map((item) => item.porColor)));
  const axes = py.estructuras.map((item) => item.ejeM).filter((axis): axis is number => typeof axis === "number");
  const pythonPrice = typeof idea.precios.pythonGuardado === "number" ? idea.precios.pythonGuardado : null;
  const enginePrice = typeof idea.precios.motorMasBarato === "number" ? idea.precios.motorMasBarato : null;
  return {
    id: idea.id, kind: "idea", variant: "guardada",
    pythonCount, engineCount, countDeltaPct: deltaPct(engineCount, pythonCount),
    colorSetEqual: pythonCount === null ? null : sameSet(pythonColors, engineColors),
    sizeMixEqual: pythonCount === null ? null : sameMap(py.globosPorTamano, motor.porFormato),
    pythonColors, engineColors, pythonSizeMix: py.globosPorTamano, engineSizeMix: motor.porFormato,
    pythonPriceCop: pythonPrice, enginePriceCop: enginePrice, priceDeltaPct: deltaPct(enginePrice, pythonPrice),
    pythonAxisM: axes.length ? round2(axes.reduce((sum, axis) => sum + axis, 0)) : null,
    pythonMeasuresM: measuresMap(py.estructuras[0]?.medidas),
    engineBoxM: boxesInMeters(motor.piezas.map((item) => item.caja)),
    engineUnrepresentable: motor.noRepresentable,
    pythonUncovered: idea.precios.sinCruce,
    pythonWarnings: [],
  };
}

function officialRow(
  testCase: ReturnType<typeof officialCases>[number],
  python: PythonResult,
): ReportRow {
  const result = armarDesdeEspec(testCase.spec);
  const engineSizeMix: Record<string, number> = {};
  for (const line of result.bom.total) add(engineSizeMix, line.formatoId, line.cantidad);
  const engineColors = [...new Set(result.bom.total.map((line) => referenciaPorCodigo(line.codigo)?.nombre ?? line.codigo))];
  const engineCount = result.bom.total.reduce((sum, line) => sum + line.cantidad, 0);
  const enginePriceCop = enginePrice(result.bom.total);
  return {
    id: testCase.id, kind: "official", variant: testCase.variant,
    pythonCount: python.total, engineCount, countDeltaPct: deltaPct(engineCount, python.total),
    colorSetEqual: sameSet(python.colors, engineColors), sizeMixEqual: sameMap(python.sizeMix, engineSizeMix),
    pythonColors: python.colors, engineColors, pythonSizeMix: python.sizeMix, engineSizeMix,
    pythonPriceCop: python.priceCop, enginePriceCop,
    priceDeltaPct: deltaPct(enginePriceCop, python.priceCop),
    pythonAxisM: typeof python.axisM === "number" ? round2(python.axisM) : null,
    pythonMeasuresM: testCase.python.measures, engineBoxM: boxesInMeters(result.armada.piezas.map((piece) => piece.caja)),
    engineUnrepresentable: result.noRepresentable.map((item) => item.piezaId),
    pythonUncovered: python.uncovered.map((item) => (item.estructura_id ?? "?") + ":" + (item.tamano ?? "talla")),
    pythonWarnings: python.warnings,
  };
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((item) => item.some((value) => value.length));
}

type Baseline = { python: number; engine: number };

function baselineRows(): Map<string, Baseline> {
  if (!existsSync(BASELINE_CSV)) return new Map();
  const [header = [], ...records] = parseCsv(readFileSync(BASELINE_CSV, "utf8"));
  const columns = new Map(header.map((name, index) => [name, index]));
  const result = new Map<string, Baseline>();
  for (const record of records) {
    const id = record[columns.get("idea") ?? -1];
    const python = Number(record[columns.get("python_count") ?? -1]);
    const engine = Number(record[columns.get("engine_count") ?? -1]);
    if (!id || !Number.isFinite(python) || !Number.isFinite(engine)) continue;
    const previous = result.get(id) ?? { python: 0, engine: 0 };
    result.set(id, { python: previous.python + python, engine: previous.engine + engine });
  }
  return result;
}

function csvCell(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function csvReport(rows: ReportRow[]): string {
  const columns: Array<keyof ReportRow> = [
    "id", "kind", "variant", "pythonCount", "engineCount", "countDeltaPct", "colorSetEqual", "sizeMixEqual",
    "pythonColors", "engineColors", "pythonSizeMix", "engineSizeMix", "pythonPriceCop", "enginePriceCop",
    "priceDeltaPct", "pythonAxisM", "pythonMeasuresM", "engineBoxM", "engineUnrepresentable",
    "pythonUncovered", "pythonWarnings",
  ];
  return [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n") + "\n";
}

function percent(value: number | null): string {
  return value === null ? "n/d" : (value > 0 ? "+" : "") + value.toFixed(1) + "%";
}

function baselineSummary(rows: ReportRow[], baseline: Map<string, Baseline>): string[] {
  const current = new Map(rows.filter((row) => row.kind === "idea").map((row) => [row.id, row]));
  const common = [...baseline].flatMap(([id, before]) => {
    const after = current.get(id);
    return after?.pythonCount === null || after?.pythonCount === undefined || after.engineCount === null
      ? [] : [{ before, after }];
  });
  if (!baseline.size) return ["No se encontró `PARIDAD-2026-10-09.csv`; comparación histórica pendiente."];
  if (!common.length) return ["El CSV base existe, pero no hay ideas comunes con resultados comparables."];
  const beforePython = common.reduce((sum, item) => sum + item.before.python, 0);
  const beforeEngine = common.reduce((sum, item) => sum + item.before.engine, 0);
  const afterPython = common.reduce((sum, item) => sum + item.after.pythonCount!, 0);
  const afterEngine = common.reduce((sum, item) => sum + item.after.engineCount!, 0);
  return [
    "Comparación en " + common.length + " ideas comunes (motor 1.1.0 en el baseline; " + VERSION_MOTOR + " actual):",
    "- Python: " + beforePython.toLocaleString("es-CO") + " → " + afterPython.toLocaleString("es-CO") + " (" + percent(deltaPct(afterPython, beforePython)) + ").",
    "- Motor: " + beforeEngine.toLocaleString("es-CO") + " → " + afterEngine.toLocaleString("es-CO") + " (" + percent(deltaPct(afterEngine, beforeEngine)) + ").",
    "- El CSV base agrega por estructura; se sumaron sus líneas por idea antes de comparar.",
  ];
}

function reportMarkdown(
  date: string, rows: ReportRow[], baseline: Map<string, Baseline>,
  editChecks: string[], snapshot: string,
): string {
  const comparable = rows.filter((row) => row.pythonCount !== null && row.engineCount !== null);
  const exactCounts = comparable.filter((row) => row.pythonCount === row.engineCount).length;
  const exactColors = rows.filter((row) => row.colorSetEqual === true).length;
  const exactSizes = rows.filter((row) => row.sizeMixEqual === true).length;
  const priced = rows.filter((row) => row.pythonPriceCop !== null && row.enginePriceCop !== null).length;
  const outliers = [...comparable].sort((a, b) => Math.abs(b.countDeltaPct ?? 0) - Math.abs(a.countDeltaPct ?? 0)).slice(0, 15);
  const table = outliers.map((row) => {
    const flags = [
      ...(row.engineUnrepresentable.length ? ["engine:" + row.engineUnrepresentable.join("/")] : []),
      ...(row.pythonUncovered.length ? ["python:" + row.pythonUncovered.join("/")] : []),
    ].join("; ") || "—";
    return "| " + row.id + " | " + row.pythonCount + " | " + row.engineCount + " | " + percent(row.countDeltaPct) +
      " | " + (row.colorSetEqual ? "igual" : "distinto") + " | " + (row.sizeMixEqual ? "igual" : "distinto") +
      " | " + percent(row.priceDeltaPct) + " | " + flags + " |";
  });
  return [
    "---", "req: REQ-007", "phase: 6 (one-off parity report, informational only, no gate)",
    "date: " + date, "engine: globos3d " + VERSION_MOTOR, "catalog_snapshot: " + snapshot,
    "python_source: in-process services/ai-api domain resolver with a read-only in-memory store from the included crosswalk",
    "---", "", "# REQ-007 parity report — Python vs globos3d " + VERSION_MOTOR, "",
    "## Cobertura y método", "",
    "- " + rows.filter((row) => row.kind === "idea").length + " ideas guardadas, con resolución Python existente y motor actual.",
    "- " + rows.filter((row) => row.kind === "official" && row.variant === "default").length +
      " estructuras oficiales en tamaño predeterminado, compacto (−25%) y ampliado (+25%): " +
      rows.filter((row) => row.kind === "official").length + " ejecuciones por cada lado.",
    "- Los casos oficiales llaman `resolve_plan` directamente en `services/ai-api/app/plan.py`. El almacén en memoria usa el snapshot incluido `" + snapshot + "`; no consulta Neon, puertos locales ni proveedores pagados.",
    "- El cruce conserva IDs de producto/variante, tallas, paquetes y precios. No incluye inventario ni imágenes; esos campos no se comparan.",
    "- Por color, el producto base es el del formato R-12 cuando existe; si no, se elige el producto con mayor cobertura de tallas, con desempate determinista por ID. El allowlist incluye sus variantes del snapshot.",
    "- El precio compara el total de compra de Python contra la política `mas_barato` del motor, ambos sobre el mismo snapshot. Es una comparación informativa, no modifica cotizaciones.",
    "", "## Resultados", "",
    "- Comparaciones de conteo disponibles: " + comparable.length + "/" + rows.length + "; conteo exacto: " + exactCounts + "/" + comparable.length + ".",
    "- Igualdad exacta de colores: " + exactColors + "/" + rows.length + "; mezcla de tamaños: " + exactSizes + "/" + rows.length + ".",
    "- Comparaciones de precio disponibles: " + priced + "/" + rows.length + "; sin umbral de aceptación.",
    "", "## Cambio frente a PARIDAD-2026-10-09", "", ...baselineSummary(rows, baseline),
    "", "## Mayores diferencias de conteo", "",
    "| Caso | Python | Motor | Δ globos | Colores | Tamaños | Δ precio | Alertas |",
    "|---|---:|---:|---:|---|---|---:|---|", ...table,
    "", "## Geometría y representación", "",
    "El CSV conserva el eje y las medidas del plan Python junto a las cajas 3D del motor. Son modelos geométricos distintos; se muestran en paralelo, sin exigir igualdad. También se registran piezas no representables, faltantes de catálogo, sustituciones y advertencias.",
    "", "## Cobertura de operaciones de edición", "",
    "El mapeo de las 10 herramientas de edición del chat y el panel `CambioPlan` tiene pruebas dedicadas:",
    ...editChecks.map((check) => "- " + check),
    "", "Informe de carácter informativo; no habilita el cambio de ruta de cliente ni altera el fallback Python.", "",
  ].join("\n");
}

function options(): { date: string; outputDir: string } {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index < 0 ? undefined : args[index + 1];
  };
  const date = get("--date") ?? new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date requiere YYYY-MM-DD.");
  return { date, outputDir: path.resolve(get("--output-dir") ?? OUTPUT_DIR) };
}

function checkEditOperations(): string[] {
  if (!existsSync(TSX_CLI)) throw new Error("No se encontró el runner local tsx: " + TSX_CLI);
  const scripts = [
    "scripts/test/test-motor-guiada-ediciones-mapeo.ts",
    "scripts/test/test-motor-guiada-ediciones.ts",
  ];
  return scripts.map((script) => {
    execFileSync(process.execPath, [TSX_CLI, "--conditions=react-server", script], {
      cwd: ROOT, encoding: "utf8", maxBuffer: MAX_BUFFER,
    });
    return "PASS — npx tsx --conditions=react-server " + script;
  });
}

function main(): void {
  const { date, outputDir } = options();
  const markdownPath = path.join(outputDir, "PARIDAD-" + date + ".md");
  const csvPath = path.join(outputDir, "PARIDAD-" + date + ".csv");
  if (existsSync(markdownPath) || existsSync(csvPath)) throw new Error("Ya existe un informe para " + date + "; no se sobrescribe.");

  const ideas = calcularParidadIdeas();
  const official = officialCases();
  const resolved = resolvePython(official.map((item) => item.python));
  const resolvedById = new Map(resolved.map((item) => [item.id, item]));
  if (resolvedById.size !== official.length || official.some((item) => !resolvedById.has(item.id))) {
    throw new Error("Python resolvió " + resolvedById.size + "/" + official.length + " casos oficiales.");
  }
  const rows = [
    ...ideas.map(ideaRow),
    ...official.map((item) => officialRow(item, resolvedById.get(item.id)!)),
  ];
  const checks = checkEditOperations();
  const snapshot = crosswalkIncluido().snapshot;
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(csvPath, csvReport(rows), { encoding: "utf8", flag: "wx" });
  writeFileSync(markdownPath, reportMarkdown(date, rows, baselineRows(), checks, snapshot), { encoding: "utf8", flag: "wx" });
  console.log("Informe: " + markdownPath);
  console.log("CSV: " + csvPath);
  console.log("Filas: " + rows.length + " (" + ideas.length + " ideas, " + official.length + " casos oficiales).");
}

if (require.main === module) main();
