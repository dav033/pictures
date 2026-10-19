import type {
  BenchDataset,
  BenchReport,
  BenchTurn,
  CostByModel,
  PricingCatalog,
  PricingModel,
  ScenarioReport,
  TurnReport,
} from "./types";

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function estimateTurnCosts(turn: BenchTurn, models: Map<string, PricingModel>): CostByModel[] {
  const totals = new Map<string, CostByModel>();
  for (const call of turn.llamadas) {
    const pricing = models.get(call.modelo);
    if (!pricing) throw new Error(`Falta precio versionado para modelo ${call.modelo}`);
    const uncachedInputTokens = call.tokensEntrada - call.tokensCacheados;
    const cost =
      (uncachedInputTokens * pricing.precioEntradaPorMillon +
        (call.tokensSalida + call.tokensPensamiento) * pricing.precioSalidaPorMillon +
        call.tokensCacheados * pricing.precioCacheadoPorMillon) /
      1_000_000;
    const key = `${pricing.modelo}\u0000${pricing.moneda}`;
    const current = totals.get(key);
    totals.set(key, {
      modelo: pricing.modelo,
      moneda: pricing.moneda,
      costeEstimado: (current?.costeEstimado ?? 0) + cost,
    });
  }
  return [...totals.values()].sort((left, right) => left.modelo.localeCompare(right.modelo));
}

function turnReport(turn: BenchTurn, models: Map<string, PricingModel>): TurnReport {
  return {
    ...turn,
    tokensEntrada: sum(turn.llamadas.map((call) => call.tokensEntrada)),
    tokensSalida: sum(turn.llamadas.map((call) => call.tokensSalida)),
    tokensPensamiento: sum(turn.llamadas.map((call) => call.tokensPensamiento)),
    tokensCacheados: sum(turn.llamadas.map((call) => call.tokensCacheados)),
    costes: estimateTurnCosts(turn, models),
  };
}

function aggregateCosts(turns: TurnReport[]): CostByModel[] {
  const totals = new Map<string, CostByModel>();
  for (const turn of turns) {
    for (const cost of turn.costes) {
      const key = `${cost.modelo}\u0000${cost.moneda}`;
      const current = totals.get(key);
      totals.set(key, { ...cost, costeEstimado: (current?.costeEstimado ?? 0) + cost.costeEstimado });
    }
  }
  return [...totals.values()].sort((left, right) => left.modelo.localeCompare(right.modelo));
}

function scenarioReport(
  scenario: BenchDataset["escenarios"][number],
  models: Map<string, PricingModel>,
): ScenarioReport {
  const turns = scenario.turnos.map((turn) => turnReport(turn, models));
  const parseoP50Ms = median(turns.map((turn) => turn.parseoMs));
  const totalP50Ms = median(turns.map((turn) => turn.totalMs));
  const reference = scenario.referenciaHistorica;
  const measuredForReference = reference?.metrica === "parseo_p50_ms" ? parseoP50Ms : totalP50Ms;
  return {
    id: scenario.id,
    etiqueta: scenario.etiqueta,
    configuracion: scenario.configuracion,
    referenciaHistorica: reference
      ? {
          ...reference,
          fixtureDentroDe15PorCiento:
            Math.abs(measuredForReference - reference.valorMs) / reference.valorMs <= 0.15,
          soloCalibracion: true,
        }
      : undefined,
    resumen: {
      turnos: turns.length,
      parseoP50Ms,
      retrievalP50Ms: median(turns.map((turn) => turn.retrievalMs)),
      ttftP50Ms: median(turns.map((turn) => turn.ttftMs)),
      totalP50Ms,
      vueltasPromedio: sum(turns.map((turn) => turn.vueltas)) / turns.length,
      tokensEntrada: sum(turns.map((turn) => turn.tokensEntrada)),
      tokensSalida: sum(turns.map((turn) => turn.tokensSalida)),
      tokensPensamiento: sum(turns.map((turn) => turn.tokensPensamiento)),
      tokensCacheados: sum(turns.map((turn) => turn.tokensCacheados)),
      bytesImagenEntrada: sum(turns.map((turn) => turn.bytesImagenEntrada)),
      costes: aggregateCosts(turns),
    },
    turnos: turns,
  };
}

export function buildReport(dataset: BenchDataset, pricing: PricingCatalog): BenchReport {
  if (dataset.procedencia.tipo === "fixture") {
    if (dataset.procedencia.llamadasProveedorReal || dataset.procedencia.baseDatosRemota) {
      throw new Error("Fixture no puede declarar proveedor real ni base remota");
    }
  } else if (!dataset.procedencia.llamadasProveedorReal) {
    throw new Error("Dataset real debe declarar llamadasProveedorReal=true");
  }
  const models = new Map(pricing.modelos.map((model) => [model.modelo, model]));
  return {
    schemaVersion: "ia-bench-report.v1",
    generadoDesde: dataset.procedencia.tipo,
    fixtureVersion: dataset.fixtureVersion,
    pricingVersion: pricing.pricingVersion,
    advertencias:
      dataset.procedencia.tipo === "fixture"
        ? [
            "Datos simulados: no son una medición actual de Gemini, fal.ai ni PostgreSQL.",
            "La comparación ±15% solo comprueba calibración del fixture contra referencias históricas; no reproduce la API real.",
            "Costes estimados con precios de prueba versionados; no equivalen a una factura ni a tarifas vigentes.",
          ]
        : ["Costes estimados; no equivalen a factura del proveedor."],
    escenarios: dataset.escenarios.map((scenario) => scenarioReport(scenario, models)),
  };
}

function costText(costs: CostByModel[]): string {
  return costs
    .map((cost) => `${cost.modelo}: ${cost.costeEstimado.toFixed(6)} ${cost.moneda} estimado`)
    .join("; ");
}

export function renderText(report: BenchReport): string {
  const lines = [
    `IA bench ${report.fixtureVersion} · fuente=${report.generadoDesde} · precios=${report.pricingVersion}`,
    ...report.advertencias.map((warning) => `ADVERTENCIA: ${warning}`),
  ];
  for (const scenario of report.escenarios) {
    const summary = scenario.resumen;
    lines.push(
      "",
      `${scenario.etiqueta} (${summary.turnos} turnos)`,
      `p50 ms: parseo=${summary.parseoP50Ms} retrieval=${summary.retrievalP50Ms} TTFT=${summary.ttftP50Ms} total=${summary.totalP50Ms}`,
      `vueltas promedio=${summary.vueltasPromedio.toFixed(2)} · bytes imagen=${summary.bytesImagenEntrada}`,
      `tokens: entrada=${summary.tokensEntrada} salida=${summary.tokensSalida} pensamiento=${summary.tokensPensamiento} cacheados=${summary.tokensCacheados}`,
      `coste: ${costText(summary.costes)}`,
    );
    if (scenario.referenciaHistorica) {
      lines.push(
        `referencia histórica=${scenario.referenciaHistorica.valorMs} ms · fixture ±15%=${scenario.referenciaHistorica.fixtureDentroDe15PorCiento ? "sí" : "no"} · SOLO CALIBRACIÓN`,
      );
    }
    for (const turn of scenario.turnos) {
      lines.push(
        `  ${turn.id}: parseo=${turn.parseoMs} retrieval=${turn.retrievalMs} TTFT=${turn.ttftMs} total=${turn.totalMs} ms · vueltas=${turn.vueltas} · tokens=${turn.tokensEntrada}/${turn.tokensSalida}/${turn.tokensPensamiento}/${turn.tokensCacheados} · imagen=${turn.bytesImagenEntrada} B · ${costText(turn.costes)}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
