/**
 * Captura lo que `generarConSempertexFlux` manda de verdad al proveedor, sin
 * red: `globalThis.fetch` se sustituye por uno que guarda la primera petición y
 * responde 503, así que la llamada falla después del envío y nunca sondea ni
 * descarga nada.
 *
 * Dos caminos, los dos de producción:
 * - directo a fal (`FLUX_GENERATION_PYTHON_ENABLED` apagada): el endpoint y el
 *   cuerpo JSON literal;
 * - por Python (`FLUX_GENERATION_PYTHON_ENABLED=true`, que se lee al cargar el
 *   módulo): la ruta interna y el cuerpo de la operación. El `context` del
 *   sobre operacional (ids, plazo, hash) queda fuera porque cambia en cada
 *   llamada.
 *
 * Lo usan `scripts/test/test-guia-estructura*.ts` y la captura única de
 * `scripts/fixtures/guia-estructura/peticiones-base.json`.
 * Módulo importable: sin efectos al cargar.
 */
import type { ImageInput, PeticionImagen } from "@/lib/ia/nucleo/tipos";
import type { SempertexFluxOptions } from "@/lib/ia/kagutsuchi/flux";

export type PeticionCapturada = { destino: string; cuerpo: unknown };

type Generar = (prompt: string, aspecto: PeticionImagen["aspecto"], inputs: ImageInput[], options: SempertexFluxOptions) => Promise<unknown>;

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

export async function capturarPeticion(generar: Generar, prompt: string, aspecto: PeticionImagen["aspecto"], inputs: ImageInput[], options: SempertexFluxOptions): Promise<PeticionCapturada> {
  const fetchOriginal = globalThis.fetch;
  const claveOriginal = process.env.FAL_KEY;
  process.env.FAL_KEY = "clave-de-prueba-nunca-enviada";
  const capturadas: PeticionCapturada[] = [];
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(entrada));
    const cuerpo: unknown = JSON.parse(String(init?.body));
    // Por Python solo interesa la operación: el `context` del sobre lleva ids y plazos de cada llamada.
    const operacion = esObjeto(cuerpo) && url.pathname.startsWith("/internal/") ? Object.fromEntries(Object.entries(cuerpo).filter(([clave]) => clave !== "context")) : cuerpo;
    capturadas.push({ destino: url.hostname.endsWith("fal.run") ? url.toString() : url.pathname, cuerpo: operacion });
    return new Response(JSON.stringify({ detail: "captura de prueba" }), { status: 503, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await generar(prompt, aspecto, inputs, options).catch(() => undefined);
  } finally {
    globalThis.fetch = fetchOriginal;
    if (claveOriginal === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = claveOriginal;
  }
  const primera = capturadas[0];
  if (!primera) throw new Error("generarConSempertexFlux no envió ninguna petición");
  return primera;
}

/** Una imagen de entrada mínima con su rol, para armar los casos. */
export function imagenDePrueba(role: ImageInput["role"], priority: number, id: string, base64 = "AA=="): ImageInput {
  return { id, role, priority, base64, mime: "image/jpeg", descripcion: id, allowed_use: "x" };
}

/** El LoRA de los casos: la identidad de `v007-1000` (slot `training_2`), como la resuelve el registro. */
export const FLUX_DE_PRUEBA = { artifactId: "v007-1000", specialization: "structure" as const, path: "https://v3b.fal.media/files/b/0aa8f88d/dACfQPmchrcACAaPlWyhN_pytorch_lora_weights.safetensors", trigger: "eventdecor_style_v3", scale: 0.8 };
export const CAPTION_DE_PRUEBA = "eventdecor_style_v3, an organic balloon garland of round latex balloons in pink, white and gold mounted flat against the wall.";

/**
 * Las entradas con que la ruta llama hoy al LoRA, una por camino: sin
 * imágenes, solo fotos de producto, con foto del espacio, una revisión y las
 * referencias de la etapa 1 del híbrido (`REFERENCIA_EN_ETAPA1_V1`).
 */
export function casosBase(): Record<string, ImageInput[]> {
  return {
    "sin-imagenes": [],
    "solo-productos": [imagenDePrueba("catalog_product_reference", 3, "P1"), imagenDePrueba("catalog_product_reference", 3, "P2")],
    venue: [imagenDePrueba("catalog_product_reference", 3, "P1"), imagenDePrueba("venue_base", 1, "VENUE_01")],
    previo: [imagenDePrueba("composition_reference", 2, "R1"), imagenDePrueba("previous_generated_result", 0, "PREV")],
    "referencias-hibrido": [imagenDePrueba("composition_reference", 2, "R1"), imagenDePrueba("element_reference", 3, "R2")],
  };
}
