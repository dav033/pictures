/**
 * Offline checks for the chat tool `ajustar_plan_decoracion`
 * (src/lib/ia/registro-herramientas.ts) — §7 "editar una propuesta desde el
 * chat". Same fixtures, same Python transport double and the same cases
 * `scripts/test-plan-editar-python.ts` already covers for the HTTP route
 * (agregar/reemplazar/quitar, allowlist rejection, tampered token,
 * incompatible replacement), but invoked as a tool-handler call instead of an
 * HTTP request — both paths now share `aplicarEdicionPlan`
 * (src/lib/plan/aplicar-edicion.ts), so this is what actually differs: tool
 * exposure, the same-turn search gate and the "one commercial tool" invariant.
 *
 * `globalThis.fetch` is stubbed; there is no network, and no tested path
 * queries PostgreSQL.
 *
 * Run: npx tsx --conditions=react-server scripts/test-ajustar-plan-decoracion.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.PYTHON_BACKEND_URL = "http://python.test";
process.env.INTERNAL_HMAC_SECRET = "local-only-secret-0123456789abcdef";
process.env.DATABASE_URL = "postgresql://demo:demo@127.0.0.1:5432/demo_rag";
process.env.PLAN_APPROVAL_SECRET = "local-ajustar-plan-decoracion-secret-20260916";

const SNAPSHOT = "products_catalog:test";
const REQUEST_ID = "00000000-0000-4000-8000-000000000002";
const PLAN_HASH = "a".repeat(64);

type Json = Record<string, unknown>;
type Llamada = { path: string; body: Json };

function esObjeto(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function leerFixture(nombre: string): Json {
  const parsed: unknown = JSON.parse(readFileSync(join(process.cwd(), "contracts", "domain", "v1", "fixtures", nombre), "utf8"));
  assert.ok(esObjeto(parsed));
  return parsed;
}

function instalarFetch(responder: (llamada: Llamada) => Response): Llamada[] {
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
  const resolved = leerFixture("plan-resuelto-ok.json");
  const quote = leerFixture("quote-ok.json");
  assert.ok(esObjeto(resolved.totales));
  return {
    operation_schema_version: "plan-resolution-result.v1",
    catalog_snapshot_id: SNAPSHOT,
    plan_resuelto: { ...resolved, plan_hash: PLAN_HASH, totales: { ...resolved.totales, merma_porcentaje: 8 } },
    material_estimate: leerFixture("material-estimate-ok.json"),
    quote: { ...quote, waste_percentage: 8, plan_hash: PLAN_HASH },
  };
}

function seleccionAdmitida(cambios: Json): Json {
  const seleccionFixture = leerFixture("catalog-selection-result.json");
  const validado = { ...(seleccionFixture.validados as Json[])[0]!, ...cambios, quantity: 1, unit_price_cop: 12000, subtotal_cop: 12000 };
  return { ...seleccionFixture, status: "ok", catalog_snapshot_id: SNAPSHOT, rechazados: [], validados: [validado], total_cop: 12000 };
}

async function main(): Promise<void> {
  const { crearTokenPlan } = await import("../src/lib/plan/aprobacion");
  const { BasePlanSchema } = await import("../src/lib/plan/edicion-esquemas");
  const { crearEstadoConversacion, crearRegistroHerramientas, herramientasActivas } = await import("../src/lib/ia/registro-herramientas");
  const { AllowlistProductoVarianteError } = await import("../src/lib/plan/allowlist-producto-variante");
  const { getRagPool } = await import("../src/lib/rag/db");
  // Every tested path must stay off PostgreSQL: any query fails the test loudly.
  Object.defineProperty(getRagPool(), "query", {
    value: () => { throw new Error("la prueba no debe consultar la base"); },
  });

  const allowlistFirmada = [{ product_id: "prod-rojo", variant_ids: ["var-rojo-12"] }];
  const fixture = leerFixture("plan-resuelto-ok.json");
  const tokenPython = crearTokenPlan({ planHash: PLAN_HASH, requestId: REQUEST_ID, backend: "python", catalogSnapshotId: SNAPSHOT, allowlist: allowlistFirmada });
  const base = BasePlanSchema.parse({ ...fixture, plan_hash: PLAN_HASH, request_id: REQUEST_ID, approval_token: tokenPython });
  const llamada = { nombre: "ajustar_plan_decoracion", args: {} };

  /** A fresh turn state with `planVigente` verified and, unless said
   * otherwise, the azul variant already "seen" by buscar_catalogo_rag this
   * turn — the same-turn allowlist gate this tool adds on top of
   * `aplicarEdicionPlan`'s own Python-side admission. */
  function turno(opciones: { approvalToken?: string; ragVistos?: Array<{ productId: string; variantId: string }> } = {}) {
    const estado = crearEstadoConversacion({}, "cambia el color del arco", undefined, {
      planVigente: BasePlanSchema.parse({ ...base, approval_token: opciones.approvalToken ?? tokenPython }),
    });
    for (const { productId, variantId } of opciones.ragVistos ?? [{ productId: "prod-azul", variantId: "var-azul-12" }]) {
      const vistos = estado.ragVariantIdsRecuperados.get(productId) ?? new Set<string>();
      vistos.add(variantId);
      estado.ragVariantIdsRecuperados.set(productId, vistos);
    }
    const registro = crearRegistroHerramientas(estado, {});
    return { estado, registro };
  }

  // --- 0. Tool exposure: hidden without a vigente proposal, exposed with one.
  assert.ok(!herramientasActivas({ ragEnabled: true }).some((h) => h.nombre === "ajustar_plan_decoracion"), "sin planVigente no se expone");
  assert.ok(herramientasActivas({ ragEnabled: true, planVigente: true }).some((h) => h.nombre === "ajustar_plan_decoracion"), "con planVigente sí se expone");
  console.log("[PASS] ajustar_plan_decoracion solo aparece en herramientasActivas cuando planVigente existe");

  // --- 1. reemplazar: happy path, mirrors D8 W2.5 (color canonizado, no el de la pieza vieja).
  {
    const llamadas = instalarFetch((l) => l.path === "/internal/v1/plan/resolve" ? sobre(l, payloadResolucion()) : sobre(l, seleccionAdmitida({ product_id: "prod-azul", variant_id: "var-azul-12", product_title: "Globo Latex Redondo Fashion Azul", colors: ["azul"] })));
    const { estado, registro } = turno();
    const r = await registro.ajustar_plan_decoracion!({ accion: "reemplazar", estructura_id: "EST_01_ARCO", objetivo_variant_id: "var-rojo-12", variante: { product_id: "prod-azul", variant_id: "var-azul-12", color: "rosado" } }, llamada);
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 400));
    assert.equal(r.status, "PLAN_AJUSTADO");
    assert.equal(r.estructura_ajustada, "EST_01_ARCO");
    assert.equal(r.accion, "reemplazar");
    assert.ok(estado.planResuelto, "el plan resuelto del estado queda actualizado (lo que ve la tarjeta)");
    assert.ok(estado.cotizacion, "la cotización del estado queda actualizada");
    assert.equal(llamadas.length, 3, "resuelve base + admite variante + resuelve editado");
    console.log("[PASS] reemplazar: ok:true, estado.planResuelto/cotizacion actualizados, color canonizado por el catálogo");
  }

  // --- 2. agregar.
  {
    instalarFetch((l) => l.path === "/internal/v1/plan/resolve" ? sobre(l, payloadResolucion()) : sobre(l, seleccionAdmitida({ product_id: "prod-azul", variant_id: "var-azul-12", product_title: "Globo Latex Redondo Fashion Azul", colors: ["azul"] })));
    const { registro } = turno();
    const r = await registro.ajustar_plan_decoracion!({ accion: "agregar", estructura_id: "EST_01_ARCO", participacion: 0.2, variante: { product_id: "prod-azul", variant_id: "var-azul-12" } }, llamada);
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 400));
    assert.equal(r.accion, "agregar");
    console.log("[PASS] agregar: ok:true");
  }

  // --- 3. quitar (no new variant, no same-turn search gate to satisfy).
  {
    instalarFetch((l) => sobre(l, payloadResolucion()));
    const { registro } = turno({ ragVistos: [] });
    const r = await registro.ajustar_plan_decoracion!({ accion: "quitar", estructura_id: "EST_01_ARCO", objetivo_variant_id: "var-rojo-12" }, llamada);
    // The fixture's only material is the one being removed: the domain rule
    // (MENSAJE_UNICO_MATERIAL) rejects it, same as the HTTP route's D7 case —
    // proof `aplicarEdicionPlan` is the exact same code path, not a new one.
    assert.equal(r.ok, false);
    assert.equal(r.status, "AJUSTE_RECHAZADO");
    assert.equal(r.causa, "UNICO_MATERIAL");
    console.log("[PASS] quitar el único material → AJUSTE_RECHAZADO/UNICO_MATERIAL (misma regla que la ruta HTTP)");
  }

  // --- 4. Same-turn search gate: a variant the model never searched this turn is rejected before touching Python.
  {
    const llamadas = instalarFetch(() => { throw new Error("una variante fuera de la búsqueda de este turno no debe llegar a Python"); });
    const { registro } = turno({ ragVistos: [] });
    const r = await registro.ajustar_plan_decoracion!({ accion: "reemplazar", estructura_id: "EST_01_ARCO", objetivo_variant_id: "var-rojo-12", variante: { product_id: "prod-azul", variant_id: "var-azul-12" } }, llamada);
    assert.equal(r.ok, false);
    assert.equal(r.status, "VARIANTE_FUERA_DE_BUSQUEDA");
    assert.equal(llamadas.length, 0, "no llama a Python");
    console.log("[PASS] variante que el modelo no buscó en este turno → VARIANTE_FUERA_DE_BUSQUEDA, cero llamadas a Python");
  }

  // --- 5. Product/variant mismatch → Python rejects it (same mapping as confirmar_plan_decoracion).
  {
    instalarFetch((l) => l.path === "/internal/v1/plan/resolve" ? sobre(l, payloadResolucion()) : Response.json({ detail: { code: "allowlist_product_mismatch" } }, { status: 422 }));
    const { registro } = turno({ ragVistos: [{ productId: "prod-otro", variantId: "var-rojo-12" }] });
    const r = await registro.ajustar_plan_decoracion!({ accion: "reemplazar", estructura_id: "EST_01_ARCO", objetivo_variant_id: "var-rojo-12", variante: { product_id: "prod-otro", variant_id: "var-rojo-12" } }, llamada);
    assert.equal(r.ok, false);
    assert.equal(r.status, "PRODUCTO_VARIANTE_INCONSISTENTE");
    console.log("[PASS] product_id/variant_id inconsistentes según Python → PRODUCTO_VARIANTE_INCONSISTENTE");
  }

  // --- 6. Tampered token (widened allowlist) → rejected before any Python call, same as the HTTP route.
  {
    const [payloadB64, firma] = tokenPython.split(".");
    const decodificado: unknown = JSON.parse(Buffer.from(payloadB64!, "base64url").toString("utf8"));
    assert.ok(esObjeto(decodificado) && Array.isArray(decodificado.allowlist));
    const tokenManipulado = `${Buffer.from(JSON.stringify({ ...decodificado, allowlist: [...decodificado.allowlist, { product_id: "prod-rojo", variant_ids: ["var-extra"] }] })).toString("base64url")}.${firma}`;
    const llamadas = instalarFetch(() => { throw new Error("un token manipulado no debe llegar a Python"); });
    const { estado, registro } = turno({ approvalToken: tokenManipulado, ragVistos: [{ productId: "prod-rojo", variantId: "var-extra" }] });
    // A tampered signature fails `planVigenteDelTurno` itself: the tool never
    // even gets exposed to the model for this turn.
    assert.equal(estado.planVigente, undefined, "un token manipulado no cuenta como propuesta vigente");
    const r = await registro.ajustar_plan_decoracion!({ accion: "reemplazar", estructura_id: "EST_01_ARCO", objetivo_variant_id: "var-rojo-12", variante: { product_id: "prod-rojo", variant_id: "var-extra" } }, llamada);
    assert.equal(r.ok, false);
    assert.equal(r.status, "SIN_PROPUESTA_VIGENTE", "el handler repite la comprobación aunque la herramienta no debería haberse expuesto");
    assert.equal(llamadas.length, 0);
    console.log("[PASS] token manipulado: planVigenteDelTurno lo rechaza y el handler nunca autoriza nada por su cuenta");
  }

  // --- 7. Incompatible replacement (balloon → streamer), same rule edicion-compatibilidad.ts enforces for the HTTP editor.
  {
    const candidatoPython = () => ({
      variant_id: "var-serpentina", product_id: "prod-serpentina", diam_pulg: null, diam_cm: null, forma: null, tamano_codigo: null,
    });
    const resolucionConSerpentina = (): Json => {
      const payload = payloadResolucion();
      const planResuelto = payload.plan_resuelto as Json;
      const estructuras = planResuelto.estructuras as Array<Json & { lineas: Json[] }>;
      return { ...payload, plan_resuelto: { ...planResuelto, estructuras: estructuras.map((e) => ({ ...e, lineas: e.lineas.map((linea) => ({ ...linea, ...candidatoPython() })) })) } };
    };
    let resoluciones = 0;
    instalarFetch((l) => {
      if (l.path === "/internal/v1/plan/resolve") {
        resoluciones += 1;
        return sobre(l, resoluciones === 1 ? payloadResolucion() : resolucionConSerpentina());
      }
      return sobre(l, seleccionAdmitida({ product_id: "prod-serpentina", variant_id: "var-serpentina", size_code: null, shape: null, diameter_inches: null }));
    });
    const { registro } = turno({ ragVistos: [{ productId: "prod-serpentina", variantId: "var-serpentina" }] });
    const r = await registro.ajustar_plan_decoracion!({ accion: "reemplazar", estructura_id: "EST_01_ARCO", objetivo_variant_id: "var-rojo-12", variante: { product_id: "prod-serpentina", variant_id: "var-serpentina" } }, llamada);
    assert.equal(r.ok, false, JSON.stringify(r).slice(0, 400));
    assert.equal(r.status, "AJUSTE_RECHAZADO");
    assert.equal(r.causa, "REEMPLAZO_INCOMPATIBLE");
    console.log("[PASS] reemplazar un globo por una serpentina → AJUSTE_RECHAZADO/REEMPLAZO_INCOMPATIBLE");
  }

  // --- 8. Malformed edit args (schema) → AJUSTE_ESQUEMA_INVALIDO before any network call.
  {
    const llamadas = instalarFetch(() => { throw new Error("un esquema inválido no debe llegar a Python"); });
    const { registro } = turno();
    const r = await registro.ajustar_plan_decoracion!({ accion: "reemplazar", estructura_id: "EST_01_ARCO" }, llamada); // missing objetivo_variant_id/variante
    assert.equal(r.ok, false);
    assert.equal(r.status, "AJUSTE_ESQUEMA_INVALIDO");
    assert.equal(llamadas.length, 0);
    console.log("[PASS] argumentos que no cumplen EdicionSchema → AJUSTE_ESQUEMA_INVALIDO, cero llamadas");
  }

  // --- 9. Invariant: at most one commercial tool per turn.
  {
    instalarFetch((l) => l.path === "/internal/v1/plan/resolve" ? sobre(l, payloadResolucion()) : sobre(l, seleccionAdmitida({ product_id: "prod-azul", variant_id: "var-azul-12" })));
    const { estado, registro } = turno();
    const primero = await registro.ajustar_plan_decoracion!({ accion: "reemplazar", estructura_id: "EST_01_ARCO", objetivo_variant_id: "var-rojo-12", variante: { product_id: "prod-azul", variant_id: "var-azul-12" } }, llamada);
    assert.equal(primero.ok, true, JSON.stringify(primero).slice(0, 300));
    assert.equal(estado.herramientaComercialUsada, "ajustar_plan_decoracion");

    const llamadasSegunda = instalarFetch(() => { throw new Error("la segunda herramienta comercial del turno no debe llegar a Python"); });
    const segundo = await registro.confirmar_plan_decoracion!({}, llamada);
    assert.equal(segundo.ok, false);
    assert.equal(segundo.status, "HERRAMIENTA_COMERCIAL_YA_USADA");
    assert.equal(llamadasSegunda.length, 0);
    console.log("[PASS] invariante: ajustar_plan_decoracion seguido de confirmar_plan_decoracion en el mismo turno → la segunda se rechaza sin ejecutar nada");
  }

  // --- 10. Invariant does not block retrying ajustar_plan_decoracion after a failed attempt of itself.
  {
    const { estado, registro } = turno({ ragVistos: [{ productId: "prod-serpentina", variantId: "var-serpentina" }] });
    instalarFetch(() => { throw new Error("esquema inválido: no debe llamar a nada"); });
    const fallo = await registro.ajustar_plan_decoracion!({ accion: "reemplazar", estructura_id: "EST_01_ARCO" }, llamada);
    assert.equal(fallo.ok, false);
    assert.equal(estado.herramientaComercialUsada, "ajustar_plan_decoracion", "el intento fallido ya cuenta como esta herramienta, no bloquea reintentarla");
    instalarFetch((l) => l.path === "/internal/v1/plan/resolve" ? sobre(l, payloadResolucion()) : sobre(l, seleccionAdmitida({ product_id: "prod-serpentina", variant_id: "var-serpentina" })));
    const reintento = await registro.ajustar_plan_decoracion!({ accion: "agregar", estructura_id: "EST_01_ARCO", participacion: 0.2, variante: { product_id: "prod-serpentina", variant_id: "var-serpentina" } }, llamada);
    assert.equal(reintento.ok, true, JSON.stringify(reintento).slice(0, 300));
    console.log("[PASS] invariante: reintentar la MISMA herramienta comercial tras un rechazo sigue permitido");
  }

  // AllowlistProductoVarianteError message reused for the mismatch case above:
  // sanity that this script imports the same class the handler catches.
  assert.ok(new AllowlistProductoVarianteError().message.length > 0);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error("[FAIL]", error);
    process.exit(1);
  },
);
