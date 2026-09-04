import fs from "node:fs";
import path from "node:path";
import { ENDPOINT, flag, generar, leerEnv, resolverIdentidadLora, saldo, verificarIdentidadCoherente, type Defaults } from "./exp-fal-lib";

/**
 * Vía C: condicionar con la foto real del producto en vez de describirla.
 *
 * El descriptor perceptual ya acierta el color (ver exp-color-fidelidad), pero
 * depende de que alguien escriba bien el descriptor. Pasar la foto de catálogo
 * como referencia deja que el modelo VEA el color en lugar de leerlo, que es el
 * techo de fidelidad posible sin reentrenar.
 *
 * `sempertex-lora.ts` ya tiene el flag SEMPERTEX_LORA_EDIT para esto, apagado
 * porque "la identidad de producto no se pierde: color, acabado y tamaño ya
 * viajan como texto". Este experimento mide si esa premisa se sostiene.
 *
 * Corrección de atribución (PLAN-COMPOSICION-RICA-V001.md §1.1): igual que
 * los demás experimentos de esta tanda, la identidad ahora se resuelve como
 * tupla desde `--artifact-id` en vez de aceptar `--lora <url>` suelta.
 *
 *   npx tsx scripts/exp-color-referencia-producto.ts [--artifact-id v004-1000] --confirm-spend --max-usd 1 [--insecure-tls] [--dry-run]
 */

if (process.argv.includes("--insecure-tls")) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const EDIT_ENDPOINT = "https://queue.fal.run/fal-ai/flux-2/lora/edit";
const FOTO_PRODUCTO =
  "https://cdn.shopify.com/s/files/1/0593/1981/2289/files/R12RosaPrimaveral-PinkBlossom_809.jpg?v=1756764813";
const OUT_DIR = "reports/lora-debug/color-referencia";

const identidad = resolverIdentidadLora(flag("artifact-id", "v004-1000"));
const defaultsParaVerificar: Defaults = { seed: 0, guidance: 3.5, ancho: 1536, alto: 1024, loraUrl: identidad.url, trigger: identidad.trigger };
verificarIdentidadCoherente(defaultsParaVerificar);

/** El descriptor comercial que rompe el color, para ver si la foto lo corrige. */
const COMERCIAL = "spring pink with a Silk satin finish";
/** El descriptor perceptual validado, para ver si la foto suma sobre él. */
const PERCEPTUAL = "extremely pale desaturated silvery mauve-pink with a chrome-like pearl sheen";

const escena = (descriptor: string) =>
  `${identidad.trigger}, a balloon column, standing to one side, built from 12-inch ${descriptor} round latex balloons, set against a plain wall and floor.`;

const casos = [
  { id: "texto-comercial", descriptor: COMERCIAL, referencia: false },
  { id: "texto-perceptual", descriptor: PERCEPTUAL, referencia: false },
  { id: "referencia-comercial", descriptor: COMERCIAL, referencia: true },
  { id: "referencia-perceptual", descriptor: PERCEPTUAL, referencia: true },
];

async function main() {
  const seed = Number(flag("seed", "101"));

  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({ identidad, seed, casos }, null, 2));
    console.log(`\n[DRY-RUN] ${casos.length} celdas. No se envió nada a fal.ai. FAL_KEY no hace falta para esto.`);
    return;
  }
  if (process.env.CI === "true") {
    throw new Error("CI_SPEND_FORBIDDEN: este runner gasta dinero real en fal.ai y no puede ejecutarse con CI=true. Usa --dry-run.");
  }
  if (!process.argv.includes("--confirm-spend")) {
    throw new Error("CONFIRM_SPEND_REQUIRED: esta corrida gasta dinero real en fal.ai. Repite el comando con --confirm-spend (y --max-usd <tope>) para confirmar.");
  }
  const maxUsd = Number(flag("max-usd", ""));
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) {
    throw new Error("MAX_USD_REQUIRED: pasa --max-usd <tope en dólares> mayor que 0 antes de gastar.");
  }

  const key = leerEnv("FAL_KEY");
  if (!key) throw new Error("Falta FAL_KEY en .env.local");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const saldoAntes = await saldo(key);
  console.log(`${casos.length} celdas · seed ${seed} · referencia: ${FOTO_PRODUCTO.split("/").pop()} · tope US$${maxUsd} · saldo antes US$${saldoAntes ?? "?"}\n`);

  for (const caso of casos) {
    const payload: Record<string, unknown> = {
      prompt: escena(caso.descriptor),
      num_images: 1,
      seed,
      guidance_scale: 3.5,
      image_size: { width: 1536, height: 1024 },
      loras: [{ path: identidad.url, scale: 0.8 }],
      enable_safety_checker: false,
      output_format: "png",
    };
    if (caso.referencia) payload.image_urls = [FOTO_PRODUCTO];

    process.stdout.write(`-> ${caso.id} ... `);
    try {
      const { bytes } = await generar(key, payload, caso.referencia ? EDIT_ENDPOINT : ENDPOINT);
      fs.writeFileSync(path.join(OUT_DIR, `${caso.id}-seed${seed}.png`), bytes);
      console.log(`ok (${Math.round(bytes.byteLength / 1024)} KB)`);
    } catch (error) {
      console.log(`falló: ${error instanceof Error ? error.message : String(error)}`);
    }

    const saldoActual = await saldo(key);
    if (saldoAntes !== null && saldoActual !== null && saldoAntes - saldoActual >= maxUsd) {
      console.log(`\n[LIMITE] gasto acumulado US$${(saldoAntes - saldoActual).toFixed(4)} alcanzó --max-usd ${maxUsd}. Deteniendo antes de la siguiente celda.`);
      break;
    }
  }
  console.log(`\nimágenes en ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
