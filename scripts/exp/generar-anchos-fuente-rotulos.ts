/**
 * Genera `src/lib/globos3d/rotulos-fuente-anchos.ts`: lo que avanza cada carácter de la letra de los rótulos (Great Vibes, en
 * `public/fonts/`), en em. Con eso el taller calcula, sin lienzo (en Node, en una miniatura, en la frase para FLUX), de qué
 * proporción sale un texto y cómo partirlo en líneas. Se mide con Chromium sin cabeza, que es lo que dibuja la letra de verdad.
 *
 *   npx tsx scripts/exp/generar-anchos-fuente-rotulos.ts          (escribe el archivo)
 *   npx tsx scripts/exp/generar-anchos-fuente-rotulos.ts --medir  (compara la estimación con la tinta real de unos textos)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const FUENTE = "public/fonts/great-vibes-5.3.0-latin-400.woff2";
const SALIDA = "src/lib/globos3d/rotulos-fuente-anchos.ts";

const caracteres: string[] = [];
for (let c = 0x20; c <= 0x7e; c++) caracteres.push(String.fromCharCode(c));
for (let c = 0xa0; c <= 0xff; c++) caracteres.push(String.fromCharCode(c));

async function main() {
  const base64 = readFileSync(FUENTE).toString("base64");
  const navegador = await chromium.launch({ headless: true });
  const pagina = await navegador.newPage();
  await pagina.setContent("<body></body>");
  await pagina.evaluate("window.__name = (f) => f;");
  const resultado = await pagina.evaluate(async ({ base64, caracteres }) => {
    const cara = new FontFace("Great Vibes", `url(data:font/woff2;base64,${base64})`);
    await cara.load();
    document.fonts.add(cara);
    const lienzo = document.createElement("canvas");
    const p = lienzo.getContext("2d")!;
    p.font = '1000px "Great Vibes"';
    const anchos: Record<string, number> = {};
    for (const c of caracteres) anchos[c] = Math.round(p.measureText(c).width) / 1000;
    // La tinta real de unos textos, tal como los dibuja el visor (150 px, trazo de 0,035 em), para comparar con la estimación.
    const tinta = (lineas: string[]) => {
      const px = 150, paso = px * 1.3;
      const w = Math.ceil(Math.max(...lineas.map((l) => { p.font = `${px}px "Great Vibes"`; return p.measureText(l).width; })) + px * 1.2), h = Math.ceil(paso * lineas.length + px * 0.8);
      const l2 = document.createElement("canvas"); l2.width = w; l2.height = h;
      const q = l2.getContext("2d", { willReadFrequently: true })!;
      q.font = `${px}px "Great Vibes"`; q.textAlign = "center"; q.textBaseline = "middle"; q.lineJoin = "round"; q.lineWidth = px * 0.035;
      lineas.forEach((l, i) => { const y = px * 0.4 + paso * (i + 0.5); q.strokeText(l, w / 2, y); q.fillText(l, w / 2, y); });
      const d = q.getImageData(0, 0, w, h).data;
      let x0 = w, x1 = -1, y0 = h, y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3]! > 110) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      return { ancho: (x1 - x0 + 1) / px, alto: (y1 - y0 + 1) / px };
    };
    const muestras = [["Isabella"], ["David"], ["David y Dayan"], ["Let's Party"], ["Mia 15"], ["David", "y", "Dayan"], ["Let's", "Party"], ["Sofia", "Valentina"], ["Eee"], ["Aqui"]];
    return { anchos, muestras: muestras.map((m) => ({ m, ...tinta(m) })) };
  }, { base64, caracteres });
  await navegador.close();

  if (process.argv.includes("--medir")) {
    for (const { m, ancho, alto } of resultado.muestras) {
      const estimado = Math.max(...m.map((l) => [...l].reduce((s, c) => s + (resultado.anchos[c] ?? 0.4), 0)));
      console.log(m.join(" / ").padEnd(22), "tinta", ancho.toFixed(2), "x", alto.toFixed(2), "em · avance", estimado.toFixed(2), "em · ancho/avance", (ancho / estimado).toFixed(2), "· alto por línea", (alto / m.length).toFixed(2));
    }
    return;
  }
  const filas = caracteres.map((c) => `  ${JSON.stringify(c)}: ${resultado.anchos[c]}`);
  writeFileSync(SALIDA, `/**
 * Lo que avanza cada carácter de la letra de los rótulos (Great Vibes, latín de \`public/fonts/\`), en em. Generado por
 * \`scripts/exp/generar-anchos-fuente-rotulos.ts\` (no se edita a mano): sirve para estimar la proporción de un texto sin lienzo.
 */
export const ANCHOS_FUENTE_EM: Readonly<Record<string, number>> = {
${filas.join(",\n")},
};
`);
  console.log("escrito", SALIDA, caracteres.length, "caracteres");
}
main().catch((e) => { console.error(e); process.exit(1); });
