/**
 * El grafo de imports de `src/` leído del código (sin compilar), para las pruebas de fronteras: qué archivos alcanza una raíz, ni
 * de rebote, y por qué cadena. Cuentan todos los imports, también `import type` (una frontera de módulos no se cruza ni con tipos).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const RAIZ = path.resolve(__dirname, "..", "..");
export const SRC = path.join(RAIZ, "src");

/** Los .ts/.tsx de una carpeta (o el archivo mismo), recursivo. */
export function archivos(ruta: string, salida: string[] = []): string[] {
  if (!statSync(ruta).isDirectory()) return /\.(ts|tsx)$/.test(ruta) ? [...salida, ruta] : salida;
  for (const nombre of readdirSync(ruta)) {
    if (nombre === "node_modules" || nombre === ".next") continue;
    const hijo = path.join(ruta, nombre);
    if (statSync(hijo).isDirectory()) archivos(hijo, salida);
    else if (/\.(ts|tsx)$/.test(nombre)) salida.push(hijo);
  }
  return salida;
}

const IMPORTA = /(?:import|export)\s[^'"`;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g;
const SOLO_TIPOS = /^(?:import|export)\s+type\s/;

/** Lo que importa un archivo. `soloEjecucion`: sin `import type` / `export type` (se borran al compilar: no cargan nada). */
export const especificadores = (archivo: string, soloEjecucion = false): string[] => [...readFileSync(archivo, "utf8").matchAll(IMPORTA)]
  .filter((m) => !soloEjecucion || !SOLO_TIPOS.test(m[0]))
  .map((m) => m[1] ?? m[2] ?? m[3]!);

/** El archivo de `src/` al que apunta un import (relativo o `@/`); `null` si es un paquete o un dato. */
export function resolver(desde: string, especificador: string): string | null {
  const base = especificador.startsWith("@/") ? path.join(SRC, especificador.slice(2)) : especificador.startsWith(".") ? path.resolve(path.dirname(desde), especificador) : null;
  if (!base) return null;
  return [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find(existsSync) ?? null;
}

/** Todo lo que alcanzan las raíces: archivo → quién lo importó primero (`null` en las raíces). */
export function cerradura(raices: readonly string[], soloEjecucion = false): Map<string, string | null> {
  const visto = new Map<string, string | null>();
  const cola = [...raices];
  cola.forEach((f) => visto.set(f, null));
  while (cola.length) {
    const actual = cola.shift()!;
    for (const especificador of especificadores(actual, soloEjecucion)) {
      const destino = resolver(actual, especificador);
      if (!destino || visto.has(destino)) continue;
      visto.set(destino, actual);
      cola.push(destino);
    }
  }
  return visto;
}

/** El primer archivo de la cerradura que es uno de `prohibidos` (o está dentro de una carpeta prohibida, terminada en separador) y la cadena que lo trae. */
export function colado(visto: ReadonlyMap<string, string | null>, prohibidos: readonly string[]): string | null {
  for (const prohibido of prohibidos) {
    const encontrado = [...visto.keys()].find((f) => f === prohibido || (prohibido.endsWith(path.sep) && f.startsWith(prohibido)));
    if (!encontrado) continue;
    const cadena: string[] = [];
    for (let c: string | null | undefined = encontrado; c; c = visto.get(c)) cadena.push(path.relative(SRC, c));
    return `${path.relative(SRC, prohibido)}: ${cadena.reverse().join(" -> ")}`;
  }
  return null;
}

const CATALOGO = path.join(SRC, "lib", "catalogo") + path.sep;
/**
 * Lo único del catálogo de repositorios (REQ-013, R8) que el motor (`globos3d`), el producto guiado y el estudio pueden alcanzar:
 * las hojas sin datos de repositorio. Lista de permitidos, no de prohibidos: un módulo nuevo del catálogo queda fuera hasta que
 * se decida lo contrario.
 */
export const CATALOGO_PERMITIDO: ReadonlySet<string> = new Set(["ids.ts", "tipos.ts", "asignacion-fondos.ts"].map((f) => path.join(CATALOGO, f)));

/** Los archivos del catálogo de la cerradura que no están permitidos, cada uno con la cadena que lo trae. */
export function catalogoNoPermitido(visto: ReadonlyMap<string, string | null>): string[] {
  return [...visto.keys()].filter((f) => f.startsWith(CATALOGO) && !CATALOGO_PERMITIDO.has(f)).map((f) => colado(visto, [f])!);
}
