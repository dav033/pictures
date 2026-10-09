import { plegar } from "./herramientas-escena-colores";
import { celebracionesDeTexto, tematicasDeTexto } from "../taller/taxonomia-celebraciones";

/**
 * **Qué composición lleva la decoración de un evento** (REQ-008): no es siempre un arco, dos columnas y una guirnalda. Según la
 * temática (safari, princesas, boho…) y la ocasión se elige una de ocho composiciones del fondo de fotos, con su figura si es de
 * figuras, y cómo se resuelve la entrada. Es determinista: el mismo pedido da la misma composición (la semilla sale del pedido, no del
 * azar) y pedidos distintos caen en composiciones distintas. Sin temática manda la ocasión (una boda sigue siendo el arco clásico).
 */

export const ARQUETIPOS_FONDO = ["arco_columnas", "pared_letras", "paneles_guirnalda", "semiarco_racimos", "columnas_techo", "mural", "figuras", "aro_ramos"] as const;
export type ArquetipoFondo = (typeof ARQUETIPOS_FONDO)[number];
export const FIGURAS_FONDO = ["palmeras", "castillo", "nube", "estrella", "corazon"] as const;
export type FiguraFondo = (typeof FIGURAS_FONDO)[number];
export type EntradaSalon = "arco" | "columnas";
/** La figura de foil que acompaña a la composición (la estrella de la graduación, la flor del boho, la nube del bautizo...). */
export const ACENTOS_FONDO = ["corazon", "estrella", "nube", "luna", "flor", "redondo"] as const;
export type AcentoFondo = (typeof ACENTOS_FONDO)[number];

export type Composicion = { fondo: ArquetipoFondo; figura: FiguraFondo; acento: AcentoFondo; entrada: EntradaSalon; semilla: number };
export type PedidoComposicion = { tipo: string; tematica?: string; colores?: readonly string[]; estilo?: string; texto?: string; variante?: number };

type Eleccion = { fondo: ArquetipoFondo; figura?: FiguraFondo; acento?: AcentoFondo };

/** Lo que pide cada temática de la taxonomía del taller (ids de `TEMATICAS`). */
const POR_TEMATICA: Readonly<Record<string, Eleccion>> = {
  "safari-jungla": { fondo: "figuras", figura: "palmeras" }, "tropical-hawaiana": { fondo: "figuras", figura: "palmeras" }, dinosaurios: { fondo: "figuras", figura: "palmeras" }, "bosque-encantado": { fondo: "figuras", figura: "palmeras" },
  princesas: { fondo: "figuras", figura: "castillo" }, "fantasia-hadas": { fondo: "figuras", figura: "castillo" },
  espacio: { fondo: "figuras", figura: "estrella" }, "estrellas-noche": { fondo: "figuras", figura: "estrella" }, corazones: { fondo: "figuras", figura: "corazon" },
  "osos-peluche": { fondo: "figuras", figura: "nube" }, mascotas: { fondo: "figuras", figura: "nube" }, mariposas: { fondo: "figuras", figura: "nube" },
  invierno: { fondo: "semiarco_racimos", acento: "estrella" },
  boho: { fondo: "paneles_guirnalda", acento: "flor" }, rustico: { fondo: "paneles_guirnalda", acento: "redondo" }, "flores-jardin": { fondo: "paneles_guirnalda", acento: "flor" }, "organico-natural": { fondo: "paneles_guirnalda", acento: "luna" }, vintage: { fondo: "paneles_guirnalda", acento: "corazon" },
  sirenas: { fondo: "aro_ramos", acento: "redondo" }, arcoiris: { fondo: "aro_ramos", acento: "nube" }, "pastel-macaron": { fondo: "aro_ramos", acento: "corazon" }, nautico: { fondo: "aro_ramos", acento: "estrella" }, unicornio: { fondo: "aro_ramos", acento: "nube" }, minimalista: { fondo: "aro_ramos", acento: "redondo" },
  deportes: { fondo: "mural" }, videojuegos: { fondo: "mural" }, neon: { fondo: "mural" }, "musica-disco": { fondo: "mural" }, superheroes: { fondo: "mural" },
  monstruos: { fondo: "columnas_techo", acento: "luna" }, circo: { fondo: "columnas_techo", acento: "estrella" },
  "glam-dorado": { fondo: "pared_letras" }, "hollywood-cine": { fondo: "pared_letras" },
  "elegante-lujo": { fondo: "arco_columnas" },
};

/** Lo que pide una celebración de la taxonomía cuando la temática no manda. */
const POR_CELEBRACION: Readonly<Record<string, Eleccion>> = { halloween: { fondo: "columnas_techo", acento: "luna" }, "dia-de-muertos": { fondo: "columnas_techo", acento: "flor" }, graduacion: { fondo: "pared_letras", acento: "estrella" }, "graduacion-preescolar": { fondo: "pared_letras", acento: "estrella" } };

/** Temáticas que la taxonomía no trae (personajes con licencia): por su palabra. */
const POR_PALABRA: ReadonlyArray<readonly [RegExp, Eleccion]> = [[/frozen|elsa|hielo|nieve|congelad/, { fondo: "semiarco_racimos", acento: "estrella" }]];

/** Las composiciones de cada ocasión cuando no hay temática: una boda sigue siendo el arco clásico, el resto varía con el pedido. */
const POR_OCASION: Readonly<Record<string, readonly Eleccion[]>> = {
  boda: [{ fondo: "arco_columnas" }],
  quince: [{ fondo: "aro_ramos", acento: "flor" }, { fondo: "arco_columnas" }, { fondo: "semiarco_racimos", acento: "flor" }],
  cumpleanos: [{ fondo: "pared_letras" }, { fondo: "semiarco_racimos" }, { fondo: "columnas_techo" }, { fondo: "mural" }, { fondo: "paneles_guirnalda" }],
  bautizo: [{ fondo: "figuras", figura: "nube" }, { fondo: "paneles_guirnalda", acento: "nube" }, { fondo: "semiarco_racimos", acento: "nube" }],
  baby_shower: [{ fondo: "figuras", figura: "nube" }, { fondo: "aro_ramos", acento: "nube" }, { fondo: "paneles_guirnalda", acento: "nube" }],
  corporativo: [{ fondo: "mural" }, { fondo: "pared_letras", acento: "redondo" }, { fondo: "columnas_techo", acento: "redondo" }],
  graduacion: [{ fondo: "pared_letras", acento: "estrella" }, { fondo: "columnas_techo", acento: "estrella" }, { fondo: "aro_ramos", acento: "estrella" }],
  halloween: [{ fondo: "columnas_techo", acento: "luna" }, { fondo: "mural", acento: "luna" }],
  otro: [{ fondo: "pared_letras" }, { fondo: "semiarco_racimos" }, { fondo: "paneles_guirnalda" }, { fondo: "aro_ramos" }, { fondo: "mural" }],
};

/** Los colores propios de cada temática, para cuando el pedido no trae los suyos (nombres que el resolvedor de colores reconoce). */
const COLORES_POR_TEMATICA: Readonly<Record<string, readonly string[]>> = {
  "safari-jungla": ["verde", "amarillo", "naranja"], "tropical-hawaiana": ["verde", "turquesa", "amarillo"], dinosaurios: ["verde", "naranja", "cafe"],
  princesas: ["rosa", "blanco", "dorado"], "fantasia-hadas": ["lila", "rosa", "dorado"], sirenas: ["turquesa", "lila", "plateado"], unicornio: ["lila", "rosa", "blanco"],
  invierno: ["azul", "blanco", "plateado"], boho: ["arena", "durazno", "blanco"], rustico: ["arena", "verde", "marfil"],
  espacio: ["azul", "morado", "plateado"], deportes: ["verde", "blanco", "negro"], monstruos: ["verde", "morado", "negro"],
  halloween: ["negro", "naranja", "morado"], graduacion: ["azul", "dorado", "blanco"],
};

/** Los colores de la temática o de la celebración del pedido (halloween, graduación), o `undefined` si no hay ninguno propio. */
export function coloresDeTema(tipo: string, tematica: string | undefined): string[] | undefined {
  const texto = tematica?.trim();
  const ids = [...(texto ? [...tematicasDeTexto(texto), ...celebracionesDeTexto(texto)].map((c) => c.id) : []), tipo];
  const id = ids.find((x) => COLORES_POR_TEMATICA[x]);
  const colores = id ? COLORES_POR_TEMATICA[id] : /frozen|elsa|hielo|nieve/.test(plegar(texto ?? "")) ? COLORES_POR_TEMATICA.invierno : undefined;
  return colores && [...colores];
}

/** Una cifra estable (FNV-1a de 32 bits) del texto del pedido. */
export function semillaDe(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

const FIGURAS_POR_SEMILLA: readonly FiguraFondo[] = ["nube", "estrella", "corazon"];

function eleccionTematica(tematica: string | undefined, tipo: string): Eleccion | null {
  const texto = tematica?.trim();
  if (texto) {
    for (const c of tematicasDeTexto(texto)) { const e = POR_TEMATICA[c.id]; if (e) return e; }
    const plano = plegar(texto);
    for (const [patron, e] of POR_PALABRA) if (patron.test(plano)) return e;
    for (const c of celebracionesDeTexto(texto)) { const e = POR_CELEBRACION[c.id]; if (e) return e; }
  }
  return tipo === "halloween" || tipo === "graduacion" ? POR_CELEBRACION[tipo] ?? null : null;
}

/** Lo que se ofrece después de lo que pide el tema o la ocasión cuando piden «otra opción» (`variante` 1, 2, 3…). */
const OTRAS_OPCIONES: readonly Eleccion[] = [
  { fondo: "aro_ramos", acento: "flor" }, { fondo: "paneles_guirnalda" }, { fondo: "semiarco_racimos" }, { fondo: "pared_letras" },
  { fondo: "columnas_techo" }, { fondo: "mural" }, { fondo: "figuras", figura: "nube" },
];

/**
 * La composición de un pedido. Con `variante` 0 (la primera) manda el tema o la ocasión, y es la misma cada vez que se pide lo mismo;
 * con 1, 2, 3… sale otra distinta para el mismo pedido (la variante entra también en la semilla, así que cambian los modelos y la entrada).
 */
export function composicionDe(p: PedidoComposicion): Composicion {
  const pedido = plegar([p.tipo, p.tematica ?? "", ...(p.colores ?? []), p.estilo ?? "", p.texto ?? ""].join("|"));
  const variante = Math.max(0, Math.floor(p.variante ?? 0));
  const semilla = semillaDe(variante ? `${pedido}|variante ${variante}` : pedido);
  const base = semillaDe(pedido);
  const pool = POR_OCASION[p.tipo] ?? POR_OCASION.otro!;
  const principal = eleccionTematica(p.tematica, p.tipo) ?? pool[base % pool.length]!;
  const clave = (e: Eleccion) => `${e.fondo}/${e.figura ?? ""}`;
  const opciones = [principal, ...pool, ...OTRAS_OPCIONES].filter((e, i, todas) => todas.findIndex((x) => clave(x) === clave(e)) === i);
  const elegida = opciones[variante % opciones.length]!;
  const figura = elegida.figura ?? FIGURAS_POR_SEMILLA[(semilla >>> 8) % FIGURAS_POR_SEMILLA.length]!;
  const acento = elegida.acento ?? ACENTOS_FONDO[(semilla >>> 4) % ACENTOS_FONDO.length]!;
  const entrada: EntradaSalon = p.tipo === "boda" || p.tipo === "quince" || p.tipo === "corporativo" ? "arco" : (semilla >>> 16) % 2 === 0 ? "arco" : "columnas";
  return { fondo: elegida.fondo, figura, acento, entrada, semilla };
}
