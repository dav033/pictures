import assert from "node:assert/strict";
import type { Pool } from "pg";
import { crearEstadoConversacion, crearRegistroHerramientas } from "../src/lib/ia/registro-herramientas";
import { parseEventIntent } from "../src/lib/rag/query-parser/parse-event";
import type { EventMatchEvidence } from "../src/lib/rag/retrieval/types";

async function main(): Promise<void> {
const solicitud = "Festival Lunaria elegante verde y blanco para 30 personas. No es boda";
const intent = parseEventIntent(solicitud);
assert.equal(intent.event_label, "Festival Lunaria");
assert.equal(intent.event_type, "open");
assert.equal(intent.event_family, "other");

const filas = [
  { product_id: "P-VERDE", variant_id: "V-VERDE", sku: "SKU-VERDE", producto_titulo: "Cortina verde", variante_titulo: "Verde", precio: 12_000, unidades_paq: 1, disponible: true, producto_disponible: true, codigo_tamano: null, forma: null, diam_pulg: null, colores_producto: ["verde"], colores_variante: ["verde"], acabados_producto: [], descripcion: "Cortina verde", imagen: null },
  { product_id: "P-BLANCO", variant_id: "V-BLANCO", sku: "SKU-BLANCO", producto_titulo: "Cortina blanca", variante_titulo: "Blanco", precio: 12_000, unidades_paq: 1, disponible: true, producto_disponible: true, codigo_tamano: null, forma: null, diam_pulg: null, colores_producto: ["blanco"], colores_variante: ["blanco"], acabados_producto: [], descripcion: "Cortina blanca", imagen: null },
];
const pool = {
  query: async (sql: string) => sql.includes("catalog_variants") ? { rows: filas } : { rows: [] },
} as unknown as Pool;

const estado = crearEstadoConversacion({}, solicitud);
for (const [productId, variantId] of [["P-VERDE", "V-VERDE"], ["P-BLANCO", "V-BLANCO"]]) {
  estado.ragIdsRecuperados.add(productId);
  estado.ragVariantIdsRecuperados.set(productId, new Set([variantId]));
}
const evidencia: EventMatchEvidence = { match_level: "thematic", matched_signals: ["lunaria"], relaxations: [] };
const evidenciaBlanca: EventMatchEvidence = { match_level: "adaptable", matched_signals: [], relaxations: ["evento sin señal verificable en título, descripción o tags"] };
estado.ragEventEvidence?.set("P-VERDE", evidencia);
estado.ragEventEvidence?.set("P-BLANCO", evidenciaBlanca);

const estructura = (id: string, productId: string, variantId: string, color: string, ubicacion: "arco_central" | "lateral_izquierdo" | "lateral_derecho") => ({
  estructura_id: id,
  nombre: `Instalación ${id}`,
  tipo: "accesorio" as const,
  rol_escena: id.startsWith("EST_01_") ? "focal" as const : "soporte" as const,
  ubicacion,
  medidas: {},
  repeticiones: 1,
  densidad: "sencilla" as const,
  mezcla: "clasica" as const,
  materiales: [{ product_id: productId, variant_id: variantId, participacion: 1, rol_material: "principal" as const, color }],
  unidades_declaradas: 1,
  porque: "Prueba de contrato de evento abierto",
});

const registro = crearRegistroHerramientas(estado, { pool });
const confirmar = registro.confirmar_plan_decoracion;
assert.ok(confirmar, "confirmar_plan_decoracion debe estar registrada");
const llamada = { nombre: "confirmar_plan_decoracion", args: {} };
const respuesta = await confirmar({
  concepto: { titulo: "Festival Lunaria", descripcion: "Instalación verde y blanca", paleta: ["verde", "blanco"], ocasion: "boda" },
  espacio: { tipo: "salón", fuente: "supuesto" },
  estructuras: [
    estructura("EST_01_ACC", "P-VERDE", "V-VERDE", "verde", "arco_central"),
    estructura("EST_02_ACC", "P-BLANCO", "V-BLANCO", "blanco", "lateral_izquierdo"),
    estructura("EST_03_ACC", "P-VERDE", "V-VERDE", "verde", "lateral_derecho"),
  ],
  supuestos: [],
}, llamada);
assert.equal(respuesta.ok, true);
assert.equal(estado.planResuelto?.event_label, "Festival Lunaria");
assert.equal(estado.planResuelto?.original_request, solicitud);
assert.deepEqual(new Set(estado.planResuelto?.event_match_levels), new Set(["thematic", "adaptable"]));
assert.match(estado.planResuelto?.event_relaxations?.join(" ") ?? "", /señal verificable/);
assert.equal(estado.planResuelto?.plan.concepto.ocasion, "Festival Lunaria");

// This is the payload consumed by page.tsx/TarjetaPlanDecoracion. It must be
// the resolved plan, not the raw tool arguments that still say "boda".
const renderPayload = JSON.parse(JSON.stringify({ plan: estado.planResuelto })) as { plan?: { event_label?: string | null; event_match_levels?: string[]; event_relaxations?: string[] } };
assert.equal(renderPayload.plan?.event_label, "Festival Lunaria");
assert.deepEqual(new Set(renderPayload.plan?.event_match_levels), new Set(["thematic", "adaptable"]));
assert.match(renderPayload.plan?.event_relaxations?.join(" ") ?? "", /señal verificable/);

console.log("[PASS] contrato E2E evento abierto: confirmar_plan → resolver → payload UI conserva Festival Lunaria y match levels");
}

main().catch((error: unknown) => {
  console.error("[FAIL] contrato E2E evento abierto", error);
  process.exitCode = 1;
});
