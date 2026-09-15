import assert from "node:assert/strict";
import { CATALOGO_ERRORES_UI_V1, construirUiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";
import { esCancelacion, FalloPlanEditar, mensajeFalloPlanEditar, pedirPlanEditar } from "@/lib/plan/peticion-plan-editar";

/**
 * Errores de /api/plan-editar en el navegador (iteración 3b, punto D): el
 * diálogo "Cambiar" mostraba "Failed to fetch" crudo junto a "No encontré otra
 * variante compatible". Sin red ni servidor: `fetch` se sustituye por dobles.
 */

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`[PASS] ${nombre}`);
}

const RESPALDO = "No pudimos cargar opciones parecidas.";

async function fallo(promesa: Promise<unknown>): Promise<unknown> {
  try {
    await promesa;
  } catch (error) {
    return error;
  }
  assert.fail("se esperaba un fallo");
}

function respuestaJson(status: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
}

async function main(): Promise<void> {
  // 1. Fallo de red: el mensaje del navegador no llega al cliente.
  {
    const error = await fallo(pedirPlanEditar({ modo: "recomendadas" }, RESPALDO, { fetcher: async () => { throw new TypeError("Failed to fetch"); } }));
    assert.ok(error instanceof FalloPlanEditar);
    const mensaje = mensajeFalloPlanEditar(error, RESPALDO);
    assert.equal(mensaje, CATALOGO_ERRORES_UI_V1.SIN_CONEXION.mensaje_usuario);
    assert.doesNotMatch(mensaje, /Failed to fetch|fetch/i);
    ok("fallo de red → mensaje SIN_CONEXION en español");
  }

  // 2. Servidor 500 sin ui_error: respaldo local, nunca el `error` técnico.
  {
    const error = await fallo(pedirPlanEditar({}, RESPALDO, { fetcher: async () => respuestaJson(500, { error: "TypeError: cannot read properties of undefined" }) }));
    assert.equal(mensajeFalloPlanEditar(error, RESPALDO), RESPALDO);
    ok("500 sin ui_error → texto de respaldo");
  }

  // 3. Servidor con ui_error válido: su mensaje de cliente.
  {
    const ui = construirUiErrorV1("PRODUCTO_NO_DISPONIBLE", { mensaje: "variant 123 not in allowlist" });
    const error = await fallo(pedirPlanEditar({}, RESPALDO, { fetcher: async () => respuestaJson(409, { error: "variant 123 not in allowlist", ui_error: ui }) }));
    assert.equal(mensajeFalloPlanEditar(error, RESPALDO), ui.mensaje_usuario);
    ok("respuesta con ui_error → mensaje_usuario");
  }

  // 4. Cuerpo no JSON (proxy 502 con HTML): respaldo.
  {
    const error = await fallo(pedirPlanEditar({}, RESPALDO, { fetcher: async () => new Response("<html>Bad gateway</html>", { status: 502 }) }));
    assert.equal(mensajeFalloPlanEditar(error, RESPALDO), RESPALDO);
    ok("cuerpo no JSON → texto de respaldo");
  }

  // 5. Cancelación: se relanza para que el llamador la ignore.
  {
    const controlador = new AbortController();
    controlador.abort();
    const error = await fallo(pedirPlanEditar({}, RESPALDO, { signal: controlador.signal, fetcher: async () => { throw new DOMException("The operation was aborted.", "AbortError"); } }));
    assert.equal(esCancelacion(error), true);
    ok("cancelación → AbortError sin traducir");
  }

  // 6. Éxito: devuelve el cuerpo y envía POST JSON a /api/plan-editar.
  {
    let visto: { url: string; init?: RequestInit } | null = null;
    const datos = await pedirPlanEditar({ modo: "buscar", consulta: "rojo" }, RESPALDO, {
      fetcher: async (url, init) => {
        visto = { url: String(url), init };
        return respuestaJson(200, { candidatos: [] });
      },
    });
    assert.deepEqual(datos, { candidatos: [] });
    assert.ok(visto);
    const { url, init } = visto as { url: string; init?: RequestInit };
    assert.equal(url, "/api/plan-editar");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { modo: "buscar", consulta: "rojo" });
    ok("éxito → cuerpo JSON de la respuesta");
  }

  // 7. Un error cualquiera (p. ej. de programación) nunca muestra su texto.
  assert.equal(mensajeFalloPlanEditar(new Error("Cannot read properties of undefined (reading 'plan')"), RESPALDO), RESPALDO);
  ok("error ajeno → texto de respaldo");

  console.log(`\n${casos} casos OK (errores de /api/plan-editar en el navegador)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
