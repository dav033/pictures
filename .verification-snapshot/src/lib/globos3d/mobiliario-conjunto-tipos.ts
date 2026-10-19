import { z } from "zod";

/**
 * Los tipos del **conjunto de mesa** (REQ-012): una mesa paramétrica y, aparte, su grupo de sillas. Cada uno es una pieza de
 * escenografía con `mueble.mesa` o `mueble.sillas` (sus sólidos se arman al vuelo, como los muebles del catálogo, así la
 * escena no engorda). Aquí viven lo que ambos comparten: los tipos, los límites de cada medida, los valores de partida, el
 * esquema de lo guardado y `normalizarMesa` / `normalizarSillas`, que dejan siempre armable lo que llega de fuera.
 */

export const TIPOS_MESA = ["redonda", "cuadrada", "rectangular", "ovalada", "coctel", "media_luna", "serpentina", "u"] as const;
export type TipoMesa = (typeof TIPOS_MESA)[number];
export const NOMBRE_MESA: Readonly<Record<TipoMesa, string>> = {
  redonda: "Mesa redonda", cuadrada: "Mesa cuadrada", rectangular: "Mesa rectangular", ovalada: "Mesa ovalada", coctel: "Mesa cóctel",
  media_luna: "Mesa media luna", serpentina: "Mesa serpentina", u: "Banquete en U",
};

/** Cómo cae el mantel: hasta el piso, corto (a media altura, se ven las patas) o sin mantel (tapa y patas). */
export const MANTELES = ["piso", "corto", "ninguno"] as const;
export type MantelMesa = (typeof MANTELES)[number];

export type MesaGuardada = {
  tipo: TipoMesa;
  /** Diámetro en redonda, cóctel y media luna; lado en cuadrada; largo en rectangular, ovalada, serpentina; ancho de afuera en U (cm). */
  anchoCm: number;
  /** Ancho de la mesa en rectangular, ovalada y serpentina; fondo de afuera en U. Igual al ancho en lo redondo y cuadrado (cm). */
  fondoCm: number;
  /** Alto de la tapa sobre el piso (cm). */
  altoCm: number;
  mantel: MantelMesa;
  /** El color del mantel o, sin mantel, el de la tapa (`#rrggbb`). */
  colorMantel: string;
  /** El color de las patas y la base (se ven sin mantel y con mantel corto). */
  colorPatas: string;
  /** Color del camino de mesa (`#rrggbb`) o `null` si no lleva. */
  camino: string | null;
};

export const TIPOS_SILLA = ["tiffany", "crossback", "ghost", "plegable", "moderna", "banca", "taburete"] as const;
export type TipoSilla = (typeof TIPOS_SILLA)[number];

/** Dónde se sientan: todo el borde, un lado, los dos lados largos, solo las cabeceras o solo el lado que mira a un frente (el escenario). */
export const DISPOSICIONES = ["alrededor", "un_lado", "dos_lados", "cabeceras", "frente"] as const;
export type DisposicionSillas = (typeof DISPOSICIONES)[number];

export type PuestoGuardado = { x: number; z: number; giroGrados: number };

export type SillasGuardadas = {
  tipo: TipoSilla;
  colorEstructura: string;
  /** Color del cojín o `null` si no lleva (las acrílicas nunca). */
  colorCojin: string | null;
  disposicion: DisposicionSillas;
  /** Con `frente`: hacia dónde miran (grados en el marco de la mesa; 0 = +z). */
  haciaGrados: number;
  /** Las que se pidieron; `puestos.length` son las que de verdad caben. */
  pedida: number;
  /** Dónde va cada silla, en el marco de la mesa (cm y grados): el frente de la silla mira al giro dado. */
  puestos: PuestoGuardado[];
};

export const MAX_SILLAS_POR_MESA = 40;

type Limites = { ancho: readonly [number, number]; fondo: readonly [number, number]; alto: readonly [number, number] };
export const LIMITES_MESA: Readonly<Record<TipoMesa, Limites>> = {
  redonda: { ancho: [60, 300], fondo: [60, 300], alto: [40, 110] },
  cuadrada: { ancho: [60, 250], fondo: [60, 250], alto: [40, 110] },
  rectangular: { ancho: [100, 600], fondo: [40, 150], alto: [40, 110] },
  ovalada: { ancho: [100, 500], fondo: [60, 250], alto: [40, 110] },
  coctel: { ancho: [40, 100], fondo: [40, 100], alto: [90, 125] },
  media_luna: { ancho: [100, 400], fondo: [50, 200], alto: [40, 110] },
  serpentina: { ancho: [120, 600], fondo: [40, 100], alto: [40, 110] },
  u: { ancho: [250, 800], fondo: [200, 800], alto: [40, 110] },
};

type Partida = { anchoCm: number; fondoCm: number; altoCm: number; mantel: MantelMesa };
export const PARTIDA_MESA: Readonly<Record<TipoMesa, Partida>> = {
  redonda: { anchoCm: 150, fondoCm: 150, altoCm: 75, mantel: "piso" },
  cuadrada: { anchoCm: 90, fondoCm: 90, altoCm: 75, mantel: "piso" },
  rectangular: { anchoCm: 240, fondoCm: 90, altoCm: 75, mantel: "piso" },
  ovalada: { anchoCm: 240, fondoCm: 120, altoCm: 75, mantel: "piso" },
  coctel: { anchoCm: 60, fondoCm: 60, altoCm: 110, mantel: "ninguno" },
  media_luna: { anchoCm: 180, fondoCm: 90, altoCm: 75, mantel: "piso" },
  serpentina: { anchoCm: 240, fondoCm: 60, altoCm: 75, mantel: "piso" },
  u: { anchoCm: 600, fondoCm: 500, altoCm: 75, mantel: "piso" },
};
export const COLOR_MANTEL = "#f7f6f2";
export const COLOR_PATAS = "#6f6f6f";

/** ¿El fondo de este tipo sale de su ancho (redonda, cuadrada, cóctel y media luna)? Entonces `fondo_cm` no se pide aparte. */
export const FONDO_DEL_ANCHO: Readonly<Record<TipoMesa, "igual" | "mitad" | null>> = {
  redonda: "igual", cuadrada: "igual", coctel: "igual", media_luna: "mitad", rectangular: null, ovalada: null, serpentina: null, u: null,
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const esHex = (v: unknown): v is string => typeof v === "string" && HEX.test(v);
const acotar = (v: unknown, [min, max]: readonly [number, number], porDefecto: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(max, Math.max(min, v)) : porDefecto);
const redondear = (v: number) => Math.round(v * 10) / 10;

export const esTipoMesa = (v: unknown): v is TipoMesa => (TIPOS_MESA as readonly unknown[]).includes(v);
export const esTipoSilla = (v: unknown): v is TipoSilla => (TIPOS_SILLA as readonly unknown[]).includes(v);
export const esDisposicion = (v: unknown): v is DisposicionSillas => (DISPOSICIONES as readonly unknown[]).includes(v);

/** El fondo que de verdad lleva una mesa: el de su ancho si es redonda, cuadrada o cóctel; la mitad en la media luna; si no, el pedido acotado. */
function fondoDe(tipo: TipoMesa, ancho: number, pedido: unknown): number {
  const regla = FONDO_DEL_ANCHO[tipo];
  if (regla === "igual") return ancho;
  if (regla === "mitad") return redondear(ancho / 2);
  return acotar(pedido, LIMITES_MESA[tipo].fondo, PARTIDA_MESA[tipo].fondoCm);
}

/** Una mesa siempre armable: tipo válido (si no, redonda), medidas dentro de sus límites, colores `#rrggbb` y mantel válido. Lo que llega de fuera (escena guardada, API, IA) pasa por aquí. */
export function normalizarMesa(v: unknown): MesaGuardada {
  const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const tipo = esTipoMesa(o.tipo) ? o.tipo : "redonda";
  const partida = PARTIDA_MESA[tipo], l = LIMITES_MESA[tipo];
  const anchoCm = redondear(acotar(o.anchoCm, l.ancho, partida.anchoCm));
  return {
    tipo, anchoCm, fondoCm: redondear(fondoDe(tipo, anchoCm, o.fondoCm)), altoCm: redondear(acotar(o.altoCm, l.alto, partida.altoCm)),
    mantel: (MANTELES as readonly unknown[]).includes(o.mantel) ? (o.mantel as MantelMesa) : partida.mantel,
    colorMantel: esHex(o.colorMantel) ? o.colorMantel.toLowerCase() : COLOR_MANTEL,
    colorPatas: esHex(o.colorPatas) ? o.colorPatas.toLowerCase() : COLOR_PATAS,
    camino: esHex(o.camino) ? o.camino.toLowerCase() : null,
  };
}

const numero = (v: unknown, porDefecto = 0) => (typeof v === "number" && Number.isFinite(v) ? v : porDefecto);

/** Un grupo de sillas siempre armable: tipo y disposición válidos, colores `#rrggbb`, a lo más `MAX_SILLAS_POR_MESA` puestos con números finitos. */
export function normalizarSillas(v: unknown): SillasGuardadas {
  const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const tipo = esTipoSilla(o.tipo) ? o.tipo : "tiffany";
  const lista = Array.isArray(o.puestos) ? o.puestos.slice(0, MAX_SILLAS_POR_MESA) : [];
  const puestos = lista.flatMap((p): PuestoGuardado[] => {
    if (typeof p !== "object" || p === null) return [];
    const q = p as Record<string, unknown>;
    return [{ x: redondear(numero(q.x)), z: redondear(numero(q.z)), giroGrados: redondear(numero(q.giroGrados)) }];
  });
  return {
    tipo, colorEstructura: esHex(o.colorEstructura) ? o.colorEstructura.toLowerCase() : "#d6b25a",
    colorCojin: esHex(o.colorCojin) ? o.colorCojin.toLowerCase() : null,
    disposicion: esDisposicion(o.disposicion) ? o.disposicion : "alrededor", haciaGrados: redondear(numero(o.haciaGrados)),
    pedida: Math.min(MAX_SILLAS_POR_MESA, Math.max(puestos.length, Math.round(numero(o.pedida, puestos.length)))), puestos,
  };
}

const Hex = z.string().regex(HEX);
const Numero = z.number().finite();

/** El esquema de lo guardado en `mueble.mesa` (lo usa la API de la IA de escena para no dejar pasar basura). */
export const MesaGuardadaSchema = z.object({
  tipo: z.enum(TIPOS_MESA), anchoCm: Numero.positive().max(1000), fondoCm: Numero.positive().max(1000), altoCm: Numero.positive().max(200),
  mantel: z.enum(MANTELES), colorMantel: Hex, colorPatas: Hex, camino: Hex.nullable(),
});

/** El esquema de lo guardado en `mueble.sillas`. */
export const SillasGuardadasSchema = z.object({
  tipo: z.enum(TIPOS_SILLA), colorEstructura: Hex, colorCojin: Hex.nullable(), disposicion: z.enum(DISPOSICIONES), haciaGrados: Numero,
  pedida: z.number().int().min(0).max(MAX_SILLAS_POR_MESA),
  puestos: z.array(z.object({ x: Numero.min(-2000).max(2000), z: Numero.min(-2000).max(2000), giroGrados: Numero })).max(MAX_SILLAS_POR_MESA),
});
