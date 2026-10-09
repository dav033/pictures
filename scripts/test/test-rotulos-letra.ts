/**
 * La letra de los rótulos DE VERDAD (Great Vibes, `public/fonts/`) dibujada por Chromium sin cabeza con el código del taller: se
 * empaqueta `rotulo-visor.ts` + `fuente-rotulos.ts` con esbuild (ya está: lo usa tsx) y corre en una página. Sin red: la letra se sirve
 * del disco. Lo que prueba:
 * - antes de cargar la letra no se dibuja con otra: el texto queda «pendiente» y el visor pone una marca gris;
 * - cargada, el texto sale con la proporción que estima el taller sin lienzo (`aspectoEstimado`, 14 % o menos de diferencia) y cada
 *   texto cuesta pocos triángulos (la cifra queda en la salida);
 * - si la letra falla (404) no hay letra de reemplazo: estado «fallo», marca roja, aviso en la consola, el texto no se rasteriza.
 *
 *   npx tsx scripts/test/test-rotulos-letra.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { aspectoEstimado } from "../../src/lib/globos3d/rotulos";

const RAIZ = resolve(__dirname, "../..");
const FUENTE = join(RAIZ, "public/fonts/great-vibes-5.3.0-latin-400.woff2");
const TEXTOS = ["Isabella", "David y Dayan", "Let's Party", "Mia 15", "David\ny\nDayan", "Let's\nParty", "Feliz cumple\nValentina"];

type Medida = { texto: string; aspecto: number; triangulos: number; ms: number };

async function empaquetar(): Promise<string> {
  const carpeta = mkdtempSync(join(tmpdir(), "rotulos-letra-"));
  const entrada = join(carpeta, "entrada.ts");
  writeFileSync(entrada, `export * from ${JSON.stringify(join(RAIZ, "src/components/tres-d/rotulo-visor"))};\nexport * from ${JSON.stringify(join(RAIZ, "src/components/tres-d/fuente-rotulos"))};\n`);
  try {
    const r = await build({ entryPoints: [entrada], bundle: true, write: false, format: "iife", globalName: "Rot", platform: "browser", alias: { "@": join(RAIZ, "src") }, nodePaths: [join(RAIZ, "node_modules")], logLevel: "silent" });
    return r.outputFiles[0]!.text;
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
}

/** Una página con el código del taller y la letra servida del disco (o con 404 si `sinLetra`). */
async function abrir(navegador: Awaited<ReturnType<typeof chromium.launch>>, codigo: string, sinLetra: boolean | "una-vez"): Promise<{ pagina: Page; consola: string[] }> {
  const pagina = await navegador.newPage();
  const consola: string[] = [];
  pagina.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") consola.push(m.text()); });
  let fallosPendientes = sinLetra === "una-vez" ? 1 : 0;
  await pagina.route("http://rotulos.test/**", (ruta) => {
    const url = new URL(ruta.request().url());
    if (url.pathname === "/") return ruta.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><body></body>" });
    if (url.pathname === "/fonts/great-vibes-5.3.0-latin-400.woff2" && sinLetra !== true && fallosPendientes-- <= 0) return ruta.fulfill({ status: 200, contentType: "font/woff2", body: readFileSync(FUENTE) });
    return ruta.fulfill({ status: 404, body: "no" });
  });
  await pagina.goto("http://rotulos.test/");
  await pagina.evaluate("window.__name = (f) => f;");
  await pagina.addScriptTag({ content: codigo });
  return { pagina, consola };
}

async function main() {
  const codigo = await empaquetar();
  const navegador = await chromium.launch({ headless: true });
  try {
    // ---- con la letra
    const { pagina } = await abrir(navegador, codigo, false);
    const antes = await pagina.evaluate((textos) => {
      const R = (window as unknown as { Rot: { estadoFuenteRotulos: () => string; rasterizarTexto: (t: string) => unknown } }).Rot;
      return { estado: R.estadoFuenteRotulos(), rasteriza: R.rasterizarTexto(textos[0]!) };
    }, TEXTOS);
    assert.equal(antes.rasteriza, "pendiente", "antes de cargar la letra el texto queda pendiente: no se dibuja con otra");
    assert.ok(antes.estado === "pendiente" || antes.estado === "cargando", antes.estado);

    const medidas: Medida[] = await pagina.evaluate(async (textos) => {
      const R = (window as unknown as { Rot: { cargarFuenteRotulos: () => Promise<boolean>; rasterizarTexto: (t: string) => { ancho: number; alto: number } | string | null; crearRotulosVisor: (e: () => unknown, o: object) => { malla: (s: unknown) => { geometry: { index: { count: number } | null; attributes: { position: { count: number } } } } | null; liberar: () => void } } }).Rot;
      if (!(await R.cargarFuenteRotulos())) throw new Error("la letra no cargó");
      const visor = R.crearRotulosVisor(() => null, {});
      return textos.map((texto) => {
        const t0 = performance.now();
        const m = R.rasterizarTexto(texto);
        if (typeof m !== "object" || m === null) throw new Error(`sin tinta: ${texto}`);
        const solido = { forma: "caja", tamano: { x: 200, y: 200, z: 2 }, hex: "#ffffff", acabado: "mate", rotulo: { texto, color: "#000000", acabado: "vinilo", altoCm: 40, yCm: 100 } };
        const malla = visor.malla(solido)!;
        const g = malla.geometry;
        return { texto, aspecto: m.ancho / m.alto, triangulos: (g.index ? g.index.count : g.attributes.position.count) / 3, ms: Math.round(performance.now() - t0) };
      });
    }, TEXTOS);
    for (const m of medidas) {
      const estimado = aspectoEstimado(m.texto);
      const diferencia = Math.abs(m.aspecto - estimado) / m.aspecto;
      console.log(`  ${JSON.stringify(m.texto).padEnd(28)} proporción ${m.aspecto.toFixed(2)} (estimada ${estimado.toFixed(2)}, ${(diferencia * 100).toFixed(1)} %) · ${m.triangulos} triángulos · ${m.ms} ms`);
      assert.ok(diferencia <= 0.14, `la estimación sin lienzo de ${JSON.stringify(m.texto)} se aparta ${(diferencia * 100).toFixed(1)} %`);
      assert.ok(m.triangulos > 100 && m.triangulos < 12000, `${m.triangulos} triángulos`);
    }
    console.log("  ✓ con la letra cargada: proporciones estimadas y triángulos por texto");

    // ---- el visor avisa (una vez) cuando la letra llega, para rehacer lo que dibujó como marca
    const pagina2 = await abrir(navegador, codigo, false);
    const aviso = await pagina2.pagina.evaluate(async () => {
      const R = (window as unknown as { Rot: { cargarFuenteRotulos: () => Promise<boolean>; crearRotulosVisor: (e: () => unknown, o: object) => { malla: (s: unknown) => { geometry: { type: string } } | null } } }).Rot;
      let avisos = 0;
      const visor = R.crearRotulosVisor(() => null, { alFuenteLista: () => { avisos++; } });
      const solido = { forma: "caja", tamano: { x: 200, y: 200, z: 2 }, hex: "#ffffff", acabado: "mate", rotulo: { texto: "Ana", color: "#000000", acabado: "vinilo", altoCm: 40, yCm: 100 } };
      const antes = visor.malla(solido)!.geometry.type;
      visor.malla(solido);
      await R.cargarFuenteRotulos();
      await new Promise((r) => setTimeout(r, 50));
      return { antes, avisos, despues: visor.malla(solido)!.geometry.type };
    });
    assert.equal(aviso.antes, "BoxGeometry", "antes de que llegue la letra: una marca");
    assert.equal(aviso.avisos, 1, "el visor avisa una sola vez que la letra llegó");
    assert.notEqual(aviso.despues, "BoxGeometry", "y con la letra ya dibuja las letras");

    // ---- sin la letra: no hay letra de reemplazo
    const falla = await abrir(navegador, codigo, true);
    const resultado = await falla.pagina.evaluate(async () => {
      const R = (window as unknown as { Rot: { cargarFuenteRotulos: () => Promise<boolean>; estadoFuenteRotulos: () => string; rasterizarTexto: (t: string) => unknown; crearRotulosVisor: (e: () => unknown, o: object) => { malla: (s: unknown) => { geometry: { type: string }; material: { color: { getHex: () => number } } } | null } } }).Rot;
      const cargo = await R.cargarFuenteRotulos();
      const visor = R.crearRotulosVisor(() => null, {});
      const solido = { forma: "caja", tamano: { x: 200, y: 200, z: 2 }, hex: "#ffffff", acabado: "mate", rotulo: { texto: "Ana", color: "#000000", acabado: "vinilo", altoCm: 40, yCm: 100 } };
      const marca = visor.malla(solido);
      return { cargo, estado: R.estadoFuenteRotulos(), tinta: R.rasterizarTexto("Ana"), geometria: marca?.geometry.type, color: marca?.material.color.getHex() };
    });
    assert.equal(resultado.cargo, false);
    assert.equal(resultado.estado, "fallo");
    assert.equal(resultado.tinta, null, "no se rasteriza el texto con la letra del sistema");
    assert.equal(resultado.geometria, "BoxGeometry", "en su lugar, una marca");
    assert.equal(resultado.color, 0xd94b4b, "roja");
    assert.ok(falla.consola.some((l) => l.includes("[rótulos]")), `avisa en la consola: ${falla.consola.join(" | ")}`);
    console.log("  ✓ sin la letra: marca roja y aviso, nunca otra letra");

    // ---- un fallo no se recuerda: la captura para la IA para con un error y, al volver la red, la siguiente sale bien
    const una = await abrir(navegador, codigo, "una-vez");
    const reintento = await una.pagina.evaluate(async () => {
      const R = (window as unknown as { Rot: { exigirLetraDeRotulos: (s: object[]) => Promise<void>; estadoFuenteRotulos: () => string; prepararRotulos: (s: object[]) => Promise<boolean> } }).Rot;
      const conRotulo = [{ rotulo: { texto: "Ana" } }], neon = [{ motivo: { estilo: "neon" } }];
      const sinNada = await R.prepararRotulos([{}]);
      let error = "";
      try { await R.exigirLetraDeRotulos(conRotulo); } catch (e) { error = e instanceof Error ? e.message : String(e); }
      const estadoTrasFallo = R.estadoFuenteRotulos();
      await R.exigirLetraDeRotulos(neon);
      return { sinNada, error, estadoTrasFallo, estadoFinal: R.estadoFuenteRotulos() };
    });
    assert.equal(reintento.sinNada, true, "sin rótulos no hace falta la letra");
    assert.match(reintento.error, /No se pudo cargar la letra de los rótulos/, "la captura falla con un error claro, no con una marca roja");
    assert.equal(reintento.estadoTrasFallo, "fallo");
    assert.equal(reintento.estadoFinal, "lista", "el fallo no se recuerda: el siguiente intento carga (y un letrero de neón también la pide)");
    console.log("  ✓ un fallo no dura hasta recargar: la captura para con error y el siguiente intento carga la letra");
    console.log("test-rotulos-letra: ok");
  } finally {
    await navegador.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
