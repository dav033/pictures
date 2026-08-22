import { existsSync } from "node:fs";
import { Pool } from "pg";
import { buscarCatalogoRag } from "../src/lib/rag/chat/buscar";
import { validarSeleccion, type SeleccionSolicitada } from "../src/lib/rag/chat/validar";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

/**
 * Tests adversariales de Fase 4 (plan §4, "Criterios de aceptación"). Prueban
 * la CAPA DE VALIDACIÓN directamente — no le pedimos al LLM que se comporte
 * bien y cruzamos los dedos, probamos que el backend rechaza lo malo aunque
 * el LLM lo mande. Eso es lo que dice el plan §4.5/§6.5: la seguridad no
 * depende del system prompt.
 */
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let fallos = 0;
  const reportar = (ok: boolean, nombre: string, detalle: string) => {
    console.log(`[${ok ? "PASS" : "FAIL"}] ${nombre} — ${detalle}`);
    if (!ok) fallos++;
  };

  try {
    // Test 1: producto que no existe en el catálogo real.
    // IMPORTANTE (mismo hallazgo de Fase 3B): buscarCatalogoRag NO garantiza
    // "NO_MATCH" aquí — con similitud coseno el ruido y la señal se
    // superponen (ver eval-retrieval), así que retrieval puede devolver
    // candidatos "más cercanos" aunque ninguno sea realmente lo que se pidió.
    // Por diseño del plan (§4.9), la decisión NO_MATCH final es del LLM
    // viendo esos candidatos, no de un umbral de retrieval — eso solo se
    // puede probar con una conversación real, no aislando esta función.
    // Lo que SÍ es verificable aquí, y es lo que se prueba: todo lo que
    // devuelve, si devuelve algo, es un producto real del catálogo (no un
    // id fabricado) — la alucinación de producto sigue siendo imposible.
    const busquedaInexistente = await buscarCatalogoRag(pool, "castillo inflable dorado de 4 metros de altura");
    const { rows: idsValidos } = await pool.query<{ product_id: string }>("SELECT product_id FROM catalog_products");
    const catalogoValido = new Set(idsValidos.map((r) => r.product_id));
    const todosReales = busquedaInexistente.candidatos.every((c) => catalogoValido.has(c.productId));
    reportar(
      todosReales,
      "Test 1: candidatos (si los hay) son siempre productos reales, nunca fabricados",
      `candidatos=${busquedaInexistente.candidatos.length}, todos_reales=${todosReales}`,
    );
    if (busquedaInexistente.candidatos.length > 0) {
      console.log(
        `  [hallazgo Fase 3B, no un fallo nuevo] retrieval devolvió ${busquedaInexistente.candidatos.length} candidatos "más cercanos" para una consulta sin match real — la decisión NO_MATCH final depende del juicio del LLM sobre esos candidatos, no de este backend.`,
      );
    }

    // Test 2: el LLM "inventa" un product_id que nunca vino de una búsqueda real.
    const { rows: real1 } = await pool.query<{ product_id: string; variant_id: string }>(
      "SELECT product_id, variant_id FROM catalog_variants WHERE available = true LIMIT 1",
    );
    const idInventado: SeleccionSolicitada = {
      productId: "9999999999999-NO-EXISTE",
      variantId: real1[0]?.variant_id ?? "9999999999999",
      cantidad: 1,
    };
    // Whitelist real de la conversación: solo contiene el producto legítimo, NUNCA el inventado.
    const whitelist = new Map([[real1[0]?.product_id ?? "", new Set([real1[0]?.variant_id ?? ""])]])
    const r2 = await validarSeleccion(pool, [idInventado], whitelist);
    reportar(
      r2.validados.length === 0 && r2.rechazados.some((x) => x.motivo.includes("whitelist") || x.motivo.includes("recuperados")),
      "Test 2: ID inventado (fuera de whitelist) rechazado",
      JSON.stringify(r2.rechazados),
    );

    // Test 3: aunque el "LLM" intente colar un precio distinto al real (el tipo
    // no lo admite, pero se simula pasando un objeto con un campo extra para
    // demostrar que igual se ignora — el precio SIEMPRE sale de la DB).
    const { rows: real2 } = await pool.query<{ product_id: string; variant_id: string; price: string }>(
      "SELECT v.product_id, v.variant_id, v.price FROM catalog_variants v WHERE v.available = true LIMIT 1",
    );
    const precioReal = Number(real2[0].price);
    const intentoConPrecioFalso = {
      productId: real2[0].product_id,
      variantId: real2[0].variant_id,
      cantidad: 1,
      precio: precioReal - 1, // campo que el schema de la herramienta ni siquiera admite
    } as SeleccionSolicitada & { precio: number };
    const whitelist2 = new Map([[real2[0].product_id, new Set([real2[0].variant_id])]]);
    const r3 = await validarSeleccion(pool, [intentoConPrecioFalso], whitelist2);
    reportar(
      r3.validados[0]?.precioUnitario === precioReal,
      "Test 3: precio siempre viene de la DB, nunca de la solicitud",
      `DB=${precioReal}, resuelto=${r3.validados[0]?.precioUnitario}`,
    );

    // Test 4 (UNKNOWN ante atributo no presente en los datos) es una regla de
    // system prompt (route.ts BLOQUE_RAG), no algo que la capa de validación
    // pueda aplicar — no hay motor de preguntas/respuestas sobre atributos.
    // No se reporta PASS/FAIL aquí: no es verificable fuera de una
    // conversación real con el LLM.
    console.log("[N/A] Test 4: UNKNOWN ante atributo ausente — depende del LLM obedeciendo el system prompt, no verificable por la capa de validación");

    // Test 5: producto agotado → nunca se cotiza como disponible.
    const { rows: agotado } = await pool.query<{ product_id: string; variant_id: string }>(
      "SELECT product_id, variant_id FROM catalog_variants WHERE available = false LIMIT 1",
    );
    if (agotado.length === 0) {
      console.log("[N/A] Test 5: no hay ninguna variante agotada en el catálogo actual para probar");
    } else {
      const whitelist3 = new Map([[agotado[0].product_id, new Set([agotado[0].variant_id])]]);
      const r5 = await validarSeleccion(
        pool,
        [{ productId: agotado[0].product_id, variantId: agotado[0].variant_id, cantidad: 1 }],
        whitelist3,
      );
      reportar(
        r5.validados.length === 0 && r5.rechazados.some((x) => x.motivo === "variante agotada"),
        "Test 5: producto agotado no se cotiza como disponible",
        JSON.stringify(r5.rechazados),
      );
    }

    // The CDN contains a small over-selling cohort where available=true but
    // inventory_quantity is zero/negative. Availability remains authoritative
    // for retrieval and confirmation; stock is only a positive upper bound.
    const { rows: availableWithoutStock } = await pool.query<{ product_id: string; variant_id: string }>(
      "SELECT product_id, variant_id FROM catalog_variants WHERE available = true AND inventory_quantity <= 0 ORDER BY variant_id LIMIT 1",
    );
    if (availableWithoutStock.length === 0) {
      console.log("[N/A] available=true inventory<=0 — no source row in this catalog");
    } else {
      const row = availableWithoutStock[0];
      const lowStock = await validarSeleccion(
        pool,
        [{ productId: row.product_id, variantId: row.variant_id, cantidad: 1 }],
        new Map([[row.product_id, new Set([row.variant_id])]]),
      );
      reportar(
        lowStock.validados.length === 1,
        "available=true no se reinterpreta como agotado por inventory<=0",
        JSON.stringify(lowStock.rechazados),
      );
    }

    // Extra: variant_id real pero que pertenece a OTRO producto (no al product_id declarado).
    const { rows: dosVariantes } = await pool.query<{ product_id: string; variant_id: string }>(
      "SELECT DISTINCT product_id, variant_id FROM catalog_variants WHERE available = true LIMIT 2",
    );
    if (dosVariantes.length === 2 && dosVariantes[0].product_id !== dosVariantes[1].product_id) {
      const whitelist4 = new Map([[dosVariantes[0].product_id, new Set([dosVariantes[0].variant_id])]]);
      const rCruzado = await validarSeleccion(
        pool,
        [{ productId: dosVariantes[0].product_id, variantId: dosVariantes[1].variant_id, cantidad: 1 }],
        whitelist4,
      );
      reportar(
        rCruzado.validados.length === 0 &&
          rCruzado.rechazados.some((x) => x.motivo.includes("no pertenece") || x.motivo.includes("whitelist")),
        "Extra: variant_id de otro producto rechazado",
        JSON.stringify(rCruzado.rechazados),
      );
    }

    // Extra: cantidad inválida (0, negativa, no entera).
    const rCant = await validarSeleccion(
      pool,
      [{ productId: real2[0].product_id, variantId: real2[0].variant_id, cantidad: 0 }],
      new Map([[real2[0].product_id, new Set([real2[0].variant_id])]]),
    );
    reportar(
      rCant.validados.length === 0 && rCant.rechazados.some((x) => x.motivo === "cantidad inválida"),
      "Extra: cantidad <= 0 rechazada",
      JSON.stringify(rCant.rechazados),
    );

    console.log(`\n${fallos === 0 ? "[PASS]" : "[FAIL]"} ${fallos} test(s) fallido(s) de los verificables.`);
    process.exitCode = fallos === 0 ? 0 : 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[FAIL] suite de validación falló:", error);
  process.exitCode = 1;
});
