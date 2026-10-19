/**
 * Dueño único de `mensaje_cliente` en los resultados de herramientas del chat.
 *
 * Los resultados de herramientas llevan dos capas: `status`, `errores` y
 * `accion_requerida` son instrucciones técnicas para que el modelo corrija el
 * plan; `mensaje_cliente` es la única explicación que el modelo puede
 * trasladar al cliente, en sus palabras. Estos textos no llevan códigos, IDs,
 * SKU ni nombres de herramientas (verificado con `detectarJergaInterna`).
 */

const FORMATO_COP = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

function cop(valor: number): string {
  return FORMATO_COP.format(Math.round(valor));
}

function unirNatural(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

/**
 * "Arco orgánico principal" → "arco orgánico principal". Sin artículo: el
 * nombre lo escribe el modelo y el género o número no se puede deducir.
 */
function nombreEstructura(nombre: string | undefined): string {
  const limpio = nombre?.trim().replace(/\s*\(.*\)$/, "");
  if (!limpio) return "una de las decoraciones";
  return `${limpio.charAt(0).toLowerCase()}${limpio.slice(1)}`;
}

export const MENSAJE_CLIENTE_PLAN_EN_AJUSTE = "Todavía estoy ajustando la propuesta; en un momento te la muestro.";
export const MENSAJE_CLIENTE_SIN_GLOBOS = "Todavía estoy ajustando la propuesta para incluir globos en los colores que pediste.";
export const MENSAJE_CLIENTE_REFERENCIA = "Todavía estoy ajustando la propuesta para incluir cada elemento de tu foto de referencia.";
export const MENSAJE_CLIENTE_PIEZAS = "Todavía estoy ajustando las piezas de la propuesta.";
export const MENSAJE_CLIENTE_ESTIMACION = "Las cantidades todavía no cuadran con el tamaño de la decoración; estoy ajustando la propuesta.";
export const MENSAJE_CLIENTE_SIN_BUSQUEDA = "Primero busco las piezas en el catálogo y enseguida te armo la propuesta.";
// Retirado: era un segundo dueño del texto de fallo técnico, fuera del gobierno de
// `ui-error.v1`, y el prompt autoriza parafrasearlo. Ese fallo ahora corta el turno
// (fallo-tecnico-turno.ts) y el texto lo emite el catálogo de `ui-error.v1`.
export const MENSAJE_CLIENTE_CATALOGO_NO_DISPONIBLE = "En este momento no puedo mostrarte el catálogo por un problema técnico temporal. Puedes seguir contándome los detalles de tu evento.";

/** Los `errores` de restricciones ya vienen redactados para el cliente (src/lib/plan/restricciones.ts). */
export function mensajeClienteRestricciones(errores: string[]): string {
  return errores.length
    ? `Todavía estoy ajustando la propuesta para que respete lo que pediste. ${errores.join(" ")}`
    : MENSAJE_CLIENTE_PLAN_EN_AJUSTE;
}

/** "R-12" → "12"; un código sin número no se muestra al cliente. */
function pulgadas(tamano: string): string | null {
  return /(\d+(?:[.,]\d+)?)/.exec(tamano)?.[1] ?? null;
}

export function mensajeClienteSinCobertura(
  faltantes: ReadonlyArray<{ estructura_id: string; tamano: string }>,
  nombres: ReadonlyMap<string, string>,
): string {
  const porEstructura = new Map<string, Set<string>>();
  for (const faltante of faltantes) {
    const tamanos = porEstructura.get(faltante.estructura_id) ?? new Set<string>();
    const valor = pulgadas(faltante.tamano);
    if (valor) tamanos.add(valor);
    porEstructura.set(faltante.estructura_id, tamanos);
  }
  const partes = [...porEstructura.entries()].map(([estructuraId, tamanos]) => {
    const lista = [...tamanos].sort((a, b) => Number(a) - Number(b));
    const medida = lista.length ? `globos de ${unirNatural(lista)} pulgadas` : "algunos tamaños de globo";
    return `${medida} para ${nombreEstructura(nombres.get(estructuraId))}`;
  });
  return partes.length
    ? `No encontré en el catálogo ${unirNatural(partes)} en los colores elegidos. Estoy buscando una alternativa.`
    : "No encontré en el catálogo todas las piezas de la propuesta. Estoy buscando una alternativa.";
}

export function mensajeClientePresupuesto(totalCop: number, techoCop: number | null | undefined, deltaCop: number | null | undefined): string {
  if (techoCop == null) return `La propuesta cuesta ${cop(totalCop)} y supera tu presupuesto. Estoy buscando una versión que quepa.`;
  const exceso = deltaCop ?? totalCop - techoCop;
  return `La propuesta cuesta ${cop(totalCop)} y supera tu presupuesto de ${cop(techoCop)} por ${cop(exceso)}. Estoy buscando una versión que quepa.`;
}
