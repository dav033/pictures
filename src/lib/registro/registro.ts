import { configuracion, NIVELES } from "./configuracion";
import { contextoActual, idConversacionEfectivo, sanearIdConversacion } from "./contexto";
import { escribirLinea, fechaUtc, rutaConversacion, rutaGeneral } from "./escritor";
import { partirLinea } from "./fragmentos";
import { recortarTexto, redactar, resumirDatos, serializarError } from "./redaccion";
import type { ContextoRegistro, LineaAuditoria, LineaGeneral, MapaAuditoria, NivelRegistro, TipoAuditoria } from "./tipos";
import { versionCodigo } from "./version";

/**
 * Registro general (`registrar` y atajos) y auditoría por conversación (`auditar`). Ver tipos.ts.
 * Ninguna función de este archivo lanza: si algo falla al registrar, se pierde esa línea y nada más.
 */

const MAX_LINEA_GENERAL = 64 * 1024;
const MAX_LINEA_AUDITORIA = 8 * 1024 * 1024;

export interface OpcionesRegistro {
  error?: unknown;
  ms?: number;
  /** Contexto explícito (p. ej. al terminar un stream fuera de la petición). */
  contexto?: ContextoRegistro;
  /** Sobrescribe la conversación del contexto. */
  conversacion?: string;
}

function serializarAcotado(construir: (limite: number) => unknown, limites: readonly number[], maximo: number): string {
  let ultimo = "";
  for (const limite of limites) {
    ultimo = JSON.stringify(construir(limite));
    if (ultimo.length <= maximo) return ultimo;
  }
  return ultimo.length <= maximo ? ultimo : JSON.stringify(construir(0));
}

/** Una línea a stdout; si pasa de ~15 KB (Vercel la corta y deja un JSON roto) sale en fragmentos válidos (ver fragmentos.ts). */
function escribirStdout(nivel: NivelRegistro, linea: string): void {
  try {
    for (const parte of partirLinea(linea)) {
      if (nivel === "error") console.error(parte);
      else if (nivel === "warn") console.warn(parte);
      else console.log(parte);
    }
  } catch {
    // stdout cerrado.
  }
}

/** Una línea JSON al registro general (stdout según REGISTRO_NIVEL_STDOUT y archivo diario). */
export function registrar(nivel: NivelRegistro, evento: string, datos?: unknown, opciones: OpcionesRegistro = {}): void {
  try {
    const cfg = configuracion();
    if (!cfg.activo) return;
    const aStdout = NIVELES[nivel] >= NIVELES[cfg.nivelStdout];
    const aArchivo = cfg.archivosActivos && NIVELES[nivel] >= NIVELES[cfg.nivelArchivo];
    if (!aStdout && !aArchivo) return;
    const contexto = opciones.contexto ?? contextoActual();
    const ahora = Date.now();
    const error = opciones.error === undefined ? undefined : serializarError(opciones.error);
    const conversacion = sanearIdConversacion(opciones.conversacion) ?? contexto?.conversacion;
    const version = versionCodigo().corta;
    const construir = (limite: number): LineaGeneral => ({
      ts: new Date(ahora).toISOString(),
      nivel,
      servicio: "next",
      entorno: cfg.entorno,
      version,
      evento: recortarTexto(String(evento), 120),
      ...(contexto?.solicitud ? { solicitud: contexto.solicitud } : {}),
      ...(conversacion ? { conversacion } : {}),
      ...(contexto?.vista ? { vista: contexto.vista } : {}),
      ...(contexto?.ruta ? { ruta: contexto.ruta } : {}),
      ...(opciones.ms !== undefined ? { ms: Math.round(opciones.ms) } : {}),
      ...(datos !== undefined
        ? { datos: limite > 0 ? redactar(datos, { limiteCadena: limite, maxElementos: 50, maxClaves: 100, profundidadMax: 8 }) : "[datos omitidos: línea demasiado grande]" }
        : {}),
      ...(error ? { error } : {}),
    });
    const linea = serializarAcotado(construir, [cfg.limiteCadenaGeneral, 500, 120], MAX_LINEA_GENERAL);
    if (aStdout) escribirStdout(nivel, linea);
    if (aArchivo) escribirLinea("general", rutaGeneral(ahora), linea);
  } catch {
    // Nunca lanza.
  }
}

export function depurar(evento: string, datos?: unknown, opciones?: OpcionesRegistro): void {
  registrar("debug", evento, datos, opciones);
}

export function informar(evento: string, datos?: unknown, opciones?: OpcionesRegistro): void {
  registrar("info", evento, datos, opciones);
}

export function avisar(evento: string, datos?: unknown, error?: unknown, opciones?: OpcionesRegistro): void {
  registrar("warn", evento, datos, { ...opciones, error });
}

export function registrarError(evento: string, error: unknown, datos?: unknown, opciones?: OpcionesRegistro): void {
  registrar("error", evento, datos, { ...opciones, error });
}

/* ---------- Auditoría ---------- */

declare global {
  var __registroSecuencia: number | undefined;
}

function siguienteSecuencia(): number {
  globalThis.__registroSecuencia = (globalThis.__registroSecuencia ?? 0) + 1;
  return globalThis.__registroSecuencia;
}

function tieneError(datos: unknown): boolean {
  return typeof datos === "object" && datos !== null && "error" in datos && (datos as { error?: unknown }).error !== undefined;
}

function nivelDeAuditoria(tipo: TipoAuditoria, datos: unknown): NivelRegistro {
  if (tipo === "error") return "error";
  if (tipo === "aviso" || tieneError(datos)) return "warn";
  return "info";
}

export interface OpcionesAuditoria {
  ms?: number;
  /** Id de conversación explícito (si no, el del contexto; si no, `sin-conversacion-<solicitud>`). */
  conversacion?: string;
  contexto?: ContextoRegistro;
  /** Caracteres por cadena (por defecto: ~200 kB para `python`/`http`, 20 000 para el resto). */
  limiteCadena?: number;
}

/** Tipos cuyo contenido son cuerpos de peticiones a otros servicios: casi completos para depurar fielmente. */
const TIPOS_CON_CUERPOS: ReadonlySet<TipoAuditoria> = new Set<TipoAuditoria>(["python", "http"]);

/**
 * Traza COMPLETA (redactada) en `conversaciones/<fecha>/<id>.jsonl` y un resumen sin cargas grandes en el
 * registro general (`auditoria.<tipo>`). Devuelve el id de conversación usado.
 */
export function auditar<T extends TipoAuditoria>(tipo: T, datos: MapaAuditoria[T], opciones: OpcionesAuditoria = {}): string | undefined {
  try {
    const cfg = configuracion();
    if (!cfg.activo) return undefined;
    const contexto = opciones.contexto ?? contextoActual();
    const conversacion = idConversacionEfectivo(contexto, opciones.conversacion);
    const ahora = Date.now();
    const solicitud = contexto?.solicitud ?? "fuera-de-peticion";
    const seq = siguienteSecuencia();
    const cuerpos = TIPOS_CON_CUERPOS.has(tipo);
    const limiteInicial = opciones.limiteCadena ?? (cuerpos ? cfg.limiteCadenaCuerpos : cfg.limiteCadenaAuditoria);
    // Cuerpos del Python (planes, armados): más profundidad y elementos que el resto para no cortar estructuras.
    const amplio = cuerpos || limiteInicial > cfg.limiteCadenaAuditoria ? { profundidadMax: 32, maxElementos: 2_000, maxClaves: 1_000 } : {};
    let redactados: unknown = redactar(datos, { limiteCadena: limiteInicial, ...amplio });
    const version = versionCodigo().corta;
    const construir = (limite: number): LineaAuditoria => {
      if (limite !== limiteInicial) redactados = limite > 0 ? redactar(datos, { limiteCadena: limite, maxElementos: 100 }) : { omitido: "línea demasiado grande" };
      return {
        ts: new Date(ahora).toISOString(),
        seq,
        tipo,
        version,
        solicitud,
        conversacion,
        ...(contexto?.vista ? { vista: contexto.vista } : {}),
        ...(contexto?.ruta ? { ruta: contexto.ruta } : {}),
        ...(opciones.ms !== undefined ? { ms: Math.round(opciones.ms) } : {}),
        datos: redactados,
      };
    };
    const linea = serializarAcotado(construir, [limiteInicial, ...(limiteInicial > cfg.limiteCadenaAuditoria ? [cfg.limiteCadenaAuditoria] : []), 4_000, 500], MAX_LINEA_AUDITORIA);
    if (cfg.archivosActivos) escribirLinea("conversacion", rutaConversacion(conversacion, ahora), linea);
    if (cfg.auditoriaEnStdout) escribirStdout("info", linea);
    registrar(nivelDeAuditoria(tipo, redactados), `auditoria.${tipo}`, resumirDatos(redactados), {
      contexto,
      conversacion,
      ...(opciones.ms !== undefined ? { ms: opciones.ms } : {}),
    });
    return conversacion;
  } catch {
    return undefined;
  }
}

/** Atajo para `decision`: quién decidió (modelo:x | regla:y), qué, y con qué resultado. */
export function decidir(quien: string, que: string, resultado: unknown, extra: { entrada?: unknown; motivo?: string } = {}): void {
  auditar("decision", { quien, que, resultado, ...extra });
}

/** Fecha UTC de hoy (la que usan los nombres de archivo). */
export function fechaRegistro(momento: Date | number = Date.now()): string {
  return fechaUtc(momento);
}
