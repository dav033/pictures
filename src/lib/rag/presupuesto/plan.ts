import { CATEGORIAS_RELAJACION_POR_ROL, ROLES_PRESUPUESTO, techoEfectivo, type Franja, type RolPresupuesto } from "./franjas";

export type CuotaPlan = {
  rol: RolPresupuesto;
  min: number;
  max: number;
  /** Precio máximo en COP para UNA variante de este rol. */
  topeCop: number;
  categorias: readonly string[];
  categoriasRelajacion: readonly string[];
};

export type PlanCanasta = {
  franjaSlug: Franja["slug"];
  techoCop: number;
  utilizacionMinCop: number;
  utilizacionMaxCop: number;
  piezasMin: number;
  piezasMax: number;
  roles: CuotaPlan[];
  /** Deseos del cliente que la receta de esta franja no puede cumplir —
   * nunca se resuelven en silencio, se le dicen al asistente para que se lo
   * diga al cliente (§3, Etapa 1). */
  conflictos: string[];
};

export type IntencionParcial = {
  /** Categorías que el cliente pidió como filtro duro (ej. del query
   * parser) — se usa sólo para detectar conflictos con la receta, no para
   * filtrar candidatos (eso lo hace el retrieval por rol). */
  categoriasPedidas?: string[];
};

/**
 * Traduce una franja a un plan de canasta concreto en pesos — función pura,
 * sin I/O, testeable con una tabla de casos (§3, Etapa 1). El plan es lo que
 * el retrieval por rol y el ensamblaje consumen; el LLM nunca lo construye.
 */
export function planificarCanasta(franja: Franja, intencion: IntencionParcial = {}, cifraCliente?: number): PlanCanasta {
  const techoCop = techoEfectivo(franja, cifraCliente);

  const roles: CuotaPlan[] = ROLES_PRESUPUESTO.map((rol) => {
    const receta = franja.recetas[rol];
    return {
      rol,
      min: receta.min,
      max: receta.max,
      topeCop: Math.round(techoCop * receta.topeFraccion),
      categorias: receta.categorias,
      categoriasRelajacion: CATEGORIAS_RELAJACION_POR_ROL[rol],
    };
  });

  const conflictos: string[] = [];
  const categoriasCubiertas = new Set(roles.flatMap((r) => r.categorias));
  for (const categoria of intencion.categoriasPedidas ?? []) {
    const rolQueLaOfrece = roles.find((r) => r.categorias.includes(categoria) && r.max > 0);
    if (!rolQueLaOfrece && !categoriasCubiertas.has(categoria)) {
      conflictos.push(
        `categoria_inalcanzable:${categoria}` +
          ` — la franja "${franja.nombre}" no incluye esta categoría en su receta (techo $${techoCop.toLocaleString("es-CO")})`,
      );
    }
  }

  return {
    franjaSlug: franja.slug,
    techoCop,
    utilizacionMinCop: Math.round(techoCop * franja.utilizacionMin),
    utilizacionMaxCop: Math.round(techoCop * franja.utilizacionMax),
    piezasMin: franja.piezasMin,
    piezasMax: franja.piezasMax,
    conflictos,
    roles,
  };
}
