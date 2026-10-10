/**
 * El lock de cada repositorio de catálogo (REQ-013, AC-12): `src/lib/catalogo/repositorios/<id>/lock.json` guarda la versión del
 * contenido, su huella (`huellaRepositorio`, ver en `huella.ts` qué cubre y qué no) y el historial; el manifiesto lee de ahí su
 * versión. Sin coste: ninguna IA ni red.
 *
 * Cómo se usa:
 * - Si esta prueba falla con «cambió el contenido de <id>», es que cambió lo que ese repositorio ofrece (una idea nueva, un
 *   nombre, una descripción, un mueble del catálogo…). Se corre
 *     NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-catalogo-lock.ts --escribir --nota="qué cambió"
 *   y el script sube el parche de la versión, añade la línea al historial y guarda la huella nueva, solo en los repositorios
 *   que cambiaron. Para un cambio que no es de parche (se quita algo, cambia el esquema) se edita a mano `version` e historial.
 * - Un arreglo del motor o del compilador que solo cambia cómo se arma una escena NO toca la huella (eso lo vigilan las fotos
 *   doradas).
 * - Al fusionar dos ramas que cambiaron el mismo repositorio, su `lock.json` choca: se toma cualquiera de los dos lados y se
 *   vuelve a correr con `--escribir`: recalcula la huella del contenido ya fusionado y sube otra vez el parche. Un lock por
 *   repositorio: cambiar muebles no choca con cambiar la biblioteca de Sempertex.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-catalogo-lock.ts [--escribir --nota="…"]
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { crearEntrada, repositorioDeLista } from "../../src/lib/catalogo/construir";
import { huellaRepositorio, lockActualizado, type LockRepositorio } from "../../src/lib/catalogo/huella";
import { REPOSITORIOS_FUNDADORES } from "../../src/lib/catalogo/ids";
import { MANIFIESTOS } from "../../src/lib/catalogo/manifiestos";
import { repositorio } from "../../src/lib/catalogo/registro";
import { PROCEDENCIA_TALLER } from "../../src/lib/catalogo/repositorios/fondos";
import { FONDOS_CATALOGO, type FondoFijo } from "../../src/lib/globos3d/fondos-escenografia";

const ESCRIBIR = process.argv.includes("--escribir");
const NOTA = process.argv.find((a) => a.startsWith("--nota="))?.slice("--nota=".length).trim() ?? "";
if (ESCRIBIR && !NOTA) throw new Error("--escribir pide --nota=\"qué cambió\": es la línea del historial de cada repositorio que cambie.");
const rutaLock = (id: string) => new URL(`../../src/lib/catalogo/repositorios/${id}/lock.json`, import.meta.url);

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

prueba("la huella cambia con lo que el repositorio ofrece y el lock sube el parche con su línea de historial", () => {
  const escenografia = repositorio("escenografia")!;
  const [primera, ...resto] = escenografia.entradas();
  const fondo = FONDOS_CATALOGO.find((f): f is FondoFijo => f.id === primera!.idLocal && f.clase === "fondo")!;
  const cambiada = crearEntrada("escenografia", { clase: "fondo", idLocal: fondo.id, nombre: fondo.nombre, descripcion: "otra descripción", procedencia: PROCEDENCIA_TALLER, dato: () => fondo });
  const otra = huellaRepositorio(repositorioDeLista(MANIFIESTOS.escenografia, () => [cambiada, ...resto]));
  assert.notEqual(otra, huellaRepositorio(escenografia));
  const lock: LockRepositorio = { version: "1.2.9", huella: "a", historial: [{ version: "1.2.9", nota: "x" }] };
  assert.equal(lockActualizado(lock, "a", "nada"), lock, "sin cambio no se toca");
  assert.deepEqual(lockActualizado(lock, "b", "nuevo"), { version: "1.2.10", huella: "b", historial: [{ version: "1.2.9", nota: "x" }, { version: "1.2.10", nota: "nuevo" }] });
});

prueba("el lock de cada repositorio está al día con su contenido y su manifiesto", () => {
  const cambiados: string[] = [];
  for (const id of REPOSITORIOS_FUNDADORES) {
    const guardado = JSON.parse(readFileSync(rutaLock(id), "utf8")) as LockRepositorio;
    const nuevo = lockActualizado(guardado, huellaRepositorio(repositorio(id)!), NOTA);
    if (nuevo === guardado) {
      assert.equal(MANIFIESTOS[id].version, guardado.version, `${id}: el manifiesto no lee la versión de su lock`);
      continue;
    }
    if (!ESCRIBIR) { cambiados.push(id); continue; }
    writeFileSync(rutaLock(id), `${JSON.stringify(nuevo, null, 2)}\n`);
    console.log(`    ${id}: ${guardado.version} → ${nuevo.version} (${NOTA})`);
  }
  assert.deepEqual(cambiados, [], `cambió el contenido de ${cambiados.join(", ")}: corre esta prueba con --escribir --nota="qué cambió"`);
});

console.log(`test-catalogo-lock: ${pruebas} pruebas ok`);
