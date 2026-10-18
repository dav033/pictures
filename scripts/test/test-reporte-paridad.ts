import assert from "node:assert/strict";
import { csvReport, officialCases, type ReportRow } from "../motor/reporte-paridad";

const cases = officialCases();
assert.equal(cases.length, 54, "each of 18 official structures must have three size cases");
assert.equal(new Set(cases.map((item) => item.id.split(":")[0])).size, 18);

const defaultArc = cases.find((item) => item.id === "oficial-arco:default");
const compactArc = cases.find((item) => item.id === "oficial-arco:compacta (-25%)");
const expandedArc = cases.find((item) => item.id === "oficial-arco:ampliada (+25%)");
assert.ok(defaultArc && compactArc && expandedArc);
assert.deepEqual(defaultArc.python.measures, { anchoM: 3, altoM: 2.4 });
assert.deepEqual(compactArc.python.measures, { anchoM: 2.25, altoM: 1.8 });
assert.deepEqual(expandedArc.python.measures, { anchoM: 3.75, altoM: 3 });

const row: ReportRow = {
  id: 'caso,"uno"',
  kind: "official",
  variant: "default",
  pythonCount: 10,
  engineCount: 12,
  countDeltaPct: 20,
  colorSetEqual: true,
  sizeMixEqual: false,
  pythonColors: ["azul"],
  engineColors: ["azul"],
  pythonSizeMix: { "R-12": 10 },
  engineSizeMix: { "R-12": 12 },
  pythonPriceCop: 1000,
  enginePriceCop: 1200,
  priceDeltaPct: 20,
  pythonAxisM: 2.5,
  pythonMeasuresM: { ancho_m: 2.4 },
  engineBoxM: [[2.5, 2.4, 0.4]],
  engineUnrepresentable: [],
  pythonUncovered: [],
  pythonWarnings: [],
};
const csv = csvReport([row]);
assert.ok(csv.includes('"caso,""uno"""'), "CSV must escape quotes and commas in fields");
assert.ok(csv.includes('"{""R-12"":10}"'), "CSV must quote serialized maps");
assert.ok(csv.endsWith("\n"));

console.log("test-reporte-paridad: passed (54 cases, default dimensions, scaling, CSV escaping).");
