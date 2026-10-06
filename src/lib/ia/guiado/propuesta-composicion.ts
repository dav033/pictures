import { PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { ESTRUCTURAS_OFICIALES } from "@/lib/plan/estructuras-oficiales";

export function normalizarPropuestaComposicion(entrada: unknown) {
  const propuesta = PropuestaComposicionSchema.parse(entrada);
  const nombres = propuesta.piezas.map((pieza) => {
    const singular = ESTRUCTURAS_OFICIALES[pieza.estructura].nombre.toLocaleLowerCase("es");
    const plural = pieza.cantidad === 1 ? singular : ({
      arco: "arcos", arco_asimetrico: "arcos orgánicos", arco_no_denso: "arcos ligeros", semiarco: "semiarcos", semiarco_asimetrico: "semiarcos orgánicos",
      columna: "columnas", columna_asimetrica: "columnas orgánicas", columna_no_densa: "columnas ligeras", pared_densa: "paredes densas", pared_no_densa: "paredes ligeras", pared_organica: "paredes orgánicas",
      guirnalda: "guirnaldas", centro_mesa: "centros de mesa", bouquet: "bouquets", figura: "figuras con globos", aro_circular: "aros circulares", techo_globos: "techos de globos", racimo_pared: "racimos de pared",
    } as const)[pieza.estructura];
    return `${pieza.cantidad > 1 ? pieza.cantidad + " " : ""}${plural}`;
  });
  return {
    ...propuesta,
    frase: `Te propongo ${nombres.join(" y ")}, en ${propuesta.colores.join(", ")}.`,
    piezas: propuesta.piezas.map((pieza) => ({ ...pieza, nombre: ESTRUCTURAS_OFICIALES[pieza.estructura].nombre })),
  };
}
