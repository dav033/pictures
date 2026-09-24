import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { configurarPersistenciaTelemetria, esperarPersistenciaTelemetria, ultimosEventos, type EventoTelemetria } from "@sempertex/agente-core";
import { nivelPensamientoTelemetria } from "@sempertex/agente-core/gemini";
import { ThinkingLevel } from "@google/genai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analizarReferenciasV2, analysisConfigHash, sistemaAnalisis, type PaseObservado } from "@/lib/ia/amaterasu/analizar-referencias-v2";
import { STRUCTURE_RULES_V14_CANDIDATE, STRUCTURE_RULES_V15_CANDIDATE, STRUCTURE_RULES_V16_CANDIDATE } from "@/lib/ia/referencia/reference-structure";
import { MANIFIESTO_REFERENCIAS_EJEMPLO } from "@/lib/referencias-ejemplo/manifiesto";
import type { ChatPort, PeticionChat, TurnoChat } from "@/lib/ia/nucleo/tipos";

/**
 * Plan A §A0.1: per-pass telemetry of the reference analysis with a simulated
 * port. No network, no key, no database (persistence is replaced in memory).
 */

let casos = 0;
async function caso(nombre: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
}

const MENSAJE_SENSIBLE = "cliente-dice-algo-privado";

function chatSimulado(opciones: { thinkingLevel?: string; inventarioMalformadoPrimero?: boolean; finishReason?: string }): ChatPort {
  let inventarios = 0;
  return {
    id: "gemini",
    modelo: "gemini-simulado",
    ...(opciones.thinkingLevel !== undefined ? { thinkingLevel: opciones.thinkingLevel } : {}),
    async turno(peticion: PeticionChat): Promise<TurnoChat> {
      const nombre = peticion.herramientas[0]!.nombre;
      const base = { uso: { entrada: 10, salida: 5 }, modelo: "gemini-simulado", finishReason: opciones.finishReason ?? "STOP" };
      if (nombre === "return_reference_inventory") {
        inventarios += 1;
        if (opciones.inventarioMalformadoPrimero && inventarios === 1) return { ...base, texto: `{roto ${MENSAJE_SENSIBLE}`, llamadas: [] };
        return { ...base, texto: "", llamadas: [{ nombre, args: { images: [{ image_id: "REF_01", elements: [] }] } }] };
      }
      return { ...base, texto: "", llamadas: [{ nombre, args: { images: [{ image_id: "REF_01", elements: [] }] } }] };
    },
    async *turnoStream() {
      throw new Error("not used");
    },
  };
}

async function analizar(chat: ChatPort): Promise<{ eventos: EventoTelemetria[]; persistidos: EventoTelemetria[]; base64: string }> {
  const persistidos: EventoTelemetria[] = [];
  configurarPersistenciaTelemetria({ async guardar(evento) { persistidos.push(evento); } });
  const requestId = randomUUID();
  const base64 = randomBytes(64).toString("base64");
  await analizarReferenciasV2(chat, [{ id: "REF_01", mime: "image/jpeg", base64, descripcion: MENSAJE_SENSIBLE }], [], "perceptual", { requestId, correlationId: requestId });
  await esperarPersistenciaTelemetria();
  configurarPersistenciaTelemetria(undefined);
  return { eventos: ultimosEventos().filter((evento) => evento.requestId === requestId), persistidos, base64 };
}

async function run(): Promise<void> {
  await caso("cada pase ok registra finish_reason, config_hash y thinking_level (100 % de los eventos)", async () => {
    const { eventos, persistidos } = await analizar(chatSimulado({ thinkingLevel: "low" }));
    assert.deepEqual(eventos.map((evento) => evento.capacidad).sort(), ["analisis_referencia_auditoria", "analisis_referencia_inventario"]);
    for (const evento of eventos) {
      assert.equal(evento.resultado, "ok");
      assert.equal(evento.finishReason, "STOP");
      assert.match(evento.configHash ?? "", /^[0-9a-f]{64}$/);
      assert.equal(evento.thinkingLevel, "low");
      assert.match(evento.promptVersion ?? "", /^[0-9a-f]{16}$/);
    }
    assert.equal(new Set(eventos.map((evento) => evento.configHash)).size, 1, "un análisis, una configuración");
    assert.equal(persistidos.length, eventos.length, "lo que se persiste es lo mismo que el buffer");
  });

  await caso("el reintento por salida malformada registra su propio intento con finish_reason", async () => {
    const { eventos } = await analizar(chatSimulado({ thinkingLevel: "low", inventarioMalformadoPrimero: true, finishReason: "MAX_TOKENS" }));
    const inventario = eventos.filter((evento) => evento.capacidad === "analisis_referencia_inventario");
    assert.deepEqual(inventario.map((evento) => evento.intento).sort(), [1, 2]);
    assert.ok(inventario.every((evento) => evento.finishReason === "MAX_TOKENS" && evento.configHash));
  });

  await caso("sin contenido sensible: ni base64 de la imagen ni texto de mensajes o prompts en buffer ni persistencia", async () => {
    const { eventos, persistidos, base64 } = await analizar(chatSimulado({ thinkingLevel: "low", inventarioMalformadoPrimero: true }));
    const serializado = JSON.stringify([eventos, persistidos]);
    assert.ok(eventos.length >= 3);
    assert.ok(!serializado.includes(base64), "base64 de la imagen");
    assert.ok(!serializado.includes(MENSAJE_SENSIBLE), "texto del mensaje o de la respuesta");
    assert.doesNotMatch(serializado, /Inventory these references|DRAFT_INVENTORY|VALID CATALOG/, "texto de prompts");
  });

  await caso("A0.3 observarPase: cada intento de cada pase con sus argumentos crudos (null si fue malformado)", async () => {
    const pases: PaseObservado[] = [];
    const base64 = randomBytes(64).toString("base64");
    await analizarReferenciasV2(chatSimulado({ inventarioMalformadoPrimero: true, finishReason: "STOP" }), [{ id: "REF_01", mime: "image/jpeg", base64, descripcion: "x" }], [], "perceptual", undefined, undefined, { forzarNuevoAnalisis: true, observarPase: (pase) => pases.push(pase) });
    assert.deepEqual(pases.map((pase) => [pase.capacidad, pase.intento, pase.args === null]), [
      ["analisis_referencia_inventario", 1, true],
      ["analisis_referencia_inventario", 2, false],
      ["analisis_referencia_auditoria", 1, false],
    ]);
    assert.ok(pases.every((pase) => pase.ms >= 0 && pase.finishReason === "STOP" && pase.uso.entrada === 10));
    assert.deepEqual(pases[1]!.args, { images: [{ image_id: "REF_01", elements: [] }] });
    // Same photos again without forcing: served from cache, nothing observed.
    const cacheados: PaseObservado[] = [];
    const resultado = await analizarReferenciasV2(chatSimulado({}), [{ id: "REF_01", mime: "image/jpeg", base64, descripcion: "x" }], [], "perceptual", undefined, undefined, { observarPase: (pase) => cacheados.push(pase) });
    assert.equal(resultado.metadata.cached, true);
    assert.equal(cacheados.length, 0);
  });

  await caso("A0.3 observarPase: un error del observador se propaga y no se confunde con salida malformada", async () => {
    const llamadas: number[] = [];
    const chat = chatSimulado({});
    const turnoOriginal = chat.turno.bind(chat);
    chat.turno = async (peticion) => { llamadas.push(1); return turnoOriginal(peticion); };
    await assert.rejects(
      analizarReferenciasV2(chat, [{ id: "REF_01", mime: "image/jpeg", base64: randomBytes(64).toString("base64"), descripcion: "x" }], [], "perceptual", undefined, undefined, { forzarNuevoAnalisis: true, observarPase: () => { throw new SyntaxError("observador roto"); } }),
      /observador roto/,
    );
    assert.equal(llamadas.length, 1, "no retry was triggered by the observer error");
  });

  await caso("config_hash cambia con modelo, pensamiento, modo o prompt y es estable con los mismos datos", async () => {
    const base = { model: "m", thinkingLevel: "low", mode: "perceptual" as const, systemPromptHash: "a".repeat(64) };
    const hash = analysisConfigHash(base);
    assert.equal(analysisConfigHash({ ...base }), hash);
    for (const cambio of [{ model: "m2" }, { thinkingLevel: "default" }, { mode: "legacy" as const }, { systemPromptHash: "b".repeat(64) }]) {
      assert.notEqual(analysisConfigHash({ ...base, ...cambio }), hash, JSON.stringify(cambio));
    }
  });

  await caso("thinking_level efectivo del adaptador de Gemini usa los valores que acepta ai_call_log", () => {
    assert.equal(nivelPensamientoTelemetria(undefined), "default");
    assert.equal(nivelPensamientoTelemetria(ThinkingLevel.LOW), "low");
    assert.equal(nivelPensamientoTelemetria(ThinkingLevel.MINIMAL), "minimal");
    assert.equal(nivelPensamientoTelemetria(ThinkingLevel.THINKING_LEVEL_UNSPECIFIED), "default");
  });

  await caso("variante v14-candidato: el prompt de producción v13 no cambia y la candidata agrega sus reglas", () => {
    const v13 = sistemaAnalisis([], "perceptual");
    // Hash recorded for the v13 runs of 2026-09-15 (eval/results/estructuras/*/low): production prompt unchanged.
    assert.equal(v13.systemPromptHash, "5d956a13c38007baad72c3c045960a005a812f8cabfd8d257f970221ab418ce9");
    assert.equal(sistemaAnalisis([], "perceptual", "v13").systemPromptHash, v13.systemPromptHash);
    const v14 = sistemaAnalisis([], "perceptual", "v14-candidato");
    assert.notEqual(v14.systemPromptHash, v13.systemPromptHash);
    assert.ok(v14.inventorySystem.startsWith(v13.inventorySystem) && v14.inventorySystem.endsWith(STRUCTURE_RULES_V14_CANDIDATE));
    assert.ok(v14.auditSystem.endsWith(STRUCTURE_RULES_V14_CANDIDATE));
    const v15 = sistemaAnalisis([], "perceptual", "v15-candidato");
    assert.ok(v15.inventorySystem.startsWith(v13.inventorySystem) && v15.inventorySystem.endsWith(STRUCTURE_RULES_V15_CANDIDATE));
    const v16 = sistemaAnalisis([], "perceptual", "v16-candidato");
    assert.ok(v16.auditSystem.endsWith(STRUCTURE_RULES_V16_CANDIDATE));
    assert.equal(new Set([v13.systemPromptHash, v14.systemPromptHash, v15.systemPromptHash, v16.systemPromptHash]).size, 4);
  });

  await caso("variante v14-candidato: nunca reutiliza el análisis fijo de la galería (resultados v13)", async () => {
    const foto = MANIFIESTO_REFERENCIAS_EJEMPLO.fotos[0]!;
    const base64 = readFileSync(resolve(process.cwd(), "public", "referencias-ejemplo", foto.archivo)).toString("base64");
    let llamadas = 0;
    const chat = chatSimulado({ thinkingLevel: "low" });
    const turno = chat.turno.bind(chat);
    chat.turno = async (p) => { llamadas += 1; return turno(p); };
    const v13 = await analizarReferenciasV2(chat, [{ id: "REF_01", mime: "image/jpeg", base64, descripcion: "x" }], [], "perceptual");
    assert.equal(llamadas, 0, "v13 keeps serving the stored gallery analysis");
    assert.equal(v13.metadata.cached, true);
    await analizarReferenciasV2(chat, [{ id: "REF_01", mime: "image/jpeg", base64, descripcion: "x" }], [], "perceptual", undefined, undefined, { variante: "v14-candidato" });
    assert.ok(llamadas >= 2, "the candidate calls the provider instead of reusing v13 results");
  });

  console.log(`[PASS] ${casos} casos de telemetría del análisis de referencias`);
}

run().catch((error: unknown) => {
  console.error("[FAIL]", error);
  process.exitCode = 1;
});
