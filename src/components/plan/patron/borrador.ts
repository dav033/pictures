import { PATRON_COLOR_VERSION, type BasePatronColor, type PatronColor, type PintadoPatronColor } from "@/lib/plan/patron-color";
import type { IdEstilo } from "./modos";

/**
 * Ediciones del patrón DECLARATIVO que arma el editor: elegir un estilo,
 * cambiar el tamaño del racimo, pintar un globo o un racimo. Nada de aquí
 * expande la rejilla ni cuenta globos, y ninguna regla cruzada se valida en
 * TypeScript: la vista previa de Python dibuja, cuenta y rechaza (ADR-0028).
 * Puro: sin React.
 */

export type ContextoEstilo = {
  /** Participación declarada de cada material, en el orden de `materiales`. */
  participaciones: readonly number[];
  /** Globos por racimo con que se dibuja hoy la estructura. */
  globosPorRacimo: number;
  /**
   * Patrón que escribió Python para esta pieza: el del plan o, sin él, su
   * sugerencia. Una ficha de su mismo modo parte de él (su racimo, sus pesos,
   * su semilla) en lugar de un arranque armado aquí.
   */
  referencia?: PatronColor | null;
};

const MAX_PINTADOS = 512;
const MAX_SECUENCIA = 12;
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

/** Aplica cambios al borrador; el patrón pasa a ser del decorador y los campos `undefined` desaparecen. */
export function editar(patron: PatronColor, cambios: Partial<Omit<PatronColor, "version" | "origen">>): PatronColor {
  const siguiente: PatronColor = { ...patron, ...cambios, origen: "decorador" };
  for (const clave of OPCIONALES) {
    if (siguiente[clave] === undefined) delete siguiente[clave];
  }
  return siguiente;
}

/**
 * Posición de partida del deslizador de peso al pasar a bloques o confeti: la
 * participación del material en el rango de `peso` (1–100). Es solo el valor
 * inicial del control; el decorador lo mueve y Python cuenta lo que resulte.
 */
function pesoInicial(participacion: number): number {
  return Math.min(100, Math.max(1, Math.round(participacion * 100)));
}

/** `valores` repetidos o recortados hasta `largo` posiciones. */
function ciclar(valores: readonly number[], largo: number): number[] {
  return Array.from({ length: largo }, (_, indice) => valores[indice % valores.length] ?? 0);
}

type BaseDeModo<M extends BasePatronColor["modo"]> = Extract<BasePatronColor, { modo: M }>;

/**
 * Patrón de partida de una ficha de estilo. Conserva lo que sirve del patrón
 * actual (el racimo al pasar de espiral a zig-zag, los acentos, la simetría)
 * y empieza sin pintados: deshacer los recupera. Si el borrador no es de ese
 * modo, parte del patrón de Python (`contexto.referencia`) cuando lo es; solo
 * sin ninguno de los dos arma un arranque con los colores en orden, que el
 * decorador ajusta y Python valida y cuenta.
 */
export function patronDeEstilo(estilo: IdEstilo, actual: PatronColor | null, contexto: ContextoEstilo): PatronColor {
  const materiales = contexto.participaciones.map((_, indice) => indice);
  const pesos = contexto.participaciones.map((participacion, material) => ({ material, peso: pesoInicial(participacion) }));
  const bases = [actual?.base, contexto.referencia?.base];
  const previa = <M extends BasePatronColor["modo"]>(modo: M): BaseDeModo<M> | undefined =>
    bases.find((base): base is BaseDeModo<M> => base?.modo === modo);
  const k = contexto.globosPorRacimo;
  let base: BasePatronColor;
  switch (estilo) {
    case "espiral":
    case "zigzag":
    case "recto": {
      const racimo = bases.find((otra): otra is BaseDeModo<"espiral"> => otra?.modo === "espiral" && otra.racimo.length === k)?.racimo;
      base = { modo: "espiral", racimo: racimo ?? ciclar(materiales, k), trazo: estilo === "recto" ? "recto" : estilo };
      break;
    }
    case "anillos":
      base = previa("anillos") ?? { modo: "anillos", secuencia: materiales.slice(0, MAX_SECUENCIA), largo: 1 };
      break;
    case "bloques":
      base = previa("bloques") ?? { modo: "bloques", bloques: pesos.slice(0, MAX_SECUENCIA) };
      break;
    case "degradado":
    case "diagonal":
      base = previa("degradado") ?? { modo: "degradado", paradas: materiales.slice(0, 6), transicion: "suave" };
      break;
    case "aleatorio":
      base = previa("aleatorio") ?? { modo: "aleatorio", pesos: pesos.slice(0, 6), semilla: 1 };
      break;
    case "flor":
      base = previa("flor") ?? { modo: "flor", fondo: 0, petalo: materiales.length > 1 ? 1 : 0, centro: materiales.length > 2 ? 2 : 0, separacion: 2 };
      break;
    case "damero":
      base = previa("damero") ?? { modo: "damero", secuencia: materiales.slice(0, 4), tamano: 1 };
      break;
  }
  const transversal = actual?.direccion === "transversal" && ["anillos", "bloques", "degradado"].includes(base.modo);
  return {
    version: PATRON_COLOR_VERSION,
    origen: "decorador",
    ...(actual?.globos_por_racimo === undefined ? {} : { globos_por_racimo: actual.globos_por_racimo }),
    base,
    ...(actual?.acentos?.length ? { acentos: actual.acentos } : {}),
    ...(actual?.simetria ? { simetria: actual.simetria } : {}),
    ...(estilo === "diagonal" ? { direccion: "diagonal" as const } : transversal ? { direccion: "transversal" as const } : {}),
  };
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
