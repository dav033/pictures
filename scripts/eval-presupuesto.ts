import { existsSync } from "node:fs";
import { Pool } from "pg";
import { buscarCatalogoRagConPresupuesto } from "../src/lib/rag/chat/buscar-presupuesto";
import { FRANJAS, FRANJA_SLUGS, techoSeguridad, type FranjaSlug } from "../src/lib/rag/presupuesto/franjas";
import { resolverFranja } from "../src/lib/rag/presupuesto/resolver";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

/**
 * El plan (PLAN_RAG_FRANJAS_PRESUPUESTO.md §9) admite que esto nunca quedó
 * como suite repetible — las métricas se verificaron manualmente una vez.
 * Este script cubre lo que sí se puede verificar de forma objetiva sin
 * juicio subjetivo: los invariantes de negocio que el propio código declara
 * (tope de rol con la relajación documentada del 15%, techo de seguridad de
 * 1.6x, ids reales) y el mapeo determinista de resolverFranja.
 */

type CasoResolucion = { entrada: number | string; esperado: FranjaSlug | null };

const CASOS_RESOLUCION: CasoResolucion[] = [
  { entrada: 0, esperado: null },
  { entrada: -100, esperado: null },
  { entrada: 1, esperado: "detalle" },
  { entrada: 49_999, esperado: "detalle" },
  { entrada: 50_000, esperado: "focal" },
  { entrada: 99_999, esperado: "focal" },
  { entrada: 100_000, esperado: "escena" },
  { entrada: 149_999, esperado: "escena" },
  { entrada: 150_000, esperado: "escena_completa" },
  { entrada: 500_000, esperado: "escena_completa" },
  { entrada: "hasta 50000", esperado: "detalle" },
  { entrada: "hasta $50.000", esperado: "detalle" },
  { entrada: "desde 150000", esperado: "escena_completa" },
  { entrada: "50000 a 100000", esperado: "focal" },
  { entrada: "80 mil", esperado: "focal" },
  { entrada: "detalle", esperado: "detalle" },
  { entrada: "", esperado: null },
  { entrada: "no tengo presupuesto definido", esperado: null },
];

function evaluarResolucion(): { ok: number; total: number; fallos: string[] } {
  let ok = 0;
  const fallos: string[] = [];
  for (const caso of CASOS_RESOLUCION) {
    const slugObtenido = resolverFranja(caso.entrada)?.franja.slug ?? null;
    if (slugObtenido === caso.esperado) ok++;
    else fallos.push(`resolverFranja(${JSON.stringify(caso.entrada)}) => ${slugObtenido}, esperado ${caso.esperado}`);
  }
  return { ok, total: CASOS_RESOLUCION.length, fallos };
}

const CONSULTAS_GENERICAS = [
  "quiero decorar para un cumpleaños infantil",
  "decoración para una boda elegante",
  "algo para una fiesta de graduación",
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    console.log("--- Resolución de franja (función pura, sin DB) ---");
    const resolucion = evaluarResolucion();
    console.log(`${resolucion.ok}/${resolucion.total} casos correctos`);
    for (const f of resolucion.fallos) console.log(`  [FAIL] ${f}`);

    const { rows: idsValidos } = await pool.query<{ product_id: string }>("SELECT product_id FROM catalog_products");
    const catalogoValido = new Set(idsValidos.map((r) => r.product_id));
    const { rows: variantesValidas } = await pool.query<{ variant_id: string }>("SELECT variant_id FROM catalog_variants");
    const variantesValidasSet = new Set(variantesValidas.map((r) => r.variant_id));

    console.log("\n--- Integración por franja (contra catálogo real) ---");
    const latencias: number[] = [];
    let piezasFueraDeTope = 0;
    let piezasIdInvalido = 0;
    let canastasSobreTechoSeguridad = 0;
    let sinCanasta = 0;
    let totalCorridas = 0;

    for (const slug of FRANJA_SLUGS) {
      const franja = FRANJAS[slug];
      const cifraCliente = franja.maxCop != null ? Math.round((franja.minCop + franja.maxCop) / 2) : franja.minCop + 20_000;
      const techoEfectivoFranja = franja.maxCop ?? Math.max(franja.minCop, cifraCliente);
      const techoSeg = techoSeguridad(franja, cifraCliente);

      for (const mensaje of CONSULTAS_GENERICAS) {
        totalCorridas++;
        const t0 = Date.now();
        const resultado = await buscarCatalogoRagConPresupuesto(pool, mensaje, franja, cifraCliente);
        const latencyMs = Date.now() - t0;
        latencias.push(latencyMs);

        if (!resultado.canasta || resultado.canasta.piezas.length === 0) {
          sinCanasta++;
          console.log(`  [${slug}] "${mensaje}" -> sin canasta (${latencyMs}ms)`);
          continue;
        }

        const canasta = resultado.canasta;
        if (canasta.total > techoSeg) {
          canastasSobreTechoSeguridad++;
          console.log(
            `  [FAIL techo_seguridad] [${slug}] "${mensaje}" total=$${canasta.total} > techo_seguridad=$${techoSeg}`,
          );
        }

        for (const pieza of canasta.piezas) {
          if (!catalogoValido.has(pieza.productId) || !variantesValidasSet.has(pieza.variantId)) {
            piezasIdInvalido++;
            console.log(`  [FAIL id_invalido] [${slug}] pieza ${pieza.productId}/${pieza.variantId} no existe en catálogo`);
          }
          const cuota = franja.recetas[pieza.rol];
          // Mismo tope que calcula plan.ts, con la relajación del 15% que
          // retrieval/por-rol.ts sí admite explícitamente.
          const topeConRelajacion = Math.round(techoEfectivoFranja * cuota.topeFraccion * 1.15);
          if (pieza.precio > topeConRelajacion) {
            piezasFueraDeTope++;
            console.log(
              `  [FAIL tope_rol] [${slug}] "${pieza.titulo}" (${pieza.rol}) precio=$${pieza.precio} > tope permitido $${topeConRelajacion} (incl. relajación 15%)`,
            );
          }
        }

        console.log(
          `  [${slug}] "${mensaje}" -> ${canasta.piezas.length} piezas, total=$${canasta.total}, utilización=${(canasta.utilizacion * 100).toFixed(0)}%, cumple=${canasta.cumplePresupuesto} (${latencyMs}ms) relajaciones=${resultado.relajaciones.length}`,
        );
        if (resultado.relajaciones.length) {
          for (const r of resultado.relajaciones) console.log(`      ${r}`);
        }
      }
    }

    latencias.sort((a, b) => a - b);
    const p50 = latencias[Math.floor(latencias.length * 0.5)] ?? NaN;
    const p95 = latencias[Math.floor(latencias.length * 0.95)] ?? NaN;

    console.log("\n--- Resumen ---");
    console.log(`Latencia por turno (parse + retrieval-por-rol): p50=${p50}ms, p95=${p95}ms (n=${latencias.length})`);
    console.log(`Corridas sin canasta: ${sinCanasta}/${totalCorridas}`);
    console.log(`Piezas fuera del tope de su rol (con relajación 15%): ${piezasFueraDeTope}`);
    console.log(`Piezas con id inexistente en el catálogo: ${piezasIdInvalido}`);
    console.log(`Canastas por encima del techo de seguridad (1.6x): ${canastasSobreTechoSeguridad}`);

    console.log("\n--- Criterios de aceptación ---");
    const resolucionOk = resolucion.ok === resolucion.total;
    console.log(`[${resolucionOk ? "PASS" : "FAIL"}] resolverFranja mapea correctamente todos los casos de borde`);
    console.log(`[${piezasFueraDeTope === 0 ? "PASS" : "FAIL"}] ninguna pieza excede el tope de su rol (con relajación 15%)`);
    console.log(`[${piezasIdInvalido === 0 ? "PASS" : "FAIL"}] toda pieza de toda canasta existe en el catálogo real`);
    console.log(`[${canastasSobreTechoSeguridad === 0 ? "PASS" : "FAIL"}] ninguna canasta se pasa del techo de seguridad (1.6x)`);

    const algunFallo = !resolucionOk || piezasFueraDeTope > 0 || piezasIdInvalido > 0 || canastasSobreTechoSeguridad > 0;
    process.exitCode = algunFallo ? 1 : 0;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[FAIL] evaluación de presupuesto falló:", error);
  process.exitCode = 1;
});
