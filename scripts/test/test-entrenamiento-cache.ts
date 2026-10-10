/**
 * Arnés de entrenamiento (W4): la caché de la detección de globos por foto. La clave es determinista (bytes de la foto más la
 * configuración del detector) y la verdad de una corrida real nunca puede salir de una detección grabada del modo seco ni de
 * otro modelo, esfuerzo o versión del detector:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-entrenamiento-cache.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Deteccion } from "@/lib/globos3d/detectar-globos-ia";
import { claveDeteccion, type EntradaClaveDeteccion, guardarDeteccionCacheada, leerDeteccionCacheada, VERSION_DEL_DETECTOR } from "../entrenamiento/lib-cache-deteccion";

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

prueba("dos entradas idénticas dan la misma clave: copias de los bytes y otro orden de las propiedades", () => {
  const base = claveDeteccion(entrada());
  assert.match(base, /^[0-9a-f]{32}$/);
  assert.equal(claveDeteccion(entrada()), base, "estable");
  assert.equal(claveDeteccion(entrada({ bytes: new Uint8Array(foto) })), base, "otra copia de los mismos bytes");
  assert.equal(claveDeteccion(entrada({ bytes: Buffer.from(foto) })), base, "un Buffer con los mismos bytes");
  const otroOrden: EntradaClaveDeteccion = { ladoLectura: 1536, pensamiento: true, esfuerzo: "medium", modelo: "claude-haiku-5-5", transporte: "api", modo: "real", bytes: foto };
  assert.equal(claveDeteccion(otroOrden), base, "el orden en que se arma la entrada no cuenta");
});

prueba("la clave de una entrada fija no cambia nunca (si cambia, la caché entera queda sin uso)", () => {
  assert.equal(claveDeteccion(entrada(), "v1"), "b74a3765a4355258175f6eb9034e48aa");
});

prueba("la clave depende de los bytes, el modo, el transporte, el modelo, el esfuerzo, el razonamiento, el lado de lectura y la versión del detector", () => {
  const base = claveDeteccion(entrada(), "v1");
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
  assert.ok(VERSION_DEL_DETECTOR.length > 0);
  assert.equal(claveDeteccion(entrada()), claveDeteccion(entrada(), VERSION_DEL_DETECTOR), "sin versión explícita vale la del detector");
  const antigua = createHash("sha256").update(foto).update("|claude-haiku-5-5").digest("hex").slice(0, 32);
  assert.notEqual(base, antigua, "la clave de antes (bytes y modelo) ya no coincide con ninguna entrada nueva");
});

/** El código que decide qué pide el detector al modelo y cómo normaliza la foto y une lo que responde. */
const FUENTES_DEL_DETECTOR = [
  "src/lib/globos3d/detectar-globos-ia.ts", "src/lib/globos3d/mosaico-deteccion.ts", "src/lib/globos3d/racimos-detectados.ts",
  "src/lib/globos3d/fondos-escenografia.ts", "src/lib/globos3d/medir-colores.ts",
  "src/lib/ia/claude/como-gemini.ts", "src/lib/ia/claude/cuerpo.ts", "src/lib/ia/claude/esquemas.ts", "src/lib/ia/claude/herramientas.ts", "src/lib/ia/claude/respuesta.ts",
  "src/lib/ia/claude/cli/peticion.ts", "src/lib/ia/claude/cli/salida.ts",
  "src/lib/taller/normalizar-foto.ts",
];
const HUELLA_CONOCIDA = "117257c13d1a92cf";

prueba("el código que decide qué detecta el detector no cambia sin decidir si sube VERSION_DEL_DETECTOR", () => {
  const huella = createHash("sha256");
  for (const archivo of FUENTES_DEL_DETECTOR) {
    // Con los saltos de línea normalizados: la huella no depende de la configuración de git de quien la calcula.
    huella.update(archivo).update(readFileSync(path.resolve(__dirname, "..", "..", archivo), "utf8").replace(/\r\n/g, "\n"));
  }
  const actual = huella.digest("hex").slice(0, 16);
  assert.equal(actual, HUELLA_CONOCIDA, [
    `Cambió el código del detector (huella ${actual}). Si cambia lo que se detecta (el pedido, el esquema, los trozos, el catálogo de fondos que se le muestra,`,
    "el sistema del transporte), sube VERSION_DEL_DETECTOR en lib-cache-deteccion.ts: las detecciones guardadas dejan de valer y se vuelve a detectar.",
    "Si no cambia lo que se detecta, deja la versión y pon esta huella en HUELLA_CONOCIDA: la caché sigue valiendo.",
  ].join(" "));
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
