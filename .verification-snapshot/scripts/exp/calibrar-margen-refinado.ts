/**
 * Calibración PAGADA (casi gratis: embeddings de imagen, ~US$0,0001 cada uno) del margen de aceptación del refinado
 * (`MARGEN_MEJORA`, P-016). Pasos 1 y 2 del protocolo; el 3 (rondas etiquetadas por el dueño, curva ROC) queda pendiente.
 *
 * Con las fotos del dueño (`pictures-workspace/referencias-usuario/lote-01/`, nunca se copian al repo) y su lectura a mano
 * (`referencias-dueno.ts`, que compila la escena de cada foto):
 *  1. PISO DE RUIDO. La misma escena, capturada N veces (un navegador nuevo por captura) y embebida: |Δ| entre pares de
 *     «parecido con la foto» = ruido del render + de la API. Aparte, los mismos bytes embebidos N veces = ruido solo de la API.
 *     El ruido de una decisión es el p99 de |Δ| de los pares de la misma escena.
 *  2. CURVA DE EFECTO. Perturbaciones de signo conocido (mover la escena 20, 50 y 100 cm, cambiar el color dominante, quitar la
 *     pieza mayor o la menor, agregar una copia de la mayor, achicar el recorrido de lo orgánico ×0,8): el parecido tiene que
 *     BAJAR y bajar más cuanto más grande es la perturbación (monotonía). Deshacer la perturbación es una ronda que mejora
 *     en +|Δ|: ese es el efecto que el margen tiene que dejar pasar.
 * Escribe el informe en `data/exp/calibrar-margen/<fecha>.json` (carpeta ignorada por git) y lo imprime.
 *
 * Necesita un servidor de desarrollo PROPIO con la página de captura (`--url`, `npx next dev -p 3015 -H 127.0.0.1`) y la clave
 * de Gemini en el entorno o en un archivo `--env <ruta>` (no se imprime). Sin `--pagar` solo cuenta lo que haría.
 *
 *   npx tsx --conditions=react-server scripts/exp/calibrar-margen-refinado.ts --pagar [--fotos 4,7,9,12] [--repeticiones 5]
 *       [--url http://127.0.0.1:3015] [--carpeta <lote-01>] [--env <.env.local>] [--tope-usd 0.02]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { encuadreDeLectura } from "../../src/lib/globos3d/encuadre-foto";
import { armarEscena, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { coloresDePieza } from "../../src/lib/globos3d/herramientas-escena-recolor";
import { MARGEN_MEJORA, coseno } from "../../src/lib/globos3d/refinado/aceptacion";
import { REFERENCIAS_DUENO } from "../../src/lib/globos3d/referencias-dueno";
import { embeberImagen } from "../../src/lib/rag/embeddings";
import { normalizarFoto } from "../../src/lib/taller/normalizar-foto";
import { abrirCapturador } from "./lib-captura-sin-cabeza";

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const pagar = process.argv.includes("--pagar");
const url = arg("--url") ?? "http://127.0.0.1:3015";
const repeticiones = Number(arg("--repeticiones") ?? 5);
const numeros = (arg("--fotos") ?? "4,7,9,12").split(",").map(Number);
const carpeta = arg("--carpeta") ?? "C:/Users/davidt/Downloads/pictures-workspace/referencias-usuario/lote-01";
const tope = Number(arg("--tope-usd") ?? 0.02);
const COSTE_EMBEDDING_USD = 0.0001;
const TELEMETRIA = { superficie: "exp/calibrar-margen" } as const;

/** El archivo `.env` con la clave de Gemini, si se pasa: solo se toma GEMINI_API_KEY y nunca se imprime. */
function cargarClave(): void {
  const archivo = arg("--env");
  if (!archivo || process.env.GEMINI_API_KEY) return;
  const linea = readFileSync(archivo, "utf8").split(/\r?\n/).find((l) => l.startsWith("GEMINI_API_KEY="));
  if (linea) process.env.GEMINI_API_KEY = linea.slice("GEMINI_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
}

let embeddings = 0;
const embeber = async (bytes: Uint8Array): Promise<number[]> => {
  if ((embeddings + 1) * COSTE_EMBEDDING_USD > tope) throw new Error(`Tope de US$${tope} alcanzado tras ${embeddings} embeddings.`);
  embeddings += 1;
  return embeberImagen(bytes, "image/jpeg", TELEMETRIA, "evaluacion");
};
const bytesDe = (foto: { base64: string }) => new Uint8Array(Buffer.from(foto.base64, "base64"));
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Percentil `p` (0–1) con interpolación lineal. */
function percentil(valores: readonly number[], p: number): number {
  const v = [...valores].sort((a, b) => a - b);
  if (!v.length) return NaN;
  const i = (v.length - 1) * p, base = Math.floor(i);
  return v[base]! + (v[Math.min(base + 1, v.length - 1)]! - v[base]!) * (i - base);
}
const diferenciasEntrePares = (valores: readonly number[]): number[] => valores.flatMap((a, i) => valores.slice(i + 1).map((b) => Math.abs(a - b)));

// ----- perturbaciones de signo conocido -----------------------------------------------------------------------------

type Perturbacion = { nombre: string; magnitud: number; familia: string; escena: Escena };

const desplazar = (e: Escena, cm: number): Escena => ({
  ...e, nodos: e.nodos.map((n): NodoEscena => {
    const c = n.colocacion;
    if (c.en === "pared") return { ...n, colocacion: { ...c, aLoLargoCm: c.aLoLargoCm + cm } };
    if (c.en === "piso" || c.en === "techo" || c.en === "libre") return { ...n, colocacion: { ...c, xCm: c.xCm + cm } };
    return n;
  }),
});
const globosDe = (e: Escena, id: string) => armarEscena(e).porNodo.find((n) => n.id === id)?.globos.length ?? 0;
const tamanoDe = (e: Escena, id: string) => { const c = armarEscena(e).porNodo.find((n) => n.id === id)?.caja; return c ? (c.max.x - c.min.x) * (c.max.y - c.min.y) : 0; };

function perturbaciones(e: Escena): Perturbacion[] {
  const salida: Perturbacion[] = [];
  for (const cm of [20, 50, 100]) salida.push({ nombre: `mover ${cm} cm`, magnitud: cm, familia: "mover", escena: desplazar(e, cm) });
  const porTamano = [...e.nodos].sort((a, b) => tamanoDe(e, b.id) - tamanoDe(e, a.id));
  const mayor = porTamano[0], menor = porTamano[porTamano.length - 1];
  const conGlobos = e.nodos.find((n) => globosDe(e, n.id) > 0);
  if (conGlobos) {
    const dominante = coloresDePieza(conGlobos.pieza, "uso")[0]?.codigo;
    const r = dominante ? aplicarHerramienta(e, "recolorear_escena", { reemplazar: [{ de: dominante, a: "azul" }] }) : null;
    if (r?.ok && r.escena !== e) salida.push({ nombre: "color dominante → azul", magnitud: 1, familia: "color", escena: r.escena });
  }
  if (mayor && e.nodos.length > 1) salida.push({ nombre: `quitar la pieza mayor (${mayor.nombre})`, magnitud: 2, familia: "quitar", escena: { ...e, nodos: e.nodos.filter((n) => n.id !== mayor.id) } });
  if (menor && menor !== mayor) salida.push({ nombre: `quitar la pieza menor (${menor.nombre})`, magnitud: 1, familia: "quitar", escena: { ...e, nodos: e.nodos.filter((n) => n.id !== menor.id) } });
  if (mayor) salida.push({ nombre: "agregar una copia de la mayor al lado", magnitud: 1, familia: "agregar", escena: { ...e, nodos: [...e.nodos, { ...desplazar({ ...e, nodos: [mayor] }, 120).nodos[0]!, id: "copia-calibracion", nombre: "Copia (calibración)" }] } });
  const organico = e.nodos.find((n) => n.pieza.tipo === "organico");
  if (organico && organico.pieza.tipo === "organico") {
    const { opciones } = organico.pieza;
    const achicar = (puntos: ReadonlyArray<{ x: number; y: number; z: number }>) => {
      const cx = puntos.reduce((s, p) => s + p.x, 0) / puntos.length, cy = puntos.reduce((s, p) => s + p.y, 0) / puntos.length;
      return puntos.map((p) => ({ ...p, x: cx + (p.x - cx) * 0.8, y: cy + (p.y - cy) * 0.8 }));
    };
    const pieza = { ...organico.pieza, opciones: { ...opciones, tramos: opciones.tramos.map((t) => ({ ...t, recorrido: achicar(t.recorrido) })) } };
    salida.push({ nombre: "achicar el recorrido de lo orgánico ×0,8", magnitud: 1, familia: "escala", escena: { ...e, nodos: e.nodos.map((n) => (n.id === organico.id ? { ...n, pieza } : n)) } });
  }
  return salida;
}

// ----- la corrida ---------------------------------------------------------------------------------------------------

type FilaFoto = {
  foto: number; parecidoBase: number;
  ruidoRender: number[]; ruidoApi: number[]; capturasIdenticas: boolean;
  perturbaciones: Array<{ nombre: string; familia: string; magnitud: number; parecido: number; delta: number }>;
};

async function calibrarFoto(numero: number): Promise<FilaFoto> {
  const referencia = REFERENCIAS_DUENO.find((r) => r.numero === numero);
  if (!referencia) throw new Error(`No hay lectura a mano de la foto ${numero}.`);
  const archivo = readdirSync(carpeta).find((f) => f.startsWith(`${String(numero).padStart(2, "0")}-`));
  if (!archivo) throw new Error(`No encontré la foto ${numero} en ${carpeta}.`);
  const original = new Uint8Array(readFileSync(path.join(carpeta, archivo)));
  const fotoBytes = await normalizarFoto(original);
  const lectura = referencia.lectura, encuadre = encuadreDeLectura(lectura);
  const escena = compilarLectura(lectura).escena;
  const vFoto = await embeber(fotoBytes);

  // 1. Ruido del render: N capturas de la misma escena, cada una con un navegador nuevo.
  const capturas: Uint8Array[] = [];
  for (let i = 0; i < repeticiones; i++) {
    const capturador = await abrirCapturador(url);
    try { capturas.push(bytesDe(await capturador.capturar(escena, encuadre))); } finally { await capturador.cerrar(); }
  }
  const parecidos: number[] = [];
  for (const c of capturas) parecidos.push(coseno(vFoto, await embeber(c)));
  const identicas = capturas.every((c) => Buffer.compare(Buffer.from(c), Buffer.from(capturas[0]!)) === 0);

  // 1b. Ruido de la API: los mismos bytes (la foto y la primera captura) embebidos otra vez, cada vez con la foto reembebida.
  const parecidosApi: number[] = [];
  for (let i = 0; i < repeticiones; i++) parecidosApi.push(coseno(await embeber(fotoBytes), await embeber(capturas[0]!)));

  // 2. Curva de efecto: cada perturbación contra la captura base (la primera).
  const base = parecidos[0]!;
  const capturador = await abrirCapturador(url);
  const filas: FilaFoto["perturbaciones"] = [];
  try {
    for (const p of perturbaciones(escena)) {
      const parecido = coseno(vFoto, await embeber(bytesDe(await capturador.capturar(p.escena, encuadre))));
      filas.push({ nombre: p.nombre, familia: p.familia, magnitud: p.magnitud, parecido: r4(parecido), delta: r4(parecido - base) });
      console.log(`    ${p.nombre.padEnd(48)} parecido ${parecido.toFixed(4)}  Δ ${(parecido - base).toFixed(4)}`);
    }
  } finally { await capturador.cerrar(); }

  return { foto: numero, parecidoBase: r4(base), ruidoRender: diferenciasEntrePares(parecidos).map(r4), ruidoApi: diferenciasEntrePares(parecidosApi).map(r4), capturasIdenticas: identicas, perturbaciones: filas };
}

async function main() {
  const porFoto = repeticiones * 3 + 1 + 9;
  const estimado = numeros.length * porFoto * COSTE_EMBEDDING_USD;
  console.log(`Calibración del margen · fotos ${numeros.join(", ")} · ${repeticiones} repeticiones · ~${numeros.length * porFoto} embeddings ≈ US$${estimado.toFixed(4)} (tope US$${tope})${pagar ? "" : " · EN SECO (sin --pagar no se llama a la IA)"}`);
  if (!pagar) return;
  cargarClave();
  if (!process.env.GEMINI_API_KEY) throw new Error("Falta GEMINI_API_KEY (en el entorno o con --env <archivo>).");
  const filas: FilaFoto[] = [];
  for (const n of numeros) { console.log(`Foto ${n}`); filas.push(await calibrarFoto(n)); }

  const ruidoRender = filas.flatMap((f) => f.ruidoRender), ruidoApi = filas.flatMap((f) => f.ruidoApi);
  const ruido = [...ruidoRender, ...ruidoApi];
  const resumenRuido = (v: number[]) => ({ pares: v.length, media: r4(v.reduce((s, x) => s + x, 0) / v.length), p95: r4(percentil(v, 0.95)), p99: r4(percentil(v, 0.99)), max: r4(Math.max(...v)) });
  const pisoDeRuido = percentil(ruido, 0.99);

  // Monotonía por foto: mover 20 → 50 → 100 cm tiene que bajar el parecido cada vez más.
  const monotonia = filas.map((f) => {
    const d = (cm: number) => f.perturbaciones.find((p) => p.nombre === `mover ${cm} cm`)?.delta ?? NaN;
    return { foto: f.foto, d20: d(20), d50: d(50), d100: d(100), monotona: d(20) >= d(50) && d(50) >= d(100), todasBajan: f.perturbaciones.every((p) => p.delta < 0) };
  });
  const efectos = filas.flatMap((f) => f.perturbaciones.map((p) => ({ foto: f.foto, ...p, mejoraAlDeshacer: r4(-p.delta) })));
  const efecto20 = efectos.filter((e) => e.nombre === "mover 20 cm").map((e) => e.mejoraAlDeshacer);
  const pasan = (margen: number) => efectos.filter((e) => e.mejoraAlDeshacer >= margen).length;

  const informe = {
    fecha: new Date().toISOString(), margenActual: MARGEN_MEJORA, repeticiones, fotos: numeros, embeddings, costeUsd: r4(embeddings * COSTE_EMBEDDING_USD),
    ruido: { render_y_api: resumenRuido(ruido), solo_render: resumenRuido(ruidoRender), solo_api: resumenRuido(ruidoApi), pisoP99: r4(pisoDeRuido) },
    efecto: { mejoraAl20cm: { min: r4(Math.min(...efecto20)), mediana: r4(percentil(efecto20, 0.5)), max: r4(Math.max(...efecto20)) }, perturbaciones: efectos.length, pasanElMargenActual: pasan(MARGEN_MEJORA) },
    monotonia, filas,
  };
  mkdirSync("data/exp/calibrar-margen", { recursive: true });
  const salida = path.join("data/exp/calibrar-margen", `${informe.fecha.slice(0, 19).replace(/[:T]/g, "-")}.json`);
  writeFileSync(salida, JSON.stringify(informe, null, 2));
  console.log(JSON.stringify({ ...informe, filas: undefined }, null, 2));
  console.log(`Informe: ${existsSync(salida) ? salida : "(no se pudo escribir)"}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
