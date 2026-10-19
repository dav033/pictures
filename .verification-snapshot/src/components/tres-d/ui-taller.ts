/**
 * Clases del Taller 3D (maqueta «Rediseño del Taller 3D», 2026-10-08): botones, riel, herramientas del visor, chips,
 * pestañas segmentadas, tarjetas y filas. Solo tokens del taller (`globals.css`, bloque `--taller-*`): nada de colores
 * sueltos. El foco visible lo pone la regla global `:focus-visible` (contorno del acento).
 */

/** Botón de las barras (36 px, borde, fondo de botón). */
export const BTN = "inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] border border-taller-borde bg-taller-boton px-3 text-[13px] font-medium leading-none text-taller-texto hover:bg-taller-encima disabled:cursor-not-allowed disabled:opacity-45";
/** Botón primario (morado con texto blanco). */
export const BTN_PRI = "inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] border border-taller-primario bg-taller-primario px-3 text-[13px] font-medium leading-none text-taller-sobre-primario hover:bg-taller-primario-hover disabled:cursor-not-allowed disabled:opacity-45";
/** Botón cuadrado de solo ícono (siempre con `aria-label`). */
export const BTN_ICO = "inline-grid size-9 shrink-0 place-items-center rounded-[10px] border border-taller-borde bg-taller-boton text-taller-texto hover:bg-taller-encima disabled:cursor-not-allowed disabled:opacity-45";
/** Botón del riel de paneles. */
export const RIEL = "grid size-11 place-items-center rounded-xl text-taller-medio hover:bg-taller-encima hover:text-taller-texto";
export const RIEL_ON = "bg-taller-elegido text-taller-acento hover:bg-taller-elegido hover:text-taller-acento";
/** Herramienta de la barra flotante del visor. */
export const HERRAMIENTA = "grid h-9 min-w-9 place-items-center rounded-[9px] px-0 text-taller-texto-2 hover:bg-taller-encima";
export const HERRAMIENTA_ON = "bg-taller-primario text-taller-sobre-primario hover:bg-taller-primario";
export const HERRAMIENTA_VISTA = "h-9 rounded-[9px] px-2.5 text-xs text-taller-texto-2 hover:bg-taller-encima";
export const HERRAMIENTA_VISTA_ON = "bg-taller-elegido text-taller-texto hover:bg-taller-elegido";
/** Chip (opción de un grupo): elegido con fondo morado oscuro y borde del resalte. */
export const CHIP = "min-h-8 rounded-[9px] border border-taller-borde bg-taller-tarjeta px-3 text-xs font-medium text-taller-texto-2 hover:bg-taller-encima";
export const CHIP_ON = "border-taller-resalte bg-taller-elegido text-taller-texto hover:bg-taller-elegido";
/** Pestaña segmentada (Estructuras · Decoraciones · …). */
export const SEG = "h-[30px] rounded-lg px-2.5 text-xs font-medium text-taller-medio hover:text-taller-texto";
export const SEG_ON = "bg-taller-elegido text-taller-texto";
/** Tarjeta de un catálogo (miniatura arriba, nombre y subtítulo). */
export const TARJETA = "flex flex-col gap-1.5 rounded-xl border border-taller-borde bg-taller-tarjeta p-2 text-left text-xs font-medium leading-snug text-taller-texto hover:border-taller-resalte";
export const MINI = "grid h-[72px] place-items-center overflow-hidden rounded-lg bg-taller-encima";
/** Fila de una lista (piezas, partes). */
export const FILA = "flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-taller-texto-2 hover:bg-taller-encima";
export const FILA_ON = "bg-taller-elegido text-taller-texto shadow-[inset_2px_0_0_var(--taller-resalte)] hover:bg-taller-elegido";
/** Recuadro de un dato (X, Fondo, Giro; Globo, Patrón). */
export const DATO = "rounded-[10px] border border-taller-borde bg-taller-tarjeta px-2.5 py-2";
/** Panel flotante sobre el visor (barra de herramientas, contador, IA). */
export const FLOTANTE = "border border-taller-borde bg-taller-barra/95 shadow-[0_8px_24px_var(--sombra)] backdrop-blur";
/** Rótulo de sección (MEDIDAS, LUGAR…). */
export const ROTULO = "taller-rotulo";

/** Metros con coma decimal: «1,8 m». */
export const metros = (cm: number, decimales = 2) => `${(cm / 100).toLocaleString("es-CO", { maximumFractionDigits: decimales })} m`;
/** Centímetros: «25 cm». */
export const centimetros = (cm: number) => `${cm.toLocaleString("es-CO", { maximumFractionDigits: 1 })} cm`;

const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** ¿El texto tiene todas las palabras de la búsqueda (sin tildes ni mayúsculas)? Búsqueda vacía: sí. */
export function coincide(busqueda: string, ...textos: ReadonlyArray<string | undefined>): boolean {
  const palabras = plano(busqueda).split(/\s+/).filter(Boolean);
  if (!palabras.length) return true;
  const todo = plano(textos.filter(Boolean).join(" "));
  return palabras.every((p) => todo.includes(p));
}
