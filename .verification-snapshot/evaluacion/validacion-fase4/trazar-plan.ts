/**
 * Rastreador de etapas posteriores al analisis (FUERA del repo).
 *
 * Etapa (a): blueprint -> plan. Ejecuta el turno REAL del chat Omoikane (`ejecutarConversacion`, el mismo codigo
 * que /api/chat) con el blueprint guardado de la linea base como `referenceBlueprint`, el prompt de sistema de
 * produccion (`construirSistema`), las herramientas reales (buscar_catalogo_rag, armar_estructura,
 * confirmar_plan_decoracion...) contra el catalogo real (servicio Python local) y el resolvedor Python real.
 * No llama a ningun modelo de imagen. Telemetria y escrituras a Postgres desactivadas (Node no tiene DATABASE_URL;
 * el pool es un sumidero que solo cuenta escrituras).
 *
 *   cd <repo> && npx tsx --env-file=.env.local --conditions=react-server <este archivo> \
 *     --casos 1,3,4,6,8 --corridas 3 --max-usd 4 [--preview]
 *
 * Guarda por caso/corrida en trazado/caso-N/corrida-K/: blueprint.json, traza-chat.json, plan-resuelto.json,
 * confirmar-args.json, resumen.json. Reanuda saltando corridas ya hechas.
 */
import { DATOS } from "../rutas";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = process.cwd();
const LB = `${DATOS}/linea-base`;
const argv0 = (n: string, d: string) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d; };
const FASE4 = `${DATOS}/validacion-fase4`;
const SALIDA = argv0("--salida", `${FASE4}/planes`);
const BPDIR = argv0("--bp-dir", `${FASE4}/blueprints`);
const imp = (rel: string) => import(pathToFileURL(resolve(REPO, rel)).href);

function arg(nombre: string, def: string): string {
  const i = process.argv.indexOf(nombre);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}

type Uso = { entrada: number; salida: number; pensamiento?: number; cacheados?: number };

async function main(): Promise<void> {
  // `--lecturas-reales`: las lecturas (SELECT/WITH) van a la base real; las escrituras siguen bloqueadas. Sin esto,
  // las consultas que el chat hace desde Node (`buscarGlobosPorColor`: `colores_en_catalogo`) devolvían siempre
  // vacío y el trazado no reproducía lo que ve producción (2026-10-05).
  type PoolLectura = { query: (sql: string, params?: unknown[]) => Promise<unknown>; end: () => Promise<void> };
  let real: PoolLectura | null = null;
  if (process.argv.includes("--lecturas-reales")) {
    const { getRagPool } = await imp("src/lib/rag/db.ts") as { getRagPool: () => PoolLectura };
    real = getRagPool();
    (globalThis as { __ragPool?: unknown }).__ragPool = undefined;
  }
  delete process.env.DATABASE_URL;
  delete process.env.CATALOG_DATABASE_URL;
  const preview = process.argv.includes("--preview");
  const maxUsd = Number(arg("--max-usd", "4"));
  const casos = arg("--casos", "1,3,4,6,8").split(",").map((c) => Number(c));
  const corridas = Number(arg("--corridas", "3"));
  const variante = arg("--variante", "v18-candidato");
  const reservaPorCorrida = Number(arg("--reserva", "0.35"));

  // Pool sumidero: ninguna escritura llega a Postgres (rag_query_log, plan_audit_log...). Se cuentan.
  const bloqueadas: Record<string, number> = {};
  const lecturas: string[] = [];
  (globalThis as { __ragPool?: unknown }).__ragPool = {
    query: async (sql: string, params?: unknown[]) => {
      const verbo = String(sql).trim().split(/\s+/)[0]!.toUpperCase();
      if (["INSERT", "UPDATE", "DELETE"].includes(verbo)) {
        const tabla = /(?:INTO|UPDATE|FROM)\s+([a-z_\.]+)/i.exec(String(sql))?.[1] ?? "?";
        bloqueadas[`${verbo} ${tabla}`] = (bloqueadas[`${verbo} ${tabla}`] ?? 0) + 1;
      } else {
        lecturas.push(String(sql).slice(0, 80));
        if (real && (verbo === "SELECT" || verbo === "WITH") && !/\b(INSERT|UPDATE|DELETE)\b/i.test(String(sql))) return real.query(sql, params);
      }
      return { rows: [], rowCount: 0 };
    },
    on: () => undefined,
    end: async () => undefined,
  };

  // Depuración de hash: guarda la última petición al resolvedor Python de cada corrida (la de confirmar).
  const fetchOriginal = globalThis.fetch;
  let ultimaResolucion: string | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/127\.0\.0\.1:8000/.test(url) && /resol/i.test(url) && typeof init?.body === "string") ultimaResolucion = init.body;
    return fetchOriginal(input, init);
  }) as typeof fetch;
  await imp("src/lib/ia/nucleo/telemetria-llamadas.ts");
  const core = await import(pathToFileURL(resolve(REPO, "packages/agente-core/src/index.ts")).href) as { configurarPersistenciaTelemetria: (x: undefined) => void };
  core.configurarPersistenciaTelemetria(undefined);

  const { ejecutarConversacion } = await imp("src/lib/ia/omoikane/ejecutar.ts");
  const { construirSistema } = await imp("src/lib/ia/omoikane/prompt-sistema.ts");
  const { chatOmoikaneDe } = await imp("src/lib/ia/nucleo/registro.ts");
  const { RAG_ENABLED } = await imp("src/lib/ia/nucleo/feature-flags.ts");
  const { ReferenceBlueprintV2Schema } = await imp("src/lib/ia/referencia/reference-blueprint.ts");
  const { precioVigente, TablaPreciosSchema } = await imp("src/lib/eval/estructuras/costo.ts");
  const { parseNivelCreatividad } = await imp("src/lib/ia/escena/creatividad.ts");

  const tabla = TablaPreciosSchema.parse(JSON.parse(readFileSync(resolve(REPO, "eval/estructuras/precios/2026-09-15.json"), "utf8")));
  const modeloChat = process.env.GEMINI_CHAT_MODEL ?? "gemini-3.6-flash";
  const precio = precioVigente(tabla, modeloChat, new Date());
  const costo = (u: Uso) =>
    (Math.max(0, u.entrada - (u.cacheados ?? 0)) * precio.precio_entrada + (u.salida + (u.pensamiento ?? 0)) * precio.precio_salida + (u.cacheados ?? 0) * precio.precio_cacheado) / 1_000_000;

  const suite = JSON.parse(readFileSync(`${LB}/suite-linea-base.json`, "utf8")) as { items: Array<{ ruta_privada: string }> };
  const entorno = {
    modelo_chat: modeloChat, precio_version: tabla.version, rag_enabled: RAG_ENABLED, variante_blueprint: variante,
    database_url_definida_en_node: Boolean(process.env.DATABASE_URL), python_backend_url: process.env.PYTHON_BACKEND_URL ?? null,
    flags: Object.fromEntries(["ARMADO_ARCO_COLUMNA_V1", "LECTURA_UNICA_REFERENCIA_ENABLED", "PATRON_REFERENCIA_PYTHON_ENABLED", "MEASURED_COLOR_DOMINANCE_V1", "CHAT_PYTHON_ENABLED", "GEMINI_CHAT_THINKING_LEVEL"].map((k) => [k, process.env[k] ?? null])),
  };
  mkdirSync(SALIDA, { recursive: true });
  writeFileSync(`${SALIDA}/entorno-plan.json`, JSON.stringify(entorno, null, 2));
  if (preview) { console.log(JSON.stringify({ entorno, casos, corridas, maxUsd, reservaPorCorrida, precio }, null, 2)); return; }

  let gastado = Number(arg("--gasto-previo", "0"));
  const ledger: Array<Record<string, unknown>> = [];
  const ledgerPath = `${SALIDA}/costo-plan-ledger.json`;
  if (existsSync(ledgerPath)) { const prev = JSON.parse(readFileSync(ledgerPath, "utf8")) as { filas: Array<Record<string, unknown>> }; ledger.push(...prev.filas); gastado += ledger.reduce((s, f) => s + Number(f.usd_reportado ?? 0), 0); }

  for (const k of Array.from({ length: corridas }, (_, i) => i + 1)) {
    for (const c of casos) {
      const dir = `${SALIDA}/caso-${c}/corrida-${k}`;
      if (existsSync(`${dir}/resumen.json`)) continue;
      if (gastado + reservaPorCorrida > maxUsd) { console.log(`[omitida por tope] caso ${c} corrida ${k} (gastado ${gastado.toFixed(3)})`); continue; }
      mkdirSync(dir, { recursive: true });
      const blueprintEntrada = (JSON.parse(readFileSync(`${BPDIR}/case-00${c}-run-${k}.json`, "utf8")) as { blueprint: unknown }).blueprint;
      writeFileSync(`${dir}/blueprint.json`, JSON.stringify(blueprintEntrada, null, 1));
      const blueprint = ReferenceBlueprintV2Schema.parse(blueprintEntrada);

      const requestId = crypto.randomUUID();
      const chat = await chatOmoikaneDe("gemini", { requestId, correlationId: requestId });
      const usos: Uso[] = [];
      const rondas: Array<Record<string, unknown>> = [];
      let vistos = 0;
      const registrar = (p: { historial: Array<Record<string, unknown>> }, fin?: { texto: string; llamadas: unknown[]; uso: Uso; finishReason?: string }) => {
        if (!fin) {
          const nuevos = p.historial.slice(vistos);
          vistos = p.historial.length;
          rondas.push({ entrada_nuevos_mensajes: nuevos.map((m) => (m.rol === "herramienta" ? { rol: m.rol, nombre: m.nombre, resultado: m.resultado } : m.rol === "usuario" ? { rol: m.rol, texto: m.texto, imagenes: Array.isArray(m.imagenes) ? m.imagenes.length : 0 } : m)) });
        } else {
          usos.push(fin.uso);
          Object.assign(rondas[rondas.length - 1]!, { salida_texto: fin.texto, salida_llamadas: fin.llamadas, uso: fin.uso, finishReason: fin.finishReason ?? null });
        }
      };
      const envuelto = {
        ...chat,
        turno: async (p: never) => { registrar(p); const t = await chat.turno(p); registrar(p, t); return t; },
        async *turnoStream(p: never) { registrar(p); for await (const f of chat.turnoStream(p)) { if ((f as { tipo: string }).tipo === "fin") registrar(p, f as never); yield f; } },
      };

      // Fase 4: la captura SIN el texto de la app (linea-base/sin-etiquetas), la misma del análisis.
      const archivoImagen = argv0("--img-file", "") || `${argv0("--img-dir", `${LB}/sin-etiquetas`)}/case-00${c}-ref.png`;
      const extensionImagen = extname(archivoImagen).toLowerCase();
      const mimeImagen = extensionImagen === ".jpg" || extensionImagen === ".jpeg" ? "image/jpeg" : extensionImagen === ".webp" ? "image/webp" : "image/png";
      const imagenBytes = readFileSync(archivoImagen).toString("base64");
      const brief = {};
      const sistema = construirSistema({ ragEnabled: RAG_ENABLED, brief, referenceBlueprint: blueprint, creatividad: parseNivelCreatividad(undefined) });
      writeFileSync(`${dir}/sistema-chat.txt`, sistema);
      const historial = [{ rol: "usuario" as const, texto: "Adjunto imágenes de referencia del estilo que busco.", imagenes: [{ id: "ESTILO_01", mime: mimeImagen, base64: imagenBytes, descripcion: "Referencia visual de decoración del cliente." }] }];
      const llamadasTool: Array<{ nombre: string; args: Record<string, unknown> }> = [];
      const t0 = Date.now();
      let error: string | null = null;
      let resultado: Record<string, unknown> | null = null;
      try {
        resultado = await ejecutarConversacion({
          chat: envuelto, sistema, historial, brief, referenceBlueprint: blueprint,
          signal: AbortSignal.timeout(170_000),
          onLlamada: (nombre: string, args: Record<string, unknown>) => llamadasTool.push({ nombre, args }),
          telemetria: { flujo: "evaluacion", requestId, correlationId: requestId, superficie: "script:trazado" },
          hechosPeticion: { tieneImagenesReferencia: true },
        });
      } catch (e) { error = e instanceof Error ? `${e.name}: ${e.message}` : String(e); }
      const usd = usos.reduce((s, u) => s + costo(u), 0);
      gastado += usd;
      const confirmar = [...llamadasTool].reverse().find((l) => l.nombre === "confirmar_plan_decoracion");
      writeFileSync(`${dir}/traza-chat.json`, JSON.stringify({ rondas, llamadasTool: llamadasTool.map((l) => ({ nombre: l.nombre, args: l.args })), texto_final: resultado?.texto ?? null }, null, 1));
      if (resultado?.plan) writeFileSync(`${dir}/plan-resuelto.json`, JSON.stringify(resultado.plan, null, 1));
      if (confirmar) writeFileSync(`${dir}/confirmar-args.json`, JSON.stringify(confirmar.args, null, 1));
      if (ultimaResolucion) writeFileSync(`${dir}/peticion-confirmar.json`, ultimaResolucion);
      const fila = { caso: c, corrida: k, ms: Date.now() - t0, rondas: rondas.length, herramientas: llamadasTool.map((l) => l.nombre), hay_plan: Boolean(resultado?.plan), usd_reportado: usd, tokens: usos.reduce((a, u) => ({ entrada: a.entrada + u.entrada, salida: a.salida + u.salida, pensamiento: a.pensamiento + (u.pensamiento ?? 0) }), { entrada: 0, salida: 0, pensamiento: 0 }), error };
      writeFileSync(`${dir}/resumen.json`, JSON.stringify(fila, null, 1));
      ledger.push(fila);
      writeFileSync(ledgerPath, JSON.stringify({ tope_declarado_usd: maxUsd, gastado_usd_tokens_reportados: gastado, escrituras_bloqueadas: bloqueadas, filas: ledger }, null, 1));
      console.log(`[caso ${c} #${k}] ${error ? "ERROR " + error.slice(0, 200) : "ok"} rondas=${rondas.length} tools=${fila.herramientas.join(",")} plan=${fila.hay_plan} US$${usd.toFixed(4)} acumulado US$${gastado.toFixed(4)} ${fila.ms}ms`);
    }
  }
  console.log(`[fin] gastado US$${gastado.toFixed(4)} (tokens reportados x tabla; no es factura). escrituras bloqueadas: ${JSON.stringify(bloqueadas)}${real ? " · lecturas reales" : ""}`);
  await real?.end();
}

main().catch((e) => { console.error(`[trazar-plan] ${e instanceof Error ? e.stack : String(e)}`); process.exitCode = 1; });
