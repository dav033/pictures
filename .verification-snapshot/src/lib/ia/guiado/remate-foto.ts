import type { ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";

/**
 * «Armarlo sin el remate grande», la salida de un plan de foto que no converge (comparador clásica-guiada,
 * 2026-10-06, ej04): la lectura leyó un globo de remate dorado sobre la columna, Python lo arma con un 36" que no
 * existe en Reflex Dorado y rechazaba el plan una y otra vez. El remate se lee de la foto y no se puede quitar desde
 * el plan; aquí se quita de la lectura con que se pide el plan (la lectura guardada del mensaje no cambia).
 *
 * `{ tipo: "ninguno" }` y no borrar el campo: ausente es «no se ve la punta» y el motor pondría su propio remate
 * (`RemateLeidoSchema`). Un racimo no es un remate grande y se queda. Puro e importable desde el navegador.
 */
const REMATES_GRANDES: ReadonlySet<string> = new Set(["globo", "estrella", "corazon"]);

type ElementoConRemate = ReferenceBlueprintV2["elements"][number];

function remateGrande(elemento: ElementoConRemate): boolean {
  const columna = elemento.appearance.remate_columna;
  return Boolean(columna && REMATES_GRANDES.has(columna.tipo)) || Boolean(elemento.appearance.armado_guirnalda?.remates.length);
}

/** Si alguna pieza de globos aprobada de la lectura lleva un remate grande (globo, estrella, corazón o los de una guirnalda). */
export function tieneRemateGrande(blueprint: ReferenceBlueprintV2): boolean {
  return blueprint.elements.some((elemento) => elemento.approved && remateGrande(elemento));
}

/** La misma lectura sin los remates grandes. */
export function lecturaSinRemateGrande(blueprint: ReferenceBlueprintV2): ReferenceBlueprintV2 {
  return {
    ...blueprint,
    elements: blueprint.elements.map((elemento) => {
      if (!remateGrande(elemento)) return elemento;
      const { appearance } = elemento;
      return {
        ...elemento,
        appearance: {
          ...appearance,
          ...(appearance.remate_columna && REMATES_GRANDES.has(appearance.remate_columna.tipo) ? { remate_columna: { tipo: "ninguno" as const } } : {}),
          ...(appearance.armado_guirnalda?.remates.length ? { armado_guirnalda: { ...appearance.armado_guirnalda, remates: [] } } : {}),
        },
      };
    }),
  };
}
