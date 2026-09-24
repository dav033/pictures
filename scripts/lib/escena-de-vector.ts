/**
 * La escena y el prompt de imagen de un vector golden, armados con la MISMA
 * cadena que `/api/generate`.
 *
 * Único dueño de ese cableado para las dos suites que lo necesitan
 * (`scripts/test-invariantes-plan.ts` y `scripts/test-color-escena-produccion.ts`).
 * Lo que importa aquí es de dónde salen los colores: en producción no salen del
 * plan, salen de `resolverProductosParaGeneracion` -> `Producto.colores`, y esa
 * es la lista que acaba en `appearance.resolved_colors` del SceneSpec y que
 * `verificarCoherenciaPrompt` compara con los colores comprados por cada
 * estructura. Una prueba que llene `catalogProducts[].colors` con su propia
 * regla de color no comprueba el prompt de producción: comprueba el suyo.
 *
 * Módulo importable (AGENTS.md, "Keep scripts import-safe"): sin CLI ni efectos
 * al cargar. Determinista y sin red: el catálogo entra por un doble del `Pool`.
 */
import type { Pool } from "pg";
import { buildImagePrompt, placementDescription, promptElementName, tieneContratoDeColor } from "@/lib/ia/uzume/build-image-prompt";
import { buildApprovedSceneSpec, type SceneSpec } from "@/lib/ia/escena/scene-spec";
import { bloqueMezclaPorEstructura } from "@/lib/ia/escena/tamano-fisico";
import type { DesignMaterialEstimate } from "@/lib/materiales/estimacion";
import { planBlueprint } from "@/lib/plan/blueprint";
import type { EscenaParaCoherencia } from "@/lib/plan/coherencia";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { cajasDeEstructuras } from "@/lib/plan/ubicaciones";
import { resolverProductosParaGeneracion } from "@/lib/rag/generate-products";
import type { CatalogRow } from "./vectores-golden";

/**
 * Colores con los que producción etiqueta cada variante del catálogo del
 * vector. No replica la regla: llama a la función de producción
 * (`resolverProductosParaGeneracion`), así que una divergencia futura entre el
 * resolutor del plan y la proyección de productos rompe las pruebas.
 */
export async function coloresDeProduccionPorVariante(rows: readonly CatalogRow[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(rows.map((row) => row.variant_id))];
  if (ids.length === 0) return new Map();
  // Las columnas que consulta `resolverVariantesRagParaGeneracion`, desde las
  // mismas filas del vector que alimentan al resolutor del plan.
  const filas = rows.map((row) => ({
    product_id: row.product_id,
    variant_id: row.variant_id,
    sku: row.sku,
    producto_titulo: row.producto_titulo,
    variante_titulo: row.variante_titulo,
    precio: row.precio,
    imagen_principal: row.imagen,
    producto_tipo: null,
    categoria: null,
    colores_producto: row.colores_producto,
    colores_variante: row.colores_variante,
    descripcion: row.descripcion,
    unidades_paq: row.unidades_paq,
    codigo_tamano: row.codigo_tamano,
    forma: row.forma,
    diam_pulg: row.diam_pulg,
  }));
  const pool = { query: async () => ({ rows: filas }) } as unknown as Pool;
  const { productos } = await resolverProductosParaGeneracion({ ragVariantIds: ids }, pool);
  return new Map(productos.map((producto) => [producto.id, producto.colores]));
}

export type EscenaDeVector = {
  escena: SceneSpec;
  prompt: string;
  coherencia: EscenaParaCoherencia;
};

/**
 * `planBlueprint` -> `buildApprovedSceneSpec` -> `buildImagePrompt`, con las
 * mismas entradas que arma `/api/generate` para un plan aprobado.
 */
export function escenaDeVector(
  plan: PlanResuelto,
  estimate: DesignMaterialEstimate,
  coloresPorVariante: ReadonlyMap<string, readonly string[]>,
): EscenaDeVector {
  const blueprint = planBlueprint(plan);
  const escena = buildApprovedSceneSpec({
    blueprint,
    aspectRatio: "3:2",
    targetBoxes: Object.fromEntries(
      Object.entries(cajasDeEstructuras(plan.plan.estructuras)).map(([id, layout]) => [id, layout.bbox]),
    ),
    catalogProducts: Object.fromEntries(blueprint.elements.map((element) => [
      element.element_id,
      (element.model_decision?.bill_of_materials ?? []).map((linea) => ({
        id: linea.catalog_product_id,
        name: linea.catalog_product_id,
        description: "",
        category: "balloon",
        colors: [...(coloresPorVariante.get(linea.catalog_product_id) ?? [])],
        share: linea.share,
        role: linea.role,
      })),
    ])),
    materialEstimate: estimate,
    generationMode: "text_to_image",
    createdBy: "server_default",
    planHash: plan.plan_hash,
    catalogOnly: true,
  });
  const ubicaciones = new Map<string, string>();
  for (const element of escena.elements) {
    const grupo = element.visual_semantics?.repetition_group ?? element.element_id.split("#")[0]!;
    if (!ubicaciones.has(grupo)) ubicaciones.set(grupo, placementDescription(element.target_bbox, element.category));
  }
  const sizeMixBlock = bloqueMezclaPorEstructura(plan.estructuras.map((estructura) => ({
    nombre: estructura.nombre,
    total_unidades: estructura.total_unidades,
    repeticiones: estructura.repeticiones,
    ubicacion_en_palabras: ubicaciones.get(estructura.estructura_id),
    mezcla_real: estructura.mezcla_real.map((fila) => ({ diamPulg: fila.diam_pulg, forma: fila.forma, unidades: fila.unidades })),
  }))) ?? undefined;
  return {
    escena,
    prompt: buildImagePrompt({ sceneSpec: escena, sizeMixBlock }),
    coherencia: {
      elementos: escena.elements.map((element) => ({
        element_id: element.element_id,
        nombre_en_prompt: promptElementName(element.name),
        estructura_id: element.visual_semantics?.repetition_group ?? element.element_id.split("#")[0]!,
        resolved_colors: element.resolved_colors,
        espera_linea_de_color: tieneContratoDeColor(element),
      })),
    },
  };
}
