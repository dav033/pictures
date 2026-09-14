/**
 * Live harness for the product→variant allowlist (design E3) and the editor
 * paths owned by Python (design E2), against the local FastAPI service and the
 * local PostgreSQL catalog. Not part of `plan:test`: it needs running services.
 *
 * Fail-closed: a run that is required (PYTHON_BACKEND_ENABLED=true, or
 * --require-python / PYTHON_SMOKE_REQUIRED) and cannot reach FastAPI fails.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { decidirSmoke, exigirReadyz, problemaPostgresLocal } from "./lib/python-smoke-preflight";

type Json = Record<string, unknown>;

const VARIANTE_INEXISTENTE = "99999999999999";

function esObjeto(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main(): Promise<void> {
  // Both databases must be loopback: the routes write audit rows through the
  // application pool, and Python reads the catalog.
  const decision = decidirSmoke((env) => problemaPostgresLocal("DATABASE_URL", env) ?? problemaPostgresLocal("CATALOG_DATABASE_URL", env));
  if (decision.accion === "saltar") {
    console.log(`[SKIP] ${decision.motivo}`);
    return;
  }
  if (decision.accion === "fallar") throw new Error(decision.motivo);
  await exigirReadyz(decision.backendUrl);
  // The approval secret only has to be stable inside this process; set it before
  // the route modules are imported.
  if (!process.env.PLAN_APPROVAL_SECRET?.trim()) process.env.PLAN_APPROVAL_SECRET = `local-allowlist-harness-${randomUUID()}`;

  const [
    { llamarPythonCatalogSearch, llamarPythonCatalogRecommendations, isPythonAdapterError },
    { allowlistDesdeMapa, abrirContextoPlan, crearTokenPlan, verificarTokenAprobacion },
    { resolverPlanConBackend },
    { AllowlistProductoVarianteError },
    { PlanDecoracionSchema },
    { POST: editar },
    { candidatoDesdePython },
    { ordenarRecomendacionesPorColor },
    { getRagPool },
  ] = await Promise.all([
    import("../src/lib/ia/python-adapter"),
    import("../src/lib/plan/aprobacion"),
    import("../src/lib/plan/resolver-backend"),
    import("../src/lib/plan/allowlist-producto-variante"),
    import("../src/lib/plan/tipos"),
    import("../src/app/api/plan-editar/route"),
    import("../src/lib/rag/chat/candidato-python"),
    import("../src/lib/plan/recomendaciones-orden"),
    import("../src/lib/rag/db"),
  ]);

  try {
    // --- 1. Real search: snapshot S and two distinct products with a round R-12 variant.
    const busqueda = await llamarPythonCatalogSearch({
      message: "globo redondo latex",
      filters: { available: true, shapes: ["redondo"], diameters_inches: [12] },
      allowlist: [],
      limit: 15,
      requestId: randomUUID(),
      correlationId: randomUUID(),
      deadlineMs: 10_000,
    });
    const S = busqueda.catalog_snapshot_id;
    assert.ok(S, "la búsqueda real debe devolver catalog_snapshot_id");
    const elegibles = busqueda.candidates.flatMap((candidato) => {
      const variantes = candidato.variants.filter((v) => v.available && v.shape === "redondo" && v.diameter_inches === 12);
      return variantes.length ? [{ productId: candidato.product_id, variantes }] : [];
    });
    assert.ok(elegibles.length >= 2, `se necesitan dos productos con R-12 redondo; hubo ${elegibles.length}`);
    const A = elegibles[0]!.productId;
    const vA = elegibles[0]!.variantes[0]!.variant_id;
    const tamanoA = elegibles[0]!.variantes[0]!.size_code;
    const B = elegibles[1]!.productId;
    const vB = elegibles[1]!.variantes[0]!.variant_id;
    const otraDeA = busqueda.candidates.find((c) => c.product_id === A)!.variants.find((v) => v.variant_id !== vA)?.variant_id ?? VARIANTE_INEXISTENTE;
    assert.notEqual(A, B);
    console.log(`[INFO] snapshot=${S}; A=${A}/${vA}; B=${B}/${vB}`);

    // --- 2. Signed allowlist with the real association and a two-structure plan.
    const allowlist = allowlistDesdeMapa(new Map([[A, new Set([vA])], [B, new Set([vB])]]));
    const estructura = (id: string, ubicacion: string, rol: string, material: Json, extra: Json = {}) => ({
      estructura_id: id,
      nombre: `Arco ${id}`,
      tipo: "arco",
      rol_escena: rol,
      ubicacion,
      medidas: { ancho_m: 3, alto_m: 2.4 },
      repeticiones: 1,
      densidad: "media",
      mezcla: "clasica",
      materiales: [{ participacion: 1, rol_material: "principal", ...material }],
      porque: "Arnés local de allowlist producto→variante.",
      ...extra,
    });
    const construirPlan = (materialA: Json = { product_id: A }, extraA: Json = {}) => PlanDecoracionSchema.parse({
      plan_version: "1.0",
      plan_id: "00000000-0000-4000-8000-0000000000aa",
      concepto: { titulo: "Arnés allowlist Python", descripcion: "Dos productos reales con variantes propias.", paleta: [] },
      espacio: { tipo: "salon", fuente: "supuesto" },
      estructuras: [
        estructura("EST_01_ARCO", "arco_central", "focal", materialA, extraA),
        estructura("EST_02_ARCO", "lateral_izquierdo", "soporte", { product_id: B }),
      ],
      supuestos: [],
    });
    const resolver = (plan: ReturnType<typeof construirPlan>, entradas: typeof allowlist) => resolverPlanConBackend({
      backend: "python",
      plan,
      allowlist: entradas,
      catalogSnapshotId: S,
      requestId: randomUUID(),
      correlationId: randomUUID(),
      deadlineMs: 10_000,
    });

    // --- 3. Positive resolution keeps each variant under its real owner.
    const positivo = await resolver(construirPlan(), allowlist);
    const resuelto = positivo.resuelto;
    assert.ok(resuelto.compras.some((c) => c.variant_id === vA && c.product_id === A), "compras incluye vA bajo A");
    assert.ok(resuelto.compras.some((c) => c.variant_id === vB && c.product_id === B), "compras incluye vB bajo B");
    assert.deepEqual(resuelto.sin_cobertura, []);
    console.log(`[PASS] resolución positiva con dos productos: vA∈A, vB∈B, sin_cobertura vacía; hash=${resuelto.plan_hash}`);

    // --- 4. Every product/variant mismatch is a stable error, never a silent sin_cobertura.
    const esMismatch = (error: unknown) => error instanceof AllowlistProductoVarianteError && error.causa === "ALLOWLIST_PRODUCTO_VARIANTE";
    await assert.rejects(resolver(construirPlan(), [{ product_id: A, variant_ids: [vB] }, { product_id: B, variant_ids: [vA] }].sort((x, y) => x.product_id.localeCompare(y.product_id))), esMismatch, "(a) allowlist cruzada");
    await assert.rejects(resolver(construirPlan(), [{ product_id: A, variant_ids: [vA, vB].sort() }]), esMismatch, "(b) variante de B bajo A");
    await assert.rejects(resolver(construirPlan({ product_id: A, variant_id: vB }), allowlist), esMismatch, "(c) material A con variante de B");
    await assert.rejects(
      resolver(construirPlan({ product_id: A }, { variant_overrides: [{ objetivo_variant_id: vA, product_id: A, variant_id: vB }] }), allowlist),
      esMismatch,
      "(d) override A con variante de B",
    );
    const control = await resolver(construirPlan({ product_id: A, variant_id: VARIANTE_INEXISTENTE }), allowlist);
    assert.ok(control.resuelto.compras.length > 0, "control: variante inexistente en el snapshot no es error");
    console.log("[PASS] variante de A usada con B → AllowlistProductoVarianteError en allowlist cruzada, entrada mezclada, material y override; variante desconocida sigue sin error");

    // --- 5. Routes over an approved base.
    const requestId = randomUUID();
    const tokenBase = crearTokenPlan({ planHash: resuelto.plan_hash, requestId, backend: "python", catalogSnapshotId: S, allowlist });
    const base = { ...resuelto, request_id: requestId, approval_token: tokenBase };

    async function llamar(body: Json): Promise<{ status: number; cuerpo: Json }> {
      const respuesta = await editar(new Request("http://127.0.0.1/api/plan-editar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }));
      const cuerpo: unknown = await respuesta.json();
      assert.ok(esObjeto(cuerpo), "la ruta responde un objeto JSON");
      return { status: respuesta.status, cuerpo };
    }
    const reemplazar = (variante: { product_id: string; variant_id: string }, opciones: { token?: string; base?: Json; estructura?: string; objetivo?: string } = {}) => ({
      modo: "aplicar",
      base: { ...base, ...(opciones.base ?? {}), approval_token: opciones.token ?? tokenBase },
      edicion: { accion: "reemplazar", estructura_id: opciones.estructura ?? "EST_01_ARCO", objetivo_variant_id: opciones.objetivo ?? vA, variante },
    });

    // (a) variant of A offered under B (and vice versa) → Python rejects → 422 stable cause.
    for (const variante of [{ product_id: B, variant_id: vA }, { product_id: A, variant_id: vB }]) {
      const r = await llamar(reemplazar(variante));
      assert.equal(r.status, 422, `aplicar ${variante.product_id}/${variante.variant_id}: ${JSON.stringify(r.cuerpo)}`);
      assert.equal(r.cuerpo.causa, "ALLOWLIST_PRODUCTO_VARIANTE");
    }
    console.log("[PASS] ruta aplicar: variante de A con producto B (y viceversa) → 422 causa=ALLOWLIST_PRODUCTO_VARIANTE");

    // (b) variant outside the snapshot → 409 VARIANTE_NO_ADMITIDA.
    let r = await llamar(reemplazar({ product_id: A, variant_id: VARIANTE_INEXISTENTE }));
    assert.equal(r.status, 409, JSON.stringify(r.cuerpo));
    assert.equal(r.cuerpo.causa, "VARIANTE_NO_ADMITIDA");
    console.log("[PASS] ruta aplicar: variante fuera del snapshot → 409 causa=VARIANTE_NO_ADMITIDA");

    // (c) valid cross-product swap: 200 and the signed allowlist is not widened.
    r = await llamar(reemplazar({ product_id: B, variant_id: vB }));
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
    assert.ok(esObjeto(r.cuerpo.plan) && typeof r.cuerpo.plan.approval_token === "string" && typeof r.cuerpo.plan.plan_hash === "string");
    const contextoSwap = abrirContextoPlan(r.cuerpo.plan.approval_token);
    assert.ok(contextoSwap);
    assert.deepEqual(contextoSwap.allowlist, allowlist, "el swap válido no amplía la allowlist firmada");
    assert.equal(contextoSwap.catalogSnapshotId, S);
    assert.ok(verificarTokenAprobacion(r.cuerpo.plan.approval_token, r.cuerpo.plan.plan_hash), "el nuevo token verifica el nuevo hash");
    console.log("[PASS] ruta aplicar: swap válido A→B (vB) responde 200 sin ampliar la allowlist firmada; nuevo hash verificado");

    // (d) tampered token cannot widen the signed allowlist.
    const [payloadB64, firma] = tokenBase.split(".");
    const decodificado: unknown = JSON.parse(Buffer.from(payloadB64!, "base64url").toString("utf8"));
    assert.ok(esObjeto(decodificado) && Array.isArray(decodificado.allowlist));
    const tokenManipulado = `${Buffer.from(JSON.stringify({ ...decodificado, allowlist: [...decodificado.allowlist, { product_id: A, variant_ids: [otraDeA] }] })).toString("base64url")}.${firma}`;
    for (const cuerpo of [
      reemplazar({ product_id: A, variant_id: otraDeA }, { token: tokenManipulado }),
      { modo: "recomendadas", variant_id: vA, approval_token: tokenManipulado },
      { modo: "buscar", consulta: "globo redondo", approval_token: tokenManipulado },
    ]) {
      r = await llamar(cuerpo);
      assert.equal(r.status, 409, `token manipulado en ${String(cuerpo.modo)}: ${JSON.stringify(r.cuerpo)}`);
    }
    console.log("[PASS] token manipulado (allowlist ampliada) → 409 en aplicar, recomendadas y buscar");

    // (e) an allowlist injected in the body is ignored: the signed one travels.
    r = await llamar(reemplazar({ product_id: B, variant_id: vB }, { base: { allowlist: [{ product_id: A, variant_ids: [vB] }] }, estructura: "EST_02_ARCO", objetivo: vB }));
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
    assert.ok(esObjeto(r.cuerpo.plan) && typeof r.cuerpo.plan.approval_token === "string");
    assert.deepEqual(abrirContextoPlan(r.cuerpo.plan.approval_token)?.allowlist, allowlist, "la allowlist inyectada en el cuerpo se ignora");
    console.log("[PASS] allowlist inyectada en base se ignora; el nuevo token conserva la firmada");

    // (f) strict schema: the browser cannot choose the snapshot.
    r = await llamar({ modo: "recomendadas", variant_id: vA, approval_token: tokenBase, catalog_snapshot_id: S });
    assert.equal(r.status, 400);
    console.log("[PASS] recomendadas con catalog_snapshot_id en el cuerpo → 400");

    // (g) recommendations through Python equal the direct adapter set (permutation).
    r = await llamar({ modo: "recomendadas", variant_id: vA, approval_token: tokenBase });
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
    assert.ok(Array.isArray(r.cuerpo.candidatos));
    const ruta = r.cuerpo.candidatos.filter(esObjeto).map((c) => ({
      productId: String(c.productId),
      categoria: c.categoria,
      variantes: (Array.isArray(c.variantes) ? c.variantes : []).filter(esObjeto),
    }));
    const directo = await llamarPythonCatalogRecommendations({
      referenceVariantId: vA,
      catalogSnapshotId: S,
      limit: 100,
      requestId: randomUUID(),
      correlationId: randomUUID(),
      deadlineMs: 10_000,
    });
    assert.equal(directo.catalog_snapshot_id, S, "la llamada directa hace eco del snapshot firmado");
    assert.equal(directo.reference.product_id, A);
    const esperado = ordenarRecomendacionesPorColor(directo.candidates.map(candidatoDesdePython), { productId: A, colores: directo.reference.colors }).slice(0, 12);
    const idsRuta = ruta.flatMap((c) => c.variantes.map((v) => String(v.variantId))).sort();
    const idsEsperados = esperado.flatMap((c) => c.variantes.map((v) => v.variantId)).sort();
    assert.ok(idsRuta.length > 0, "debe haber recomendaciones para vA");
    assert.deepEqual(idsRuta, idsEsperados, "ruta y adaptador directo devuelven el mismo conjunto");
    assert.equal(new Set(idsRuta).size, idsRuta.length);
    const categoriaA = directo.reference.category;
    for (const candidato of ruta) {
      assert.ok(candidato.productId === A || (categoriaA !== null && candidato.categoria === categoriaA), `familia de ${candidato.productId}`);
      for (const v of candidato.variantes) {
        assert.notEqual(v.variantId, vA);
        assert.equal(v.disponible, true);
        assert.equal(v.codigoTamano, directo.reference.size_code ?? tamanoA, `tamaño de ${String(v.variantId)}`);
      }
    }
    console.log(`[PASS] recomendadas Python: ${idsRuta.length} variantes = conjunto directo del adaptador (permutación); mismo tamaño ${String(directo.reference.size_code)} y snapshot ${S}`);

    // (h) reference outside the signed allowlist → 404 without calling Python.
    const tokenSoloB = crearTokenPlan({ planHash: resuelto.plan_hash, requestId, backend: "python", catalogSnapshotId: S, allowlist: [{ product_id: B, variant_ids: [vB] }] });
    r = await llamar({ modo: "recomendadas", variant_id: vA, approval_token: tokenSoloB });
    assert.equal(r.status, 404);
    assert.equal(r.cuerpo.causa, "VARIANTE_REFERENCIA_NO_ENCONTRADA");
    console.log("[PASS] recomendadas con referencia fuera de la allowlist firmada → 404 VARIANTE_REFERENCIA_NO_ENCONTRADA");

    // (i) snapshot-pinned search with a valid token.
    r = await llamar({ modo: "buscar", consulta: "globo redondo latex", approval_token: tokenBase });
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
    console.log("[PASS] buscar con token Python válido → 200 (fijado al snapshot firmado)");
  } catch (error) {
    if (isPythonAdapterError(error) && (error.code === "PYTHON_UNAVAILABLE" || error.code === "PYTHON_BACKEND_TIMEOUT")) {
      throw new Error(`el servicio Python o su catálogo local no respondió (${error.code})`, { cause: error });
    }
    throw error;
  } finally {
    await getRagPool().end();
  }
}

main().catch((error: unknown) => {
  console.error(`[FAIL] allowlist producto→variante Python — ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof Error && error.cause) console.error(error.cause);
  process.exitCode = 1;
});
