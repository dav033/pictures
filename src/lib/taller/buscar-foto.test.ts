import assert from "node:assert/strict";
import test from "node:test";
import { LIMITE_FOTO, MENSAJE_SIN_BIBLIOTECA, TOPE_BYTES_FOTO, atenderBusquedaFoto, type DependenciasBuscarFoto } from "./buscar-foto";
import type { EntradaBusqueda, RespuestaBusquedaTaller } from "./buscar";

const VECTOR = Array.from({ length: 768 }, () => 0.036);
const RAG: RespuestaBusquedaTaller = { fuente: "rag", resultados: [], ids: ["x:1", "x:2"], ramas: ["vector_imagen"], interpretacion: null, avisos: [] };

type Llamadas = { embeber: Array<{ bytes: number; mime: string; superficie?: string }>; buscar: EntradaBusqueda[]; normalizar: number };

function deps(extra: Partial<DependenciasBuscarFoto> = {}): { deps: DependenciasBuscarFoto; llamadas: Llamadas } {
  const llamadas: Llamadas = { embeber: [], buscar: [], normalizar: 0 };
  return {
    llamadas,
    deps: {
      autenticado: () => true,
      mismoOrigen: () => true,
      habilitado: true,
      normalizar: async (b) => { llamadas.normalizar += 1; return b.slice(0, 4); },
      embeber: async (bytes, mime, t) => { llamadas.embeber.push({ bytes: bytes.byteLength, mime, superficie: t?.superficie }); return VECTOR; },
      buscar: async (e) => { llamadas.buscar.push(e); return RAG; },
      ...extra,
    },
  };
}

function peticion(opciones: { bytes?: number; tipo?: string; campo?: string; tipos?: string; sinFormulario?: boolean; encabezados?: Record<string, string> } = {}): Request {
  const encabezados = opciones.encabezados ?? {};
  if (opciones.sinFormulario) return new Request("http://localhost/api/taller/buscar-foto", { method: "POST", body: "no es un formulario", headers: { "content-type": "text/plain", ...encabezados } });
  const f = new FormData();
  f.set(opciones.campo ?? "imagen", new Blob([new Uint8Array(opciones.bytes ?? 100)], { type: opciones.tipo ?? "image/jpeg" }), "foto.jpg");
  if (opciones.tipos !== undefined) f.set("tipos", opciones.tipos);
  return new Request("http://localhost/api/taller/buscar-foto", { method: "POST", body: f, headers: encabezados });
}

const cuerpo = async (r: Response) => (await r.json()) as Record<string, unknown>;

test("camino feliz: normaliza, embebe como JPEG con la superficie del taller y busca por el vector de imagen", async () => {
  const { deps: d, llamadas } = deps();
  const r = await atenderBusquedaFoto(peticion({ tipos: JSON.stringify(["escena", "conjunto"]) }), d);
  assert.equal(r.status, 200);
  const c = await cuerpo(r);
  assert.equal(c.disponible, true);
  assert.deepEqual(c.ids, ["x:1", "x:2"]);
  assert.equal((c.vectorImagen as number[]).length, 768);
  assert.deepEqual(llamadas.embeber, [{ bytes: 4, mime: "image/jpeg", superficie: "taller_biblioteca" }]);
  assert.equal(llamadas.buscar.length, 1);
  assert.deepEqual(llamadas.buscar[0], { vectorImagen: VECTOR, filtros: { tipos: ["escena", "conjunto"] }, limite: LIMITE_FOTO });
});

test("sin «tipos» busca en todos", async () => {
  const { deps: d, llamadas } = deps();
  await atenderBusquedaFoto(peticion(), d);
  assert.deepEqual(llamadas.buscar[0]?.filtros, {});
});

test("sin sesión o de otro origen: 401 y no gasta nada", async () => {
  for (const extra of [{ autenticado: () => false }, { mismoOrigen: () => false }]) {
    const { deps: d, llamadas } = deps(extra);
    const r = await atenderBusquedaFoto(peticion(), d);
    assert.equal(r.status, 401);
    assert.equal(llamadas.embeber.length + llamadas.buscar.length + llamadas.normalizar, 0);
  }
});

test("bandera apagada: 503 con el mensaje claro y SIN embeber (no se paga la foto)", async () => {
  const { deps: d, llamadas } = deps({ habilitado: false });
  const r = await atenderBusquedaFoto(peticion(), d);
  assert.equal(r.status, 503);
  assert.deepEqual(await cuerpo(r), { disponible: false, error: MENSAJE_SIN_BIBLIOTECA });
  assert.equal(llamadas.embeber.length + llamadas.buscar.length, 0);
});

test("base sin responder (cayó a memoria): 503 con el mensaje, sin resultados inventados", async () => {
  const memoria: RespuestaBusquedaTaller = { ...RAG, fuente: "memoria", ids: ["m:1"], avisos: ["La base de datos de la biblioteca no respondió; se buscó en memoria."] };
  const { deps: d } = deps({ buscar: async () => memoria });
  const r = await atenderBusquedaFoto(peticion(), d);
  assert.equal(r.status, 503);
  const c = await cuerpo(r);
  assert.equal(c.disponible, false);
  assert.equal(c.error, MENSAJE_SIN_BIBLIOTECA);
  assert.equal("ids" in c, false);
});

test("tamaño: más de 6 MB es 413 (por cabecera o por el archivo), exactamente 6 MB pasa", async () => {
  const { deps: d, llamadas } = deps();
  assert.equal((await atenderBusquedaFoto(peticion({ bytes: TOPE_BYTES_FOTO + 1 }), d)).status, 413);
  assert.equal((await atenderBusquedaFoto(peticion({ encabezados: { "content-length": String(TOPE_BYTES_FOTO * 2) } }), d)).status, 413);
  assert.equal(llamadas.embeber.length, 0);
  assert.equal((await atenderBusquedaFoto(peticion({ bytes: TOPE_BYTES_FOTO }), d)).status, 200);
});

test("tipo de archivo: solo JPEG, PNG o WebP (415)", async () => {
  const { deps: d, llamadas } = deps();
  for (const tipo of ["image/gif", "application/pdf", "text/plain", "image/svg+xml"]) {
    assert.equal((await atenderBusquedaFoto(peticion({ tipo }), d)).status, 415, tipo);
  }
  for (const tipo of ["image/jpeg", "image/png", "image/webp"]) {
    assert.equal((await atenderBusquedaFoto(peticion({ tipo }), d)).status, 200, tipo);
  }
  assert.equal(llamadas.embeber.length, 3);
});

test("formulario mal hecho: 400 (sin formulario, campo con otro nombre, vacía, «tipos» inválido)", async () => {
  const { deps: d, llamadas } = deps();
  assert.equal((await atenderBusquedaFoto(peticion({ sinFormulario: true }), d)).status, 400);
  assert.equal((await atenderBusquedaFoto(peticion({ campo: "foto" }), d)).status, 400);
  assert.equal((await atenderBusquedaFoto(peticion({ bytes: 0 }), d)).status, 400);
  assert.equal((await atenderBusquedaFoto(peticion({ tipos: "no-json" }), d)).status, 400);
  assert.equal((await atenderBusquedaFoto(peticion({ tipos: JSON.stringify({ a: 1 }) }), d)).status, 400);
  assert.equal(llamadas.embeber.length, 0);
});

test("un archivo que no es imagen (normalizar lanza): 400 y no se embebe", async () => {
  const { deps: d, llamadas } = deps({ normalizar: async () => { throw new Error("Input buffer contains unsupported image format"); } });
  const r = await atenderBusquedaFoto(peticion(), d);
  assert.equal(r.status, 400);
  assert.equal(llamadas.embeber.length, 0);
});

test("si Gemini falla: 502 con un mensaje para el usuario (sin filtrar el error interno)", async () => {
  const { deps: d } = deps({ embeber: async () => { throw new Error("429 RESOURCE_EXHAUSTED sk-secreto"); } });
  const r = await atenderBusquedaFoto(peticion(), d);
  assert.equal(r.status, 502);
  const texto = JSON.stringify(await cuerpo(r));
  assert.ok(!texto.includes("sk-secreto") && !texto.includes("429"));
});

test("con las guardas reales: sin la cookie de sesión es 401 y con otro origen también", async () => {
  const { isAuthenticatedRequest, isSameOriginRequest } = await import("@/lib/auth/request");
  const { sessionToken, SESSION_COOKIE } = await import("@/lib/auth/session");
  const previo = { pass: process.env.APP_PASSWORD, dev: process.env.DEV_REQUIRE_LOGIN };
  process.env.APP_PASSWORD = "clave-de-prueba";
  try {
    const { deps: d } = deps({ autenticado: isAuthenticatedRequest, mismoOrigen: isSameOriginRequest });
    assert.equal((await atenderBusquedaFoto(peticion(), d)).status, 401);
    const cookie = `${SESSION_COOKIE}=${sessionToken("clave-de-prueba")}`;
    assert.equal((await atenderBusquedaFoto(peticion({ encabezados: { cookie } }), d)).status, 200);
    assert.equal((await atenderBusquedaFoto(peticion({ encabezados: { cookie, origin: "https://otro.example" } }), d)).status, 401);
  } finally {
    if (previo.pass === undefined) delete process.env.APP_PASSWORD; else process.env.APP_PASSWORD = previo.pass;
  }
});
