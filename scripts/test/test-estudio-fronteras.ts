/**
 * La frontera del estudio de módulos (`/3d/modulos`, REQ-011) con el catálogo (REQ-013, AC-9): el estudio solo ve Sempertex, así
 * que su página y `lib/modulos-estudio` no alcanzan, ni de rebote, nada del catálogo de repositorios salvo sus hojas
 * (`CATALOGO_PERMITIDO`), y no importan directamente el catálogo de muebles ni el de fondos. Sin coste, solo lee código.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-estudio-fronteras.ts
 */
import assert from "node:assert/strict";
import path from "node:path";
import { archivos, catalogoNoPermitido, cerradura, especificadores, RAIZ, resolver, SRC } from "./lib-cerradura-imports";

const ESTUDIO = [path.join(SRC, "app", "3d", "modulos"), path.join(SRC, "lib", "modulos-estudio")].flatMap((ruta) => archivos(ruta));
assert.ok(ESTUDIO.some((f) => f.endsWith(path.join("modulos", "page.tsx"))), "no se encontró la página /3d/modulos");

assert.ok(catalogoNoPermitido(cerradura([path.join(SRC, "lib", "catalogo", "registro.ts")])).length > 0, "la prueba no es vacía: el registro alcanza lo no permitido");
const visto = cerradura(ESTUDIO);
assert.deepEqual(catalogoNoPermitido(visto), [], "el estudio solo alcanza del catálogo ids, tipos y asignacion-fondos");

const CATALOGO_MUEBLES = new Set(["mobiliario-catalogo.ts", "fondos-escenografia.ts"].map((f) => path.join(SRC, "lib", "globos3d", f)));
for (const archivo of ESTUDIO) for (const especificador of especificadores(archivo)) {
  const destino = resolver(archivo, especificador);
  if (destino && CATALOGO_MUEBLES.has(destino)) assert.fail(`${path.relative(RAIZ, archivo)} importa ${path.basename(destino)}: el estudio no lista muebles ni fondos`);
}

console.log(`test-estudio-fronteras: ok (${ESTUDIO.length} archivos del estudio, ${visto.size} en su cerradura)`);
