/**
 * Captura limpia de la escena del experimento (`ESCENA_RENDER_FIEL`) con la MISMA función del taller que usa
 * «Generar imagen con IA» (`capturar()` del visor, vía `window.__visor3d`, solo en desarrollo), sin pulsar el botón
 * que llama a FLUX. Abre /3d en un Chromium sin ventana, deja la escena en la biblioteca propia (localStorage de ese
 * navegador), la abre en Escena y guarda la captura. Sin coste.
 *
 * Uso: npx tsx scripts/exp/captura-render-fiel.ts [carpeta]   (servidor de desarrollo en :3010)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { itemDeEscena } from "../../src/lib/globos3d/biblioteca";
import { armarEscena, escenaEnIngles } from "../../src/lib/globos3d/escena";
import { descripcionRender3d } from "../../src/lib/globos3d/render-ia";
import { referenciaPorCodigo } from "../../src/lib/plan/referencia-sempertex";
import { ESCENA_RENDER_FIEL } from "./escena-render-fiel";

const CARPETA = process.argv[2] ?? "C:/Users/davidt/Downloads/pictures-workspace/render-fiel";
const NOMBRE = "Experimento render fiel";

async function main() {
  mkdirSync(CARPETA, { recursive: true });
  const item = { ...itemDeEscena({ id: "propio:experimento-render-fiel-1", nombre: NOMBRE, ocasiones: ["cumpleanos"], fuente: { tipo: "propio", titulo: "Experimento render fiel" }, escena: ESCENA_RENDER_FIEL }), propio: true };
  const navegador = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  try {
    const pagina = await navegador.newPage({ viewport: { width: 1400, height: 950 } });
    await pagina.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave!, valor!); }, ["taller3d:biblioteca-propia:v1", JSON.stringify([item])]);
    await pagina.goto("http://localhost:3010/3d", { waitUntil: "domcontentloaded", timeout: 180_000 });
    await pagina.getByRole("tab", { name: "Biblioteca", exact: true }).click({ timeout: 180_000 });
    await pagina.getByPlaceholder("Buscar: araña, columna, dorado…").fill(NOMBRE);
    await pagina.getByText(NOMBRE).first().click({ timeout: 60_000 });
    const abrir = pagina.getByRole("button", { name: "Abrir en Escena" });
    await abrir.waitFor({ timeout: 120_000 });
    await pagina.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Abrir en Escena")); return b && !(b as HTMLButtonElement).disabled; }, undefined, { timeout: 120_000 });
    await abrir.click();
    await pagina.waitForTimeout(8_000);
    const captura = await pagina.evaluate(() => window.__visor3d?.principal()?.capturar?.() ?? null);
    if (!captura) throw new Error("El visor no dio captura (¿servidor de desarrollo?).");
    const datos = captura.replace(/^data:image\/jpeg;base64,/, "");
    writeFileSync(join(CARPETA, "captura-3d.jpg"), Buffer.from(datos, "base64"));
    await pagina.screenshot({ path: join(CARPETA, "pagina-3d.png") });
    const armada = armarEscena(ESCENA_RENDER_FIEL);
    const descripcion = descripcionRender3d(escenaEnIngles(ESCENA_RENDER_FIEL, armada), armada.materiales.map((m) => ({ cantidad: m.cantidad, formatoId: m.formatoId, colorEn: referenciaPorCodigo(m.codigo)?.nombreEn ?? m.codigo })));
    writeFileSync(join(CARPETA, "descripcion.txt"), descripcion);
    console.log(`captura: ${join(CARPETA, "captura-3d.jpg")} (${Math.round(datos.length * 0.75 / 1024)} KB)`);
  } finally {
    await navegador.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
