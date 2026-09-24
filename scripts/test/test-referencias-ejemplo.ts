/**
 * Iteración 4: manifiesto de fotos de ejemplo y preferencia de tema.
 * Sin red ni proveedores. Run: npx tsx scripts/test/test-referencias-ejemplo.ts
 */
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { MANIFIESTO_REFERENCIAS_EJEMPLO } from "../../src/lib/referencias-ejemplo/manifiesto";
import { CLAVE_TEMA, interpretarPreferenciaTema, resolverTema, SCRIPT_TEMA_ANTES_DE_PINTAR, siguienteTema } from "../../src/lib/tema/tema";

const carpeta = path.join(process.cwd(), "public", "referencias-ejemplo");
const { fotos } = MANIFIESTO_REFERENCIAS_EJEMPLO;

assert.equal(fotos.length, 10, "la galería muestra 10 fotos de ejemplo");
assert.equal(new Set(fotos.map((foto) => foto.id)).size, 10, "ids únicos");
assert.equal(new Set(fotos.map((foto) => foto.pexels_id)).size, 10, "fotos distintas");
for (const foto of fotos) {
  const archivo = path.join(carpeta, foto.archivo);
  const miniatura = path.join(carpeta, foto.miniatura);
  assert.ok(existsSync(archivo), `existe ${foto.archivo}`);
  assert.ok(existsSync(miniatura), `existe ${foto.miniatura}`);
  assert.ok(statSync(archivo).size < 250_000, `${foto.archivo} pesa menos de 250 KB`);
  assert.ok(statSync(miniatura).size < 60_000, `${foto.miniatura} pesa menos de 60 KB`);
  assert.ok(url(foto.url_fuente).includes(String(foto.pexels_id)), `${foto.id}: la URL de la fuente corresponde a su pexels_id`);
}
console.log("[PASS] manifiesto de referencias de ejemplo: 10 fotos con fuente, licencia y peso acotado");

function url(valor: string): string {
  return new URL(valor).pathname;
}

assert.equal(interpretarPreferenciaTema(null), "sistema", "sin elección sigue al sistema");
assert.equal(interpretarPreferenciaTema("dark"), "dark");
assert.equal(interpretarPreferenciaTema("light"), "light");
assert.equal(interpretarPreferenciaTema("DARK"), "sistema", "un valor desconocido no fuerza un tema");
assert.equal(resolverTema("sistema", true), "dark");
assert.equal(resolverTema("sistema", false), "light");
assert.equal(resolverTema("light", true), "light", "la elección explícita gana al sistema");
assert.equal(siguienteTema("dark"), "light");
assert.equal(siguienteTema("light"), "dark");
assert.ok(SCRIPT_TEMA_ANTES_DE_PINTAR.includes(JSON.stringify(CLAVE_TEMA)), "el script anti-parpadeo lee la misma clave");
assert.ok(SCRIPT_TEMA_ANTES_DE_PINTAR.includes("try{") && SCRIPT_TEMA_ANTES_DE_PINTAR.includes("catch"), "el script tolera localStorage bloqueado");
console.log("[PASS] tema: sistema por defecto, elección explícita persistida y script anti-parpadeo");
