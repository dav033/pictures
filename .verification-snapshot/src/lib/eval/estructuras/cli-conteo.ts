import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { dentroDe, SuiteSchema } from "./cli-reconocimiento";
import {
  ejecutarConteo,
  leerPrediccionesConteo,
  leerVerdadConteo,
  lineaConteoJsonl,
  planificarConteo,
  resumirConteo,
  SupuestoConteoSchema,
  type AnalizadorConteo,
  type ConfiguracionConteo,
  type PrediccionConteoV1,
} from "./conteo";
import { precioVigente, TablaPreciosSchema } from "./costo";
import { claveCorrida } from "./runner";

/**
 * CLI del runner de conteo (ADR-0031, E2). Vista previa por defecto: nada va a
 * un proveedor sin `--ejecutar`, `--max-usd` y `--crudos` fuera del repositorio.
 * La verdad humana (`--verdad`) también vive fuera del repositorio. Toda la E/S
 * se inyecta para probar las compuertas sin red ni proveedor.
 */

export type OpcionesCliConteo = {
  suite: string;
  runId: string;
  raizImagenes: string;
  verdad: string | null;
  corridas: number;
  maxUsd: number | null;
  concurrencia: number;
  plazoMs: number;
  salida: string;
  crudos: string | null;
  ejecutar: boolean;
  precios: string;
  supuesto: string;
};

export function leerArgumentosConteo(argv: readonly string[]): OpcionesCliConteo {
  const opciones: OpcionesCliConteo = {
    suite: "", runId: "", raizImagenes: "", verdad: null, corridas: 1, maxUsd: null, concurrencia: 2, plazoMs: 120_000, salida: "", crudos: null,
    ejecutar: false, precios: "eval/estructuras/precios/2026-09-15.json", supuesto: "eval/estructuras/supuestos/tokens-conteo-2026-09-28.json",
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
      case "--raiz-imagenes": opciones.raizImagenes = valor; break;
      case "--verdad": opciones.verdad = valor; break;
      case "--corridas": opciones.corridas = numero; break;
      case "--max-usd": opciones.maxUsd = numero; break;
      case "--concurrencia": opciones.concurrencia = numero; break;
      case "--plazo-ms": opciones.plazoMs = numero; break;
      case "--salida": opciones.salida = valor; break;
      case "--crudos": opciones.crudos = valor; break;
      case "--precios": opciones.precios = valor; break;
      case "--supuesto": opciones.supuesto = valor; break;
      default: throw new Error(`opción desconocida: ${arg}`);
    }
  }
  for (const [nombre, valor] of [["--suite", opciones.suite], ["--run-id", opciones.runId], ["--raiz-imagenes", opciones.raizImagenes]] as const) {
    if (!valor) throw new Error(`${nombre} es obligatorio`);
  }
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(opciones.runId)) throw new Error("--run-id inválido");
  if (!opciones.salida) opciones.salida = `eval/results/conteo/${opciones.runId}`;
  if (opciones.ejecutar) {
    if (opciones.maxUsd === null) throw new Error("--ejecutar exige --max-usd");
    if (!opciones.crudos) throw new Error("--ejecutar exige --crudos (directorio privado fuera del repo)");
  }
  return opciones;
}

export type SistemaConteo = { modelo: string; promptVersion: string };

export type DependenciasCliConteo = {
  repo: string;
  leerTexto: (ruta: string) => string | null;
  escribirTexto: (ruta: string, texto: string) => void;
  anexarTexto: (ruta: string, texto: string) => void;
  commit: () => string;
  ahora: () => Date;
  /** Apaga la telemetría durable (ai_call_log) y quita DATABASE_URL: una evaluación no escribe en la base de producción. */
  desactivarTelemetriaDurable: () => void;
  /** `comprobar` corre antes del primer análisis pagado: si el ai-api no sirve, lanza `FalloSistematicoConteo` sin gastar. */
  crearAnalizador: (opciones: { raizImagenes: string; crudos: string }) => Promise<SistemaConteo & { analizar: AnalizadorConteo; comprobar: () => Promise<void> }>;
  /** Para la vista previa, donde no se crea ningún analizador (ni cliente de proveedor). */
  sistemaSinProveedor: () => SistemaConteo;
  log: (mensaje: string) => void;
};

export async function ejecutarCliConteo(argv: readonly string[], deps: DependenciasCliConteo): Promise<{ modo: "preview" | "ejecucion"; runJsonRuta: string | null }> {
  const opciones = leerArgumentosConteo(argv);
  if (opciones.crudos && dentroDe(deps.repo, opciones.crudos)) throw new Error("--crudos debe quedar fuera del repositorio: las salidas crudas no se versionan");
  if (dentroDe(deps.repo, opciones.raizImagenes)) throw new Error("--raiz-imagenes debe quedar fuera del repositorio: ninguna imagen entra al repo");
  if (opciones.verdad && dentroDe(deps.repo, opciones.verdad)) throw new Error("--verdad debe quedar fuera del repositorio: el conteo humano es un dato de evaluación privado");

  const leer = (ruta: string) => {
    const texto = deps.leerTexto(ruta);
    if (texto === null) throw new Error(`no existe ${ruta}`);
    return texto;
  };
  const textoSuite = leer(opciones.suite);
  const suite = SuiteSchema.parse(JSON.parse(textoSuite));
  const tabla = TablaPreciosSchema.parse(JSON.parse(leer(opciones.precios)));
  const supuesto = SupuestoConteoSchema.parse(JSON.parse(leer(opciones.supuesto)));
  const verdad = opciones.verdad ? leerVerdadConteo(leer(opciones.verdad)) : null;

  const rutaPredicciones = resolve(opciones.salida, "predicciones.jsonl");
  const previas: PrediccionConteoV1[] = leerPrediccionesConteo(deps.leerTexto(rutaPredicciones) ?? "");
  if (previas.some((linea) => linea.run_id !== opciones.runId)) throw new Error(`${rutaPredicciones} pertenece a otra corrida`);

  if (opciones.ejecutar) deps.desactivarTelemetriaDurable();
  const sistemaBase = opciones.ejecutar
    ? await deps.crearAnalizador({ raizImagenes: opciones.raizImagenes, crudos: opciones.crudos! })
    : { ...deps.sistemaSinProveedor(), analizar: null, comprobar: null };
  const config: ConfiguracionConteo = {
    runId: opciones.runId,
    corridasPorImagen: opciones.corridas,
    maxUsd: opciones.maxUsd ?? Number.POSITIVE_INFINITY,
    concurrencia: opciones.concurrencia,
    plazoPorAnalisisMs: opciones.plazoMs,
    tabla,
    supuesto,
    instante: deps.ahora(),
    sistema: { modelo: sistemaBase.modelo, prompt_version: sistemaBase.promptVersion, commit: deps.commit() },
  };
  if (previas.some((linea) => JSON.stringify(linea.sistema) !== JSON.stringify(config.sistema))) {
    throw new Error("las predicciones previas son de otra configuración o commit del sistema: usa otro --run-id");
  }
  const yaHechas = new Set(previas.map((linea) => claveCorrida(linea.image_sha256, linea.corrida)));
  const plan = planificarConteo({ ...config, maxUsd: opciones.maxUsd ?? 0 }, suite.items, yaHechas);
  const manifiestoSha256 = createHash("sha256").update(textoSuite).digest("hex");
  const cobertura = verdad
    ? { fotos_con_verdad: suite.items.filter((item) => verdad.has(item.image_sha256)).length, verdad_fuera_de_la_suite: [...verdad.keys()].filter((hash) => !suite.items.some((item) => item.image_sha256 === hash)).length }
    : null;

  if (!opciones.ejecutar) {
    const vista = { ...plan, cabe_en_presupuesto: opciones.maxUsd === null ? null : plan.cabe_en_presupuesto, suite: { id: suite.suite_id, manifiesto_sha256: manifiestoSha256 }, sistema: config.sistema, verdad: cobertura };
    deps.escribirTexto(resolve(opciones.salida, "preview.json"), `${JSON.stringify(vista, null, 2)}\n`);
    deps.log(`[preview] ${plan.analisis_pendientes} análisis pendientes · esperado US$${plan.estimacion.esperado_usd.toFixed(2)} · cota US$${plan.estimacion.cota_superior_usd.toFixed(2)} (estimado${supuesto.medido ? "" : ", tokens sin medir"}) · sin llamadas al proveedor`);
    return { modo: "preview", runJsonRuta: null };
  }
  if (!plan.cabe_en_presupuesto) {
    throw new Error(`la cota estimada US$${plan.estimacion.cota_superior_usd.toFixed(2)} supera --max-usd ${opciones.maxUsd}: no se ejecuta nada`);
  }
  await sistemaBase.comprobar!();
  const corrida = await ejecutarConteo({
    config, items: suite.items, analizar: sistemaBase.analizar!, yaHechas,
    alEscribir: (linea) => deps.anexarTexto(rutaPredicciones, lineaConteoJsonl(linea)),
  });
  const runJson = resumirConteo({
    corrida,
    // run.json describe la corrida entera, también tras reanudarla.
    planCompleto: planificarConteo({ ...config, maxUsd: opciones.maxUsd ?? 0 }, suite.items),
    todasLasLineas: [...previas, ...corrida.lineas],
    precio: precioVigente(tabla, config.sistema.modelo, config.instante),
    verdad,
    generadoEn: deps.ahora(),
    suite: { id: suite.suite_id, manifiesto_sha256: manifiestoSha256 },
  });
  const runJsonRuta = resolve(opciones.salida, "run.json");
  deps.escribirTexto(runJsonRuta, `${JSON.stringify(runJson, null, 2)}\n`);
  deps.log(`[ejecución] ${corrida.lineas.length} líneas · reportado US${corrida.costo_reportado_usd.toFixed(4)} · omitidas por presupuesto ${corrida.omitidas_por_presupuesto}`);
  if (corrida.detenida_por !== null) {
    deps.log(`[conteo] fatal: ${corrida.detenida_por}`);
    throw new Error(`corrida detenida por un fallo sistemático (${corrida.detenida_por}); run.json escrito. Corrige el ai-api y reanuda con el mismo --run-id`);
  }
  return { modo: "ejecucion", runJsonRuta };
}
