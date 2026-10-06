import { medirDominanciaColor, medirDominanciaElemento, type MuestraPixeles } from "@/lib/plan/dominancia-color";
import { decodificarPixeles, proporcionDeImagen } from "./decodificar-pixeles";
import { mezclaVerticalMedida, ordenDesdeElPie } from "./orden-color-pie";
import { equilibrarMuestra } from "@/lib/plan/balance-blancos";
import { coloresNombradosReferencia } from "@/lib/plan/colores-referencia";
import { zonaDeCroquis } from "@/lib/plan/croquis-zona";
import type { ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import type { ImagenEtiquetada } from "@/lib/ia/nucleo/tipos";

/**
 * Rellena `appearance.measured_colors` con los tonos nombrados, medidos dentro
 * del croquis de la pieza para excluir fondo, reflejos y sombras como colores nuevos.
 *
 * Va aquí y no dentro de `buildBlueprint` porque decodificar imágenes es
 * asíncrono y toca `sharp`, mientras que el ensamblaje del blueprint es
 * síncrono y no depende de nada externo. Separarlos mantiene `buildBlueprint`
 * comprobable sin píxeles.
 *
 * Nunca falla el análisis: si una imagen no se puede decodificar, ese elemento
 * se queda sin medida y el camino de color vuelve a las etiquetas del
 * analizador, que es lo que hacía antes. Una medida ausente es peor que una
 * medida, pero mucho mejor que un análisis caído.
 */
/**
 * Anota en `source_images[].aspect_ratio` la proporción de cada foto: las cajas son fracciones de ella y la guía
 * de escena la necesita para no estirarlas sobre un lienzo de otra forma. Como la dominancia, nunca tumba el
 * análisis: una foto que no se lee se queda sin proporción y la guía usa la de su lienzo, como antes.
 */
export async function conProporcionDeFotos(blueprint: ReferenceBlueprintV2, imagenes: readonly ImagenEtiquetada[]): Promise<ReferenceBlueprintV2> {
  const proporciones = new Map<string, number>();
  for (const imagen of imagenes) {
    try {
      const proporcion = await proporcionDeImagen(Buffer.from(imagen.base64, "base64"));
      if (proporcion !== undefined && proporcion >= 0.1 && proporcion <= 10) proporciones.set(imagen.id, Number(proporcion.toFixed(4)));
    } catch (error) {
      console.warn("[proporcion] no se pudo leer una referencia", { image_id: imagen.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (proporciones.size === 0) return blueprint;
  return {
    ...blueprint,
    source_images: blueprint.source_images.map((imagen) => {
      const proporcion = proporciones.get(imagen.image_id);
      return proporcion === undefined ? imagen : { ...imagen, aspect_ratio: proporcion };
    }),
  };
}

/**
 * Los píxeles de una foto en luz blanca (`balance-blancos.ts`): con luz de color, lo que el analizador vio blanco
 * fija la corrección. Sin blanco fiable, la foto tal cual. La corrección aplicada queda en el registro.
 */
async function muestraEnLuzBlanca(imagen: ImagenEtiquetada, blueprint: ReferenceBlueprintV2): Promise<MuestraPixeles> {
  const { muestra, ganancias } = equilibrarMuestra(await decodificarPixeles(Buffer.from(imagen.base64, "base64")), blueprint.elements, imagen.id);
  if (ganancias) console.info("[balance-blancos] foto corregida", { image_id: imagen.id, ganancias: ganancias.map((g) => Number(g.toFixed(3))) });
  return muestra;
}

export async function enriquecerConDominancia(blueprint: ReferenceBlueprintV2, imagenes: readonly ImagenEtiquetada[]): Promise<ReferenceBlueprintV2> {
  const porImagen = new Map<string, MuestraPixeles>();
  for (const imagen of imagenes) {
    // Una sola decodificación por foto aunque tenga ocho elementos.
    if (porImagen.has(imagen.id)) continue;
    try {
      porImagen.set(imagen.id, await muestraEnLuzBlanca(imagen, blueprint));
    } catch (error) {
      console.warn("[dominancia] no se pudo decodificar una referencia", { image_id: imagen.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (porImagen.size === 0) return blueprint;

  return {
    ...blueprint,
    elements: blueprint.elements.map((elemento) => {
      const muestra = porImagen.get(elemento.source_image_id);
      if (!muestra) return elemento;
      const coloresAdmitidos = [...new Set(coloresNombradosReferencia(elemento.appearance)
        .map((color) => color.color)
        .filter((color) => color !== "transparente"))];
      if (coloresAdmitidos.length === 0) return elemento;
      const croquis = zonaDeCroquis(
        elemento.visual_semantics?.structure_type ?? "",
        undefined,
        elemento.visual_semantics?.placement,
        elemento.reference_bbox.width / elemento.reference_bbox.height,
      );
      const medicion = medirDominanciaElemento(muestra, elemento.reference_bbox, coloresAdmitidos, croquis.dentro);
      if (medicion.dominantes.length === 0) return elemento;
      return {
        ...elemento,
        appearance: {
          ...elemento.appearance,
          measured_colors: medicion.dominantes.slice(0, 12).map((entrada) => ({ color: entrada.color, share: Number(entrada.participacion.toFixed(4)) })),
        },
      };
    }),
  };
}

/**
 * El blueprint con el `patron_color` de cada columna o semiarco ordenado del pie a la punta según los píxeles
 * (`patronDesdeElPie`). Va DESPUÉS de la lectura de la foto, que es quien trae `patron_color` y quien decide
 * columna o semiarco (`reclasificarColumnasConGuirnalda`). Como la dominancia, nunca tumba el análisis: una foto
 * que no se decodifica deja el orden que dijo el modelo. Devuelve el mismo objeto si nada cambia.
 */
export async function conColoresDesdeElPie(blueprint: ReferenceBlueprintV2, imagenes: readonly ImagenEtiquetada[]): Promise<ReferenceBlueprintV2> {
  const candidatos = blueprint.elements.some((elemento) => elemento.appearance.patron_color && TIPOS_VERTICALES.has(elemento.visual_semantics?.structure_type ?? ""));
  if (!candidatos) return blueprint;
  const porImagen = new Map<string, MuestraPixeles>();
  for (const imagen of imagenes) {
    if (porImagen.has(imagen.id)) continue;
    try {
      // Sin balance de blancos, a propósito: el orden compara la franja de abajo con la de arriba, y con la foto
      // corregida el fondo que asoma entre los globos (una pared blanca) se mide gris como la plata y borra la
      // señal (CASE-002: el orden volvió al del modelo, rosa abajo). La identidad del color sí va corregida.
      porImagen.set(imagen.id, await decodificarPixeles(Buffer.from(imagen.base64, "base64")));
    } catch (error) {
      console.warn("[orden-color] no se pudo decodificar una referencia", { image_id: imagen.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  let cambio = false;
  const elements = blueprint.elements.map((elemento) => {
    const muestra = porImagen.get(elemento.source_image_id);
    const nuevo = muestra ? patronDesdeElPie(elemento, muestra) : {};
    if (!nuevo.patron_color) return elemento;
    cambio = true;
    return { ...elemento, appearance: { ...elemento.appearance, patron_color: nuevo.patron_color } };
  });
  return cambio ? { ...blueprint, elements } : blueprint;
}

const TIPOS_VERTICALES = new Set(["columna", "semiarco"]);
const MODOS_CON_ORDEN = new Set(["bloques", "degradado"]);
/** Alto de cada franja (abajo y arriba) en fracción de la caja de la pieza. */
const FRANJA = 0.35;
const BANDAS_PATRON = 5;

/**
 * El `patron_color` de una columna o un semiarco con sus colores del pie a la punta, si los píxeles lo dicen
 * claro (`ordenDesdeElPie`); vacío si no toca o no cambia nada. Los `pesos` viajan con su color.
 */
function patronDesdeElPie(elemento: ReferenceBlueprintV2["elements"][number], muestra: MuestraPixeles): { patron_color?: NonNullable<ReferenceBlueprintV2["elements"][number]["appearance"]["patron_color"]> } {
  const patron = elemento.appearance.patron_color;
  if (!patron || !TIPOS_VERTICALES.has(elemento.visual_semantics?.structure_type ?? "")) return {};
  const caja = elemento.reference_bbox;
  if (patron.modo === "bloques" && patron.colores.length > 1) {
    const franjas = Array.from({ length: BANDAS_PATRON }, (_unused, indice) => medirDominanciaColor(muestra, {
      ...caja,
      y: caja.y + (caja.height * indice) / BANDAS_PATRON,
      height: caja.height / BANDAS_PATRON,
    }).dominantes);
    if (mezclaVerticalMedida(patron.colores, franjas)) {
      return { patron_color: { ...patron, modo: "aleatorio" } };
    }
  }
  if (!MODOS_CON_ORDEN.has(patron.modo)) return {};
  const abajo = medirDominanciaColor(muestra, { ...caja, y: caja.y + caja.height * (1 - FRANJA), height: caja.height * FRANJA }).dominantes;
  const arriba = medirDominanciaColor(muestra, { ...caja, height: caja.height * FRANJA }).dominantes;
  const orden = ordenDesdeElPie(patron.colores, abajo, arriba);
  if (!orden) return {};
  const pesos = patron.pesos?.length === patron.colores.length ? { pesos: orden.map((indice) => patron.pesos![indice]!) } : {};
  return { patron_color: { ...patron, colores: orden.map((indice) => patron.colores[indice]!), ...pesos } };
}
