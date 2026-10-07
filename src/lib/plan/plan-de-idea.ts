import { z } from "zod";
import { MAX_PIEZAS_PLAN, nombrarPiezasIndividuales, separarEstructurasRepetidas } from "./piezas-individuales";
import { PlanDecoracionSchema, type EstructuraPlan, type PlanDecoracion } from "./tipos";

/**
 * El plan de una idea de la biblioteca, EXACTO: sus piezas, medidas, armados, productos Sempertex y tamaños, tal como
 * los resolvió Python al construir la biblioteca (`data/biblioteca-real/analisis/*.plan.json`, precalculados en
 * `src/lib/biblioteca-sempertex/planes-ideas.json` por `scripts/biblioteca/precomputar-planes-ideas.ts`).
 *
 * Por qué existe (verificador, 2026-10-06, guiada-20261006-231824-v43qux): «Crear mi plan con esta idea» y «Agregar a
 * mi plan» le pasaban al modelo solo la estructura y los colores, y el plan salía con otros productos y en 12″: la
 * guirnalda de 51 globos (Fashion Fucsia, Fashion Palo de Rosa, Reflex Dorado de 18″) volvía como 77 globos de Reflex
 * Fucsia y Reflex Rosado, y las columnas negras y doradas perdían la bola negra de arriba. Volver a resolver con Python
 * el plan guardado de cada idea da EXACTAMENTE sus compras (29 de 29 ideas, comprobado sin coste), así que ese plan es
 * el que se usa; el modelo no interviene.
 *
 * Puro (sin servidor ni red): lo usan la ruta `/api/plan-idea`, el script que precalcula y las pruebas.
 */

export const EntradaAllowlistSchema = z.object({ product_id: z.string().min(1), variant_ids: z.array(z.string().min(1)).min(1) }).strict();

/** Lo que se guarda de cada idea en `planes-ideas.json`. */
export const PlanIdeaGuardadoSchema = z.object({
  /** El snapshot del catálogo con que se resolvió (precios y disponibilidad). */
  snapshot: z.string().min(1),
  /** El `.plan.json` de origen (trazabilidad). */
  archivo: z.string().min(1),
  /** La entrada del plan resuelto, sin las referencias a la foto de la biblioteca. */
  plan: PlanDecoracionSchema,
  /** Productos y variantes que la idea usa (las que Python compra y las que sustituye por color). */
  allowlist: z.array(EntradaAllowlistSchema).min(1),
  /** Globos que compra el plan guardado (suma de `compras[].unidades_necesarias`). */
  globos: z.number().int().nonnegative(),
}).strict();

export type PlanIdeaGuardado = z.infer<typeof PlanIdeaGuardadoSchema>;
export type EntradaAllowlist = z.infer<typeof EntradaAllowlistSchema>;

export const PlanesIdeasArchivoSchema = z.object({
  version: z.literal(1),
  ideas: z.record(z.string(), PlanIdeaGuardadoSchema),
}).strict();

/** Ubicaciones donde solo cabe una pieza (`PlanDecoracionSchema`). */
const UBICACIONES_UNICAS = new Set(["fondo_pared", "techo"]);

export type PlanConIdea =
  | { ok: true; plan: PlanDecoracion; nuevas: string[]; separadas: number; renombradas: number }
  | { ok: false; motivo: "tope_piezas" | "ubicacion_ocupada" | "esquema"; detalle: string };

/** Las dos listas de productos juntas, sin repetir variantes. */
export function unirAllowlist(...listas: ReadonlyArray<ReadonlyArray<{ product_id: string; variant_ids: readonly string[] }>>): EntradaAllowlist[] {
  const mapa = new Map<string, Set<string>>();
  for (const lista of listas) for (const entrada of lista) {
    const variantes = mapa.get(entrada.product_id) ?? new Set<string>();
    for (const variante of entrada.variant_ids) variantes.add(variante);
    mapa.set(entrada.product_id, variantes);
  }
  return [...mapa].map(([product_id, variantes]) => ({ product_id, variant_ids: [...variantes].sort() }));
}

function idLibre(indice: number, sufijo: string, usados: Set<string>): string {
  let candidato = `EST_${String(indice).padStart(2, "0")}_${sufijo}`;
  while (usados.has(candidato)) candidato = `${candidato}_B`;
  usados.add(candidato);
  return candidato;
}

/**
 * El plan a resolver: el de la idea (con cada pieza individual y su nombre), o, con `base` («Agregar a mi plan»), las
 * piezas del plan vigente intactas más las de la idea con ids nuevos. No cuenta nada: Python vuelve a resolver todo.
 * No se puede si pasa de 8 piezas o si las dos tienen pieza en el fondo (o en el techo), donde solo cabe una.
 */
/**
 * Las restricciones de los dos planes juntas (sin repetir). Las tallas obligatorias de una idea orgánica («R-5, R-12»)
 * son las que le dan su mezcla: sin ellas, sumada a otro plan, la guirnalda de 41 globos salía con 35, 6 sustituciones
 * y un tamaño sin cobertura (sonda sin coste, columnas negras y doradas + guirnalda rosa y dorada).
 */
export function unirRestricciones(base: PlanDecoracion["restricciones"], idea: PlanDecoracion["restricciones"]): PlanDecoracion["restricciones"] {
  if (!idea) return base;
  if (!base) return idea;
  const unicos = <T>(lista: readonly T[], clave: (item: T) => string, tope: number): T[] => [...new Map(lista.map((item) => [clave(item), item])).values()].slice(0, tope);
  return {
    ...(base.presupuesto ? { presupuesto: base.presupuesto } : {}),
    estructuras: unicos([...base.estructuras, ...idea.estructuras], (item) => `${item.tipo}|${item.polaridad}`, 24),
    colores: unicos([...base.colores, ...idea.colores], (item) => `${item.valor}|${item.polaridad}`, 12),
    tamanos: unicos([...base.tamanos, ...idea.tamanos], (item) => `${item.valor}|${item.polaridad}`, 12),
    acabados: unicos([...base.acabados, ...idea.acabados], (item) => `${item.valor}|${item.polaridad}`, 12),
  };
}

export function planConIdea(idea: PlanDecoracion, base: PlanDecoracion | null, opciones: { restriccionesDeIdea?: boolean } = {}): PlanConIdea {
  const separado = separarEstructurasRepetidas(idea);
  const propias = separado.plan.estructuras;
  if (!base) {
    const valido = PlanDecoracionSchema.safeParse(separado.plan);
    if (!valido.success) return { ok: false, motivo: "esquema", detalle: valido.error.issues.map((issue) => issue.message).join("; ") };
    return { ok: true, plan: valido.data, nuevas: valido.data.estructuras.map((estructura) => estructura.estructura_id), separadas: separado.separadas.length, renombradas: separado.renombradas.length };
  }
  if (base.estructuras.length + propias.length > MAX_PIEZAS_PLAN) {
    return { ok: false, motivo: "tope_piezas", detalle: `${base.estructuras.length} + ${propias.length} piezas pasan de ${MAX_PIEZAS_PLAN}` };
  }
  const ocupadas = new Set(base.estructuras.map((estructura) => estructura.ubicacion).filter((ubicacion) => UBICACIONES_UNICAS.has(ubicacion)));
  const choca = propias.find((estructura) => ocupadas.has(estructura.ubicacion));
  if (choca) return { ok: false, motivo: "ubicacion_ocupada", detalle: `ya hay una pieza en ${choca.ubicacion}` };
  const usados = new Set(base.estructuras.map((estructura) => estructura.estructura_id));
  const nuevas: string[] = [];
  const sumadas = propias.map((estructura, posicion): EstructuraPlan => {
    const sufijo = estructura.estructura_id.replace(/^EST_\d{2}_/, "") || "PIEZA";
    const id = idLibre(base.estructuras.length + posicion + 1, sufijo, usados);
    nuevas.push(id);
    return { ...estructura, estructura_id: id };
  });
  const paleta = [...new Set([...base.concepto.paleta, ...idea.concepto.paleta])].slice(0, 8);
  const restricciones = opciones.restriccionesDeIdea ? unirRestricciones(base.restricciones, idea.restricciones) : base.restricciones;
  const unido: PlanDecoracion = { ...base, concepto: { ...base.concepto, paleta }, estructuras: [...base.estructuras, ...sumadas], ...(restricciones ? { restricciones } : {}) };
  const nombrado = nombrarPiezasIndividuales(unido);
  const valido = PlanDecoracionSchema.safeParse(nombrado.plan);
  if (!valido.success) return { ok: false, motivo: "esquema", detalle: valido.error.issues.map((issue) => issue.message).join("; ") };
  return { ok: true, plan: valido.data, nuevas, separadas: separado.separadas.length, renombradas: separado.renombradas.length + nombrado.renombradas.length };
}
