export type AlcancePropuesta = "completa" | "individual";

/** Ajusta contrato de herramienta al alcance que cliente ya eligió. */
export function esquemaHerramientaPropuesta(base: Record<string, unknown>, alcance: AlcancePropuesta): Record<string, unknown> {
  const propiedades = base.properties as Record<string, unknown>;
  const piezas = propiedades.piezas as Record<string, unknown>;
  const items = piezas.items as Record<string, unknown>;
  const min = alcance === "completa" ? 2 : 1;
  const max = alcance === "completa" ? 3 : 1;
  const descripcion = alcance === "completa"
    ? "Propón una decoración completa con 2 o 3 piezas oficiales distintas y coherentes."
    : "Propón exactamente una pieza individual del tipo que pidió el cliente, con cantidad 1.";
  return {
    ...base,
    properties: {
      ...propiedades,
      piezas: {
        ...piezas,
        minItems: min,
        maxItems: max,
        items: { ...items, properties: { ...(items.properties as Record<string, unknown>), cantidad: { type: "integer", minimum: 1, maximum: 1 } } },
      },
    },
    description: descripcion,
  };
}
