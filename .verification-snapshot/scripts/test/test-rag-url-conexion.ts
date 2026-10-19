/**
 * `sslmode` de la URL de Neon (src/lib/rag/url-conexion.ts): `pg` trata `require`, `prefer` y `verify-ca` como `verify-full` y lo
 * avisa como «SECURITY WARNING» en cada lectura de la URL, que Vercel deja a nivel «error» en cada arranque en frío. Con
 * `verify-full` explícito no hay aviso y la configuración TLS que arma `pg` es EXACTAMENTE la de hoy (no se afloja nada).
 * Sin coste, sin red ni base.
 *
 * Run: npx tsx scripts/test/test-rag-url-conexion.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "pg-connection-string";
import { urlConSslExplicito } from "../../src/lib/rag/url-conexion";

const BASE = "postgresql://usuario:clave%40rara@ep-ejemplo.us-east-2.aws.neon.tech/neondb";

test("require, prefer y verify-ca pasan a verify-full; el resto de la URL (usuario, clave, otros parámetros) queda intacto", () => {
  for (const modo of ["require", "prefer", "verify-ca"]) {
    assert.equal(urlConSslExplicito(`${BASE}?sslmode=${modo}`), `${BASE}?sslmode=verify-full`, modo);
    assert.equal(urlConSslExplicito(`${BASE}?channel_binding=require&sslmode=${modo}&application_name=demo`), `${BASE}?channel_binding=require&sslmode=verify-full&application_name=demo`, modo);
  }
});

test("lo que no se debe tocar no se toca: verify-full, disable, sin sslmode, uselibpqcompat y una URL que no es URL", () => {
  for (const url of [`${BASE}?sslmode=verify-full`, `${BASE}?sslmode=disable`, BASE, `${BASE}?uselibpqcompat=true&sslmode=require`, "no es una url", "", `${BASE}?otro_sslmode=require`]) {
    assert.equal(urlConSslExplicito(url), url);
  }
});

test("con verify-full explícito pg no avisa, y arma la misma configuración TLS que con require (no se afloja nada)", async () => {
  const avisos: string[] = [];
  const alAvisar = (aviso: Error) => { avisos.push(aviso.message); };
  process.on("warning", alAvisar);
  try {
    const explicita = parse(urlConSslExplicito(`${BASE}?sslmode=require`));
    await new Promise((resolver) => setImmediate(resolver));
    assert.deepEqual(avisos, []);
    const original = parse(`${BASE}?sslmode=require`);
    assert.deepEqual(explicita.ssl, original.ssl);
    assert.ok(explicita.ssl, "sigue siendo TLS");
    assert.notEqual((explicita.ssl as { rejectUnauthorized?: boolean }).rejectUnauthorized, false, "sigue verificando el certificado");
  } finally {
    process.off("warning", alAvisar);
  }
});
