/**
 * Auxiliar de la linea base (FUERA del repo). Llama a la funcion real de analisis de produccion
 * (`analizarReferenciasV2`, modo perceptual, como /api/references/analyze) y guarda el blueprint completo
 * crudo por corrida, mas los argumentos crudos de la herramienta, el uso reportado por el proveedor y el
 * coste (tokens reportados x tabla de precios fechada). Aplica despues los pasos locales deterministas de la ruta
 * (medicion de color Sempertex, referencias medidas, unificacion de piezas espejo), SIN la validacion en Python.
 *
 *   cd <repo> && npx tsx --env-file=.env.local --conditions=react-server <este archivo> \
 *     --max-usd 6 --plan v17-lectura-unica:5,v16:3 [--preview]
 *
 * Telemetria: no existe una variable de entorno que la apague; se apaga quitando DATABASE_URL antes de importar nada
 * y llamando configurarPersistenciaTelemetria(undefined) (igual que scripts/eval/estructuras/reconocimiento.ts).
 * Reanuda: salta las corridas cuyo archivo ya existe en resultados/crudos.
 */
import { DATOS } from "../rutas";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = process.cwd();
const LB = `${DATOS}/linea-base`;
const SALIDA = process.argv.includes("--salida") ? `${LB}/${process.argv[process.argv.indexOf("--salida") + 1]}` : `${LB}/resultados/crudos`;
const imp = (rel: string) => import(pathToFileURL(resolve(REPO, rel)).href);

function arg(nombre: string, def: string): string {
  const i = process.argv.indexOf(nombre);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}

async function main(): Promise<void> {
  // 1. Telemetria y base de datos fuera ANTES de importar nada de la aplicacion.
  delete process.env.DATABASE_URL;
  delete process.env.CATALOG_DATABASE_URL;
  const preview = process.argv.includes("--preview");
  const maxUsd = Number(arg("--max-usd", "6"));
  const plan = arg("--plan", "v17-lectura-unica:5,v16:3").split(",").map((p) => { const [v, n] = p.split(":"); return { variante: v!, corridas: Number(n) }; });
  const concurrencia = Number(arg("--concurrencia", "3"));

  await imp("src/lib/ia/nucleo/telemetria-llamadas.ts");
  const core = await import(pathToFileURL(resolve(REPO, "packages/agente-core/src/index.ts")).href).catch(() => null);
  if (core?.configurarPersistenciaTelemetria) core.configurarPersistenciaTelemetria(undefined);
  else (await import("@sempertex/agente-core") as { configurarPersistenciaTelemetria: (x: undefined) => void }).configurarPersistenciaTelemetria(undefined);

  const { analizarReferenciasV2, sistemaAnalisis, analysisConfigHash, ANALYSIS_PARSER_VERSION } = await imp("src/lib/ia/amaterasu/analizar-referencias-v2.ts");
  const { chatDe } = await imp("src/lib/ia/nucleo/registro.ts");
  const { precioVigente, TablaPreciosSchema } = await imp("src/lib/eval/estructuras/costo.ts");
  const { medirColoresSempertex } = await imp("src/lib/ia/amaterasu/color-sempertex.ts");
  const { conReferenciasMedidas } = await imp("src/lib/plan/referencias-medidas.ts");
  const { unificarPiezasEspejo } = await imp("src/lib/ia/referencia/piezas-espejo.ts");
  const { featureEnabled } = await imp("src/lib/ia/nucleo/feature-flags.ts");

  const chat = await chatDe("gemini");
  const tabla = TablaPreciosSchema.parse(JSON.parse(readFileSync(resolve(REPO, "eval/estructuras/precios/2026-09-15.json"), "utf8")));
  const precio = precioVigente(tabla, chat.modelo, new Date());
  const costo = (u: { entrada: number; salida: number; pensamiento?: number; cacheados?: number }) =>
    (Math.max(0, u.entrada - (u.cacheados ?? 0)) * precio.precio_entrada + (u.salida + (u.pensamiento ?? 0)) * precio.precio_salida + (u.cacheados ?? 0) * precio.precio_cacheado) / 1_000_000;

  const suite = JSON.parse(readFileSync(`${LB}/${arg("--suite", "suite-linea-base.json")}`, "utf8")) as { items: Array<{ image_sha256: string; ruta_privada: string; caso_n?: number }> };
  const filtroCasos = arg("--casos", "").split(",").filter(Boolean).map((n) => `case-00${n}`);
  const casos = suite.items.map((it, i) => ({ caso: `case-00${it.caso_n ?? i + 1}`, ...it })).filter((c) => filtroCasos.length === 0 || filtroCasos.includes(c.caso));

  const entorno = {
    modelo: chat.modelo, thinking_level: chat.thinkingLevel ?? null, parser_version: ANALYSIS_PARSER_VERSION, precio_version: tabla.version,
    flags: { MEASURED_COLOR_DOMINANCE_V1: featureEnabled("MEASURED_COLOR_DOMINANCE_V1"), ANALISIS_COLOR_SEMPERTEX_V1: featureEnabled("ANALISIS_COLOR_SEMPERTEX_V1") },
    database_url_definida: Boolean(process.env.DATABASE_URL),
    variantes: plan.map((p) => ({ variante: p.variante, system_prompt_sha256: sistemaAnalisis([], "perceptual", p.variante).systemPromptHash, config_hash: analysisConfigHash({ model: chat.modelo, thinkingLevel: chat.thinkingLevel, mode: "perceptual", systemPromptHash: sistemaAnalisis([], "perceptual", p.variante).systemPromptHash, variante: p.variante }) })),
  };
  mkdirSync(SALIDA, { recursive: true });
  // El entorno de la linea base no se pisa: cada plan de variantes escribe el suyo.
  writeFileSync(`${LB}/resultados/entorno-${plan.map((p) => p.variante).join("+")}.json`, JSON.stringify(entorno, null, 2));
  if (preview) { console.log(JSON.stringify(entorno, null, 2)); return; }

  // 2. Tareas: (variante, caso). Las repeticiones de una foto son secuenciales (el analisis comparte llamadas en vuelo).
  const tareas = plan.flatMap((p) => casos.map((c) => ({ ...p, ...c })));
  // Cota por llamada: tope de salida de la variante (14000 en v17, 6000 en v16) + entrada tipica, x2 reintentos de formato.
  const cotaLlamada = (v: string) => ((v === "v17-lectura-unica" || v === "v18-candidato" || v === "v19-candidato" || v === "v19b-candidato" ? 14000 : 6000) * precio.precio_salida + 4000 * precio.precio_entrada) / 1_000_000;
  let gastado = 0, reservado = 0, omitidas = 0, hechas = 0;
  const ledger: Array<Record<string, unknown>> = [];

  const trabajar = async (t: (typeof tareas)[number]) => {
    const bytes = readFileSync(resolve(LB, t.ruta_privada));
    if (createHash("sha256").update(bytes).digest("hex") !== t.image_sha256) throw new Error(`sha256 distinto en ${t.caso}`);
    const base64 = bytes.toString("base64");
    // OBJETO NUEVO POR CORRIDA: el adaptador de Gemini recuerda (WeakSet por instancia de chat) las imagenes ya enviadas y
    // omite sus bytes en la siguiente llamada. Reusar el mismo objeto hacia que las corridas 2+ llegaran SIN imagen.
    const nuevaImagen = () => ({ id: "REF_01", mime: "image/png" as const, base64: `${base64}`, descripcion: "Evaluation reference image." });
    for (let k = 1; k <= t.corridas; k += 1) {
      const archivo = `${SALIDA}/${t.variante}/${t.caso}/run-${k}.json`;
      if (existsSync(archivo)) continue;
      const reserva = cotaLlamada(t.variante) * 2;
      if (gastado + reservado + reserva > maxUsd) { omitidas += 1; console.log(`[omitida por tope] ${t.variante} ${t.caso} #${k}`); continue; }
      reservado += reserva;
      const pases: Array<Record<string, unknown>> = [];
      const usos: Array<{ entrada: number; salida: number; pensamiento?: number; cacheados?: number }> = [];
      const inicio = Date.now();
      let resultado: Record<string, unknown> = {};
      let error: string | null = null;
      try {
        const signal = AbortSignal.timeout(170_000);
        const imagen = nuevaImagen();
        const r = await analizarReferenciasV2(chat, [imagen], [], "perceptual", { superficie: "evaluacion/linea-base" }, signal, {
          forzarNuevoAnalisis: true, variante: t.variante,
          observarPase: (pase: { intento: number; ms: number; uso: { entrada: number; salida: number; pensamiento?: number; cacheados?: number }; finishReason?: string; args: unknown }) => {
            usos.push(pase.uso);
            pases.push({ intento: pase.intento, ms: pase.ms, uso: pase.uso, finishReason: pase.finishReason ?? null, args: pase.args });
          },
        });
        let analisisColor: unknown = null, post: unknown = null, errorPost: string | null = null;
        try {
          if (featureEnabled("ANALISIS_COLOR_SEMPERTEX_V1")) analisisColor = await medirColoresSempertex(r.blueprint, [nuevaImagen()]);
          post = unificarPiezasEspejo(conReferenciasMedidas(r.blueprint, analisisColor as never));
        } catch (e) { errorPost = e instanceof Error ? e.message : String(e); }
        resultado = { blueprint: r.blueprint, lecturasCrudas: r.lecturasCrudas ?? null, metadata: r.metadata, analisisColor, blueprint_post: post, error_post: errorPost };
      } catch (e) { error = e instanceof Error ? `${e.name}: ${e.message}` : String(e); }
      const usd = usos.reduce((s, u) => s + costo(u), 0);
      reservado -= reserva; gastado += usd; hechas += 1;
      const fila = { variante: t.variante, caso: t.caso, corrida: k, ms: Date.now() - inicio, llamadas: pases.length, usd_reportado: usd, error };
      ledger.push(fila);
      mkdirSync(`${SALIDA}/${t.variante}/${t.caso}`, { recursive: true });
      writeFileSync(archivo, JSON.stringify({ meta: { ...fila, image_sha256: t.image_sha256, entorno }, pases, ...resultado }, null, 1));
      console.log(`[${hechas}] ${t.variante} ${t.caso} #${k} ${error ? "ERROR " + error.slice(0, 120) : "ok"} ${fila.ms}ms US$${usd.toFixed(4)} acumulado US$${gastado.toFixed(4)}`);
    }
  };
  const cola = [...tareas];
  await Promise.all(Array.from({ length: Math.min(concurrencia, cola.length) }, async () => { for (let t = cola.shift(); t; t = cola.shift()) await trabajar(t); }));
  const resumen = { tope_declarado_usd: maxUsd, gastado_usd_a_partir_de_tokens_reportados: gastado, omitidas_por_tope: omitidas, llamadas_de_analisis: hechas, ledger };
  writeFileSync(`${LB}/resultados/costo-corrida-${Date.now()}.json`, JSON.stringify(resumen, null, 1));
  console.log(`[fin] analisis=${hechas} omitidas=${omitidas} gasto US$${gastado.toFixed(4)} (tokens reportados x precio de tabla; no es factura)`);
}

main().catch((e) => { console.error(`[linea-base] ${e instanceof Error ? e.message : String(e)}`); process.exitCode = 1; });
