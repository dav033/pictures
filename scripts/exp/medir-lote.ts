/**
 * Mide de una vez las proporciones de las 10 corridas de referencia (la lectura de Claude y la de Gemini de cada una de las
 * 5 fotos del lote 02) con `medirCorrida`: una línea por corrida y el promedio. Las carpetas de Gemini se dan con
 * `--gemini r01=<dir>,r02=<dir>…` (por defecto las últimas conocidas) y la salida de los superpuestos con `--png <dir>`.
 *
 *   npx tsx --conditions=react-server scripts/exp/medir-lote.ts [--gemini r01=r01-gemini-v3,…] [--claude r01=r01-claude,…] [--png <dir>] [--medir-claude] [--json]
 */
import { existsSync } from "node:fs";
import { medirCorrida } from "./medir-proporciones";

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const LOTE = "C:/Users/davidt/Downloads/pictures-workspace/referencias-usuario/lote-02";
const DATOS = "data/exp/iterar-foto";
const FOTOS: Record<string, string> = { r01: "01-arco-dorado-lentejuelas.webp", r02: "02-semiarco-vino-pampas-david-dayan.jpg", r03: "03-arco-azul-dorado-lentejuelas-neon.jpg", r04: "04-arco-fucsia-rosa-lets-party.jpg", r05: "05-aro-isabella-rosa-dorado.jpg" };
const GEMINI: Record<string, string> = { r01: "r01-gemini-v3", r02: "r02-gemini-v7", r03: "r03-gemini-v6", r04: "r04-gemini-v2", r05: "r05-gemini-v6" };
const CLAUDE: Record<string, string> = { r01: "r01-claude", r02: "r02-claude", r03: "r03-claude", r04: "r04-claude", r05: "r05-claude" };
/** Dónde está la verdad de la foto (detecciones y fondos): las corridas pagadas de Gemini, y para r01 y r02 las detecciones sueltas. */
const VERDAD: Record<string, string> = { r01: "verdad-r01", r02: "verdad-r02", r03: "r03-gemini-v6", r04: "r04-gemini-v2", r05: "r05-gemini-v6" };

const sobreescribir = (base: Record<string, string>, valor: string | undefined) => {
  for (const par of valor?.split(",") ?? []) { const [k, v] = par.split("="); if (k && v) base[k] = v; }
};
sobreescribir(GEMINI, arg("--gemini"));
sobreescribir(CLAUDE, arg("--claude"));

async function main() {
  const png = arg("--png");
  const filas: Array<{ nombre: string; medidas: Awaited<ReturnType<typeof medirCorrida>> }> = [];
  for (const id of Object.keys(FOTOS)) {
    for (const quien of ["claude", "gemini"] as const) {
      const carpeta = `${DATOS}/${quien === "claude" ? CLAUDE[id] : GEMINI[id]}`;
      const sinMedir = `${carpeta}/lectura.json`;
      const lectura = [sinMedir, `${carpeta}/lectura-v3.json`, `${carpeta}/lectura-medida.json`].find((f) => existsSync(f));
      if (!lectura) throw new Error(`Sin lectura en ${carpeta}`);
      // La de Gemini se mide con las detecciones (como `iterar-foto`) si es la leída; la medida (r01, r02) ya viene medida.
      const medir = (quien === "gemini" || process.argv.includes("--medir-claude")) && lectura !== `${carpeta}/lectura-medida.json`;
      const medidas = await medirCorrida({ foto: `${LOTE}/${FOTOS[id]}`, lectura, detecciones: `${DATOS}/${VERDAD[id]}/detecciones.json`, fondos: `${DATOS}/${VERDAD[id]}/fondos.json`, medir, ...(png ? { png: `${png}/sup-${id}-${quien}.png` } : {}) });
      filas.push({ nombre: `${id} ${quien}`, medidas });
    }
  }
  if (process.argv.includes("--json")) { console.log(JSON.stringify(filas)); return; }
  const f2 = (n: number) => n.toFixed(2), s2 = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2);
  for (const { nombre, medidas: m } of filas) {
    const fondos = m.fondos.map((q) => `${q.id.slice(0, 9)}=${q.iou ?? "-"}`).join(" ");
    console.log(`${nombre.padEnd(11)} pun=${m.puntaje.toFixed(3)} iou=${f2(m.iou)} borde=${m.bordes.medio.toFixed(3)}(i ${s2(m.bordes.izquierda)} d ${s2(m.bordes.derecha)} a ${s2(m.bordes.arriba)} b ${s2(m.bordes.abajo)}) sil=${m.silueta.medio.toFixed(3)}(anc ${f2(m.silueta.ancho)} cen ${f2(m.silueta.centro)} arr ${f2(m.silueta.arriba)} aba ${f2(m.silueta.abajo)}) diam=${f2(m.diametro.razon)}/${f2(m.diametro.razonGrandes)} | ${fondos}`);
  }
  const media = (v: number[]) => v.reduce((s, n) => s + n, 0) / v.length;
  for (const quien of ["claude", "gemini"]) console.log(`PROMEDIO ${quien}: puntaje ${media(filas.filter((f) => f.nombre.endsWith(quien)).map((f) => f.medidas.puntaje)).toFixed(3)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
