import { z } from "zod";

/**
 * Lo puro y liviano del refinado contra la foto (REQ-001 paso 9), que usan por igual el servidor (`escena-ia-refinar.ts`, la
 * ruta) y el navegador (`refinar-foto-cliente.ts`): el tope de rondas, el reporte de diferencias que escribe el modelo y la
 * decisión de seguir o parar. Sin dependencias del servidor, para no cargarlo en el bundle del taller.
 */

export const MAX_RONDAS_REFINAR = 2;

export const ASPECTOS_DIFERENCIA = ["mezcla_tamanos", "silueta", "grosor", "colores", "piezas_faltantes", "piezas_sobrantes", "escala", "posicion", "otro"] as const;
export type AspectoDiferencia = (typeof ASPECTOS_DIFERENCIA)[number];

export const ReporteSchema = z.object({
  diferencias: z.array(z.object({
    aspecto: z.enum(ASPECTOS_DIFERENCIA).describe("qué tipo de diferencia es: mezcla_tamanos (más o menos globos grandes/chicos), silueta (el recorrido o la curvatura), grosor (cuerpo más delgado o grueso), colores, piezas_faltantes, piezas_sobrantes, escala (todo más chico o grande que en la foto), posicion, otro"),
    descripcion: z.string().min(3).max(240).describe("la diferencia concreta con números cuando se pueda: «en la foto ~35 % son R-24, en la captura casi ninguno», «el arco de la foto abarca todo el ancho y el de la captura solo 2/3»"),
    significativa: z.boolean().describe("true si un decorador la notaría a primera vista"),
  })).max(12),
}).describe("las diferencias entre la foto y la captura de la escena");
export type ReporteComparacion = z.infer<typeof ReporteSchema>;

/** El reporte que escribió el modelo, o `null` si no cumple el esquema. */
export function reporteDe(argumentos: unknown): ReporteComparacion | null {
  const r = ReporteSchema.safeParse(argumentos ?? {});
  return r.success ? r.data : null;
}

export type ResultadoRonda = {
  ronda: number;
  /** Las diferencias que listó el modelo al comparar (el primer reporte de la ronda). */
  diferencias: ReporteComparacion["diferencias"];
  significativas: number | null;
  cambios: number;
  /** Si ya no hace falta otra ronda. */
  terminar: boolean;
  motivo: "sin_diferencias" | "sin_cambios" | "ultima_ronda" | "continua";
};

/** Qué pasó en la ronda y si sigue otra: se para sin diferencias significativas, si no cambió nada o en la última ronda. */
export function decidirRonda(ronda: number, reportes: readonly ReporteComparacion[], cambios: number): ResultadoRonda {
  const primero = reportes[0];
  const significativas = primero ? primero.diferencias.filter((d) => d.significativa).length : null;
  const base = { ronda, diferencias: primero?.diferencias ?? [], significativas, cambios };
  if (significativas === 0) return { ...base, terminar: true, motivo: "sin_diferencias" };
  if (cambios === 0) return { ...base, terminar: true, motivo: "sin_cambios" };
  if (ronda >= MAX_RONDAS_REFINAR) return { ...base, terminar: true, motivo: "ultima_ronda" };
  return { ...base, terminar: false, motivo: "continua" };
}

