import fs from "node:fs";
import path from "node:path";
import { leerEnv } from "./exp-fal-lib";

function arg(nombre: string): string | undefined {
  const indice = process.argv.indexOf(`--${nombre}`);
  return indice >= 0 ? process.argv[indice + 1] : undefined;
}

/**
 * Lanza el reentrenamiento del LoRA Sempertex sobre el dataset recaptionado.
 *
 * Por qué TRES corridas y no una: el trainer de fal expone solo cinco parámetros
 * (`image_data_url`, `steps`, `learning_rate`, `default_caption`,
 * `output_lora_format`) y **no entrega checkpoints intermedios**. La única forma
 * de encontrar el punto anterior al sobreentrenamiento es entrenar por separado
 * a distintos `steps` y evaluar cada resultado. El v2 se entrenó a 4000 pasos de
 * una sola vez, sin evaluación, y por eso llegó roto a producción.
 *
 * `learning_rate` se deja en el default de fal (5e-5) en las tres: se mueve un
 * solo eje por vez. El v2 usaba 2e-4.
 *
 *   npx tsx scripts/entrenar-lora-v004.ts --dry-run     # no gasta nada
 *   NODE_OPTIONS=--use-system-ca npx tsx scripts/entrenar-lora-v004.ts --confirmar
 *
 * Sin `--confirmar` no envía nada: entrenar cuesta dinero real.
 */

const CONFIG = path.join(process.cwd(), arg("config") ?? "data/staging/recaption-v004/entrenamiento.config.json");
const INICIAR_SUBIDA = "https://rest.alpha.fal.ai/storage/upload/initiate";
const BALANCE = "https://rest.alpha.fal.ai/billing/user_balance";
const SALIDA = path.join(process.cwd(), "reports/lora-debug/entrenamiento-v004.json");

type Corrida = { id: string; steps: number; learning_rate: number };
type Config = {
  dataset: { zip: string; imagenes: number; trigger: string };
  trainer: { endpoint: string; output_lora_format: string };
  corridas: Corrida[];
  evaluacion: { escalas_a_probar: number[]; costo_estimado_usd_por_corrida_y_escala: number };
  criterio_de_aceptacion: { composicion_minima: string };
};

/**
 * La configuración vive en JSON, no acá: los parámetros del entrenamiento son
 * la decisión revisable, y enterrarlos en el código es lo que hizo que nadie
 * pudiera auditar por qué el v2 salió con 4000 pasos.
 */
function cargarConfig(): Config {
  if (!fs.existsSync(CONFIG)) throw new Error(`Falta la configuración: ${CONFIG}`);
  const config = JSON.parse(fs.readFileSync(CONFIG, "utf8")) as Config;
  const problemas: string[] = [];
  if (!config.corridas?.length) problemas.push("no hay corridas definidas");
  for (const corrida of config.corridas ?? []) {
    if (!Number.isInteger(corrida.steps) || corrida.steps <= 0) problemas.push(`${corrida.id}: steps inválido`);
    if (!(corrida.learning_rate > 0)) problemas.push(`${corrida.id}: learning_rate inválido`);
    // El v2 se rompió justamente por pasarse de estos valores; avisar, no bloquear.
    if (corrida.steps > 2000) problemas.push(`${corrida.id}: ${corrida.steps} pasos supera los 2000 donde fal documenta que un LoRA de estilo deja de seguir prompts`);
    if (corrida.learning_rate > 0.0001) problemas.push(`${corrida.id}: lr ${corrida.learning_rate} supera 1e-4`);
  }
  if (new Set(config.corridas.map((c) => c.id)).size !== config.corridas.length) problemas.push("hay ids repetidos");
  if (problemas.length) throw new Error(["Configuración inválida:", ...problemas.map((p) => `  - ${p}`)].join("\n"));
  return config;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function saldo(key: string): Promise<number | null> {
  try {
    const r = await fetch(BALANCE, { headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(20_000) });
    return r.ok ? Number(await r.text()) : null;
  } catch { return null; }
}

/** Sube el zip una sola vez; las tres corridas comparten la misma URL. */
async function subirZip(key: string, zip: string): Promise<string> {
  const bytes = fs.readFileSync(zip);
  const iniciar = await fetch(INICIAR_SUBIDA, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content_type: "application/zip", file_name: path.basename(zip) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!iniciar.ok) throw new Error(`No se pudo iniciar la subida (${iniciar.status})`);
  const { upload_url, file_url } = await iniciar.json() as { upload_url: string; file_url: string };

  const subida = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": "application/zip" },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(600_000),
  });
  if (!subida.ok) throw new Error(`Falló la subida del zip (${subida.status})`);
  return file_url;
}

async function entrenar(key: string, imageDataUrl: string, corrida: Corrida, config: Config) {
  const envio = await fetch(config.trainer.endpoint, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      image_data_url: imageDataUrl,
      steps: corrida.steps,
      learning_rate: corrida.learning_rate,
      output_lora_format: config.trainer.output_lora_format,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!envio.ok) throw new Error(`fal rechazó el entrenamiento (${envio.status}): ${(await envio.text()).slice(0, 300)}`);
  const cola = await envio.json() as { status_url?: string; response_url?: string; request_id?: string };
  if (!cola.status_url || !cola.response_url) throw new Error("fal no devolvió una solicitud de entrenamiento válida.");
  console.log(`  request_id ${cola.request_id}`);

  // El entrenamiento tarda; se sondea con paciencia y sin límite duro corto.
  const limite = Date.now() + 3 * 60 * 60 * 1000;
  while (Date.now() < limite) {
    const est = await fetch(cola.status_url, { headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(30_000) });
    if (est.ok) {
      const { status, error } = await est.json() as { status?: string; error?: string };
      if (status === "COMPLETED") break;
      if (status === "FAILED" || status === "CANCELLED") throw new Error(`entrenamiento ${status}: ${error ?? ""}`);
    }
    await sleep(30_000);
  }

  const res = await fetch(cola.response_url, { headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`fal no devolvió el resultado (${res.status})`);
  return await res.json() as Record<string, unknown>;
}

async function main(): Promise<void> {
  const config = cargarConfig();
  const zip = path.join(process.cwd(), config.dataset.zip);
  if (!fs.existsSync(zip)) throw new Error(`Falta ${zip}. Correr antes scripts/recaption-v004.ts y empaquetar.`);
  const key = leerEnv("FAL_KEY");
  if (!key) throw new Error("Falta FAL_KEY en .env.local");

  // Verifica que el zip tenga un .txt por imagen: un caption faltante haría que
  // fal use `default_caption` en silencio y contaminaría el entrenamiento.
  const mb = (fs.statSync(zip).size / 1024 / 1024).toFixed(1);
  console.log(`config  : ${path.relative(process.cwd(), CONFIG)}`);
  console.log(`dataset : ${config.dataset.zip} (${mb} MB, ${config.dataset.imagenes} imagenes, trigger ${config.dataset.trigger})`);
  console.log(`trainer : ${config.trainer.endpoint}`);
  for (const c of config.corridas) console.log(`corrida : ${c.id.padEnd(12)} ${String(c.steps).padStart(5)} pasos @ lr ${c.learning_rate}`);
  console.log(`criterio: ${config.criterio_de_aceptacion.composicion_minima}`);
  const evals = config.corridas.length * config.evaluacion.escalas_a_probar.length;
  console.log(`evaluacion posterior: ${evals} paneles de 6 seeds ~ US$${(evals * config.evaluacion.costo_estimado_usd_por_corrida_y_escala).toFixed(2)}`);

  if (!process.argv.includes("--confirmar")) {
    console.log("\n[DRY-RUN] No se envió nada. Volver a correr con --confirmar para entrenar de verdad.");
    return;
  }

  const antes = await saldo(key);
  console.log(`saldo antes: US$${antes ?? "?"}`);

  console.log("subiendo el dataset…");
  const imageDataUrl = await subirZip(key, zip);
  console.log(`  ${imageDataUrl}`);

  const registro: Array<Record<string, unknown>> = [];
  for (const corrida of config.corridas) {
    console.log(`\n→ ${corrida.id} (${corrida.steps} pasos)…`);
    try {
      const salida = await entrenar(key, imageDataUrl, corrida, config);
      const url = (salida.diffusers_lora_file as { url?: string } | undefined)?.url
        ?? (salida.lora_file as { url?: string } | undefined)?.url;
      console.log(`  LISTO · ${url ?? JSON.stringify(salida).slice(0, 200)}`);
      registro.push({ ...corrida, ok: true, lora_url: url, salida });
    } catch (error) {
      console.log(`  FALLÓ: ${String(error).slice(0, 250)}`);
      registro.push({ ...corrida, ok: false, error: String(error) });
    }
  }

  const despues = await saldo(key);
  const gasto = antes !== null && despues !== null ? (antes - despues).toFixed(3) : "?";
  console.log(`\nsaldo después: US$${despues ?? "?"} · gasto real US$${gasto}`);

  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  fs.writeFileSync(SALIDA, JSON.stringify({ zip, imageDataUrl, corridas: registro, saldo_antes: antes, saldo_despues: despues }, null, 2));
  console.log(`registro en ${path.relative(process.cwd(), SALIDA)}`);
  console.log(`\nSiguiente: evaluar cada LoRA con
  SEMPERTEX_LORA_URL=<url> NODE_OPTIONS=--use-system-ca npx tsx scripts/exp-step2-panel-seeds.ts
y comparar contra el criterio: >=5/6 a escala 0,8.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
