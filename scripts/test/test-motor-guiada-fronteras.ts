/**
 * Las fronteras del motor 3D de la vista guiada (REQ-007, fase 1). Sin coste, solo lee código.
 * - nada de `src/` fuera de `src/lib/globos3d/motor/` importa algo del motor que no sea `motor/v1` (la única entrada del
 *   producto guiado), y nada fuera de `motor/` (ni los scripts) importa `espec-a-escena`;
 * - el motor no importa, ni de rebote, `biblioteca.ts` ni `ideas-sempertex/*` (enormes y perezosas);
 * - ningún archivo del motor pasa de 500 líneas;
 * - `v1.ts` es solo de servidor (`server-only`); el único que lo importa en el motor es él mismo.
 * Y las del catálogo (REQ-013, AC-9): el producto guiado (el motor, sus rutas, `guiada-motor`, `ia/guiado`, `components/guiado`)
 * no alcanza, ni de rebote, nada del catálogo de repositorios salvo sus hojas (`CATALOGO_PERMITIDO`: ids, tipos,
 * asignacion-fondos; solo ve Sempertex), y no importa directamente el catálogo de muebles ni el de fondos (el motor llega a ellos
 * de rebote solo para armar un `mueble.id` guardado).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { archivos, catalogoNoPermitido, cerradura, colado, especificadores, RAIZ, resolver, SRC } from "./lib-cerradura-imports";

const MOTOR = path.join(SRC, "lib", "globos3d", "motor");

// 1. Quién importa el motor.
const dentro = (ruta: string) => ruta.startsWith(MOTOR + path.sep);
let importadores = 0;
for (const archivo of [...archivos(SRC), ...archivos(path.join(RAIZ, "scripts"))]) {
  if (dentro(archivo)) continue;
  for (const especificador of especificadores(archivo)) {
    const destino = resolver(archivo, especificador);
    if (!destino || !dentro(destino)) continue;
    importadores += 1;
    const nombre = path.basename(destino, ".ts");
    assert.notEqual(nombre, "espec-a-escena", `${path.relative(RAIZ, archivo)} importa espec-a-escena, que es privado del motor`);
    if (archivo.startsWith(SRC)) assert.equal(nombre, "v1", `${path.relative(RAIZ, archivo)} importa motor/${nombre}: el producto guiado solo entra por motor/v1`);
  }
}

// 2. El motor no arrastra la biblioteca del Taller, ni de rebote.
const visto = cerradura(archivos(MOTOR));
const PROHIBIDOS = [path.join(SRC, "lib", "globos3d", "biblioteca.ts"), path.join(SRC, "lib", "globos3d", "ideas-sempertex") + path.sep];
const arrastrada = colado(visto, PROHIBIDOS);
if (arrastrada) assert.fail(`el motor arrastra ${arrastrada}`);

// 3. Tamaño de los archivos y el guardia de servidor.
for (const archivo of archivos(MOTOR)) {
  const lineas = readFileSync(archivo, "utf8").split("\n").length;
  assert.ok(lineas <= 500, `${path.relative(RAIZ, archivo)} tiene ${lineas} líneas: pasa de 500`);
}
assert.match(readFileSync(path.join(MOTOR, "v1.ts"), "utf8"), /^import "server-only";/m, "v1.ts debe ser solo de servidor");
for (const archivo of archivos(MOTOR)) if (!archivo.endsWith(`${path.sep}v1.ts`)) assert.ok(!/import "server-only"/.test(readFileSync(archivo, "utf8")), `${path.basename(archivo)}: solo v1.ts lleva server-only (los esquemas los lee el script de contratos)`);

// 4. El producto guiado no ve el registro de repositorios ni importa directamente el catálogo de muebles y fondos (REQ-013).
const GUIADO = [
  MOTOR, path.join(SRC, "app", "api", "asistente-guiado"), path.join(SRC, "app", "api", "guiada"), path.join(SRC, "lib", "guiada-motor"),
  path.join(SRC, "lib", "ia", "guiado"), path.join(SRC, "components", "guiado"),
].flatMap((ruta) => archivos(ruta));
const guiado = cerradura(GUIADO);
assert.deepEqual(catalogoNoPermitido(guiado), [], "el producto guiado solo alcanza del catálogo ids, tipos y asignacion-fondos");
const CATALOGO_MUEBLES = new Set(["mobiliario-catalogo.ts", "fondos-escenografia.ts"].map((f) => path.join(SRC, "lib", "globos3d", f)));
for (const archivo of GUIADO) for (const especificador of especificadores(archivo)) {
  const destino = resolver(archivo, especificador);
  if (destino && CATALOGO_MUEBLES.has(destino)) assert.fail(`${path.relative(RAIZ, archivo)} importa ${path.basename(destino)}: el producto guiado no lista muebles ni fondos`);
}

console.log(`test-motor-guiada-fronteras: ok (${visto.size} archivos en la cerradura del motor, ${importadores} importaciones desde fuera, ${guiado.size} en la del producto guiado)`);
