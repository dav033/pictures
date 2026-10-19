/**
 * El origen de un pedido (`isSameOriginRequest`, una sola vez para todas las rutas con sesión: buscar-foto, escena-desde-foto,
 * similitud…): sin lista permitida solo vale el origen de la URL del pedido; detrás de un proxy hace falta `APP_ORIGINS`;
 * localhost y 127.0.0.1 valen con cualquier puerto solo fuera de producción; la cabecera `Host` no cuenta.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-origen-pedido.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isSameOriginRequest } from "@/lib/auth/request";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const entorno = process.env as Record<string, string | undefined>;
function con<T>(cambios: Record<string, string | undefined>, fn: () => T): T {
  const previo = Object.fromEntries(Object.keys(cambios).map((k) => [k, entorno[k]]));
  for (const [k, v] of Object.entries(cambios)) { if (v === undefined) delete entorno[k]; else entorno[k] = v; }
  try { return fn(); } finally { for (const [k, v] of Object.entries(previo)) { if (v === undefined) delete entorno[k]; else entorno[k] = v; } }
}
const peticion = (url: string, cabeceras: Record<string, string> = {}) => new Request(url, { method: "POST", headers: cabeceras });

console.log("Origen del pedido");
prueba("sin cabecera Origin vale (no es un navegador de otro sitio)", () => {
  assert.equal(isSameOriginRequest(peticion("https://app.example.com/api/x")), true);
});
prueba("el origen de la URL del pedido vale", () => {
  con({ APP_ORIGINS: undefined, NODE_ENV: "production" }, () => assert.equal(isSameOriginRequest(peticion("https://app.example.com/api/x", { origin: "https://app.example.com" })), true));
});
prueba("detrás de un proxy (URL interna, origen público) NO vale sin APP_ORIGINS y vale con él", () => {
  const detrasDelProxy = () => peticion("http://10.0.0.5:3000/api/x", { origin: "https://app.example.com", host: "app.example.com" });
  con({ APP_ORIGINS: undefined, NODE_ENV: "production" }, () => assert.equal(isSameOriginRequest(detrasDelProxy()), false, "la cabecera Host no basta"));
  con({ APP_ORIGINS: "https://app.example.com", NODE_ENV: "production" }, () => assert.equal(isSameOriginRequest(detrasDelProxy()), true));
  con({ APP_ORIGINS: "https://otra.example.com, https://app.example.com/ ", NODE_ENV: "production" }, () => assert.equal(isSameOriginRequest(detrasDelProxy()), true, "lista con espacios y barra final"));
});
prueba("un sitio ajeno no vale ni con la lista permitida de la app ni con un Host que coincida", () => {
  con({ APP_ORIGINS: "https://app.example.com", NODE_ENV: "production" }, () => {
    assert.equal(isSameOriginRequest(peticion("http://10.0.0.5:3000/api/x", { origin: "https://sitio-ajeno.example", host: "sitio-ajeno.example" })), false);
    assert.equal(isSameOriginRequest(peticion("http://10.0.0.5:3000/api/x", { origin: "https://app.example.com.evil.example" })), false);
    assert.equal(isSameOriginRequest(peticion("http://10.0.0.5:3000/api/x", { origin: "no es una url" })), false);
  });
});
prueba("una entrada mal escrita en APP_ORIGINS no abre nada", () => {
  con({ APP_ORIGINS: "*, no-es-url,", NODE_ENV: "production" }, () => assert.equal(isSameOriginRequest(peticion("http://10.0.0.5:3000/api/x", { origin: "https://sitio-ajeno.example" })), false));
});
prueba("en desarrollo localhost y 127.0.0.1 valen con cualquier puerto (Next arma la URL con localhost aunque se abra por 127.0.0.1)", () => {
  con({ APP_ORIGINS: undefined, NODE_ENV: "development" }, () => {
    assert.equal(isSameOriginRequest(peticion("http://localhost:3015/api/x", { origin: "http://127.0.0.1:3015" })), true);
    assert.equal(isSameOriginRequest(peticion("http://localhost:3015/api/x", { origin: "http://localhost:3000" })), true);
    assert.equal(isSameOriginRequest(peticion("http://localhost:3015/api/x", { origin: "http://localhost.evil.example" })), false);
    assert.equal(isSameOriginRequest(peticion("http://localhost:3015/api/x", { origin: "https://sitio-ajeno.example", host: "127.0.0.1:3015" })), false);
  });
});
prueba("en producción localhost y 127.0.0.1 NO valen por sí solos", () => {
  con({ APP_ORIGINS: undefined, NODE_ENV: "production" }, () => {
    assert.equal(isSameOriginRequest(peticion("https://app.example.com/api/x", { origin: "http://127.0.0.1:3015" })), false);
    assert.equal(isSameOriginRequest(peticion("https://app.example.com/api/x", { origin: "http://localhost:3000" })), false);
  });
});
prueba("buscar-foto, escena-desde-foto y similitud usan esa misma función (sin comprobaciones de origen propias)", () => {
  for (const ruta of ["src/app/api/taller/buscar-foto/route.ts", "src/app/api/escena-desde-foto/route.ts", "src/app/api/escena-ia/similitud/route.ts"]) {
    const fuente = readFileSync(path.resolve(ruta), "utf8");
    assert.match(fuente, /mismoOrigen: isSameOriginRequest/, ruta);
    assert.doesNotMatch(fuente, /headers\.get\(["']host["']\)|origenCoincideConHost/, ruta);
  }
});

console.log(`\n${pruebas} pruebas pasaron.`);
