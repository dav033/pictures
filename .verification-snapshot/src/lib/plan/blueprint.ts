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
import { porcentajesMayorResto } from "@/lib/ia/escena/tamano-fisico";
import { joinWithinLimit } from "@/lib/ia/escena/scene-spec";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { materialesDeLineas } from "@/lib/plan/material-de-linea";
import { cajasDeEstructuras, ubicacionDeInstancia } from "@/lib/plan/ubicaciones";
import type { PlanResuelto } from "@/lib/plan/resuelto";

/** La "foto" de los elementos que salen del plan: sus `quantity` son los globos que el plan compra (material_units). */
export const FUENTE_PLAN = "PLAN_SOURCE";

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
    // El material de cada línea, también de las que compra una sustitución (`variant_overrides`): por producto, el lila
    // de la idea «rosa, lila y dorado» (comprado como otro producto) salía «principal» y el último (verificador 127).
    const indiceDeLinea = materialesDeLineas(declarada, resuelta.lineas);
    const rolDeLinea = (posicion: number) => declarada.materiales[indiceDeLinea[posicion] ?? -1]?.rol_material ?? "principal";
    const materialPorVariante = new Map<string, { id: string; share: number; role: string; color: string | null }>();
    resuelta.lineas.forEach((linea, posicion) => {
      const previo = materialPorVariante.get(linea.variant_id);
      materialPorVariante.set(linea.variant_id, {
        id: linea.variant_id,
        share: (previo?.share ?? 0) + linea.unidades / Math.max(1, resuelta.total_unidades),
        role: rolDeLinea(posicion),
        color: linea.color,
      });
    });
    const materiales = [...materialPorVariante.values()];
    // Mezcla de color de la estructura para el prompt de imagen: se agrega por
    // color plegado Y producto (dos productos distintos del mismo color siguen
    // separados), nunca por variante. Una variante es un TAMAÑO, así que el
    // reparto por variante partía un mismo color en trozos y ninguno parecía
    // dominante; el `bill_of_materials` sigue siendo por variante porque de él
    // salen las cantidades compradas.
    const mezclaPorColor = new Map<string, { color: string; productId: string; unidades: number; rol: string; orden: number }>();
    resuelta.lineas.forEach((linea, posicion) => {
      if (!linea.color) return;
      const clave = JSON.stringify([plegarColor(linea.color), linea.product_id]);
      const previo = mezclaPorColor.get(clave);
      const indice = indiceDeLinea[posicion] ?? -1;
      mezclaPorColor.set(clave, {
        color: previo?.color ?? linea.color,
        productId: linea.product_id,
        unidades: (previo?.unidades ?? 0) + linea.unidades,
        rol: previo?.rol ?? rolDeLinea(posicion),
        orden: previo?.orden ?? (indice < 0 ? declarada.materiales.length : indice),
      });
    });
    // Dominancia primero; un empate lo gana el material que el plan declara
    // antes (el orden de Python, el mismo que `mezcla-color-escena.ts`), no el
    // alfabeto: un 29/29 de un "Arco lila" salía "blanco, lila" (2026-10-05).
    // Detrás, color plegado y producto por punto de código, para que el orden
    // no dependa del idioma del servidor.
    const mezclaOrdenada = [...mezclaPorColor.values()].sort((a, b) =>
      b.unidades - a.unidades
      || a.orden - b.orden
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
      source_image_id: FUENTE_PLAN,
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
    source_images: [{ image_id: FUENTE_PLAN, approved_roles: ["composition_reference"] }],
    elements,
    composition: {
      focal_point: plan.plan.estructuras.find((estructura) => estructura.rol_escena === "focal")?.nombre ?? "central installation",
      density: densidad,
      // Antes siempre "asymmetric", y el prompt pedía asimetría natural a un par de
      // columnas en espejo (auditoría G8). Con un par aprobado es simétrico; sin él
      // el plan no lo decide.
      symmetry: plan.plan.estructuras.some((estructura) => estructura.repeticiones >= 2 && estructura.repeticiones % 2 === 0) ? "symmetric" : "unknown",
      // En inglés: este texto entra al prompt de imagen (auditoría G6).
      negative_space: ["clear walking space in front of the installation", "visible contact with the floor or furniture"],
    },
    palette: { observed: plan.plan.concepto.paleta.slice(0, 12), priority: plan.plan.concepto.paleta.slice(0, 8) },
    unresolved_decisions: [],
  });
}
