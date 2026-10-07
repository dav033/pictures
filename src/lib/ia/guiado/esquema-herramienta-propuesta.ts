import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";

export type AlcancePropuesta = "completa" | "individual";

/**
 * Ajusta el contrato de la herramienta al alcance que el cliente ya eligió. En la decoración completa caben piezas iguales
 * («dos columnas y un arco»), hasta 4 de cada una, y el plan las arma como piezas individuales («Columna izquierda» y
 * «Columna derecha»); en la pieza individual, exactamente una. Con `piezaPedida` la estructura queda fijada a la que el
 * cliente tocó.
 */
export function esquemaHerramientaPropuesta(base: Record<string, unknown>, alcance: AlcancePropuesta, piezaPedida?: EstructuraOficialId): Record<string, unknown> {
  const propiedades = base.properties as Record<string, unknown>;
  const piezas = propiedades.piezas as Record<string, unknown>;
  const items = piezas.items as Record<string, unknown>;
  const propiedadesItem = items.properties as Record<string, unknown>;
  const min = alcance === "completa" ? 2 : 1;
  const max = alcance === "completa" ? 3 : 1;
  const descripcion = alcance === "completa"
    ? "Propón una decoración completa con 2 o 3 piezas oficiales distintas y coherentes. `cantidad` es cuántas piezas iguales lleva (hasta 4, por ejemplo dos columnas, una a cada lado): cada una se arma como una pieza propia."
    : "Propón exactamente una pieza individual del tipo que pidió el cliente, con cantidad 1.";
  const estructura = piezaPedida ? { type: "string", enum: [piezaPedida] } : propiedadesItem.estructura;
  return {
    ...base,
    properties: {
      ...propiedades,
      piezas: {
        ...piezas,
        minItems: min,
        maxItems: max,
        items: { ...items, properties: { ...propiedadesItem, ...(estructura ? { estructura } : {}), cantidad: { type: "integer", minimum: 1, maximum: alcance === "completa" ? 4 : 1 } } },
      },
    },
    description: descripcion,
  };
}
