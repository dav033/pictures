import fs from "node:fs";
import path from "node:path";

/**
 * Runner compartido de los experimentos contra fal.ai del
 * HANDOFF-LORA-COMPOSICION.md.
 *
 * Dos invariantes que hacen que los resultados sean comparables entre tandas:
 *
 * 1. SIEMPRE se usa el endpoint `fal-ai/flux-2/lora`, incluso para las celdas
 *    sin LoRA (`loras: []`). `loras` es opcional en el schema publicado, así el
 *    endpoint deja de ser una variable de confusión: mismo scheduler, mismos
 *    defaults, la única diferencia es el LoRA.
 * 2. Cada tanda escribe un manifiesto con el PAYLOAD LITERAL de cada celda y el
 *    gasto real medido contra el saldo de fal. Las sesiones anteriores no
 *    guardaron los prompts y eso invalidó sus conclusiones.
 *
 * En esta máquina hay un proxy que intercepta TLS y Node no confía en su CA:
 * todos los scripts que usen esto necesitan `NODE_OPTIONS=--use-system-ca`.
 */

export const ENDPOINT = "https://queue.fal.run/fal-ai/flux-2/lora";
export const BALANCE_URL = "https://rest.alpha.fal.ai/billing/user_balance";
export const TRIGGER = "eventdecor_style_v2";
export const DEFAULT_LORA = "https://v3b.fal.media/files/b/0aa80af5/Co4ylzKGOqhReEQpYIQl8_pytorch_lora_weights.safetensors";

/**
 * Identidad de un LoRA = tupla (artifact, corrida, dataset, trigger,
 * evaluación) — nunca una URL suelta (PLAN-CONTROL-ENTRENAMIENTOS-LORA-UI.md
 * §1, PLAN-COMPOSICION-RICA-V001.md §1.1/§5.7). Los tres experimentos
 * "halloween-jardin", "halloween-referencia" y "riqueza-composicion" mezclaron
 * la URL de v004 con el trigger de v007 precisamente porque `--lora <url>`
 * dejaba escribir la URL a mano sin verificar contra su trigger real.
 *
 * `--artifact-id` reemplaza eso para protocolos oficiales nuevos: resuelve
 * URL + trigger + dataset + evaluación desde esta tabla, citando su fuente.
 * `--lora <url>` sigue existiendo solo para los scripts históricos ya
 * congelados como evidencia (exp-step0..4) — no lo uses en experimentos
 * nuevos.
 */
export type LoraIdentidadConocida = {
  artifactId: string;
  runId: string;
  datasetId: string;
  url: string;
  trigger: string;
  evaluationStatus: "approved" | "rejected";
  fuente: string;
};

export const LORA_IDENTIDADES_CONOCIDAS: Record<string, LoraIdentidadConocida> = {
  "v004-1000": {
    artifactId: "v004-1000",
    runId: "lora-run-v004-1000",
    datasetId: "lora-dataset-v004-154",
    url: "https://v3b.fal.media/files/b/0aa82cf2/bv07AZ2sRktiGdQ42Tf_f_pytorch_lora_weights.safetensors",
    trigger: "eventdecor_style_v2",
    evaluationStatus: "approved",
    fuente: "data/lora-artifacts/runs/lora-run-v004-1000/receipt.json",
  },
  "v007-1000": {
    artifactId: "v007-1000",
    runId: "lora-run-v007-1000",
    datasetId: "lora-dataset-v007-ordenes",
    url: "https://v3b.fal.media/files/b/0aa8f88d/dACfQPmchrcACAaPlWyhN_pytorch_lora_weights.safetensors",
    trigger: "eventdecor_style_v3",
    evaluationStatus: "rejected",
    fuente: "data/lora-artifacts/runs/lora-run-v007-1000/receipt.json + reports/lora-debug/eval-v007-producto/manifiesto-eval-v007-producto.json",
  },
};

/** Resuelve `--artifact-id` contra la tabla anterior. Nunca acepta una URL libre. */
export function resolverIdentidadLora(artifactId: string): LoraIdentidadConocida {
  const identidad = LORA_IDENTIDADES_CONOCIDAS[artifactId];
  if (!identidad) {
    throw new Error(
      `--artifact-id "${artifactId}" no está en el registro conocido. Usa uno de: ${Object.keys(LORA_IDENTIDADES_CONOCIDAS).join(", ")}. ` +
      "No se acepta una URL o trigger sueltos: la identidad de un LoRA es una tupla artifact/corrida/dataset/trigger/evaluación.",
    );
  }
  if (identidad.evaluationStatus === "rejected") {
    console.warn(`⚠ ${artifactId} está RECHAZADO (evaluation_status=rejected). Úsalo solo para pruebas explícitas de regresión, nunca como validación de producción.`);
  }
  return identidad;
}

/**
 * Escena XV multi-estructura (arco central + 2 columnas + centro de mesa), el
 * caso que falla. Los dos prompts son salida LITERAL de
 * `scripts/proto-lora-caption-v3.ts`, sin retocar, para que las tandas se
 * puedan comparar entre sí.
 */

/** Compilador v2 en producción. Afinidad −6/100. En el paso 0 fue el que MEJOR compuso en base. */
export const PROMPT_V2 =
  "a grand organic balloon arch in pink and rose gold centered around the stage photo area, " +
  "two balloon columns, matching one another, one standing on the left and one on the right, " +
  "flanking the main arch, with a low coordinated balloon centerpiece placed on the main table " +
  "beneath the main arch. quinceañera celebration atmosphere, wide photorealistic event photograph, " +
  "natural depth, believable floor contact and supports.";

/** Prototipo v3 con la gramática del corpus. Afinidad 90/100. En el paso 0 compuso PEOR en base. */
export const PROMPT_V3 =
  "an balloon garland arch of large glossy chrome pink and metallic foil rose gold round balloons " +
  "in R-12 (12-inch) and R-5 (5-inch) sizes, framing a backdrop panel, flanked by two tall balloon " +
  "columns of glossy chrome pink and metallic foil rose gold round balloons, beside a party table " +
  "holding a low balloon centerpiece of small metallic foil rose gold round balloons, set against a " +
  "white wall and tiled floor under soft warm indoor lighting.";

/** `lora: null` = celda base sin LoRA. `lora: 0.8` = LoRA con esa escala. */
export type Celda = {
  id: string;
  prompt: string;
  lora: number | null;
  ancho?: number;
  alto?: number;
  guidance?: number;
  seed?: number;
  /** El safety checker de fal devuelve un PNG en negro ante falsos positivos. */
  safety?: boolean;
  /**
   * Fuerza la presencia del trigger con independencia del LoRA. Por defecto el
   * trigger acompaña al LoRA, que es como corre producción — pero eso deja el
   * brazo base sin trigger y confunde los pesos con la cadena del trigger.
   * Poner `trigger: true` en una celda sin LoRA aísla esa variable.
   */
  trigger?: boolean;
  nota?: string;
};

/**
 * Un PNG en negro del safety checker pesa ~40 KB contra los ~2,5 MB de una
 * escena real. Sin este guardián una celda censurada se cuela en el manifiesto
 * como `ok: true` y contamina la lectura del experimento.
 */
const BYTES_SOSPECHOSOS = 200_000;

export type Defaults = {
  seed: number;
  guidance: number;
  ancho: number;
  alto: number;
  loraUrl: string;
  trigger?: string;
};

export function flag(nombre: string, porDefecto: string): string {
  const i = process.argv.indexOf(`--${nombre}`);
  return (i >= 0 ? process.argv[i + 1] : undefined) ?? porDefecto;
}

export function leerEnv(clave: string): string | undefined {
  if (process.env[clave]) return process.env[clave];
  const archivo = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(archivo)) return undefined;
  const match = fs.readFileSync(archivo, "utf8").match(new RegExp(`^${clave}=(.*)$`, "m"));
  return match?.[1]?.trim().replace(/^"|"$/g, "");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function saldo(key: string): Promise<number | null> {
  try {
    const respuesta = await fetch(BALANCE_URL, {
      headers: { Authorization: `Key ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!respuesta.ok) return null;
    const valor = Number(await respuesta.text());
    return Number.isFinite(valor) ? valor : null;
  } catch {
    return null;
  }
}

/** Mismo payload que `sempertex-lora.ts`, con `loras` vaciable para la celda base. */
export function payloadDe(celda: Celda, defaults: Defaults) {
  return {
    prompt: (celda.trigger ?? celda.lora !== null) ? `${defaults.trigger ?? TRIGGER}, ${celda.prompt}` : celda.prompt,
    loras: celda.lora === null ? [] : [{ path: defaults.loraUrl, scale: celda.lora }],
    guidance_scale: celda.guidance ?? defaults.guidance,
    num_inference_steps: 28,
    image_size: { width: celda.ancho ?? defaults.ancho, height: celda.alto ?? defaults.alto },
    seed: celda.seed ?? defaults.seed,
    num_images: 1,
    enable_prompt_expansion: false,
    enable_safety_checker: celda.safety ?? true,
    output_format: "png",
  };
}

export async function generar(key: string, payload: object, endpoint: string = ENDPOINT): Promise<{ url: string; bytes: Buffer }> {
  const envio = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });
  if (!envio.ok) throw new Error(`fal rechazó el envío (${envio.status}): ${(await envio.text()).slice(0, 300)}`);

  const cola = (await envio.json()) as { status_url?: string; response_url?: string };
  if (!cola.status_url || !cola.response_url) throw new Error("fal no devolvió una solicitud en cola válida.");

  const limite = Date.now() + 180_000;
  let completado = false;
  while (Date.now() < limite) {
    const estado = await fetch(cola.status_url, {
      headers: { Authorization: `Key ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!estado.ok) throw new Error(`fal no pudo consultar el estado (${estado.status})`);
    const cuerpo = (await estado.json()) as { status?: string; error?: string };
    if (cuerpo.status === "COMPLETED") {
      completado = true;
      break;
    }
    if (cuerpo.status === "FAILED" || cuerpo.status === "CANCELLED") {
      throw new Error(`fal falló: ${cuerpo.error ?? cuerpo.status}`);
    }
    await sleep(2_000);
  }
  if (!completado) throw new Error("fal tardó demasiado en completar la generación.");

  const resultado = await fetch(cola.response_url, {
    headers: { Authorization: `Key ${key}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resultado.ok) throw new Error(`fal no devolvió resultado (${resultado.status})`);
  const cuerpo = (await resultado.json()) as { images?: Array<{ url?: string }> };
  const url = cuerpo.images?.[0]?.url;
  if (!url) throw new Error("fal no devolvió una imagen.");

  const imagen = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!imagen.ok) throw new Error(`no se pudo descargar la imagen (${imagen.status})`);
  return { url, bytes: Buffer.from(await imagen.arrayBuffer()) };
}

/**
 * Falla si `defaults.loraUrl` pertenece a una identidad conocida pero
 * `defaults.trigger` no es el suyo — exactamente el bug que produjo
 * "halloween-jardin", "halloween-referencia" y "riqueza-composicion"
 * (URL de v004 + trigger de v007). No falla ante una URL desconocida: los
 * scripts históricos congelados (exp-step0..4) usan checkpoints que no están
 * en `LORA_IDENTIDADES_CONOCIDAS` y siguen siendo evidencia válida.
 */
export function verificarIdentidadCoherente(defaults: Defaults): void {
  const conocida = Object.values(LORA_IDENTIDADES_CONOCIDAS).find((identidad) => identidad.url === defaults.loraUrl);
  if (conocida && defaults.trigger && defaults.trigger !== conocida.trigger) {
    throw new Error(
      `IDENTIDAD_LORA_CRUZADA: defaults.loraUrl pertenece a ${conocida.artifactId} (trigger entrenado "${conocida.trigger}", fuente: ${conocida.fuente}), pero defaults.trigger es "${defaults.trigger}". La URL y el trigger deben pertenecer a la misma corrida.`,
    );
  }
}

/**
 * Corre las celdas en serie, guarda un PNG por celda y un manifiesto con los
 * payloads literales.
 *
 * Guardarraíles antes de gastar un centavo:
 * - `--dry-run` imprime los payloads sin red y sin `FAL_KEY`.
 * - `verificarIdentidadCoherente` corre siempre, incluso en dry-run.
 * - Fuera de dry-run, se exige `--confirm-spend` y `--max-usd <número>`.
 * - Nunca corre con `CI=true`: un runner de integración no debe poder gastar.
 * - Si el gasto acumulado alcanza `--max-usd`, se detiene antes de la
 *   siguiente celda en vez de seguir encadenando llamadas.
 */
export async function correrExperimento(opciones: {
  nombre: string;
  celdas: Celda[];
  defaults: Defaults;
  outDir: string;
}): Promise<void> {
  const { nombre, defaults, outDir } = opciones;
  verificarIdentidadCoherente(defaults);

  // `--solo <subcadena>` repite una celda puntual sin volver a pagar la tanda entera.
  const solo = process.argv.indexOf("--solo") >= 0 ? process.argv[process.argv.indexOf("--solo") + 1] : undefined;
  const celdas = solo ? opciones.celdas.filter((celda) => celda.id.includes(solo)) : opciones.celdas;
  if (!celdas.length) throw new Error(`--solo ${solo} no coincide con ninguna celda.`);

  const manifiesto = {
    experimento: nombre,
    endpoint: ENDPOINT,
    defaults,
    celdas: celdas.map((celda) => ({ ...celda, payload: payloadDe(celda, defaults) })),
    resultados: [] as Array<Record<string, unknown>>,
    saldo_antes: null as number | null,
    saldo_despues: null as number | null,
    gasto_usd: null as number | null,
    detenido_por_limite: false,
  };

  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify(manifiesto.celdas, null, 2));
    console.log(`\n[DRY-RUN] ${celdas.length} celdas. No se envió nada a fal.ai. FAL_KEY no hace falta para esto.`);
    return;
  }

  if (process.env.CI === "true") {
    throw new Error("CI_SPEND_FORBIDDEN: este runner gasta dinero real en fal.ai y no puede ejecutarse con CI=true. Usa --dry-run.");
  }
  if (!process.argv.includes("--confirm-spend")) {
    throw new Error("CONFIRM_SPEND_REQUIRED: esta corrida gasta dinero real en fal.ai. Repite el comando con --confirm-spend (y --max-usd <tope>) para confirmar.");
  }
  const maxUsdRaw = flag("max-usd", "");
  const maxUsd = Number(maxUsdRaw);
  if (!maxUsdRaw || !Number.isFinite(maxUsd) || maxUsd <= 0) {
    throw new Error("MAX_USD_REQUIRED: pasa --max-usd <tope en dólares> mayor que 0 antes de gastar.");
  }

  const key = leerEnv("FAL_KEY");
  if (!key) throw new Error("Falta FAL_KEY en .env.local");

  fs.mkdirSync(outDir, { recursive: true });
  manifiesto.saldo_antes = await saldo(key);
  console.log(`${nombre}: ${celdas.length} celdas · saldo antes US$${manifiesto.saldo_antes ?? "?"} · tope US$${maxUsd}`);

  for (const celda of celdas) {
    process.stdout.write(`-> ${celda.id} ... `);
    try {
      const { url, bytes } = await generar(key, payloadDe(celda, defaults));
      const archivo = path.join(outDir, `${celda.id}.png`);
      fs.writeFileSync(archivo, bytes);
      const censurada = bytes.length < BYTES_SOSPECHOSOS;
      manifiesto.resultados.push({ celda: celda.id, ok: true, censurada, archivo, url_fal: url, bytes: bytes.length });
      console.log(
        censurada
          ? `SOSPECHOSA (${Math.round(bytes.length / 1024)} KB) — probable PNG en negro del safety checker; repetir con safety:false`
          : `ok (${Math.round(bytes.length / 1024)} KB)`,
      );
    } catch (error) {
      manifiesto.resultados.push({ celda: celda.id, ok: false, error: String(error) });
      console.log(`FALLO: ${String(error).slice(0, 200)}`);
    }

    const saldoActual = await saldo(key);
    if (manifiesto.saldo_antes !== null && saldoActual !== null) {
      const gastoHastaAhora = manifiesto.saldo_antes - saldoActual;
      if (gastoHastaAhora >= maxUsd) {
        manifiesto.detenido_por_limite = true;
        console.log(`\n[LIMITE] gasto acumulado US$${gastoHastaAhora.toFixed(4)} alcanzó --max-usd ${maxUsd}. Deteniendo antes de la siguiente celda.`);
        break;
      }
    }
  }

  manifiesto.saldo_despues = await saldo(key);
  if (manifiesto.saldo_antes !== null && manifiesto.saldo_despues !== null) {
    manifiesto.gasto_usd = Number((manifiesto.saldo_antes - manifiesto.saldo_despues).toFixed(4));
  }
  console.log(`saldo despues US$${manifiesto.saldo_despues ?? "?"} · gasto real US$${manifiesto.gasto_usd ?? "?"}`);

  const rutaManifiesto = path.join(outDir, `manifiesto-${nombre}.json`);
  fs.writeFileSync(rutaManifiesto, JSON.stringify(manifiesto, null, 2));
  console.log(`payloads literales en ${path.relative(process.cwd(), rutaManifiesto)}`);
}
