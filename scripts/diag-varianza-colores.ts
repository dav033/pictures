import fs from "node:fs";
import path from "node:path";
import { analizarReferenciasV2 } from "../src/lib/ia/analizar-referencias-v2";
import { chatDe } from "../src/lib/ia/registro";
import { coloresFotoCliente } from "../src/lib/plan/colores-referencia";
import type { ImagenEtiquetada } from "../src/lib/ia/tipos";

/**
 * ¿Cuánto varía la detección de color sobre LA MISMA foto?
 *
 * El síntoma reportado es "la detección de colores es bastante inconsistente".
 * Esto lo convierte en un número: N análisis del mismo archivo, con
 * `forzarNuevoAnalisis` para saltarse el análisis fijo de la galería y la
 * caché en memoria (`analizar-referencias-v2.ts:548-553`), y se compara
 * `appearance.observed_colors` elemento a elemento y la paleta plegada al
 * vocabulario del catálogo (`colores-referencia.ts`), que es lo que acaba
 * llegando al plan.
 *
 * Llamadas PAGADAS a Gemini: 2 por repetición (inventario + auditoría).
 * Fotos: las de la galería de ejemplo del repo (licencia Pexels), nunca fotos
 * de cliente.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local \
 *     scripts/diag-varianza-colores.ts --foto ejemplo-01 --repeticiones 5
 */

function flag(nombre: string, porDefecto: string): string {
  const i = process.argv.indexOf(`--${nombre}`);
  return (i >= 0 ? process.argv[i + 1] : undefined) ?? porDefecto;
}

const fotoId = flag("foto", "ejemplo-01");
const repeticiones = Number(flag("repeticiones", "5"));

const archivo = path.join(process.cwd(), "public/referencias-ejemplo", `${fotoId}.jpg`);
if (!fs.existsSync(archivo)) throw new Error(`No existe ${archivo}`);
const base64 = fs.readFileSync(archivo).toString("base64");
const referencia: ImagenEtiquetada = { id: "REF_01", mime: "image/jpeg", base64, descripcion: "Foto de referencia del cliente" };

type Observacion = { elemento: string; colores: string[] };

async function unaPasada(indice: number): Promise<{ observaciones: Observacion[]; paleta: string[] }> {
  const chat = await chatDe("gemini");
  const resultado = await analizarReferenciasV2(
    chat,
    [referencia],
    [],
    "perceptual",
    { requestId: `diag-${indice}`, correlationId: `diag-${indice}`, superficie: "diag-varianza-colores" },
    undefined,
    { forzarNuevoAnalisis: true },
  );
  const observaciones: Observacion[] = resultado.blueprint.elements.map((el) => ({
    elemento: `${el.name}`,
    colores: [...(el.appearance?.observed_colors ?? [])],
  }));
  return { observaciones, paleta: coloresFotoCliente(resultado.blueprint) };
}

function frecuencias(listas: string[][]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const lista of listas) for (const valor of new Set(lista)) mapa.set(valor, (mapa.get(valor) ?? 0) + 1);
  return mapa;
}

async function main(): Promise<void> {
  console.log(`foto=${fotoId}  repeticiones=${repeticiones}  (${repeticiones * 2} llamadas pagadas a Gemini)\n`);
  const pasadas: Array<{ observaciones: Observacion[]; paleta: string[] }> = [];
  for (let i = 0; i < repeticiones; i += 1) {
    process.stdout.write(`  pasada ${i + 1}/${repeticiones} ... `);
    try {
      const pasada = await unaPasada(i);
      pasadas.push(pasada);
      console.log(`${pasada.observaciones.length} elementos · paleta [${pasada.paleta.join(", ")}]`);
    } catch (error) {
      console.log(`FALLO: ${String(error).slice(0, 160)}`);
    }
  }
  if (!pasadas.length) return;

  console.log("\n=== NUMERO DE ELEMENTOS DETECTADOS POR PASADA ===");
  console.log(`  ${pasadas.map((p) => p.observaciones.length).join(", ")}`);

  console.log("\n=== PALETA PLEGADA AL VOCABULARIO DEL CATALOGO (lo que llega al plan) ===");
  const paletas = pasadas.map((p) => p.paleta);
  for (const [color, veces] of [...frecuencias(paletas)].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${color.padEnd(14)} ${veces}/${pasadas.length} pasadas${veces === pasadas.length ? "" : "   <-- INESTABLE"}`);
  }
  const firmas = new Set(paletas.map((p) => [...p].sort().join("|")));
  console.log(`  paletas distintas: ${firmas.size} de ${pasadas.length} pasadas`);

  console.log("\n=== COLORES CRUDOS OBSERVADOS (antes de plegar) ===");
  const crudos = pasadas.map((p) => p.observaciones.flatMap((o) => o.colores));
  for (const [color, veces] of [...frecuencias(crudos)].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${color.padEnd(28)} ${veces}/${pasadas.length}${veces === pasadas.length ? "" : "   <-- INESTABLE"}`);
  }

  console.log("\n=== ELEMENTOS POR PASADA ===");
  pasadas.forEach((p, i) => {
    console.log(`  #${i + 1}: ${p.observaciones.map((o) => `${o.elemento} [${o.colores.join(", ")}]`).join(" | ")}`);
  });

  const salida = path.join(process.cwd(), "reports/diagnostico", `varianza-colores-${fotoId}.json`);
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(salida, JSON.stringify({ foto: fotoId, repeticiones, pasadas }, null, 2));
  console.log(`\nDetalle en ${path.relative(process.cwd(), salida)}`);
}

void main();
