/**
 * Lector de los registros JSONL de src/lib/registro. AUTOCONTENIDO a propósito (solo módulos de Node):
 * scripts/ops/ver-registros.ts lo importa para leer en local y, para el VPS, lo transpila a CommonJS y lo
 * ejecuta DENTRO del contenedor (`docker exec -i demo-decoracion node - <petición en base64>`), así el
 * filtrado ocurre allí y solo viaja lo pedido. No importar nada del proyecto aquí.
 */
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

export interface FiltrosRegistro {
  /** epoch ms */
  desde?: number;
  hasta?: number;
  /** Nivel mínimo: debug | info | warn | error. */
  nivel?: string;
  /** Uno o varios (separados por coma); coincide si el evento contiene alguno. */
  evento?: string;
  /** Prefijo del id de solicitud. */
  solicitud?: string;
  /** Prefijo del id de conversación. */
  conversacion?: string;
  /** Texto libre (sin distinguir mayúsculas) sobre la línea cruda. */
  buscar?: string;
  ultimos?: number;
}

export interface PeticionLector {
  operacion: "general" | "conversaciones" | "conversacion" | "diagnostico";
  raices: string[];
  filtros?: FiltrosRegistro;
  id?: string;
}

export interface ResumenConversacion {
  id: string;
  inicio: string;
  fin: string;
  vista?: string;
  rutas: string[];
  eventos: number;
  llamadasIa: number;
  respuestasIa: number;
  herramientas: number;
  errores: number;
  ultimoTipo: string;
  bytes: number;
  archivos: string[];
}

const NIVELES: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const DIA_MS = 24 * 60 * 60 * 1000;

function fechaUtc(momento: number): string {
  return new Date(momento).toISOString().slice(0, 10);
}

export function fechasEntre(desde: number, hasta: number): string[] {
  const fechas: string[] = [];
  const fin = fechaUtc(hasta);
  for (let momento = desde, vueltas = 0; vueltas < 400; momento += DIA_MS, vueltas += 1) {
    const fecha = fechaUtc(momento);
    fechas.push(fecha);
    if (fecha >= fin) break;
  }
  if (!fechas.includes(fin)) fechas.push(fin);
  return fechas;
}

async function recorrerLineas(archivo: string, visitar: (linea: string) => void): Promise<void> {
  const lector = createInterface({ input: createReadStream(archivo, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const linea of lector) {
    if (linea.trim()) visitar(linea);
  }
}

function parsear(linea: string): Record<string, unknown> | undefined {
  try {
    const valor: unknown = JSON.parse(linea);
    return typeof valor === "object" && valor !== null && !Array.isArray(valor) ? (valor as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

/** ¿La línea (general o de auditoría) cumple los filtros? */
export function coincideLinea(linea: string, filtros: FiltrosRegistro): boolean {
  if (filtros.buscar && !linea.toLowerCase().includes(filtros.buscar.toLowerCase())) return false;
  const objeto = parsear(linea);
  if (!objeto) return !filtros.nivel && !filtros.evento && !filtros.solicitud && !filtros.conversacion && filtros.desde === undefined;
  const ts = Date.parse(texto(objeto.ts));
  if (filtros.desde !== undefined && Number.isFinite(ts) && ts < filtros.desde) return false;
  if (filtros.hasta !== undefined && Number.isFinite(ts) && ts > filtros.hasta) return false;
  if (filtros.nivel) {
    const minimo = NIVELES[filtros.nivel] ?? 0;
    const nivel = NIVELES[texto(objeto.nivel)] ?? (texto(objeto.tipo) === "error" ? 40 : 20);
    if (nivel < minimo) return false;
  }
  if (filtros.evento) {
    const evento = texto(objeto.evento) || texto(objeto.tipo);
    const terminos = filtros.evento.split(",").map((termino) => termino.trim()).filter(Boolean);
    if (!terminos.some((termino) => evento.includes(termino))) return false;
  }
  if (filtros.solicitud && !texto(objeto.solicitud).startsWith(filtros.solicitud)) return false;
  if (filtros.conversacion && !texto(objeto.conversacion).startsWith(filtros.conversacion)) return false;
  return true;
}

function ordenarPorTs(lineas: string[]): string[] {
  const conTs = lineas.map((linea, indice) => {
    const objeto = parsear(linea);
    return { linea, indice, ts: texto(objeto?.ts), seq: typeof objeto?.seq === "number" ? objeto.seq : 0 };
  });
  conTs.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.seq - b.seq || a.indice - b.indice));
  return conTs.map((item) => item.linea);
}

/** Líneas del registro general que cumplen los filtros (las últimas N, en orden cronológico). */
export async function leerGeneral(raices: string[], filtros: FiltrosRegistro): Promise<string[]> {
  const hasta = filtros.hasta ?? Date.now();
  const desde = filtros.desde ?? hasta - 60 * 60 * 1000;
  const maximo = Math.max(1, filtros.ultimos ?? 200);
  let resultado: string[] = [];
  for (const raiz of raices) {
    for (const fecha of fechasEntre(desde, hasta)) {
      const archivo = join(raiz, "general", `next-${fecha}.jsonl`);
      if (!existsSync(archivo)) continue;
      await recorrerLineas(archivo, (linea) => {
        if (!coincideLinea(linea, { ...filtros, desde, hasta })) return;
        resultado.push(linea);
        if (resultado.length > maximo * 2) resultado = resultado.slice(-maximo);
      });
    }
  }
  return ordenarPorTs(resultado).slice(-maximo);
}

function archivosDeConversacion(raices: string[], fechas?: Set<string>): Map<string, string[]> {
  const porId = new Map<string, string[]>();
  for (const raiz of raices) {
    const base = join(raiz, "conversaciones");
    let dias: string[];
    try {
      dias = readdirSync(base).filter((nombre) => /^\d{4}-\d{2}-\d{2}$/.test(nombre));
    } catch {
      continue;
    }
    for (const dia of dias) {
      if (fechas && !fechas.has(dia)) continue;
      let nombres: string[];
      try {
        nombres = readdirSync(join(base, dia)).filter((nombre) => nombre.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const nombre of nombres) {
        const id = nombre.slice(0, -".jsonl".length);
        const lista = porId.get(id) ?? [];
        lista.push(join(base, dia, nombre));
        porId.set(id, lista);
      }
    }
  }
  return porId;
}

const RE_TS = /"ts":"([^"]+)"/;
const RE_TIPO = /"tipo":"([a-z_]+)"/;
const RE_VISTA = /"vista":"([^"]+)"/;
const RE_RUTA = /"ruta":"([^"]+)"/;

async function resumir(id: string, archivos: string[]): Promise<ResumenConversacion> {
  const resumen: ResumenConversacion = { id, inicio: "", fin: "", rutas: [], eventos: 0, llamadasIa: 0, respuestasIa: 0, herramientas: 0, errores: 0, ultimoTipo: "", bytes: 0, archivos };
  const rutas = new Set<string>();
  for (const archivo of archivos) {
    try {
      resumen.bytes += statSync(archivo).size;
    } catch {
      // Borrado entre medias.
    }
    await recorrerLineas(archivo, (linea) => {
      // Las líneas de auditoría empiezan con {"ts","seq","tipo","solicitud","conversacion","vista"?,"ruta"?…}: bastan expresiones sobre el comienzo.
      const cabeza = linea.slice(0, 400);
      const ts = RE_TS.exec(cabeza)?.[1] ?? "";
      const tipo = RE_TIPO.exec(cabeza)?.[1] ?? "";
      resumen.eventos += 1;
      if (ts && (!resumen.inicio || ts < resumen.inicio)) resumen.inicio = ts;
      if (ts && ts >= resumen.fin) {
        resumen.fin = ts;
        resumen.ultimoTipo = tipo;
      }
      if (!resumen.vista) resumen.vista = RE_VISTA.exec(cabeza)?.[1];
      const ruta = RE_RUTA.exec(cabeza)?.[1];
      if (ruta && rutas.size < 8) rutas.add(ruta);
      if (tipo === "llamada_ia") resumen.llamadasIa += 1;
      else if (tipo === "respuesta_ia") resumen.respuestasIa += 1;
      else if (tipo === "herramienta") resumen.herramientas += 1;
      if (tipo === "error" || linea.includes("\"error\":{\"nombre\"")) resumen.errores += 1;
    });
  }
  resumen.rutas = [...rutas];
  if (!resumen.vista) delete resumen.vista;
  return resumen;
}

/** Conversaciones con actividad en la ventana pedida, la más reciente primero. */
export async function listarConversaciones(raices: string[], filtros: FiltrosRegistro): Promise<ResumenConversacion[]> {
  const hasta = filtros.hasta ?? Date.now();
  const desde = filtros.desde ?? hasta - DIA_MS;
  // Una conversación vive en la carpeta del día en que empezó: se mira un día antes de `desde`.
  const fechas = new Set(fechasEntre(desde - DIA_MS, hasta));
  const resumenes: ResumenConversacion[] = [];
  for (const [id, archivos] of archivosDeConversacion(raices, fechas)) {
    if (filtros.conversacion && !id.startsWith(filtros.conversacion)) continue;
    const resumen = await resumir(id, archivos);
    if (resumen.fin && Date.parse(resumen.fin) < desde) continue;
    if (filtros.buscar && !id.toLowerCase().includes(filtros.buscar.toLowerCase()) && !(resumen.vista ?? "").includes(filtros.buscar)) continue;
    resumenes.push(resumen);
  }
  resumenes.sort((a, b) => (a.fin < b.fin ? 1 : a.fin > b.fin ? -1 : 0));
  return resumenes.slice(0, Math.max(1, filtros.ultimos ?? 50));
}

/** Todas las líneas de una conversación (todos los días y raíces), en orden. Acepta un prefijo único del id. */
export async function leerConversacion(raices: string[], id: string): Promise<{ id?: string; lineas: string[]; candidatos: string[] }> {
  const todos = archivosDeConversacion(raices);
  let elegido = todos.has(id) ? id : undefined;
  const candidatos = elegido ? [] : [...todos.keys()].filter((clave) => clave.startsWith(id)).sort();
  if (!elegido && candidatos.length === 1) elegido = candidatos[0];
  if (!elegido) return { lineas: [], candidatos: candidatos.slice(0, 50) };
  const lineas: string[] = [];
  for (const archivo of (todos.get(elegido) ?? []).sort()) await recorrerLineas(archivo, (linea) => lineas.push(linea));
  return { id: elegido, lineas: ordenarPorTs(lineas), candidatos: [] };
}

export function diagnostico(raices: string[]): Record<string, unknown> {
  return {
    raices: raices.map((raiz) => {
      const general = join(raiz, "general");
      const conversaciones = join(raiz, "conversaciones");
      const listar = (carpeta: string): string[] => {
        try {
          return readdirSync(carpeta).sort();
        } catch {
          return [];
        }
      };
      return { raiz, existe: existsSync(raiz), general: listar(general).slice(-5), diasConversaciones: listar(conversaciones).slice(-5) };
    }),
  };
}

/** Punto de entrada remoto: argumento = PeticionLector en base64. Escribe JSONL en stdout. */
export async function main(argumento: string | undefined): Promise<void> {
  try {
    const peticion = JSON.parse(Buffer.from(argumento ?? "", "base64").toString("utf8")) as PeticionLector;
    const filtros = peticion.filtros ?? {};
    const escribir = (linea: string): void => {
      process.stdout.write(`${linea}\n`);
    };
    if (peticion.operacion === "general") {
      for (const linea of await leerGeneral(peticion.raices, filtros)) escribir(linea);
    } else if (peticion.operacion === "conversaciones") {
      for (const resumen of await listarConversaciones(peticion.raices, filtros)) escribir(JSON.stringify(resumen));
    } else if (peticion.operacion === "conversacion") {
      const resultado = await leerConversacion(peticion.raices, peticion.id ?? "");
      escribir(JSON.stringify({ __lector: "conversacion", id: resultado.id ?? null, candidatos: resultado.candidatos, lineas: resultado.lineas.length }));
      for (const linea of resultado.lineas) escribir(linea);
    } else {
      escribir(JSON.stringify(diagnostico(peticion.raices)));
    }
  } catch (error) {
    process.stderr.write(`lector: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
