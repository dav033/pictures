import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { SupuestoTokensSchema, TablaPreciosSchema } from "./costo";
import { leerPrediccionesJsonl, lineaJsonl, type PrediccionEstructurasV1 } from "./prediccion";
import { resumirCorrida } from "./resumen-corrida";
import { claveCorrida, ejecutarCorrida, ItemSuiteSchema, planificarCorrida, type Analizador, type ConfiguracionRunner } from "./runner";

/**
 * Recognition runner CLI logic (Plan A §A0.3). Preview is the default: nothing
 * is sent to a provider unless `--ejecutar` and `--max-usd` are given. All I/O
 * is injected so the gates are testable without network or provider.
 */

export const SuiteSchema = z.object({
  suite_id: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
  taxonomy_version: z.string().min(1).max(60),
  items: z.array(ItemSuiteSchema).min(1).max(500),
}).strict();

export type OpcionesCli = {
  suite: string;
  runId: string;
  corridas: number;
  maxUsd: number | null;
  concurrencia: number;
  plazoMs: number;
  salida: string;
  crudos: string | null;
  raizImagenes: string;
  ejecutar: boolean;
  precios: string;
  supuesto: string;
};

export function leerArgumentos(argv: readonly string[]): OpcionesCli {
  const opciones: OpcionesCli = {
    suite: "", runId: "", corridas: 5, maxUsd: null, concurrencia: 2, plazoMs: 120_000, salida: "", crudos: null, raizImagenes: "",
    ejecutar: false, precios: "eval/estructuras/precios/2026-09-15.json", supuesto: "eval/estructuras/supuestos/tokens-analisis-2026-09-15.json",
  };
  const numeros = new Set(["--corridas", "--max-usd", "--concurrencia", "--plazo-ms"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--ejecutar") { opciones.ejecutar = true; continue; }
    if (arg === "--preview") { opciones.ejecutar = false; continue; }
    const valor = argv[i + 1];
    if (valor === undefined || valor.startsWith("--")) throw new Error(`${arg} necesita un valor`);
    i += 1;
    const numero = Number(valor);
    if (numeros.has(arg) && !Number.isFinite(numero)) throw new Error(`${arg} debe ser numérico`);
    switch (arg) {
      case "--suite": opciones.suite = valor; break;
      case "--run-id": opciones.runId = valor; break;
      case "--corridas": opciones.corridas = numero; break;
      case "--max-usd": opciones.maxUsd = numero; break;
      case "--concurrencia": opciones.concurrencia = numero; break;
      case "--plazo-ms": opciones.plazoMs = numero; break;
      case "--salida": opciones.salida = valor; break;
      case "--crudos": opciones.crudos = valor; break;
      case "--raiz-imagenes": opciones.raizImagenes = valor; break;
      case "--precios": opciones.precios = valor; break;
      case "--supuesto": opciones.supuesto = valor; break;
      default: throw new Error(`opción desconocida: ${arg}`);
    }
  }
  for (const [nombre, valor] of [["--suite", opciones.suite], ["--run-id", opciones.runId], ["--raiz-imagenes", opciones.raizImagenes]] as const) {
    if (!valor) throw new Error(`${nombre} es obligatorio`);
  }
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(opciones.runId)) throw new Error("--run-id inválido");
  if (!opciones.salida) opciones.salida = `eval/results/estructuras/${opciones.runId}`;
  if (opciones.ejecutar) {
    if (opciones.maxUsd === null) throw new Error("--ejecutar exige --max-usd");
    if (!opciones.crudos) throw new Error("--ejecutar exige --crudos (directorio privado fuera del repo)");
  }
  return opciones;
}

export function dentroDe(raiz: string, ruta: string): boolean {
  const rel = relative(resolve(raiz), resolve(ruta));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export type DependenciasCli = {
  repo: string;
  leerTexto: (ruta: string) => string | null;
  escribirTexto: (ruta: string, texto: string) => void;
  anexarTexto: (ruta: string, texto: string) => void;
  commit: () => string;
  ahora: () => Date;
  /** Must stop durable telemetry (ai_call_log) and drop DATABASE_URL: evaluation never writes to the production database. */
  desactivarTelemetriaDurable: () => void;
  crearAnalizador: (opciones: { raizImagenes: string; crudos: string }) => Promise<{ analizar: Analizador; modelo: string; thinkingLevel: string | null; systemPromptSha256: string; configHash: string; parserVersion: string }>;
  /** Values for preview, where no analyzer (and no provider client) is created. */
  sistemaSinProveedor: () => { modelo: string; thinkingLevel: string | null; systemPromptSha256: string; configHash: string; parserVersion: string };
  log: (mensaje: string) => void;
};

export async function ejecutarCli(argv: readonly string[], deps: DependenciasCli): Promise<{ modo: "preview" | "ejecucion"; runJsonRuta: string | null }> {
  const opciones = leerArgumentos(argv);
  if (opciones.crudos && dentroDe(deps.repo, opciones.crudos)) throw new Error("--crudos debe quedar fuera del repositorio: las salidas crudas no se versionan");
  if (dentroDe(deps.repo, opciones.raizImagenes)) throw new Error("--raiz-imagenes debe quedar fuera del repositorio: ninguna imagen entra al repo");

  const textoSuite = deps.leerTexto(opciones.suite);
  if (textoSuite === null) throw new Error(`no existe la suite ${opciones.suite}`);
  const suite = SuiteSchema.parse(JSON.parse(textoSuite));
  const leerJson = (ruta: string) => {
    const texto = deps.leerTexto(ruta);
    if (texto === null) throw new Error(`no existe ${ruta}`);
    return JSON.parse(texto) as unknown;
  };
  const tabla = TablaPreciosSchema.parse(leerJson(opciones.precios));
  const supuesto = SupuestoTokensSchema.parse(leerJson(opciones.supuesto));

  const rutaPredicciones = resolve(opciones.salida, "predicciones.jsonl");
  const previas: PrediccionEstructurasV1[] = leerPrediccionesJsonl(deps.leerTexto(rutaPredicciones) ?? "");
  if (previas.some((linea) => linea.run_id !== opciones.runId)) throw new Error(`${rutaPredicciones} pertenece a otra corrida`);

  if (opciones.ejecutar) deps.desactivarTelemetriaDurable();
  const sistemaBase = opciones.ejecutar
    ? await deps.crearAnalizador({ raizImagenes: opciones.raizImagenes, crudos: opciones.crudos! })
    : { ...deps.sistemaSinProveedor(), analizar: null };
  const config: ConfiguracionRunner = {
    runId: opciones.runId,
    corridasPorImagen: opciones.corridas,
    maxUsd: opciones.maxUsd ?? Number.POSITIVE_INFINITY,
    concurrencia: opciones.concurrencia,
    plazoPorAnalisisMs: opciones.plazoMs,
    intentosMaximosPorPase: 2,
    tabla,
    supuesto,
    instante: deps.ahora(),
    sistema: {
      id: "v13", modelo: sistemaBase.modelo, parser_version: sistemaBase.parserVersion, system_prompt_sha256: sistemaBase.systemPromptSha256,
      config_hash: sistemaBase.configHash, thinking_level: sistemaBase.thinkingLevel, taxonomy_version: suite.taxonomy_version, commit: deps.commit(),
    },
  };
  // Same system and same commit: a resumed run must stay one reproducible run.
  if (previas.some((linea) => JSON.stringify(linea.sistema) !== JSON.stringify(config.sistema))) {
    throw new Error("las predicciones previas son de otra configuración o commit del sistema: usa otro --run-id");
  }
  const yaHechas = new Set(previas.map((linea) => claveCorrida(linea.image_sha256, linea.corrida)));
  const plan = planificarCorrida({ ...config, maxUsd: opciones.maxUsd ?? 0 }, suite.items, yaHechas);
  const manifiestoSha256 = createHash("sha256").update(textoSuite).digest("hex");

  if (!opciones.ejecutar) {
    const vista = { ...plan, cabe_en_presupuesto: opciones.maxUsd === null ? null : plan.cabe_en_presupuesto, suite: { id: suite.suite_id, manifiesto_sha256: manifiestoSha256 }, sistema: config.sistema };
    deps.escribirTexto(resolve(opciones.salida, "preview.json"), `${JSON.stringify(vista, null, 2)}\n`);
    deps.log(`[preview] ${plan.analisis_pendientes} análisis pendientes · esperado US$${plan.estimacion.esperado_usd.toFixed(2)} · cota US$${plan.estimacion.cota_superior_usd.toFixed(2)} (estimado) · sin llamadas al proveedor`);
    return { modo: "preview", runJsonRuta: null };
  }
  if (!plan.cabe_en_presupuesto) {
    throw new Error(`la cota estimada US$${plan.estimacion.cota_superior_usd.toFixed(2)} supera --max-usd ${opciones.maxUsd}: no se ejecuta nada`);
  }
  const corrida = await ejecutarCorrida({
    config, items: suite.items, analizar: sistemaBase.analizar!, yaHechas,
    alEscribir: (linea) => deps.anexarTexto(rutaPredicciones, lineaJsonl(linea)),
  });
  const runJson = resumirCorrida({ corrida, generadoEn: deps.ahora(), suite: { id: suite.suite_id, manifiesto_sha256: manifiestoSha256 }, todasLasLineas: [...previas, ...corrida.lineas] });
  const runJsonRuta = resolve(opciones.salida, "run.json");
  deps.escribirTexto(runJsonRuta, `${JSON.stringify(runJson, null, 2)}\n`);
  deps.log(`[ejecución] ${corrida.lineas.length} líneas · reportado US$${corrida.costo_reportado_usd.toFixed(4)} · omitidas por presupuesto ${corrida.omitidas_por_presupuesto}`);
  return { modo: "ejecucion", runJsonRuta };
}
