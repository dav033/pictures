/**
 * Flores de globo de la foto en la confirmación del plan (`confirmar_plan_decoracion`, registro-herramientas.ts), el
 * eslabón que une la lectura con lo que Python compra y con lo que oye el cliente (corrector, 2026-10-07):
 *   1. la forma de cada producto sale de los candidatos del turno: el centro dorado de las flores es el látex Reflex,
 *      no el metalizado dorado que la pieza lleva delante (Python no arma una flor con él y el plan entero se rechazaba);
 *   2. las flores que el plan no puede armar llegan a `avisos_cliente` (la tarjeta de la lectura ya se las prometió).
 *
 * Sin red, sin proveedor y sin coste: el resolutor Python es el doble de transporte de siempre.
 *   npx tsx --conditions=react-server scripts/test/test-flores-foto-confirmar.ts
 */
import assert from "node:assert/strict";
import type { Pool } from "pg";
import type { ReferenceBlueprintV2 } from "../../src/lib/ia/referencia/reference-blueprint";
import type { ProductoCandidato } from "../../src/lib/rag/chat/buscar";
import { instalarResolutorPythonFalso, prepararEntornoPythonFalso, SNAPSHOT_FALSO } from "../lib/resolutor-python-falso";

prepararEntornoPythonFalso();
process.env.ARMADO_ARCO_COLUMNA_V1 = "false";

function blueprintConFlores(flores: Record<string, unknown>): ReferenceBlueprintV2 {
  return {
    schema_version: "2.0", source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
    elements: [{
      element_id: "REF_01_E01", source_image_id: "REF_01", name: "columna", category: "balloon_structure", scene_role: "midground", detection_confidence: 0.9,
      visible_evidence: "columna", reference_bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 }, depth_layer: 1, include_policy: "include", approved: true, source_type: "reference_only",
      quantity: { mode: "exact", min: 1, max: 1 },
      appearance: { observed_colors: ["pearl white", "chrome gold"], resolved_colors: [], color_policy: "match_reference", material: "latex", shape: "pieza", composition: "single uniform material", flores },
      relationships: [], uncertainties: [],
    }],
    composition: { focal_point: "mesa", density: "moderate", symmetry: "symmetric", negative_space: [] },
    palette: { observed: ["pearl white", "chrome gold"], priority: [] }, unresolved_decisions: [],
  } as unknown as ReferenceBlueprintV2;
}

function candidato(productId: string, titulo: string, color: string, forma: string, diamPulg: number | null): ProductoCandidato {
  return {
    productId, titulo, categoria: forma === "redondo" ? "globo_latex" : "globo_metalizado", colores: [color], acabados: [], ocasiones: [], disponible: true, imagen: null,
    variantes: [{ variantId: `V-${productId}`, sku: null, titulo: null, precio: 5000, disponible: true, codigoTamano: diamPulg ? `R-${diamPulg}` : null, diamPulg, forma, colores: [color] }],
  } as unknown as ProductoCandidato;
}

async function confirmarConFlores(flores: Record<string, unknown>) {
  const { crearEstadoConversacion, crearRegistroHerramientas } = await import("../../src/lib/ia/herramientas/registro-herramientas");
  const candidatos = [
    candidato("p-silk-blanco", "B2b Globo Latex Redondo Silk Blanco Nácar", "blanco", "redondo", 12),
    candidato("p-estrella-dorada", "B2b Globo Metalizado Estrella Dorado", "dorado", "estrella", null),
    candidato("p-reflex-dorado", "B2b Globo Latex Redondo Reflex Dorado", "dorado", "redondo", 12),
  ];
  const llamadas = instalarResolutorPythonFalso();
  const estado = crearEstadoConversacion({}, "Quiero algo así", blueprintConFlores(flores));
  estado.ragCatalogSnapshotId = SNAPSHOT_FALSO;
  estado.ragCandidatos = candidatos;
  for (const item of candidatos) {
    estado.ragIdsRecuperados.add(item.productId);
    estado.ragVariantIdsRecuperados.set(item.productId, new Set(item.variantes.map((variante) => variante.variantId)));
  }
  const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
  const confirmar = crearRegistroHerramientas(estado, { pool, creatividad: 0 }).confirmar_plan_decoracion!;
  const material = (product_id: string, color: string, participacion: number, rol: string, variant_id?: string) => ({ product_id, color, participacion, rol_material: rol, ...(variant_id ? { variant_id } : {}) });
  // Un centro de mesa por unidades (pieza sin geometría): conserva su estrella metalizada, que en una pieza geométrica
  // la cobertura ya habría quitado antes de las flores. Es donde el metalizado llegaba a ser el centro de la flor.
  const respuesta = await confirmar({
    concepto: { titulo: "Cumpleaños", descripcion: "Centro de mesa de la foto", paleta: ["blanco", "dorado"] },
    espacio: { tipo: "salón", fuente: "supuesto" },
    estructuras: [{
      estructura_id: "EST_01_CENTRO_MESA", nombre: "Centro de mesa blanco y dorado", tipo: "centro_mesa", rol_escena: "focal", ubicacion: "sobre_mesa_principal",
      medidas: {}, repeticiones: 1, densidad: "media", mezcla: "clasica", unidades_declaradas: 7, referencia_element_id: "REF_01_E01", porque: "Adorna cada mesa.",
      materiales: [material("p-silk-blanco", "blanco", 0.6, "principal", "V-p-silk-blanco"), material("p-estrella-dorada", "dorado", 0.1, "acento", "V-p-estrella-dorada"), material("p-reflex-dorado", "dorado", 0.3, "secundario", "V-p-reflex-dorado")],
    }],
  }, { nombre: "confirmar_plan_decoracion", args: {} }) as Record<string, unknown>;
  const enviado = llamadas.filter((llamada) => llamada.path === "/internal/v1/plan/resolve").at(-1)?.body.plan as { estructuras: Array<{ materiales: Array<{ product_id: string }>; flores?: { petalos?: number; petalo: { product_id: string }; centro?: { product_id: string } } }> } | undefined;
  return { respuesta, enviado };
}

async function main(): Promise<void> {
  const { detectarJergaInterna } = await import("../../src/lib/ia/omoikane/jerga-interna");

  const dorado = await confirmarConFlores({ cantidad: 2, petalos: 6, color_petalo: "blanco", color_centro: "dorado", confianza: 0.9 });
  assert.equal(dorado.respuesta.ok, true, JSON.stringify(dorado.respuesta).slice(0, 600));
  assert.ok(dorado.enviado?.estructuras[0]?.materiales.some((item) => item.product_id === "p-estrella-dorada"), "el metalizado sigue en la pieza: la prueba distingue");
  assert.deepEqual(dorado.enviado?.estructuras[0]?.flores, { cantidad: 2, petalos: 6, petalo: { product_id: "p-silk-blanco", color: "blanco" }, centro: { product_id: "p-reflex-dorado", color: "dorado" } }, "a Python le llega el centro de látex redondo y los 6 pétalos");
  console.log("ok   1. el centro dorado de la flor es el Reflex (redondo), no el metalizado de delante; los 6 pétalos viajan a Python");

  const rosadas = await confirmarConFlores({ cantidad: 2, color_petalo: "rosado", confianza: 0.9 });
  assert.equal(rosadas.respuesta.ok, true, JSON.stringify(rosadas.respuesta).slice(0, 600));
  assert.equal(rosadas.enviado?.estructuras[0]?.flores, undefined);
  const avisos = rosadas.respuesta.avisos_cliente as string[];
  const aviso = "Tu foto tiene 2 flores de globo rosado en «Centro de mesa blanco y dorado», pero tu plan no lleva globos rosado: va sin esas flores (puedes pedirlas en otro color).";
  assert.ok(avisos.includes(aviso), avisos.join(" | "));
  assert.deepEqual(detectarJergaInterna(aviso), [], aviso);
  assert.match(String(rosadas.respuesta.accion_requerida), /avisos_cliente/, "el modelo tiene que decírselo");
  console.log("ok   2. las flores rosadas que el plan no puede armar llegan a avisos_cliente");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
