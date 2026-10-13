import { topeDurable, type ResultadoTope } from "@/lib/topes/tope-durable";

/**
 * D-044: chosen-idea quotes share a global hourly cap in Neon. The proxy uses a shared password, so there is no reliable
 * customer identity to scope the counter. If the database is unavailable, each instance enforces the same bounded memory cap.
 */
export const CLAVE_COSTEO_IDEA_POR_HORA = "costeo_idea_hora";
export const TOPE_COSTEO_IDEA_POR_HORA_DEFECTO = 300;
const HORA_MS = 3_600_000;
/** The SQL compares against `$3::integer`; larger values would fail and force the memory fallback. */
const MAXIMO_ENTERO_BASE = 2_147_483_647;

type Ventana = { desde: number; usadas: number };
const ventanasDeTomas = new WeakMap<ResultadoTope, Ventana>();

declare global {
  var __costeoIdeaPorHora: Ventana | undefined;
}

/** Invalid or absent configuration retains the default cap. */
export function topeCosteoIdeaPorHora(env: Record<string, string | undefined> = process.env): number {
  const crudo = env.COSTEO_IDEA_TOPE_HORA?.trim();
  const valor = crudo && /^\d+$/.test(crudo) ? Number(crudo) : 0;
  return Number.isSafeInteger(valor) && valor >= 1 && valor <= MAXIMO_ENTERO_BASE ? valor : TOPE_COSTEO_IDEA_POR_HORA_DEFECTO;
}

/** The instance fallback; tests inject the clock. */
export function tomarCosteoIdea(ahora: number = Date.now(), tope: number = topeCosteoIdeaPorHora()): ResultadoTope {
  let ventana = globalThis.__costeoIdeaPorHora;
  if (!ventana || ahora - ventana.desde > HORA_MS) ventana = globalThis.__costeoIdeaPorHora = { desde: ahora, usadas: 0 };
  if (ventana.usadas >= tope) return { ok: false, usadas: ventana.usadas, tope };
  ventana.usadas += 1;
  const toma: ResultadoTope = { ok: true, usadas: ventana.usadas, recibo: { origen: "memoria" } };
  ventanasDeTomas.set(toma, ventana);
  return toma;
}

/** Neon counts across instances; database failures use this instance's bounded fallback. */
export async function tomarCosteoIdeaDurable(): Promise<ResultadoTope> {
  const tope = topeCosteoIdeaPorHora();
  let ventanaDeMemoria: Ventana | undefined;
  const { toma } = await topeDurable().tomar(CLAVE_COSTEO_IDEA_POR_HORA, tope, () => {
    const local = tomarCosteoIdea(Date.now(), tope);
    ventanaDeMemoria = ventanasDeTomas.get(local);
    return local;
  });
  if (ventanaDeMemoria && toma.ok) ventanasDeTomas.set(toma, ventanaDeMemoria);
  return toma;
}

/** Refund an interrupted quote to its original counter and window. */
export function devolverCosteoIdeaDurable(toma: ResultadoTope): Promise<void> {
  if (!toma.ok || !toma.recibo) return Promise.resolve();
  return topeDurable().devolver(CLAVE_COSTEO_IDEA_POR_HORA, toma.recibo, () => {
    const ventana = globalThis.__costeoIdeaPorHora;
    if (ventana && ventanasDeTomas.get(toma) === ventana && ventana.usadas > 0) {
      ventana.usadas -= 1;
      ventanasDeTomas.delete(toma);
    }
  });
}

/** Test reset. */
export function reiniciarCosteoIdeaPorHora(): void {
  globalThis.__costeoIdeaPorHora = undefined;
}
