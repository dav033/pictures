import type { PatronColor, PintadoPatronColor } from "@/lib/plan/patron-color";

/**
 * Ediciones del patrón DECLARATIVO que arma el editor: cambiar el tamaño del
 * racimo, pintar un globo o un racimo, ajustar un parámetro. El punto de
 * partida de cada estilo lo arma Python (`modo` en la vista previa). Nada de aquí
 * expande la rejilla ni cuenta globos, y ninguna regla cruzada se valida en
 * TypeScript: la vista previa de Python dibuja, cuenta y rechaza (ADR-0028).
 * Puro: sin React.
 */

const MAX_PINTADOS = 512;
const OPCIONALES = ["globos_por_racimo", "acentos", "pintados", "simetria", "direccion"] as const;

/** JSON con las claves ordenadas: el eco de Python puede traerlas en otro orden. */
function jsonEstable(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(jsonEstable).join(",")}]`;
  if (valor && typeof valor === "object") {
    const entradas = Object.entries(valor as Record<string, unknown>).filter(([, campo]) => campo !== undefined).sort(([a], [b]) => a.localeCompare(b));
    return `{${entradas.map(([clave, campo]) => `${JSON.stringify(clave)}:${jsonEstable(campo)}`).join(",")}}`;
  }
  return JSON.stringify(valor);
}

export function clavePatron(patron: PatronColor): string {
  return jsonEstable(patron);
}

/** Mismo diseño aunque cambie quién lo firmó (`origen`): así "Aplicar" sabe si hay algo que aplicar. */
export function mismoDiseno(a: PatronColor | null, b: PatronColor | null): boolean {
  if (!a || !b) return a === b;
  return jsonEstable({ ...a, origen: null }) === jsonEstable({ ...b, origen: null });
}

/**
 * Si `patron` es el que el plan ya cotiza (`delPlan`, el `patron_color` de la
 * estructura). Lo decide el diseño, no `origen`: un preset que Python aplicó
 * al confirmar sigue diciendo "sugerido" y cuenta, y una sugerencia retocada
 * pasa a "decorador" sin estar aplicada.
 */
export function enPropuesta(patron: PatronColor | null | undefined, delPlan: PatronColor | null): boolean {
  return delPlan !== null && patron != null && mismoDiseno(patron, delPlan);
}

/**
 * El borrador que el editor tiene a la vista: el del decorador o, sin él, la
 * sugerencia que dibujó Python (tocarla la vuelve del decorador). Es lo que
 * lleva un cambio de estilo como `desde`.
 */
export function borradorALaVista(presente: PatronColor | null, vista: { patron: PatronColor } | null): PatronColor | null {
  return presente ?? vista?.patron ?? null;
}

/** Aplica cambios al borrador; el patrón pasa a ser del decorador y los campos `undefined` desaparecen. */
export function editar(patron: PatronColor, cambios: Partial<Omit<PatronColor, "version" | "origen">>): PatronColor {
  const siguiente: PatronColor = { ...patron, ...cambios, origen: "decorador" };
  for (const clave of OPCIONALES) {
    if (siguiente[clave] === undefined) delete siguiente[clave];
  }
  return siguiente;
}

/** `valores` repetidos o recortados hasta `largo` posiciones. */
function ciclar(valores: readonly number[], largo: number): number[] {
  return Array.from({ length: largo }, (_, indice) => valores[indice % valores.length] ?? 0);
}

/** Otro tamaño de racimo; en espiral el racimo se recorta o se completa repitiendo sus colores. */
export function conGlobosPorRacimo(patron: PatronColor, globos: number): PatronColor {
  const base = patron.base.modo === "espiral" ? { ...patron.base, racimo: ciclar(patron.base.racimo, globos) } : patron.base;
  return editar(patron, { globos_por_racimo: globos, base });
}

/**
 * Un trazo del pincel. Lo que pinta encima de otro pintado lo reemplaza (un
 * racimo completo borra los globos pintados de ese racimo) para que la lista
 * no crezca con cada toque; el orden se conserva porque el último manda.
 */
export function conPintado(patron: PatronColor, pintado: PintadoPatronColor): PatronColor {
  const previos = (patron.pintados ?? []).filter((otro) => otro.fila !== pintado.fila || (pintado.columna !== undefined && otro.columna !== pintado.columna));
  return editar(patron, { pintados: [...previos, pintado].slice(-MAX_PINTADOS) });
}

export function sinPintados(patron: PatronColor): PatronColor {
  return editar(patron, { pintados: undefined });
}

function clavePintado(pintado: PintadoPatronColor): string {
  return `${pintado.fila}:${pintado.columna ?? "*"}:${pintado.material}`;
}

/** Pintados del borrador que la última vista previa todavía no trae (su eco del patrón no los tiene). */
export function pintadosPendientes(borrador: PatronColor, eco: PatronColor | undefined): PintadoPatronColor[] {
  const hechos = new Set((eco?.pintados ?? []).map(clavePintado));
  return (borrador.pintados ?? []).filter((pintado) => !hechos.has(clavePintado(pintado)));
}

/**
 * Pintura optimista, solo visual: el último dibujo de Python con los trazos
 * que aún no volvieron. Se descarta en cuanto llega la vista previa que los
 * incluye; el conteo nunca sale de aquí.
 */
export function celdasConPendientes(celdas: readonly (readonly number[])[], pendientes: readonly PintadoPatronColor[]): readonly (readonly number[])[] {
  if (!pendientes.length) return celdas;
  const copia = celdas.map((fila) => [...fila]);
  for (const pintado of pendientes) {
    const fila = copia[pintado.fila];
    if (!fila) continue;
    if (pintado.columna === undefined) fila.fill(pintado.material);
    else if (pintado.columna < fila.length) fila[pintado.columna] = pintado.material;
  }
  return copia;
}
