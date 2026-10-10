/** El commit con que corrió una pasada: el hash corto de HEAD, y `+dirty` si el árbol tenía cambios sin confirmar (el código medido no es el del commit). */
import { execFileSync } from "node:child_process";
import { SUFIJO_COMMIT_SUCIO } from "./lib-agregado";

export type EjecutarGit = (argumentos: string[]) => string;

export function ejecutarGitEn(directorio: string): EjecutarGit {
  return (argumentos) => execFileSync("git", argumentos, { cwd: directorio, stdio: ["ignore", "pipe", "ignore"] }).toString();
}

export function commitDeTrabajo(git: EjecutarGit): string {
  try {
    const hash = git(["rev-parse", "--short", "HEAD"]).trim();
    const sucio = git(["status", "--porcelain"]).trim() !== "";
    return sucio ? `${hash}${SUFIJO_COMMIT_SUCIO}` : hash;
  } catch {
    return "desconocido";
  }
}
