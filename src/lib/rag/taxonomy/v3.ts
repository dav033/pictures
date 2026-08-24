import { z } from "zod";

/**
 * Taxonomía V3 de escena (PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md §8.1 y
 * §5.3, Tarea 02.2). Esto NO reemplaza `taxonomy/v2.ts` — ese archivo sigue
 * siendo la taxonomía de ingestión/normalización del catálogo Shopify
 * (`CatalogProduct.derived.category`, colores, ocasiones, etc.), hard data
 * derivada de forma determinística en `catalog/normalize.ts`.
 *
 * V3 agrega dos vocabularios nuevos, pensados para armar escenas de boda
 * completas, no solo para clasificar un producto:
 *
 * 1. `SceneCategoryV3` — familia física mínima de un activo de escena
 *    (§8.1). Es más amplia que `CATEGORIAS_CATALOGO_V2`: incluye familias
 *    que HOY no tienen ninguna oferta comercial verificada en el catálogo
 *    activo (mobiliario, floristería, iluminación) para que el esquema
 *    pueda expresarlas en cuanto existan fuentes reales, en vez de caer en
 *    una categoría genérica "other".
 * 2. `SceneFunctionV3` — función que un activo cumple DENTRO de una escena
 *    (§5.3). Ver el comentario sobre relación muchos-a-muchos más abajo.
 *
 * `TAXONOMY_V3_VERSION` permite invalidar índices/caché derivados si el
 * vocabulario cambia.
 */

export const TAXONOMY_V3_VERSION = "scene-taxonomy-v3" as const;

/**
 * Familias mínimas de activos de escena (plan §8.1). Un `CatalogItemV3.
 * category_v3` es siempre exactamente uno de estos valores: es la identidad
 * física del objeto, no su rol en una escena particular.
 */
export const SCENE_CATEGORIES_V3 = [
  "balloon_material",
  "balloon_structure",
  "backdrop_surface",
  "altar_frame",
  "floral_foliage",
  "aisle_decor",
  "ambient_lighting",
  "floor_lighting",
  "furniture",
  "linen",
  "table_setting",
  "centerpiece",
  "signage",
  "plinth_pedestal",
  "service_support",
] as const;

export const SceneCategoryV3Schema = z.enum(SCENE_CATEGORIES_V3);
export type SceneCategoryV3 = z.infer<typeof SceneCategoryV3Schema>;

/**
 * Funciones de escena iniciales (plan §5.3). Una función describe QUÉ ROL
 * cumple un objeto dentro de un programa de escena (`SceneSlot.function` en
 * `src/lib/scene/tipos.ts`), no su categoría física.
 *
 * IMPORTANTE — relación muchos-a-muchos, no jerarquía 1:1 con
 * `SceneCategoryV3`: un mismo objeto físico puede cumplir varias funciones
 * según el slot que llene, y una misma función puede cubrirse con objetos de
 * categorías físicas distintas. Ejemplos explícitos del plan:
 *   - una cortina (`backdrop_surface`) puede servir como `focal_backdrop` o
 *     como fondo de `photo_moment`;
 *   - un farol (`floor_lighting` o `ambient_lighting`) puede servir como
 *     `aisle_marker` o como `floor_light`.
 * `CatalogItemV3.scene_functions` por eso es un ARRAY de candidatas con
 * confianza y evidencia (ver `scene-asset-schema.ts`), nunca un único valor.
 */
export const SCENE_FUNCTIONS_V3 = [
  "altar_frame",
  "focal_backdrop",
  "focal_decor",
  "floral_foliage_accent",
  "balloon_accent",
  "aisle_runner",
  "aisle_marker",
  "guest_chair",
  "table_surface",
  "linen",
  "table_setting",
  "centerpiece",
  "ambient_light",
  "floor_light",
  "welcome_signage",
  "plinth_pedestal",
  "service_support",
] as const;

export const SceneFunctionV3Schema = z.enum(SCENE_FUNCTIONS_V3);
export type SceneFunctionV3 = z.infer<typeof SceneFunctionV3Schema>;
