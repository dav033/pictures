import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { compararConCarpeta } from "../../../src/lib/eval/estructuras/analisis-carpeta";
import { dentroDe, SuiteSchema } from "../../../src/lib/eval/estructuras/cli-reconocimiento";
import { familiaDesdeClaseOficial } from "../../../src/lib/eval/estructuras/familia-clase";
import { leerPrediccionesJsonl, type PrediccionEstructurasV1 } from "../../../src/lib/eval/estructuras/prediccion";
import { flipRate } from "../../../src/lib/eval/estructuras/resumen-corrida";

/**
 * Combines runs of the same configuration, computes the folder comparison and
 * picks visual examples (one stable hit and the worst miss per class) rendered
 * as small thumbnails with boxes. Output goes to a private folder outside the
 * repository: the photos have no author permission.
 *
 *   npx tsx scripts/eval/estructuras/ejemplos-visuales.ts --dir <resultados> [--dir <resultados>] --raiz-imagenes <fotos> --salida <carpeta privada>
 * Each --dir holds suite.json (or suite-*.json), its etiquetas-carpeta file and predicciones.jsonl (directly or in subfolders).
 */

const argv = process.argv.slice(2);
const dirs = argv.flatMap((arg, i) => (arg === "--dir" ? [argv[i + 1]!] : []));
const valor = (nombre: string) => { const i = argv.indexOf(nombre); return i >= 0 ? argv[i + 1] : undefined; };
const raiz = valor("--raiz-imagenes");
const salida = valor("--salida");
if (!dirs.length || !raiz || !salida) throw new Error("uso: --dir <dir> [--dir <dir>] --raiz-imagenes <dir> --salida <dir privado>");
if (dentroDe(process.cwd(), salida)) throw new Error("--salida debe quedar fuera del repositorio");

const rutasPorSha = new Map<string, string>();
const etiquetas: Record<string, string> = {};
const lineas: PrediccionEstructurasV1[] = [];
const configs = new Set<string>();
for (const dir of dirs) {
  for (const nombre of ["suite.json", "suite-nuevas.json"]) {
    const ruta = resolve(dir, nombre);
    if (!existsSync(ruta)) continue;
    const suite = SuiteSchema.parse(JSON.parse(readFileSync(ruta, "utf8")));
    for (const item of suite.items) rutasPorSha.set(item.image_sha256, item.ruta_privada);
    const archivoEtiquetas = resolve(dir, `${suite.suite_id.replace(/-nuevas$/, "")}.etiquetas-carpeta.json`);
    if (existsSync(archivoEtiquetas)) Object.assign(etiquetas, (JSON.parse(readFileSync(archivoEtiquetas, "utf8")) as { etiquetas: Record<string, string> }).etiquetas);
  }
  for (const sub of ["", "low", "nuevas"]) {
    const ruta = resolve(dir, sub, "predicciones.jsonl");
    if (!existsSync(ruta)) continue;
    for (const linea of leerPrediccionesJsonl(readFileSync(ruta, "utf8"))) {
      configs.add(`${linea.sistema.config_hash}|${linea.sistema.thinking_level}`);
      lineas.push(linea);
    }
  }
}
if (configs.size !== 1) throw new Error(`las corridas combinadas tienen ${configs.size} configuraciones distintas; solo se combinan corridas de la misma configuración`);
const claves = new Set(lineas.map((l) => `${l.image_sha256}#${l.corrida}`));
if (claves.size !== lineas.length) throw new Error("hay líneas repetidas (misma imagen y corrida) entre las carpetas combinadas");

const area = (i: PrediccionEstructurasV1["instancias"][number]) => i.bbox.width * i.bbox.height;
const principal = (l: PrediccionEstructurasV1) => [...l.instancias].sort((a, b) => area(b) - area(a))[0];

async function miniatura(ruta: string, linea: PrediccionEstructurasV1, familia: string): Promise<string> {
  const base = sharp(readFileSync(ruta)).rotate();
  const meta = await base.metadata();
  const escala = Math.min(1, 520 / Math.max(meta.width ?? 520, meta.height ?? 520));
  const ancho = Math.round((meta.width ?? 520) * escala), alto = Math.round((meta.height ?? 520) * escala);
  const fuente = Math.max(13, Math.round(Math.min(ancho, alto) / 26));
  const mayor = principal(linea);
  const svg = linea.instancias.map((i) => {
    const x = i.bbox.x * ancho, y = i.bbox.y * alto, w = i.bbox.width * ancho, h = i.bbox.height * alto;
    const color = i.estado === "ambigua" ? "#eab308" : i.familia === familia ? "#22c55e" : "#f97316";
    const texto = `${i.familia ?? "ambigua"}${i.atributos_v1.outline === "asymmetric" ? " · asim" : ""}${i === mayor ? " ★" : ""}`;
    const anchoTexto = Math.min(ancho, Math.round(texto.length * fuente * 0.6) + 10);
    const xt = Math.max(0, Math.min(x, ancho - anchoTexto)), yt = Math.max(0, y - fuente - 6);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="4"/><rect x="${xt}" y="${yt}" width="${anchoTexto}" height="${fuente + 6}" fill="${color}"/><text x="${xt + 5}" y="${yt + fuente}" font-family="Arial" font-size="${fuente}" font-weight="700" fill="#111">${texto}</text>`;
  }).join("");
  const buffer = await base.resize(ancho, alto).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}">${svg}</svg>`), top: 0, left: 0 }]).jpeg({ quality: 68 }).toBuffer();
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

async function main() {
  const resumen = compararConCarpeta(lineas, etiquetas);
  const flip = flipRate(lineas);
  const porImagen = new Map<string, PrediccionEstructurasV1[]>();
  for (const l of lineas.filter((l) => l.resultado === "ok")) porImagen.set(l.image_sha256, [...(porImagen.get(l.image_sha256) ?? []), l].sort((a, b) => a.corrida - b.corrida));
  const candidatos = [...porImagen.entries()].map(([sha, ls]) => {
    const clase = etiquetas[sha]!;
    const familia = familiaDesdeClaseOficial(clase);
    const principales = ls.map((l) => principal(l)?.familia ?? principal(l)?.estado ?? "nada");
    return { sha, clase, familia, ls, principales, aciertos: principales.filter((p) => p === familia).length };
  }).filter((c) => rutasPorSha.has(c.sha));
  const ejemplos: Array<Record<string, unknown>> = [];
  for (const clase of [...new Set(candidatos.map((c) => c.clase))].sort()) {
    const deClase = candidatos.filter((c) => c.clase === clase).sort((a, b) => a.sha.localeCompare(b.sha));
    const acierto = deClase.find((c) => c.aciertos === c.ls.length);
    const fallo = [...deClase].sort((a, b) => a.aciertos / a.ls.length - b.aciertos / b.ls.length)[0];
    for (const [tipo, c] of [["acierto", acierto], ["fallo", fallo && fallo.aciertos < fallo.ls.length ? fallo : undefined]] as const) {
      if (!c) continue;
      const linea = c.ls.find((l) => (tipo === "fallo" ? principal(l)?.familia !== c.familia : true)) ?? c.ls[0]!;
      ejemplos.push({ tipo, clase, familia: c.familia, principales: c.principales, aciertos: c.aciertos, corridas: c.ls.length, instancias: linea.instancias.map((i) => ({ familia: i.familia, tipo: i.atributos_v1.structure_type, asim: i.atributos_v1.outline === "asymmetric" })), imagen: await miniatura(resolve(raiz!, rutasPorSha.get(c.sha)!), linea, c.familia) });
    }
  }
  const latencias = lineas.filter((l) => l.resultado === "ok").map((l) => l.latencia_ms.total).sort((a, b) => a - b);
  const pct = (q: number) => latencias[Math.min(latencias.length, Math.max(1, Math.ceil((q / 100) * latencias.length))) - 1];
  mkdirSync(salida!, { recursive: true });
  writeFileSync(resolve(salida!, "ejemplos.json"), JSON.stringify({ resumen, flip: { media: flip.media, imagenes: flip.imagenes_evaluadas }, latencia: { p50: pct(50), p95: pct(95), n: latencias.length }, lineas: lineas.length, ejemplos }, null, 1));
  console.log(`[ejemplos] ${lineas.length} líneas · ${resumen.imagenes} fotos · ${ejemplos.length} ejemplos · ${resolve(salida!, "ejemplos.json")}`);
}

main().catch((error: unknown) => { console.error(`[ejemplos] ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
