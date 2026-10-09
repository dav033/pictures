/**
 * Prueba de punta a punta de la barra «Pídele a la IA» con una foto (REQ-001 paso 9), con Playwright sin cabeza contra un
 * servidor de desarrollo PROPIO: adjunta la foto, pide armarla, y mira que tras la primera respuesta arranque la ronda
 * «Comparando con la foto…» (segunda petición con `refinar` y su captura) y que la escena quede donde la foto la tiene.
 * Guarda capturas de pantalla antes de pedir, al llegar la primera respuesta, durante la ronda y al terminar.
 *
 *   npx next dev -p 3014     # con la clave de Gemini en el entorno (sin imprimirla) y `turbopack.root` si node_modules es un enlace
 *   npx tsx scripts/exp/e2e-foto-ui.ts --foto <ruta.jpg> [--url http://127.0.0.1:3014] [--salida data/exp/e2e-foto-ui] [--mensaje "…"] [--gpu]
 *
 * Es PAGADO (lectura de la foto + el turno del agente + la ronda: ~US$0,08). Sin GPU por omisión, como un navegador sin cabeza
 * cualquiera: si la captura 3D no pudiera dibujar, la barra tiene que decirlo.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const fotoArg = arg("--foto");
if (!fotoArg) throw new Error("Falta --foto <ruta de la foto>");
const foto: string = fotoArg;
const url = (arg("--url") ?? "http://127.0.0.1:3014").replace(/\/$/, "");
const salida = path.resolve(arg("--salida") ?? "data/exp/e2e-foto-ui");
const mensaje = arg("--mensaje") ?? "arma esta decoración de la foto en la pared del fondo";
mkdirSync(salida, { recursive: true });

type Nodo = { id: string; pieza: { tipo: string }; colocacion: Record<string, unknown> };
type RespuestaIA = { escena?: { sala: { altoCm: number }; nodos: Nodo[] }; acciones?: Array<{ herramienta: string; resumen: string; consulta: boolean }>; foto?: { aplicada?: boolean }; refinar?: { motivo: string; significativas: number | null; cambios: number }; uso?: { costeEstimadoUsd?: number }; error?: string };

async function main() {
  const args = process.argv.includes("--gpu") ? ["--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=d3d11"] : [];
  const navegador = await chromium.launch({ headless: true, args });
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
  const pagina = await contexto.newPage();
  const consola: string[] = [];
  pagina.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consola.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  pagina.on("pageerror", (e) => consola.push(`pageerror: ${e.message.slice(0, 300)}`));

  const respuestas: Array<{ refinar: boolean; estado: number; cuerpo: RespuestaIA }> = [];
  pagina.on("response", async (r) => {
    if (!r.url().endsWith("/api/escena-ia")) return;
    const pedido = JSON.parse(r.request().postData() ?? "{}") as { refinar?: unknown };
    respuestas.push({ refinar: Boolean(pedido.refinar), estado: r.status(), cuerpo: (await r.json().catch(() => ({}))) as RespuestaIA });
  });

  await pagina.goto(`${url}/3d`, { waitUntil: "load", timeout: 180_000 });
  await pagina.waitForSelector("#escena-ia-linea", { timeout: 120_000 });
  await pagina.setInputFiles('input[type="file"]', foto);
  await pagina.waitForSelector('img[alt="Foto adjunta"]', { timeout: 30_000 });
  await pagina.fill("#escena-ia-linea", mensaje);
  await pagina.screenshot({ path: path.join(salida, "1-antes.png") });
  await pagina.press("#escena-ia-linea", "Enter");

  const botones: string[] = [];
  let primera = false, vistaRonda = false;
  const inicio = Date.now();
  while (Date.now() - inicio < 240_000) {
    await pagina.waitForTimeout(700);
    const t = await pagina.locator('button[aria-label="Enviar a la IA"]').innerText().catch(() => "");
    if (botones[botones.length - 1] !== t) { botones.push(t); console.log(`[${Math.round((Date.now() - inicio) / 1000)} s] botón: «${t}»`); }
    if (!primera && respuestas.length >= 1) { primera = true; await pagina.screenshot({ path: path.join(salida, "2-primera-respuesta.png") }); }
    if (!vistaRonda && /^Foto \d\/\d$/.test(t)) { vistaRonda = true; await pagina.screenshot({ path: path.join(salida, "3-comparando.png") }); }
    if (t === "Pedir" && respuestas.length >= 1 && Date.now() - inicio > 8_000) { await pagina.waitForTimeout(1500); if (await pagina.locator('button[aria-label="Enviar a la IA"]').innerText().catch(() => "") === "Pedir") break; }
  }
  await pagina.waitForTimeout(1000);
  // Abre la conversación para que la captura final muestre lo que dijo la IA.
  await pagina.locator('button[aria-label="Ver la conversación y los ejemplos"]').click({ timeout: 2000 }).catch(() => undefined);
  await pagina.screenshot({ path: path.join(salida, "4-despues.png") });

  const resumen = respuestas.map((r, i) => {
    const e = r.cuerpo.escena;
    return {
      peticion: i + 1, refinar: r.refinar, estado: r.estado, error: r.cuerpo.error ?? null, costeUsd: r.cuerpo.uso?.costeEstimadoUsd ?? null, fotoAplicada: r.cuerpo.foto?.aplicada ?? null, ronda: r.cuerpo.refinar ?? null,
      acciones: (r.cuerpo.acciones ?? []).filter((a) => !a.consulta).map((a) => `${a.herramienta}: ${a.resumen.slice(0, 120)}`),
      salaAltoCm: e?.sala.altoCm ?? null,
      piezas: (e?.nodos ?? []).map((n) => ({ id: n.id, tipo: n.pieza.tipo, colocacion: n.colocacion })),
    };
  });
  writeFileSync(path.join(salida, "resumen.json"), JSON.stringify({ botones, consola, resumen }, null, 2));
  console.log(JSON.stringify({ botones, consola, resumen }, null, 2));
  await navegador.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
