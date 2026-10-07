import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Versión del código que corre, para que cada línea del registro diga con qué código se produjo. Sin procesos
 * hijo ni red: solo variables de entorno y archivos. Orden:
 *   1. Entorno: REGISTRO_VERSION, VERCEL_GIT_COMMIT_SHA (Vercel), GIT_COMMIT_SHA, GIT_SHA, SOURCE_COMMIT, COMMIT_SHA.
 *   2. `version-codigo.json` en la raíz del proceso. `git archive` (el despliegue al VPS) sustituye allí
 *      `$Format:%H$` por el commit gracias a `export-subst` en .gitattributes; el Dockerfile lo copia a /app.
 *   3. Local: `.git/HEAD` (+ refs o packed-refs). Lleva «+local»: el árbol puede tener cambios sin commit.
 * Si nada sirve: «desconocida». Nunca lanza. En local se relee cada 30 s (los commits pasan con el servidor vivo).
 */

export interface VersionCodigo {
  /** Lo que va en cada línea: 12 caracteres del commit (+local en desarrollo) o «desconocida». */
  corta: string;
  commit?: string;
  fecha?: string;
  rama?: string;
  origen: "entorno" | "archivo" | "git-local" | "desconocida";
}

const RE_SHA = /^[0-9a-f]{40}$/i;
const VARIABLES = ["REGISTRO_VERSION", "VERCEL_GIT_COMMIT_SHA", "GIT_COMMIT_SHA", "GIT_SHA", "SOURCE_COMMIT", "COMMIT_SHA"] as const;
const TTL_LOCAL_MS = 30_000;

declare global {
  var __registroVersion: { valor: VersionCodigo; leido: number } | undefined;
}

function desdeEntorno(env: NodeJS.ProcessEnv): VersionCodigo | undefined {
  for (const nombre of VARIABLES) {
    const valor = env[nombre]?.trim();
    if (!valor) continue;
    const commit = RE_SHA.test(valor) ? valor.toLowerCase() : undefined;
    const rama = env.VERCEL_GIT_COMMIT_REF?.trim() || undefined;
    return { corta: commit ? commit.slice(0, 12) : valor.slice(0, 40), ...(commit ? { commit } : {}), ...(rama ? { rama } : {}), origen: "entorno" };
  }
  return undefined;
}

function desdeArchivo(raiz: string): VersionCodigo | undefined {
  try {
    const archivo = path.join(raiz, "version-codigo.json");
    if (!existsSync(archivo)) return undefined;
    const datos = JSON.parse(readFileSync(archivo, "utf8")) as { commit?: unknown; fecha?: unknown };
    const commit = typeof datos.commit === "string" ? datos.commit.trim() : "";
    // Sin expandir (`$Format:%H$`): es un checkout normal, no un `git archive`.
    if (!RE_SHA.test(commit)) return undefined;
    const fecha = typeof datos.fecha === "string" && !datos.fecha.includes("$Format") ? datos.fecha : undefined;
    return { corta: commit.slice(0, 12).toLowerCase(), commit: commit.toLowerCase(), ...(fecha ? { fecha } : {}), origen: "archivo" };
  } catch {
    return undefined;
  }
}

function carpetaGit(desde: string): string | undefined {
  let actual = desde;
  for (let nivel = 0; nivel < 5; nivel += 1) {
    const candidato = path.join(actual, ".git");
    try {
      if (existsSync(candidato)) {
        if (statSync(candidato).isDirectory()) return candidato;
        // Worktree: `.git` es un archivo «gitdir: <ruta>».
        const enlace = /^gitdir:\s*(.+)$/m.exec(readFileSync(candidato, "utf8"));
        if (enlace?.[1]) return path.resolve(actual, enlace[1].trim());
      }
    } catch {
      return undefined;
    }
    const padre = path.dirname(actual);
    if (padre === actual) break;
    actual = padre;
  }
  return undefined;
}

function desdeGitLocal(raiz: string): VersionCodigo | undefined {
  try {
    const git = carpetaGit(raiz);
    if (!git) return undefined;
    const cabeza = readFileSync(path.join(git, "HEAD"), "utf8").trim();
    let commit: string | undefined;
    let rama: string | undefined;
    const referencia = /^ref:\s*(.+)$/.exec(cabeza)?.[1]?.trim();
    if (!referencia) {
      commit = RE_SHA.test(cabeza) ? cabeza : undefined;
    } else {
      rama = referencia.replace(/^refs\/heads\//, "");
      // En un worktree las refs viven en el directorio común.
      const comun = existsSync(path.join(git, "commondir")) ? path.resolve(git, readFileSync(path.join(git, "commondir"), "utf8").trim()) : git;
      for (const base of [git, comun]) {
        const archivo = path.join(base, ...referencia.split("/"));
        if (existsSync(archivo)) {
          const valor = readFileSync(archivo, "utf8").trim();
          if (RE_SHA.test(valor)) {
            commit = valor;
            break;
          }
        }
      }
      if (!commit) {
        for (const base of [git, comun]) {
          const empaquetadas = path.join(base, "packed-refs");
          if (!existsSync(empaquetadas)) continue;
          const linea = readFileSync(empaquetadas, "utf8").split(/\r?\n/).find((fila) => fila.endsWith(` ${referencia}`));
          const valor = linea?.split(" ")[0];
          if (valor && RE_SHA.test(valor)) {
            commit = valor;
            break;
          }
        }
      }
    }
    if (!commit) return undefined;
    return { corta: `${commit.slice(0, 12).toLowerCase()}+local`, commit: commit.toLowerCase(), ...(rama ? { rama } : {}), origen: "git-local" };
  } catch {
    return undefined;
  }
}

export function resolverVersionCodigo(env: NodeJS.ProcessEnv = process.env, raiz: string = process.cwd()): VersionCodigo {
  return desdeEntorno(env) ?? desdeArchivo(raiz) ?? desdeGitLocal(raiz) ?? { corta: "desconocida", origen: "desconocida" };
}

/** Versión del código (cacheada por proceso; en local se relee cada 30 s). */
export function versionCodigo(): VersionCodigo {
  try {
    const ahora = Date.now();
    const cache = globalThis.__registroVersion;
    if (cache && (cache.valor.origen !== "git-local" || ahora - cache.leido < TTL_LOCAL_MS)) return cache.valor;
    const valor = resolverVersionCodigo();
    globalThis.__registroVersion = { valor, leido: ahora };
    return valor;
  } catch {
    return { corta: "desconocida", origen: "desconocida" };
  }
}
