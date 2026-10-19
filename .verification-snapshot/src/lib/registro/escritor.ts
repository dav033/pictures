import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { configuracion } from "./configuracion";
import { versionCodigo } from "./version";

/**
 * Escritura de archivos JSONL con cola asíncrona: `escribirLinea` solo encola (nunca espera ni lanza); un
 * único trabajador agrupa por archivo y hace un `appendFile` por lote. Rotación diaria por nombre de archivo,
 * retención por fecha, tope por archivo (general: por día; conversación: por archivo), y degradación a una
 * raíz alterna (tmpdir) o a solo-stdout si el disco falla.
 */

export type DestinoArchivo = "general" | "conversacion";

interface Pendiente {
  relativa: string;
  linea: string;
  destino: DestinoArchivo;
}

interface EstadoEscritor {
  cola: Pendiente[];
  bytesEnCola: number;
  programado: boolean;
  trabajo: Promise<void> | null;
  limpieza: Promise<void> | null;
  tamanos: Map<string, number>;
  topados: Set<string>;
  dirsListos: Set<string>;
  raizActiva: string | null;
  modo: "principal" | "alterna" | "desactivado";
  descartadas: number;
  ultimaLimpieza: number;
  avisos: Set<string>;
  fechaPorConversacion: Map<string, string>;
}

declare global {
  var __registroEscritor: EstadoEscritor | undefined;
}

const MAX_LINEAS_EN_COLA = 20_000;
const MAX_BYTES_EN_COLA = 64 * 1024 * 1024;
const INTERVALO_LIMPIEZA_MS = 6 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;
// ENOENT/EEXIST: en Windows, crear la carpeta a través de un archivo da esos códigos en vez de ENOTDIR.
const CODIGOS_DEGRADAN = new Set(["EACCES", "EPERM", "EROFS", "ENOTDIR", "ENOSPC", "EDQUOT", "ENOENT", "EEXIST"]);

function estadoNuevo(): EstadoEscritor {
  return {
    cola: [],
    bytesEnCola: 0,
    programado: false,
    trabajo: null,
    limpieza: null,
    tamanos: new Map(),
    topados: new Set(),
    dirsListos: new Set(),
    raizActiva: null,
    modo: "principal",
    descartadas: 0,
    ultimaLimpieza: 0,
    avisos: new Set(),
    fechaPorConversacion: new Map(),
  };
}

function estado(): EstadoEscritor {
  if (!globalThis.__registroEscritor) globalThis.__registroEscritor = estadoNuevo();
  return globalThis.__registroEscritor;
}

/** AAAA-MM-DD en UTC. */
export function fechaUtc(momento: Date | number = Date.now()): string {
  return new Date(momento).toISOString().slice(0, 10);
}

export function rutaGeneral(momento: Date | number = Date.now()): string {
  return path.join("general", `next-${fechaUtc(momento)}.jsonl`);
}

function raizActual(): string {
  const actual = estado();
  return actual.raizActiva ?? configuracion().raiz;
}

/**
 * Carpeta del día en que la conversación empezó, mientras el proceso viva: una conversación que cruza la
 * medianoche no se parte en dos archivos (si el proceso reinicia, el lector junta los días igualmente).
 */
export function rutaConversacion(idConversacion: string, momento: Date | number = Date.now()): string {
  const actual = estado();
  let fecha = actual.fechaPorConversacion.get(idConversacion);
  if (!fecha) {
    const hoy = fechaUtc(momento);
    const ayer = fechaUtc(new Date(momento).getTime() - DIA_MS);
    fecha = hoy;
    try {
      const raiz = raizActual();
      const archivo = `${idConversacion}.jsonl`;
      if (!existsSync(path.join(raiz, "conversaciones", hoy, archivo)) && existsSync(path.join(raiz, "conversaciones", ayer, archivo))) fecha = ayer;
    } catch {
      // Sin disco: el día de hoy.
    }
    if (actual.fechaPorConversacion.size > 5_000) actual.fechaPorConversacion.clear();
    actual.fechaPorConversacion.set(idConversacion, fecha);
  }
  return path.join("conversaciones", fecha, `${idConversacion}.jsonl`);
}

function avisoUnaVez(clave: string, evento: string, datos: Record<string, unknown>): void {
  const actual = estado();
  if (actual.avisos.has(clave)) return;
  actual.avisos.add(clave);
  try {
    const linea = JSON.stringify({ ts: new Date().toISOString(), nivel: "warn", servicio: "next", entorno: configuracion().entorno, version: versionCodigo().corta, evento, datos });
    console.warn(linea);
    if (actual.modo !== "desactivado") encolar({ relativa: rutaGeneral(), linea, destino: "general" });
  } catch {
    // Nada que hacer: el aviso es lo único que podía fallar aquí.
  }
}

function encolar(pendiente: Pendiente): void {
  const actual = estado();
  if (actual.cola.length >= MAX_LINEAS_EN_COLA || actual.bytesEnCola > MAX_BYTES_EN_COLA) {
    actual.descartadas += 1;
    return;
  }
  actual.cola.push(pendiente);
  actual.bytesEnCola += pendiente.linea.length;
  if (!actual.programado) {
    actual.programado = true;
    setImmediate(() => {
      actual.programado = false;
      despertar();
    });
  }
}

/** Encola una línea (sin salto final) para `<raíz>/<relativa>`. Nunca lanza ni espera. */
export function escribirLinea(destino: DestinoArchivo, relativa: string, linea: string): void {
  try {
    const cfg = configuracion();
    if (!cfg.archivosActivos || estado().modo === "desactivado") return;
    encolar({ relativa, linea, destino });
  } catch {
    // El registro nunca rompe a quien registra.
  }
}

function despertar(): void {
  const actual = estado();
  if (actual.trabajo) return;
  actual.trabajo = (async () => {
    try {
      while (actual.cola.length) {
        const lote = actual.cola.splice(0, actual.cola.length);
        actual.bytesEnCola = actual.cola.reduce((total, item) => total + item.linea.length, 0);
        await escribirLote(lote);
      }
    } catch {
      // escribirLote ya absorbe sus fallos; esto es solo un cinturón.
    } finally {
      actual.trabajo = null;
    }
    if (actual.cola.length) despertar();
  })();
}

function codigoDe(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "DESCONOCIDO";
}

async function escribirLote(lote: Pendiente[]): Promise<void> {
  const actual = estado();
  const grupos = new Map<string, Pendiente[]>();
  for (const item of lote) {
    const grupo = grupos.get(item.relativa);
    if (grupo) grupo.push(item);
    else grupos.set(item.relativa, [item]);
  }
  for (const [relativa, items] of grupos) {
    if (actual.modo === "desactivado") {
      actual.descartadas += items.length;
      continue;
    }
    try {
      await escribirGrupo(raizActual(), relativa, items);
    } catch (error) {
      const codigo = codigoDe(error);
      if (!CODIGOS_DEGRADAN.has(codigo)) {
        actual.descartadas += items.length;
        avisoUnaVez(`fallo:${codigo}`, "registro.escritura_fallida", { codigo, archivo: relativa });
        continue;
      }
      const desde = raizActual();
      if (actual.modo === "principal") {
        actual.modo = "alterna";
        actual.raizActiva = configuracion().raizAlterna;
        actual.dirsListos.clear();
        actual.tamanos.clear();
        avisoUnaVez("dir_degradado", "registro.dir_degradado", {
          desde, hacia: actual.raizActiva, codigo,
          mensaje: "La raíz de registros no se puede escribir; se usa la alterna (efímera en contenedores).",
        });
        try {
          await escribirGrupo(raizActual(), relativa, items);
          continue;
        } catch (segundo) {
          actual.modo = "desactivado";
          actual.descartadas += items.length;
          avisoUnaVez("desactivado", "registro.archivos_desactivados", { codigo: codigoDe(segundo), mensaje: "Sin disco escribible: los registros solo salen por stdout." });
          continue;
        }
      }
      actual.modo = "desactivado";
      actual.descartadas += items.length;
      avisoUnaVez("desactivado", "registro.archivos_desactivados", { codigo, mensaje: "Sin disco escribible: los registros solo salen por stdout." });
    }
  }
  if (actual.modo !== "desactivado") programarLimpieza(raizActual());
}

async function escribirGrupo(raiz: string, relativa: string, items: Pendiente[]): Promise<void> {
  const actual = estado();
  const cfg = configuracion();
  const absoluta = path.join(raiz, relativa);
  if (actual.topados.has(absoluta)) {
    actual.descartadas += items.length;
    return;
  }
  const carpeta = path.dirname(absoluta);
  if (!actual.dirsListos.has(carpeta)) {
    await mkdir(carpeta, { recursive: true });
    actual.dirsListos.add(carpeta);
  }
  let tamano = actual.tamanos.get(absoluta);
  if (tamano === undefined) tamano = await stat(absoluta).then((datos) => datos.size, () => 0);
  const destino = items[0]?.destino ?? "general";
  const tope = destino === "conversacion" ? cfg.topeConversacionBytes : cfg.topeGeneralBytesDia;
  const partes: string[] = [];
  let bytes = 0;
  let topado = false;
  for (const item of items) {
    const tamanoLinea = Buffer.byteLength(item.linea, "utf8") + 1;
    if (tamano + bytes + tamanoLinea > tope) {
      topado = true;
      break;
    }
    partes.push(item.linea);
    bytes += tamanoLinea;
  }
  if (topado) {
    const ts = new Date().toISOString();
    const aviso = destino === "conversacion"
      ? JSON.stringify({ ts, seq: 0, tipo: "aviso", solicitud: "registro", conversacion: path.basename(absoluta, ".jsonl"), datos: { motivo: "tope_conversacion", topeBytes: tope, mensaje: "Tope del archivo alcanzado: a partir de aquí solo hay resúmenes en el registro general." } })
      : JSON.stringify({ ts, nivel: "warn", servicio: "next", entorno: cfg.entorno, evento: "registro.tope_diario", datos: { topeBytes: tope, mensaje: "Tope diario del registro general alcanzado: el resto del día solo sale por stdout." } });
    partes.push(aviso);
    actual.topados.add(absoluta);
    actual.descartadas += items.length - partes.length + 1;
    try {
      console.warn(JSON.stringify({ ts, nivel: "warn", servicio: "next", entorno: cfg.entorno, evento: destino === "conversacion" ? "registro.tope_conversacion" : "registro.tope_diario", datos: { archivo: relativa, topeBytes: tope } }));
    } catch {
      // stdout cerrado: nada más que hacer.
    }
  }
  if (!partes.length) return;
  const texto = `${partes.join("\n")}\n`;
  await appendFile(absoluta, texto, "utf8");
  actual.tamanos.set(absoluta, tamano + Buffer.byteLength(texto, "utf8"));
}

function programarLimpieza(raiz: string): void {
  const actual = estado();
  if (actual.limpieza || Date.now() - actual.ultimaLimpieza < INTERVALO_LIMPIEZA_MS) return;
  actual.ultimaLimpieza = Date.now();
  const cfg = configuracion();
  actual.limpieza = limpiarAntiguos(raiz, { retencionGeneralDias: cfg.retencionGeneralDias, retencionConversacionesDias: cfg.retencionConversacionesDias })
    .then(() => undefined, () => undefined)
    .finally(() => {
      actual.limpieza = null;
    });
}

/**
 * Borra los archivos generales y las carpetas de conversaciones con fecha anterior a hoy − N días (por el
 * nombre, no por mtime). Devuelve lo borrado. Exportado para pruebas.
 */
export async function limpiarAntiguos(
  raiz: string,
  retencion: { retencionGeneralDias: number; retencionConversacionesDias: number },
  ahora: Date = new Date(),
): Promise<string[]> {
  const borrados: string[] = [];
  const corteGeneral = fechaUtc(ahora.getTime() - retencion.retencionGeneralDias * DIA_MS);
  const corteConversaciones = fechaUtc(ahora.getTime() - retencion.retencionConversacionesDias * DIA_MS);
  const general = path.join(raiz, "general");
  for (const nombre of await readdir(general).catch(() => [] as string[])) {
    const fecha = /^next-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(nombre)?.[1];
    if (fecha && fecha < corteGeneral) {
      await rm(path.join(general, nombre), { force: true }).then(() => borrados.push(path.join("general", nombre)), () => undefined);
    }
  }
  const conversaciones = path.join(raiz, "conversaciones");
  for (const nombre of await readdir(conversaciones).catch(() => [] as string[])) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(nombre) && nombre < corteConversaciones) {
      await rm(path.join(conversaciones, nombre), { recursive: true, force: true }).then(() => borrados.push(path.join("conversaciones", nombre)), () => undefined);
    }
  }
  return borrados;
}

/** Espera a que la cola quede vacía (pruebas, cierre ordenado). Nunca lanza. */
export async function esperarRegistros(): Promise<void> {
  const actual = estado();
  for (let vuelta = 0; vuelta < 1_000; vuelta += 1) {
    if (actual.cola.length && !actual.trabajo) despertar();
    if (actual.trabajo) {
      await actual.trabajo.catch(() => undefined);
      continue;
    }
    if (actual.limpieza) {
      await actual.limpieza;
      continue;
    }
    if (!actual.cola.length) return;
    await new Promise((resolver) => setImmediate(resolver));
  }
}

export interface DiagnosticoEscritor {
  raizActiva: string;
  modo: EstadoEscritor["modo"];
  descartadas: number;
  enCola: number;
}

export function diagnosticoEscritor(): DiagnosticoEscritor {
  const actual = estado();
  return { raizActiva: raizActual(), modo: actual.modo, descartadas: actual.descartadas, enCola: actual.cola.length };
}

/** Solo pruebas: olvida el estado (raíz activa, tamaños, topes, avisos). */
export function reiniciarEscritorParaPruebas(): void {
  globalThis.__registroEscritor = estadoNuevo();
}
