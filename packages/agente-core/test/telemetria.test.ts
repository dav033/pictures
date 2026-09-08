import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { extraerUsoGemini } from "../src/gemini/chat";
import {
  CAPACIDADES_IA,
  FLUJOS_IA,
  calcularCosteEstimado,
  configurarPersistenciaTelemetria,
  crearPersistenciaPostgres,
  esperarPersistenciaTelemetria,
  registrarLlamadaIA,
  ultimosEventos,
} from "../src/telemetria";

const eventoBase = {
  flujo: "armador_decoracion" as const,
  capacidad: "chat_turno" as const,
  proveedor: "gemini" as const,
  modelo: "gemini-test",
  ms: 12,
  resultado: "ok" as const,
};

afterEach(async () => {
  await esperarPersistenciaTelemetria();
  configurarPersistenciaTelemetria(undefined);
  globalThis.__telemetriaAgenteCore = [];
});

test("catálogos mantienen ocho flujos y doce capacidades sin duplicados", () => {
  assert.equal(FLUJOS_IA.length, 8);
  assert.equal(new Set(FLUJOS_IA).size, 8);
  assert.equal(CAPACIDADES_IA.length, 12);
  assert.equal(new Set(CAPACIDADES_IA).size, 12);
});

test("flujo desconocido falla antes de contaminar métricas", () => {
  assert.throws(
    () => registrarLlamadaIA({ ...eventoBase, flujo: "flujo_inventado" as never }),
    /Taxonomía IA inválida/,
  );
  assert.equal(ultimosEventos().length, 0);
});

test("Gemini conserva tokens de pensamiento y prompt de herramientas", () => {
  assert.deepEqual(
    extraerUsoGemini({
      promptTokenCount: 10,
      candidatesTokenCount: 4,
      cachedContentTokenCount: 2,
      thoughtsTokenCount: 7,
      toolUsePromptTokenCount: 3,
    }),
    { entrada: 10, salida: 4, cacheados: 2, pensamiento: 7, promptHerramientas: 3 },
  );
});

test("coste separa caché, pensamiento y unidad sin duplicar prompt de herramientas", () => {
  const costeTokens = calcularCosteEstimado(
    { tokensEntrada: 1_000_000, tokensCacheados: 200_000, tokensSalida: 100_000,
      tokensPensamiento: 50_000, tokensPromptHerramientas: 999_999 },
    { tipoUnidad: "millon_tokens", precioEntrada: 1, precioSalida: 2, precioCacheado: 0.25, moneda: "USD" },
  );
  assert.equal(costeTokens, 1.15);
  assert.equal(
    calcularCosteEstimado({ unidadesFacturadas: 2 }, { tipoUnidad: "generacion", precioUnidad: 0.04, moneda: "USD" }),
    0.08,
  );
});

test("fallos síncronos y asíncronos de persistencia no rompen el turno", async () => {
  configurarPersistenciaTelemetria({ guardar: async () => { throw new Error("DB caída") } });
  assert.doesNotThrow(() => registrarLlamadaIA(eventoBase));
  await esperarPersistenciaTelemetria();

  configurarPersistenciaTelemetria({ guardar: () => { throw new Error("cliente roto") } });
  assert.doesNotThrow(() => registrarLlamadaIA(eventoBase));
  assert.equal(ultimosEventos().length, 2);
});

test("persistencia SQL guarda metadatos pero no contenido ni error crudo", async () => {
  let sql = "";
  let parametros: readonly unknown[] = [];
  configurarPersistenciaTelemetria(crearPersistenciaPostgres(async (consulta, valores) => {
    sql = consulta;
    parametros = valores;
  }));

  registrarLlamadaIA({
    ...eventoBase,
    tokensPensamiento: 8,
    tokensPromptHerramientas: 5,
    error: "texto sensible que solo vive en buffer",
  });
  await esperarPersistenciaTelemetria();

  assert.match(sql, /tokens_pensamiento/);
  assert.match(sql, /tokens_prompt_herramientas/);
  assert.doesNotMatch(sql, /prompt_text|mensaje|conversacion|base64|error/i);
  assert.ok(!parametros.includes("texto sensible que solo vive en buffer"));
  assert.equal(ultimosEventos()[0]?.error, "texto sensible que solo vive en buffer");
});
