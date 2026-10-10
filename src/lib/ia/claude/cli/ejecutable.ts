import { statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ErrorIA } from "@sempertex/agente-core";

type Entorno = Readonly<Record<string, string | undefined>>;

/**
 * Dónde está `claude`: en el PATH del servidor o donde lo deja el instalador nativo (~/.local/bin). En Windows solo el
 * `.exe`: un `claude.cmd` de npm necesitaría cmd.exe, que reinterpreta los argumentos (el esquema JSON). Se busca una vez
 * por proceso; si no está, cada llamada lo vuelve a buscar (se puede instalar sin reiniciar `next dev`).
 */

let encontrado: string | undefined;

function esArchivo(ruta: string): boolean {
  try {
    return statSync(ruta).isFile();
  } catch {
    return false;
  }
}

export function resolverEjecutableClaude(entorno: Entorno = process.env, plataforma: NodeJS.Platform = process.platform): string {
  if (encontrado) return encontrado;
  const nombre = plataforma === "win32" ? "claude.exe" : "claude";
  const rutas = (entorno.PATH ?? entorno.Path ?? "").split(path.delimiter).filter(Boolean);
  const candidatos = [...rutas, path.join(homedir(), ".local", "bin")].map((carpeta) => path.join(carpeta, nombre));
  encontrado = candidatos.find(esArchivo);
  if (!encontrado) {
    throw new ErrorIA("sin_llave", "claude", "IA_CLAUDE_TRANSPORTE=cli necesita Claude Code instalado (`claude` en el PATH o en ~/.local/bin) y con tu sesión iniciada (`claude` → /login). O vuelve a IA_CLAUDE_TRANSPORTE=api con ANTHROPIC_API_KEY.", false);
  }
  return encontrado;
}
