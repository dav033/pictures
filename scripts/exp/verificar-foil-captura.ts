/**
 * Verificación visual SIN COSTE del «Love» dorado negro (P-017), con Playwright sin cabeza contra un servidor de desarrollo
 * PROPIO. En la página interna `/3d/captura` (un visor que sigue vivo, como el del taller):
 *   1. dibuja un item con foil (crea el visor y su entorno);
 *   2. hace una captura fuera de pantalla como la del refinado (`__capturarFoto`: crea otro visor y lo destruye);
 *   3. dibuja otro item con un foil de OTRO color (material nuevo, creado después de la captura).
 * Antes del arreglo el paso 3 salía negro (el material nuevo reflejaba el entorno liberado de la captura). Guarda los tres
 * PNG y escribe la luminosidad media y la parte del cuadro casi negra de cada uno; falla si el del paso 3 tiene una mancha negra grande.
 *
 *   npx next dev -p 3018     # con `turbopack.root` si node_modules es un enlace
 *   npx tsx scripts/exp/verificar-foil-captura.ts [--url http://127.0.0.1:3018] [--salida data/exp/foil-captura]
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { encuadreDeLectura } from "../../src/lib/globos3d/encuadre-foto";
import { REFERENCIAS_DUENO } from "../../src/lib/globos3d/referencias-dueno";

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const url = (arg("--url") ?? "http://127.0.0.1:3018").replace(/\/$/, "");
const salida = path.resolve(arg("--salida") ?? "data/exp/foil-captura");
mkdirSync(salida, { recursive: true });

type Estado = { dataUrl: string | null; error: string | null };
type Ventana = { __capturarItem?: (id: string, vista?: string | null) => Promise<Estado>; __capturarEscena?: (escena: unknown, ambiente?: unknown) => Promise<Estado>; __capturarFoto?: (escena: unknown, encuadre: unknown) => Promise<{ base64: string }> };

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

/**
 * La escena completa de una foto con lentejuelas, confeti y cromados, con piso de madera y luces de techo, en el visor que sigue
 * vivo: piso, lentejuelas, confeti y cromado se crean DESPUÉS de una captura fuera de pantalla (`__capturarFoto`) y deben
 * salir idénticos a los de una página donde no hubo ninguna captura (mismo hash), y no negros. Dos dibujos seguidos también son idénticos.
 */
const AMBIENTE = { piso: "madera", luces: true } as const;
async function verificarEscenaCompleta(navegador: import("playwright").Browser) {
  const lectura = REFERENCIAS_DUENO.find((r) => r.numero === 3)!.lectura;
  const escena = compilarLectura(lectura).escena;
  const otra = compilarLectura(REFERENCIAS_DUENO.find((r) => r.numero === 11)!.lectura).escena;
  const encuadre = encuadreDeLectura(lectura);
  const abrir = async () => {
    const p = await (await navegador.newContext({ viewport: { width: 800, height: 800 } })).newPage();
    await p.goto(`${url}/3d/captura`, { waitUntil: "load", timeout: 180_000 });
    await p.waitForFunction(() => typeof (window as unknown as Ventana).__capturarEscena === "function", undefined, { timeout: 120_000 });
    return p;
  };
  const dibujar = async (p: Awaited<ReturnType<typeof abrir>>, e: unknown): Promise<Buffer> => {
    const r = await p.evaluate(([x, a]) => (window as unknown as Ventana).__capturarEscena!(x, a), [e, AMBIENTE] as const);
    if (!r.dataUrl) throw new Error(r.error ?? "sin imagen");
    return Buffer.from(r.dataUrl.slice(r.dataUrl.indexOf(",") + 1), "base64");
  };
  const hash = (b: Buffer) => createHash("sha1").update(b).digest("hex").slice(0, 12);
  // Página limpia: nada se capturó antes.
  const limpia = await abrir();
  const a1 = await dibujar(limpia, escena), a2 = await dibujar(limpia, escena);
  // Página con captura en medio: primero otra escena (materiales viejos), luego la captura de refinado y por último la escena de prueba.
  const sucia = await abrir();
  await dibujar(sucia, otra);
  await sucia.evaluate(([e, enc]) => (window as unknown as Ventana).__capturarFoto!(e, enc), [escena, encuadre] as const);
  const b1 = await dibujar(sucia, escena);
  for (const [n, b] of [["escena-limpia-1", a1], ["escena-limpia-2", a2], ["escena-tras-captura", b1]] as const) writeFileSync(path.join(salida, `${n}.png`), b);
  const lum = await luminosidadDelFoil(b1);
  const res = { limpia1: hash(a1), limpia2: hash(a2), trasCaptura: hash(b1), oscuros: lum.oscuros };
  console.log(JSON.stringify(res));
  if (res.limpia1 !== res.limpia2) { console.error("FALLA: dos dibujos seguidos de la misma escena no son idénticos"); process.exit(1); }
  if (res.limpia1 !== res.trasCaptura) { console.error("FALLA: la escena dibujada después de una captura no es idéntica a la de una página sin captura (¿entorno liberado?)"); process.exit(1); }
  if (lum.oscuros > 0.12) { console.error(`FALLA: demasiado negro tras la captura (${(lum.oscuros * 100).toFixed(1)} %)`); process.exit(1); }
  console.log("OK: piso, lentejuelas, confeti y cromado salen iguales y con color después de una captura.");
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
  console.log(JSON.stringify({ antes, despues: resultados }, null, 2));
  // Un foil negro es una mancha oscura grande (la estrella negra medida antes del arreglo ocupaba 3,5 % del cuadro; sin ella, < 0,1 %).
  const negro = resultados.filter((r) => r.oscuros > 0.01);
  if (negro.length) { console.error(`FALLA: foil casi negro después de la captura: ${negro.map((r) => r.id).join(", ")}`); process.exit(1); }
  console.log("OK: el foil creado después de la captura se ve con color.");
  await verificarEscenaCompleta(navegador);
  await navegador.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
