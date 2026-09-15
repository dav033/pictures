import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { compararConCarpeta } from "../../../src/lib/eval/estructuras/analisis-carpeta";
import { dentroDe, SuiteSchema } from "../../../src/lib/eval/estructuras/cli-reconocimiento";
import { familiaDesdeClaseOficial } from "../../../src/lib/eval/estructuras/familia-clase";
import { leerPrediccionesJsonl, type PrediccionEstructurasV1 } from "../../../src/lib/eval/estructuras/prediccion";

/**
 * Paired comparison of a base configuration against a candidate on the same
 * photos and the same number of runs per photo, with before/after thumbnails of
 * fixes and regressions. Output stays in a private folder outside the repo.
 *
 *   npx tsx scripts/eval/estructuras/comparar-variantes.ts --suite <suite.json> --etiquetas <json> --base <predicciones.jsonl> [--base ...] --candidata <predicciones.jsonl> --corridas 2 --raiz-imagenes <fotos> --salida <carpeta privada>
 */

const argv = process.argv.slice(2);
const todos = (nombre: string) => argv.flatMap((arg, i) => (arg === nombre ? [argv[i + 1]!] : []));
const valor = (nombre: string) => todos(nombre)[0];
const [rutaSuite, rutaEtiquetas, rutaCandidata, raiz, salida] = ["--suite", "--etiquetas", "--candidata", "--raiz-imagenes", "--salida"].map(valor);
const corridas = Number(valor("--corridas") ?? 2);
if (!rutaSuite || !rutaEtiquetas || !rutaCandidata || !raiz || !salida || !todos("--base").length) throw new Error("faltan argumentos");
if (dentroDe(process.cwd(), salida)) throw new Error("--salida debe quedar fuera del repositorio");

const suite = SuiteSchema.parse(JSON.parse(readFileSync(rutaSuite, "utf8")));
const { etiquetas } = JSON.parse(readFileSync(rutaEtiquetas, "utf8")) as { etiquetas: Record<string, string> };
const enSuite = new Set(suite.items.map((i) => i.image_sha256));
const leer = (ruta: string) => leerPrediccionesJsonl(readFileSync(ruta, "utf8")).filter((l) => enSuite.has(l.image_sha256) && l.corrida <= corridas);
const base = todos("--base").filter(existsSync).flatMap(leer);
const candidata = leer(rutaCandidata);
const unico = (ls: PrediccionEstructurasV1[]) => new Set(ls.map((l) => `${l.sistema.system_prompt_sha256}|${l.sistema.thinking_level}|${l.sistema.modelo}`));
if (unico(base).size !== 1 || unico(candidata).size !== 1) throw new Error("cada lado debe tener una sola configuración");

const area = (i: PrediccionEstructurasV1["instancias"][number]) => i.bbox.width * i.bbox.height;
const principal = (l: PrediccionEstructurasV1) => [...l.instancias].sort((a, b) => area(b) - area(a))[0];
const nombrePrincipal = (l: PrediccionEstructurasV1) => principal(l)?.familia ?? (principal(l) ? "ambigua" : "nada");

async function miniatura(item: { ruta_privada: string }, linea: PrediccionEstructurasV1 | undefined, familia: string) {
  if (!linea) return null;
  const img = sharp(readFileSync(resolve(raiz!, item.ruta_privada))).rotate();
  const meta = await img.metadata();
  const escala = Math.min(1, 440 / Math.max(meta.width ?? 440, meta.height ?? 440));
  const w = Math.round((meta.width ?? 440) * escala), h = Math.round((meta.height ?? 440) * escala);
  const fuente = Math.max(12, Math.round(Math.min(w, h) / 24));
  const mayor = principal(linea);
  const svg = linea.instancias.map((i) => {
    const x = i.bbox.x * w, y = i.bbox.y * h, bw = i.bbox.width * w, bh = i.bbox.height * h;
    const color = i.estado === "ambigua" ? "#eab308" : i.familia === familia ? "#22c55e" : "#f97316";
    const texto = `${i.familia ?? "ambigua"}${i === mayor ? " ★" : ""}`;
    const tw = Math.min(w, Math.round(texto.length * fuente * 0.62) + 10);
    const tx = Math.max(0, Math.min(x, w - tw)), ty = Math.max(0, y - fuente - 6);
    return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="none" stroke="${color}" stroke-width="4"/><rect x="${tx}" y="${ty}" width="${tw}" height="${fuente + 6}" fill="${color}"/><text x="${tx + 5}" y="${ty + fuente}" font-family="Arial" font-size="${fuente}" font-weight="700" fill="#111">${texto}</text>`;
  }).join("");
  const buffer = await img.resize(w, h).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svg}</svg>`), top: 0, left: 0 }]).jpeg({ quality: 66 }).toBuffer();
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

async function main() {
  const resumenBase = compararConCarpeta(base, etiquetas);
  const resumenCandidata = compararConCarpeta(candidata, etiquetas);
  const cambios = suite.items.map((item) => {
    const clase = etiquetas[item.image_sha256]!;
    const familia = familiaDesdeClaseOficial(clase);
    const b = base.filter((l) => l.image_sha256 === item.image_sha256 && l.resultado === "ok").sort((x, y) => x.corrida - y.corrida);
    const c = candidata.filter((l) => l.image_sha256 === item.image_sha256 && l.resultado === "ok").sort((x, y) => x.corrida - y.corrida);
    const ab = b.filter((l) => nombrePrincipal(l) === familia).length / Math.max(1, b.length);
    const ac = c.filter((l) => nombrePrincipal(l) === familia).length / Math.max(1, c.length);
    const extrasBase = b.reduce((s, l) => s + l.instancias.length, 0) / Math.max(1, b.length);
    const extrasCand = c.reduce((s, l) => s + l.instancias.length, 0) / Math.max(1, c.length);
    return { item, clase, familia, b, c, ab, ac, delta: ac - ab, piezasBase: extrasBase, piezasCand: extrasCand };
  });
  const arreglos = cambios.filter((x) => x.delta > 0).sort((x, y) => y.delta - x.delta || x.clase.localeCompare(y.clase));
  const regresiones = cambios.filter((x) => x.delta < 0).sort((x, y) => x.delta - y.delta || x.clase.localeCompare(y.clase));
  const elegir = (lista: typeof cambios, maximo: number) => {
    const vistas = new Set<string>();
    const elegidos: typeof cambios = [];
    for (const x of lista) { if (elegidos.length >= maximo) break; if (vistas.has(x.clase) && lista.length > maximo) continue; vistas.add(x.clase); elegidos.push(x); }
    return elegidos;
  };
  const ejemplo = async (x: (typeof cambios)[number], tipo: string) => ({
    tipo, clase: x.clase, familia: x.familia,
    antes: { principales: x.b.map(nombrePrincipal), imagen: await miniatura(x.item, x.b.find((l) => (tipo === "arreglo" ? nombrePrincipal(l) !== x.familia : nombrePrincipal(l) === x.familia)) ?? x.b[0], x.familia) },
    despues: { principales: x.c.map(nombrePrincipal), imagen: await miniatura(x.item, x.c.find((l) => (tipo === "arreglo" ? nombrePrincipal(l) === x.familia : nombrePrincipal(l) !== x.familia)) ?? x.c[0], x.familia) },
  });
  const ejemplos = [...(await Promise.all(elegir(arreglos, 6).map((x) => ejemplo(x, "arreglo")))), ...(await Promise.all(elegir(regresiones, 4).map((x) => ejemplo(x, "regresion"))))];
  const porClase = [...new Set(cambios.map((x) => x.clase))].sort().map((clase) => {
    const de = cambios.filter((x) => x.clase === clase);
    const media = (f: (x: (typeof cambios)[number]) => number) => de.reduce((s, x) => s + f(x), 0) / de.length;
    return { clase, fotos: de.length, base: media((x) => x.ab), candidata: media((x) => x.ac), mejoran: de.filter((x) => x.delta > 0).length, empeoran: de.filter((x) => x.delta < 0).length, piezas_base: media((x) => x.piezasBase), piezas_candidata: media((x) => x.piezasCand) };
  });
  mkdirSync(salida!, { recursive: true });
  const latencias = (ls: PrediccionEstructurasV1[]) => { const v = ls.filter((l) => l.resultado === "ok").map((l) => l.latencia_ms.total).sort((a, b) => a - b); const p = (q: number) => v[Math.min(v.length, Math.max(1, Math.ceil((q / 100) * v.length))) - 1]; return { p50: p(50), p95: p(95) }; };
  writeFileSync(resolve(salida!, "comparacion.json"), JSON.stringify({
    corridas_por_foto: corridas, fotos: suite.items.length,
    global: { base: resumenBase.global, candidata: resumenCandidata.global, mejoran: arreglos.length, empeoran: regresiones.length, iguales: cambios.length - arreglos.length - regresiones.length },
    latencia: { base: latencias(base), candidata: latencias(candidata) },
    por_clase: porClase,
    confusion: { base: resumenBase.confusion_familia_carpeta_vs_principal, candidata: resumenCandidata.confusion_familia_carpeta_vs_principal },
    ejemplos,
  }, null, 1));
  console.log(`[variantes] ${suite.items.length} fotos · mejoran ${arreglos.length} · empeoran ${regresiones.length} · ${ejemplos.length} ejemplos`);
}

main().catch((error: unknown) => { console.error(`[variantes] ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
