/**
 * Prueba de punta a punta del criterio de aceptación del refinado (P-016) con el modelo de texto SIMULADO, así que casi sin
 * coste (solo los 3 embeddings de imagen de la ruta real `/api/escena-ia/similitud`, ~US$0,0003). Playwright sin cabeza contra un
 * servidor de desarrollo PROPIO: adjunta la foto, y `/api/escena-ia` se contesta con escenas armadas por el compilador (la
 * primera respuesta con la lectura y el encuadre de la foto; la ronda con la escena que decide el caso). Lo demás es real:
 * la barra, la captura 3D con la cámara de la foto, el pedido de similitud y el deshacer.
 *
 *   --caso mejora     la primera escena no tiene la guirnalda y la ronda la pone: se parece más a la foto → se queda la ronda
 *   --caso empeora    la ronda pinta la pared de oscuro: se parece menos → se descarta y queda la escena de antes
 *   --caso reduce     la ronda quita la guirnalda: baja los globos más de 30 % → se descarta sin pedir embeddings
 *
 *   npx next dev -p 3015     # con la clave de Gemini en el entorno (sin imprimirla) y `turbopack.root` si node_modules es un enlace
 *   npx tsx scripts/exp/e2e-aceptacion-ui.ts --foto <ruta.jpg> --caso mejora [--url http://127.0.0.1:3015] [--salida data/exp/e2e-aceptacion]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { encuadreDeLectura } from "../../src/lib/globos3d/encuadre-foto";
import type { Escena } from "../../src/lib/globos3d/escena";
import { REFERENCIAS_DUENO } from "../../src/lib/globos3d/referencias-dueno";

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const fotoArg = arg("--foto");
if (!fotoArg) throw new Error("Falta --foto <ruta de la foto>");
const foto: string = fotoArg;
const caso = arg("--caso") ?? "mejora";
if (!["mejora", "empeora", "reduce"].includes(caso)) throw new Error("--caso: mejora, empeora o reduce");
const url = (arg("--url") ?? "http://127.0.0.1:3015").replace(/\/$/, "");
const salida = path.resolve(arg("--salida") ?? "data/exp/e2e-aceptacion", `simulado-${caso}`);
mkdirSync(salida, { recursive: true });

const lectura = REFERENCIAS_DUENO.find((r) => r.numero === 7)!.lectura;
const completa: Escena = compilarLectura(lectura).escena;
const sinGuirnalda: Escena = { ...completa, nodos: completa.nodos.filter((n) => n.id !== "guirnalda-organica") };
const paredOscura: Escena = { ...completa, sala: { ...completa.sala, tonos: { ...completa.sala.tonos, paredes: "#3b2030" } } };
const [primera, ronda]: [Escena, Escena] = caso === "mejora" ? [sinGuirnalda, completa] : caso === "empeora" ? [completa, paredOscura] : [completa, sinGuirnalda];

const cambio = { herramienta: "cambiar_pieza", resumen: "Cambié la escena (simulado)", consulta: false };
const respuestaPrimera = { escena: primera, respuesta: "Armé la decoración de la foto (respuesta simulada).", acciones: [{ ...cambio, herramienta: "modelar_desde_foto" }], foto: { plantillas: [], notas: [], omitidas: [], aplicada: true, lectura, encuadre: encuadreDeLectura(lectura) }, uso: { pasos: 1, llamadas: 1, costeEstimadoUsd: 0 } };
const respuestaRonda = { escena: ronda, respuesta: "Corregí la escena para acercarla a la foto (ronda simulada).", acciones: [cambio], refinar: { ronda: 1, diferencias: [], significativas: 1, cambios: 1, terminar: true, motivo: "ultima_ronda" }, uso: { pasos: 1, llamadas: 1, costeEstimadoUsd: 0 } };

async function main() {
  const navegador = await chromium.launch({ headless: true });
  const pagina = await (await navegador.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const consola: string[] = [];
  pagina.on("pageerror", (e) => consola.push(`pageerror: ${e.message.slice(0, 300)}`));
  const similitudes: unknown[] = [];
  pagina.on("response", async (r) => { if (r.url().endsWith("/api/escena-ia/similitud")) similitudes.push({ estado: r.status(), ...(await r.json().catch(() => ({}))) }); });
  await pagina.route("**/api/escena-ia", async (ruta) => {
    const refinar = Boolean((JSON.parse(ruta.request().postData() ?? "{}") as { refinar?: unknown }).refinar);
    await ruta.fulfill({ json: refinar ? respuestaRonda : respuestaPrimera });
  });

  await pagina.goto(`${url}/3d`, { waitUntil: "load", timeout: 180_000 });
  await pagina.waitForSelector("#escena-ia-linea", { timeout: 120_000 });
  await pagina.setInputFiles('input[type="file"]', foto);
  await pagina.waitForSelector('img[alt="Foto adjunta"]', { timeout: 30_000 });
  await pagina.fill("#escena-ia-linea", "arma esta decoración de la foto en la pared del fondo");
  await pagina.press("#escena-ia-linea", "Enter");

  const botones: string[] = [];
  const inicio = Date.now();
  let primeraVista = false;
  while (Date.now() - inicio < 120_000) {
    await pagina.waitForTimeout(500);
    const t = await pagina.locator('button[aria-label="Enviar a la IA"]').innerText().catch(() => "");
    const barra = await pagina.locator('section[aria-label="Conversación con la IA"] p.text-taller-suave').first().innerText().catch(() => "");
    const estado = `${t} | ${barra.replace(/\s+/g, " ").trim()}`;
    if (botones[botones.length - 1] !== estado) { botones.push(estado); console.log(`[${Math.round((Date.now() - inicio) / 1000)} s] ${estado}`); }
    if (!primeraVista && /Foto 1\/1/.test(t)) { primeraVista = true; await pagina.waitForTimeout(300); await pagina.screenshot({ path: path.join(salida, "1-comparando.png") }); }
    if (t === "Pedir" && Date.now() - inicio > 6_000) { await pagina.waitForTimeout(1500); if (await pagina.locator('button[aria-label="Enviar a la IA"]').innerText().catch(() => "") === "Pedir") break; }
  }
  await pagina.locator('button[aria-label="Ver la conversación y los ejemplos"]').click({ timeout: 2000 }).catch(() => undefined);
  await pagina.screenshot({ path: path.join(salida, "2-despues.png") });
  const conversacion = (await pagina.locator('section[aria-label="Conversación con la IA"]').innerText().catch(() => "")).slice(0, 1800);
  const resumenPiezas = (await pagina.locator("body").innerText()).match(/\d+ piezas? · \d+ globos/)?.[0] ?? null;
  const puedeDeshacer = await pagina.getByText(/Deshacer lo de la IA/).count();
  await pagina.mouse.click(420, 160);
  await pagina.getByRole("button", { name: "Frente", exact: true }).click({ timeout: 2000 }).catch(() => undefined);
  await pagina.waitForTimeout(1500);
  await pagina.screenshot({ path: path.join(salida, "3-visor-frente.png") });
  const informe = { caso, botones, similitudes, resumenPiezas, puedeDeshacer, conversacion, consola };
  writeFileSync(path.join(salida, "resumen.json"), JSON.stringify(informe, null, 2));
  console.log(JSON.stringify(informe, null, 2));
  await navegador.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
