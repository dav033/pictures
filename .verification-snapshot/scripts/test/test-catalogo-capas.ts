/**
 * Las capas del catálogo de repositorios (REQ-013, regla R8): el catálogo importa el motor, nunca al revés. Sin coste, solo lee
 * código.
 * - lo que importa cada archivo de `src/lib/globos3d/**` del catálogo está en `CATALOGO_PERMITIDO` (ids, tipos,
 *   asignacion-fondos), y el motor, ni de rebote, no alcanza nada más del catálogo (ni el registro ni un repositorio);
 * - esas hojas solo se importan entre sí;
 * - la entrada liviana (`manifiestos.ts`, `indice.ts`) no ejecuta ningún cargador, ni la biblioteca, ni el motor: solo hojas,
 *   manifiestos y sus `lock.json` (los `import type` del motor se borran al compilar).
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-catalogo-capas.ts
 */
import assert from "node:assert/strict";
import path from "node:path";
import { archivos, CATALOGO_PERMITIDO, catalogoNoPermitido, cerradura, colado, especificadores, RAIZ, resolver, SRC } from "./lib-cerradura-imports";

const CATALOGO = path.join(SRC, "lib", "catalogo");
const enCatalogo = (f: string) => f.startsWith(CATALOGO + path.sep);
const MOTOR = archivos(path.join(SRC, "lib", "globos3d"));

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

prueba("el motor solo importa del catálogo sus hojas", () => {
  const fuera: string[] = [];
  for (const archivo of MOTOR) for (const especificador of especificadores(archivo)) {
    const destino = resolver(archivo, especificador);
    if (destino && enCatalogo(destino) && !CATALOGO_PERMITIDO.has(destino)) fuera.push(`${path.relative(RAIZ, archivo)} → ${path.relative(RAIZ, destino)}`);
  }
  assert.deepEqual(fuera, []);
});

prueba("el motor no alcanza, ni de rebote, nada del catálogo fuera de sus hojas", () => {
  assert.deepEqual(catalogoNoPermitido(cerradura(MOTOR)), []);
});

prueba("las hojas solo se importan entre sí", () => {
  for (const hoja of CATALOGO_PERMITIDO) {
    const fuera = [...cerradura([hoja]).keys()].filter((f) => !CATALOGO_PERMITIDO.has(f));
    assert.deepEqual(fuera.map((f) => path.relative(RAIZ, f)), [], path.relative(RAIZ, hoja));
  }
});

prueba("la entrada liviana no ejecuta cargadores, biblioteca ni motor", () => {
  const permitidos = new Set([...CATALOGO_PERMITIDO, path.join(CATALOGO, "manifiestos.ts"), path.join(CATALOGO, "indice.ts"),
    ...["sempertex", "mobiliario", "escenografia"].map((id) => path.join(CATALOGO, "repositorios", id, "manifiesto.ts"))]);
  const visto = cerradura([path.join(CATALOGO, "manifiestos.ts"), path.join(CATALOGO, "indice.ts")], true);
  assert.deepEqual([...visto.keys()].filter((f) => !permitidos.has(f)).map((f) => colado(visto, [f])), []);
  const registro = cerradura([path.join(CATALOGO, "registro.ts")], true);
  assert.ok([...registro.keys()].some((f) => f.endsWith(`${path.sep}cargador.ts`)), "la prueba no es vacía: el registro sí ejecuta los cargadores");
});

console.log(`test-catalogo-capas: ${pruebas} pruebas ok`);
