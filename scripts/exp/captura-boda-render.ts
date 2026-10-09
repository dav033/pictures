/**
 * Captura limpia de la escena de la boda de prueba (`escenaBodaRender`) con la MISMA función del taller que usa «Generar foto realista»
 * (`capturar()` del visor, vía `window.__visor3d`, solo en desarrollo), en sus dos encuadres: el de siempre (recortado a la decoración) y
 * el nuevo (`escenaEntera`: la sala con su mobiliario). Sin coste: no llama a FLUX. Deja también la descripción en inglés que viaja con la captura.
 *
 * Uso: npx tsx scripts/exp/captura-boda-render.ts <carpeta> [puerto]   (servidor de desarrollo en 127.0.0.1:<puerto>, por defecto 3057)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { armarEscena, escenaEnIngles } from "../../src/lib/globos3d/escena";
import { descripcionRender3d } from "../../src/lib/globos3d/render-ia";
import { referenciaPorCodigo } from "../../src/lib/plan/referencia-sempertex";
import { escenaBodaRender } from "./escena-boda-render";

const CARPETA = process.argv[2];
const PUERTO = process.argv[3] ?? "3057";
if (!CARPETA) throw new Error("Falta la carpeta de salida.");
const NOMBRE = "Boda de prueba render";

async function main() {
  mkdirSync(CARPETA, { recursive: true });
  const escena = escenaBodaRender();
  const navegador = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  try {
    const pagina = await navegador.newPage({ viewport: { width: 1400, height: 950 } });
    // La escena guardada del navegador (`guardado-escena.ts`): /3d la abre al cargar, sin pasar por la biblioteca.
    await pagina.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave!, valor!); }, ["taller3d:escena:v1", JSON.stringify({ nombre: NOMBRE, escena, clave: "boda-prueba-render" })]);
    await pagina.goto(`http://127.0.0.1:${PUERTO}/3d`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await pagina.waitForFunction(() => Boolean(window.__visor3d?.principal()?.capturar), undefined, { timeout: 240_000 });
    await pagina.waitForTimeout(12_000);
    for (const [archivo, opciones] of [["captura-3d-recortada.jpg", undefined], ["captura-3d-escena.jpg", { escenaEntera: true }]] as const) {
      const captura = await pagina.evaluate((o) => window.__visor3d?.principal()?.capturar?.(o) ?? null, opciones);
      if (!captura) throw new Error("El visor no dio captura (¿servidor de desarrollo?).");
      writeFileSync(join(CARPETA, archivo), Buffer.from(captura.replace(/^data:image\/jpeg;base64,/, ""), "base64"));
      console.log(`${archivo}: ${Math.round(captura.length * 0.75 / 1024)} KB`);
    }
    await pagina.screenshot({ path: join(CARPETA, "pagina-3d.png") });
    const armada = armarEscena(escena);
    const descripcion = descripcionRender3d(escenaEnIngles(escena, armada), armada.materiales.map((m) => ({ cantidad: m.cantidad, formatoId: m.formatoId, colorEn: referenciaPorCodigo(m.codigo)?.nombreEn ?? m.codigo })));
    writeFileSync(join(CARPETA, "descripcion.txt"), descripcion);
  } finally {
    await navegador.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
