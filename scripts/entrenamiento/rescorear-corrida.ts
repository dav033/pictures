/**
 * Vuelve a puntuar, sin llamadas de pago, la escena final guardada de cada foto de una corrida real con la métrica de
 * `lib-puntuacion.ts`: con todos los globos armados (la de antes) y con solo los visibles. La verdad sale de lo que ya
 * quedó en disco: la lectura cruda del lector (auditoría), la detección (caché) y la escena final (`images (N).json`).
 * Para que la cámara sea la de la corrida, la lectura se mide con la política de escala de entonces (la escala medida que
 * anotó la auditoría); la política nueva se informa aparte.
 *
 *   npx tsx --conditions=react-server scripts/entrenamiento/rescorear-corrida.ts <carpeta-de-la-corrida> [--json]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Escena } from "@/lib/globos3d/escena";
import { LecturaFotoSchema } from "@/lib/globos3d/lectura-foto";
import { medirConDetecciones } from "@/lib/globos3d/medir-con-detecciones";
import type { DeteccionGuardada } from "./lib-cache-deteccion";
import { elegirDeteccion, rescorearTodas } from "./lib-rescorear";
import { directorioDeCorridas } from "./lib-rutas";
import { puntuarEscena } from "./lib-puntuacion";

type EventoAuditoria = { tipo: string; datos: { proposito?: string; llamadasHerramientas?: Array<{ nombre: string; argumentos: unknown }>; quien?: string; resultado?: Record<string, unknown> } };

const lineas = (archivo: string): EventoAuditoria[] => readFileSync(archivo, "utf8").trim().split("\n").map((l) => JSON.parse(l) as EventoAuditoria);

/** El archivo de auditoría de la conversación de una pasada, en cualquier carpeta de fecha. */
function auditoriaDe(raiz: string, corrida: string, nombre: string): string | null {
  const base = path.join(raiz, "registro", "conversaciones");
  for (const dia of readdirSync(base)) {
    const archivo = path.join(base, dia, `entrenamiento-${corrida}-${nombre.replace(/\.jpg$/, "").replace(/[ ()]/g, (c) => (c === " " ? "-" : ""))}.jsonl`);
    if (existsSync(archivo)) return archivo;
  }
  return null;
}

/** Las detecciones de la caché, leídas una vez. */
const leerCache = (raiz: string): DeteccionGuardada[] => {
  const dir = path.join(raiz, "cache-deteccion");
  return readdirSync(dir).map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as DeteccionGuardada);
};

type Fila = { foto: string; globosFoto: number; globosArmados: number; globosVisibles: number; propViejo: number | null; propTodos: number | null; propVisibles: number | null; iouTodos: number | null; iouVisibles: number | null; escalaLeida: number; escalaVieja: number; escalaNueva: number; fuente: string };

function rescorear(raiz: string, corrida: string, archivo: string, cache: readonly DeteccionGuardada[]): Fila {
  const guardado = JSON.parse(readFileSync(path.join(raiz, corrida, archivo), "utf8")) as { registro: { foto: string; puntajes: { proporciones: number | null } }; escena: Escena };
  const foto = guardado.registro.foto;
  const auditoria = auditoriaDe(raiz, corrida, foto.replace(/\.jpg$/, ""));
  if (!auditoria) throw new Error(`Sin auditoría para ${foto}`);
  const eventos = lineas(auditoria);
  const lecturas = eventos.filter((e) => e.tipo === "respuesta_ia" && e.datos.proposito === "lectura_foto_escena");
  const cruda = lecturas[lecturas.length - 1]?.datos.llamadasHerramientas?.find((h) => h.nombre === "responder_json")?.argumentos;
  const lectura = LecturaFotoSchema.parse(cruda);
  const detectado = eventos.find((e) => e.datos.quien === "modelo:deteccion_globos" && Array.isArray(e.datos.resultado?.fondos))?.datos.resultado as { globos: number; fondos: string[] } | undefined;
  const medido = eventos.find((e) => e.datos.quien === "regla:foto_medida_con_detecciones")?.datos.resultado as { escalaMedidaCm: number } | undefined;
  if (!detectado || !medido) throw new Error(`La auditoría de ${foto} no trae la detección o la medida`);
  const deteccion = elegirDeteccion(cache, foto, detectado);
  const nueva = medirConDetecciones(lectura, deteccion.globos, deteccion.fondos);
  const deEntonces = { ...nueva.lectura, escala: { ...nueva.lectura.escala, altoImagenCm: medido.escalaMedidaCm } };
  const p = puntuarEscena({ lectura: deEntonces, escena: guardado.escena, deteccion });
  return {
    foto, globosFoto: p.piezas.globosFoto, globosArmados: p.piezas.globosArmados, globosVisibles: p.piezas.globosArmadosVisibles,
    propViejo: guardado.registro.puntajes.proporciones, propTodos: p.puntajesTodos.proporciones, propVisibles: p.puntajes.proporciones,
    iouTodos: p.puntajesTodos.iou, iouVisibles: p.puntajes.iou,
    escalaLeida: lectura.escala.altoImagenCm, escalaVieja: medido.escalaMedidaCm, escalaNueva: nueva.lectura.escala.altoImagenCm, fuente: nueva.escala?.fuente ?? "-",
  };
}

function main(): void {
  const carpeta = process.argv[2];
  if (!carpeta) throw new Error("Falta la carpeta de la corrida (nombre dentro de las corridas o ruta).");
  const raiz = directorioDeCorridas();
  const corrida = path.basename(carpeta);
  const archivos = readdirSync(path.join(raiz, corrida)).filter((f) => /^images \(\d+\)\.json$/.test(f)).sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]));
  const cache = leerCache(raiz);
  const { filas, errores } = rescorearTodas(archivos, (a) => rescorear(raiz, corrida, a, cache));
  for (const e of errores) console.error(`${e.archivo}: ${e.error}`);
  if (process.argv.includes("--json")) { console.log(JSON.stringify(filas, null, 1)); return; }
  const n = (v: number | null) => (v === null ? "  -  " : v.toFixed(3));
  console.log("foto | globos foto | armados todos -> visibles | proporciones registrada / todos / visibles | iou todos -> visibles | escala leida / vieja / nueva (fuente)");
  for (const f of filas) console.log(`${f.foto.replace(".jpg", "")} | ${f.globosFoto} | ${f.globosArmados} -> ${f.globosVisibles} (${(f.globosArmados / f.globosFoto).toFixed(1)}x -> ${(f.globosVisibles / f.globosFoto).toFixed(1)}x) | ${n(f.propViejo)} / ${n(f.propTodos)} / ${n(f.propVisibles)} | ${n(f.iouTodos)} -> ${n(f.iouVisibles)} | ${f.escalaLeida} / ${f.escalaVieja} / ${f.escalaNueva} (${f.fuente})`);
  const media = (v: Array<number | null>) => { const x = v.filter((y): y is number => y !== null); return x.length ? x.reduce((s, y) => s + y, 0) / x.length : null; };
  console.log(`MEDIA proporciones: registrada ${n(media(filas.map((f) => f.propViejo)))} / todos ${n(media(filas.map((f) => f.propTodos)))} / visibles ${n(media(filas.map((f) => f.propVisibles)))}`);
}

main();
