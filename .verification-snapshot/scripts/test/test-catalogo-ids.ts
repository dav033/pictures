/**
 * La gramática de los ids del catálogo (REQ-013, SPEC §5.1): `ids.ts` parte en el primer `:`, reconoce los repositorios
 * fundadores y `terceros/<slug>`, y deja la forma corta al índice que se le pase; `idCortoDeFondo` da el id que se guarda (el
 * corto) y rechaza un calificado con otro repositorio. `ids.ts` y `tipos.ts` son hojas: no importan nada fuera de sí. Sin coste.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-catalogo-ids.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { idCortoDeFondo } from "../../src/lib/catalogo/asignacion-fondos";
import { esIdRepositorio, idCalificado, parsearId, PREFIJOS_SEMPERTEX, repositorioPorPrefijo, separarCalificado } from "../../src/lib/catalogo/ids";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

prueba("la forma calificada se parte en el primer «:» y conserva lo demás como id local", () => {
  assert.deepEqual(parsearId("sempertex:idea:arco-x"), { repositorio: "sempertex", idLocal: "idea:arco-x", forma: "calificada" });
  assert.deepEqual(parsearId("sempertex:escena:boda~n3"), { repositorio: "sempertex", idLocal: "escena:boda~n3", forma: "calificada" });
  assert.deepEqual(parsearId("mobiliario:silla_tiffany"), { repositorio: "mobiliario", idLocal: "silla_tiffany", forma: "calificada" });
  assert.deepEqual(parsearId("escenografia:panel_redondo"), { repositorio: "escenografia", idLocal: "panel_redondo", forma: "calificada" });
  assert.deepEqual(parsearId("terceros/acme:silla-x"), { repositorio: "terceros/acme", idLocal: "silla-x", forma: "calificada" });
});

prueba("la forma corta la resuelven los prefijos de Sempertex o el índice que se pase", () => {
  assert.deepEqual(parsearId("idea:arco-x"), { repositorio: "sempertex", idLocal: "idea:arco-x", forma: "corta" });
  assert.deepEqual(parsearId("escena:boda~n3"), { repositorio: "sempertex", idLocal: "escena:boda~n3", forma: "corta" });
  assert.deepEqual(parsearId("formato:R-12"), { repositorio: "sempertex", idLocal: "formato:R-12", forma: "corta" });
  assert.deepEqual(parsearId("silla_tiffany"), { error: "desconocido" });
  assert.deepEqual(parsearId("silla_tiffany", (id) => (id === "silla_tiffany" ? "mobiliario" : undefined)), { repositorio: "mobiliario", idLocal: "silla_tiffany", forma: "corta" });
  assert.deepEqual(parsearId("x", () => "ambiguo"), { error: "ambiguo" });
  assert.deepEqual(parsearId(""), { error: "desconocido" });
});

prueba("solo son repositorios los fundadores y terceros/<slug> con un slug válido", () => {
  for (const id of ["sempertex", "mobiliario", "escenografia", "terceros/acme", "terceros/a1-b2"]) assert.ok(esIdRepositorio(id), id);
  for (const id of ["Sempertex", "terceros/", "terceros/a", "terceros/Acme", "terceros/-acme", `terceros/${"a".repeat(25)}`, "idea", "escena"]) assert.ok(!esIdRepositorio(id), id);
  assert.equal(separarCalificado("sempertex:"), null, "sin id local no es calificado");
  assert.equal(separarCalificado("terceros/A:x"), null);
  assert.deepEqual(parsearId("terceros/a:x"), { error: "desconocido" });
});

prueba("calificar y quitar la calificación son inversos", () => {
  assert.equal(idCalificado("mobiliario", "silla_tiffany"), "mobiliario:silla_tiffany");
  for (const [repo, local] of [["sempertex", "idea:arco-x"], ["escenografia", "panel_redondo"], ["terceros/acme", "silla-x"]] as const) {
    assert.deepEqual(separarCalificado(idCalificado(repo, local)), { repositorio: repo, idLocal: local });
  }
});

prueba("lo que se guarda en mueble.id es el id corto; un calificado solo vale con su repositorio", () => {
  assert.equal(idCortoDeFondo("mobiliario:silla_tiffany"), "silla_tiffany");
  assert.equal(idCortoDeFondo("escenografia:panel_redondo"), "panel_redondo");
  assert.equal(idCortoDeFondo("mobiliario:mesa_param"), "mesa_param");
  assert.equal(idCortoDeFondo("silla_tiffany"), "silla_tiffany");
  assert.equal(idCortoDeFondo("ya_no_existe"), "ya_no_existe", "un corto que ya no está sigue guardado tal cual (caja roja)");
  for (const malo of ["escenografia:silla_tiffany", "mobiliario:panel_redondo", "mobiliario:no_existe", "sempertex:idea:x", "terceros/acme:silla-x"]) assert.equal(idCortoDeFondo(malo), null, malo);
});

prueba("ningún prefijo de Sempertex es prefijo de otro ni empieza como un repositorio", () => {
  for (const a of PREFIJOS_SEMPERTEX) {
    assert.ok(a.endsWith(":"), a);
    assert.ok(!esIdRepositorio(a.slice(0, -1)), a);
    for (const b of PREFIJOS_SEMPERTEX) if (a !== b) assert.ok(!b.startsWith(a), `${a} es prefijo de ${b}`);
  }
  assert.equal(repositorioPorPrefijo("decoracion-guiada:deco-x"), "sempertex");
  assert.equal(repositorioPorPrefijo("panel_redondo"), undefined);
});

prueba("ids.ts y tipos.ts son hojas: solo se importan entre sí", () => {
  const carpeta = path.resolve(__dirname, "../../src/lib/catalogo");
  for (const archivo of ["ids.ts", "tipos.ts"]) {
    const fuentes = [...readFileSync(path.join(carpeta, archivo), "utf8").matchAll(/(?:import|export)\s[^'"`;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]);
    for (const fuente of fuentes) assert.ok(fuente === "./tipos" || fuente === "./ids", `${archivo} importa ${fuente}`);
  }
});

console.log(`test-catalogo-ids: ${pruebas} pruebas ok`);
