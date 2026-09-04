import { generarConSempertexLora, type LoraApplication } from "@/lib/ia/sempertex-lora";
import type { ImageInput } from "@/lib/ia/tipos";

/**
 * Imprime el payload LITERAL que la app le manda al LoRA Sempertex.
 *
 * No lo reconstruye a mano: intercepta `fetch` y captura el cuerpo real que
 * arma `generarConSempertexLora`, así no hay riesgo de que esta descripción se
 * desincronice del código. Nunca sale a la red ni gasta un centavo.
 *
 * `generarConSempertexLora` ya no acepta un fallback anónimo de URL/trigger
 * (PLAN-COMPOSICION-RICA-V001.md §1.1/§9.2): este dump simula una aplicación
 * LoRA YA RESUELTA, del mismo tipo que devolvería `resolveLoraMode` en
 * producción. La URL es un placeholder de depuración, no un artifact real.
 *
 *   npx tsx --conditions=react-server scripts/dump-payload-lora.ts
 */

const APLICACION_LORA_DEPURACION: LoraApplication = {
  artifactId: "debug-artifact",
  specialization: "structure",
  path: "https://example.invalid/debug-lora-weights.safetensors",
  trigger: "eventdecor_style_v2",
  scale: 0.8,
};

/** Prompt real del compilador v2 para la escena XV (ver exp-prompt-produccion-xv.ts). */
const PROMPT = "a grand organic balloon arch in pink and rose gold centered around the stage photo area, " +
  "two balloon columns, matching one another, one standing on the left and one on the right, " +
  "flanking the main arch, with a low coordinated balloon centerpiece placed on the main table " +
  "beneath the main arch. wide photorealistic event photograph, natural depth, believable floor " +
  "contact and supports.";

const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Mismos roles y prioridades que produce `buildInputs()` en la ruta real. */
const REFERENCIAS: ImageInput[] = [
  { id: "IMG_VENUE", base64: PIXEL, mime: "image/png", descripcion: "Foto del salón del cliente.", role: "venue_base", priority: 1, allowed_use: "Venue identity: camera, crop, architecture, perspective, and light." },
  { id: "IMG_INSPIRACION", base64: PIXEL, mime: "image/png", descripcion: "Foto de inspiración enviada por el cliente.", role: "composition_reference", priority: 2, allowed_use: "Composition reference only: framing, proportion between structures, density, background geometry, and light placement. Never use it as a source of product identity." },
  { id: "IMG_GLOBO_ROSADO", base64: PIXEL, mime: "image/png", descripcion: "Globo látex rosado R-12 del catálogo Sempertex.", role: "catalog_product_reference", priority: 3, allowed_use: "Product identity only: exact color, shape, material, print, and distinguishing details; re-render physically using the installed design quantity from the estimate, never package surplus." },
  { id: "IMG_GLOBO_ORO_ROSA", base64: PIXEL, mime: "image/png", descripcion: "Globo látex metalizado oro rosa R-12 del catálogo Sempertex.", role: "catalog_product_reference", priority: 3, allowed_use: "Product identity only: exact color, shape, material, print, and distinguishing details; re-render physically using the installed design quantity from the estimate, never package surplus." },
  { id: "IMG_GLOBO_R5", base64: PIXEL, mime: "image/png", descripcion: "Globo látex metalizado oro rosa R-5 — QUINTA imagen, debería quedar fuera.", role: "catalog_product_reference", priority: 3, allowed_use: "Product identity only." },
];

type Captura = { url: string; cuerpo: Record<string, unknown> };

async function capturar(referencias: ImageInput[]): Promise<Captura> {
  const original = globalThis.fetch;
  let captura: Captura | undefined;
  globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
    captura = { url: String(entrada), cuerpo: JSON.parse(String(init?.body)) as Record<string, unknown> };
    throw new Error("__CAPTURADO__"); // corta antes de salir a la red
  }) as typeof fetch;
  try {
    await generarConSempertexLora(PROMPT, "3:2", referencias, { loras: [APLICACION_LORA_DEPURACION] });
  } catch (error) {
    if (!String(error).includes("__CAPTURADO__")) throw error;
  } finally {
    globalThis.fetch = original;
  }
  if (!captura) throw new Error("No se capturó ninguna petición.");
  return captura;
}

function mostrar(titulo: string, captura: Captura): void {
  const linea = "=".repeat(78);
  const c = { ...captura.cuerpo };
  const imagenes = (c.image_urls as string[] | undefined) ?? [];
  c.image_urls = imagenes.map((u) => `${u.slice(0, 34)}… (${u.length} chars)`);
  console.log(`\n${linea}\n${titulo}\n${linea}`);
  console.log(`ENDPOINT: ${captura.url}\n`);
  console.log(`PROMPT (${String(c.prompt).length} chars):`);
  console.log(String(c.prompt).split("\n").map((l) => "  " + l).join("\n"));
  const { prompt: _p, ...resto } = c;
  console.log(`\nRESTO DEL CUERPO:`);
  console.log(JSON.stringify(resto, null, 2).split("\n").map((l) => "  " + l).join("\n"));
  console.log(`\nimágenes enviadas: ${imagenes.length} de ${REFERENCIAS.length} candidatas`);
}

async function main(): Promise<void> {
  process.env.FAL_KEY ??= "clave-de-mentira-no-se-usa";

  mostrar('MODO "Depurar LoRA"  ·  sin imágenes  ·  lo que se evaluó en esta sesión', await capturar([]));
  mostrar('MODO "LoRA Sempertex" (producción)  ·  con fotos de globos  ·  SIN EVALUAR', await capturar(REFERENCIAS));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
