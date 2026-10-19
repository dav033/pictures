/**
 * Capturas de un salón de eventos (REQ-008) en el taller real, sin cabeza y sin gasto: arma la escena con la herramienta (sin Gemini),
 * la deja guardada en el navegador (la misma clave que usa el taller al abrir /3d) y saca una captura de la página.
 *   npx next dev -p 3022 -H 127.0.0.1     # en otra terminal; con node_modules enlazado Turbopack pide `turbopack.root` en next.config.ts (solo para la captura, sin versionarlo)
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/exp/capturar-salon.ts <carpeta_salida> [url_base] [archivos,separados,por,coma]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";

const salida = process.argv[2] ?? ".";
const base = (process.argv[3] ?? "http://127.0.0.1:3022").replace(/\/$/, "");
mkdirSync(salida, { recursive: true });

const aplicar = (e: Escena, nombre: string, args: Record<string, unknown>): Escena => {
  const r = aplicarHerramienta(e, nombre, args);
  if (!r.ok) throw new Error(`${nombre}: ${r.error}`);
  console.log(`${nombre}: ${r.resumen.slice(0, 160)}`);
  return r.escena;
};
const vacia = (): Escena => ({ sala: { ...SALA_INICIAL }, nodos: [] });

const evento = (args: Record<string, unknown>) => aplicar(vacia(), "planificar_evento", args);
const escenas: Array<{ archivo: string; escena: Escena }> = [
  { archivo: "boda-120-blanco-dorado", escena: evento({ tipo_evento: "boda", invitados: 120, colores: ["blanco", "dorado"] }) },
  { archivo: "rincon-cumpleanos-20", escena: evento({ tipo_evento: "cumpleanos", alcance: "rincon", invitados: 20, colores: ["rosa", "dorado"] }) },
  { archivo: "solo-decoracion", escena: evento({ tipo_evento: "cumpleanos", alcance: "solo_decoracion", colores: ["rosa", "dorado"] }) },
  // Variedad: el mismo camino de herramientas con otros temas da otras composiciones (no siempre arco, dos columnas y guirnalda).
  { archivo: "variedad-safari", escena: evento({ tipo_evento: "baby_shower", alcance: "solo_decoracion", tematica: "safari" }) },
  { archivo: "variedad-frozen", escena: evento({ tipo_evento: "cumpleanos", alcance: "solo_decoracion", tematica: "Frozen", colores: ["azul", "plateado"] }) },
  { archivo: "variedad-graduacion", escena: evento({ tipo_evento: "graduacion", alcance: "solo_decoracion", colores: ["azul"], texto: "2026" }) },
  { archivo: "variedad-halloween", escena: evento({ tipo_evento: "halloween", alcance: "solo_decoracion" }) },
];
const soloEstas = process.argv[4] ? new Set(process.argv[4].split(",")) : null;

async function principal() {
  const navegador = await chromium.launch({ headless: true, args: ["--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=d3d11"] });
  for (const { archivo, escena } of escenas.filter((x) => !soloEstas || soloEstas.has(x.archivo))) {
    const pagina = await navegador.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
    pagina.setDefaultTimeout(120_000);
    pagina.on("console", (m) => { if (m.type() === "error") console.log(`  [consola] ${m.text().slice(0, 160)}`); });
    await pagina.addInitScript(([clave, valor]) => { try { window.localStorage.setItem(clave!, valor!); } catch { /* sin almacenamiento */ } }, ["taller3d:escena:v1", JSON.stringify({ nombre: archivo, escena })] as const);
    await pagina.goto(`${base}/3d`, { waitUntil: "load" });
    await pagina.waitForSelector("canvas");
    await pagina.waitForTimeout(9000);
    await pagina.screenshot({ path: join(salida, `${archivo}.png`) });
    console.log(`  captura ${archivo}.png`);
    await pagina.close();
  }
  await navegador.close();
}

principal().catch((error) => { console.error(error); process.exit(1); });
