/**
 * Arnés de entrenamiento (W4): la caché de la detección de globos por foto. La verdad de una corrida real nunca puede
 * salir de una detección grabada del modo seco ni de otro modelo o versión del detector:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-entrenamiento-cache.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Deteccion } from "@/lib/globos3d/detectar-globos-ia";
import { claveDeteccion, type EntradaClaveDeteccion, FUENTES_DEL_DETECTOR, guardarDeteccionCacheada, leerDeteccionCacheada, versionDetector } from "../entrenamiento/lib-cache-deteccion";

const tmp = mkdtempSync(path.join(tmpdir(), "entrenamiento-cache-"));
let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const deteccion = (fallidos = 0): Deteccion => ({
  globos: [{ box_2d: [300, 300, 500, 420], color: "blanco" }], fondos: [], uso: { entrada: 1, salida: 1, pensamiento: 0 },
  costeEstimadoUsd: 0.001, trozos: 1, fallidos, racimos: { revisadas: 0, quitadas: 0 },
});
const foto = new Uint8Array([1, 2, 3, 4, 5]);

console.log("Caché de la detección (arnés W4):");

const entrada = (cambios: Partial<EntradaClaveDeteccion> = {}): EntradaClaveDeteccion => ({
  bytes: foto, modo: "real", transporte: "api", modelo: "claude-haiku-5-5", esfuerzo: "medium", pensamiento: true, ladoLectura: 1536, ...cambios,
});

prueba("la clave depende de los bytes, el modo, el transporte, el modelo, el esfuerzo, el razonamiento, el lado de lectura y la versión del detector", () => {
  const base = claveDeteccion(entrada(), "v1");
  assert.equal(claveDeteccion(entrada(), "v1"), base, "estable");
  const distintas = [
    claveDeteccion(entrada({ modo: "seco" }), "v1"),
    claveDeteccion(entrada({ transporte: "cli" }), "v1"),
    claveDeteccion(entrada({ modelo: "haiku" }), "v1"),
    claveDeteccion(entrada({ esfuerzo: "high" }), "v1"),
    claveDeteccion(entrada({ pensamiento: false }), "v1"),
    claveDeteccion(entrada({ ladoLectura: 1024 }), "v1"),
    claveDeteccion(entrada({ bytes: new Uint8Array([9]) }), "v1"),
    claveDeteccion(entrada(), "v2"),
  ];
  assert.equal(new Set([base, ...distintas]).size, distintas.length + 1, "cada ingrediente cambia la clave");
  const antigua = createHash("sha256").update(foto).update("|claude-haiku-5-5").digest("hex").slice(0, 32);
  assert.notEqual(base, antigua, "la clave de antes (bytes y modelo) ya no coincide con ninguna entrada nueva");
});

prueba("la versión del detector cambia con cualquier fuente que decide la petición o la foto leída, y falla si falta una", () => {
  const raiz = path.join(tmp, "detector");
  for (const archivo of FUENTES_DEL_DETECTOR) {
    mkdirSync(path.dirname(path.join(raiz, archivo)), { recursive: true });
    writeFileSync(path.join(raiz, archivo), `// ${archivo}`);
  }
  const antes = versionDetector(raiz);
  assert.equal(versionDetector(raiz), antes);
  for (const necesaria of ["src/lib/globos3d/fondos-escenografia.ts", "src/lib/globos3d/medir-colores.ts", "src/lib/taller/normalizar-foto.ts", "src/lib/ia/claude/cli/peticion.ts"]) {
    assert.ok(FUENTES_DEL_DETECTOR.includes(necesaria), necesaria);
  }
  for (const [indice, archivo] of FUENTES_DEL_DETECTOR.entries()) {
    const distinta = path.join(tmp, `detector-${indice}`);
    for (const f of FUENTES_DEL_DETECTOR) {
      mkdirSync(path.dirname(path.join(distinta, f)), { recursive: true });
      writeFileSync(path.join(distinta, f), f === archivo ? "// otro contenido" : `// ${f}`);
    }
    assert.notEqual(versionDetector(distinta), antes, `cambiar ${archivo} cambia la versión`);
  }
  const sinUna = path.join(tmp, "detector-sin-una");
  for (const f of FUENTES_DEL_DETECTOR.slice(1)) {
    mkdirSync(path.dirname(path.join(sinUna, f)), { recursive: true });
    writeFileSync(path.join(sinUna, f), "x");
  }
  assert.throws(() => versionDetector(sinUna));
  assert.match(versionDetector(), /^[0-9a-f]{16}$/, "la versión del detector del repo");
});

prueba("en seco no se escribe ni se lee la caché, aunque exista un archivo con esa clave", () => {
  const dir = path.join(tmp, "seco");
  const clave = claveDeteccion(entrada({ modo: "seco" }), "v1");
  guardarDeteccionCacheada(dir, clave, deteccion(), "seco");
  assert.equal(existsSync(dir), false, "ni siquiera se crea la carpeta");
  mkdirSync(dir);
  writeFileSync(path.join(dir, `${clave}.json`), JSON.stringify(deteccion()));
  assert.equal(leerDeteccionCacheada(dir, clave, "seco"), null);
});

prueba("en real la detección vuelve del disco, pero solo si no tuvo tramos ni revisión de racimos fallidos", () => {
  const dir = path.join(tmp, "real");
  const clave = claveDeteccion(entrada(), "v1");
  assert.equal(leerDeteccionCacheada(dir, clave, "real"), null);
  guardarDeteccionCacheada(dir, clave, deteccion(2), "real");
  assert.equal(leerDeteccionCacheada(dir, clave, "real"), null, "una detección con tramos fallidos no se guarda");
  guardarDeteccionCacheada(dir, clave, { ...deteccion(), racimos: { revisadas: 2, quitadas: 0, fallo: "cuota" } }, "real");
  assert.equal(leerDeteccionCacheada(dir, clave, "real"), null, "una revisión de racimos fallida tampoco se guarda");
  guardarDeteccionCacheada(dir, clave, deteccion(), "real");
  assert.deepEqual(leerDeteccionCacheada(dir, clave, "real"), deteccion());
  assert.deepEqual(readdirSync(dir), [`${clave}.json`]);
});

prueba("un archivo de caché roto cuenta como ausente y la pasada vuelve a detectar", () => {
  const dir = path.join(tmp, "roto");
  mkdirSync(dir);
  const clave = claveDeteccion(entrada(), "v1");
  writeFileSync(path.join(dir, `${clave}.json`), "{ \"globos\": [");
  assert.equal(leerDeteccionCacheada(dir, clave, "real"), null);
});

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pruebas} pruebas de la caché de la detección: OK`);
