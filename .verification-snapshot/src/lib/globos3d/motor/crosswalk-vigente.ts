import { PlazoDeLecturaError } from "@/lib/rag/consulta-con-plazo";
import { getRagPool } from "@/lib/rag/db";
import { leerFilasCatalogo, leerPresentacionesDeVariantes, leerSnapshotPublicado, type ConsultaSql, type FilaDePresentaciones } from "./crosswalk-consulta";
import archivo from "./datos/crosswalk-vigente.json";
import { construirCrosswalk, CrosswalkSchema, type Crosswalk } from "./crosswalk-variantes";

/**
 * El cruce que usa el servidor (solo servidor: `rag/db` lo impone). Por defecto, el que `scripts/motor/generar-crosswalk.ts` dejó junto al código (viaja en
 * el bundle: sin leer disco ni la base en cada plan). Si el catálogo publicó otro snapshot y el cruce incluido se quedó
 * viejo, `crosswalkEnVivo` lo vuelve a armar con una consulta de solo lectura por el pool de siempre, y lo recuerda
 * unos minutos. Quien cotiza lo pide solo cuando el precio le falla con el incluido.
 */
const TTL_EN_VIVO_MS = 10 * 60_000;

let incluido: Crosswalk | null = null;
let enVivo: { crosswalk: Crosswalk; venceEn: number } | null = null;
let consultando: Promise<Crosswalk> | null = null;
/**
 * Una lectura en vivo que falló se recuerda un minuto (D-038): con la base lenta o caída, cada «¿cuánto cuesta?» que pide el cruce de
 * ahora volvía a esperar su plazo entero. Pasado el minuto se vuelve a intentar.
 */
const TTL_FALLO_MS = 60_000;
let fallo: { error: unknown; venceEn: number } | null = null;

const esCancelacion = (error: unknown): boolean => error instanceof PlazoDeLecturaError && error.causa === "cancelada";

export function crosswalkIncluido(): Crosswalk {
  incluido ??= CrosswalkSchema.parse(archivo);
  return incluido;
}

export type OpcionesEnVivo = { conexion?: ConsultaSql; ahora?: () => number };

export async function crosswalkEnVivo(opciones: OpcionesEnVivo = {}): Promise<Crosswalk> {
  const ahora = opciones.ahora ?? Date.now;
  if (enVivo && ahora() < enVivo.venceEn) return enVivo.crosswalk;
  if (fallo && ahora() < fallo.venceEn) throw fallo.error;
  consultando ??= (async () => {
    try {
      const filas = await leerFilasCatalogo(opciones.conexion ?? getRagPool());
      const snapshot = filas[0]?.snapshot;
      if (!snapshot) throw new Error("El catálogo publicado no devolvió filas.");
      const crosswalk = CrosswalkSchema.parse(construirCrosswalk(filas, snapshot).crosswalk);
      enVivo = { crosswalk, venceEn: ahora() + TTL_EN_VIVO_MS };
      fallo = null;
      return crosswalk;
    } catch (error) {
      // Que el cliente cierre SU turno no dice nada de la base: eso no se recuerda.
      if (!esCancelacion(error)) fallo = { error, venceEn: ahora() + TTL_FALLO_MS };
      throw error;
    } finally {
      consultando = null;
    }
  })();
  return consultando;
}

/** Las presentaciones del catálogo de ahora de variantes que el cruce no conoce (`leerPresentacionesDeVariantes`), con una consulta de solo lectura por el pool de siempre. */
export async function presentacionesDeVariantes(variantIds: readonly string[], opciones: { conexion?: ConsultaSql } = {}): Promise<FilaDePresentaciones[]> {
  return variantIds.length ? leerPresentacionesDeVariantes(opciones.conexion ?? getRagPool(), variantIds) : [];
}

const TTL_PUBLICADO_MS = 60_000;
let publicado: { snapshot: string | null; venceEn: number } | null = null;

/**
 * El snapshot publicado del catálogo (de donde Python saca los precios), recordado un minuto. Si no se puede leer, `null`:
 * quien cotiza usa entonces el del cruce y lo deja dicho.
 */
export async function snapshotPublicado(opciones: OpcionesEnVivo = {}): Promise<string | null> {
  const ahora = opciones.ahora ?? Date.now;
  if (publicado && ahora() < publicado.venceEn) return publicado.snapshot;
  let cancelada = false;
  const snapshot = await leerSnapshotPublicado(opciones.conexion ?? getRagPool()).catch((error: unknown) => {
    cancelada = esCancelacion(error);
    return null;
  });
  if (!cancelada) publicado = { snapshot, venceEn: ahora() + TTL_PUBLICADO_MS };
  return snapshot;
}

/** Para las pruebas: olvida lo recordado. */
export function olvidarCrosswalk(): void {
  incluido = null;
  enVivo = null;
  fallo = null;
  consultando = null;
  publicado = null;
}
