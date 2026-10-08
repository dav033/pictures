/**
 * REQ-002: constructores de SQL del índice de la biblioteca del taller. Sin base de datos ni red.
 * Run: npx tsx scripts/test/test-taller-indice.ts
 */
import assert from "node:assert/strict";
import {
  DIMENSIONES_VECTOR_TALLER,
  clasificarCambios,
  construirBorrarPartes,
  construirConsultaEmbeddingsDeTexto,
  construirDesactivarAusentes,
  construirInsertPartes,
  construirUpsertEmbedding,
  construirUpsertItem,
  hashEntradaTexto,
  itemsSinEmbeddingVigente,
  leerFichasJsonl,
  lineasDePartes,
  valoresDeItem,
  type ConsultaSql,
  type RegistroParaIndice,
} from "../../src/lib/taller/indice";

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

/** Los marcadores $1…$N del texto son exactamente los parámetros que se mandan (ni uno de más ni de menos). */
function marcadoresCuadran(c: ConsultaSql): void {
  const usados = new Set([...c.texto.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  const esperados = new Set(c.valores.map((_, i) => i + 1));
  assert.deepEqual([...usados].sort((a, b) => a - b), [...esperados].sort((a, b) => a - b), `marcadores distintos de valores en:\n${c.texto}`);
}

function registro(extra: Partial<RegistroParaIndice> = {}): RegistroParaIndice {
  return {
    id: "idea:columna-uvas",
    tipo: "estructura",
    nombre: "Columna con uvas",
    descripcion: "Columna orgánica",
    fuente: { tipo: "idea-sempertex", titulo: "Sempertex · Grado", url: "https://ejemplo.test/idea", foto: "https://ejemplo.test/foto.jpg" },
    ocasiones: ["graduacion", "graduacion"],
    tiposPieza: ["columna_organica"],
    formatos: ["R-24", "R-12"],
    colores: ["570", "970"],
    partes: ["cuerpo"],
    lineasPartes: [
      { parte: "cuerpo", formatoId: "R-24", codigo: "570", cantidad: 10 },
      { parte: "cuerpo", formatoId: "R-24", codigo: "570", cantidad: 5 },
      { parte: "cuerpo", formatoId: "R-12", codigo: "970", cantidad: 20 },
    ],
    productos: ["R-24 dorado"],
    medidas: { altoCm: 240, anchoCm: 60, fondoCm: null },
    globos: 35,
    tubos: 0,
    hash: "abc123",
    ficha: "Columna orgánica dorada con uvas.",
    clasificacion: { celebraciones: ["graduacion", "grado-universidad"], tematicas: ["uvas"] },
    ...extra,
  };
}

// --- upsert del item -----------------------------------------------------------------------------------------
{
  const c = construirUpsertItem(registro());
  assert.equal(c.valores.length, 24);
  marcadoresCuadran(c);
  assert.equal(c.valores[0], "idea:columna-uvas");
  assert.equal(c.valores[1], "estructura");
  assert.equal(c.valores[6], "https://ejemplo.test/idea", "fuente_url");
  assert.equal(c.valores[7], "https://ejemplo.test/foto.jpg", "foto_url");
  assert.deepEqual(c.valores[8], ["graduacion"], "ocasiones sin repetidos");
  assert.deepEqual(c.valores[9], ["graduacion", "grado-universidad"], "celebraciones de la clasificación");
  assert.deepEqual(c.valores[10], ["uvas"]);
  assert.deepEqual(c.valores[12], ["R-24", "R-12"]);
  assert.deepEqual(c.valores.slice(16, 19), [240, 60, null], "alto, ancho, fondo");
  assert.equal(c.valores[19], 35);
  assert.equal(c.valores[22], "abc123", "hash");
  assert.equal(c.valores[23], null, "de fábrica = propietario NULL");
  ok("upsert del item: 24 parámetros en orden, arreglos sin repetidos, propietario NULL");

  assert.match(c.texto, /ON CONFLICT \(id\) DO UPDATE/);
  assert.match(c.texto, /WHERE taller_items\.hash IS DISTINCT FROM EXCLUDED\.hash OR NOT taller_items\.activo/, "salta lo que no cambió");
  assert.match(c.texto, /RETURNING id, \(xmax = 0\) AS insertado/);
  assert.match(c.texto, /\$9::text\[\]/, "los arreglos llevan cast");
  assert.ok(!/SET id =/.test(c.texto), "no reasigna la clave");
  ok("upsert del item: se salta por hash (no devuelve fila si no cambió)");

  const propio = valoresDeItem(registro(), { propietario: "dueno-1" });
  assert.equal(propio[23], "dueno-1");
  ok("item de un dueño lleva su propietario");

  const sinClasificacion = valoresDeItem(registro({ clasificacion: undefined, medidas: {} }));
  assert.deepEqual(sinClasificacion[9], []);
  assert.deepEqual(sinClasificacion.slice(16, 19), [null, null, null]);
  ok("sin clasificación ni medidas: arreglos vacíos y NULL");
}

// --- partes -------------------------------------------------------------------------------------------------
{
  assert.deepEqual(lineasDePartes(registro()), [
    { parte: "cuerpo", formatoId: "R-24", codigo: "570", cantidad: 15 },
    { parte: "cuerpo", formatoId: "R-12", codigo: "970", cantidad: 20 },
  ]);
  ok("líneas repetidas de (parte, formato, código) se suman");

  const [insert, ...resto] = construirInsertPartes(registro());
  assert.equal(resto.length, 0);
  assert.ok(insert);
  assert.equal(insert.valores.length, 1 + 4 * 2);
  assert.deepEqual(insert.valores.slice(0, 5), ["idea:columna-uvas", "cuerpo", "R-24", "570", 15]);
  marcadoresCuadran(insert);
  assert.match(insert.texto, /\(\$1, \$2, \$3, \$4, \$5::integer\), \(\$1, \$6, \$7, \$8, \$9::integer\)/);
  ok("INSERT de partes: $1 compartido y 4 parámetros por línea");

  assert.deepEqual(construirInsertPartes(registro({ lineasPartes: [] })), []);
  const muchas = Array.from({ length: 501 }, (_, i) => ({ parte: "p", formatoId: `F-${i}`, codigo: "", cantidad: 1 }));
  const trozos = construirInsertPartes(registro({ lineasPartes: muchas }));
  assert.equal(trozos.length, 2);
  assert.equal(trozos[0]!.valores.length, 1 + 4 * 500);
  assert.equal(trozos[1]!.valores.length, 1 + 4);
  trozos.forEach(marcadoresCuadran);
  ok("sin líneas no hay INSERT; más de 500 se parte en trozos");

  assert.deepEqual(construirBorrarPartes("x"), { texto: "DELETE FROM taller_items_partes WHERE item_id = $1", valores: ["x"] });
  ok("borrar partes del item");
}

// --- cambios por hash -----------------------------------------------------------------------------------------
{
  const a = registro({ id: "a", hash: "h1" });
  const b = registro({ id: "b", hash: "h2" });
  const c = registro({ id: "c", hash: "h3" });
  const d = registro({ id: "d", hash: "h4" });
  const r = clasificarCambios([a, b, c, d], new Map([
    ["a", { hash: "h1", activo: true }],
    ["b", { hash: "viejo", activo: true }],
    ["d", { hash: "h4", activo: false }],
    ["z", { hash: "h9", activo: true }],
    ["y", { hash: "h9", activo: false }],
  ]));
  assert.deepEqual(r.sinCambio.map((x) => x.id), ["a"]);
  assert.deepEqual(r.cambiados.map((x) => x.id), ["b"]);
  assert.deepEqual(r.nuevos.map((x) => x.id), ["c"]);
  assert.deepEqual(r.reactivados.map((x) => x.id), ["d"]);
  assert.deepEqual(r.ausentes, ["z"], "solo los activos que ya no están se desactivan");
  ok("clasificación: sin cambio / cambiado / nuevo / reactivado / ausente");

  const des = construirDesactivarAusentes(["a", "b"]);
  assert.deepEqual(des.valores, [["a", "b"]]);
  assert.match(des.texto, /propietario IS NULL AND activo AND id <> ALL\(\$1::text\[\]\)/);
  marcadoresCuadran(des);
  ok("desactivar ausentes solo toca lo de fábrica");
}

// --- embeddings -----------------------------------------------------------------------------------------------
{
  const vector = Array.from({ length: DIMENSIONES_VECTOR_TALLER }, (_, i) => i / 1000);
  const c = construirUpsertEmbedding({ itemId: "a", modalidad: "texto", modelo: "gemini-embedding-2", vector, hashEntrada: "he" });
  assert.equal(c.valores.length, 6);
  marcadoresCuadran(c);
  assert.deepEqual(c.valores.slice(0, 4), ["a", "texto", "gemini-embedding-2", 768]);
  assert.ok(String(c.valores[4]).startsWith("[0,0.001,0.002") && String(c.valores[4]).endsWith("]"));
  assert.equal(c.valores[5], "he");
  assert.match(c.texto, /ON CONFLICT \(item_id, modalidad, modelo\) DO UPDATE/);
  assert.match(c.texto, /WHERE taller_items_embeddings\.hash_entrada IS DISTINCT FROM EXCLUDED\.hash_entrada/);
  assert.match(c.texto, /\$5::vector/);
  ok("upsert de embedding: parámetros en orden y se salta si el hash de entrada no cambió");

  assert.throws(() => construirUpsertEmbedding({ itemId: "a", modalidad: "texto", modelo: "m", vector: [1, 2, 3], hashEntrada: "h" }), /768/);
  assert.throws(() => construirUpsertEmbedding({ itemId: "a", modalidad: "texto", modelo: "m", vector: vector.map((n, i) => (i === 5 ? Number.NaN : n)), hashEntrada: "h" }), /no finitos/);
  ok("rechaza vectores de otro tamaño o con NaN");

  const q = construirConsultaEmbeddingsDeTexto();
  assert.deepEqual(q.valores, ["gemini-embedding-2"]);
  marcadoresCuadran(q);

  const a = registro({ id: "a", ficha: "ficha a" });
  const b = registro({ id: "b", ficha: "ficha b" });
  const e = registro({ id: "e", ficha: "ficha e" });
  const f = registro({ id: "f", ficha: "ficha f" });
  const faltan = itemsSinEmbeddingVigente([a, b, e, f], new Map<string, string | null>([
    ["a", hashEntradaTexto("ficha a")],
    ["b", hashEntradaTexto("ficha vieja")],
    ["e", null],
  ]));
  assert.deepEqual(faltan.map((x) => x.id), ["b", "e", "f"]);
  ok("items sin embedding vigente: ficha cambiada, sin vector o sin fila");
}

// --- JSONL -----------------------------------------------------------------------------------------------------
{
  const buena = JSON.stringify({ id: "a", tipo: "escena", nombre: "A", hash: "h", ficha: "f", lineasPartes: [{ parte: "p", formatoId: "R-5" }, 7], fuente: { tipo: "propio", titulo: "t" } });
  const { registros, errores } = leerFichasJsonl([buena, "", "{no json", JSON.stringify({ id: "b", tipo: "escena", nombre: "B" }), buena, JSON.stringify({ id: "c", tipo: "x", nombre: "C", hash: "h" })].join("\n"));
  assert.deepEqual(registros.map((r) => r.id), ["a", "c"]);
  assert.equal(errores.length, 3);
  assert.ok(errores.some((e) => /JSON inválido/.test(e)) && errores.some((e) => /sin hash/.test(e)) && errores.some((e) => /id repetido/.test(e)));
  assert.deepEqual(registros[0]!.lineasPartes, [{ parte: "p", formatoId: "R-5", codigo: "", cantidad: 0 }]);
  assert.deepEqual(registros[1]!.formatos, [], "campos que faltan quedan vacíos");
  ok("JSONL: descarta JSON roto, sin hash y repetidos; completa lo que falta");
}

{
  // Las fichas reales traen colores {codigo, nombre} y productos {origen, nombre, url, cantidad}: se indexan los códigos y los nombres.
  const { registros } = leerFichasJsonl(JSON.stringify({ id: "x", tipo: "estructura", nombre: "X", hash: "h", colores: [{ codigo: "570", nombre: "Metal Dorado" }, "005"], productos: [{ origen: "globo", nombre: "GLOBO REDONDO METAL DORADO", url: "u", cantidad: 3 }] }));
  assert.deepEqual(registros[0]!.colores, ["570", "005"]);
  assert.deepEqual(registros[0]!.productos, ["GLOBO REDONDO METAL DORADO"]);
  ok("JSONL: colores y productos como objetos → códigos y nombres");
}

console.log(`\n${casos} casos ok`);
