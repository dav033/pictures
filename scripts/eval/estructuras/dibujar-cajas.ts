import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { dentroDe, SuiteSchema } from "../../../src/lib/eval/estructuras/cli-reconocimiento";
import { familiaDesdeClaseOficial } from "../../../src/lib/eval/estructuras/familia-clase";
import { leerPrediccionesJsonl, type PrediccionEstructurasV1 } from "../../../src/lib/eval/estructuras/prediccion";

/**
 * Draws the recognizer boxes over the evaluated photos and writes a local HTML
 * gallery (errors first). Output must stay outside the repository: the photos
 * are private. One overlay per image and configuration, from its first run.
 *
 *   npx tsx scripts/eval/estructuras/dibujar-cajas.ts --corrida <dir resultados> --raiz-imagenes <carpeta fotos> --salida <carpeta privada>
 */

const argv = process.argv.slice(2);
const valor = (nombre: string) => { const i = argv.indexOf(nombre); return i >= 0 ? argv[i + 1] : undefined; };
const corrida = valor("--corrida");
const raiz = valor("--raiz-imagenes");
const salida = valor("--salida");
if (!corrida || !raiz || !salida) throw new Error("uso: --corrida <dir> --raiz-imagenes <dir> --salida <dir privado>");
if (dentroDe(process.cwd(), salida)) throw new Error("--salida debe quedar fuera del repositorio: las fotos son privadas");

const suite = SuiteSchema.parse(JSON.parse(readFileSync(resolve(corrida, "suite.json"), "utf8")));
const etiquetasArchivo = resolve(corrida, `${suite.suite_id}.etiquetas-carpeta.json`);
const { etiquetas } = JSON.parse(readFileSync(etiquetasArchivo, "utf8")) as { etiquetas: Record<string, string> };
const configuraciones = ["low", "default"].filter((c) => existsSync(resolve(corrida, c, "predicciones.jsonl")));
const porConfig = Object.fromEntries(configuraciones.map((c) => [c, leerPrediccionesJsonl(readFileSync(resolve(corrida, c, "predicciones.jsonl"), "utf8"))]));

const COLOR = { ok: "#22c55e", otra: "#f97316", ambigua: "#eab308" } as const;
const escapar = (texto: string) => texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const area = (i: PrediccionEstructurasV1["instancias"][number]) => i.bbox.width * i.bbox.height;

async function dibujar(ruta: string, linea: PrediccionEstructurasV1, familiaCarpeta: string, destino: string) {
  const imagen = sharp(readFileSync(ruta)).rotate();
  const meta = await imagen.metadata();
  const escala = Math.min(1, 900 / Math.max(meta.width ?? 900, meta.height ?? 900));
  const ancho = Math.round((meta.width ?? 900) * escala);
  const alto = Math.round((meta.height ?? 900) * escala);
  const grosor = Math.max(3, Math.round(Math.min(ancho, alto) / 160));
  const fuente = Math.max(14, Math.round(Math.min(ancho, alto) / 32));
  const principal = [...linea.instancias].sort((a, b) => area(b) - area(a))[0];
  const cajas = linea.instancias.map((instancia) => {
    const x = instancia.bbox.x * ancho, y = instancia.bbox.y * alto, w = instancia.bbox.width * ancho, h = instancia.bbox.height * alto;
    const color = instancia.estado === "ambigua" ? COLOR.ambigua : instancia.familia === familiaCarpeta ? COLOR.ok : COLOR.otra;
    const texto = `${instancia.familia ?? `ambigua(${instancia.candidatos.join("|")})`} · ${instancia.atributos_v1.structure_type}${instancia.atributos_v1.outline === "asymmetric" ? " · asim" : ""}${instancia === principal ? " ★" : ""}`;
    const anchoTexto = Math.min(ancho, Math.round(texto.length * fuente * 0.58) + 12);
    const yTexto = Math.max(0, y - fuente - 8);
    // Keep the label inside the image when the box touches the right edge.
    const xTexto = Math.max(0, Math.min(x, ancho - anchoTexto));
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="${grosor}"/>`
      + `<rect x="${xTexto}" y="${yTexto}" width="${anchoTexto}" height="${fuente + 8}" fill="${color}"/>`
      + `<text x="${xTexto + 6}" y="${yTexto + fuente}" font-family="Arial, sans-serif" font-size="${fuente}" font-weight="700" fill="#111">${escapar(texto)}</text>`;
  }).join("");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}">${cajas}</svg>`);
  await imagen.resize(ancho, alto).composite([{ input: svg, top: 0, left: 0 }]).jpeg({ quality: 85 }).toFile(destino);
}

async function main() {
  mkdirSync(resolve(salida!, "img"), { recursive: true });
  const filas: Array<{ html: string; error: boolean; clase: string }> = [];
  for (const item of suite.items) {
    const clase = etiquetas[item.image_sha256]!;
    const familia = familiaDesdeClaseOficial(clase);
    const celdas: string[] = [];
    let error = false;
    for (const config of configuraciones) {
      const lineas = porConfig[config]!.filter((l) => l.image_sha256 === item.image_sha256 && l.resultado === "ok").sort((a, b) => a.corrida - b.corrida);
      const primera = lineas[0];
      if (!primera) { celdas.push(`<div class="celda"><p>${config}: sin corrida ok</p></div>`); continue; }
      const principales = lineas.map((l) => [...l.instancias].sort((a, b) => area(b) - area(a))[0]?.familia ?? "nada");
      const aciertos = principales.filter((p) => p === familia).length;
      if (aciertos < lineas.length) error = true;
      const nombre = `${item.image_sha256.slice(0, 16)}-${config}.jpg`;
      await dibujar(resolve(raiz!, item.ruta_privada), primera, familia, resolve(salida!, "img", nombre));
      celdas.push(`<div class="celda"><img src="img/${nombre}" loading="lazy" alt=""><p><b>${config}</b> · principal por corrida: ${principales.map((p) => `<span class="${p === familia ? "si" : "no"}">${p}</span>`).join(" ")} · ${aciertos}/${lineas.length}</p></div>`);
    }
    filas.push({ error, clase, html: `<section class="${error ? "err" : ""}"><h2>${clase} <small>${escapar(item.ruta_privada)}</small>${error ? ' <em>error o inestable</em>' : ""}</h2><div class="par">${celdas.join("")}</div></section>` });
  }
  filas.sort((a, b) => Number(b.error) - Number(a.error) || a.clase.localeCompare(b.clase));
  const errores = filas.filter((f) => f.error).length;
  writeFileSync(resolve(salida!, "index.html"), `<!doctype html><meta charset="utf-8"><title>Cajas del reconocedor · ${suite.suite_id}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:20px;background:#111;color:#eee}h1{margin:0 0 6px}section{border-top:1px solid #333;padding:14px 0}section.err h2 em{color:#f97316;font-style:normal}h2{font-size:17px;margin:0 0 8px}h2 small{color:#999;font-weight:400}.par{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}.celda img{width:100%;border-radius:4px}.celda p{margin:4px 0 0;color:#bbb}.si{color:#22c55e}.no{color:#f97316}.ley span{margin-right:14px}</style>
<h1>Cajas del reconocedor</h1><p>${suite.items.length} fotos · ${errores} con algún error de familia principal o inestables (arriba) · cada imagen muestra la corrida 1.</p>
<p class="ley"><span style="color:#22c55e">■ misma familia que la carpeta</span><span style="color:#f97316">■ otra familia</span><span style="color:#eab308">■ ambigua</span><span>★ pieza principal (mayor área) · asim = silueta asimétrica</span></p>
${filas.map((f) => f.html).join("\n")}`);
  console.log(`[cajas] ${suite.items.length} fotos · ${errores} con error o inestables · ${resolve(salida!, "index.html")}`);
}

main().catch((error: unknown) => { console.error(`[cajas] ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
