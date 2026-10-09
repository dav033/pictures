/**
 * Verificación visual SIN COSTE del «Love» dorado negro (P-017), con Playwright sin cabeza contra un servidor de desarrollo
 * PROPIO. En la página interna `/3d/captura` (un visor que sigue vivo, como el del taller):
 *   1. dibuja un item con foil (crea el visor y su entorno);
 *   2. hace una captura fuera de pantalla como la del refinado (`__capturarFoto`: crea otro visor y lo destruye);
 *   3. dibuja otro item con un foil de OTRO color (material nuevo, creado después de la captura).
 * Antes del arreglo el paso 3 salía negro (el material nuevo reflejaba el entorno liberado de la captura). Guarda los tres
 * PNG y escribe la luminosidad media y la parte del cuadro casi negra de cada uno; falla si el del paso 3 tiene una mancha negra grande.
 *
 *   npx next dev -p 3015     # con `turbopack.root` si node_modules es un enlace
 *   npx tsx scripts/exp/verificar-foil-captura.ts [--url http://127.0.0.1:3015] [--salida data/exp/foil-captura]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { encuadreDeLectura } from "../../src/lib/globos3d/encuadre-foto";
import { REFERENCIAS_DUENO } from "../../src/lib/globos3d/referencias-dueno";

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const url = (arg("--url") ?? "http://127.0.0.1:3015").replace(/\/$/, "");
const salida = path.resolve(arg("--salida") ?? "data/exp/foil-captura");
mkdirSync(salida, { recursive: true });

type Estado = { dataUrl: string | null; error: string | null };
type Ventana = { __capturarItem?: (id: string, vista?: string | null) => Promise<Estado>; __capturarFoto?: (escena: unknown, encuadre: unknown) => Promise<{ base64: string }> };

/** Items con foil de colores distintos: el primero abre el visor, el segundo se dibuja después de la captura con un material nuevo. */
const ANTES = "idea:columna-baby-shower-nina-luna";
const DESPUES = ["idea:columna-organica", "idea:centro-de-mesa-mis-quince", "idea:columna-baby-shower-nino-luna"];

/** Luminosidad media de los píxeles con color de foil (no del fondo gris claro). */
async function luminosidadDelFoil(png: Buffer): Promise<{ media: number; oscuros: number }> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let suma = 0, n = 0, oscuros = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (l < 0.12) oscuros++;
    // El fondo es gris claro (l > 0.8 y casi sin saturación): se descarta.
    if (l > 0.8 && Math.max(r, g, b) - Math.min(r, g, b) < 20) continue;
    suma += l; n++;
  }
  return { media: n ? suma / n : 0, oscuros: oscuros / (info.width * info.height) };
}

async function main() {
  const lectura = REFERENCIAS_DUENO.find((r) => r.numero === 7)!.lectura;
  const escena = compilarLectura(lectura).escena;
  const encuadre = encuadreDeLectura(lectura);
  const navegador = await chromium.launch({ headless: true });
  const pagina = await (await navegador.newContext({ viewport: { width: 800, height: 800 } })).newPage();
  await pagina.goto(`${url}/3d/captura`, { waitUntil: "load", timeout: 180_000 });
  await pagina.waitForFunction(() => typeof (window as unknown as Ventana).__capturarItem === "function", undefined, { timeout: 120_000 });

  const item = (id: string) => pagina.evaluate((i) => (window as unknown as Ventana).__capturarItem!(i), id);
  const guardar = async (nombre: string, e: Estado) => {
    if (!e.dataUrl) throw new Error(`${nombre}: ${e.error ?? "sin imagen"}`);
    const png = Buffer.from(e.dataUrl.slice(e.dataUrl.indexOf(",") + 1), "base64");
    writeFileSync(path.join(salida, `${nombre}.png`), png);
    return luminosidadDelFoil(png);
  };

  const antes = await guardar("1-antes-de-la-captura", await item(ANTES));
  await pagina.evaluate(([e, enc]) => (window as unknown as Ventana).__capturarFoto!(e, enc), [escena, encuadre] as const);
  const resultados: Array<{ id: string; media: number; oscuros: number }> = [];
  for (const [i, id] of DESPUES.entries()) {
    const l = await guardar(`${i + 2}-despues-de-la-captura-${id.replace(/\W+/g, "-")}`, await item(id));
    resultados.push({ id, ...l });
  }
  await navegador.close();
  console.log(JSON.stringify({ antes, despues: resultados }, null, 2));
  // Un foil negro es una mancha oscura grande (la estrella negra medida antes del arreglo ocupaba 3,5 % del cuadro; sin ella, < 0,1 %).
  const negro = resultados.filter((r) => r.oscuros > 0.01);
  if (negro.length) { console.error(`FALLA: foil casi negro después de la captura: ${negro.map((r) => r.id).join(", ")}`); process.exit(1); }
  console.log("OK: el foil creado después de la captura se ve con color.");
}
main().catch((e) => { console.error(e); process.exit(1); });
