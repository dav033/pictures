/**
 * La auditoría de una pasada: el archivo JSONL de su conversación (`conversaciones/<día>/entrenamiento-<corrida>-<foto>.jsonl`, que escribe
 * el registro de la app). De él salen la lectura cruda del lector, la detección que anotó la pasada y los errores de cada herramienta del
 * asistente: la evidencia con que se parte `capacidad_faltante` (`lib-capacidad.ts`) y con que se repite la puntuación de una corrida.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { sanearIdConversacion } from "@/lib/registro/contexto";

export type EventoAuditoria = {
  tipo: string;
  datos: { proposito?: string; llamadasHerramientas?: Array<{ nombre: string; argumentos: unknown }>; quien?: string; resultado?: Record<string, unknown> };
};

/** Los eventos de un archivo de auditoría y cuántas líneas no se pudieron leer (cortadas por un cierre a medias, o sin la forma de un evento). */
export type Auditoria = { eventos: EventoAuditoria[]; lineasRotas: number };

/** La conversación de auditoría de la pasada de una foto: todos sus eventos de IA se correlacionan con `npm run registros`. */
export function idConversacionDePasada(corrida: string, nombre: string): string {
  return sanearIdConversacion(`entrenamiento-${corrida}-${nombre.replace(/\.jpg$/, "")}`) ?? "entrenamiento";
}

const esEvento = (valor: unknown): valor is EventoAuditoria =>
  typeof valor === "object" && valor !== null && typeof (valor as { tipo?: unknown }).tipo === "string"
  && typeof (valor as { datos?: unknown }).datos === "object" && (valor as { datos?: unknown }).datos !== null;

/** Una línea rota no tira el archivo: se salta y se cuenta, para que quien lo lee pueda avisar. */
export function leerEventos(archivo: string): Auditoria {
  const auditoria: Auditoria = { eventos: [], lineasRotas: 0 };
  for (const linea of readFileSync(archivo, "utf8").split("\n")) {
    if (!linea.trim()) continue;
    try {
      const evento: unknown = JSON.parse(linea);
      if (esEvento(evento)) auditoria.eventos.push(evento); else auditoria.lineasRotas += 1;
    } catch {
      auditoria.lineasRotas += 1;
    }
  }
  return auditoria;
}

/** El archivo de la conversación de `idConversacion` en cualquier carpeta de día, o `null` si no existe. */
export function archivoDeAuditoria(raizRegistro: string, idConversacion: string): string | null {
  const base = path.join(raizRegistro, "conversaciones");
  if (!existsSync(base)) return null;
  for (const dia of readdirSync(base)) {
    const archivo = path.join(base, dia, `${idConversacion}.jsonl`);
    if (existsSync(archivo)) return archivo;
  }
  return null;
}

/** La auditoría de la conversación; sin eventos si no hay archivo. */
export function eventosDeConversacion(raizRegistro: string, idConversacion: string): Auditoria {
  const archivo = archivoDeAuditoria(raizRegistro, idConversacion);
  return archivo ? leerEventos(archivo) : { eventos: [], lineasRotas: 0 };
}

/** La última lectura de la foto tal como la escribió el lector (antes de medirla con los globos detectados); `undefined` si no hubo. */
export function lecturaCrudaDeAuditoria(eventos: readonly EventoAuditoria[]): unknown {
  const lecturas = eventos.filter((e) => e.tipo === "respuesta_ia" && e.datos.proposito === "lectura_foto_escena");
  return lecturas[lecturas.length - 1]?.datos.llamadasHerramientas?.find((h) => h.nombre === "responder_json")?.argumentos;
}

/** Cuántos globos y qué fondos detectó la pasada (lo anota la auditoría): con ello se reconoce su detección en la caché. */
export function deteccionAnotada(eventos: readonly EventoAuditoria[]): { globos: number; fondos: string[] } | undefined {
  return eventos.find((e) => e.datos.quien === "modelo:deteccion_globos" && Array.isArray(e.datos.resultado?.fondos))?.datos.resultado as { globos: number; fondos: string[] } | undefined;
}

/** El mensaje de error de cada herramienta del asistente que falló (`ok: false`), en orden. */
export function erroresDeHerramientas(eventos: readonly EventoAuditoria[]): string[] {
  return eventos.flatMap((e) => (e.tipo === "decision" && e.datos.quien === "herramienta:escena_ia" && e.datos.resultado?.ok === false ? [String(e.datos.resultado.error ?? "")] : []));
}
