import { getRagPool } from "@/lib/rag/db";
import { leerFilasCatalogo, type ConsultaSql } from "./crosswalk-consulta";
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

export function crosswalkIncluido(): Crosswalk {
  incluido ??= CrosswalkSchema.parse(archivo);
  return incluido;
}

export type OpcionesEnVivo = { conexion?: ConsultaSql; ahora?: () => number };

export async function crosswalkEnVivo(opciones: OpcionesEnVivo = {}): Promise<Crosswalk> {
  const ahora = opciones.ahora ?? Date.now;
  if (enVivo && ahora() < enVivo.venceEn) return enVivo.crosswalk;
  consultando ??= (async () => {
    try {
      const filas = await leerFilasCatalogo(opciones.conexion ?? getRagPool());
      const snapshot = filas[0]?.snapshot;
      if (!snapshot) throw new Error("El catálogo publicado no devolvió filas.");
      const crosswalk = CrosswalkSchema.parse(construirCrosswalk(filas, snapshot).crosswalk);
      enVivo = { crosswalk, venceEn: ahora() + TTL_EN_VIVO_MS };
      return crosswalk;
    } finally {
      consultando = null;
    }
  })();
  return consultando;
}

/** Para las pruebas: olvida lo recordado. */
export function olvidarCrosswalk(): void {
  incluido = null;
  enVivo = null;
  consultando = null;
}
