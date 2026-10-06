import "server-only";

import fs from "node:fs";
import path from "node:path";
import type { EstadisticasOrdenes } from "./estadisticas";

export type SnapshotOrdenes = {
  generatedAt: string;
  estadisticasOrdenes: EstadisticasOrdenes | null;
};

const SNAPSHOT_PATH = path.join(process.cwd(), "data", "snapshot", "lora-estado.json");

/** Lee estadísticas publicadas por la antigua consola local; conserva soporte para instalaciones existentes. */
export function readLocalSnapshot(): SnapshotOrdenes | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const generatedAt = Reflect.get(value, "generatedAt");
    const estadisticasOrdenes = Reflect.get(value, "estadisticasOrdenes");
    if (typeof generatedAt !== "string") return null;
    if (estadisticasOrdenes !== null && (typeof estadisticasOrdenes !== "object" || Array.isArray(estadisticasOrdenes))) return null;
    return { generatedAt, estadisticasOrdenes: estadisticasOrdenes as EstadisticasOrdenes | null };
  } catch {
    return null;
  }
}
