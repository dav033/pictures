import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { config, proxy } from "../src/proxy";

const matcher = new RegExp(`^${config.matcher[0]}$`);

for (const [path, shouldMatch] of [
  ["/api/rag/webhooks/shopify", false],
  ["/api/happie/webhook", false],
  ["/api/chat", true],
  ["/login", false],
  ["/api/login", false],
] as const) {
  assert.equal(matcher.test(path), shouldMatch, `resultado inesperado para ${path}`);
}

console.log("Proxy matcher: OK");

async function probarFailClosed() {
  const previousPassword = process.env.APP_PASSWORD;
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    delete process.env.APP_PASSWORD;
    Reflect.set(process.env, "NODE_ENV", "production");

    const apiResponse = proxy(new NextRequest("https://example.test/api/chat"));
    assert.equal(apiResponse.status, 503, "la API debe fallar cerrado sin APP_PASSWORD en producción");
    assert.deepEqual(await apiResponse.json(), {
      code: "AUTH_NOT_CONFIGURED",
      message: "La autenticación del servicio no está configurada.",
    });

    const pageResponse = proxy(new NextRequest("https://example.test/"));
    assert.equal(pageResponse.status, 307, "la UI debe redirigir al login sin APP_PASSWORD en producción");
    assert.equal(pageResponse.headers.get("location"), "https://example.test/login?error=auth-config");
  } finally {
    if (previousPassword === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = previousPassword;
    if (previousNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
  }
}

probarFailClosed()
  .then(() => console.log("Proxy fail-closed: OK"))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
