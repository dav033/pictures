/**
 * Tope de dictados por IP (la app comparte una sola contraseña, así que la IP es lo más cercano a «por usuario»): una
 * ventana deslizante en memoria por minuto y otra por hora. Cada dictado ocupa el servicio del VPS unos segundos.
 */
export const TOPE_POR_MINUTO = 12;
export const TOPE_POR_HORA = 200;
const MINUTO_MS = 60_000;
const HORA_MS = 3_600_000;
const MAX_IPS = 5_000;

declare global {
  var __vozPorIp: Map<string, number[]> | undefined;
}

export type ResultadoLimite = { permitido: true } | { permitido: false; reintentarEnSeg: number };

export function tomarCupoVoz(ip: string, ahora = Date.now()): ResultadoLimite {
  const mapa: Map<string, number[]> = (globalThis.__vozPorIp ??= new Map<string, number[]>());
  if (mapa.size > MAX_IPS) {
    for (const [clave, marcas] of mapa) if (!marcas.some((m) => ahora - m < HORA_MS)) mapa.delete(clave);
    if (mapa.size > MAX_IPS) mapa.clear();
  }
  const marcas = (mapa.get(ip) ?? []).filter((m) => ahora - m < HORA_MS);
  const ultimoMinuto = marcas.filter((m) => ahora - m < MINUTO_MS);
  if (ultimoMinuto.length >= TOPE_POR_MINUTO) {
    mapa.set(ip, marcas);
    return { permitido: false, reintentarEnSeg: Math.max(1, Math.ceil((ultimoMinuto[0] + MINUTO_MS - ahora) / 1000)) };
  }
  if (marcas.length >= TOPE_POR_HORA) {
    mapa.set(ip, marcas);
    return { permitido: false, reintentarEnSeg: Math.max(1, Math.ceil((marcas[0] + HORA_MS - ahora) / 1000)) };
  }
  marcas.push(ahora);
  mapa.set(ip, marcas);
  return { permitido: true };
}

/** Solo para las pruebas. */
export function reiniciarLimiteVoz(): void {
  globalThis.__vozPorIp = new Map();
}
