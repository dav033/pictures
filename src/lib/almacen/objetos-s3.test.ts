import assert from "node:assert/strict";
import test from "node:test";
import { ErrorAlmacen, configuracionAlmacen, crearClienteAlmacen, firmarPeticion, firmarUrlGet } from "./objetos-s3";

const CONFIG = { endpoint: "https://almacen.test", region: "garage", bucket: "decoracion-feedback", accessKeyId: "GKtest", secretAccessKey: "secreto" };
const HASH_VACIO = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const AWS_CLAVE = { region: "us-east-1", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
const FECHA_AWS = new Date("2013-05-24T00:00:00Z");

test("la firma SigV4 coincide con el vector publicado por AWS (GET Object con Range)", () => {
  const cabeceras = firmarPeticion({
    ...AWS_CLAVE,
    metodo: "GET",
    url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
    fecha: FECHA_AWS,
    hashCuerpo: HASH_VACIO,
    cabeceras: { range: "bytes=0-9" },
  });
  assert.match(cabeceras.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
});

test("la URL firmada coincide con el vector publicado por AWS (presigned GET)", () => {
  const url = firmarUrlGet({ ...AWS_CLAVE, url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"), fecha: FECHA_AWS, caducaEnSegundos: 86400 });
  assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
  assert.match(url, /X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request/);
});

test("configuracionAlmacen es null sin las variables y valida el endpoint", () => {
  assert.equal(configuracionAlmacen({}), null);
  assert.equal(configuracionAlmacen({ ALMACEN_S3_ENDPOINT: "no-es-url", ALMACEN_S3_BUCKET: "bucket", ALMACEN_S3_ACCESS_KEY_ID: "a", ALMACEN_S3_SECRET_ACCESS_KEY: "b" }), null);
  const valida = configuracionAlmacen({ ALMACEN_S3_ENDPOINT: "https://almacen.test/", ALMACEN_S3_BUCKET: "bucket", ALMACEN_S3_ACCESS_KEY_ID: "a", ALMACEN_S3_SECRET_ACCESS_KEY: "b" });
  assert.deepEqual(valida, { endpoint: "https://almacen.test", region: "garage", bucket: "bucket", accessKeyId: "a", secretAccessKey: "b" });
});

type Llamada = { url: string; metodo: string; cabeceras: Record<string, string>; cuerpo: Uint8Array | undefined };

function almacenFalso(respuestas: Response[]) {
  const llamadas: Llamada[] = [];
  const llamar: typeof fetch = async (entrada, init) => {
    llamadas.push({
      url: String(entrada),
      metodo: init?.method ?? "GET",
      cabeceras: init?.headers as Record<string, string>,
      cuerpo: init?.body ? new Uint8Array(init.body as Buffer) : undefined,
    });
    const siguiente = respuestas.shift();
    assert.ok(siguiente, "llamada inesperada al almacén");
    return siguiente;
  };
  return { llamadas, cliente: crearClienteAlmacen(CONFIG, llamar) };
}

test("poner sube el objeto por ruta firmada y sin exponer la clave secreta", async () => {
  const { llamadas, cliente } = almacenFalso([new Response(null, { status: 200 })]);
  await cliente.poner("feedback/taller/t1/antes.jpg", new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg");
  const [llamada] = llamadas;
  assert.equal(llamada.url, "https://almacen.test/decoracion-feedback/feedback/taller/t1/antes.jpg");
  assert.equal(llamada.metodo, "PUT");
  assert.deepEqual([...llamada.cuerpo!], [0xff, 0xd8, 0xff]);
  assert.equal(llamada.cabeceras["content-type"], "image/jpeg");
  assert.match(llamada.cabeceras.authorization, /^AWS4-HMAC-SHA256 Credential=GKtest\/\d{8}\/garage\/s3\/aws4_request/);
  assert.ok(!JSON.stringify(llamada).includes("secreto"));
});

test("obtener devuelve null si no existe y falla tipado si el almacén rechaza", async () => {
  const { cliente } = almacenFalso([new Response(null, { status: 404 }), new Response("no", { status: 403 })]);
  assert.equal(await cliente.obtener("modulos/x.png"), null);
  await assert.rejects(() => cliente.obtener("modulos/x.png"), (error: unknown) => error instanceof ErrorAlmacen && error.estado === 403);
});

test("existe usa HEAD y borrar tolera una clave ausente", async () => {
  const { llamadas, cliente } = almacenFalso([new Response(null, { status: 200 }), new Response(null, { status: 404 }), new Response(null, { status: 204 }), new Response(null, { status: 404 })]);
  assert.equal(await cliente.existe("modulos/a.png"), true);
  assert.equal(await cliente.existe("modulos/b.png"), false);
  await cliente.borrar("modulos/a.png");
  await cliente.borrar("modulos/b.png");
  assert.deepEqual(llamadas.map((l) => l.metodo), ["HEAD", "HEAD", "DELETE", "DELETE"]);
});

test("urlFirmada apunta al bucket, caduca y rechaza caducidades fuera de rango", () => {
  const { cliente } = almacenFalso([]);
  const url = new URL(cliente.urlFirmada("modulos/a b.png", 3600));
  assert.equal(url.pathname, "/decoracion-feedback/modulos/a%20b.png");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "3600");
  assert.ok(!url.href.includes("secreto"));
  assert.throws(() => cliente.urlFirmada("modulos/a.png", 0), ErrorAlmacen);
  assert.throws(() => cliente.urlFirmada("modulos/a.png", 604_801), ErrorAlmacen);
});

test("un fallo de red se convierte en ErrorAlmacen", async () => {
  const cliente = crearClienteAlmacen(CONFIG, async () => { throw new Error("ECONNREFUSED"); });
  await assert.rejects(() => cliente.poner("a.jpg", new Uint8Array([1]), "image/jpeg"), ErrorAlmacen);
});
