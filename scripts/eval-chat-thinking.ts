import { ThinkingLevel } from "@google/genai";
import { crearChatGemini } from "../src/lib/ia/gemini/chat";
import { ejecutarConversacion, type ResultadoConversacion } from "../src/lib/ia/ejecutar";
import { construirSistema } from "../src/lib/ia/prompt-sistema";
import type { Brief } from "../src/lib/types";
import type { Mensaje as MensajeIA } from "../src/lib/ia/tipos";

// El .env se carga con `--env-file` en el comando npm (rag:eval-chat), NO con
// process.loadEnvFile aquí: este script importa ejecutar.ts, que importa
// flags.ts, que lee RAG_ENABLED en el top-level del módulo — un
// process.loadEnvFile() después de los imports llega tarde (los imports ya
// se resolvieron con RAG_ENABLED=undefined). --env-file carga a nivel de
// proceso, antes de que cualquier módulo se evalúe.

/**
 * Regresión conversacional de PLAN_RENDIMIENTO_RAG.md Fase 4 (riesgo ALTO:
 * bajar el thinking del turno de CHAT, no del parser). A diferencia de
 * eval-query-parser.ts (campos estructurados deterministas), aquí lo que
 * puede romperse es orquestación de herramientas y honestidad en texto libre
 * — así que las aserciones son sobre la TRAZA de herramientas llamadas
 * (instrumentada vía onLlamada, ver ejecutar.ts) y sobre invariantes
 * estructurales del resultado (nunca sobre coincidencia exacta de texto).
 *
 * Usa el prompt de producción real (construirSistema) y el catálogo real —
 * nada de esto es contra un mock.
 */

const RAG_ENABLED = process.env.RAG_ENABLED === "true";
const RAG_FRANJAS_ENABLED = process.env.RAG_FRANJAS_ENABLED === "true";

type Caso = {
  nombre: string;
  dimension: string;
  mensaje: string;
  brief?: Brief;
  /** Verificación estructural dura — recibe el resultado y la traza de
   * llamadas a herramientas (nombre + args, en orden). */
  verificar: (r: ResultadoConversacion, trazas: { nombre: string; args: Record<string, unknown> }[]) => string[];
};

const CASOS: Caso[] = [
  {
    nombre: "Flujo básico: buscar y confirmar",
    dimension: "elección de herramienta",
    mensaje: "Quiero decorar un cumpleaños infantil con globos dorados",
    verificar: (r, trazas) => {
      const fallos: string[] = [];
      if (!trazas.some((t) => t.nombre === "buscar_catalogo_rag")) fallos.push("nunca llamó buscar_catalogo_rag");
      if (!trazas.some((t) => t.nombre === "confirmar_seleccion_rag")) fallos.push("nunca llamó confirmar_seleccion_rag");
      if (!r.seleccionFinalIA?.length) fallos.push("no quedó una selección final (seleccionFinalIA vacío)");
      if (r.ragRechazados?.length) fallos.push(`hubo rechazos inesperados: ${JSON.stringify(r.ragRechazados)}`);
      return fallos;
    },
  },
  {
    nombre: "NO_MATCH honesto: producto absurdo",
    dimension: "no inventar / NO_MATCH",
    mensaje: "Necesito un dron decorativo con motor a gasolina para mi fiesta, y un unicornio comestible de peluche gigante",
    verificar: (r, trazas) => {
      const fallos: string[] = [];
      if (!trazas.some((t) => t.nombre === "buscar_catalogo_rag")) fallos.push("nunca intentó buscar");
      if (r.seleccionFinalIA?.length) fallos.push(`confirmó algo para un pedido imposible: ${JSON.stringify(r.seleccionFinalIA.map((p) => p.nombre))}`);
      return fallos;
    },
  },
  {
    nombre: "SKU inexistente: no inventar",
    dimension: "no inventar / whitelist",
    mensaje: "Quiero el producto con SKU 99999999-FALSO-NO-EXISTE",
    verificar: (r) => {
      const fallos: string[] = [];
      if (r.seleccionFinalIA?.length) fallos.push(`confirmó algo para un SKU que no existe: ${JSON.stringify(r.seleccionFinalIA.map((p) => p.nombre))}`);
      return fallos;
    },
  },
  {
    nombre: "guardar_brief captura los datos correctos",
    dimension: "elección de herramienta",
    mensaje: "Es un cumpleaños de niña, en la tarde, como 20 invitados, en tonos rosado y dorado, presupuesto alrededor de 80 mil pesos",
    verificar: (r, trazas) => {
      const fallos: string[] = [];
      if (!trazas.some((t) => t.nombre === "guardar_brief")) fallos.push("nunca llamó guardar_brief");
      const brief = r.brief ?? {};
      const tipoOk = /cumpl/i.test(brief.tipo_evento ?? "");
      const coloresOk = (brief.colores ?? []).some((c) => /rosad|dorad/i.test(c));
      if (!tipoOk) fallos.push(`tipo_evento no capturó "cumpleaños": ${JSON.stringify(brief.tipo_evento)}`);
      if (!coloresOk) fallos.push(`colores no capturó rosado/dorado: ${JSON.stringify(brief.colores)}`);
      return fallos;
    },
  },
  {
    nombre: "Paquete armado explícito → buscar_decoraciones",
    dimension: "elección de herramienta",
    mensaje: "Quiero un paquete ya armado para una boda estilo boho en jardín",
    verificar: (_r, trazas) => {
      const fallos: string[] = [];
      if (!trazas.some((t) => t.nombre === "buscar_decoraciones")) fallos.push("pidió explícitamente un paquete armado y no llamó buscar_decoraciones");
      return fallos;
    },
  },
  {
    nombre: "Múltiples elementos: una búsqueda por cada uno",
    dimension: "elección de herramienta (regla compleja)",
    mensaje: "Quiero globos azules y plateados, y también un telón o cortina metalizada de fondo para la foto",
    verificar: (_r, trazas) => {
      const fallos: string[] = [];
      const busquedas = trazas.filter((t) => t.nombre === "buscar_catalogo_rag");
      if (busquedas.length < 2) fallos.push(`solo ${busquedas.length} búsqueda(s) para 2 elementos distintos (globos + telón/cortina)`);
      return fallos;
    },
  },
  {
    nombre: "Presupuesto con franja resuelta",
    dimension: "franjas de presupuesto",
    mensaje: "Tengo 90 mil pesos para decorar un cumpleaños con globos azules",
    brief: { presupuesto: 90_000 },
    verificar: (r, trazas) => {
      const fallos: string[] = [];
      if (!trazas.some((t) => t.nombre === "buscar_catalogo_rag")) fallos.push("nunca buscó");
      if (RAG_FRANJAS_ENABLED && !r.seleccionFinalIA?.length) fallos.push("con franja resuelta y RAG_FRANJAS_ENABLED, no quedó selección final");
      return fallos;
    },
  },
];

const REPETICIONES = 2;

type ConfigThinking = { nombre: string; thinkingLevel?: ThinkingLevel };
const CONFIGS: ConfigThinking[] = [
  { nombre: "baseline (medium, actual)" },
  { nombre: "low", thinkingLevel: ThinkingLevel.LOW },
  { nombre: "minimal", thinkingLevel: ThinkingLevel.MINIMAL },
];

async function correrCaso(config: ConfigThinking, caso: Caso) {
  const chat = crearChatGemini({ thinkingLevel: config.thinkingLevel });
  const sistema = construirSistema({ ragEnabled: RAG_ENABLED, franjasEnabled: RAG_FRANJAS_ENABLED, brief: caso.brief });
  const historial: MensajeIA[] = [{ rol: "usuario", texto: caso.mensaje }];
  const trazas: { nombre: string; args: Record<string, unknown> }[] = [];

  const t0 = Date.now();
  const resultado = await ejecutarConversacion({
    chat,
    sistema,
    historial,
    brief: caso.brief ?? {},
    onLlamada: (nombre, args) => trazas.push({ nombre, args }),
  });
  const ms = Date.now() - t0;

  const fallos = caso.verificar(resultado, trazas);
  return { fallos, ms, trazas: trazas.map((t) => t.nombre), texto: resultado.texto };
}

async function main() {
  console.log(`Regresión conversacional — ${CASOS.length} casos x ${REPETICIONES} repeticiones x ${CONFIGS.length} configs\n`);
  console.log(`RAG_ENABLED=${RAG_ENABLED} RAG_FRANJAS_ENABLED=${RAG_FRANJAS_ENABLED}\n`);

  const resumen: Record<string, { estables: number; latencias: number[] }> = {};
  for (const config of CONFIGS) resumen[config.nombre] = { estables: 0, latencias: [] };

  for (const caso of CASOS) {
    console.log(`\n=== ${caso.nombre} (${caso.dimension}) ===`);
    console.log(`  "${caso.mensaje}"`);

    for (const config of CONFIGS) {
      const corridas = [];
      for (let i = 0; i < REPETICIONES; i++) {
        try {
          corridas.push(await correrCaso(config, caso));
        } catch (error) {
          corridas.push({ fallos: [`ERROR: ${error instanceof Error ? error.message : error}`], ms: 0, trazas: [], texto: "" });
        }
      }

      const todasLimpias = corridas.every((c) => c.fallos.length === 0);
      const msPromedio = Math.round(corridas.reduce((s, c) => s + c.ms, 0) / corridas.length);
      resumen[config.nombre].latencias.push(...corridas.map((c) => c.ms));
      if (todasLimpias) resumen[config.nombre].estables++;

      console.log(`  [${config.nombre}] ${todasLimpias ? "PASS" : "FAIL"} (avg ${msPromedio}ms)`);
      if (!todasLimpias) {
        const fallosUnicos = [...new Set(corridas.flatMap((c) => c.fallos))];
        for (const f of fallosUnicos) console.log(`      ${f}`);
      }
      console.log(`      herramientas llamadas: ${corridas.map((c) => `[${c.trazas.join(",")}]`).join(" | ")}`);
    }
  }

  console.log("\n\n--- Resumen por configuración ---");
  for (const config of CONFIGS) {
    const r = resumen[config.nombre];
    const lat = [...r.latencias].sort((a, b) => a - b);
    const p50 = lat[Math.floor(lat.length * 0.5)] ?? NaN;
    const p95 = lat[Math.floor(lat.length * 0.95)] ?? NaN;
    console.log(`  ${config.nombre}: ${r.estables}/${CASOS.length} casos estables, latencia p50=${p50}ms p95=${p95}ms`);
  }

  console.log("\n--- Criterio de aceptación (del plan) ---");
  for (const config of CONFIGS.slice(1)) {
    const r = resumen[config.nombre];
    const cero_regresiones = r.estables === CASOS.length;
    console.log(
      `  [${cero_regresiones ? "PASS — activable" : "FAIL — NO activar"}] ${config.nombre}: ${r.estables}/${CASOS.length} estables`,
    );
  }

  const algunaConfigFalla = CONFIGS.slice(1).some((c) => resumen[c.nombre].estables < CASOS.length);
  process.exitCode = 0; // informativo: este script decide qué activar, no bloquea CI
  if (algunaConfigFalla) console.log("\nAl menos una configuración tuvo regresiones — ver detalle arriba antes de activar Fase 4.");
}

main().catch((error) => {
  console.error("[FAIL] eval-chat-thinking falló:", error);
  process.exitCode = 1;
});
