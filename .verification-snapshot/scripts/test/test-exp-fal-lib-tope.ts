import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BALANCE_URL, correrExperimento, ENDPOINT, type Celda, type Defaults } from "../lib/fal-evaluacion";

/**
 * El tope `--max-usd` de `correrExperimento` (los scripts de generación en
 * fal.ai: `generar-bouquet-armado.ts`, `generar-guirnalda-armado.ts` y las
 * evaluaciones de LoRA) se mide con el saldo de fal: el repo no tiene un
 * precio por imagen. Sin saldo legible tiene que fallar cerrado (hallazgo 26
 * de la revisión de `feat/guirnaldas`): antes, un 403 en la consulta del saldo
 * dejaba generar todas las celdas sin límite.
 *
 * Sin red ni FAL_KEY real: `fetch` es un doble y la salida va a un directorio
 * temporal que se borra al terminar.
 *   npx tsx scripts/test/test-exp-fal-lib-tope.ts
 */

const DEFAULTS: Defaults = { seed: 1, guidance: 3.5, ancho: 512, alto: 512, loraUrl: "https://fal.test/lora.safetensors", trigger: "prueba_v1" };
const CELDAS: Celda[] = [
  { id: "celda-1", prompt: "a balloon bouquet", lora: null },
  { id: "celda-2", prompt: "a balloon bouquet", lora: null },
];

/** `saldos[i]` es la respuesta a la i-ésima consulta del saldo (null = 403); el último se repite. */
function instalarFal(saldos: ReadonlyArray<number | null>): { envios: () => number } {
  let consultas = 0;
  let envios = 0;
  globalThis.fetch = (async (entrada: RequestInfo | URL) => {
    const url = String(entrada);
    if (url === BALANCE_URL) {
      const valor = saldos[Math.min(consultas, saldos.length - 1)];
      consultas += 1;
      return valor === null || valor === undefined ? new Response("forbidden", { status: 403 }) : new Response(String(valor));
    }
    if (url === ENDPOINT) {
      envios += 1;
      return Response.json({ status_url: "https://fal.test/estado", response_url: "https://fal.test/resultado" });
    }
    if (url === "https://fal.test/estado") return Response.json({ status: "COMPLETED" });
    if (url === "https://fal.test/resultado") return Response.json({ images: [{ url: "https://fal.test/imagen.png" }] });
    if (url === "https://fal.test/imagen.png") return new Response(new Uint8Array(250_000));
    throw new Error(`URL inesperada en la prueba: ${url}`);
  }) as typeof fetch;
  return { envios: () => envios };
}

async function correr(nombre: string, saldos: ReadonlyArray<number | null>) {
  const fal = instalarFal(saldos);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "exp-fal-tope-"));
  try {
    const resultado = await correrExperimento({ nombre, celdas: CELDAS, defaults: DEFAULTS, outDir }).then(() => null, (error: unknown) => error);
    const rutaManifiesto = path.join(outDir, `manifiesto-${nombre}.json`);
    const manifiesto = fs.existsSync(rutaManifiesto) ? (JSON.parse(fs.readFileSync(rutaManifiesto, "utf8")) as Record<string, unknown>) : null;
    return { error: resultado, envios: fal.envios(), manifiesto };
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  process.env.FAL_KEY = "clave-de-prueba";
  delete process.env.CI;
  process.argv = [process.argv[0]!, process.argv[1]!, "--confirm-spend", "--max-usd", "0.5"];

  // 1. Sin saldo legible al empezar no se genera nada.
  const sinSaldo = await correr("sin-saldo", [null]);
  assert.match(String(sinSaldo.error), /SALDO_ILEGIBLE/);
  assert.equal(sinSaldo.envios, 0, "un 403 en el saldo no puede dejar generar imágenes");

  // 2. Si el saldo deja de leerse a mitad (también al reintentar), la tanda se detiene.
  const aMitad = await correr("saldo-a-mitad", [10, null]);
  assert.equal(aMitad.error, null);
  assert.equal(aMitad.envios, 1, "tras perder el saldo no se genera la segunda celda");
  assert.equal(aMitad.manifiesto?.detenido_por_saldo_ilegible, true);

  // 3. Un fallo suelto de la consulta se reintenta una vez y la tanda sigue.
  const suelto = await correr("fallo-suelto", [10, null, 9.95, 9.9]);
  assert.equal(suelto.envios, 2);
  assert.equal(suelto.manifiesto?.detenido_por_saldo_ilegible, false);

  // 4. Con saldo legible el tope sigue deteniendo la tanda al alcanzarse.
  const tope = await correr("tope", [10, 9.4]);
  assert.equal(tope.envios, 1);
  assert.equal(tope.manifiesto?.detenido_por_limite, true);

  console.log("test-exp-fal-lib-tope: OK — sin saldo legible el tope de fal falla cerrado.");
}

main().catch((error: unknown) => {
  console.error("[FAIL]", error);
  process.exitCode = 1;
});
