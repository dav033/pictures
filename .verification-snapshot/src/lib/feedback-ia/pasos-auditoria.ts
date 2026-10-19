import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { configuracion } from "@/lib/registro/configuracion";
import type { PasoAuditado } from "./contrato";

/**
 * Pasos y llamadas a herramientas de UN turno de la IA, sacados del archivo de auditoría de su conversación
 * (src/lib/registro, JSONL por conversación) filtrando por el `x-request-id` del turno. Se copian a la fila al registrar
 * el turno porque la auditoría rota (30 días) y en Vercel vive en /tmp; si el archivo no está, el turno se guarda igual.
 */

const TIPOS_DE_PASO = new Set(["herramienta", "decision", "llamada_ia", "respuesta_ia", "error", "aviso"]);
const MAX_PASOS = 100;
const MAX_RESUMEN = 300;
const DIAS_A_BUSCAR = 3;

type Objeto = Record<string, unknown>;

function esObjeto(valor: unknown): valor is Objeto {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function recortar(texto: string): string {
  return texto.length > MAX_RESUMEN ? `${texto.slice(0, MAX_RESUMEN - 1)}…` : texto;
}

function comoTexto(valor: unknown): string {
  if (typeof valor === "string") return valor;
  try {
    return JSON.stringify(valor) ?? "";
  } catch {
    return "";
  }
}

/** Una línea de auditoría → un paso legible, o `null` si no es un paso (entradas, salidas, python, http...). */
export function pasoDesdeLinea(linea: unknown): PasoAuditado | null {
  if (!esObjeto(linea) || typeof linea.tipo !== "string" || typeof linea.ts !== "string" || !TIPOS_DE_PASO.has(linea.tipo)) return null;
  const datos = esObjeto(linea.datos) ? linea.datos : {};
  const ms = typeof linea.ms === "number" ? Math.round(linea.ms) : typeof datos.ms === "number" ? Math.round(datos.ms) : undefined;
  const base = { ts: linea.ts, tipo: linea.tipo, ...(ms !== undefined ? { ms } : {}) };

  switch (linea.tipo) {
    case "herramienta":
      return { ...base, nombre: String(datos.nombre ?? "herramienta"), resumen: recortar(`${datos.ok === false ? "falló" : "ok"} ${comoTexto(datos.argumentos)}`.trim()) };
    case "decision":
      return { ...base, nombre: String(datos.quien ?? "decisión"), resumen: recortar(`${String(datos.que ?? "")} → ${comoTexto(datos.resultado)}`) };
    case "llamada_ia":
      return { ...base, nombre: `${String(datos.proveedor ?? "ia")}/${String(datos.modelo ?? "?")}`, resumen: recortar(String(datos.proposito ?? "")) };
    case "respuesta_ia":
      return { ...base, nombre: `${String(datos.proveedor ?? "ia")}/${String(datos.modelo ?? "?")}`, resumen: recortar(String(datos.texto ?? datos.motivoFin ?? "")) };
    default:
      return { ...base, nombre: String(datos.origen ?? datos.motivo ?? linea.tipo), resumen: recortar(comoTexto(datos.error ?? datos.mensaje ?? datos)) };
  }
}

export function herramientasDePasos(pasos: readonly PasoAuditado[]): string[] {
  return [...new Set(pasos.filter((paso) => paso.tipo === "herramienta").map((paso) => paso.nombre))];
}

async function archivosDeConversacion(raices: readonly string[], conversacionId: string): Promise<string[]> {
  const archivos: string[] = [];
  for (const raiz of raices) {
    const carpeta = path.join(raiz, "conversaciones");
    let dias: string[];
    try {
      dias = (await readdir(carpeta)).filter((dia) => /^\d{4}-\d{2}-\d{2}$/.test(dia)).sort().reverse().slice(0, DIAS_A_BUSCAR);
    } catch {
      continue;
    }
    archivos.push(...dias.map((dia) => path.join(carpeta, dia, `${conversacionId}.jsonl`)));
  }
  return archivos;
}

async function pasosDeArchivo(archivo: string, solicitudId: string, salida: PasoAuditado[]): Promise<void> {
  const lectura = createInterface({ input: createReadStream(archivo, { encoding: "utf8" }), crlfDelay: Infinity });
  try {
    for await (const texto of lectura) {
      if (salida.length >= MAX_PASOS) break;
      if (!texto.includes(solicitudId)) continue;
      let linea: unknown;
      try {
        linea = JSON.parse(texto);
      } catch {
        continue;
      }
      if (!esObjeto(linea) || linea.solicitud !== solicitudId) continue;
      const paso = pasoDesdeLinea(linea);
      if (paso) salida.push(paso);
    }
  } catch {
    // Archivo que no existe o ilegible: el turno se guarda sin pasos.
  } finally {
    lectura.close();
  }
}

export async function leerPasosAuditoria(
  conversacionId: string,
  solicitudId: string,
  raices: readonly string[] = [configuracion().raiz, configuracion().raizAlterna],
): Promise<PasoAuditado[]> {
  const pasos: PasoAuditado[] = [];
  for (const archivo of await archivosDeConversacion(raices, conversacionId)) {
    await pasosDeArchivo(archivo, solicitudId, pasos);
    if (pasos.length > 0) break;
  }
  return pasos.sort((a, b) => a.ts.localeCompare(b.ts));
}
