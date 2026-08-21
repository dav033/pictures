/**
 * 4 franjas de presupuesto (plan PLAN_RAG_FRANJAS_PRESUPUESTO.md §2). Cada
 * franja es un contrato de composición, no un filtro de precio: define qué
 * roles debe tener la decoración, cuántas piezas de cada uno, y qué
 * fracción del techo puede costar una sola pieza de ese rol.
 *
 * Fuente de verdad en código (§2.5): las cuotas son invariantes de negocio
 * que se testean contra el inventario real, no un dato que deba poder
 * cambiar sin pasar por code review. `presupuesto_franjas` (migración 005)
 * sólo puede sobreescribir rangos y fracciones desde el admin — nunca la
 * existencia de las 4 franjas ni de los 5 roles.
 */

export const ROLES_PRESUPUESTO = ["focal", "soporte", "relleno", "acento", "servicio"] as const;
export type RolPresupuesto = (typeof ROLES_PRESUPUESTO)[number];

export const FRANJA_SLUGS = ["detalle", "focal", "escena", "escena_completa"] as const;
export type FranjaSlug = (typeof FRANJA_SLUGS)[number];

export type CuotaRol = {
  /** Piezas mínimas de este rol — 0 si el rol no aplica en esta franja. */
  min: number;
  max: number;
  /** Fracción del techo de la franja que como máximo puede costar UNA
   * variante de este rol (§2.3) — se evalúa contra el precio real de la
   * variante, no del producto. */
  topeFraccion: number;
  /** Categorías de `derivarCategoria()` (ver shopify/derivar.ts) elegibles
   * para este rol en esta franja. */
  categorias: readonly string[];
};

export type Franja = {
  slug: FranjaSlug;
  nombre: string;
  /** Rango semiabierto [minCop, maxCop). `maxCop: null` = sin techo. */
  minCop: number;
  maxCop: number | null;
  piezasMin: number;
  piezasMax: number;
  /** Banda de utilización objetivo, como fracción del techo efectivo (§2.4). */
  utilizacionMin: number;
  utilizacionMax: number;
  recetas: Record<RolPresupuesto, CuotaRol>;
};

// Categorías controladas del catálogo real (shopify/derivar.ts:220), citadas
// aquí como strings literales para no crear una dependencia circular entre
// el módulo de presupuesto (puro, sin I/O) y el módulo de Shopify.
const CAT = {
  latex: "globo_latex",
  metalizado: "globo_metalizado",
  numeroLetra: "globo_numero_letra",
  guirnaldaArco: "guirnalda_arco",
  banderola: "banderola_cartel",
  vela: "vela",
  desechable: "desechable",
  empaque: "empaque",
  complemento: "complemento",
  kit: "kit",
} as const;

export const FRANJAS: Record<FranjaSlug, Franja> = {
  detalle: {
    slug: "detalle",
    nombre: "Detalle",
    minCop: 0,
    maxCop: 50_000,
    piezasMin: 2,
    piezasMax: 4,
    utilizacionMin: 0.6,
    utilizacionMax: 1.0,
    recetas: {
      // Sin arco: la mediana real de guirnalda_arco ($79.800) por sí sola ya
      // supera el techo de esta franja — prometerlo sería honestidad falsa.
      focal: { min: 0, max: 0, topeFraccion: 0, categorias: [] },
      soporte: { min: 0, max: 0, topeFraccion: 0, categorias: [] },
      relleno: { min: 1, max: 2, topeFraccion: 0.45, categorias: [CAT.latex] },
      acento: { min: 1, max: 2, topeFraccion: 0.2, categorias: [CAT.metalizado, CAT.vela] },
      servicio: { min: 0, max: 0, topeFraccion: 0, categorias: [] },
    },
  },
  focal: {
    slug: "focal",
    nombre: "Punto focal",
    minCop: 50_000,
    maxCop: 100_000,
    piezasMin: 4,
    piezasMax: 6,
    utilizacionMin: 0.75,
    utilizacionMax: 1.0,
    recetas: {
      focal: { min: 1, max: 1, topeFraccion: 0.55, categorias: [CAT.guirnaldaArco, CAT.kit, CAT.numeroLetra] },
      soporte: { min: 0, max: 1, topeFraccion: 0.2, categorias: [CAT.complemento] },
      relleno: { min: 2, max: 3, topeFraccion: 0.25, categorias: [CAT.latex] },
      acento: { min: 1, max: 2, topeFraccion: 0.12, categorias: [CAT.metalizado, CAT.vela, CAT.banderola] },
      servicio: { min: 0, max: 0, topeFraccion: 0, categorias: [] },
    },
  },
  escena: {
    slug: "escena",
    nombre: "Escena",
    minCop: 100_000,
    maxCop: 150_000,
    piezasMin: 5,
    piezasMax: 8,
    utilizacionMin: 0.75,
    utilizacionMax: 1.0,
    recetas: {
      focal: { min: 1, max: 1, topeFraccion: 0.55, categorias: [CAT.guirnaldaArco, CAT.kit, CAT.numeroLetra] },
      soporte: { min: 1, max: 1, topeFraccion: 0.25, categorias: [CAT.complemento, CAT.banderola] },
      relleno: { min: 2, max: 3, topeFraccion: 0.2, categorias: [CAT.latex] },
      acento: { min: 2, max: 3, topeFraccion: 0.1, categorias: [CAT.metalizado, CAT.vela, CAT.banderola] },
      servicio: { min: 0, max: 1, topeFraccion: 0.12, categorias: [CAT.desechable, CAT.empaque] },
    },
  },
  escena_completa: {
    slug: "escena_completa",
    nombre: "Escena completa",
    minCop: 150_000,
    maxCop: null,
    piezasMin: 7,
    piezasMax: 12,
    utilizacionMin: 0.75,
    utilizacionMax: 1.0,
    recetas: {
      focal: { min: 1, max: 2, topeFraccion: 0.45, categorias: [CAT.guirnaldaArco, CAT.kit, CAT.numeroLetra] },
      soporte: { min: 1, max: 2, topeFraccion: 0.25, categorias: [CAT.complemento, CAT.banderola] },
      relleno: { min: 3, max: 5, topeFraccion: 0.18, categorias: [CAT.latex] },
      acento: { min: 2, max: 3, topeFraccion: 0.08, categorias: [CAT.metalizado, CAT.vela, CAT.banderola] },
      servicio: { min: 0, max: 2, topeFraccion: 0.1, categorias: [CAT.desechable, CAT.empaque] },
    },
  },
};

/** Ampliación de categorías elegibles por rol para la escalera de relajación
 * (§3, paso 3) — se agregan SOLO si el pool del rol queda vacío, y siempre
 * se reporta. No están en la receta base porque diluirían la intención del
 * rol ("focal" dejaría de significar "protagonista") si se ofrecieran desde
 * el principio. */
export const CATEGORIAS_RELAJACION_POR_ROL: Record<RolPresupuesto, readonly string[]> = {
  focal: [],
  soporte: [CAT.banderola],
  relleno: [],
  acento: [CAT.desechable],
  servicio: [CAT.complemento],
};

/**
 * Techo efectivo en pesos contra el que se calculan topes y utilización.
 * Para franjas sin techo (`escena_completa`) usa la cifra que el cliente dio
 * (si dio una) o el mínimo de la franja — nunca inventa un número mayor sin
 * que el cliente lo haya dicho.
 */
export function techoEfectivo(franja: Franja, cifraCliente?: number): number {
  if (franja.maxCop != null) return franja.maxCop;
  return Math.max(franja.minCop, cifraCliente ?? franja.minCop);
}

/** Tope de seguridad (§2.4): pasarse de esto en `escena_completa` exige
 * decírselo al cliente explícitamente, nunca en silencio. */
export function techoSeguridad(franja: Franja, cifraCliente?: number): number {
  return techoEfectivo(franja, cifraCliente) * 1.6;
}
