import type { ModoPatronColor, PatronColor } from "@/lib/plan/patron-color";

/**
 * Estilos que el editor ofrece como fichas, con el nombre del oficio. Un
 * estilo es un modo de `patron-color.v1` más, a veces, un parámetro fijo
 * (el trazo de la espiral, la dirección diagonal del degradé).
 */
export type IdEstilo = "espiral" | "zigzag" | "recto" | "anillos" | "bloques" | "degradado" | "diagonal" | "aleatorio" | "flor" | "damero";

export type DireccionPatron = NonNullable<PatronColor["direccion"]>;

export type EstiloPatron = {
  id: IdEstilo;
  modo: ModoPatronColor;
  nombre: string;
  ayuda: string;
  /** Solo paredes (degradé diagonal). */
  soloPared?: boolean;
};

export const ESTILOS_PATRON: readonly EstiloPatron[] = [
  { id: "espiral", modo: "espiral", nombre: "Espiral", ayuda: "Racimos iguales que giran" },
  { id: "zigzag", modo: "espiral", nombre: "Zig-zag", ayuda: "Giran a un lado y al otro" },
  { id: "recto", modo: "espiral", nombre: "Franjas rectas", ayuda: "Cada color en línea" },
  { id: "anillos", modo: "anillos", nombre: "Anillos", ayuda: "Salvavidas de un color" },
  { id: "bloques", modo: "bloques", nombre: "Bloques", ayuda: "Tramos de color" },
  { id: "degradado", modo: "degradado", nombre: "Degradé", ayuda: "De un color a otro" },
  { id: "diagonal", modo: "degradado", nombre: "Degradé diagonal", ayuda: "De esquina a esquina", soloPared: true },
  { id: "aleatorio", modo: "aleatorio", nombre: "Confeti", ayuda: "Mezcla orgánica" },
  { id: "flor", modo: "flor", nombre: "Flores", ayuda: "Margaritas entre racimos" },
  { id: "damero", modo: "damero", nombre: "Damero", ayuda: "Cuadros alternos" },
];

/*
 * ADAPTADOR TEMPORAL (ADR-0028, "Adaptadores temporales"). Las reglas
 * cruzadas del patrón son de Python (`services/ai-api/app/patron_color.py`,
 * `_validar_estructura` y `_validar`): ellas deciden y rechazan. El editor
 * necesita saber ANTES de preguntar qué fichas y controles mostrar, y la
 * vista previa (`plan-patron.v1`) todavía no lo dice. Por eso este archivo es
 * el único lugar de TypeScript que las refleja, solo para ocultar lo que
 * Python rechazaría; nunca valida ni decide un conteo. Si quedara atrás, el
 * decorador vería el mensaje de Python, no un fallo, y
 * `scripts/test/test-ui-propuesta.ts` compara `MODOS_POR_TIPO` con
 * `_MODOS_POR_TIPO` para que no quede atrás en silencio.
 * Se retira cuando la vista previa devuelva los modos (y direcciones) que
 * admite cada estructura.
 */

/** Refleja `_MODOS_POR_TIPO` (`tipo_sin_patron`, `modo_no_permitido`). */
export const MODOS_POR_TIPO: Readonly<Record<string, readonly ModoPatronColor[]>> = {
  columna: ["espiral", "anillos", "bloques", "degradado", "aleatorio", "flor"],
  arco: ["espiral", "anillos", "bloques", "degradado", "aleatorio", "flor"],
  semiarco: ["espiral", "anillos", "bloques", "degradado", "aleatorio", "flor"],
  guirnalda: ["espiral", "anillos", "bloques", "degradado", "aleatorio", "flor"],
  centro_mesa: ["espiral", "anillos", "bloques", "aleatorio"],
  pared: ["anillos", "bloques", "degradado", "aleatorio", "damero"],
};

/** Si la pieza ofrece "Crear patrón": tipo geométrico y dos colores o más (`tipo_sin_patron`, `un_solo_material`). */
export function admitePatron(tipo: string, materiales: number): boolean {
  return tipo in MODOS_POR_TIPO && materiales >= 2;
}

/**
 * Direcciones que el editor ofrece: solo la pared lleva el patrón de lado a
 * lado o en diagonal, y la diagonal solo con degradé (`direccion_no_permitida`).
 * Donde la dirección no cambia el dibujo (confeti, damero) no se ofrece.
 */
export function direccionesPara(tipo: string, modo: ModoPatronColor): readonly DireccionPatron[] {
  if (tipo !== "pared" || !(modo === "anillos" || modo === "bloques" || modo === "degradado")) return [];
  return modo === "degradado" ? ["longitudinal", "transversal", "diagonal"] : ["longitudinal", "transversal"];
}

/** El espejo solo se arma en un arco (`simetria_no_permitida`); con confeti no cambia nada. */
export function admiteEspejo(tipo: string, modo: ModoPatronColor): boolean {
  return tipo === "arco" && modo !== "aleatorio";
}

export function estilosParaTipo(tipo: string): EstiloPatron[] {
  const modos = MODOS_POR_TIPO[tipo] ?? [];
  return ESTILOS_PATRON.filter((estilo) => modos.includes(estilo.modo) && (!estilo.soloPared || tipo === "pared"));
}

/** Ficha que corresponde a un patrón: la espiral por su trazo, el degradé diagonal aparte. */
export function estiloDe(patron: PatronColor): IdEstilo {
  const base = patron.base;
  if (base.modo === "espiral") return base.trazo === "espiral" ? "espiral" : base.trazo;
  if (base.modo === "degradado" && patron.direccion === "diagonal") return "diagonal";
  return base.modo;
}
