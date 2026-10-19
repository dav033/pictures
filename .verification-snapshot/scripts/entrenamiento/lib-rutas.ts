/**
 * Dónde guarda el arnés sus corridas, la caché de la detección y la auditoría: fuera del repo, para que la historia
 * sobreviva a quitar el worktree donde se corrió. Se puede mover con ENTRENAMIENTO_CORRIDAS; por defecto va a los datos
 * locales del usuario (LOCALAPPDATA en Windows, XDG_DATA_HOME o ~/.local/share en los demás). No va a la bitácora: es git.
 */
import { homedir } from "node:os";
import path from "node:path";

type Entorno = Readonly<Record<string, string | undefined>>;

export function directorioDeCorridas(entorno: Entorno = process.env, hogar: string = homedir()): string {
  const indicado = entorno.ENTRENAMIENTO_CORRIDAS?.trim();
  if (indicado) return path.resolve(indicado);
  const base = entorno.LOCALAPPDATA?.trim() || entorno.XDG_DATA_HOME?.trim() || path.join(hogar, ".local", "share");
  return path.join(base, "demo-decoracion", "entrenamiento", "corridas");
}
