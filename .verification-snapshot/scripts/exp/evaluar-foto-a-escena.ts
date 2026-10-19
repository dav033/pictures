/**
 * Evaluación PAGADA de la lectura de fotos con Gemini (REQ-001 paso 10): lee cada una de las 13 fotos del dueño con
 * `leerFotoConIA` (la misma ruta que la barra de la IA y `/api/escena-desde-foto`) y la compara con la lectura hecha a
 * mano de esa foto (`referencias-dueno.ts`): tipos de pieza, conteos, familias de color, silueta de las guirnaldas
 * orgánicas (clase y distancia entre ejes) y piezas inventadas; además, si la plantilla de la biblioteca más parecida a
 * la foto es la esperada. La lectura a mano de la foto que se mide NO va de ejemplo en el prompt (nada de copiar).
 *
 * Las fotos viven fuera del repo (`pictures-workspace/referencias-usuario/lote-01/`, ver `--carpeta` o FOTOS_DUENO);
 * nunca se copian aquí. La búsqueda de plantillas usa los vectores de la caché (`data/taller/embeddings`) en lugar de
 * la base: el embedding de la foto (casi gratis) contra los vectores de imagen de la biblioteca, por coseno. OJO: las 13
 * fotos YA están indexadas, así que su plantilla esperada sale primera casi por definición; mide que la búsqueda
 * funcione, no que generalice a fotos nuevas.
 *
 * Tope declarado: --tope-usd (por defecto 0,30, nunca más de 0,40). Antes de cada foto se estima su coste (el promedio
 * de lo gastado, mínimo US$0,02); si lo gastado más eso pasa el tope, se detiene. Sin `--pagar` NO llama a la IA:
 * lista las fotos y el tope (ensayo en seco).
 *
 * Con `--refinar` (REQ-001 paso 9) cada foto sigue: lectura → compilado → hasta 2 rondas de refinado como en el taller (captura sin
 * cabeza con Playwright de la página `/3d/captura` de un servidor de desarrollo PROPIO, `--url`, y la ruta real
 * `/api/escena-ia` con `refinar`), y se mide antes y después de cada ronda: el parecido de imagen (coseno del embedding de
 * la foto con el de la captura, gemini-embedding-2, ~US$0,0001 cada uno) y la distancia del reparto grande/mediano/chico de
 * lo orgánico al de la lectura a mano. Las capturas quedan en `data/exp/refinar-foto/<fecha>/` (ignorada por git). Cada
 * ejecución suma su gasto a `data/exp/refinar-foto/gasto.json` (tope por ejecución: --tope-usd, hasta 0,60).
 *
 * Uso: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/exp/evaluar-foto-a-escena.ts [--pagar] [--tope-usd 0.3]
 *        [--foto 1,2,9] [--reusar data/exp/evaluar-foto-a-escena-….json (con --refinar: la lectura se reutiliza sin coste)] [--carpeta <dir>]
 *        [--refinar [--url http://127.0.0.1:3014] [--rondas 0|1|2] [--criterio (cada ronda pasa por el veredicto del servidor, como en el taller)]]
 * Salida: data/exp/evaluar-foto-a-escena-<fecha>.json (por foto: lectura, métricas, plantillas, coste) — carpeta ignorada por git.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { compararLecturas, type Comparacion } from "../../src/lib/globos3d/comparar-lecturas";
import { leerFotoConIA } from "../../src/lib/globos3d/leer-foto-ia";
import { LecturaFotoSchema, type LecturaFoto } from "../../src/lib/globos3d/lectura-foto";
import { REFERENCIAS_DUENO } from "../../src/lib/globos3d/referencias-dueno";
import { conContexto } from "../../src/lib/registro/servidor";
import { embeberImagen } from "../../src/lib/rag/embeddings";
import { leerVectoresCacheados } from "../../src/lib/taller/vectores-cache";
import { normalizarFoto, normalizarFotoA } from "../../src/lib/taller/normalizar-foto";
import { abrirCapturador, type CapturadorSinCabeza } from "./lib-captura-sin-cabeza";
import { escalonesDeLectura, evaluarRefinado, formatosDeLectura, type ResultadoRefinadoEval } from "./lib-refinado-eval";

for (const archivo of [".env.local", ".env"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
process.env.REGISTRO_ACTIVO = "1";

const RAIZ = path.resolve(__dirname, "../..");
const refinar = process.argv.includes("--refinar");
const TOPE_MAXIMO_USD = refinar ? 0.6 : 0.4;
const COSTE_MINIMO_POR_FOTO = refinar ? 0.08 : 0.02;
const arg = (nombre: string) => (process.argv.includes(nombre) ? process.argv[process.argv.indexOf(nombre) + 1] : undefined);
const pagar = process.argv.includes("--pagar");
const tope = Math.min(TOPE_MAXIMO_USD, Number(arg("--tope-usd") ?? 0.3));
const carpeta = path.resolve(arg("--carpeta") ?? process.env.FOTOS_DUENO ?? path.join(RAIZ, "../pictures-workspace/referencias-usuario/lote-01"));
const urlBase = arg("--url") ?? "http://127.0.0.1:3014";
const maxRondas = arg("--rondas") !== undefined ? Number(arg("--rondas")) : undefined;
const soloFotos = arg("--foto")?.split(",").map(Number).filter(Number.isFinite);

type Plantilla = { id: string; parecido: number };
type Fila = {
  numero: number; referencia: string; archivo: string; costeUsd: number; tokens: { entrada: number; salida: number; pensamiento: number }; intentos: number; ms: number;
  lectura: LecturaFoto; descartadas: string[]; comparacion: Comparacion; nodos: number; omitidas: number;
  plantillas: Plantilla[]; rangoEsperada: number | null; top1Esperada: boolean | null; error?: string;
  /** Con `--refinar`: las rondas con la foto, antes y después (sin la escena final, que va aparte en su carpeta). */
  refinado?: Omit<ResultadoRefinadoEval, "escenaFinal"> & { escenaFinal: string };
};

/** El archivo de la foto `numero` ("01-….jpg"). */
function archivoDeFoto(numero: number): string | null {
  const prefijo = String(numero).padStart(2, "0") + "-";
  return readdirSync(carpeta).find((f) => f.startsWith(prefijo) && /\.(jpe?g|png|webp)$/i.test(f)) ?? null;
}

/** Coseno de dos vectores ya normalizados. */
const coseno = (a: ArrayLike<number>, b: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!; return s; };

/** Plantillas por el vector de la imagen contra la caché de la biblioteca (lo mejor de las vistas de foto y de render de cada item). */
function plantillasPorVector(vector: ArrayLike<number>, indice: ReturnType<typeof leerVectoresCacheados>): Plantilla[] {
  const mejor = new Map<string, number>();
  for (const v of indice) mejor.set(v.id, Math.max(mejor.get(v.id) ?? -1, coseno(vector, v.vector)));
  return [...mejor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, parecido]) => ({ id, parecido: Math.round(parecido * 1000) / 1000 }));
}

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "  - " : `${Math.round(n * 100)}`.padStart(3) + "%");

function imprimirTabla(filas: Fila[]) {
  console.log("\n #  puntaje  tipos(F1)  fondos  color(fam)  silueta  trazo(dist)  inventadas  plantilla  coste");
  for (const f of filas) {
    const c = f.comparacion;
    console.log(`${String(f.numero).padStart(2)}   ${pct(c.puntaje)}     ${pct(c.tipos.f1)}      ${pct(c.fondos?.f1)}     ${pct(c.colores.familia)}      ${pct(c.silueta.claseIgual)}     ${c.silueta.distancia === null ? "   -  " : c.silueta.distancia.toFixed(3).padStart(6)}      ${String(c.tipos.inventadas.length).padStart(2)}       ${f.top1Esperada === null ? " - " : f.top1Esperada ? "top1" : `#${f.rangoEsperada ?? "?"}`}     US$${f.costeUsd.toFixed(4)}`);
  }
  const media = (xs: Array<number | null | undefined>) => { const v = xs.filter((x): x is number => typeof x === "number"); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  console.log(`\nPromedios: puntaje ${pct(media(filas.map((f) => f.comparacion.puntaje)))} · tipos F1 ${pct(media(filas.map((f) => f.comparacion.tipos.f1)))} · familias de color ${pct(media(filas.map((f) => f.comparacion.colores.familia)))} · clase de silueta ${pct(media(filas.map((f) => f.comparacion.silueta.claseIgual)))} · inventadas ${filas.reduce((s, f) => s + f.comparacion.tipos.inventadas.length, 0)} · top1 ${filas.filter((f) => f.top1Esperada).length}/${filas.filter((f) => f.top1Esperada !== null).length}`);
}

const num = (n: number | null | undefined, d = 3) => (n === null || n === undefined ? "  -  " : n.toFixed(d));

function imprimirRefinado(filas: Fila[]) {
  const con = filas.filter((f) => f.refinado);
  if (!con.length) return;
  console.log("\n #  rondas  parecido de imagen (antes → después)   mezcla vs mano (antes → después)   grandes (antes → después | mano)   coste");
  for (const f of con) {
    const r = f.refinado!;
    const delta = r.despues.similitud !== null && r.antes.similitud !== null ? (r.despues.similitud - r.antes.similitud >= 0 ? "+" : "") + (r.despues.similitud - r.antes.similitud).toFixed(3) : " - ";
    console.log(`${String(f.numero).padStart(2)}    ${r.rondas.length}      ${num(r.antes.similitud)} → ${num(r.despues.similitud)} (${delta})        ${num(r.antes.distanciaMezcla)} → ${num(r.despues.distanciaMezcla)}                  ${num(r.antes.escalones.grandes, 2)} → ${num(r.despues.escalones.grandes, 2)} | ${num(escalonesDeLectura(REFERENCIAS_DUENO.find((x) => x.numero === f.numero)!.lectura)?.grandes, 2)}      US$${f.costeUsd.toFixed(4)} (rondas ${r.costesPorRonda.map((c) => c.toFixed(3)).join(" + ") || "-"})  [${r.motivo}]`);
    for (const ronda of r.rondas) console.log(`      ronda ${ronda.ronda}: ${ronda.significativas ?? "?"} diferencias significativas, ${ronda.cambios} cambios → parecido ${num(ronda.despues.similitud)}, mezcla ${num(ronda.despues.distanciaMezcla)} · ${ronda.diferencias.filter((d) => d.significativa).map((d) => `${d.aspecto}: ${d.descripcion}`).join(" | ").slice(0, 400)}`);
  }
}

async function main() {
  const numeros = (soloFotos?.length ? soloFotos : REFERENCIAS_DUENO.map((r) => r.numero)).filter((n) => REFERENCIAS_DUENO.some((r) => r.numero === n));
  console.log(`Evaluación foto → lectura${refinar ? " → refinado" : ""}: ${numeros.length} fotos de ${carpeta} · tope US$${tope.toFixed(2)}${pagar ? "" : " · EN SECO (sin --pagar no se llama a la IA)"}`);
  if (!existsSync(carpeta)) throw new Error(`No existe la carpeta de fotos: ${carpeta}`);
  if (!pagar) {
    for (const n of numeros) {
      const ref = REFERENCIAS_DUENO.find((r) => r.numero === n)!;
      console.log(`  - ${String(n).padStart(2)}: ${archivoDeFoto(n) ?? "(sin archivo)"} → ${ref.id} (${ref.lectura.piezas.length} piezas a mano)`);
    }
    console.log(`Con --pagar correría hasta que lo gastado + ~US$${COSTE_MINIMO_POR_FOTO} por foto pase US$${tope.toFixed(2)} (estimado ~US$${(numeros.length * 0.02).toFixed(2)} las ${numeros.length}).`);
    return;
  }
  if (!process.env.GEMINI_API_KEY) throw new Error("Falta GEMINI_API_KEY en el entorno");

  const reusar = arg("--reusar");
  const previas = new Map<number, Fila>();
  if (reusar) for (const f of (JSON.parse(readFileSync(path.resolve(reusar), "utf8")) as { filas: Fila[] }).filas) if (!f.error) previas.set(f.numero, f);
  const indice = leerVectoresCacheados(undefined, { modalidades: ["imagen_foto", "imagen_render"] });
  console.log(`Vectores de imagen de la biblioteca: ${indice.length}${previas.size ? ` · reutilizo ${previas.size} fotos de ${reusar}` : ""}`);

  const filas: Fila[] = [];
  let gastado = 0;
  const sello = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const carpetaRefinado = path.join(RAIZ, "data/exp/refinar-foto", sello);
  let capturador: CapturadorSinCabeza | null = null;
  if (refinar) {
    const vivo = await fetch(`${urlBase}/3d/captura`, { signal: AbortSignal.timeout(120_000) }).then((r) => r.ok).catch(() => false);
    if (!vivo) throw new Error(`No hay servidor de desarrollo en ${urlBase} (arráncalo con «npx next dev -p 3014»).`);
    capturador = await abrirCapturador(urlBase);
  }
  await conContexto({ conversacion: `exp-evaluar-foto-a-escena-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`, vista: "3d" }, async () => {
    for (const numero of numeros) {
      const previa = previas.get(numero);
      // Con --refinar, una foto reutilizada no se vuelve a leer (sin coste) pero sí se compila, se mide y se refina con el código de ahora.
      if (previa && !refinar) { filas.push(previa); gastado += previa.costeUsd; console.log(`  ${String(numero).padStart(2)}: reutilizada (US$${previa.costeUsd.toFixed(4)})`); continue; }
      const estimado = Math.max(COSTE_MINIMO_POR_FOTO, filas.length ? gastado / filas.length : 0);
      if (gastado + estimado > tope) { console.log(`Tope: gastado US$${gastado.toFixed(4)} + ~US$${estimado.toFixed(3)} pasaría US$${tope.toFixed(2)}. Me detengo.`); break; }
      const ref = REFERENCIAS_DUENO.find((r) => r.numero === numero)!;
      const archivo = archivoDeFoto(numero);
      if (!archivo) { console.log(`  ${numero}: sin archivo en la carpeta`); continue; }
      const inicio = Date.now();
      try {
        const original = new Uint8Array(readFileSync(path.join(carpeta, archivo)));
        const normalizada = await normalizarFotoA(original, 1536);
        const lectura = previa
          ? { lectura: previa.lectura, descartadas: previa.descartadas, uso: previa.tokens, costeEstimadoUsd: 0, intentos: previa.intentos, modelo: "reutilizada" }
          : await leerFotoConIA({ bytes: normalizada, mime: "image/jpeg" }, { excluirEjemplos: [ref.id], superficie: "exp/evaluar-foto-a-escena" });
        gastado += lectura.costeEstimadoUsd;
        const comparacion = compararLecturas(lectura.lectura, ref.lectura);
        const compilada = compilarLectura(lectura.lectura);
        // Plantillas: el embedding de la foto (1024 px, como «Buscar por foto») contra la caché de la biblioteca.
        let plantillas: Plantilla[] = [];
        try { plantillas = plantillasPorVector(await embeberImagen(await normalizarFoto(original), "image/jpeg", { superficie: "exp/evaluar-foto-a-escena" }), indice); } catch (e) { console.log(`  ${numero}: sin plantillas (${e instanceof Error ? e.message : String(e)})`); }
        const rango = plantillas.findIndex((p) => p.id === ref.id);
        const fila: Fila = {
          numero, referencia: ref.id, archivo: archivo.slice(0, 2), costeUsd: lectura.costeEstimadoUsd, tokens: lectura.uso, intentos: lectura.intentos, ms: Date.now() - inicio,
          lectura: lectura.lectura, descartadas: lectura.descartadas, comparacion, nodos: compilada.escena.nodos.length, omitidas: compilada.omitidas.length,
          plantillas, rangoEsperada: plantillas.length ? (rango >= 0 ? rango + 1 : null) : null, top1Esperada: plantillas.length ? plantillas[0]!.id === ref.id : null,
        };
        if (capturador) {
          const resultado = await evaluarRefinado({ escena: compilada.escena, foto: { mime: "image/jpeg", base64: Buffer.from(normalizada).toString("base64") }, lectura: lectura.lectura, metaMezcla: formatosDeLectura(ref.lectura), original, urlBase, capturador, carpeta: carpetaRefinado, prefijo: String(numero).padStart(2, "0"), ...(maxRondas !== undefined ? { maxRondas } : {}), criterio: process.argv.includes("--criterio"), parar: (gastoDeEstaFoto) => gastado + gastoDeEstaFoto + COSTE_MINIMO_POR_FOTO / 2 > tope });
          mkdirSync(carpetaRefinado, { recursive: true });
          const archivoEscena = path.join(carpetaRefinado, `${String(numero).padStart(2, "0")}-escena-final.json`);
          writeFileSync(archivoEscena, JSON.stringify(resultado.escenaFinal));
          fila.refinado = { ...resultado, escenaFinal: path.relative(RAIZ, archivoEscena) };
          fila.costeUsd += resultado.costeRondasUsd + resultado.costeEmbeddingsUsd;
          gastado += resultado.costeRondasUsd + resultado.costeEmbeddingsUsd;
        }
        filas.push(fila);
        console.log(`  ${String(numero).padStart(2)}: puntaje ${pct(comparacion.puntaje)} · tipos ${pct(comparacion.tipos.f1)} · color ${pct(comparacion.colores.familia)} · silueta ${pct(comparacion.silueta.puntaje)} · inventadas [${comparacion.tipos.inventadas.join(",")}] · faltan [${comparacion.tipos.faltantes.join(",")}] · US$${lectura.costeEstimadoUsd.toFixed(4)} · ${((Date.now() - inicio) / 1000).toFixed(0)} s`);
      } catch (error) {
        console.log(`  ${numero}: ERROR ${error instanceof Error ? error.message : String(error)}`);
        if (/429|RESOURCE_EXHAUSTED|quota/i.test(String(error))) break;
      }
    }
  });

  await capturador?.cerrar();
  imprimirTabla(filas);
  imprimirRefinado(filas);
  console.log(`\nGastado: US$${gastado.toFixed(4)} de US$${tope.toFixed(2)}.`);
  if (refinar) {
    const libro = path.join(RAIZ, "data/exp/refinar-foto/gasto.json");
    const previo = existsSync(libro) ? (JSON.parse(readFileSync(libro, "utf8")) as { total: number; corridas: Array<{ fecha: string; fotos: number[]; usd: number }> }) : { total: 0, corridas: [] };
    previo.corridas.push({ fecha: new Date().toISOString(), fotos: filas.map((f) => f.numero), usd: Math.round(gastado * 1e5) / 1e5 });
    previo.total = Math.round(previo.corridas.reduce((a, c) => a + c.usd, 0) * 1e5) / 1e5;
    mkdirSync(path.dirname(libro), { recursive: true });
    writeFileSync(libro, JSON.stringify(previo, null, 2));
    console.log(`Gasto acumulado del refinado (todas las ejecuciones): US$${previo.total.toFixed(4)}.`);
  }
  const salida = path.join(RAIZ, "data/exp", `evaluar-foto-a-escena-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`);
  mkdirSync(path.dirname(salida), { recursive: true });
  for (const f of filas) LecturaFotoSchema.parse(f.lectura);
  writeFileSync(salida, JSON.stringify({ fecha: new Date().toISOString(), tope, gastadoUsd: Math.round(gastado * 1e5) / 1e5, filas }, null, 2));
  console.log(`Resultados: ${path.relative(RAIZ, salida)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
