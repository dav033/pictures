import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { leerIndiceVectores, leerVectoresCacheados, vectorALiteralPgvector } from "./vectores-cache";

type Linea = { id: string; modalidad: string; modelo: string; dims: number; hash_entrada: string; offset: number };

/** Mismo formato que escribe `cache_vectores.py`: float32 little-endian seguidos + una línea de índice por vector. */
function fixture(vectores: { linea: Omit<Linea, "offset">; valores: number[] }[]) {
  const carpeta = mkdtempSync(path.join(tmpdir(), "vectores-cache-"));
  const partes: Buffer[] = [];
  const lineas: string[] = [];
  let offset = 0;
  for (const { linea, valores } of vectores) {
    const buffer = Buffer.alloc(valores.length * 4);
    valores.forEach((v, i) => buffer.writeFloatLE(v, i * 4));
    partes.push(buffer);
    lineas.push(JSON.stringify({ ...linea, offset, ts: "2026-10-08T00:00:00+00:00" }));
    offset += buffer.length;
  }
  writeFileSync(path.join(carpeta, "vectores.f32"), Buffer.concat(partes));
  writeFileSync(path.join(carpeta, "indice.jsonl"), lineas.join("\n") + "\n");
  return carpeta;
}

const base = { modelo: "gemini-embedding-2", dims: 4, hash_entrada: "h" };

test("lee los vectores del índice con sus metadatos", () => {
  const carpeta = fixture([
    { linea: { ...base, id: "a", modalidad: "texto" }, valores: [0.5, -0.25, 1, 0] },
    { linea: { ...base, id: "a", modalidad: "imagen_render", hash_entrada: "r1" }, valores: [1, 2, 3, 4] },
  ]);
  try {
    const todos = leerVectoresCacheados(carpeta, { dims: 4 });
    assert.equal(todos.length, 2);
    const texto = todos.find((v) => v.modalidad === "texto");
    assert.deepEqual([...texto!.vector], [0.5, -0.25, 1, 0]);
    assert.equal(texto!.hashEntrada, "h");
    const render = todos.find((v) => v.modalidad === "imagen_render");
    assert.deepEqual([...render!.vector], [1, 2, 3, 4]);
    assert.equal(render!.hashEntrada, "r1");
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});

test("gana la última línea de cada clave y se filtra por modelo, dimensiones, modalidad e ids", () => {
  const carpeta = fixture([
    { linea: { ...base, id: "a", modalidad: "texto", hash_entrada: "viejo" }, valores: [1, 1, 1, 1] },
    { linea: { ...base, id: "a", modalidad: "texto", hash_entrada: "nuevo" }, valores: [2, 2, 2, 2] },
    { linea: { ...base, id: "b", modalidad: "imagen_foto" }, valores: [3, 3, 3, 3] },
    { linea: { ...base, id: "c", modalidad: "texto", modelo: "otro" }, valores: [4, 4, 4, 4] },
    { linea: { ...base, id: "d", modalidad: "texto", dims: 2 }, valores: [5, 5] },
  ]);
  try {
    const vigentes = leerIndiceVectores(carpeta, { dims: 4 });
    assert.deepEqual(vigentes.map((e) => [e.id, e.modalidad, e.hashEntrada]), [["a", "texto", "nuevo"], ["b", "imagen_foto", "h"]]);
    assert.deepEqual(leerIndiceVectores(carpeta, { dims: 4, modalidades: ["imagen_foto"] }).map((e) => e.id), ["b"]);
    assert.deepEqual(leerIndiceVectores(carpeta, { dims: 4, ids: new Set(["a"]) }).map((e) => e.id), ["a"]);
    assert.deepEqual(leerIndiceVectores(carpeta, { dims: 4, modelo: "otro" }).map((e) => e.id), ["c"]);
    assert.deepEqual(leerIndiceVectores(carpeta, { dims: 2 }).map((e) => e.id), ["d"]);
    assert.deepEqual([...leerVectoresCacheados(carpeta, { dims: 4, ids: new Set(["a"]) })[0].vector], [2, 2, 2, 2]);
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});

test("ignora líneas cortadas, modalidades desconocidas y vectores fuera del archivo", () => {
  const carpeta = fixture([{ linea: { ...base, id: "a", modalidad: "texto" }, valores: [1, 2, 3, 4] }]);
  try {
    const indice = path.join(carpeta, "indice.jsonl");
    appendFileSync(indice, "{\"id\": \"b\", \"modalidad\": \"tex\n");
    appendFileSync(indice, JSON.stringify({ ...base, id: "c", modalidad: "video", offset: 0 }) + "\n");
    appendFileSync(indice, JSON.stringify({ ...base, id: "d", modalidad: "texto", offset: 1_000_000 }) + "\n");
    assert.deepEqual(leerIndiceVectores(carpeta, { dims: 4 }).map((e) => e.id), ["a"]);
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});

test("una carpeta sin caché devuelve vacío", () => {
  assert.deepEqual(leerVectoresCacheados(path.join(tmpdir(), "no-existe-vectores-cache")), []);
});

test("el literal de pgvector es [a,b,…] y rechaza valores no finitos", () => {
  assert.equal(vectorALiteralPgvector(new Float32Array([0.5, -2, 0])), "[0.5,-2,0]");
  assert.throws(() => vectorALiteralPgvector([1, Number.NaN]), /no finito/);
});
