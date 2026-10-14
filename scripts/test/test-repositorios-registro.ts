/**
 * Registro de repositorios de catálogo (REQ-013, plan T23): consulta del registro, ids calificados `sempertex:…`, manifiestos,
 * banderas de visibilidad por repositorio y fuente de precio. Código real, sin base, red ni IA. Complementa
 * `test-catalogo-repositorios` (esquema por clase, inyectividad, orden) con el contrato público del registro.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-repositorios-registro.ts
 */
import assert from "node:assert/strict";
import { repositorio, repositoriosCargados, resolverEntrada } from "../../src/lib/catalogo/registro";
import { REPOSITORIOS_FUNDADORES, esIdRepositorio, idCalificado, separarCalificado, parsearId } from "../../src/lib/catalogo/ids";
import { MANIFIESTOS } from "../../src/lib/catalogo/manifiestos";
import { ManifiestoSchema } from "../../src/lib/catalogo/esquemas";
import { reposPorDefecto, reposVisibles, variableDeSuperficie } from "../../src/lib/catalogo/visibilidad";
import type { Superficie } from "../../src/lib/catalogo/tipos";

assert.deepEqual(repositoriosCargados(), [], "importar el registro no carga ningún repositorio");

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ok ${pruebas} - ${nombre}`); };

prueba("el registro tiene exactamente los tres fundadores; un tercero aún no existe", () => {
  assert.deepEqual([...REPOSITORIOS_FUNDADORES], ["sempertex", "mobiliario", "escenografia"]);
  for (const id of REPOSITORIOS_FUNDADORES) assert.equal(repositorio(id)?.manifiesto.id, id);
  assert.equal(repositorio("terceros/acme"), undefined);
  assert.deepEqual(repositoriosCargados().sort(), [...REPOSITORIOS_FUNDADORES].sort());
});

prueba("ids de repositorio: fundadores y terceros/<slug> válido; lo demás no", () => {
  for (const ok of ["sempertex", "mobiliario", "escenografia", "terceros/acme", "terceros/a1-b2"]) assert.ok(esIdRepositorio(ok), ok);
  for (const mal of ["", "otro", "terceros/", "terceros/A", "terceros/a", "terceros/-x", "Sempertex", "terceros/" + "a".repeat(25)]) assert.ok(!esIdRepositorio(mal), mal);
});

prueba("ids calificados: se parten en el primer ':' y la forma corta no es calificada", () => {
  assert.equal(idCalificado("sempertex", "idea:arco-x"), "sempertex:idea:arco-x");
  assert.deepEqual(separarCalificado("sempertex:idea:arco-x"), { repositorio: "sempertex", idLocal: "idea:arco-x" });
  assert.deepEqual(separarCalificado("terceros/acme:silla-x"), { repositorio: "terceros/acme", idLocal: "silla-x" });
  assert.equal(separarCalificado("idea:arco-x"), null, "«idea» no es un repositorio");
  assert.equal(separarCalificado("silla_tiffany"), null);
  assert.equal(separarCalificado("mobiliario:"), null);
  assert.equal(separarCalificado(":x"), null);
  assert.deepEqual(parsearId("sempertex:idea:arco-x"), { repositorio: "sempertex", idLocal: "idea:arco-x", forma: "calificada" });
  assert.deepEqual(parsearId("idea:arco-x"), { repositorio: "sempertex", idLocal: "idea:arco-x", forma: "corta" });
  assert.deepEqual(parsearId("nada"), { error: "desconocido" });
  assert.deepEqual(parsearId(""), { error: "desconocido" });
});

prueba("resolverEntrada: forma corta y calificada dan la misma entrada, con su id calificado", () => {
  const sempertex = repositorio("sempertex")!.entradas();
  const idea = sempertex.find((e) => e.clase === "item-biblioteca" && e.idLocal.startsWith("idea:"))!;
  assert.ok(idea.id.startsWith("sempertex:idea:"));
  assert.equal(resolverEntrada(idea.idLocal), idea);
  assert.equal(resolverEntrada(`sempertex:${idea.idLocal}`), idea);
  assert.equal(repositorio("sempertex")!.porIdLocal(idea.idLocal), idea);
  const silla = resolverEntrada("silla_tiffany");
  assert.ok(silla && silla.repositorio === "mobiliario" && silla.id === "mobiliario:silla_tiffany");
  assert.equal(resolverEntrada("escenografia:silla_tiffany"), undefined, "repositorio equivocado");
  assert.equal(resolverEntrada("terceros/acme:silla-x"), undefined);
  assert.equal(resolverEntrada(""), undefined);
});

prueba("manifiestos: versionados, esquema válido, rechazan lo malformado", () => {
  for (const id of REPOSITORIOS_FUNDADORES) {
    const m = MANIFIESTOS[id];
    assert.ok(ManifiestoSchema.safeParse(m).success, id);
    assert.equal(m.esquema, 1);
    assert.equal(repositorio(id)!.manifiesto, m, "el registro usa el mismo manifiesto");
    assert.equal(m.historial.at(-1)!.version, m.version);
  }
  const base = MANIFIESTOS.mobiliario;
  assert.ok(!ManifiestoSchema.safeParse({ ...base, esquema: 2 }).success);
  assert.ok(!ManifiestoSchema.safeParse({ ...base, id: "otro" }).success);
  assert.ok(!ManifiestoSchema.safeParse({ ...base, clases: [] }).success);
  assert.ok(!ManifiestoSchema.safeParse({ ...base, campoExtra: 1 }).success, "estricto");
  assert.ok(!ManifiestoSchema.safeParse({ ...base, datos: "../fuera" }).success);
  assert.ok(ManifiestoSchema.safeParse({ ...base, precio: { tipo: "lista-alquiler", archivo: "a.csv", moneda: "COP", vigencia: "2026-01" } }).success);
});

prueba("fuente de precio por repositorio: Sempertex cotiza por la tienda; mobiliario y escenografía no tienen precio", () => {
  assert.equal(MANIFIESTOS.sempertex.precio.tipo, "crosswalk-tienda");
  for (const id of ["mobiliario", "escenografia"] as const) {
    const p = MANIFIESTOS[id].precio;
    assert.ok(p.tipo === "sin-precio" && p.motivo.length > 0, id);
  }
});

prueba("banderas: por defecto cada superficie ve lo que declaran los manifiestos", () => {
  assert.deepEqual(reposPorDefecto("rag"), ["sempertex"]);
  assert.deepEqual(reposPorDefecto("taller"), ["sempertex", "mobiliario", "escenografia"]);
  assert.deepEqual(reposVisibles("rag", {}), ["sempertex"]);
});

prueba("banderas: la variable CATALOGO_REPOS_<SUPERFICIE> la cambia; una errata se ignora entera", () => {
  const superficie: Superficie = "rag";
  assert.equal(variableDeSuperficie(superficie), "CATALOGO_REPOS_RAG");
  const mute = console.error; console.error = () => undefined;
  try {
    assert.deepEqual(reposVisibles(superficie, { CATALOGO_REPOS_RAG: " Mobiliario , sempertex " }), ["sempertex", "mobiliario"], "orden de manifiestos, sin mayúsculas");
    assert.deepEqual(reposVisibles(superficie, { CATALOGO_REPOS_RAG: "sempertx,mobiliario" }), ["sempertex"], "errata: vale el nivel siguiente");
  } finally { console.error = mute; }
});

prueba("banderas: el cliente (guiada, estudio) nunca ve un repositorio sin precio salvo permiso explícito", () => {
  const mute = console.warn; console.warn = () => undefined;
  try {
    const pide = { CATALOGO_REPOS_GUIADA: "sempertex,mobiliario,escenografia" };
    assert.deepEqual(reposVisibles("guiada", pide), ["sempertex"]);
    assert.deepEqual(reposVisibles("guiada", { ...pide, CATALOGO_PERMITIR_SIN_PRECIO_CLIENTE: "true" }), ["sempertex", "mobiliario", "escenografia"]);
    assert.deepEqual(reposVisibles("taller", pide), ["sempertex", "mobiliario", "escenografia"], "el taller no es del cliente");
  } finally { console.warn = mute; }
});

console.log(`test-repositorios-registro: ${pruebas} pruebas ok`);
