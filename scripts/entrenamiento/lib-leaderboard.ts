/**
 * Lee los registros de las corridas y escribe la tabla por foto. Cada modo tiene su propio leaderboard: el real agrega solo
 * corridas `real`; el de seco, solo `seco` (sus valores son marcadores, no medidas). Cada fila es la última corrida terminada
 * de la foto con las comparables a ella; las abortadas y los errores sin clasificar no entran. Las filas se ordenan por la última corrida.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { agregarPorFoto, contarOmitidas, type FilaFoto, type ModoPasada, type RegistroPasada } from "./lib-agregado";

const numero = (n: number | null) => (n === null ? "—" : n.toFixed(2));

/** Un registro por foto y corrida: `<corrida>/<foto>.json` con `{ registro, escena }`. Solo las carpetas de corrida (nombradas por fecha). */
export function cargarRegistros(raizCorridas: string, modo: ModoPasada): RegistroPasada[] {
  if (!existsSync(raizCorridas)) return [];
  return readdirSync(raizCorridas, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(d.name))
    .flatMap((d) => readdirSync(path.join(raizCorridas, d.name))
      .filter((f) => f.endsWith(".json") && f !== "resumen.json")
      .map((f) => (JSON.parse(readFileSync(path.join(raizCorridas, d.name, f), "utf8")) as { registro: RegistroPasada }).registro))
    .filter((r) => r.modo === modo);
}

/** Filas del leaderboard: la última corrida primero (`rank` 1 = la más reciente). */
export function ordenarPorUltimaCorrida(filas: readonly FilaFoto[]): FilaFoto[] {
  return [...filas].sort((a, b) => b.ultimaCorrida.iniciadaEn.localeCompare(a.ultimaCorrida.iniciadaEn));
}

export function renderizarLeaderboard(filas: readonly FilaFoto[], modo: ModoPasada, generadoEn: string, omitidas = 0): string {
  const cabecera = [
    `# Leaderboard del arnés de entrenamiento (fotos del dueño, modo ${modo})`,
    "",
    `Generado: ${generadoEn}. Fuente: la carpeta de corridas del arnés (ENTRENAMIENTO_CORRIDAS). Orden: la última corrida primero.`,
    "Cada fila es la última corrida terminada de la foto y las corridas comparables con ella (mismo modelo, transporte, esfuerzo y razonamiento, tope de vueltas y commit; un commit `+dirty`, con cambios sin confirmar, no se agrupa).",
    `Omitidas: ${omitidas} corridas abortadas (tope de gasto o de llamadas) o con un error del arnés sin clasificar; sus registros siguen en la carpeta de la corrida. Los fallos del pipeline (lectura, medida, asistente) sí cuentan y salen en «Fallo dominante».`,
    ...(modo === "seco" ? ["**Dry-run `--seco`: los valores son marcadores de prueba, no medidas de la IA.** Las respuestas del modelo son grabadas y el coste es simulado."] : []),
    "Captura del visor: pendiente en todas las filas (TODO: `lib-captura-sin-cabeza` necesita el servidor de desarrollo; el refinado va por texto sin captura).",
    "",
    "| # | Foto | Corridas | Proporciones | Colores | Zonas | IoU | Fallo dominante | Última corrida | Modelo | Esfuerzo | Transporte | Vueltas | Commit | Coste USD |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  const cuerpo = ordenarPorUltimaCorrida(filas).map((f, i) => {
    const u = f.ultimaCorrida;
    return `| ${i + 1} | ${f.foto} | ${f.corridas} | ${numero(f.puntajes.proporciones)} | ${numero(f.puntajes.colores)} | ${numero(f.puntajes.zonas)} | ${numero(f.puntajes.iou)} | ${f.fallo} | ${u.iniciadaEn} | ${u.modelo} | ${u.esfuerzo}${u.pensamiento ? "" : " sin razonamiento"} | ${u.transporte} | ${u.turnos}/${u.turnosMax} | ${u.commit} | ${f.costeUsd.toFixed(4)} |`;
  });
  return [...cabecera, ...cuerpo, ""].join("\n");
}

export function construirLeaderboard(raizCorridas: string, modo: ModoPasada, generadoEn: string): string {
  const registros = cargarRegistros(raizCorridas, modo);
  return renderizarLeaderboard(agregarPorFoto(registros), modo, generadoEn, contarOmitidas(registros));
}

/**
 * Dónde se escribe el leaderboard. El real va a la ruta indicada o, por defecto, a la de la bitácora; el de seco son
 * marcadores de prueba y nunca va a la bitácora: se escribe al lado de la ruta indicada o, sin ella, en la carpeta de corridas.
 */
export function rutaDelLeaderboard(entrada: { seco: boolean; indicada: string | undefined; porDefecto: string; raizCorridas: string }): string {
  if (!entrada.seco) return entrada.indicada ?? entrada.porDefecto;
  return path.join(entrada.indicada ? path.dirname(entrada.indicada) : entrada.raizCorridas, "LEADERBOARD-seco.md");
}
