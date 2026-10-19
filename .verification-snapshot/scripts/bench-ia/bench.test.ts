import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertRealModeGate } from "./cli";
import { buildReport } from "./report";
import { validateDataset, validatePricing } from "./validation";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(process.cwd(), "eval", "ia", name), "utf8")) as unknown;
}

async function main(): Promise<void> {
  const dataset = validateDataset(await fixture(path.join("fixtures", "chapter-3-v001.json")));
  const pricing = validatePricing(await fixture(path.join("pricing", "pricing-v001.json")));
  const report = buildReport(dataset, pricing);

  assert.equal(report.generadoDesde, "fixture");
  assert.equal(report.escenarios.length, 4);
  assert.deepEqual(
  report.escenarios.map((scenario) => scenario.resumen.parseoP50Ms),
  [4478, 1263, 1263, 1263],
);
  assert.deepEqual(
  report.escenarios.map((scenario) => scenario.resumen.totalP50Ms),
  [10840, 7166, 14047, 7166],
);
  assert.ok(report.escenarios.every((scenario) => scenario.referenciaHistorica?.fixtureDentroDe15PorCiento));

  const firstTurn = report.escenarios[0].turnos[0];
  assert.equal(firstTurn.tokensPensamiento, 1040);
  assert.equal(firstTurn.tokensCacheados, 0);
  assert.ok(firstTurn.costes.every((cost) => cost.costeEstimado > 0));

  const oneCallDataset = structuredClone(dataset);
  oneCallDataset.escenarios = [structuredClone(dataset.escenarios[0])];
  oneCallDataset.escenarios[0].turnos = [
  {
    id: "cost-check",
    parseoMs: 1,
    retrievalMs: 1,
    ttftMs: 1,
    totalMs: 2,
    vueltas: 1,
    bytesImagenEntrada: 0,
    llamadas: [
      {
        capacidad: "chat_turno",
        modelo: "gemini-3.6-flash",
        tokensEntrada: 1_000_000,
        tokensSalida: 1_000_000,
        tokensPensamiento: 1_000_000,
        tokensCacheados: 1_000_000,
      },
    ],
  },
  ];
  assert.equal(buildReport(oneCallDataset, pricing).escenarios[0].resumen.costes[0].costeEstimado, 6.05);

  assert.throws(
  () => assertRealModeGate({ mode: "real", json: false, driverArgs: [] }, {}),
  /Modo real bloqueado/,
);
  assert.doesNotThrow(() =>
  assertRealModeGate(
    {
      mode: "real",
      json: false,
      driver: "driver",
      driverArgs: [],
      paidAck: "I_ACCEPT_PAID_PROVIDER_CALLS",
      dbAck: "I_ACCEPT_REMOTE_DATABASE_ACCESS",
    },
    { IA_BENCH_ENABLE_REAL: "YES_I_ACCEPT_PAID_PROVIDER_AND_REMOTE_DB" },
  ),
  );

  const invalid = structuredClone(dataset) as unknown as {
    escenarios: Array<{ turnos: Array<{ ttftMs: number }> }>;
  };
  invalid.escenarios[0].turnos[0].ttftMs = 999_999;
  assert.throws(() => validateDataset(invalid), /ttftMs no puede superar totalMs/);

  process.stdout.write("bench-ia: 10 comprobaciones OK\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
