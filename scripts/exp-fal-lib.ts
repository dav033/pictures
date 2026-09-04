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

export async function generar(key: string, payload: object): Promise<{ url: string; bytes: Buffer }> {
  const envio = await fetch(ENDPOINT, {
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
 * Corre las celdas en serie, guarda un PNG por celda y un manifiesto con los
 * payloads literales. Con `--dry-run` imprime los payloads y no gasta nada.
 */
export async function correrExperimento(opciones: {
  nombre: string;
  celdas: Celda[];
  defaults: Defaults;
  outDir: string;
}): Promise<void> {
  const { nombre, defaults, outDir } = opciones;
  const key = leerEnv("FAL_KEY");
  if (!key) throw new Error("Falta FAL_KEY en .env.local");

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
  };

  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify(manifiesto.celdas, null, 2));
    console.log(`\n[DRY-RUN] ${celdas.length} celdas. No se envió nada a fal.ai.`);
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  manifiesto.saldo_antes = await saldo(key);
  console.log(`${nombre}: ${celdas.length} celdas · saldo antes US$${manifiesto.saldo_antes ?? "?"}`);

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
