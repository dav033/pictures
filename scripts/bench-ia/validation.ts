import type {
  BenchDataset,
  BenchScenario,
  BenchTurn,
  HistoricalReference,
  PricingCatalog,
  PricingModel,
  TokenUsage,
} from "./types";

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} debe ser un objeto`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} debe ser texto no vacío`);
  }
  return value;
}

function nonNegative(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} debe ser número finito no negativo`);
  }
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  const result = nonNegative(value, path);
  if (!Number.isInteger(result) || result < minimum) {
    throw new Error(`${path} debe ser entero >= ${minimum}`);
  }
  return result;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} debe ser lista no vacía`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} debe ser booleano`);
  return value;
}

function tokenUsage(value: unknown, path: string): TokenUsage {
  const item = object(value, path);
  const result = {
    capacidad: string(item.capacidad, `${path}.capacidad`),
    modelo: string(item.modelo, `${path}.modelo`),
    tokensEntrada: integer(item.tokensEntrada, `${path}.tokensEntrada`),
    tokensSalida: integer(item.tokensSalida, `${path}.tokensSalida`),
    tokensPensamiento: integer(item.tokensPensamiento, `${path}.tokensPensamiento`),
    tokensCacheados: integer(item.tokensCacheados, `${path}.tokensCacheados`),
  };
  if (result.tokensCacheados > result.tokensEntrada) {
    throw new Error(`${path}.tokensCacheados no puede superar tokensEntrada`);
  }
  return result;
}

function turn(value: unknown, path: string): BenchTurn {
  const item = object(value, path);
  const result: BenchTurn = {
    id: string(item.id, `${path}.id`),
    parseoMs: nonNegative(item.parseoMs, `${path}.parseoMs`),
    retrievalMs: nonNegative(item.retrievalMs, `${path}.retrievalMs`),
    ttftMs: nonNegative(item.ttftMs, `${path}.ttftMs`),
    totalMs: nonNegative(item.totalMs, `${path}.totalMs`),
    vueltas: integer(item.vueltas, `${path}.vueltas`, 1),
    bytesImagenEntrada: integer(item.bytesImagenEntrada, `${path}.bytesImagenEntrada`),
    llamadas: array(item.llamadas, `${path}.llamadas`).map((entry, index) =>
      tokenUsage(entry, `${path}.llamadas[${index}]`),
    ),
  };
  if (result.ttftMs > result.totalMs) {
    throw new Error(`${path}.ttftMs no puede superar totalMs`);
  }
  return result;
}

function reference(value: unknown, path: string): HistoricalReference | undefined {
  if (value === undefined) return undefined;
  const item = object(value, path);
  if (item.metrica !== "parseo_p50_ms" && item.metrica !== "total_p50_ms") {
    throw new Error(`${path}.metrica no reconocida`);
  }
  return {
    metrica: item.metrica,
    valorMs: nonNegative(item.valorMs, `${path}.valorMs`),
    muestraReal: integer(item.muestraReal, `${path}.muestraReal`, 1),
    nota: string(item.nota, `${path}.nota`),
  };
}

function scenario(value: unknown, path: string): BenchScenario {
  const item = object(value, path);
  const rawConfig = object(item.configuracion, `${path}.configuracion`);
  const configuracion = Object.fromEntries(
    Object.entries(rawConfig).map(([key, entry]) => [key, string(entry, `${path}.configuracion.${key}`)]),
  );
  return {
    id: string(item.id, `${path}.id`),
    etiqueta: string(item.etiqueta, `${path}.etiqueta`),
    configuracion,
    referenciaHistorica: reference(item.referenciaHistorica, `${path}.referenciaHistorica`),
    turnos: array(item.turnos, `${path}.turnos`).map((entry, index) =>
      turn(entry, `${path}.turnos[${index}]`),
    ),
  };
}

export function validateDataset(value: unknown): BenchDataset {
  const item = object(value, "dataset");
  if (item.schemaVersion !== "ia-bench.v1") throw new Error("schemaVersion de dataset no soportada");
  const provenance = object(item.procedencia, "dataset.procedencia");
  if (provenance.tipo !== "fixture" && provenance.tipo !== "real") {
    throw new Error("dataset.procedencia.tipo no reconocido");
  }
  const scenarios = array(item.escenarios, "dataset.escenarios").map((entry, index) =>
    scenario(entry, `dataset.escenarios[${index}]`),
  );
  if (new Set(scenarios.map(({ id }) => id)).size !== scenarios.length) {
    throw new Error("IDs de escenario duplicados");
  }
  return {
    schemaVersion: item.schemaVersion,
    fixtureVersion: string(item.fixtureVersion, "dataset.fixtureVersion"),
    procedencia: {
      tipo: provenance.tipo,
      llamadasProveedorReal: boolean(
        provenance.llamadasProveedorReal,
        "dataset.procedencia.llamadasProveedorReal",
      ),
      baseDatosRemota: boolean(provenance.baseDatosRemota, "dataset.procedencia.baseDatosRemota"),
      nota: string(provenance.nota, "dataset.procedencia.nota"),
    },
    escenarios: scenarios,
  };
}

function pricingModel(value: unknown, path: string): PricingModel {
  const item = object(value, path);
  return {
    modelo: string(item.modelo, `${path}.modelo`),
    moneda: string(item.moneda, `${path}.moneda`),
    precioEntradaPorMillon: nonNegative(item.precioEntradaPorMillon, `${path}.precioEntradaPorMillon`),
    precioSalidaPorMillon: nonNegative(item.precioSalidaPorMillon, `${path}.precioSalidaPorMillon`),
    precioCacheadoPorMillon: nonNegative(item.precioCacheadoPorMillon, `${path}.precioCacheadoPorMillon`),
    fuente: string(item.fuente, `${path}.fuente`),
  };
}

export function validatePricing(value: unknown): PricingCatalog {
  const item = object(value, "pricing");
  if (item.schemaVersion !== "ia-pricing.v1") throw new Error("schemaVersion de precios no soportada");
  if (item.estimado !== true) throw new Error("pricing.estimado debe ser true");
  const models = array(item.modelos, "pricing.modelos").map((entry, index) =>
    pricingModel(entry, `pricing.modelos[${index}]`),
  );
  if (new Set(models.map(({ modelo }) => modelo)).size !== models.length) {
    throw new Error("Modelos de precios duplicados");
  }
  return {
    schemaVersion: item.schemaVersion,
    pricingVersion: string(item.pricingVersion, "pricing.pricingVersion"),
    vigenteDesde: string(item.vigenteDesde, "pricing.vigenteDesde"),
    estimado: true,
    modelos: models,
  };
}
