/**
 * W5 (revisión hostil A1): /api/escena-ia elige proveedor solo con variables de entorno (`destinoGenerativo`) y NO carga
 * el registro (`resolverProveedor` lee el ajuste global en SQLite) ni `src/lib/db.ts`: en main esta ruta nunca abría
 * SQLite, y un fallo al abrirla en un arranque en frío de Vercel o con la base bloqueada en el VPS tumbaría cada pedido.
 * Corre en su propio proceso (el grafo de módulos cargados es lo que se mide). Sin red ni coste:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-escena-ia-sin-sqlite.ts
 */
import assert from "node:assert/strict";

const SQLITE_O_REGISTRO = /[\\/]src[\\/]lib[\\/](db|ia[\\/]nucleo[\\/]registro)\.ts$/;

async function main() {
  for (const variable of ["IA_PROVEEDOR", "ANTHROPIC_API_KEY", "VERCEL"]) Reflect.deleteProperty(process.env, variable);
  process.env.GEMINI_API_KEY = "clave-de-prueba-sin-red";
  const { POST } = await import("@/app/api/escena-ia/route");
  const { modeloEscenaIADe } = await import("@/lib/globos3d/modelo-escena/crear-modelo");
  const { destinoGenerativo } = await import("@/lib/ia/nucleo/cliente-generativo");
  // La resolución que hace la ruta antes de llamar al modelo: Gemini, sin tocar la base.
  assert.equal(modeloEscenaIADe(destinoGenerativo().proveedor)?.proveedor, "gemini");
  // Un pedido que llega hasta la validación pasa por el mismo módulo de la ruta.
  assert.equal((await POST(new Request("http://localhost/api/escena-ia", { method: "POST", body: "{}" }))).status, 400);
  const cargados = Object.keys(require.cache).filter((archivo) => SQLITE_O_REGISTRO.test(archivo));
  assert.deepEqual(cargados, [], `la ruta cargó ${cargados.join(", ")}`);
  console.log("  ✓ /api/escena-ia no carga src/lib/db.ts ni el registro para elegir el modelo");
  console.log("\ntest-escena-ia-sin-sqlite: 1 prueba ok");
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
