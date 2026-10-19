/**
 * El caption FLUX de una generación guardada, armado con la MISMA cadena que `/api/generate` (plan → blueprint →
 * escena aprobada → contexto visual → `compileProductPrompt`), sin red, sin base de datos y sin FLUX.
 *
 * Por qué existe (verificador 127, 2026-10-07): la foto de ejemplo 06 se quedó sin imagen en las dos vistas con
 * `FLUX_PREFLIGHT_FAILED: longitud 1540 supera límite 1000`, y el texto rechazado no quedó en el registro. Con el
 * cuerpo que el navegador mandó a `/api/generate` y la respuesta de Python a `plan/resolve` (las dos quedan en el
 * banco de fotos) se vuelve a compilar el caption tal cual y se ve qué sobraba.
 *
 * Lo que NO viene de la base de datos: los productos (`resolverProductosParaGeneracion`) se leen de las líneas que
 * Python resolvió, con un doble del `Pool` (como `escena-de-vector.ts`); la escenografía, del blueprint de la foto
 * del cuerpo. Sin foto del espacio ni imagen previa (el banco no las usa).
 *
 * Módulo importable (AGENTS.md, «Keep scripts import-safe»): sin CLI ni efectos al cargar.
 */
import type { Pool } from "pg";
import { PlanResueltoV1Schema } from "@/lib/ia/contracts/domain-v1";
import { buildApprovedSceneSpec, SceneSpecSchema, type SceneSpec } from "@/lib/ia/escena/scene-spec";
import { buildVisualContext, completarEscenaConPlan } from "@/lib/ia/escena/visual-context";
import { entornoDeEscena } from "@/lib/ia/escena/entorno-escena";
import { nivelCreatividadParaGenerar, perfilCreatividad } from "@/lib/ia/escena/creatividad";
import { aspectoDeLaReferencia } from "@/lib/ia/nucleo/aspecto";
import { compileProductPrompt, aliasesDeProducto, sizeConfirmationsFromMaterialLines } from "@/lib/ia/kagutsuchi/producto-flux";
import { preflightFluxPrompt } from "@/lib/ia/kagutsuchi/preflight-flux";
import { ReferenceBlueprintV2Schema, unidadesMaterialDeElemento, type ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { applySceneryVisibility, elementosMaterializados, sceneryFromReference } from "@/lib/ia/referencia/reference-structure";
import { resolveAspectTransform } from "@/lib/ia/uzume/aspect-transform";
import { frasesDeEstructuras } from "@/lib/ia/uzume/mezcla-color-escena";
import { targetBoxesFor } from "@/lib/ia/uzume/venue-placement";
import type { DesignMaterialEstimate } from "@/lib/materiales/estimacion";
import { planBlueprint } from "@/lib/plan/blueprint";
import { planResueltoDesdePython } from "@/lib/plan/python-mapper";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { cajasDeEstructuras } from "@/lib/plan/ubicaciones";
import { resolverProductosParaGeneracion } from "@/lib/rag/generate-products";
import type { Brief, Producto } from "@/lib/types";

export type CuerpoGenerateGuardado = {
  brief?: Brief;
  solicitudUsuario?: string;
  creatividad?: number;
  blueprint?: unknown;
  plan?: { original_request?: unknown };
};

export type RespuestaResolvePython = { plan_resuelto: unknown; material_estimate: DesignMaterialEstimate };

export type CaptionReproducido = {
  prompt: string;
  sceneSpec: SceneSpec;
  planResuelto: PlanResuelto;
  preflight: ReturnType<typeof preflightFluxPrompt>;
  /** Lo que recibe `compileProductPrompt`, para guardarlo como fixture. */
  entrada: Omit<Parameters<typeof compileProductPrompt>[0], "maxLength">;
};

type LineaPython = { product_id: string; variant_id: string; sku: string | null; titulo: string; color: string | null; tamano_codigo: string | null; forma: string | null; diam_pulg: number | null };

/** Las filas que la consulta de `resolverVariantesRagParaGeneracion` devolvería, desde las líneas de Python. */
function filasDeLineas(plan: PlanResuelto): Array<Record<string, unknown>> {
  const paquete = new Map(plan.compras.map((compra) => [compra.variant_id, compra.unidades_paquete] as const));
  const filas = new Map<string, Record<string, unknown>>();
  for (const linea of plan.estructuras.flatMap((estructura) => estructura.lineas as unknown as LineaPython[])) {
    if (filas.has(linea.variant_id)) continue;
    const [producto, variante] = linea.titulo.split(" — ");
    filas.set(linea.variant_id, {
      product_id: linea.product_id,
      variant_id: linea.variant_id,
      sku: linea.sku,
      producto_titulo: producto ?? linea.titulo,
      variante_titulo: variante ?? null,
      precio: 1000,
      imagen_principal: null,
      producto_tipo: null,
      categoria: "globos",
      colores_producto: linea.color ? [linea.color] : [],
      colores_variante: linea.color ? [linea.color] : [],
      descripcion: null,
      unidades_paq: paquete.get(linea.variant_id) ?? null,
      codigo_tamano: linea.tamano_codigo,
      forma: linea.forma,
      diam_pulg: linea.diam_pulg,
    });
  }
  return [...filas.values()];
}

function aplicarDecisiones(blueprint: ReferenceBlueprintV2, validos: ReadonlySet<string>): ReferenceBlueprintV2 {
  // Copia de `applyAutomaticDecisions` (route.ts, no exportable desde un módulo de ruta).
  return ReferenceBlueprintV2Schema.parse({
    ...blueprint,
    elements: blueprint.elements.map((element) => {
      const decision = element.model_decision;
      const catalogProductId = decision?.catalog_product_id && validos.has(decision.catalog_product_id) ? decision.catalog_product_id : undefined;
      const billOfMaterials = decision?.bill_of_materials?.filter((line) => validos.has(line.catalog_product_id));
      const include = Boolean(decision?.action === "include" && (catalogProductId || billOfMaterials?.length));
      return {
        ...element,
        approved: include,
        include_policy: include ? "include" as const : "exclude" as const,
        source_type: catalogProductId || billOfMaterials?.length ? "catalog_backed" as const : "reference_only" as const,
        model_decision: decision
          ? { ...decision, catalog_product_id: catalogProductId, match_type: catalogProductId ? decision.match_type : "none" as const, bill_of_materials: billOfMaterials?.length ? billOfMaterials : undefined }
          : { action: "omit" as const, match_type: "none" as const, reason: "No automatic model decision supplied; element omitted.", adaptation: "Omitir elemento." },
      };
    }),
    unresolved_decisions: [],
  });
}

export async function captionDeCuerpoGenerate(cuerpo: CuerpoGenerateGuardado, python: RespuestaResolvePython, maxLength?: number): Promise<CaptionReproducido> {
  // Validado como en el adaptador de Python: un registro que ya no cumple el contrato falla aquí, no a medias.
  const planResuelto = planResueltoDesdePython(PlanResueltoV1Schema.parse(python.plan_resuelto));
  const materialEstimate = python.material_estimate;
  const filas = filasDeLineas(planResuelto);
  const pool = { query: async () => ({ rows: filas }) } as unknown as Pool;
  const { productos: base } = await resolverProductosParaGeneracion({ ragVariantIds: filas.map((fila) => String(fila.variant_id)) }, pool);
  const productos: Producto[] = base.map((producto) => {
    const compra = planResuelto.compras.find((item) => item.variant_id === producto.id);
    return compra ? { ...producto, paquetes: compra.paquetes, unidadesPaquete: compra.unidades_paquete } : producto;
  });
  const referencia = cuerpo.blueprint === undefined ? undefined : ReferenceBlueprintV2Schema.safeParse(cuerpo.blueprint);
  const aspecto = aspectoDeLaReferencia(referencia?.success ? referencia.data : undefined) ?? "3:2";
  const blueprint = aplicarDecisiones(planBlueprint(planResuelto), new Set(productos.map((producto) => producto.id)));
  const materializados = new Set<string>([
    ...blueprint.elements.map((element) => element.element_id),
    ...planResuelto.plan.estructuras.map((estructura) => estructura.referencia_element_id).filter((id): id is string => Boolean(id)),
  ]);
  const escenografia = applySceneryVisibility(referencia?.success ? sceneryFromReference(referencia.data, new Set([...materializados, ...elementosMaterializados(referencia.data, planResuelto.plan.estructuras)])) : [], undefined)
    .filter((item) => item.visible);
  const catalogProducts = Object.fromEntries(blueprint.elements.filter((element) => element.source_type === "catalog_backed").map((element) => {
    const lineas = element.model_decision?.bill_of_materials ?? [];
    const materiales = lineas.flatMap((linea) => {
      const producto = productos.find((candidato) => candidato.id === linea.catalog_product_id);
      return producto ? [{ id: producto.id, name: producto.nombre, description: producto.descripcion, category: producto.categoria, colors: producto.colores, unitsPerPackage: producto.unidadesPaquete, packageCount: producto.paquetes, installedUnits: Math.max(0, Math.round((unidadesMaterialDeElemento(element) ?? 0) * linea.share)), share: linea.share, role: linea.role }] : [];
    });
    return [element.element_id, materiales] as const;
  }).filter(([, materiales]) => materiales.length > 0));
  const cajas = Object.fromEntries(Object.entries(cajasDeEstructuras(planResuelto.plan.estructuras)).map(([id, layout]) => [id, layout.bbox]));
  const sceneSpec = buildApprovedSceneSpec({
    blueprint,
    aspectRatio: aspecto,
    targetBoxes: targetBoxesFor(blueprint, cajas, false, undefined),
    eventPalette: cuerpo.brief?.colores,
    catalogProducts,
    materialEstimate,
    generationMode: "text_to_image",
    createdBy: "server_default",
    planHash: planResuelto.plan_hash,
    catalogOnly: true,
    scenography: escenografia.map((item) => ({ element_id: item.elementId, name: item.name, category: item.category, target_bbox: item.bbox, depth_layer: item.depthLayer })),
  });
  const transformacion = resolveAspectTransform(aspecto, { exactAspectRatios: ["3:2", "1:1", "2:3", "16:9"], totalInputImageLimit: 0, objectFidelityInputLimit: 0, highFidelityInputSupport: false, multiTurnSupport: false });
  const escena = SceneSpecSchema.parse({ ...sceneSpec, canvas: { ...sceneSpec.canvas, content_rect: transformacion.contentRect } });
  const creatividad = perfilCreatividad(nivelCreatividadParaGenerar(undefined, cuerpo.creatividad));
  const solicitud = typeof cuerpo.plan?.original_request === "string" ? cuerpo.plan.original_request : cuerpo.solicitudUsuario;
  const visualContext = buildVisualContext({
    brief: completarEscenaConPlan({ brief: cuerpo.brief, userRequest: solicitud, plan: planResuelto.plan, nivel: creatividad.nivel, fotoEspacio: false }),
    userRequest: solicitud,
  });
  const productIdAliases = new Map<string, string[]>();
  const productCatalogTitles = new Map<string, string>();
  for (const producto of productos) {
    const alias = aliasesDeProducto(producto);
    if (alias.length) productIdAliases.set(producto.id, alias);
    const titulo = producto.catalogProductTitle?.trim();
    if (titulo) {
      productCatalogTitles.set(producto.id, titulo);
      if (producto.familiaId) productCatalogTitles.set(producto.familiaId, titulo);
    }
  }
  const entrada = {
    sceneSpec: escena,
    visualContext,
    sizeConfirmations: sizeConfirmationsFromMaterialLines(materialEstimate.balloons, productos),
    productIdAliases,
    productCatalogTitles,
    ambientDecor: escenografia.map((item) => item.name).slice(0, 3),
    creativeCues: creatividad.pistasPrompt,
    officialStructures: new Map(planResuelto.plan.estructuras.flatMap((estructura) => estructura.estructura_oficial ? [[estructura.estructura_id, estructura.estructura_oficial] as const] : [])),
    colorPatterns: frasesDeEstructuras(planResuelto),
    // Como /api/generate: el entorno del evento, con el nivel con que se genera y la escenografía de la foto.
    entorno: entornoDeEscena({ contexto: visualContext, nivel: creatividad.nivel, modo: escena.generation_mode, conEscenografiaDeFoto: escenografia.length > 0 }),
  };
  const compilacion = compileProductPrompt({ ...entrada, maxLength });
  return {
    prompt: compilacion.prompt,
    sceneSpec: escena,
    planResuelto,
    preflight: preflightFluxPrompt({ sceneSpec: escena, clauses: compilacion.clauses, prompt: compilacion.prompt }),
    entrada,
  };
}
