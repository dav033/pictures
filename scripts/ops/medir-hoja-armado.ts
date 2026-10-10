/**
 * Mide en un navegador real lo que ocupa cada página de la hoja de armado y la imprime a PDF, en Carta y en A4, para
 * comprobar la estimación de `hoja-armado-paginas.ts` (la que reparte la hoja en páginas) contra el papel de verdad:
 *  - el alto de cada página con la emulación de impresión (falla si alguna no cabe: Carta 255 mm útiles con márgenes de
 *    12 mm, A4 273 mm) y la peor subestimación de la estimación;
 *  - las hojas de papel del PDF de cada escena: tienen que ser tantas como páginas de la hoja (si una página no cabe, el
 *    navegador la parte y salen más). Esta es la comprobación que no depende de la estimación.
 *
 * Pinta todas las escenas de la biblioteca de fábrica y los presets (o una de cada N) con el mismo componente de la hoja
 * (`HojaImprimible`), el CSS de la app (`globals.css` compilado con Tailwind, con sus reglas de impresión) y las letras de la
 * app: Geist y Geist Mono (las de `next/font/google` en `layout.tsx`), descargadas de Google Fonts y metidas en el CSS; si no
 * cargan, el script falla en lugar de medir con otra letra. Sin llamadas pagadas ni servidor. No forma parte de las pruebas
 * rápidas.
 *
 * Uso: NODE_OPTIONS=--use-system-ca npx tsx scripts/ops/medir-hoja-armado.ts [--cada 1]
 * Sin el Chromium de Playwright instalado: PLAYWRIGHT_CHROMIUM_EXECUTABLE=/ruta/a/chrome.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Page } from "playwright";
import { armarEscena, type Escena } from "../../src/lib/globos3d/escena";
import { BIBLIOTECA_FABRICA, escenaDeItem } from "../../src/lib/globos3d/biblioteca";
import { ESCENAS_PREDEFINIDAS } from "../../src/lib/globos3d/escenas-presets";
import { hojaDeEscena, paginasDeHoja } from "../../src/lib/globos3d/hoja-armado";
import { altoDePagina, PAGINA_MM } from "../../src/lib/globos3d/hoja-armado-paginas";
import { HojaImprimible } from "../../src/components/tres-d/HojaArmadoEscena";

const RAIZ = path.resolve(__dirname, "..", "..");
const indiceCada = process.argv.indexOf("--cada");
const CADA = Math.max(1, Number(indiceCada >= 0 ? process.argv[indiceCada + 1] : 1) || 1);

/** Papel con márgenes de 12 mm (`@page` de `globals.css`): ancho y alto útiles en mm. */
const PAPELES = [
  { nombre: "Carta", formato: "Letter", anchoMm: 216 - 24, altoMm: 279 - 24 },
  { nombre: "A4", formato: "A4", anchoMm: 210 - 24, altoMm: 297 - 24 },
] as const;
const MARGEN = { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" };
const PX_POR_MM = 96 / 25.4;
const GOOGLE_FONTS = "https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=block";
/** Google Fonts sirve woff2 según el navegador que pide. */
const AGENTE_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

type Pintada = { id: string; html: string; estimados: number[] };

function escenasAPintar(): Array<{ id: string; nombre: string; escena: Escena }> {
  const salida: Array<{ id: string; nombre: string; escena: Escena }> = [];
  BIBLIOTECA_FABRICA.filter((i) => i.contenido.tipo === "escena" || i.contenido.tipo === "conjunto").forEach((item, k) => {
    if (k % CADA === 0) salida.push({ id: item.id, nombre: item.nombre ?? item.id, escena: escenaDeItem(item) });
  });
  for (const p of ESCENAS_PREDEFINIDAS) salida.push({ id: `preset:${p.id}`, nombre: p.nombre, escena: p.escena });
  return salida;
}

/** La hoja de cada escena como la imprime la app (dentro de la caja del diálogo, que al imprimir pierde su tamaño y su relleno). */
function pintarHojas(): Pintada[] {
  return escenasAPintar().map(({ id, nombre, escena }) => {
    const hoja = hojaDeEscena(nombre, escena, armarEscena(escena));
    const estimados = paginasDeHoja(hoja).map(altoDePagina);
    const html = `<div class="hoja-armado-dialogo"><div class="hoja-armado-scroll">${renderToStaticMarkup(createElement(HojaImprimible, { hoja }))}</div></div>`;
    return { id, html, estimados };
  });
}

/** Geist y Geist Mono de Google Fonts, con cada archivo metido en el CSS (sin red al medir), y las variables de `next/font`. */
async function letrasGeist(): Promise<string> {
  const respuesta = await fetch(GOOGLE_FONTS, { headers: { "user-agent": AGENTE_CHROME } });
  if (!respuesta.ok) throw new Error(`Google Fonts respondió ${respuesta.status}.`);
  let css = await respuesta.text();
  const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)\s]+/g) ?? [])];
  if (!urls.length) throw new Error("Google Fonts no devolvió los archivos de Geist.");
  for (const url of urls) {
    const archivo = await fetch(url);
    if (!archivo.ok) throw new Error(`No se pudo bajar ${url} (${archivo.status}).`);
    css = css.split(url).join(`data:font/woff2;base64,${Buffer.from(await archivo.arrayBuffer()).toString("base64")}`);
  }
  return `${css}\n:root{--font-geist-sans:"Geist",ui-sans-serif,system-ui,sans-serif;--font-geist-mono:"Geist Mono",ui-monospace,monospace}`;
}

async function cssDeLaApp(): Promise<string> {
  const globals = path.join(RAIZ, "src", "app", "globals.css");
  return (await postcss([tailwind({ base: RAIZ })]).process(readFileSync(globals, "utf8"), { from: globals })).css;
}

/** Pone el cuerpo y espera a que Geist esté cargada de verdad (si no, la medida no vale). */
async function pintar(pagina: Page, cuerpo: string): Promise<void> {
  await pagina.evaluate((html) => { document.body.innerHTML = html; }, cuerpo);
  const familias = await pagina.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, ""));
  });
  for (const familia of ["Geist", "Geist Mono"]) if (!familias.includes(familia)) throw new Error(`La letra ${familia} no cargó: la medida no sería la de la app.`);
}

async function medirAltos(pagina: Page, pintadas: readonly Pintada[], anchoMm: number): Promise<Array<{ id: string; n: number; mm: number; estimado: number }>> {
  await pintar(pagina, pintadas.map((p) => `<div class="escena" data-id="${p.id}" style="width:${anchoMm}mm;margin:0 0 20px 0">${p.html}</div>`).join(""));
  const reales: Array<{ id: string; n: number; mm: number }> = await pagina.evaluate((pxPorMm) => [...document.querySelectorAll<HTMLElement>(".escena")].flatMap((escena) => {
    const raiz = escena.querySelector<HTMLElement>(".hoja-armado-scroll > div")!;
    const arriba = raiz.getBoundingClientRect().top;
    return [...raiz.querySelectorAll<HTMLElement>(":scope > [data-pagina]")].map((p, i) => {
      const caja = p.getBoundingClientRect();
      return { id: escena.dataset.id ?? "", n: i + 1, mm: (i === 0 ? caja.bottom - arriba : caja.height) / pxPorMm };
    });
  }), PX_POR_MM);
  const estimados = pintadas.flatMap((p) => p.estimados);
  return reales.map((r, k) => ({ ...r, estimado: estimados[k] ?? 0 }));
}

/** Las hojas de papel del PDF de cada escena, impresa sola. */
async function contarHojasDePapel(pagina: Page, pintadas: readonly Pintada[], formato: "Letter" | "A4"): Promise<Array<{ id: string; hojas: number; paginas: number }>> {
  const salida: Array<{ id: string; hojas: number; paginas: number }> = [];
  for (const p of pintadas) {
    await pintar(pagina, p.html);
    const pdf = await pagina.pdf({ format: formato, margin: MARGEN, printBackground: true });
    salida.push({ id: p.id, hojas: (pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length, paginas: p.estimados.length });
  }
  return salida;
}

async function main(): Promise<void> {
  const [pintadas, css, letras] = [pintarHojas(), await cssDeLaApp(), await letrasGeist()];
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim() || undefined;
  const navegador = await chromium.launch({ executablePath, args: ["--disable-gpu", "--disable-dev-shm-usage"] });
  let fallos = 0;
  try {
    const pagina = await navegador.newPage({ viewport: { width: 1000, height: 1200 } });
    await pagina.setContent(`<!doctype html><html lang="es"><head><meta charset="utf-8"><style>${letras}</style><style>${css}</style></head><body class="flex min-h-dvh flex-col font-sans"></body></html>`);
    // Con la emulación de impresión: las reglas `@media print` cuentan al medir, y `page.pdf()` imprime con ellas.
    await pagina.emulateMedia({ media: "print" });
    for (const papel of PAPELES) {
      const medidas = await medirAltos(pagina, pintadas, papel.anchoMm);
      const exceden = medidas.filter((m) => m.mm > papel.altoMm);
      const peores = [...medidas].sort((a, b) => b.mm - b.estimado - (a.mm - a.estimado)).slice(0, 5);
      const holgura = papel.altoMm - PAGINA_MM - (peores[0]!.mm - peores[0]!.estimado);
      console.log(`${papel.nombre}: ${pintadas.length} escenas, ${medidas.length} páginas; no caben ${exceden.length}; mayor ${Math.max(...medidas.map((m) => m.mm)).toFixed(0)} mm de ${papel.altoMm}; holgura en el peor caso ${holgura.toFixed(1)} mm (PAGINA_MM ${PAGINA_MM})`);
      for (const m of peores) console.log(`  subestima ${(m.mm - m.estimado).toFixed(1)} mm: ${m.id} (página ${m.n}) mide ${m.mm.toFixed(0)} mm, estimado ${m.estimado.toFixed(0)}`);
      for (const m of exceden.slice(0, 8)) console.log(`  no cabe: ${m.id} (página ${m.n}) mide ${m.mm.toFixed(0)} mm, estimado ${m.estimado.toFixed(0)}`);
      const papelReal = await contarHojasDePapel(pagina, pintadas, papel.formato);
      const distintas = papelReal.filter((x) => x.hojas !== x.paginas);
      console.log(`${papel.nombre} en PDF: ${papelReal.reduce((s, x) => s + x.hojas, 0)} hojas de papel para ${papelReal.reduce((s, x) => s + x.paginas, 0)} páginas; ${distintas.length} escenas no cuadran`);
      for (const x of distintas.slice(0, 8)) console.log(`  no cuadra: ${x.id}: ${x.hojas} hojas de papel, ${x.paginas} páginas`);
      fallos += exceden.length + distintas.length;
    }
  } finally {
    await navegador.close();
  }
  if (fallos > 0) process.exitCode = 1;
}

void main();
