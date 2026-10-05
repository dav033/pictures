/**
 * `/api/plan-editar` con las dos ediciones de los editores nuevos (2026-10-04): `armado_arco_organico` (el arco
 * orgánico, el asimétrico y todo semiarco) y `propiedades` (forma, densidad y medidas de la pared, el aro, el techo
 * y el centro de mesa en UNA edición). Mismo arnés que `test-plan-editar-python.ts`: `fetch` simulado, sin red ni
 * base de datos; la semántica de las ediciones es de Python y se prueba en
 * `services/ai-api/tests/test_plan_edicion_armado_arco_organico.py` y `test_plan_edicion_propiedades.py`. Aquí
 * solo la orquestación de Next: la ruta admite las acciones, las manda a Python tal cual, firma el plan nuevo,
 * audita la operación y traduce cada rechazo nuevo a su frase.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-plan-editar-piezas-ruta.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.PYTHON_BACKEND_URL = "http://python.test";
process.env.INTERNAL_HMAC_SECRET = "local-only-secret-0123456789abcdef";
process.env.DATABASE_URL = "postgresql://demo:demo@127.0.0.1:5432/demo_rag";
process.env.PLAN_APPROVAL_SECRET = "local-plan-editar-piezas-secret-20261004";

const SNAPSHOT = "products_catalog:test";
const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const PLAN_HASH = "a".repeat(64);
const RUTA_EDICION = "/internal/v1/plan/edit";
const RUTA_RESOLUCION = "/internal/v1/plan/resolve";

type Json = Record<string, unknown>;
type Llamada = { path: string; body: Json };

const esObjeto = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function leer(ruta: string): Json {
  const parsed: unknown = JSON.parse(readFileSync(join(process.cwd(), ruta), "utf8"));
  assert.ok(esObjeto(parsed));
  return parsed;
}
const fixture = (nombre: string) => leer(join("contracts", "domain", "v1", "fixtures", nombre));

let olvidarResoluciones: () => void = () => {};

function instalarFetch(responder: (llamada: Llamada) => Response): Llamada[] {
  olvidarResoluciones();
  const llamadas: Llamada[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body: unknown = JSON.parse(String(init?.body));
    assert.ok(esObjeto(body));
    const llamada = { path: new URL(String(input)).pathname, body };
    llamadas.push(llamada);
    return responder(llamada);
  }) as typeof fetch;
  return llamadas;
}

function sobre(llamada: Llamada, payload: Json): Response {
  const ctx = llamada.body.context;
  assert.ok(esObjeto(ctx));
  return Response.json({ schema_version: "operational.v1", request_id: ctx.request_id, correlation_id: ctx.correlation_id, payload });
}

function payloadResolucion(): Json {
  const resolved = fixture("plan-resuelto-ok.json");
  const quote = fixture("quote-ok.json");
  assert.ok(esObjeto(resolved.totales));
  return {
    operation_schema_version: "plan-resolution-result.v1",
    catalog_snapshot_id: SNAPSHOT,
    plan_resuelto: { ...resolved, plan_hash: PLAN_HASH, totales: { ...resolved.totales, merma_porcentaje: 8 } },
    material_estimate: fixture("material-estimate-ok.json"),
    quote: { ...quote, waste_percentage: 8, plan_hash: PLAN_HASH },
  };
}

function sobreEdicion(llamada: Llamada): Response {
  const plan = llamada.body.plan;
  assert.ok(esObjeto(plan));
  return sobre(llamada, { operation_schema_version: "plan-edit-result.v1", plan: structuredClone(plan), avisos: [] });
}

function rechazoPython(code: string, status: number): Response {
  return Response.json({ detail: { code, request_id: "00000000-0000-4000-8000-00000000e000", correlation_id: "00000000-0000-4000-8000-00000000e001" } }, { status });
}

async function main(): Promise<void> {
  const { crearTokenPlan, verificarTokenAprobacion } = await import("../../src/lib/plan/aprobacion");
  const { POST } = await import("../../src/app/api/plan-editar/route");
  const { getRagPool } = await import("../../src/lib/rag/db");
  const { esperarObservabilidadPendiente } = await import("../../src/lib/rag/observability/log");
  olvidarResoluciones = (await import("../../src/lib/plan/cache-resoluciones")).olvidarResoluciones;
  const auditorias: unknown[][] = [];
  Object.defineProperty(getRagPool(), "query", {
    value: (sql: unknown, parametros: unknown) => {
      if (typeof sql === "string" && sql.trim().startsWith("INSERT INTO plan_audit_log") && Array.isArray(parametros)) {
        auditorias.push(parametros);
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      throw new Error("la prueba no debe consultar la base");
    },
  });

  const token = crearTokenPlan({ planHash: PLAN_HASH, requestId: REQUEST_ID, backend: "python", catalogSnapshotId: SNAPSHOT, allowlist: [{ product_id: "prod-rojo", variant_ids: ["var-rojo-12"] }] });
  const base: Json = { ...fixture("plan-resuelto-ok.json"), plan_hash: PLAN_HASH, request_id: REQUEST_ID, approval_token: token };
  const editar = async (edicion: Json) => {
    const respuesta = await POST(new Request("http://127.0.0.1/api/plan-editar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modo: "aplicar", base, edicion }) }));
    const cuerpo: unknown = await respuesta.json();
    assert.ok(esObjeto(cuerpo));
    return { status: respuesta.status, cuerpo };
  };
  const edicionEnviada = (llamadas: Llamada[]): Json => {
    const ediciones = llamadas.filter((llamada) => llamada.path === RUTA_EDICION);
    assert.equal(ediciones.length, 1, "una sola edición en Python");
    return ediciones[0]!.body.edicion as Json;
  };
  const responder = (llamada: Llamada) => (llamada.path === RUTA_EDICION ? sobreEdicion(llamada) : sobre(llamada, payloadResolucion()));
  let casos = 0;

  // --- propiedades: una edición, tal cual a Python, firmada y auditada.
  {
    const edicion = { accion: "propiedades", estructura_id: "EST_01_ARCO", forma: null, densidad: "lujosa", medidas: { ancho_m: 3.2 } };
    auditorias.length = 0;
    const llamadas = instalarFetch(responder);
    const r = await editar(edicion);
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
    assert.deepEqual(llamadas.map((llamada) => llamada.path), [RUTA_RESOLUCION, RUTA_EDICION, RUTA_RESOLUCION], "sin variante nueva no se admite nada");
    assert.deepEqual(edicionEnviada(llamadas), edicion, "la edición viaja sin tocar: forma, densidad y medidas juntas");
    const plan = r.cuerpo.plan as Json;
    assert.ok(verificarTokenAprobacion(String(plan.approval_token), String(plan.plan_hash)), "firmada para su plan_hash");
    await esperarObservabilidadPendiente();
    assert.deepEqual(JSON.parse(String(auditorias.at(-1)![8])), { accion: "propiedades", estructura_id: "EST_01_ARCO", forma: null, densidad: "lujosa", medidas: { ancho_m: 3.2 } });
    casos += 1;
    console.log("[PASS] propiedades: forma, densidad y medidas en una sola edición, tal cual a Python, firmada y auditada");
  }

  // --- propiedades vacía o mal formada: 400 sin llegar a Python.
  {
    const llamadas = instalarFetch(() => { throw new Error("una edición vacía no debe llegar a Python"); });
    for (const edicion of [
      { accion: "propiedades", estructura_id: "EST_01_ARCO" },
      { accion: "propiedades", estructura_id: "EST_01_ARCO", medidas: {} },
      { accion: "propiedades", estructura_id: "EST_01_ARCO", densidad: "extrema" },
      { accion: "propiedades", estructura_id: "EST_01_ARCO", medidas: { ancho_m: -1 } },
      { accion: "propiedades", estructura_id: "EST_01_ARCO", densidad: "media", mezcla: "clasica" },
    ]) {
      const r = await editar(edicion);
      assert.equal(r.status, 400, JSON.stringify(edicion));
    }
    assert.equal(llamadas.length, 0);
    casos += 1;
    console.log("[PASS] propiedades vacía o mal formada: 400 sin llamar a Python");
  }

  // --- armado_arco_organico: el armado del editor viaja tal cual; null lo quita.
  {
    const vista = leer("scripts/fixtures/arco-organico-ui/vista-arco-organico.json");
    const armado = (vista.peticion as Json).armado_arco_organico as Json;
    for (const valor of [armado, null]) {
      auditorias.length = 0;
      const llamadas = instalarFetch(responder);
      const edicion = { accion: "armado_arco_organico", estructura_id: "EST_01_ARCO", armado_arco_organico: valor };
      const r = await editar(edicion);
      assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
      assert.deepEqual(edicionEnviada(llamadas), edicion);
      await esperarObservabilidadPendiente();
      const auditada = JSON.parse(String(auditorias.at(-1)![8])) as Json;
      assert.equal(auditada.accion, "armado_arco_organico");
      assert.equal(auditada.corte, valor === null ? null : (armado.forma as Json).corte);
    }
    const llamadas = instalarFetch(() => { throw new Error("un armado mal formado no debe llegar a Python"); });
    const r = await editar({ accion: "armado_arco_organico", estructura_id: "EST_01_ARCO", armado_arco_organico: { ...armado, forma: { ...(armado.forma as Json), corte: 0.1 } } });
    assert.equal(r.status, 400);
    assert.equal(llamadas.length, 0);
    casos += 1;
    console.log("[PASS] armado_arco_organico: el armado del editor viaja tal cual (o null para quitarlo); mal formado, 400");
  }

  // --- Los rechazos nuevos de Python, con su status y su frase.
  {
    const rechazos: Array<[string, number, RegExp]> = [
      ["armado_arco_organico_activo", 409, /armada con el motor: .*«Editar arco» \(o «Editar semiarco»\)/],
      ["armado_arco_presente", 409, /ya tiene el armado de patrones/],
      ["armado_columna_presente", 409, /ya tiene el armado de anillos/],
      ["densidad_invalida", 422, /Esa densidad no es de esta pieza/],
    ];
    for (const [codigo, status, frase] of rechazos) {
      instalarFetch((llamada) => (llamada.path === RUTA_EDICION ? rechazoPython(codigo, status) : sobre(llamada, payloadResolucion())));
      const r = await editar({ accion: "propiedades", estructura_id: "EST_01_ARCO", densidad: "sencilla" });
      assert.equal(r.status, status, codigo);
      assert.match(String(r.cuerpo.error), frase, codigo);
    }
    casos += 1;
    console.log("[PASS] rechazos nuevos → su status y su frase para el decorador");
  }

  console.log(`\n${casos} casos en verde`);
}

main().then(() => process.exit(0), (error: unknown) => {
  console.error(error);
  process.exit(1);
});
