/**
 * Producción solo con el asistente guiado (pedido del dueño, 2026-10-07): con `NEXT_PUBLIC_SOLO_GUIADA=true`
 * (definida únicamente en el entorno Production de Vercel) no hay vista clásica, ni catálogo, ni páginas internas:
 * toda página que no sea `/asistente` o `/login` redirige a `/asistente`. Las rutas `/api/*` y los archivos
 * estáticos siguen igual, porque la guiada los usa. En local y en las vistas previas la bandera no existe.
 */
export const SOLO_GUIADA = process.env.NEXT_PUBLIC_SOLO_GUIADA === "true";

export const RUTA_GUIADA = "/asistente";

const PAGINAS_PERMITIDAS = new Set([RUTA_GUIADA, "/login"]);

/** ¿Es una página (no una API, ni un recurso de Next, ni un archivo) que el modo solo-guiada no deja abrir? */
export function paginaBloqueadaSoloGuiada(pathname: string): boolean {
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/")) return false;
  const ruta = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (PAGINAS_PERMITIDAS.has(ruta)) return false;
  const ultimo = ruta.slice(ruta.lastIndexOf("/") + 1);
  return !ultimo.includes(".");
}
