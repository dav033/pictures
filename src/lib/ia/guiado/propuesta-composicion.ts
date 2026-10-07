import { PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { ESTRUCTURAS_OFICIALES, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
// Género gramatical de cada pieza oficial («un arco», «una columna»): uno solo para la frase y los nombres individuales.
import { FEMENINAS } from "@/lib/plan/piezas-individuales";

const PLURALES: Record<EstructuraOficialId, string> = {
  arco: "arcos", arco_asimetrico: "arcos orgánicos", arco_no_denso: "arcos no densos", semiarco: "semiarcos", semiarco_asimetrico: "semiarcos orgánicos",
  columna: "columnas", columna_asimetrica: "columnas orgánicas", columna_no_densa: "columnas no densas", pared_densa: "paredes de globos densas", pared_no_densa: "paredes de globos no densas", pared_organica: "paredes orgánicas",
  guirnalda: "guirnaldas", centro_mesa: "centros de mesa con globos", bouquet: "bouquets de globos", figura: "figuras con globos", aro_circular: "aros circulares", techo_globos: "techos de globos", racimo_pared: "racimos de pared",
};

const CANTIDADES_EN_PALABRAS = ["", "", "dos", "tres", "cuatro"] as const;

/** «a», «a y b», «a, b y c». */
export function listaNatural(elementos: readonly string[]): string {
  if (elementos.length <= 1) return elementos[0] ?? "";
  return `${elementos.slice(0, -1).join(", ")} y ${elementos.at(-1)}`;
}

/** «un arco orgánico», «una columna», «dos columnas», «5 centros de mesa con globos». */
export function piezaEnPalabras(estructura: EstructuraOficialId, cantidad: number): string {
  if (cantidad <= 1) return `${FEMENINAS.has(estructura) ? "una" : "un"} ${ESTRUCTURAS_OFICIALES[estructura].nombre.toLocaleLowerCase("es")}`;
  return `${CANTIDADES_EN_PALABRAS[cantidad] ?? String(cantidad)} ${PLURALES[estructura]}`;
}

export function normalizarPropuestaComposicion(entrada: unknown) {
  const propuesta = PropuestaComposicionSchema.parse(entrada);
  const piezas = listaNatural(propuesta.piezas.map((pieza) => piezaEnPalabras(pieza.estructura, pieza.cantidad)));
  return {
    ...propuesta,
    frase: `Te propongo ${piezas} en ${listaNatural(propuesta.colores)}.`,
    piezas: propuesta.piezas.map((pieza) => ({ ...pieza, nombre: ESTRUCTURAS_OFICIALES[pieza.estructura].nombre })),
  };
}
