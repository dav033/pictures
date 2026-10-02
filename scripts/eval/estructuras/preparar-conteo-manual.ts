import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { prepararConteoManual } from "../../../src/lib/eval/estructuras/preparar-conteo-manual";

/**
 * Prepara el conteo humano de ~30 fotos para `npm run eval:conteo` (ADR-0031).
 * Vista previa por defecto; `--escribir` guarda `suite.json`, `indice.csv`,
 * `verdad.csv` (plantilla en blanco) y `contar.html` en `--salida`. Fotos y
 * salida viven fuera del repositorio y no se sobrescribe nada sin
 * `--sobrescribir` (el `verdad.csv` puede tener trabajo humano). Sin red ni
 * proveedor. Ver docs/conteo-manual-procedimiento.md.
 *
 *   npx tsx scripts/eval/estructuras/preparar-conteo-manual.ts \
 *     --fotos <carpeta de fotos> --salida <carpeta privada> [--max 30] [--semilla texto] \
 *     [--imagenes auto|incrustar|enlazar] [--permiso-proveedor] [--escribir]
 */

/** Todos los archivos bajo `raiz` como rutas relativas con `/`; los enlaces simbólicos no se siguen. */
function listarArchivos(raiz: string): string[] {
  const archivos: string[] = [];
  const recorrer = (relativa: string) => {
    for (const entrada of readdirSync(join(raiz, relativa), { withFileTypes: true })) {
      const ruta = relativa ? `${relativa}/${entrada.name}` : entrada.name;
      if (entrada.isDirectory()) recorrer(ruta);
      else if (entrada.isFile()) archivos.push(ruta);
    }
  };
  recorrer("");
  return archivos;
}

function main(): void {
  prepararConteoManual(process.argv.slice(2), {
    repo: process.cwd(),
    listarArchivos,
    leerBytes: (ruta) => (existsSync(ruta) ? readFileSync(ruta) : null),
    existe: existsSync,
    escribirTexto: (ruta, texto) => { mkdirSync(dirname(ruta), { recursive: true }); writeFileSync(ruta, texto); },
    log: (mensaje) => console.log(mensaje),
  });
}

try {
  main();
} catch (error) {
  console.error(`[conteo-manual] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
