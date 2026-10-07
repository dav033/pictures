import "server-only";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EntornoRegistro, NivelRegistro } from "./tipos";

/** Ajustes del registro, leídos del entorno una vez por proceso (ver la cabecera de tipos.ts). */
export interface ConfiguracionRegistro {
  entorno: EntornoRegistro;
  /** Raíz principal: REGISTRO_DIR o <DATA_DIR>/registros. */
  raiz: string;
  /** Raíz de respaldo si la principal no se puede escribir. */
  raizAlterna: string;
  archivosActivos: boolean;
  nivelArchivo: NivelRegistro;
  nivelStdout: NivelRegistro;
  retencionGeneralDias: number;
  retencionConversacionesDias: number;
  topeGeneralBytesDia: number;
  topeConversacionBytes: number;
  /** Copia la traza completa de auditoría también a stdout (Vercel: no hay disco persistente). */
  auditoriaEnStdout: boolean;
  limiteCadenaGeneral: number;
  limiteCadenaAuditoria: number;
}

export const NIVELES: Readonly<Record<NivelRegistro, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

function nivelValido(valor: string | undefined, porDefecto: NivelRegistro): NivelRegistro {
  const limpio = valor?.trim().toLowerCase();
  return limpio === "debug" || limpio === "info" || limpio === "warn" || limpio === "error" ? limpio : porDefecto;
}

function numeroPositivo(valor: string | undefined, porDefecto: number): number {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : porDefecto;
}

/**
 * local | vps | vercel. El VPS corre la imagen Docker en producción (`/.dockerenv` existe); `next start`
 * en el PC sigue siendo «local». REGISTRO_ENTORNO manda si está.
 */
export function detectarEntorno(env: NodeJS.ProcessEnv = process.env): EntornoRegistro {
  const forzado = env.REGISTRO_ENTORNO?.trim().toLowerCase();
  if (forzado === "local" || forzado === "vps" || forzado === "vercel") return forzado;
  if (env.VERCEL) return "vercel";
  if (env.NODE_ENV === "production" && existsSync("/.dockerenv")) return "vps";
  return "local";
}

/** Misma regla que src/lib/db.ts: en Vercel el disco del proyecto es de solo lectura salvo /tmp. */
export function directorioDatos(env: NodeJS.ProcessEnv = process.env): string {
  return env.VERCEL ? path.join(tmpdir(), "demo-decoracion-data") : path.join(process.cwd(), "data");
}

export function leerConfiguracion(env: NodeJS.ProcessEnv = process.env): ConfiguracionRegistro {
  const entorno = detectarEntorno(env);
  const raiz = env.REGISTRO_DIR?.trim() ? path.resolve(env.REGISTRO_DIR.trim()) : path.join(directorioDatos(env), "registros");
  return {
    entorno,
    raiz,
    raizAlterna: path.join(tmpdir(), "demo-decoracion-registros"),
    archivosActivos: env.REGISTRO_ARCHIVOS !== "0",
    nivelArchivo: nivelValido(env.REGISTRO_NIVEL_ARCHIVO, "debug"),
    nivelStdout: nivelValido(env.REGISTRO_NIVEL_STDOUT, "info"),
    retencionGeneralDias: numeroPositivo(env.REGISTRO_RETENCION_GENERAL_DIAS, 14),
    retencionConversacionesDias: numeroPositivo(env.REGISTRO_RETENCION_CONVERSACIONES_DIAS, 30),
    topeGeneralBytesDia: Math.round(numeroPositivo(env.REGISTRO_TOPE_GENERAL_MB_DIA, 200) * 1024 * 1024),
    topeConversacionBytes: Math.round(numeroPositivo(env.REGISTRO_TOPE_CONVERSACION_MB, 25) * 1024 * 1024),
    auditoriaEnStdout: env.REGISTRO_AUDITORIA_STDOUT ? env.REGISTRO_AUDITORIA_STDOUT === "1" : entorno === "vercel",
    limiteCadenaGeneral: 2_000,
    limiteCadenaAuditoria: 20_000,
  };
}

declare global {
  var __registroConfiguracion: ConfiguracionRegistro | undefined;
}

export function configuracion(): ConfiguracionRegistro {
  if (!globalThis.__registroConfiguracion) globalThis.__registroConfiguracion = leerConfiguracion();
  return globalThis.__registroConfiguracion;
}

/** Solo pruebas: fija (o borra, con `undefined`) la configuración del proceso. */
export function fijarConfiguracionParaPruebas(cambios: Partial<ConfiguracionRegistro> | undefined): ConfiguracionRegistro {
  globalThis.__registroConfiguracion = cambios ? { ...leerConfiguracion(), ...cambios } : undefined;
  return configuracion();
}
