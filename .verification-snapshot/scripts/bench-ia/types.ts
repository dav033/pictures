export type BenchSource = "fixture" | "real";

export type TokenUsage = {
  capacidad: string;
  modelo: string;
  tokensEntrada: number;
  tokensSalida: number;
  tokensPensamiento: number;
  tokensCacheados: number;
};

export type BenchTurn = {
  id: string;
  parseoMs: number;
  retrievalMs: number;
  ttftMs: number;
  totalMs: number;
  vueltas: number;
  bytesImagenEntrada: number;
  llamadas: TokenUsage[];
};

export type HistoricalReference = {
  metrica: "parseo_p50_ms" | "total_p50_ms";
  valorMs: number;
  muestraReal: number;
  nota: string;
};

export type BenchScenario = {
  id: string;
  etiqueta: string;
  configuracion: Record<string, string>;
  referenciaHistorica?: HistoricalReference;
  turnos: BenchTurn[];
};

export type BenchDataset = {
  schemaVersion: "ia-bench.v1";
  fixtureVersion: string;
  procedencia: {
    tipo: BenchSource;
    llamadasProveedorReal: boolean;
    baseDatosRemota: boolean;
    nota: string;
  };
  escenarios: BenchScenario[];
};

export type PricingModel = {
  modelo: string;
  moneda: string;
  precioEntradaPorMillon: number;
  precioSalidaPorMillon: number;
  precioCacheadoPorMillon: number;
  fuente: string;
};

export type PricingCatalog = {
  schemaVersion: "ia-pricing.v1";
  pricingVersion: string;
  vigenteDesde: string;
  estimado: true;
  modelos: PricingModel[];
};

export type CostByModel = {
  modelo: string;
  moneda: string;
  costeEstimado: number;
};

export type TurnReport = BenchTurn & {
  tokensEntrada: number;
  tokensSalida: number;
  tokensPensamiento: number;
  tokensCacheados: number;
  costes: CostByModel[];
};

export type ScenarioReport = {
  id: string;
  etiqueta: string;
  configuracion: Record<string, string>;
  referenciaHistorica?: HistoricalReference & {
    fixtureDentroDe15PorCiento: boolean;
    soloCalibracion: true;
  };
  resumen: {
    turnos: number;
    parseoP50Ms: number;
    retrievalP50Ms: number;
    ttftP50Ms: number;
    totalP50Ms: number;
    vueltasPromedio: number;
    tokensEntrada: number;
    tokensSalida: number;
    tokensPensamiento: number;
    tokensCacheados: number;
    bytesImagenEntrada: number;
    costes: CostByModel[];
  };
  turnos: TurnReport[];
};

export type BenchReport = {
  schemaVersion: "ia-bench-report.v1";
  generadoDesde: BenchSource;
  fixtureVersion: string;
  pricingVersion: string;
  advertencias: string[];
  escenarios: ScenarioReport[];
};
