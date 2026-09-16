/**
 * `PlanResuelto` -> `ReferenceBlueprintV2`: la traducción del plan aprobado a
 * los elementos de escena que consume el prompt de imagen.
 *
 * Vive fuera de `src/app/api/generate/route.ts` porque un módulo de ruta de
 * Next solo puede exportar sus handlers y sus claves de configuración: el
 * generador de tipos de ruta de la build con webpack rechaza cualquier otro
 * export (`checkFields<Diff<...>>` en
 * node_modules/next/dist/build/webpack/plugins/next-types-plugin), y siete
 * scripts de prueba importaban esta función desde el handler HTTP. Aquí es
 * además donde le corresponde por capas (AGENTS.md): es una transformación de
 * dominio, no transporte.
 *
 * Puro: sin proveedor, HTTP, base de datos ni entorno.
 */
import { porcentajesMayorResto } from "@/lib/ia/tamano-fisico";
import { joinWithinLimit } from "@/lib/ia/scene-spec";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import { cajasDeEstructuras, ubicacionDeInstancia } from "@/lib/plan/ubicaciones";
import type { PlanResuelto } from "@/lib/plan/resuelto";

function plegarColor(color: string): string {
  return color.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/** Orden por punto de código: un desempate no puede depender del locale del servidor. */
function comparar(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function planBlueprint(plan: PlanResuelto): ReferenceBlueprintV2 {
  const cajas = cajasDeEstructuras(plan.plan.estructuras);
  const focal = plan.plan.estructuras.find((estructura) => estructura.rol_escena === "focal")?.estructura_id;
  const focalDeclarada = plan.plan.estructuras.find((estructura) => estructura.estructura_id === focal);
  const focalElementId = focal && focalDeclarada && focalDeclarada.repeticiones > 1 ? `${focal}#1` : focal;
  const densidad = plan.plan.estructuras.some((estructura) => estructura.densidad === "lujosa")
    ? "dense" as const
    : plan.plan.estructuras.some((estructura) => estructura.densidad === "sencilla")
      ? "sparse" as const
      : "moderate" as const;
  const elements = plan.estructuras.flatMap((resuelta) => {
    const declarada = plan.plan.estructuras.find((estructura) => estructura.estructura_id === resuelta.estructura_id)!;
    const materialPorVariante = new Map<string, { id: string; share: number; role: string; color: string | null }>();
    for (const linea of resuelta.lineas) {
      const previo = materialPorVariante.get(linea.variant_id);
      materialPorVariante.set(linea.variant_id, {
        id: linea.variant_id,
        share: (previo?.share ?? 0) + linea.unidades / Math.max(1, resuelta.total_unidades),
        role: declarada.materiales.find((material) => material.product_id === linea.product_id)?.rol_material ?? "principal",
        color: linea.color,
      });
    }
    const materiales = [...materialPorVariante.values()];
    // Mezcla de color de la estructura para el prompt de imagen: se agrega por
    // color plegado Y producto (dos productos distintos del mismo color siguen
    // separados), nunca por variante. Una variante es un TAMAÑO, así que el
    // reparto por variante partía un mismo color en trozos y ninguno parecía
    // dominante; el `bill_of_materials` sigue siendo por variante porque de él
    // salen las cantidades compradas.
    const mezclaPorColor = new Map<string, { color: string; productId: string; unidades: number; rol: string }>();
    for (const linea of resuelta.lineas) {
      if (!linea.color) continue;
      const clave = JSON.stringify([plegarColor(linea.color), linea.product_id]);
      const previo = mezclaPorColor.get(clave);
      mezclaPorColor.set(clave, {
        color: previo?.color ?? linea.color,
        productId: linea.product_id,
        unidades: (previo?.unidades ?? 0) + linea.unidades,
        rol: previo?.rol ?? declarada.materiales.find((material) => material.product_id === linea.product_id)?.rol_material ?? "principal",
      });
    }
    // Dominancia primero; los empates se rompen por color plegado y luego por
    // producto (comparación por punto de código, no por locale) para que el
    // orden no dependa del idioma del servidor.
    const mezclaOrdenada = [...mezclaPorColor.values()].sort((a, b) =>
      b.unidades - a.unidades
      || comparar(plegarColor(a.color), plegarColor(b.color))
      || comparar(a.productId, b.productId));
    const coloresPorDominancia = [...new Set(mezclaOrdenada.map((material) => material.color))].slice(0, 8);
    const porcentajesColor = porcentajesMayorResto(mezclaOrdenada.map((material) => material.unidades));
    const medidas = [declarada.medidas.ancho_m, declarada.medidas.alto_m, declarada.medidas.largo_m].filter((value): value is number => value != null).map((value) => `${value} m`).join(" × ");
    const nombreBase = medidas ? `${declarada.nombre} (${medidas})` : declarada.nombre;
    const dimensiones = {
      ...(declarada.medidas.ancho_m !== undefined ? { width: declarada.medidas.ancho_m } : {}),
      ...(declarada.medidas.alto_m !== undefined ? { height: declarada.medidas.alto_m } : {}),
      ...(declarada.medidas.largo_m !== undefined ? { length: declarada.medidas.largo_m } : {}),
    };
    const repeticiones = Math.max(1, declarada.repeticiones);
    return Array.from({ length: repeticiones }, (_, index) => {
      const elementId = repeticiones === 1 ? resuelta.estructura_id : `${resuelta.estructura_id}#${index + 1}`;
      const baseUnits = Math.floor(resuelta.total_unidades / repeticiones);
      const remainder = resuelta.total_unidades % repeticiones;
      const instanceUnits = baseUnits + (index < remainder ? 1 : 0);
      const relaciones: ReferenceBlueprintV2["elements"][number]["relationships"] = elementId === focalElementId
        ? []
        : focalElementId
          ? [{ type: declarada.tipo === "backdrop" ? "behind" as const : "aligned_with" as const, target_element_id: focalElementId }]
          : [];
      const nombre = repeticiones > 1 ? `${nombreBase} #${index + 1} de ${repeticiones}` : nombreBase;
      return {
      element_id: elementId,
      source_image_id: "PLAN_SOURCE",
      name: nombre.slice(0, 160),
      category: ["backdrop"].includes(declarada.tipo) ? "backdrop" as const : ["kit", "accesorio"].includes(declarada.tipo) ? "other" as const : "balloon_structure" as const,
      scene_role: declarada.tipo === "backdrop" ? "backdrop" as const : declarada.rol_escena === "focal" ? "midground" as const : "foreground" as const,
      detection_confidence: 1,
      visible_evidence: "Estructura declarada y resuelta por el plan de decoración.",
      reference_bbox: cajas[elementId]!.bbox,
      depth_layer: cajas[elementId]!.depthLayer,
      include_policy: "include" as const,
      approved: true,
      source_type: "catalog_backed" as const,
      quantity: { mode: "exact" as const, min: instanceUnits, max: instanceUnits },
      appearance: {
        observed_colors: coloresPorDominancia,
        resolved_colors: coloresPorDominancia,
        color_policy: "match_reference" as const,
        material: "Materiales reales del catálogo resueltos por variante.",
        shape: nombre.slice(0, 160),
        // Fragmentos completos dentro de los 180 caracteres que admite cada
        // identity_constraint (scene-spec.ts): el corte crudo a 240 partía el
        // último material justo donde importaba.
        composition: joinWithinLimit(mezclaOrdenada.map((material, indice) => `${porcentajesColor[indice]}% ${material.rol} (${material.color})`), 180) || "pieza de catálogo",
      },
      visual_semantics: {
        structure_type: declarada.tipo,
        placement: ubicacionDeInstancia(declarada, index),
        design_role: declarada.rol_escena === "focal" ? "focal" as const : declarada.rol_escena === "soporte" || declarada.tipo === "backdrop" ? "soporte" as const : "acento" as const,
        repetition_group: resuelta.estructura_id,
        ...(Object.keys(dimensiones).length ? { dimensions_m: dimensiones } : {}),
        density: declarada.densidad,
      },
      resolved_finishes: [...new Set(resuelta.lineas.map((linea) => linea.acabado).filter((acabado): acabado is string => Boolean(acabado)))].slice(0, 8),
      relationships: relaciones,
      uncertainties: resuelta.supuestos,
      model_decision: {
        action: "include" as const,
        catalog_product_id: materiales[0]?.id,
        match_type: "exact" as const,
        reason: declarada.porque,
        adaptation: "Construir esta estructura completa en la ubicación indicada; no renderizar los materiales como piezas aisladas.",
        bill_of_materials: materiales.map((material) => ({ catalog_product_id: material.id, role: material.role, share: Math.min(1, material.share) })),
      },
      };
    });
  });
  return ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: [{ image_id: "PLAN_SOURCE", approved_roles: ["composition_reference"] }],
    elements,
    composition: {
      focal_point: plan.plan.estructuras.find((estructura) => estructura.rol_escena === "focal")?.nombre ?? "instalación central",
      density: densidad,
      symmetry: "asymmetric",
      negative_space: ["circulación libre", "contacto físico con piso o mobiliario"],
    },
    palette: { observed: plan.plan.concepto.paleta.slice(0, 12), priority: plan.plan.concepto.paleta.slice(0, 8) },
    unresolved_decisions: [],
  });
}
